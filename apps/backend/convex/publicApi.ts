import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { corsHeaders } from '@sveltry/protocol';
import { internal } from './_generated/api';
import { httpAction, internalMutation, internalQuery } from './_generated/server';
import { issueStatusValidator } from './schema';
import type { Doc } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// Public API (v1), authenticated by an organization API token (Bearer). Routes:
//   GET  /api/v1/projects
//   GET  /api/v1/releases?project=<slug>&cursor=<c>&limit=<n>
//   GET  /api/v1/members?cursor=<c>&limit=<n>
//   GET  /api/v1/projects/<slug>/issues?status=<s>&cursor=<c>&limit=<n>
//   GET  /api/v1/issues/<id>
//   GET  /api/v1/events/<eventId>
//   GET  /api/v1/issues/<id>/events?cursor=<c>&limit=<n>
//   POST /api/v1/issues/<id>/assign                       (write-scoped; body { assigneeId })
//   POST /api/v1/issues/<id>/{resolve,ignore,unresolve}   (write-scoped token)
// Everything is scoped to the token's organization. List endpoints return a
// `nextCursor` (null when exhausted); consumers ignoring it still get up-to-`limit` items.
// ---------------------------------------------------------------------------

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

function issueView(i: Doc<'issues'>) {
  return {
    id: i._id,
    title: i.title,
    culprit: i.culprit,
    level: i.level,
    status: i.status,
    substatus: i.substatus,
    count: i.count,
    userCount: i.userCount,
    firstSeen: i.firstSeen,
    lastSeen: i.lastSeen,
    errorType: i.errorType ?? null,
    assigneeId: i.assigneeId ?? null,
  };
}

function projectView(p: Doc<'projects'>) {
  return { id: p._id, slug: p.slug, name: p.name, platform: p.platform, publicId: p.publicId };
}

function releaseView(r: Doc<'releases'>) {
  return {
    id: r._id,
    version: r.version,
    ref: r.ref ?? null,
    url: r.url ?? null,
    createdAt: r.createdAt,
    firstEventAt: r.firstEventAt ?? null,
    lastEventAt: r.lastEventAt ?? null,
  };
}

function memberView(m: Doc<'memberRoles'>) {
  return {
    id: m._id,
    userId: m.userId,
    email: m.email ?? null,
    name: m.name ?? null,
    role: m.role,
  };
}

/** The compact event projection used in list responses (no full payload). */
function eventListView(e: Doc<'events'>) {
  return {
    eventId: e.eventId,
    timestamp: e.timestamp,
    level: e.level,
    platform: e.platform,
    environment: e.environment,
    release: e.release ?? null,
    message: e.message,
    culprit: e.culprit,
    tags: e.tags,
  };
}

/** Map a Convex pagination result's page through a view, keeping the cursor fields. */
function mapPage<S, T>(
  res: { page: S[]; isDone: boolean; continueCursor: string },
  view: (d: S) => T,
) {
  return { page: res.page.map(view), isDone: res.isDone, continueCursor: res.continueCursor };
}

/**
 * List the org's projects. Returned unbounded in a single page (project counts
 * are small): `nextCursor` is always null, kept only for response-shape parity
 * with the paginated lists. Preserves the original (pre-pagination) contract.
 */
export const apiProjects = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const rows = await ctx.db
      .query('projects')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .collect();
    return rows.map(projectView);
  },
});

/** List the org's releases newest-first, optionally filtered to one project (by slug). */
export const apiReleases = internalQuery({
  args: {
    organizationId: v.string(),
    project: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { organizationId, project, paginationOpts }) => {
    if (project) {
      const proj = await ctx.db
        .query('projects')
        .withIndex('by_org_slug', (q) => q.eq('organizationId', organizationId).eq('slug', project))
        .first();
      if (!proj) return null; // unknown slug -> 404
      const res = await ctx.db
        .query('releases')
        .withIndex('by_project', (q) => q.eq('projectId', proj._id))
        .order('desc')
        .paginate(paginationOpts);
      return mapPage(res, releaseView);
    }
    const res = await ctx.db
      .query('releases')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .paginate(paginationOpts);
    return mapPage(res, releaseView);
  },
});

