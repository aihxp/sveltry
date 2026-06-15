import { describe, expect, test } from 'bun:test';
import { originAllowed, requestOrigin } from '../src/origins.js';

describe('requestOrigin', () => {
  test('prefers the Origin header', () => {
    expect(requestOrigin('https://app.example.com', 'https://other.com/x')).toBe(
      'https://app.example.com',
    );
  });

  test('ignores the literal "null" origin and falls back to referer origin', () => {
    expect(requestOrigin('null', 'https://app.example.com/page?q=1')).toBe(
      'https://app.example.com',
    );
  });

  test('returns null when neither header is present (server-side request)', () => {
    expect(requestOrigin(null, null)).toBeNull();
    expect(requestOrigin(undefined, undefined)).toBeNull();
  });

  test('ignores an unparseable referer', () => {
    expect(requestOrigin(null, 'not a url')).toBeNull();
  });
});

describe('originAllowed - no-op cases', () => {
  test('empty allowlist permits everything', () => {
    expect(originAllowed('https://evil.com', [])).toBe(true);
    expect(originAllowed('https://evil.com', ['   '])).toBe(true);
  });

  test('a `*` entry permits everything', () => {
    expect(originAllowed('https://evil.com', ['*'])).toBe(true);
  });

  test('a null origin (server-side SDK) is permitted even with an allowlist', () => {
    expect(originAllowed(null, ['example.com'])).toBe(true);
  });
});

describe('originAllowed - host patterns', () => {
  test('exact host matches under any scheme, ignoring port', () => {
    expect(originAllowed('https://example.com', ['example.com'])).toBe(true);
    expect(originAllowed('http://example.com:8080', ['example.com'])).toBe(true);
    expect(originAllowed('https://evil.com', ['example.com'])).toBe(false);
  });

  test('subdomain wildcard matches the apex and any subdomain', () => {
    expect(originAllowed('https://example.com', ['*.example.com'])).toBe(true);
    expect(originAllowed('https://app.example.com', ['*.example.com'])).toBe(true);
    expect(originAllowed('https://a.b.example.com', ['*.example.com'])).toBe(true);
    // Not a suffix-confusable match.
    expect(originAllowed('https://notexample.com', ['*.example.com'])).toBe(false);
    expect(originAllowed('https://example.com.evil.com', ['*.example.com'])).toBe(false);
  });

  test('any of several patterns may match', () => {
    const list = ['app.example.com', '*.staging.example.com'];
    expect(originAllowed('https://app.example.com', list)).toBe(true);
    expect(originAllowed('https://x.staging.example.com', list)).toBe(true);
    expect(originAllowed('https://other.example.com', list)).toBe(false);
  });
});

describe('originAllowed - scheme-qualified patterns', () => {
  test('scheme must match when the pattern specifies one', () => {
    expect(originAllowed('https://example.com', ['https://example.com'])).toBe(true);
    expect(originAllowed('http://example.com', ['https://example.com'])).toBe(false);
    expect(originAllowed('http://example.com', ['http://example.com'])).toBe(true);
  });

  test('scheme + subdomain wildcard', () => {
    expect(originAllowed('https://app.example.com', ['https://*.example.com'])).toBe(true);
    expect(originAllowed('http://app.example.com', ['https://*.example.com'])).toBe(false);
  });

  test('a trailing slash / path in the pattern is tolerated', () => {
    expect(originAllowed('https://example.com', ['https://example.com/'])).toBe(true);
  });
});

describe('originAllowed - denial cases', () => {
  test('a present-but-unparseable origin is denied when an allowlist is set', () => {
    expect(originAllowed('garbage', ['example.com'])).toBe(false);
  });

  test('localhost dev origins with ports work via a host pattern', () => {
    expect(originAllowed('http://localhost:5173', ['localhost'])).toBe(true);
  });
});
