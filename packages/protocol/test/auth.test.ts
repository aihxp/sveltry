import { describe, expect, test } from 'bun:test';
import { extractAuth, publicKeyFromAuth } from '../src/auth.js';

describe('extractAuth', () => {
  test('parses the X-Sentry-Auth header', () => {
    const auth = extractAuth(
      'Sentry sentry_version=7, sentry_client=sentry.python/1.45.0, sentry_key=PUBLIC_KEY, sentry_secret=SECRET',
      new URLSearchParams(),
    );
    expect(auth.sentry_version).toBe('7');
    expect(auth.sentry_client).toBe('sentry.python/1.45.0');
    expect(auth.sentry_key).toBe('PUBLIC_KEY');
    expect(auth.sentry_secret).toBe('SECRET');
    expect(publicKeyFromAuth(auth)).toBe('PUBLIC_KEY');
  });

  test('parses query-string auth (browser SDKs)', () => {
    const params = new URLSearchParams(
      'sentry_version=7&sentry_key=BROWSER_KEY&sentry_client=sentry.javascript.browser%2F10.57.0',
    );
    const auth = extractAuth(null, params);
    expect(auth.sentry_key).toBe('BROWSER_KEY');
    expect(auth.sentry_client).toBe('sentry.javascript.browser/10.57.0');
  });

  test('header takes precedence over query string', () => {
    const auth = extractAuth(
      'Sentry sentry_key=FROM_HEADER',
      new URLSearchParams('sentry_key=FROM_QUERY'),
    );
    expect(auth.sentry_key).toBe('FROM_HEADER');
  });

  test('returns empty when no auth is present', () => {
    expect(publicKeyFromAuth(extractAuth(null, new URLSearchParams()))).toBeUndefined();
  });
});
