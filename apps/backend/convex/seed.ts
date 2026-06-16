import { v } from 'convex/values';
import {
  buildFlamegraph,
  discoverAggregate,
  mergeHistograms,
  percentileFromHistogram,
  suspectCommits,
} from '@sveltry/protocol';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { resolveActiveOrg } from './lib/auth';
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

/** Set a project's ingest limits bypassing auth, for verification. */
export const seedProjectLimits = internalMutation({
  args: {
    projectId: v.id('projects'),
    monthlyEventQuota: v.optional(v.number()),
    spikeThresholdPerMinute: v.optional(v.number()),
  },
  handler: async (ctx, { projectId, monthlyEventQuota, spikeThresholdPerMinute }) => {
    await ctx.db.patch(projectId, { monthlyEventQuota, spikeThresholdPerMinute });
  },
});

/** Merge two issues bypassing auth, for verification (mirrors issues.mergeIssues). */
export const debugMerge = internalMutation({
  args: { sourceIssueId: v.id('issues'), targetIssueId: v.id('issues') },
  handler: async (ctx, { sourceIssueId, targetIssueId }) => {
    const source = await ctx.db.get(sourceIssueId);
    const target = await ctx.db.get(targetIssueId);
    if (!source || !target) throw new Error('not found');
    const events = await ctx.db
      .query('events')
      .withIndex('by_issue', (q) => q.eq('issueId', sourceIssueId))
      .take(2000);
    for (const e of events) await ctx.db.patch(e._id, { issueId: targetIssueId });
    await ctx.db.patch(targetIssueId, {
      count: target.count + source.count,
      userCount: target.userCount + source.userCount,
    });
    await ctx.db.delete(sourceIssueId);
    return { movedEvents: events.length };
  },
});

/** Usage totals + deploy count for a project, for verification. */
export const debugUsage = internalQuery({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const usage = await ctx.db
      .query('usageDaily')
      .withIndex('by_project_day', (q) => q.eq('projectId', projectId))
      .collect();
    const deploys = await ctx.db
      .query('deploys')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    return {
      events: usage.reduce((s, r) => s + r.eventCount, 0),
      transactions: usage.reduce((s, r) => s + r.transactionCount, 0),
      dropped: usage.reduce((s, r) => s + r.droppedCount, 0),
      deploys: deploys.map((d) => ({ release: d.release, environment: d.environment })),
    };
  },
});

/** Web Vitals p75 + trace size, for verification (mirrors the auth'd queries). */
export const debugVitalsAndTrace = internalQuery({
  args: { organizationId: v.string(), traceId: v.string() },
  handler: async (ctx, { organizationId, traceId }) => {
    const recent = await ctx.db
      .query('transactions')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .take(1000);
    const samples: Record<string, number[]> = {};
    for (const t of recent) {
      const m = (t.payload as { measurements?: Record<string, { value?: number }> }).measurements;
      if (!m) continue;
      for (const k of ['lcp', 'cls', 'inp']) {
        const v = m[k]?.value;
        if (typeof v === 'number') (samples[k] ??= []).push(v);
      }
    }
    const p75 = (a: number[]) => {
      a.sort((x, y) => x - y);
      return a.length ? a[Math.min(a.length - 1, Math.ceil(0.75 * a.length) - 1)] : 0;
    };
    const traceTxns = await ctx.db
      .query('transactions')
      .withIndex('by_trace', (q) => q.eq('traceId', traceId))
      .take(50);
    return {
      vitals: Object.fromEntries(Object.entries(samples).map(([k, a]) => [k, p75(a)])),
      traceCount: traceTxns.length,
    };
  },
});

/** Insert a metric alert bypassing auth, for verification. */
export const seedMetricAlert = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    metric: v.union(
      v.literal('p95_latency'),
      v.literal('error_count'),
      v.literal('crash_free_rate'),
    ),
    threshold: v.number(),
    transactionName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert('metricAlerts', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      name: 'Test alert',
      metric: args.metric,
      transactionName: args.transactionName,
      windowMinutes: 60,
      threshold: args.threshold,
      channels: [{ type: 'webhook', target: 'http://localhost:59999/unreachable' }],
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

/** Metric alerts for an org, for metric-alert verification. */
export const debugMetricAlerts = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const rows = await ctx.db
      .query('metricAlerts')
      .filter((q) => q.eq(q.field('organizationId'), organizationId))
      .take(20);
    return rows.map((a) => ({
      metric: a.metric,
      threshold: a.threshold,
      lastValue: a.lastValue,
      fired: a.lastFiredAt != null,
    }));
  },
});

