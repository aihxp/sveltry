/**
 * Fixed-bucket duration histograms for time-series latency rollups. Raw
 * transaction durations are bucketed into these bounds (ms); per-time-window
 * histograms are merged and percentiles estimated from the merged counts. This
 * gives percentiles over arbitrary windows without a columnar/time-series store,
 * at the cost of bucket-resolution precision.
 */

/** Inclusive upper bounds (ms) for each histogram bucket; an overflow bucket follows. */
export const HISTO_BOUNDS = [
  1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000,
  5000, 7500, 10000, 15000, 30000, 60000,
];

/** Number of buckets, including the trailing overflow bucket (durations past the last bound). */
export const HISTO_SIZE = HISTO_BOUNDS.length + 1;

/** Bucket index for a duration (ms). Returns the overflow bucket for very large values. */
export function bucketIndex(ms: number): number {
  for (let i = 0; i < HISTO_BOUNDS.length; i++) {
    if (ms <= HISTO_BOUNDS[i]!) return i;
  }
  return HISTO_BOUNDS.length; // overflow
}

/** A zeroed histogram. */
export function emptyHistogram(): number[] {
  return new Array(HISTO_SIZE).fill(0);
}

/** Add a duration sample to a histogram (mutates and returns it). */
export function addSample(histo: number[], ms: number): number[] {
  histo[bucketIndex(ms)] = (histo[bucketIndex(ms)] ?? 0) + 1;
  return histo;
}

/** Element-wise sum of histograms (e.g. merging hourly buckets over a window). */
export function mergeHistograms(histos: number[][]): number[] {
  const out = emptyHistogram();
  for (const h of histos) {
    for (let i = 0; i < HISTO_SIZE; i++) out[i] = (out[i] ?? 0) + (h[i] ?? 0);
  }
  return out;
}

/**
 * Estimate the p-th percentile (0-100) of a histogram, returning the upper bound
 * of the crossing bucket (so it never under-reports latency). The overflow
 * bucket reports the last bound.
 */
export function percentileFromHistogram(histo: number[], p: number): number {
  let total = 0;
  for (const c of histo) total += c;
  if (total === 0) return 0;
  const target = (p / 100) * total;
  let cumulative = 0;
  for (let i = 0; i < HISTO_SIZE; i++) {
    cumulative += histo[i] ?? 0;
    if (cumulative >= target) {
      return HISTO_BOUNDS[i] ?? HISTO_BOUNDS[HISTO_BOUNDS.length - 1]!;
    }
  }
  return HISTO_BOUNDS[HISTO_BOUNDS.length - 1]!;
}
