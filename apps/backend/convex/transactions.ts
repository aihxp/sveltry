import { v } from 'convex/values';
import { mergeHistograms, percentileFromHistogram } from '@sveltry/protocol';
import { query } from './_generated/server';
import { requireOrg } from './lib/auth';

const HOUR_MS = 60 * 60 * 1000;

/** Nearest-rank percentile of a numbers array sorted ascending. */
function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return sortedAsc[idx]!;
}

const STATS_SAMPLE = 2000;
const RECENT_LIMIT = 50;
const SPAN_SAMPLE = 1000;

// Performance-issue detector thresholds (recent-window approximation, no
// persistence). N+1 values match the per-transaction detector on the
// transaction detail page.
const N1_THRESHOLD = 4;
const N1_CATEGORIES = new Set(['db', 'cache']);
const SLOW_DB_MS = 1000;
const SLOW_HTTP_MS = 3000;
const ISSUES_CAP = 100;

/** Sentry span timestamps are unix seconds (floats); normalize to ms. */
function spanMs(ts: unknown): number | null {
  if (typeof ts !== 'number') return null;
  return ts > 1e12 ? ts : ts * 1000;
}

interface RawSpan {
  op?: unknown;
  description?: unknown;
  start_timestamp?: unknown;
  timestamp?: unknown;
}

/**
 * Cross-transaction "slowest operations": flattens the spans of the most recent
 * {@link SPAN_SAMPLE} transactions, groups them by (op, description), and ranks by
 * total time spent, so you can see which database queries / HTTP calls / etc. cost
 * the most across the app. A recent-window approximation (no columnar store yet).
 */
export const spanOperations = query({
  args: { category: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { category, limit }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const recent = await ctx.db
      .query('transactions')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(SPAN_SAMPLE);

    const groups = new Map<string, { op: string; description: string; durations: number[] }>();
    for (const t of recent) {
      const spans = ((t.payload as { spans?: RawSpan[] } | null)?.spans ?? []) as RawSpan[];
      for (const s of spans) {
        const op = typeof s.op === 'string' ? s.op : 'other';
        const start = spanMs(s.start_timestamp);
        const end = spanMs(s.timestamp);
        if (start == null || end == null) continue;
        const description = typeof s.description === 'string' ? s.description : '';
        const key = `${op}\n${description}`;
        let g = groups.get(key);
        if (!g) {
          g = { op, description, durations: [] };
          groups.set(key, g);
        }
        g.durations.push(Math.max(0, end - start));
      }
    }

    // Categories across all spans (for the filter UI), independent of the filter.
    const categories = [...new Set([...groups.values()].map((g) => g.op.split('.')[0] || 'other'))]
      .sort()
      .slice(0, 30);

    const rows = [...groups.values()]
      .filter((g) => !category || (g.op.split('.')[0] || 'other') === category)
      .map((g) => {
        const sorted = g.durations.slice().sort((a, b) => a - b);
        const sum = sorted.reduce((acc, d) => acc + d, 0);
        return {
          op: g.op,
          description: g.description,
          count: sorted.length,
          totalMs: Math.round(sum),
          avgMs: Math.round(sum / sorted.length),
          p95Ms: Math.round(percentile(sorted, 95)),
          maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
        };
      })
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, Math.min(100, Math.max(1, limit ?? 50)));

    return { sampleSize: recent.length, categories, rows };
  },
});

/**
 * Trace explorer / span search: finds individual spans across the most recent
 * {@link SPAN_SAMPLE} transactions whose op or description contains a (case-
 * insensitive) substring, ranked by span duration. Drills down from the
 * "slowest operations" view to the specific transactions running a given query
 * or call. A recent-window approximation (no columnar store yet).
 */