/** Roundtrip a saved view (insert, read via by_org index, delete) for verification. */
export const debugSavedViews = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const id = await ctx.db.insert('savedViews', {
      organizationId,
      userId: 'debug-user',
      name: 'Fatal errors',
      query: 'TypeError',
      status: 'unresolved',
      level: 'fatal',
      createdAt: Date.now(),
    });
    const listed = await ctx.db
      .query('savedViews')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .order('asc')
      .take(100);
    const found = listed.find((v) => v._id === id);
    await ctx.db.delete(id);
    return {
      inserted: id,
      count: listed.length,
      roundtrip: found ? { name: found.name, level: found.level, query: found.query } : null,
      deletedOk: (await ctx.db.get(id)) === null,
    };
  },
});

// ---------------------------------------------------------------------------
// Debug-ID source map resolution: end-to-end runtime check. Stores a real source
// map (with a `debugId`), records it with NO release, ingests an event whose
// `debug_meta` references that debug id, runs the resolver, and reports whether
// the minified frame was rewritten to original source. Proves debug-id matching
// works independent of release name.
// ---------------------------------------------------------------------------

const DEBUG_ID_SCENARIO = '11111111-2222-3333-4444-555566667777';

// A minimal valid source map. `mappings: 'AACA'` maps generated line 1 col 0 to
// original source 0, line 2 (the `throw`), col 0.
const DEBUG_SOURCEMAP = {
  version: 3,
  sources: ['src/app.ts'],
  sourcesContent: ["export function boom() {\n  throw new Error('boom');\n}\nboom();\n"],
  names: [],
  mappings: 'AACA',
  debugId: DEBUG_ID_SCENARIO,
};

export const seedDebugIdScenario = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, { organizationId, projectId, storageId }) => {
    const now = Date.now();
    const artifactId = await ctx.db.insert('releaseArtifacts', {
      organizationId,
      projectId,
      release: '', // deliberately no release: debug id must match on its own
      name: 'app.min.js.map',
      kind: 'sourcemap',
      storageId,
      size: 256,
      debugId: DEBUG_ID_SCENARIO,
      createdAt: now,
    });
    const issueId = await ctx.db.insert('issues', {
      organizationId,
      projectId,
      fingerprint: `debugid-${now}`,
      groupingConfig: 'debug',
      title: 'Error: boom',
      culprit: 'app.min.js',
      level: 'error',
      platform: 'javascript',
      status: 'unresolved',
      substatus: 'new',
      count: 1,
      userCount: 0,
      firstSeen: now,
      lastSeen: now,
    });
    const eventDocId = await ctx.db.insert('events', {
      organizationId,
      projectId,
      issueId,
      eventId: `${now}`,
      timestamp: now,
      receivedAt: now,
      level: 'error',
      platform: 'javascript',
      environment: 'production',
      // release intentionally omitted
      message: 'Error: boom',
      culprit: 'app.min.js',
      tags: {},
      payload: {
        platform: 'javascript',
        exception: {
          values: [
            {
              type: 'Error',
              value: 'boom',
              stacktrace: {
                frames: [{ abs_path: 'https://cdn.example.com/app.min.js', lineno: 1, colno: 42 }],
              },
            },
          ],
        },
        debug_meta: {
          images: [
            {
              type: 'sourcemap',
              code_file: 'https://cdn.example.com/app.min.js',
              debug_id: DEBUG_ID_SCENARIO,
            },
          ],
        },
      },
    });
    return { artifactId, issueId, eventDocId };
  },
});

export const debugEventResolved = internalQuery({
  args: { eventDocId: v.id('events') },
  handler: async (ctx, { eventDocId }) => {
    const event = await ctx.db.get(eventDocId);
    if (!event) return null;
    const payload = event.payload as {
      exception?: { values?: { stacktrace?: { frames?: Record<string, unknown>[] } }[] };
    };
    const frame = payload.exception?.values?.[0]?.stacktrace?.frames?.[0] ?? null;
    return {
      resolved: event.resolved === true,
      frame: frame
        ? {
            filename: frame.filename,
            lineno: frame.lineno,
            context_line: frame.context_line,
            sveltry_resolved: frame.sveltry_resolved,
          }
        : null,
    };
  },
});

