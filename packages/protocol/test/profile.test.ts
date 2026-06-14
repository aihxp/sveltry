import { describe, expect, test } from 'bun:test';
import { buildFlamegraph, normalizeProfile } from '../src/profile.js';
import type { SentryProfile } from '@sveltry/types';

const profile: SentryProfile = {
  event_id: 'p1',
  platform: 'node',
  release: 'v1',
  environment: 'production',
  transaction: { name: 'GET /api/report' },
  profile: {
    // frames: 0=main, 1=handler, 2=db.query, 3=serialize
    frames: [
      { function: 'main', in_app: true },
      { function: 'handler', filename: 'app.js', in_app: true },
      { function: 'dbQuery', filename: 'db.js', in_app: true },
      { function: 'serialize', filename: 'json.js', in_app: false },
    ],
    // stacks are leaf-first (innermost frame index first)
    stacks: [
      [2, 1, 0], // dbQuery <- handler <- main
      [3, 1, 0], // serialize <- handler <- main
    ],
    samples: [
      { stack_id: 0, elapsed_since_start_ns: 1_000_000 },
      { stack_id: 0, elapsed_since_start_ns: 2_000_000 },
      { stack_id: 1, elapsed_since_start_ns: 3_000_000 },
    ],
  },
};

describe('normalizeProfile', () => {
  test('extracts metadata and duration from samples', () => {
    const n = normalizeProfile(profile, { receivedAt: 100 });
    expect(n.profileId).toBe('p1');
    expect(n.transactionName).toBe('GET /api/report');
    expect(n.sampleCount).toBe(3);
    expect(n.durationMs).toBe(3); // 3_000_000 ns
  });
});

describe('buildFlamegraph', () => {
  test('builds a root-first call tree weighted by samples', () => {
    const flame = buildFlamegraph(profile.profile);
    expect(flame.value).toBe(3); // 3 samples total
    // root -> main(3) -> handler(3) -> { dbQuery(2), serialize(1) }
    expect(flame.children).toHaveLength(1);
    const main = flame.children[0]!;
    expect(main.name).toBe('main');
    expect(main.value).toBe(3);
    const handler = main.children[0]!;
    expect(handler.name).toBe('handler');
    expect(handler.value).toBe(3);
    expect(handler.children.map((c) => [c.name, c.value])).toEqual([
      ['dbQuery', 2],
      ['serialize', 1],
    ]);
  });
});
