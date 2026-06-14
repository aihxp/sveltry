import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { generatePublicId, generatePublicKey, slugify } from './lib/slug';

/**
 * Local development / testing seed helpers. These are `internal` functions, so
 * they are NOT callable by dashboard clients; you invoke them with the admin
 * key via `bunx convex run seed:seedProject '{"organizationId":"demo"}'`.
 */

const DEFAULT_RETENTION_DAYS = 90;

/** Create a project + default DSN key for an organization, bypassing auth. */
export const seedProject = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
    platform: v.optional(v.string()),
  },
  returns: v.object({
    projectId: v.id('projects'),
    slug: v.string(),
    publicId: v.string(),
    publicKey: v.string(),
  }),
  handler: async (ctx, { organizationId, name, platform }) => {
    const now = Date.now();
    const displayName = name ?? 'Demo';

    const orgMirror = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', organizationId))
      .first();
    if (!orgMirror) {
      await ctx.db.insert('organizations', {
        slug: organizationId,
        name: organizationId,
        createdAt: now,
      });
    }

    const slug = slugify(displayName) + '-' + Math.floor(Math.random() * 9000 + 1000);
    const publicId = generatePublicId();
    const projectId = await ctx.db.insert('projects', {
      organizationId,
      slug,
      name: displayName,
      platform: platform ?? 'javascript',
      publicId,
      createdAt: now,
      eventRetentionDays: DEFAULT_RETENTION_DAYS,
      scrubPii: true,
    });

    const publicKey = generatePublicKey();
    await ctx.db.insert('projectKeys', {
      projectId,
      organizationId,
      label: 'Default',
      publicKey,
      isActive: true,
      createdAt: now,
    });

    return { projectId, slug, publicId, publicKey };
  },
});

/** The latest event's resolution state and top frames, for source-map verification. */
export const debugEventFrames = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const event = await ctx.db
      .query('events')
      .filter((q) => q.eq(q.field('organizationId'), organizationId))
      .order('desc')
      .first();
    if (!event) return null;
    const ex = (event.payload as { exception?: { values?: unknown[] } | unknown[] }).exception;
    const values = (Array.isArray(ex) ? ex : (ex?.values ?? [])) as Array<{
      stacktrace?: {
        frames?: Array<{
          filename?: string;
          function?: string;
          lineno?: number;
          colno?: number;
          context_line?: string;
          sveltry_resolved?: boolean;
        }>;
      };
    }>;
    const frames = (values[0]?.stacktrace?.frames ?? []) as Array<{
      filename?: string;
      abs_path?: string;
      function?: string;
      lineno?: number;
      colno?: number;
      context_line?: string;
      sveltry_resolved?: boolean;
    }>;
    return {
      eventDocId: event._id,
      resolved: event.resolved ?? false,
      release: event.release,
      frames: frames.map((f) => ({
        filename: f.filename,
        abs_path: f.abs_path,
        function: f.function,
        lineno: f.lineno,
        colno: f.colno,
        resolved: f.sveltry_resolved ?? false,
        context_line: f.context_line,
      })),
    };
  },
});

/** Recent transactions for an org, for performance-ingest verification. */
export const debugTransactions = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const txns = await ctx.db
      .query('transactions')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .take(20);
    return {
      count: txns.length,
      transactions: txns.map((t) => ({
        name: t.name,
        op: t.op,
        status: t.status,
        durationMs: t.durationMs,
        spanCount: t.spanCount,
        traceId: t.traceId,
      })),
    };
  },
});

/** Raw sessions for an org, for release-health verification. */
export const debugSessions = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const rows = await ctx.db
      .query('sessions')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .take(50);
    return {
      count: rows.length,
      sessions: rows.map((s) => ({
        sid: s.sid,
        did: s.did,
        status: s.status,
        release: s.release,
        errors: s.errors,
      })),
    };
  },
});

/** Combined release health (individual sessions + aggregate buckets) for verification. */
export const debugReleaseHealth = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const out = new Map<string, { sessions: number; crashed: number }>();
    const add = (release: string, sessions: number, crashed: number) => {
      const g = out.get(release) ?? { sessions: 0, crashed: 0 };
      g.sessions += sessions;
      g.crashed += crashed;
      out.set(release, g);
    };
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .take(5000);
    for (const s of sessions) add(s.release || '(none)', 1, s.status === 'crashed' ? 1 : 0);
    const buckets = await ctx.db
      .query('sessionBuckets')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .take(5000);
    for (const b of buckets)
      add(b.release || '(none)', b.exited + b.errored + b.crashed + b.abnormal, b.crashed);
    return [...out.entries()].map(([release, g]) => ({
      release,
      sessions: g.sessions,
      crashed: g.crashed,
      crashFree: g.sessions > 0 ? (g.sessions - g.crashed) / g.sessions : 1,
    }));
  },
});

/** Monitors + check-in counts for an org, for cron-monitor verification. */
export const debugMonitors = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const monitors = await ctx.db
      .query('monitors')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .take(50);
    const result = [];
    for (const m of monitors) {
      const checkIns = await ctx.db
        .query('checkIns')
        .withIndex('by_monitor', (q) => q.eq('projectId', m.projectId).eq('monitorSlug', m.slug))
        .collect();
      result.push({
        slug: m.slug,
        latestStatus: m.latestStatus,
        lastDurationMs: m.lastDurationMs,
        checkInCount: checkIns.length,
      });
    }
    return result;
  },
});

/** Counts + the most recent issue for an org, for verification. */
export const debugSummary = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const issues = await ctx.db
      .query('issues')
      .withIndex('by_org_status_lastSeen', (q) =>
        q.eq('organizationId', organizationId).eq('status', 'unresolved'),
      )
      .take(100);
    const events = await ctx.db
      .query('events')
      .filter((q) => q.eq(q.field('organizationId'), organizationId))
      .take(100);
    return {
      issueCount: issues.length,
      eventCount: events.length,
      issues: issues.map((i) => ({
        id: i._id,
        title: i.title,
        culprit: i.culprit,
        count: i.count,
        fingerprint: i.fingerprint,
        status: i.status,
        substatus: i.substatus,
      })),
    };
  },
});
