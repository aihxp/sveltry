import { v } from 'convex/values';
import { buildFlamegraph, mergeHistograms, percentileFromHistogram } from '@sveltry/protocol';
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

/** Replays + recording URLs for an org, for session-replay verification. */
export const debugReplays = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const replays = await ctx.db
      .query('replays')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .take(10);
    const out = [];
    for (const r of replays) {
      const segs = await ctx.db
        .query('replaySegments')
        .withIndex('by_replay', (q) => q.eq('projectId', r.projectId).eq('replayId', r.replayId))
        .collect();
      const urls = await Promise.all(segs.map((s) => ctx.storage.getUrl(s.storageId)));
      out.push({
        replayId: r.replayId,
        segmentCount: r.segmentCount,
        url: r.url,
        errorCount: r.errorCount,
        recordingUrls: urls.filter((u): u is string => u !== null),
      });
    }
    return out;
  },
});

/** Profiles + computed flamegraph tops for an org, for profiling verification. */
export const debugProfiles = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const profs = await ctx.db
      .query('profiles')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .take(5);
    return profs.map((p) => {
      const flame = buildFlamegraph((p.payload as { profile?: unknown }).profile as never, {
        minFraction: 0,
      });
      return {
        transactionName: p.transactionName,
        sampleCount: p.sampleCount,
        durationMs: p.durationMs,
        flameValue: flame.value,
        topChild: flame.children[0]
          ? { name: flame.children[0].name, value: flame.children[0].value }
          : null,
      };
    });
  },
});

/** Latency trend from rollups for an org, for time-series verification. */
export const debugTrend = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const rollups = await ctx.db
      .query('transactionRollups')
      .withIndex('by_org_bucket', (q) => q.eq('organizationId', organizationId))
      .collect();
    const buckets = new Map<number, number[][]>();
    const counts = new Map<number, number>();
    for (const r of rollups) {
      const list = buckets.get(r.bucketStart) ?? [];
      list.push(r.histogram);
      buckets.set(r.bucketStart, list);
      counts.set(r.bucketStart, (counts.get(r.bucketStart) ?? 0) + r.count);
    }
    return [...buckets.entries()].map(([bucketStart, histos]) => {
      const merged = mergeHistograms(histos);
      return {
        bucketStart,
        count: counts.get(bucketStart) ?? 0,
        p50Ms: percentileFromHistogram(merged, 50),
        p95Ms: percentileFromHistogram(merged, 95),
      };
    });
  },
});

/** Full-text issue search, for verifying the search index. */
export const debugSearch = internalQuery({
  args: { organizationId: v.string(), term: v.string() },
  handler: async (ctx, { organizationId, term }) => {
    const issues = await ctx.db
      .query('issues')
      .withSearchIndex('search_title', (s) =>
        s.search('title', term).eq('organizationId', organizationId),
      )
      .take(10);
    return issues.map((i) => ({ title: i.title, level: i.level, status: i.status }));
  },
});

/** Insert an uptime monitor bypassing auth, for verification. */
export const seedUptimeMonitor = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    url: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert('uptimeMonitors', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      slug: args.slug,
      url: args.url,
      method: 'GET',
      expectedStatus: 200,
      intervalSeconds: 60,
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

/** Attachments + feedback for an org, for ingestion-completeness verification. */
export const debugFeedback = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const fb = await ctx.db
      .query('feedback')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .collect();
    const att = await ctx.db
      .query('attachments')
      .filter((q) => q.eq(q.field('organizationId'), organizationId))
      .take(50);
    return {
      feedback: fb.map((f) => ({ name: f.name, email: f.email, message: f.message })),
      attachments: att.map((a) => ({ filename: a.filename, size: a.size, eventId: a.eventId })),
    };
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