export const cleanupDebugIdScenario = internalMutation({
  args: {
    artifactId: v.id('releaseArtifacts'),
    issueId: v.id('issues'),
    eventDocId: v.id('events'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, { artifactId, issueId, eventDocId, storageId }) => {
    await ctx.db.delete(eventDocId);
    await ctx.db.delete(issueId);
    await ctx.db.delete(artifactId);
    await ctx.storage.delete(storageId);
  },
});

/** Orchestrate the debug-id resolution roundtrip and return the resolved frame. */
export const debugResolveByDebugId = internalAction({
  args: { organizationId: v.string(), projectId: v.id('projects') },
  handler: async (
    ctx,
    { organizationId, projectId },
  ): Promise<{
    resolved: boolean;
    frame: Record<string, unknown> | null;
  }> => {
    const storageId = await ctx.storage.store(
      new Blob([JSON.stringify(DEBUG_SOURCEMAP)], { type: 'application/json' }),
    );
    const { artifactId, issueId, eventDocId } = await ctx.runMutation(
      internal.seed.seedDebugIdScenario,
      { organizationId, projectId, storageId },
    );
    await ctx.runAction(internal.sourcemaps.resolveEvent, { eventDocId });
    const result = await ctx.runQuery(internal.seed.debugEventResolved, { eventDocId });
    await ctx.runMutation(internal.seed.cleanupDebugIdScenario, {
      artifactId,
      issueId,
      eventDocId,
      storageId,
    });
    return result ?? { resolved: false, frame: null };
  },
});

/** Find the first project for an org, for debug helpers that need a project id. */
export const debugFirstProject = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const project = await ctx.db
      .query('projects')
      .filter((q) => q.eq(q.field('organizationId'), organizationId))
      .first();
    return project ? { projectId: project._id as Id<'projects'>, slug: project.slug } : null;
  },
});

/**
 * Set up two issues with events, merge them, then unmerge, and report the state at
 * each step. Mirrors the mergeIssues/unmergeIssue mutation bodies (which require a
 * JWT) so the merge arithmetic and event reassignment can be verified end to end.
 */
export const debugMergeUnmerge = internalMutation({
  args: { organizationId: v.string(), projectId: v.id('projects') },
  handler: async (ctx, { organizationId, projectId }) => {
    const now = Date.now();
    const mkIssue = (fp: string, title: string) =>
      ctx.db.insert('issues', {
        organizationId,
        projectId,
        fingerprint: fp,
        groupingConfig: 'debug',
        title,
        culprit: 'x',
        level: 'error' as const,
        platform: 'javascript',
        status: 'unresolved' as const,
        substatus: 'new' as const,
        count: 0,
        userCount: 0,
        firstSeen: now,
        lastSeen: now,
      });
    const mkEvent = (issueId: Id<'issues'>, ts: number) =>
      ctx.db.insert('events', {
        organizationId,
        projectId,
        issueId,
        eventId: `${ts}-${Math.floor(ts % 1000)}`,
        timestamp: ts,
        receivedAt: ts,
        level: 'error' as const,
        platform: 'javascript',
        environment: 'production',
        message: 'x',
        culprit: 'x',
        tags: {},
        payload: {},
      });

    const targetId = await mkIssue(`t-${now}`, 'Target');
    const sourceId = await mkIssue(`s-${now}`, 'Source');
    for (let i = 0; i < 3; i++) await mkEvent(targetId, now + i);
    for (let i = 0; i < 2; i++) await mkEvent(sourceId, now + 10 + i);
    await ctx.db.patch(targetId, { count: 3 });
    await ctx.db.patch(sourceId, { count: 2 });

    // --- merge (mirror mergeIssues) ---
    const source = (await ctx.db.get(sourceId))!;
    const target = (await ctx.db.get(targetId))!;
    const moved = await ctx.db
      .query('events')
      .withIndex('by_issue', (q) => q.eq('issueId', sourceId))
      .collect();
    for (const e of moved) await ctx.db.patch(e._id, { issueId: targetId });
    await ctx.db.patch(targetId, { count: target.count + source.count });
    const mergeId = await ctx.db.insert('issueMerges', {
      organizationId,
      projectId,
      targetIssueId: targetId,
      source: {
        fingerprint: source.fingerprint,
        groupingConfig: source.groupingConfig,
        title: source.title,
        culprit: source.culprit,
        level: source.level,
        platform: source.platform,
        errorType: source.errorType,
        firstSeen: source.firstSeen,
        count: source.count,
        userCount: source.userCount,
      },
      movedEventIds: moved.map((e) => e._id),
      mergedAt: now,
    });
    await ctx.db.delete(sourceId);
    const afterMerge = {
      targetCount: (await ctx.db.get(targetId))!.count,
      sourceDeleted: (await ctx.db.get(sourceId)) === null,
      targetEventCount: (
        await ctx.db
          .query('events')
          .withIndex('by_issue', (q) => q.eq('issueId', targetId))
          .collect()
      ).length,
    };

    // --- unmerge (mirror unmergeIssue) ---
    const m = (await ctx.db.get(mergeId))!;
    const s = m.source;
    const newIssueId = await ctx.db.insert('issues', {
      organizationId,
      projectId,
      fingerprint: s.fingerprint,
      groupingConfig: s.groupingConfig,
      title: s.title,
      culprit: s.culprit,
      level: s.level,
      platform: s.platform,
      status: 'unresolved',
      substatus: 'ongoing',
      count: 0,
      userCount: 0,
      firstSeen: s.firstSeen,
      lastSeen: s.firstSeen,
      errorType: s.errorType,
    });
    let movedBack = 0;
    for (const eid of m.movedEventIds) {
      const ev = await ctx.db.get(eid);
      if (!ev || ev.issueId !== m.targetIssueId) continue;
      await ctx.db.patch(eid, { issueId: newIssueId });
      movedBack += 1;
    }
    await ctx.db.patch(newIssueId, { count: movedBack });
    const tnow = await ctx.db.get(targetId);
    if (tnow) await ctx.db.patch(targetId, { count: Math.max(0, tnow.count - movedBack) });
    await ctx.db.delete(mergeId);

    const afterUnmerge = {
      newIssueCount: (await ctx.db.get(newIssueId))!.count,
      targetCount: (await ctx.db.get(targetId))!.count,
      newIssueEventCount: (
        await ctx.db
          .query('events')
          .withIndex('by_issue', (q) => q.eq('issueId', newIssueId))
          .collect()
      ).length,
    };

    // --- cleanup ---
    for (const id of [targetId, newIssueId]) {
      const evs = await ctx.db
        .query('events')
        .withIndex('by_issue', (q) => q.eq('issueId', id))
        .collect();
      for (const e of evs) await ctx.db.delete(e._id);
      await ctx.db.delete(id);
    }

    return {
      afterMerge,
      afterUnmerge,
      movedBack,
      ok:
        afterMerge.targetCount === 5 &&
        afterMerge.sourceDeleted &&
        afterMerge.targetEventCount === 5 &&
        movedBack === 2 &&
        afterUnmerge.newIssueCount === 2 &&
        afterUnmerge.targetCount === 3 &&
        afterUnmerge.newIssueEventCount === 2,
    };
  },
});

