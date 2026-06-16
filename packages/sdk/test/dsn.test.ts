import { describe, expect, test } from 'bun:test';
import { buildSveltryDsn, dsnFromEnvelopeHeader, ingestUrlFromDsn, parseDsn } from '../src/dsn.js';

describe('buildSveltryDsn', () => {
  test('builds a Sentry-compatible DSN from an ingest host', () => {
    expect(
      buildSveltryDsn({
        ingestHost: 'https://ingest.example.com',
        publicKey: 'abc',
        projectId: 42,
      }),
    ).toBe('https://abc@ingest.example.com/42');
  });

  test('preserves a path prefix on the ingest host', () => {
    expect(
      buildSveltryDsn({
        ingestHost: 'https://h.example.com/relay/',
        publicKey: 'k',
        projectId: '7',
      }),
    ).toBe('https://k@h.example.com/relay/7');
  });
});

describe('parseDsn / buildSveltryDsn round-trip', () => {
  test('parse(build(x)) recovers the parts', () => {
    const dsn = buildSveltryDsn({
      ingestHost: 'http://127.0.0.1:3211',
      publicKey: 'pk',
      projectId: '99',
    });
    const parsed = parseDsn(dsn);
    expect(parsed).toEqual({ origin: 'http://127.0.0.1:3211', publicKey: 'pk', projectId: '99' });
  });

  test('parseDsn rejects a DSN with no public key or no project id', () => {
    expect(parseDsn('https://ingest.example.com/42')).toBeNull();
    expect(parseDsn('not a url')).toBeNull();
  });
});

describe('ingestUrlFromDsn', () => {
  test('derives the envelope endpoint', () => {
    expect(ingestUrlFromDsn('https://pk@ingest.example.com/42')).toBe(
      'https://ingest.example.com/api/42/envelope/',
    );
  });

  test('keeps a path prefix', () => {
    expect(ingestUrlFromDsn('https://pk@h.example.com/relay/7')).toBe(
      'https://h.example.com/relay/api/7/envelope/',
    );
  });
});

describe('dsnFromEnvelopeHeader', () => {
  test('reads the dsn field from the first envelope line', () => {
    const env = JSON.stringify({ dsn: 'https://pk@h/1', event_id: 'x' }) + '\n{"type":"event"}\n{}';
    expect(dsnFromEnvelopeHeader(env)).toBe('https://pk@h/1');
  });

  test('returns null when the header has no dsn or is not JSON', () => {
    expect(dsnFromEnvelopeHeader('{"event_id":"x"}\n')).toBeNull();
    expect(dsnFromEnvelopeHeader('garbage\n')).toBeNull();
  });
});
