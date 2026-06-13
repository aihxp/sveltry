import { describe, expect, test } from 'bun:test';
import {
  computeGrouping,
  defaultGroupingComponents,
  normalizeDynamicValues,
} from '../src/fingerprint.js';
import { normalizeEvent } from '../src/normalize.js';
import type { SentryEventPayload } from '@sveltry/types';

function group(payload: SentryEventPayload) {
  return computeGrouping(payload, normalizeEvent(payload, { receivedAt: 0 }));
}

const baseException = (
  value: string,
  frames: Array<Record<string, unknown>>,
): SentryEventPayload => ({
  platform: 'javascript',
  exception: { values: [{ type: 'TypeError', value, stacktrace: { frames } }] },
});

describe('normalizeDynamicValues', () => {
  test('replaces uuids, addresses, hex, and numbers', () => {
    expect(normalizeDynamicValues('user 12345 not found')).toBe('user <n> not found');
    expect(normalizeDynamicValues('id 550e8400-e29b-41d4-a716-446655440000')).toBe('id <uuid>');
    expect(normalizeDynamicValues('at 0x7ffeabcd')).toBe('at <addr>');
    expect(normalizeDynamicValues('token deadbeefdeadbeefdeadbeef')).toBe('token <hex>');
  });
});

describe('computeGrouping', () => {
  test('groups two events with the same stack trace but different line numbers / dynamic values', () => {
    const a = baseException('Cannot read id of user 123', [
      { filename: 'src/app.ts', function: 'load', lineno: 12, in_app: true },
    ]);
    const b = baseException('Cannot read id of user 999', [
      { filename: 'src/app.ts', function: 'load', lineno: 48, in_app: true },
    ]);
    expect(group(a).fingerprint).toBe(group(b).fingerprint);
  });

  test('separates different exception types / functions', () => {
    const a = baseException('boom', [{ filename: 'src/a.ts', function: 'foo', in_app: true }]);
    const b = baseException('boom', [{ filename: 'src/b.ts', function: 'bar', in_app: true }]);
    expect(group(a).fingerprint).not.toBe(group(b).fingerprint);
  });

  test('prefers in_app frames for grouping', () => {
    const components = defaultGroupingComponents(
      baseException('x', [
        { filename: 'node_modules/lib.js', function: 'internal', in_app: false },
        { filename: 'src/me.ts', function: 'mine', in_app: true },
      ]),
    );
    expect(components.join('\n')).toContain('mine');
    expect(components.join('\n')).not.toContain('internal');
  });

  test('honors a custom SDK fingerprint', () => {
    const withFp: SentryEventPayload = {
      message: 'whatever',
      fingerprint: ['my-custom-group'],
    };
    const other: SentryEventPayload = {
      message: 'totally different',
      fingerprint: ['my-custom-group'],
    };
    expect(group(withFp).fingerprint).toBe(group(other).fingerprint);
  });

  test('the {{ default }} token merges default grouping with custom parts', () => {
    const a = baseException('err', [{ filename: 'src/a.ts', function: 'foo', in_app: true }]);
    const withToken: SentryEventPayload = { ...a, fingerprint: ['{{ default }}', 'tenant-7'] };
    const plain = group(a);
    const merged = group(withToken);
    // Adding a custom suffix changes the group.
    expect(merged.fingerprint).not.toBe(plain.fingerprint);
  });

  test('groups message-only events by normalized message', () => {
    const a: SentryEventPayload = { message: 'Disk full on /dev/sda1 at 95%' };
    const b: SentryEventPayload = { message: 'Disk full on /dev/sda9 at 12%' };
    expect(group(a).fingerprint).toBe(group(b).fingerprint);
  });

  test('produces a stable 40-char hex fingerprint and carries grouping metadata', () => {
    const g = group(baseException('x', [{ filename: 'src/a.ts', function: 'foo', in_app: true }]));
    expect(g.fingerprint).toMatch(/^[0-9a-f]{40}$/);
    expect(g.groupingConfig).toContain('sveltry');
    expect(g.errorType).toBe('TypeError');
  });
});