/**
 * Exercise the teams flow: create a team, add a member, assign a project, read the
 * aggregation back, then detach + clean up. Mirrors the teams mutations (which
 * require a JWT) to verify membership and project-assignment plumbing end to end.
 */
export const debugTeams = internalMutation({
  args: { organizationId: v.string(), projectId: v.id('projects') },
  handler: async (ctx, { organizationId, projectId }) => {
    const now = Date.now();
    const teamId = await ctx.db.insert('teams', {
      organizationId,
      name: 'Platform',
      slug: 'platform',
      createdAt: now,
    });
    const memberId = await ctx.db.insert('teamMembers', {
      organizationId,
      teamId,
      userId: 'debug-user',
      email: 'dev@x.io',
      addedAt: now,
    });
    await ctx.db.patch(projectId, { teamId });

    // Read back the way listTeams does.
    const members = await ctx.db
      .query('teamMembers')
      .withIndex('by_team', (q) => q.eq('teamId', teamId))
      .collect();
    const projects = await ctx.db
      .query('projects')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .filter((q) => q.eq(q.field('teamId'), teamId))
      .collect();
    const dedup = await ctx.db
      .query('teamMembers')
      .withIndex('by_team_user', (q) => q.eq('teamId', teamId).eq('userId', 'debug-user'))
      .first();

    const result = {
      memberCount: members.length,
      projectCount: projects.length,
      projectAssigned: projects.some((p) => p._id === projectId),
      dedupFound: dedup?._id === memberId,
    };

    // Cleanup: detach project, drop member + team.
    await ctx.db.patch(projectId, { teamId: undefined });
    await ctx.db.delete(memberId);
    await ctx.db.delete(teamId);
    const projAfter = await ctx.db.get(projectId);

    return {
      ...result,
      detachedOnCleanup: projAfter?.teamId === undefined,
      ok:
        result.memberCount === 1 &&
        result.projectCount === 1 &&
        result.projectAssigned &&
        result.dedupFound &&
        projAfter?.teamId === undefined,
    };
  },
});