/** List the org's members (paginated). Email/name are denormalized on the membership row. */
export const apiMembers = internalQuery({
  args: { organizationId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { organizationId, paginationOpts }) => {
    const res = await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .paginate(paginationOpts);
    return mapPage(res, memberView);
  },
});

/** List a project's issues (by slug), optionally filtered by status, newest first. */
export const apiIssues = internalQuery({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    status: v.optional(issueStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { organizationId, slug, status, paginationOpts }) => {
    const project = await ctx.db
      .query('projects')
      .withIndex('by_org_slug', (q) => q.eq('organizationId', organizationId).eq('slug', slug))
      .first();
    if (!project) return null;
    const res = status
      ? await ctx.db
          .query('issues')
          .withIndex('by_project_status_lastSeen', (q) =>
            q.eq('projectId', project._id).eq('status', status),
          )
          .order('desc')
          .paginate(paginationOpts)
      : await ctx.db
          .query('issues')
          .withIndex('by_project_lastSeen', (q) => q.eq('projectId', project._id))
          .order('desc')
          .paginate(paginationOpts);
    return { project: { slug: project.slug, name: project.name }, ...mapPage(res, issueView) };
  },
});

/** A single issue by id, scoped to the org. */
export const apiIssue = internalQuery({
  args: { organizationId: v.string(), issueId: v.string() },
  handler: async (ctx, { organizationId, issueId }) => {
    let issue: Doc<'issues'> | null = null;
    try {
      issue = await ctx.db.get(issueId as Doc<'issues'>['_id']);
    } catch {
      return null; // malformed id
    }
    if (!issue || issue.organizationId !== organizationId) return null;
    const project = await ctx.db.get(issue.projectId);
    return {
      ...issueView(issue),
      project: project ? { slug: project.slug, name: project.name } : null,
    };
  },
});

/** A single event by its Sentry event id, with the full payload, scoped to the org. */
export const apiEvent = internalQuery({
  args: { organizationId: v.string(), eventId: v.string() },
  handler: async (ctx, { organizationId, eventId }) => {
    // Org-scoped in the index: `eventId` is unique per project, not globally, so a
    // blind `by_eventId` lookup could surface a different org's colliding row and
    // 404 the caller's own event.
    const event = await ctx.db
      .query('events')
      .withIndex('by_org_eventId', (q) =>
        q.eq('organizationId', organizationId).eq('eventId', eventId),
      )
      .first();
    if (!event) return null;
    return {
      id: event._id,
      eventId: event.eventId,
      issueId: event.issueId,
      timestamp: event.timestamp,
      receivedAt: event.receivedAt,
      level: event.level,
      platform: event.platform,
      environment: event.environment,
      release: event.release ?? null,
      message: event.message,
      culprit: event.culprit,
      tags: event.tags,
      payload: event.payload, // full Sentry blob: frames, breadcrumbs, request, contexts
    };
  },
});

/** Recent events for an issue (newest first, paginated), scoped to the org. */
export const apiIssueEvents = internalQuery({
  args: {
    organizationId: v.string(),
    issueId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { organizationId, issueId, paginationOpts }) => {
    let issue: Doc<'issues'> | null = null;
    try {
      issue = await ctx.db.get(issueId as Doc<'issues'>['_id']);
    } catch {
      return null;
    }
    if (!issue || issue.organizationId !== organizationId) return null;
    const res = await ctx.db
      .query('events')
      .withIndex('by_issue', (q) => q.eq('issueId', issue._id))
      .order('desc')
      .paginate(paginationOpts);
    return mapPage(res, eventListView);
  },
});

/** Set an issue's status (resolve / ignore / unresolve), scoped to the org. */
export const apiSetIssueStatus = internalMutation({
  args: { organizationId: v.string(), issueId: v.string(), status: issueStatusValidator },
  returns: v.boolean(),
  handler: async (ctx, { organizationId, issueId, status }) => {
    let issue: Doc<'issues'> | null = null;
    try {
      issue = await ctx.db.get(issueId as Doc<'issues'>['_id']);
    } catch {
      return false;
    }
    if (!issue || issue.organizationId !== organizationId) return false;
    // Mirror the dashboard's default substatus per status (see issues.setIssueStatus).
    const substatus =
      status === 'resolved' ? 'ongoing' : status === 'ignored' ? 'archived_forever' : 'ongoing';
    await ctx.db.patch(issue._id, {
      status,
      substatus,
      resolvedInRelease: undefined,
    });
    return true;
  },
});

