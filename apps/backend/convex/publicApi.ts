import { v } from 'convex/values';
import { corsHeaders } from '@sveltry/protocol';
import { internal } from './_generated/api';
import { httpAction, internalQuery } from './_generated/server';
import { issueStatusValidator } from './schema';
import type { Doc } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// Public read API (v1), authenticated by an organization API token (Bearer).
// Routes under `/api/v1/`:
//   GET /api/v1/projects
//   GET /api/v1/projects/<slug>/issues?status=<s>&limit=<n>
//   GET /api/v1/issues/<id>
// Everything is scoped to the token's organization. Read-only for now.
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

/** List the org's projects. */
export const apiProjects = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const rows = await ctx.db
      .query('projects')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .collect();
    return rows.map((p) => ({
      id: p._id,
      slug: p.slug,
      name: p.name,
      platform: p.platform,
      publicId: p.publicId,
    }));
  },
});

/** List a project's issues (by slug), optionally filtered by status, newest first. */
export const apiIssues = internalQuery({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    status: v.optional(issueStatusValidator),
    limit: v.number(),
  },
  handler: async (ctx, { organizationId, slug, status, limit }) => {
    const project = await ctx.db
      .query('projects')
      .withIndex('by_org_slug', (q) => q.eq('organizationId', organizationId).eq('slug', slug))
      .first();
    if (!project) return null;
    const take = Math.min(MAX_LIMIT, Math.max(1, limit));
    const issues = status
      ? await ctx.db
          .query('issues')
          .withIndex('by_project_status_lastSeen', (q) =>
            q.eq('projectId', project._id).eq('status', status),
          )
          .order('desc')
          .take(take)
      : await ctx.db
          .query('issues')
          .withIndex('by_project_lastSeen', (q) => q.eq('projectId', project._id))
          .order('desc')
          .take(take);
    return { project: { slug: project.slug, name: project.name }, issues: issues.map(issueView) };
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

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });
}

/** The `/api/v1/` read API. Bearer-authenticated by an organization API token. */
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

  let result: unknown = null;

  if (parts.length === 1 && parts[0] === 'projects') {
    result = {
      projects: await ctx.runQuery(internal.publicApi.apiProjects, { organizationId: orgId }),
    };
  } else if (parts.length === 3 && parts[0] === 'projects' && parts[2] === 'issues') {
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
    const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT;
    result = await ctx.runQuery(internal.publicApi.apiIssues, {
      organizationId: orgId,
      slug,
      status,
      limit,
    });
    if (result === null) return json({ error: 'project not found' }, 404, cors);
  } else if (parts.length === 2 && parts[0] === 'issues') {
    result = await ctx.runQuery(internal.publicApi.apiIssue, {
      organizationId: orgId,
      issueId: parts[1]!,
    });
    if (result === null) return json({ error: 'issue not found' }, 404, cors);
  } else {
    return json({ error: 'unknown endpoint' }, 404, cors);
  }

  // Record usage without blocking the response.
  await ctx.runMutation(internal.apiTokens.touchApiToken, { tokenId: resolved.tokenId });
  return json(result, 200, cors);
});