/**
 * Verify role resolution (the DB-dependent part of `roleFor`) and the owner guards
 * against real rows: bootstrap (empty org -> owner), default (assigned org -> member
 * for the unassigned), explicit lookup, and the last-owner / owner-only checks.
 */
export const debugRoles = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const RANK = { owner: 3, admin: 2, member: 1, billing: 0 } as const;
    // Mirror roleFor's reads.
    const resolve = async (userId: string): Promise<keyof typeof RANK> => {
      const row = await ctx.db
        .query('memberRoles')
        .withIndex('by_org_user', (q) =>
          q.eq('organizationId', organizationId).eq('userId', userId),
        )
        .first();
      if (row) return row.role;
      const any = await ctx.db
        .query('memberRoles')
        .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
        .first();
      return any ? 'member' : 'owner';
    };

    // Start from a clean slate for this throwaway org.
    for (const r of await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .collect())
      await ctx.db.delete(r._id);

    const bootstrap = await resolve('anyone'); // no rows -> owner

    await ctx.db.insert('memberRoles', {
      organizationId,
      userId: 'alice',
      role: 'owner',
      updatedAt: Date.now(),
    });
    const aliceRole = await resolve('alice'); // explicit -> owner
    const strangerRole = await resolve('bob'); // assigned org, unassigned -> member

    // Last-owner guard: demoting alice (only owner) should be blocked.
    const owners1 = await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .filter((q) => q.eq(q.field('role'), 'owner'))
      .collect();
    const lastOwnerBlocked = owners1.length <= 1;

    // Add a second owner; now demotion is allowed.
    await ctx.db.insert('memberRoles', {
      organizationId,
      userId: 'bob',
      role: 'owner',
      updatedAt: Date.now(),
    });
    const owners2 = await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .filter((q) => q.eq(q.field('role'), 'owner'))
      .collect();
    const demoteAllowedNow = owners2.length > 1;

    // owner-only guard logic: an admin caller cannot touch the owner role.
    const adminTouchesOwner = RANK['admin'] < RANK['owner']; // admin < owner -> would be blocked

    // Cleanup.
    for (const r of await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .collect())
      await ctx.db.delete(r._id);

    return {
      bootstrap,
      aliceRole,
      strangerRole,
      lastOwnerBlocked,
      demoteAllowedNow,
      adminTouchesOwner,
      ok:
        bootstrap === 'owner' &&
        aliceRole === 'owner' &&
        strangerRole === 'member' &&
        lastOwnerBlocked &&
        demoteAllowedNow &&
        adminTouchesOwner,
    };
  },
});

/**
 * Seed a few events + transactions, run the Discover gather/map/aggregate path over
 * them (the same logic as runDiscover), assert the grouped results, and clean up.
 */
