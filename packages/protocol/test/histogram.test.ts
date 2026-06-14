import { describe, expect, test } from 'bun:test';
import {
  addSample,
  bucketIndex,
  emptyHistogram,
  HISTO_SIZE,
  mergeHistograms,
  percentileFromHistogram,
} from '../src/histogram.js';

describe('histogram', () => {
  test('bucketIndex maps durations to buckets, overflow past the last bound', () => {
    expect(bucketIndex(0.5)).toBe(0); // <= 1ms
    expect(bucketIndex(100)).toBe(12); // == 100ms bound
    expect(bucketIndex(99999)).toBe(HISTO_SIZE - 1); // overflow
  });

  test('percentiles from a histogram of 100 samples at ~50ms', () => {
    const h = emptyHistogram();
    for (let i = 0; i < 100; i++) addSample(h, 50);
    // All samples land in the <=50ms bucket; p50 and p95 both report its bound.
    expect(percentileFromHistogram(h, 50)).toBe(50);
    expect(percentileFromHistogram(h, 95)).toBe(50);
  });

  test('p95 reflects a slow tail', () => {
    const h = emptyHistogram();
    for (let i = 0; i < 95; i++) addSample(h, 20);
    for (let i = 0; i < 5; i++) addSample(h, 2000);
    expect(percentileFromHistogram(h, 50)).toBe(20);
    expect(percentileFromHistogram(h, 95)).toBe(20); // 95th sample still in the fast bucket
    expect(percentileFromHistogram(h, 99)).toBe(2000); // tail shows up past p95
  });

  test('mergeHistograms sums element-wise', () => {
    const a = emptyHistogram();
    const b = emptyHistogram();
    addSample(a, 10);
    addSample(b, 10);
    addSample(b, 10);
    const merged = mergeHistograms([a, b]);
    expect(percentileFromHistogram(merged, 50)).toBe(10);
    expect(merged.reduce((s, c) => s + c, 0)).toBe(3);
  });

  test('empty histogram percentile is 0', () => {
    expect(percentileFromHistogram(emptyHistogram(), 95)).toBe(0);
  });
});
