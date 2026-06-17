import { describe, expect, test } from 'vitest';
import { sdkSnippet, SNIPPET_PLATFORMS } from './sdk-snippets';

const DSN = 'http://k@127.0.0.1:3211/1';

describe('sdkSnippet', () => {
  test('python yields a pip install + sentry_sdk.init, not a generic Sentry.init', () => {
    const s = sdkSnippet('python', DSN);
    expect(s.label).toBe('Python');
    expect(s.install).toBe('pip install sentry-sdk');
    expect(s.code).toContain('sentry_sdk.init(');
    expect(s.code).toContain(DSN);
    expect(s.code).not.toContain('Sentry.init');
    expect(s.language).toBe('python');
  });

  test('node yields the @sentry/node package and a JS init', () => {
    const s = sdkSnippet('node', DSN);
    expect(s.install).toBe('npm install @sentry/node');
    expect(s.code).toContain("import * as Sentry from '@sentry/node'");
    expect(s.code).toContain(`Sentry.init({ dsn: '${DSN}' })`);
  });

  test('an unknown platform falls back to a generic, DSN-bearing snippet', () => {
    const s = sdkSnippet('haskell', DSN);
    expect(s.label).toBe('Any Sentry SDK');
    expect(s.code).toContain(DSN);
  });

  test('every tailored platform produces a non-empty install + DSN-bearing code', () => {
    for (const p of SNIPPET_PLATFORMS) {
      const s = sdkSnippet(p, DSN);
      expect(s.install.length, p).toBeGreaterThan(0);
      expect(s.code.includes(DSN), p).toBe(true);
    }
  });
});