export const debugDiscover = internalMutation({
  args: { organizationId: v.string(), projectId: v.id('projects') },
  handler: async (ctx, { organizationId, projectId }) => {
    const now = Date.now();
    const eventIds: Id<'events'>[] = [];
    const txnIds: Id<'transactions'>[] = [];

    const issueId = await ctx.db.insert('issues', {
      organizationId,
      projectId,
      fingerprint: `disc-${now}`,
      groupingConfig: 'debug',
      title: 'disc',
      culprit: 'c',
      level: 'error',
      platform: 'javascript',
      status: 'unresolved',
      substatus: 'new',
      count: 0,
      userCount: 0,
      firstSeen: now,
      lastSeen: now,
    });

    const mkEvent = async (level: 'error' | 'warning', user: string) => {
      eventIds.push(
        await ctx.db.insert('events', {
          organizationId,
          projectId,
          issueId,
          eventId: `disc-${now}-${eventIds.length}`,
          timestamp: now,
          receivedAt: now,
          level,
          platform: 'javascript',
          environment: 'production',
          message: 'm',
          culprit: 'c',
          tags: {},
          payload: { user: { id: user } },
        }),
      );
    };
    const mkTxn = async (name: string, durationMs: number) => {
      const transactionId = await ctx.db.insert('transactions', {
        organizationId,
        projectId,
        eventId: `disct-${now}-${txnIds.length}`,
        traceId: 't',
        spanId: 's',
        name,
        op: 'http.server',
        status: 'ok',
        timestamp: now,
        endTimestamp: now + durationMs,
        durationMs,
        platform: 'javascript',
        environment: 'production',
        tags: {},
        spanCount: 1,
        payload: {},
      });
      // Keep the lean projection in sync with the demo transactions.
      await ctx.db.insert('transactionsMeta', {
        organizationId,
        projectId,
        transactionId,
        name,
        op: 'http.server',
        status: 'ok',
        durationMs,
        timestamp: now,
        platform: 'javascript',
        environment: 'production',
        spanCount: 1,
      });
      txnIds.push(transactionId);
    };

    await mkEvent('error', 'u1');
    await mkEvent('error', 'u2');
    await mkEvent('warning', 'u1');
    await mkTxn('GET /a', 100);
    await mkTxn('GET /a', 300);
    await mkTxn('GET /b', 1000);

    const since = now - HOUR_MS;
    const events = await ctx.db
      .query('events')
      .withIndex('by_project', (q) => q.eq('projectId', projectId).gte('timestamp', since))
      .take(10000);
    const txns = await ctx.db
      .query('transactions')
      .withIndex('by_project', (q) => q.eq('projectId', projectId).gte('timestamp', since))
      .take(10000);

    const ourEvents = events.filter((e) => e.eventId.startsWith('disc-'));
    const ourTxns = txns.filter((t) => t.eventId.startsWith('disct-'));

    const levelCount = discoverAggregate(
      ourEvents.map((e) => ({ group: e.level })),
      'count',
    );
    const levelUsers = discoverAggregate(
      ourEvents.map((e) => ({
        group: e.level,
        user: (e.payload as { user?: { id?: string } }).user?.id,
      })),
      'users',
    );
    const txnP95 = discoverAggregate(
      ourTxns.map((t) => ({ group: t.name, value: t.durationMs })),
      'p95',
    );

    // Cleanup.
    for (const id of eventIds) await ctx.db.delete(id);
    for (const id of txnIds) await ctx.db.delete(id);
    await ctx.db.delete(issueId);

    const error = levelCount.find((r) => r.group === 'error');
    const warning = levelCount.find((r) => r.group === 'warning');
    const errUsers = levelUsers.find((r) => r.group === 'error');
    const a95 = txnP95.find((r) => r.group === 'GET /a');
    const b95 = txnP95.find((r) => r.group === 'GET /b');

    return {
      levelCount,
      levelUsers,
      txnP95,
      ok:
        error?.value === 2 &&
        warning?.value === 1 &&
        errUsers?.value === 2 &&
        b95?.value === 1000 &&
        a95?.value === 290 &&
        txnP95[0]?.group === 'GET /b',
    };
  },
});

const HOUR_MS = 3_600_000;

/**
 * Exercise the Convex-native org model end to end: create an org (owner row +
 * active pointer), resolve the active org via the real resolveActiveOrg through all
 * three paths (userSettings, JWT-claim fallback, single-membership), and the
 * stale-pointer guard. Cleans up.
 */
export const debugOrgModel = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    const orgA = `dbgorg-a-${now}`;
    const orgB = `dbgorg-b-${now}`;
    const orgStale = `dbgorg-stale-${now}`;

    // createOrganization-equivalent for orgA (owner + active).
    await ctx.db.insert('organizations', {
      slug: orgA,
      name: 'A',
      createdBy: userId,
      createdAt: now,
    });
    await ctx.db.insert('memberRoles', {
      organizationId: orgA,
      userId,
      role: 'owner',
      updatedAt: now,
    });
    const settingsId = await ctx.db.insert('userSettings', {
      userId,
      activeOrganizationId: orgA,
    });

    // Path 1: userSettings + member -> orgA.
    const r1 = await resolveActiveOrg(ctx, userId, null);

    // Path 3 setup: a second membership; clear settings -> single-membership fallback
    // is ambiguous (2 orgs) so it returns null; with only orgB it returns orgB.
    await ctx.db.insert('organizations', {
      slug: orgB,
      name: 'B',
      createdBy: userId,
      createdAt: now,
    });
    await ctx.db.insert('memberRoles', {
      organizationId: orgB,
      userId,
      role: 'member',
      updatedAt: now,
    });

    // Stale pointer: point settings at an org the user is NOT in, that HAS another member.
    await ctx.db.insert('memberRoles', {
      organizationId: orgStale,
      userId: 'someone-else',
      role: 'owner',
      updatedAt: now,
    });
    await ctx.db.patch(settingsId, { activeOrganizationId: orgStale });
    // Stale -> ignored; jwtClaim used instead.
    const rStaleJwt = await resolveActiveOrg(ctx, userId, orgB);

    // Path 2: JWT-claim fallback when settings unset.
    await ctx.db.patch(settingsId, { activeOrganizationId: undefined });
    const r2 = await resolveActiveOrg(ctx, userId, 'jwt-org');

    // Two memberships, no settings, no claim -> ambiguous -> null.
    const rAmbiguous = await resolveActiveOrg(ctx, userId, null);

    // Cleanup.
    for (const row of await ctx.db
      .query('memberRoles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect())
      await ctx.db.delete(row._id);
    for (const slug of [orgA, orgB, orgStale]) {
      const o = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', slug))
        .first();
      if (o) await ctx.db.delete(o._id);
    }
    const stale = await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', orgStale))
      .first();
    if (stale) await ctx.db.delete(stale._id);
    await ctx.db.delete(settingsId);

    return {
      path1_userSettingsMember: r1,
      path2_jwtFallback: r2,
      staleIgnored_usesJwt: rStaleJwt,
      ambiguous_null: rAmbiguous,
      ok: r1 === orgA && r2 === 'jwt-org' && rStaleJwt === orgB && rAmbiguous === null,
    };
  },
});

