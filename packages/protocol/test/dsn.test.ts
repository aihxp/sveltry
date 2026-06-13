import { describe, expect, test } from 'bun:test';
import {
  baseApiEndpoint,
  buildDsn,
  envelopeEndpoint,
  parseDsn,
  projectIdFromPath,
  storeEndpoint,
} from '../src/dsn.js';

describe('parseDsn', () => {
  test('parses a modern DSN without a secret', () => {
    const dsn = parseDsn('https://public@sentry.example.com/1');
    expect(dsn).toEqual({
      protocol: 'https',
      publicKey: 'public',
      secretKey: undefined,
      host: 'sentry.example.com',
      port: undefined,
      path: undefined,
      projectId: '1',
    });
  });

  test('parses a DSN with a deprecated secret, port, and path prefix', () => {
    const dsn = parseDsn('http://pub:sec@localhost:3211/ingest/42');
    expect(dsn?.publicKey).toBe('pub');
    expect(dsn?.secretKey).toBe('sec');
    expect(dsn?.host).toBe('localhost');
    expect(dsn?.port).toBe('3211');
    expect(dsn?.path).toBe('ingest');
    expect(dsn?.projectId).toBe('42');
  });

  test('derives the ingest endpoints', () => {
    const dsn = parseDsn('https://abc@o1.ingest.sentry.io/123')!;
    expect(baseApiEndpoint(dsn)).toBe('https://o1.ingest.sentry.io/api/');
    expect(envelopeEndpoint(dsn)).toBe('https://o1.ingest.sentry.io/api/123/envelope/');
    expect(storeEndpoint(dsn)).toBe('https://o1.ingest.sentry.io/api/123/store/');
  });

  test('rejects malformed DSNs', () => {
    expect(parseDsn('not-a-url')).toBeNull();
    expect(parseDsn('https://sentry.example.com/1')).toBeNull(); // no public key
    expect(parseDsn('https://public@sentry.example.com/')).toBeNull(); // no project id
  });
});

describe('buildDsn', () => {
  test('round-trips through parseDsn', () => {
    const built = buildDsn({
      ingestHost: 'https://ingest.sveltry.example.com',
      publicKey: 'mykey',
      publicId: 7,
    });
    expect(built).toBe('https://mykey@ingest.sveltry.example.com/7');
    const parsed = parseDsn(built)!;
    expect(parsed.publicKey).toBe('mykey');
    expect(parsed.projectId).toBe('7');
  });

  test('preserves host port and path prefix', () => {
    const built = buildDsn({
      ingestHost: 'http://127.0.0.1:3211/relay',
      publicKey: 'k',
      publicId: '9',
    });
    expect(built).toBe('http://k@127.0.0.1:3211/relay/9');
  });
});

describe('projectIdFromPath', () => {
  test('matches envelope and store routes', () => {
    expect(projectIdFromPath('/api/42/envelope/')).toEqual({
      projectId: '42',
      endpoint: 'envelope',
    });
    expect(projectIdFromPath('/api/abc123/store')).toEqual({
      projectId: 'abc123',
      endpoint: 'store',
    });
  });

  test('returns null for non-ingest paths', () => {
    expect(projectIdFromPath('/healthz')).toBeNull();
    expect(projectIdFromPath('/api/42/')).toBeNull();
  });
});