export const spanSearch = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { query: search, limit }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) {
      return { sampleSize: 0, total: 0, matches: [] };
    }

    const recent = await ctx.db
      .query('transactions')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(SPAN_SAMPLE);

    const cap = Math.min(200, Math.max(1, limit ?? 50));
    const matches: {
      transactionId: string;
      transactionName: string;
      op: string;
      description: string;
      spanDurationMs: number;
      timestamp: number;
    }[] = [];

    for (const t of recent) {
      const spans = ((t.payload as { spans?: RawSpan[] } | null)?.spans ?? []) as RawSpan[];
      for (const s of spans) {
        const op = typeof s.op === 'string' ? s.op : 'other';
        const description = typeof s.description === 'string' ? s.description : '';
        if (!op.toLowerCase().includes(needle) && !description.toLowerCase().includes(needle)) {
          continue;
        }
        const start = spanMs(s.start_timestamp);
        const end = spanMs(s.timestamp);
        if (start == null || end == null) continue;
        matches.push({
          transactionId: t._id,
          transactionName: t.name,
          op,
          description,
          spanDurationMs: Math.round(Math.max(0, end - start)),
          // The span's own start time, not the transaction's (a span can run
          // well into a long transaction).
          timestamp: Math.round(start),
        });
      }
    }

    matches.sort((a, b) => b.spanDurationMs - a.spanDurationMs);
    return { sampleSize: recent.length, total: matches.length, matches: matches.slice(0, cap) };
  },
});

type PerfIssueType = 'n_plus_one' | 'slow_db' | 'slow_http';
interface PerfOccurrence {
  type: PerfIssueType;
  op: string;
  description: string;
  impactMs: number;
  transactionId: string;
  transactionName: string;
}

/**
 * Standalone performance-issues list: scans the spans of the most recent
 * {@link SPAN_SAMPLE} transactions, runs lightweight detectors (N+1 db/cache
 * queries, slow db queries, slow outbound HTTP calls), and aggregates the
 * findings across transactions by a (type, op, description) fingerprint, ranked
 * by total impact time. A recent-window approximation (no columnar store yet),
 * consistent with the rest of the performance views; nothing is persisted.
 */
export const performanceIssues = query({
  args: { type: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { type, limit }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const recent = await ctx.db
      .query('transactions')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(SPAN_SAMPLE);

    const occurrences: PerfOccurrence[] = [];

    for (const t of recent) {
      const spans = ((t.payload as { spans?: RawSpan[] } | null)?.spans ?? []) as RawSpan[];
      const txnId = t._id as string;
      const txnName = t.name;

      // Per-transaction N+1 grouping: the same db/cache op repeated in one trace.
      const n1Groups = new Map<
        string,
        { op: string; description: string; count: number; totalMs: number }
      >();

      for (const s of spans) {
        const op = typeof s.op === 'string' ? s.op : 'other';
        const description = typeof s.description === 'string' ? s.description : '';
        const start = spanMs(s.start_timestamp);
        const end = spanMs(s.timestamp);
        if (start == null || end == null) continue;
        const durMs = Math.max(0, end - start);
        const category = op.split('.')[0] || 'other';

        if (N1_CATEGORIES.has(category)) {
          const key = `${op}\n${description}`;
          let g = n1Groups.get(key);
          if (!g) {
            g = { op, description, count: 0, totalMs: 0 };
            n1Groups.set(key, g);
          }
          g.count += 1;
          g.totalMs += durMs;
        }

        if (category === 'db' && durMs >= SLOW_DB_MS) {
          occurrences.push({
            type: 'slow_db',
            op,
            description,
            impactMs: durMs,
            transactionId: txnId,
            transactionName: txnName,
          });
        }

        if ((op.startsWith('http.client') || category === 'http') && durMs >= SLOW_HTTP_MS) {
          occurrences.push({
            type: 'slow_http',
            op,
            description,
            impactMs: durMs,
            transactionId: txnId,
            transactionName: txnName,
          });
        }
      }

      for (const g of n1Groups.values()) {
        if (g.count >= N1_THRESHOLD) {
          occurrences.push({
            type: 'n_plus_one',
            op: g.op,
            description: g.description,
            impactMs: g.totalMs,
            transactionId: txnId,
            transactionName: txnName,
          });
        }
      }
    }

    const filtered = type ? occurrences.filter((o) => o.type === type) : occurrences;

    // Aggregate across transactions by (type, op, description). Detectors are
    // independent, so one span can contribute to more than one issue (e.g. a slow
    // db span that is also part of an N+1 group); each issue's totals are correct
    // for that fingerprint, but totals are not partitioned across types and should
    // not be summed into a single grand total.
    const groups = new Map<
      string,
      {
        type: PerfIssueType;
        op: string;
        description: string;
        occurrences: number;
        affectedTxns: Set<string>;
        totalMs: number;
        maxMs: number;
        worst: { transactionId: string; transactionName: string; impactMs: number };
      }
    >();

    for (const o of filtered) {
      const key = `${o.type}\n${o.op}\n${o.description}`;
      let a = groups.get(key);
      if (!a) {
        a = {
          type: o.type,
          op: o.op,
          description: o.description,
          occurrences: 0,
          affectedTxns: new Set<string>(),
          totalMs: 0,
          maxMs: 0,
          worst: {
            transactionId: o.transactionId,
            transactionName: o.transactionName,
            impactMs: -1,
          },
        };
        groups.set(key, a);
      }
      a.occurrences += 1;
      a.affectedTxns.add(o.transactionId);
      a.totalMs += o.impactMs;
      if (o.impactMs > a.maxMs) a.maxMs = o.impactMs;
      if (o.impactMs > a.worst.impactMs) {
        a.worst = {
          transactionId: o.transactionId,
          transactionName: o.transactionName,
          impactMs: o.impactMs,
        };
      }
    }

    const cap = Math.min(ISSUES_CAP, Math.max(1, limit ?? ISSUES_CAP));
    const issues = [...groups.values()]
      .map((a) => ({
        type: a.type,
        op: a.op,
        description: a.description,
        occurrences: a.occurrences,
        affectedTransactions: a.affectedTxns.size,
        totalMs: Math.round(a.totalMs),
        avgMs: Math.round(a.totalMs / Math.max(1, a.occurrences)),
        maxMs: Math.round(a.maxMs),
        sample: {
          transactionId: a.worst.transactionId,
          transactionName: a.worst.transactionName,
        },
      }))
      .sort((x, y) => y.totalMs - x.totalMs)
      .slice(0, cap);

    return { sampleSize: recent.length, issues };
  },
});