/** Read an artifact's storage state, for the S3-offload roundtrip. */
export const debugArtifactState = internalQuery({
  args: { projectId: v.id('projects'), release: v.string(), name: v.string() },
  handler: async (ctx, { projectId, release, name }) => {
    const a = await ctx.db
      .query('releaseArtifacts')
      .withIndex('by_project_release_name', (q) =>
        q.eq('projectId', projectId).eq('release', release).eq('name', name),
      )
      .first();
    if (!a) return null;
    return {
      id: a._id,
      hasConvexBlob: a.storageId != null,
      s3Bucket: a.s3Bucket ?? null,
      s3Key: a.s3Key ?? null,
      size: a.size,
    };
  },
});

/** Seed an event referencing a debug id (its map is uploaded separately), for S3 read. */
export const seedEventForDebugId = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    debugId: v.string(),
    codeFile: v.string(),
  },
  handler: async (ctx, { organizationId, projectId, debugId, codeFile }) => {
    const now = Date.now();
    const issueId = await ctx.db.insert('issues', {
      organizationId,
      projectId,
      fingerprint: `s3-${now}`,
      groupingConfig: 'debug',
      title: 'Error: boom',
      culprit: codeFile,
      level: 'error',
      platform: 'javascript',
      status: 'unresolved',
      substatus: 'new',
      count: 1,
      userCount: 0,
      firstSeen: now,
      lastSeen: now,
    });
    const eventDocId = await ctx.db.insert('events', {
      organizationId,
      projectId,
      issueId,
      eventId: `s3-${now}`,
      timestamp: now,
      receivedAt: now,
      level: 'error',
      platform: 'javascript',
      environment: 'production',
      message: 'boom',
      culprit: codeFile,
      tags: {},
      payload: {
        platform: 'javascript',
        exception: {
          values: [
            {
              type: 'Error',
              value: 'boom',
              stacktrace: { frames: [{ abs_path: codeFile, lineno: 1, colno: 42 }] },
            },
          ],
        },
        debug_meta: { images: [{ type: 'sourcemap', code_file: codeFile, debug_id: debugId }] },
      },
    });
    return { issueId, eventDocId };
  },
});

export const cleanupS3Scenario = internalMutation({
  args: {
    issueId: v.id('issues'),
    eventDocId: v.id('events'),
    projectId: v.id('projects'),
    release: v.string(),
    name: v.string(),
  },
  handler: async (ctx, { issueId, eventDocId, projectId, release, name }) => {
    await ctx.db.delete(eventDocId);
    await ctx.db.delete(issueId);
    const a = await ctx.db
      .query('releaseArtifacts')
      .withIndex('by_project_release_name', (q) =>
        q.eq('projectId', projectId).eq('release', release).eq('name', name),
      )
      .first();
    if (a) {
      if (a.storageId) await ctx.storage.delete(a.storageId);
      if (a.s3Bucket && a.s3Key)
        await ctx.scheduler.runAfter(0, internal.storage.deleteObject, {
          bucket: a.s3Bucket,
          key: a.s3Key,
        });
      await ctx.db.delete(a._id);
    }
  },
});