/**
 * Assign (or unassign, with a null assignee) an issue, scoped to the org. Unlike
 * the dashboard mutation, this validates that a non-null assignee is a member of
 * the token's organization, so an external caller cannot set an arbitrary id.
 */
export const apiAssignIssue = internalMutation({
  args: {
    organizationId: v.string(),
    issueId: v.string(),
    assigneeId: v.union(v.string(), v.null()),
  },
  returns: v.union(v.literal('ok'), v.literal('not_found'), v.literal('bad_assignee')),
  handler: async (ctx, { organizationId, issueId, assigneeId }) => {
    let issue: Doc<'issues'> | null = null;
    try {
      issue = await ctx.db.get(issueId as Doc<'issues'>['_id']);
    } catch {
      return 'not_found'; // malformed id
    }
    if (!issue || issue.organizationId !== organizationId) return 'not_found';

    if (assigneeId !== null) {
      const member = await ctx.db
        .query('memberRoles')
        .withIndex('by_org_user', (q) =>
          q.eq('organizationId', organizationId).eq('userId', assigneeId),
        )
        .first();
      if (!member) return 'bad_assignee';
    }

    // `issues.assigneeId` is v.optional(v.string()); undefined clears it.
    await ctx.db.patch(issue._id, { assigneeId: assigneeId ?? undefined });
    return 'ok';
  },
});

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });
}

/** Build Convex pagination opts from the request's ?limit= and ?cursor= params. */
function paginationFrom(url: URL): { numItems: number; cursor: string | null } {
  const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT;
  return {
    numItems: Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit))),
    // An absent param is null (page 1); an explicit empty `?cursor=` would be ''
    // which Convex rejects, so normalize it to null too.
    cursor: url.searchParams.get('cursor') || null,
  };
}

/** Map a Convex pagination result to the public `nextCursor` (null when exhausted). */
function nextCursor(r: { isDone: boolean; continueCursor: string }): string | null {
  return r.isDone ? null : r.continueCursor;
}

/** Map a POST triage action to the issue status it sets. */
const TRIAGE_STATUS: Record<string, 'resolved' | 'ignored' | 'unresolved'> = {
  resolve: 'resolved',
  ignore: 'ignored',
  unresolve: 'unresolved',
};

/**
 * The `/api/v1/` API. Bearer-authenticated by an organization API token. GET is
 * read-only; POST endpoints (assign / triage) require a `write`-scoped token.
 */