/**
 * Per-transaction-name performance aggregates over the most recent
 * {@link STATS_SAMPLE} transactions in the organization. Percentiles are a
 * recent-window approximation (Sveltry has no columnar store yet), which is
 * honest about the trade-off and good enough to spot regressions.
 */
export const transactionStats = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    // Scan the lean projection (scalar columns only, no span payload).
    const recent = await ctx.db
      .query('transactionsMeta')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(STATS_SAMPLE);

    const groups = new Map<string, { op: string; durations: number[]; failures: number }>();
    for (const t of recent) {
      let g = groups.get(t.name);
      if (!g) {
        g = { op: t.op, durations: [], failures: 0 };
        groups.set(t.name, g);
      }
      g.durations.push(t.durationMs);
      if (t.status !== 'ok' && t.status !== 'unknown') g.failures += 1;
    }

    const rows = [...groups.entries()].map(([name, g]) => {
      const sorted = g.durations.slice().sort((a, b) => a - b);
      const sum = sorted.reduce((acc, d) => acc + d, 0);
      return {
        name,
        op: g.op,
        count: sorted.length,
        avgMs: Math.round(sum / sorted.length),
        p50Ms: Math.round(percentile(sorted, 50)),
        p95Ms: Math.round(percentile(sorted, 95)),
        p99Ms: Math.round(percentile(sorted, 99)),
        maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
        failureRate: g.failures / sorted.length,
      };
    });
    rows.sort((a, b) => b.count - a.count);
    return { sampleSize: recent.length, rows };
  },
});

/** The most recent transactions across the organization, for the live feed. */
export const recentTransactions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    // Scan the lean projection; `_id` must be the underlying transaction id so the
    // live feed's `/performance/<id>` link resolves via `getTransaction`.
    const rows = await ctx.db
      .query('transactionsMeta')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(Math.min(limit ?? RECENT_LIMIT, 200));
    return rows.map((t) => ({
      _id: t.transactionId,
      name: t.name,
      op: t.op,
      status: t.status,
      durationMs: t.durationMs,
      timestamp: t.timestamp,
      environment: t.environment,
      release: t.release,
      spanCount: t.spanCount,
    }));
  },
});

