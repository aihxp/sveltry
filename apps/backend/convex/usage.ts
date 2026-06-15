import { v } from 'convex/values';
import { corsHeaders, extractAuth, ingestError } from '@sveltry/protocol';
import { internal } from './_generated/api';
import { httpAction, internalMutation, internalQuery, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireOrg } from './lib/auth';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Increment the per-project, per-day usage counters for one ingest batch. */
export const recordUsage = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    events: v.number(),
    transactions: v.number(),
    dropped: v.number(),
    /** Error events dropped by inbound data filters; optional for back-compat. */
    filtered: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const day = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const filtered = args.filtered ?? 0;
    const existing = await ctx.db
      .query('usageDaily')
      .withIndex('by_project_day', (q) => q.eq('projectId', args.projectId).eq('day', day))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        eventCount: existing.eventCount + args.events,
        transactionCount: existing.transactionCount + args.transactions,
        droppedCount: existing.droppedCount + args.dropped,
        filteredCount: (existing.filteredCount ?? 0) + filtered,
      });
    } else {
      await ctx.db.insert('usageDaily', {
        organizationId: args.organizationId,
        projectId: args.projectId,
        day,
        eventCount: args.events,
        transactionCount: args.transactions,
        droppedCount: args.dropped,
        filteredCount: filtered,
      });
    }
  },
});

/**
 * Per-project usage over a window (default 30 days, clamped to 1-90), plus a
 * daily series. The series is sparse (only days with activity); the dashboard
 * gap-fills zero days across the window.
 */
export const projectUsage = query({
  args: { projectId: v.id('projects'), windowDays: v.optional(v.number()) },
  handler: async (ctx, { projectId, windowDays }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return null;
    const window = Math.min(90, Math.max(1, Math.round(windowDays ?? 30)));
    const since = Math.floor((Date.now() - window * DAY_MS) / DAY_MS) * DAY_MS;
    const rows = await ctx.db
      .query('usageDaily')
      .withIndex('by_project_day', (q) => q.eq('projectId', projectId).gte('day', since))
      .collect();
    const totals = rows.reduce(
      (acc, r) => ({
        events: acc.events + r.eventCount,
        transactions: acc.transactions + r.transactionCount,
        dropped: acc.dropped + r.droppedCount,
        filtered: acc.filtered + (r.filteredCount ?? 0),
      }),
      { events: 0, transactions: 0, dropped: 0, filtered: 0 },
    );
    return {
      windowDays: window,
      totals,
      days: rows
        .map((r) => ({
          day: r.day,
          events: r.eventCount,
          transactions: r.transactionCount,
          dropped: r.droppedCount,
          filtered: r.filteredCount ?? 0,
        }))
        .sort((a, b) => a.day - b.day),
    };
  },
});

interface UsageTotals {
  events: number;
  transactions: number;
  dropped: number;
  filtered: number;
}
const emptyTotals = (): UsageTotals => ({ events: 0, transactions: 0, dropped: 0, filtered: 0 });

/**
 * Org-wide usage over a window (default 30 days, clamped to 1-90): totals, a
 * daily series summed across all projects, and a per-project breakdown. Visible
 * to any member (the Stats page).
 */
export const orgUsage = query({
  args: { windowDays: v.optional(v.number()) },
  handler: async (ctx, { windowDays }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const window = Math.min(90, Math.max(1, Math.round(windowDays ?? 30)));
    const since = Math.floor((Date.now() - window * DAY_MS) / DAY_MS) * DAY_MS;
    const rows = await ctx.db
      .query('usageDaily')
      .withIndex('by_org_day', (q) =>
        q.eq('organizationId', activeOrganizationId).gte('day', since),
      )
      .collect();

    const totals = emptyTotals();
    const byDay = new Map<number, UsageTotals>();
    const byProject = new Map<string, UsageTotals>();
    for (const r of rows) {
      const f = r.filteredCount ?? 0;
      totals.events += r.eventCount;
      totals.transactions += r.transactionCount;
      totals.dropped += r.droppedCount;
      totals.filtered += f;
      const day = byDay.get(r.day) ?? emptyTotals();
      day.events += r.eventCount;
      day.transactions += r.transactionCount;
      day.dropped += r.droppedCount;
      day.filtered += f;
      byDay.set(r.day, day);
      const proj = byProject.get(r.projectId) ?? emptyTotals();
      proj.events += r.eventCount;
      proj.transactions += r.transactionCount;
      proj.dropped += r.droppedCount;
      proj.filtered += f;
      byProject.set(r.projectId, proj);
    }

    const projects = await Promise.all(
      [...byProject.entries()].map(async ([projectId, agg]) => {
        const project = await ctx.db.get(projectId as Id<'projects'>);
        return {
          id: projectId,
          name: project?.name ?? '(deleted)',
          slug: project?.slug ?? null,
          ...agg,
        };
      }),
    );
    projects.sort((a, b) => b.events - a.events);

    return {
      windowDays: window,
      totals,
      days: [...byDay.entries()].map(([day, t]) => ({ day, ...t })).sort((a, b) => a.day - b.day),
      projects,
    };
  },
});

/** Events accepted so far this calendar month for a project (for hard quotas). */
export const monthEventUsage = internalQuery({
  args: { projectId: v.id('projects') },
  returns: v.number(),
  handler: async (ctx, { projectId }) => {
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const rows = await ctx.db
      .query('usageDaily')
      .withIndex('by_project_day', (q) => q.eq('projectId', projectId).gte('day', monthStart))
      .collect();
    return rows.reduce((s, r) => s + r.eventCount, 0);
  },
});

/**
 * Increment the project's current one-minute spike window and report whether it
 * has exceeded the threshold (automatic spike protection).
 */
export const checkSpike = internalMutation({
  args: { projectId: v.id('projects'), increment: v.number(), threshold: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { projectId, increment, threshold }) => {
    const windowStart = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
    const existing = await ctx.db
      .query('spikeWindows')
      .withIndex('by_project_window', (q) =>
        q.eq('projectId', projectId).eq('windowStart', windowStart),
      )
      .first();
    const before = existing?.count ?? 0;
    if (existing) await ctx.db.patch(existing._id, { count: before + increment });
    else await ctx.db.insert('spikeWindows', { projectId, windowStart, count: increment });
    return before >= threshold;
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