export const apiV1 = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get('origin') ?? '*');

  const authz = request.headers.get('authorization') ?? '';
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  if (!token) return json({ error: 'missing bearer token' }, 401, cors);

  const resolved = await ctx.runQuery(internal.apiTokens.resolveApiToken, { rawToken: token });
  if (!resolved) return json({ error: 'invalid token' }, 401, cors);
  const orgId = resolved.organizationId;

  // Path after the `/api/v1/` prefix, split into segments.
  const rest = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/+$/, '');
  const parts = rest.length ? rest.split('/') : [];
  const isGet = request.method === 'GET';

  let result: unknown = null;

  if (isGet && parts.length === 1 && parts[0] === 'projects') {
    const projects = await ctx.runQuery(internal.publicApi.apiProjects, {
      organizationId: orgId,
    });
    result = { projects, nextCursor: null };
  } else if (isGet && parts.length === 1 && parts[0] === 'releases') {
    const project = url.searchParams.get('project') ?? undefined;
    try {
      const r = await ctx.runQuery(internal.publicApi.apiReleases, {
        organizationId: orgId,
        project,
        paginationOpts: paginationFrom(url),
      });
      if (r === null) return json({ error: 'project not found' }, 404, cors);
      result = { releases: r.page, nextCursor: nextCursor(r) };
    } catch {
      return json({ error: 'invalid cursor' }, 400, cors);
    }
  } else if (isGet && parts.length === 1 && parts[0] === 'members') {
    try {
      const r = await ctx.runQuery(internal.publicApi.apiMembers, {
        organizationId: orgId,
        paginationOpts: paginationFrom(url),
      });
      result = { members: r.page, nextCursor: nextCursor(r) };
    } catch {
      return json({ error: 'invalid cursor' }, 400, cors);
    }
  } else if (isGet && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'issues') {
    // A malformed percent-encoding (e.g. `my%ZZ`) would otherwise throw a 500.
    let slug: string;
    try {
      slug = decodeURIComponent(parts[1]!);
    } catch {
      return json({ error: 'invalid project slug' }, 400, cors);
    }
    const statusParam = url.searchParams.get('status') ?? undefined;
    const status =
      statusParam === 'unresolved' || statusParam === 'resolved' || statusParam === 'ignored'
        ? statusParam
        : undefined;
    try {
      const r = await ctx.runQuery(internal.publicApi.apiIssues, {
        organizationId: orgId,
        slug,
        status,
        paginationOpts: paginationFrom(url),
      });
      if (r === null) return json({ error: 'project not found' }, 404, cors);
      result = { project: r.project, issues: r.page, nextCursor: nextCursor(r) };
    } catch {
      return json({ error: 'invalid cursor' }, 400, cors);
    }
  } else if (isGet && parts.length === 2 && parts[0] === 'issues') {
    result = await ctx.runQuery(internal.publicApi.apiIssue, {
      organizationId: orgId,
      issueId: parts[1]!,
    });
    if (result === null) return json({ error: 'issue not found' }, 404, cors);
  } else if (isGet && parts.length === 2 && parts[0] === 'events') {
    let eventId: string;
    try {
      eventId = decodeURIComponent(parts[1]!);
    } catch {
      return json({ error: 'invalid event id' }, 400, cors);
    }
    result = await ctx.runQuery(internal.publicApi.apiEvent, {
      organizationId: orgId,
      eventId,
    });
    if (result === null) return json({ error: 'event not found' }, 404, cors);
  } else if (isGet && parts.length === 3 && parts[0] === 'issues' && parts[2] === 'events') {
    try {
      const r = await ctx.runQuery(internal.publicApi.apiIssueEvents, {
        organizationId: orgId,
        issueId: parts[1]!,
        paginationOpts: paginationFrom(url),
      });
      if (r === null) return json({ error: 'issue not found' }, 404, cors);
      result = { events: r.page, nextCursor: nextCursor(r) };
    } catch {
      return json({ error: 'invalid cursor' }, 400, cors);
    }
  } else if (
    request.method === 'POST' &&
    parts.length === 3 &&
    parts[0] === 'issues' &&
    parts[2] === 'assign'
  ) {
    if (resolved.scope !== 'write') return json({ error: 'token is read-only' }, 403, cors);
    let body: { assigneeId?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid body' }, 400, cors);
    }
    const assigneeId = body.assigneeId;
    if (assigneeId !== null && typeof assigneeId !== 'string') {
      return json({ error: 'assigneeId must be a string or null' }, 400, cors);
    }
    const outcome = await ctx.runMutation(internal.publicApi.apiAssignIssue, {
      organizationId: orgId,
      issueId: parts[1]!,
      assigneeId,
    });
    if (outcome === 'not_found') return json({ error: 'issue not found' }, 404, cors);
    if (outcome === 'bad_assignee') {
      return json({ error: 'assignee is not a member of this organization' }, 400, cors);
    }
    result = { ok: true, assigneeId };
  } else if (
    request.method === 'POST' &&
    parts.length === 3 &&
    parts[0] === 'issues' &&
    parts[2]! in TRIAGE_STATUS
  ) {
    if (resolved.scope !== 'write') return json({ error: 'token is read-only' }, 403, cors);
    const newStatus = TRIAGE_STATUS[parts[2]!]!;
    const ok = await ctx.runMutation(internal.publicApi.apiSetIssueStatus, {
      organizationId: orgId,
      issueId: parts[1]!,
      status: newStatus,
    });
    if (!ok) return json({ error: 'issue not found' }, 404, cors);
    result = { ok: true, status: newStatus };
  } else {
    return json({ error: 'unknown endpoint' }, 404, cors);
  }

  // Record usage without blocking the response.
  await ctx.runMutation(internal.apiTokens.touchApiToken, { tokenId: resolved.tokenId });
  return json(result, 200, cors);
});
