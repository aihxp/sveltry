import { v } from 'convex/values';
import {
  corsHeaders,
  frameRef,
  ingestError,
  parseResolvedShortIds,
  suspectCommits,
} from '@sveltry/protocol';
import type { SentryEventPayload, SentryException, SentryStackFrame } from '@sveltry/types';
import { internal } from './_generated/api';
import { httpAction, internalMutation, internalQuery, query } from './_generated/server';
import { requireOrg } from './lib/auth';
import { resolveDsnRequest } from './lib/dsnAuth';

// ---------------------------------------------------------------------------
// Upload: POST /releases/commits?o=<publicId>&sentry_key=<key>
// DSN-key authenticated. Body: { release, commits: [{ id, message?, author?,
// author_email?, timestamp?, url?, files?: string[], patch_set?: [{ path }] }] }.
// Mirrors `sentry-cli releases set-commits`. The `files`/`patch_set` list of
// changed paths is what powers suspect-commit matching.
// ---------------------------------------------------------------------------

interface UploadCommit {
  id?: string;
  message?: string;
  author?: string;
  author_email?: string;
  url?: string;
  timestamp?: number | string;
  files?: string[];
  patch_set?: { path?: string }[];
}

function commitFiles(c: UploadCommit): string[] {
  if (Array.isArray(c.files) && c.files.length > 0)
    return c.files.filter((f) => typeof f === 'string');
  if (Array.isArray(c.patch_set)) {
    return c.patch_set.map((p) => p?.path).filter((p): p is string => typeof p === 'string');
  }
  return [];
}

function commitTimestamp(c: UploadCommit, fallback: number): number {
  if (typeof c.timestamp === 'number') return c.timestamp;
  if (typeof c.timestamp === 'string') {
    const t = Date.parse(c.timestamp);
    if (!Number.isNaN(t)) return t;
  }
  return fallback;
}

export const uploadCommits = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get('origin') ?? '*');
  const auth = await resolveDsnRequest(ctx, request, url, cors);
  if (!auth.ok) return auth.response;
  const resolved = auth.resolved;

  let body: { release?: string; commits?: UploadCommit[] };
  try {
    body = await request.json();
  } catch {
    return ingestError(400, 'invalid JSON body', [], cors);
  }
  if (!body.release) return ingestError(400, 'missing release', [], cors);
  if (!Array.isArray(body.commits)) return ingestError(400, 'missing commits array', [], cors);

  const now = Date.now();
  const commits = body.commits
    .filter((c) => typeof c.id === 'string' && c.id.length > 0)
    .map((c) => ({
      commitId: c.id as string,
      message: typeof c.message === 'string' ? c.message.slice(0, 1000) : undefined,
      author: typeof c.author === 'string' ? c.author : undefined,
      authorEmail: typeof c.author_email === 'string' ? c.author_email : undefined,
      url: typeof c.url === 'string' ? c.url : undefined,
      timestamp: commitTimestamp(c, now),
      files: commitFiles(c),
    }));

  await ctx.runMutation(internal.commits.recordCommits, {
    projectId: resolved.projectId,
    organizationId: resolved.organizationId,
    release: body.release,
    commits,
  });

  return new Response(
    JSON.stringify({ ok: true, release: body.release, commits: commits.length }),
    {
      status: 201,
      headers: { 'content-type': 'application/json', ...cors },
    },
  );
});

/** Replace the stored commit set for a release with the uploaded one. */
export const recordCommits = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    release: v.string(),
    commits: v.array(
      v.object({
        commitId: v.string(),
        message: v.optional(v.string()),
        author: v.optional(v.string()),
        authorEmail: v.optional(v.string()),
        url: v.optional(v.string()),
        timestamp: v.number(),
        files: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { projectId, organizationId, release, commits }) => {
    const existing = await ctx.db
      .query('releaseCommits')
      .withIndex('by_project_release', (q) => q.eq('projectId', projectId).eq('release', release))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const now = Date.now();
    for (const c of commits) {
      await ctx.db.insert('releaseCommits', {
        organizationId,
        projectId,
        release,
        ...c,
        createdAt: now,
      });
    }

    // Auto-resolve issues a commit message marks as fixed (e.g. "Fixes WEB-1A2B3C").
    // Scoped to this project; resolve-in-this-release so a later regression reopens.
    const refs = new Set<string>();
    for (const c of commits) {
      if (c.message) for (const sid of parseResolvedShortIds(c.message)) refs.add(sid);
    }
    for (const sid of refs) {
      const issue = await ctx.db
        .query('issues')
        .withIndex('by_org_shortId', (q) =>
          q.eq('organizationId', organizationId).eq('shortId', sid),
        )
        .first();
      if (issue && issue.projectId === projectId && issue.status !== 'resolved') {
        await ctx.db.patch(issue._id, {
          status: 'resolved',
          substatus: 'ongoing',
          resolvedInRelease: release,
        });
      }
    }
  },
});

export const commitsForRelease = internalQuery({
  args: { projectId: v.id('projects'), release: v.string() },
  handler: async (ctx, { projectId, release }) => {
    return ctx.db
      .query('releaseCommits')
      .withIndex('by_project_release', (q) => q.eq('projectId', projectId).eq('release', release))
      .collect();
  },
});

// ---------------------------------------------------------------------------
// Dashboard query: the suspect commits for an issue.
// ---------------------------------------------------------------------------

function exceptionValues(payload: SentryEventPayload): SentryException[] {
  const ex = payload.exception;
  if (!ex) return [];
  return Array.isArray(ex) ? ex : (ex.values ?? []);
}

/** The files referenced by an event's stack frames, in-app frames first. */
function stackFiles(payload: SentryEventPayload): string[] {
  const inApp: string[] = [];
  const other: string[] = [];
  for (const ex of exceptionValues(payload)) {
    for (const frame of (ex.stacktrace?.frames ?? []) as SentryStackFrame[]) {
      const ref = frame.filename ?? frameRef(frame);
      if (!ref) continue;
      (frame.in_app === false ? other : inApp).push(ref);
    }
  }
  return [...inApp, ...other];
}

/**
 * The commit(s) that most likely introduced this issue: the most recent commits in
 * the issue's release that changed a file appearing in its stack trace. Empty when
 * the issue has no release, no uploaded commits, or no overlap.
 */
export const suspectCommitsForIssue = query({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.organizationId !== activeOrganizationId) return [];

    const event = await ctx.db
      .query('events')
      .withIndex('by_issue', (q) => q.eq('issueId', issueId))
      .order('desc')
      .first();
    if (!event || !event.release) return [];

    const commits = await ctx.db
      .query('releaseCommits')
      .withIndex('by_project_release', (q) =>
        q.eq('projectId', issue.projectId).eq('release', event.release as string),
      )
      .collect();
    if (commits.length === 0) return [];

    const files = stackFiles(event.payload as SentryEventPayload);
    const suspects = suspectCommits(
      files,
      commits.map((c) => ({ commitId: c.commitId, timestamp: c.timestamp, files: c.files })),
    );

    const byId = new Map(commits.map((c) => [c.commitId, c]));
    return suspects.map((s) => {
      const c = byId.get(s.commitId)!;
      return {
        commitId: c.commitId,
        shortId: c.commitId.slice(0, 7),
        message: c.message ?? null,
        author: c.author ?? null,
        authorEmail: c.authorEmail ?? null,
        url: c.url ?? null,
        timestamp: c.timestamp,
        file: s.file,
      };
    });
  },
});
