import { describe, expect, test } from 'bun:test';
import {
  messageString,
  normalizeEvent,
  normalizeTags,
  normalizeTransaction,
  timestampToMs,
} from '../src/normalize.js';
import type { SentryEventPayload } from '@sveltry/types';

describe('timestampToMs', () => {
  test('parses unix seconds, unix ms, and RFC3339', () => {
    expect(timestampToMs(1781705760, 0)).toBe(1781705760000);
    expect(timestampToMs(1781705760000, 0)).toBe(1781705760000);
    expect(timestampToMs('2026-06-13T14:16:00.000Z', 0)).toBe(
      Date.parse('2026-06-13T14:16:00.000Z'),
    );
    expect(timestampToMs(undefined, 12345)).toBe(12345);
  });
});

describe('normalizeTags', () => {
  test('handles object and array tag forms', () => {
    expect(normalizeTags({ tags: { browser: 'Chrome', n: 3 } } as SentryEventPayload)).toEqual({
      browser: 'Chrome',
      n: '3',
    });
    expect(
      normalizeTags({
        tags: [
          ['os', 'macOS'],
          ['x', '1'],
        ],
      } as unknown as SentryEventPayload),
    ).toEqual({ os: 'macOS', x: '1' });
  });
});

describe('messageString', () => {
  test('coerces structured messages', () => {
    expect(messageString({ message: 'plain' } as SentryEventPayload)).toBe('plain');
    expect(
      messageString({ message: { formatted: 'fmt', message: 'raw' } } as SentryEventPayload),
    ).toBe('fmt');
  });
});

describe('normalizeEvent', () => {
  test('derives title, culprit, level, platform, tags from an exception event', () => {
    const payload: SentryEventPayload = {
      event_id: '771A43A4192642F0B136D5159A501700',
      timestamp: 1781705760,
      platform: 'javascript',
      release: 'app@1.0.0',
      environment: 'staging',
      exception: {
        values: [
          {
            type: 'TypeError',
            value: "Cannot read properties of undefined (reading 'id')",
            stacktrace: {
              frames: [
                { filename: 'start.js', function: 'render', in_app: false },
                { filename: 'src/routes/+page.svelte', function: 'load', in_app: true },
              ],
            },
          },
        ],
      },
    };
    const n = normalizeEvent(payload, { receivedAt: 999 });
    expect(n.eventId).toBe('771a43a4192642f0b136d5159a501700'); // lowercased, dashless
    expect(n.message).toBe("TypeError: Cannot read properties of undefined (reading 'id')");
    expect(n.culprit).toBe('load (src/routes/+page.svelte)'); // deepest in_app frame
    expect(n.level).toBe('error');
    expect(n.platform).toBe('javascript');
    expect(n.environment).toBe('staging');
    expect(n.tags.release).toBe('app@1.0.0');
    expect(n.tags.environment).toBe('staging');
    expect(n.errorType).toBe('TypeError');
  });

  test('falls back to message-only events', () => {
    const n = normalizeEvent({ message: 'Something happened', level: 'warning' });
    expect(n.message).toBe('Something happened');
    expect(n.level).toBe('warning');
    expect(n.platform).toBe('other');
    expect(n.environment).toBe('production');
  });
});

describe('normalizeTransaction', () => {
  test('extracts name, trace, duration, and span count', () => {
    const payload: SentryEventPayload = {
      type: 'transaction',
      event_id: 'AA-BB',
      transaction: 'GET /api/users',
      start_timestamp: 1781705760,
      timestamp: 1781705760.45,
      platform: 'node',
      release: 'v1.2.3',
      environment: 'production',
      contexts: {
        trace: { trace_id: 'abc123', span_id: 'root1', op: 'http.server', status: 'ok' },
      },
      spans: [
        { span_id: 's1', op: 'db.query' },
        { span_id: 's2', op: 'http.client' },
      ],
    };
    const t = normalizeTransaction(payload, { receivedAt: 1 });
    expect(t.name).toBe('GET /api/users');
    expect(t.traceId).toBe('abc123');
    expect(t.spanId).toBe('root1');
    expect(t.op).toBe('http.server');
    expect(t.status).toBe('ok');
    expect(t.timestamp).toBe(1781705760000);
    expect(t.endTimestamp).toBe(1781705760450);
    expect(t.durationMs).toBe(450);
    expect(t.spanCount).toBe(2);
    expect(t.eventId).toBe('aabb');
    expect(t.tags['transaction.op']).toBe('http.server');
  });

  test('falls back gracefully when fields are missing', () => {
    const t = normalizeTransaction({ type: 'transaction' }, { receivedAt: 1000 });
    expect(t.name).toBe('<unnamed transaction>');
    expect(t.op).toBe('default');
    expect(t.durationMs).toBe(0);
    expect(t.spanCount).toBe(0);
  });
});
