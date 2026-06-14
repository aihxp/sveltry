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
    const recent = await ctx.db
      .query('transactions')
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
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(Math.min(limit ?? RECENT_LIMIT, 200));
    return rows.map((t) => ({
      _id: t._id,
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
 * Hourly latency trend from the precomputed rollups: count, avg, p50, and p95 per
 * hour over the requested window (optionally filtered to one transaction name).
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
        };
      })
      .sort((a, b) => a.bucketStart - b.bucketStart);
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