/**
 * Hourly latency trend from the precomputed rollups: count, avg, p50, p95, and p99
 * per hour over the requested window (optionally filtered to one transaction name).
 * Percentiles are exact within the histogram's bucket resolution.
 */
export const transactionTrend = query({
  args: { transactionName: v.optional(v.string()), hours: v.optional(v.number()) },
  handler: async (ctx, { transactionName, hours }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const span = Math.min(hours ?? 24, 168);
    const since = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - span * HOUR_MS;

    const rollups = await ctx.db
      .query('transactionRollups')
      .withIndex('by_org_bucket', (q) =>
        q.eq('organizationId', activeOrganizationId).gte('bucketStart', since),
      )
      .collect();
    const filtered = transactionName
      ? rollups.filter((r) => r.transactionName === transactionName)
      : rollups;

    const buckets = new Map<number, { count: number; sum: number; histos: number[][] }>();
    for (const r of filtered) {
      let b = buckets.get(r.bucketStart);
      if (!b) {
        b = { count: 0, sum: 0, histos: [] };
        buckets.set(r.bucketStart, b);
      }
      b.count += r.count;
      b.sum += r.sumMs;
      b.histos.push(r.histogram);
    }

    return [...buckets.entries()]
      .map(([bucketStart, b]) => {
        const merged = mergeHistograms(b.histos);
        return {
          bucketStart,
          count: b.count,
          avgMs: b.count > 0 ? Math.round(b.sum / b.count) : 0,
          p50Ms: percentileFromHistogram(merged, 50),
          p95Ms: percentileFromHistogram(merged, 95),
          p99Ms: percentileFromHistogram(merged, 99),
        };
      })
      .sort((a, b) => a.bucketStart - b.bucketStart);
  },
});

/** Nearest-rank p75 of a sorted-ascending array. */
function p75(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  return sortedAsc[Math.min(n - 1, Math.max(0, Math.ceil(0.75 * n) - 1))]!;
}

const WEB_VITALS = ['lcp', 'fcp', 'cls', 'inp', 'fid', 'ttfb'] as const;

/**
 * Web Vitals (p75) over recent transactions. The browser SDK reports them as
 * `measurements` on pageload/navigation transactions; we read them from the
 * stored payload (no extra columns).
 */
export const webVitals = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    // Scan the lean projection; web-vitals values were extracted into the
    // `measurements` column at ingest, so this no longer materializes span blobs.
    const recent = await ctx.db
      .query('transactionsMeta')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(1000);

    const samples: Record<string, number[]> = {};
    for (const t of recent) {
      const m = t.measurements;
      if (!m) continue;
      for (const vital of WEB_VITALS) {
        const v = m[vital];
        if (typeof v === 'number') (samples[vital] ??= []).push(v);
      }
    }

    return WEB_VITALS.map((vital) => {
      const arr = (samples[vital] ?? []).sort((a, b) => a - b);
      return { vital, p75: Math.round(p75(arr)), count: arr.length };
    }).filter((v) => v.count > 0);
  },
});

/** All transactions sharing a trace id, for the distributed trace view. */
export const getTrace = query({
  args: { traceId: v.string() },
  handler: async (ctx, { traceId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_trace', (q) => q.eq('traceId', traceId))
      .take(200);
    const mine = rows.filter((t) => t.organizationId === activeOrganizationId);
    mine.sort((a, b) => a.timestamp - b.timestamp);
    if (mine.length === 0) return null;
    const traceStart = Math.min(...mine.map((t) => t.timestamp));
    const traceEnd = Math.max(...mine.map((t) => t.endTimestamp));
    return {
      traceId,
      startedAt: traceStart,
      durationMs: Math.max(0, traceEnd - traceStart),
      transactions: mine.map((t) => ({
        _id: t._id,
        name: t.name,
        op: t.op,
        status: t.status,
        durationMs: t.durationMs,
        offsetMs: t.timestamp - traceStart,
        platform: t.platform,
      })),
    };
  },
});

/** A single transaction with its full payload (spans) for the trace view. */
export const getTransaction = query({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const t = await ctx.db.get(transactionId);
    if (!t || t.organizationId !== activeOrganizationId) return null;
    return t;
  },
});