/** Insert a Jira tracker integration + a throwaway issue, for the delivery roundtrip. */
export const seedTrackerScenario = internalMutation({
  args: { organizationId: v.string(), projectId: v.id('projects'), siteUrl: v.string() },
  handler: async (ctx, { organizationId, projectId, siteUrl }) => {
    const now = Date.now();
    const integrationId = await ctx.db.insert('projectIntegrations', {
      organizationId,
      projectId,
      config: {
        type: 'jira',
        siteUrl,
        projectKey: 'OPS',
        email: 'dev@x.io',
        apiToken: 'tok',
        issueTypeName: 'Bug',
      },
      isEnabled: true,
      autoCreate: false,
      createdAt: now,
    });
    const issueId = await ctx.db.insert('issues', {
      organizationId,
      projectId,
      fingerprint: `tracker-${now}`,
      groupingConfig: 'debug',
      title: 'Boom',
      culprit: 'app.js',
      level: 'error',
      platform: 'javascript',
      status: 'unresolved',
      substatus: 'new',
      count: 3,
      userCount: 0,
      firstSeen: now,
      lastSeen: now,
    });
    return { integrationId, issueId };
  },
});

export const readIssueTracker = internalQuery({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) return null;
    return {
      provider: issue.trackerProvider ?? null,
      key: issue.trackerKey ?? null,
      url: issue.trackerUrl ?? null,
    };
  },
});

export const cleanupTrackerScenario = internalMutation({
  args: { integrationId: v.id('projectIntegrations'), issueId: v.id('issues') },
  handler: async (ctx, { integrationId, issueId }) => {
    await ctx.db.delete(integrationId);
    await ctx.db.delete(issueId);
  },
});

/** Exercise the dashboards CRUD: create, add widgets (ordering), remove, cascade-delete. */
export const debugDashboards = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const now = Date.now();
    const dashboardId = await ctx.db.insert('dashboards', {
      organizationId,
      name: 'Ops',
      createdBy: 'debug-user',
      createdAt: now,
    });
    const addWidget = async (title: string) => {
      const existing = await ctx.db
        .query('dashboardWidgets')
        .withIndex('by_dashboard', (q) => q.eq('dashboardId', dashboardId))
        .collect();
      const order = existing.reduce((max, w) => Math.max(max, w.order), -1) + 1;
      return ctx.db.insert('dashboardWidgets', {
        organizationId,
        dashboardId,
        title,
        dataset: 'errors' as const,
        groupBy: 'level',
        aggregate: 'count' as const,
        hours: 24,
        order,
      });
    };
    const w0 = await addWidget('A');
    const w1 = await addWidget('B');

    const ordered = (
      await ctx.db
        .query('dashboardWidgets')
        .withIndex('by_dashboard', (q) => q.eq('dashboardId', dashboardId))
        .collect()
    ).sort((a, b) => a.order - b.order);
    const orderingOk = ordered.length === 2 && ordered[0]!._id === w0 && ordered[1]!._id === w1;

    // Remove the first widget; the second remains.
    await ctx.db.delete(w0);
    const afterRemove = await ctx.db
      .query('dashboardWidgets')
      .withIndex('by_dashboard', (q) => q.eq('dashboardId', dashboardId))
      .collect();

    // Cascade-delete the dashboard.
    for (const w of afterRemove) await ctx.db.delete(w._id);
    await ctx.db.delete(dashboardId);
    const widgetsLeft = await ctx.db
      .query('dashboardWidgets')
      .withIndex('by_dashboard', (q) => q.eq('dashboardId', dashboardId))
      .collect();

    return {
      orderingOk,
      remainingAfterRemove: afterRemove.length,
      remainingAfterRemoveIsB: afterRemove.length === 1 && afterRemove[0]!._id === w1,
      cascadeClean: widgetsLeft.length === 0 && (await ctx.db.get(dashboardId)) === null,
      ok:
        orderingOk &&
        afterRemove.length === 1 &&
        afterRemove[0]!._id === w1 &&
        widgetsLeft.length === 0,
    };
  },
});

/** Run suspect-commit matching against stored release commits, for verification. */
export const debugSuspectCommits = internalQuery({
  args: { projectId: v.id('projects'), release: v.string(), files: v.array(v.string()) },
  handler: async (ctx, { projectId, release, files }) => {
    const commits = await ctx.db
      .query('releaseCommits')
      .withIndex('by_project_release', (q) => q.eq('projectId', projectId).eq('release', release))
      .collect();
    const suspects = suspectCommits(
      files,
      commits.map((c) => ({ commitId: c.commitId, timestamp: c.timestamp, files: c.files })),
    );
    const byId = new Map(commits.map((c) => [c.commitId, c.message]));
    return suspects.map((s) => ({
      commitId: s.commitId,
      file: s.file,
      message: byId.get(s.commitId),
    }));
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
