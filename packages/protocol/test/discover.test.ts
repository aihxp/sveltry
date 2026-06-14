import { describe, expect, test } from 'bun:test';
import { discoverAggregate, percentileOf, type DiscoverSample } from '../src/discover.js';

describe('percentileOf', () => {
  test('interpolates between samples', () => {
    expect(percentileOf([10, 20, 30, 40], 50)).toBe(25);
    expect(percentileOf([10, 20, 30, 40], 0)).toBe(10);
    expect(percentileOf([10, 20, 30, 40], 100)).toBe(40);
    expect(percentileOf([], 95)).toBe(0);
    expect(percentileOf([42], 95)).toBe(42);
  });
});

describe('discoverAggregate', () => {
  const errors: DiscoverSample[] = [
    { group: 'error', user: 'u1' },
    { group: 'error', user: 'u2' },
    { group: 'error', user: 'u1' },
    { group: 'warning', user: 'u3' },
  ];

  test('count groups and sorts by value desc', () => {
    const rows = discoverAggregate(errors, 'count');
    expect(rows).toEqual([
      { group: 'error', value: 3, count: 3 },
      { group: 'warning', value: 1, count: 1 },
    ]);
  });

  test('users counts distinct users per group', () => {
    const rows = discoverAggregate(errors, 'users');
    expect(rows.find((r) => r.group === 'error')!.value).toBe(2); // u1, u2
    expect(rows.find((r) => r.group === 'warning')!.value).toBe(1);
  });

  test('avg and percentiles over numeric values', () => {
    const txns: DiscoverSample[] = [
      { group: 'GET /a', value: 100 },
      { group: 'GET /a', value: 200 },
      { group: 'GET /a', value: 300 },
      { group: 'GET /b', value: 1000 },
    ];
    const avg = discoverAggregate(txns, 'avg');
    expect(avg[0]!.group).toBe('GET /b'); // 1000 sorts first
    expect(avg.find((r) => r.group === 'GET /a')!.value).toBe(200);

    const p95 = discoverAggregate(txns, 'p95');
    expect(p95.find((r) => r.group === 'GET /a')!.value).toBe(290); // interp of [100,200,300]
  });

  test('respects the limit', () => {
    const many: DiscoverSample[] = Array.from({ length: 10 }, (_, i) => ({ group: `g${i}` }));
    expect(discoverAggregate(many, 'count', 3)).toHaveLength(3);
  });

  test('empty input yields no rows', () => {
    expect(discoverAggregate([], 'count')).toEqual([]);
  });
});
