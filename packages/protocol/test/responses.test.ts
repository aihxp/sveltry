import { describe, expect, test } from 'bun:test';
import { corsHeaders, ingestError, ingestSuccess, rateLimited } from '../src/responses.js';

describe('ingest responses', () => {
  test('success is 200 with the event id and no rate-limit header', async () => {
    const res = ingestSuccess('abc123');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-sentry-rate-limits')).toBeNull();
    expect(await res.json()).toEqual({ id: 'abc123' });
  });

  test('success forwards extra (CORS) headers', () => {
    const res = ingestSuccess('abc123', corsHeaders('https://app.example.com'));
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  test('error surfaces the reason via x-sentry-error', async () => {
    const res = ingestError(401, 'invalid dsn', ['unknown key'], corsHeaders('*'));
    expect(res.status).toBe(401);
    expect(res.headers.get('x-sentry-error')).toBe('invalid dsn');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ detail: 'invalid dsn', causes: ['unknown key'] });
  });

  test('rate limited is 429 with Retry-After and forwards CORS headers', () => {
    // Regression guard: a cross-origin 429 must carry Access-Control-Allow-Origin
    // so browser SDKs can read the backoff instead of seeing an opaque CORS error.
    const res = rateLimited(42, undefined, corsHeaders('https://app.example.com'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  test('rate limited rounds fractional Retry-After up', () => {
    const res = rateLimited(1.2);
    expect(res.headers.get('retry-after')).toBe('2');
  });
});
