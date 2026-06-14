import { v } from 'convex/values';
import { corsHeaders, extractAuth, ingestError } from '@sveltry/protocol';
import { internal } from './_generated/api';
import { httpAction, internalMutation, query } from './_generated/server';
import { requireOrg } from './lib/auth';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Increment the per-project, per-day usage counters for one ingest batch. */
export const recordUsage = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    events: v.number(),
    transactions: v.number(),
    dropped: v.number(),
  },
  handler: async (ctx, args) => {
    const day = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const existing = await ctx.db
      .query('usageDaily')
      .withIndex('by_project_day', (q) => q.eq('projectId', args.projectId).eq('day', day))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        eventCount: existing.eventCount + args.events,
        transactionCount: existing.transactionCount + args.transactions,
        droppedCount: existing.droppedCount + args.dropped,
      });
    } else {
      await ctx.db.insert('usageDaily', {
        organizationId: args.organizationId,
        projectId: args.projectId,
        day,
        eventCount: args.events,
        transactionCount: args.transactions,
        droppedCount: args.dropped,
      });
    }
  },
});

/** Per-project usage over the last 30 days, plus a daily series. */
export const projectUsage = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return null;
    const since = Math.floor((Date.now() - 30 * DAY_MS) / DAY_MS) * DAY_MS;
    const rows = await ctx.db
      .query('usageDaily')
      .withIndex('by_project_day', (q) => q.eq('projectId', projectId).gte('day', since))
      .collect();
    const totals = rows.reduce(
      (acc, r) => ({
        events: acc.events + r.eventCount,
        transactions: acc.transactions + r.transactionCount,
        dropped: acc.dropped + r.droppedCount,
      }),
      { events: 0, transactions: 0, dropped: 0 },
    );
    return {
      totals,
      days: rows
        .map((r) => ({
          day: r.day,
          events: r.eventCount,
          transactions: r.transactionCount,
        }))
        .sort((a, b) => a.day - b.day),
    };
  },
});

/** Record a deploy (called by the deploy API). */
export const recordDeploy = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    release: v.string(),
    environment: v.string(),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('deploys', { ...args, deployedAt: Date.now() });
  },
});

/** List a project's deploys, most recent first. */
export const listDeploys = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return [];
    return ctx.db
      .query('deploys')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .order('desc')
      .take(50);
  },
});

/**
 * Deploy API: POST /deploys?sentry_key=<key>&o=<publicId>
 * Body: { "release": "...", "environment": "production", "name"?, "url"? }
 * DSN-key authenticated, mirroring the artifact upload endpoint.
 */
export const recordDeployHttp = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get('origin') ?? '*');
  const auth = extractAuth(request.headers.get('x-sentry-auth'), url.searchParams);
  const publicKey = auth.sentry_key;
  const publicId = url.searchParams.get('o') ?? '';
  if (!publicKey) return ingestError(401, 'missing sentry_key', [], cors);
  if (!publicId) return ingestError(400, 'missing project id (o=<publicId>)', [], cors);

  const resolved = await ctx.runQuery(internal.projects.resolveIngestKey, { publicId, publicKey });
  if (!resolved) return ingestError(401, 'invalid dsn', [], cors);

  let body: { release?: string; environment?: string; name?: string; url?: string };
  try {
    body = await request.json();
  } catch {
    return ingestError(400, 'invalid JSON body', [], cors);
  }
  if (!body.release) return ingestError(400, 'missing release', [], cors);

  await ctx.runMutation(internal.usage.recordDeploy, {
    projectId: resolved.projectId,
    organizationId: resolved.organizationId,
    release: body.release,
    environment: body.environment ?? 'production',
    name: body.name,
    url: body.url,
  });
  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'content-type': 'application/json', ...cors },
  });
});
