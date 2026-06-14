/**
 * Discover aggregation: the pure math behind the analytics query engine. The
 * backend scans events or transactions over a time window, reduces each row to a
 * `DiscoverSample` (a group key plus an optional numeric value / user id), and this
 * computes the per-group aggregate. Kept dependency-free and unit-tested.
 */

export type DiscoverAggregate = 'count' | 'users' | 'avg' | 'p50' | 'p75' | 'p95' | 'p99';

export interface DiscoverSample {
  /** The group bucket this row falls into (e.g. a level, release, or transaction name). */
  group: string;
  /** Numeric sample (e.g. duration in ms) used by `avg` and the percentile aggregates. */
  value?: number;
  /** User identity used by the `users` (distinct-count) aggregate. */
  user?: string;
}

export interface DiscoverRow {
  group: string;
  /** The computed aggregate for the group. */
  value: number;
  /** Number of samples in the group. */
  count: number;
}

const PERCENTILE: Partial<Record<DiscoverAggregate, number>> = {
  p50: 50,
  p75: 75,
  p95: 95,
  p99: 99,
};

/** The p-th percentile (0-100) of an ascending-sorted array, via linear interpolation. */
export function percentileOf(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * frac;
}

/**
 * Group `samples` by their `group` key and compute `aggregate` per group, returning
 * the rows sorted by value descending and capped at `limit`.
 */
export function discoverAggregate(
  samples: readonly DiscoverSample[],
  aggregate: DiscoverAggregate,
  limit = 50,
): DiscoverRow[] {
  const groups = new Map<string, { values: number[]; users: Set<string>; count: number }>();
  for (const s of samples) {
    let g = groups.get(s.group);
    if (!g) {
      g = { values: [], users: new Set(), count: 0 };
      groups.set(s.group, g);
    }
    g.count += 1;
    if (typeof s.value === 'number') g.values.push(s.value);
    if (s.user) g.users.add(s.user);
  }

  const pct = PERCENTILE[aggregate];
  const rows: DiscoverRow[] = [];
  for (const [group, g] of groups) {
    let value: number;
    if (aggregate === 'count') {
      value = g.count;
    } else if (aggregate === 'users') {
      value = g.users.size;
    } else if (aggregate === 'avg') {
      value = g.values.length ? g.values.reduce((a, b) => a + b, 0) / g.values.length : 0;
    } else {
      const sorted = g.values.slice().sort((a, b) => a - b);
      value = percentileOf(sorted, pct ?? 50);
    }
    rows.push({ group, value: Math.round(value * 100) / 100, count: g.count });
  }

  rows.sort((a, b) => b.value - a.value || b.count - a.count);
  return rows.slice(0, limit);
}
