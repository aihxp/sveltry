import { describe, expect, test } from 'bun:test';
import {
  compileInboundFilters,
  inboundFilterInput,
  isWebCrawler,
  matchCompiledFilter,
  matchInboundFilter,
  type InboundFilterInput,
} from '../src/inboundfilters.js';
import type { SentryEventPayload } from '@sveltry/types';

const base: InboundFilterInput = {
  message: 'TypeError: undefined is not a function',
  errorType: 'TypeError',
  release: 'web@1.2.3',
  environment: 'production',
  paths: ['app/main.js'],
};

describe('matchInboundFilter - error messages', () => {
  test('anchored glob with wildcards matches inside the title', () => {
    expect(matchInboundFilter(base, { ignoreErrors: ['*not a function*'] })).toBe('error_message');
  });

  test('a bare (unwrapped) pattern must match the whole field', () => {
    // Without surrounding `*` it does not match a substring.
    expect(matchInboundFilter(base, { ignoreErrors: ['not a function'] })).toBeNull();
    // The exact whole-string pattern matches.
    expect(
      matchInboundFilter(base, { ignoreErrors: ['TypeError: undefined is not a function'] }),
    ).toBe('error_message');
  });

  test('matches against the exception type as well as the title', () => {
    expect(matchInboundFilter(base, { ignoreErrors: ['TypeError'] })).toBe('error_message');
  });

  test('? matches exactly one character', () => {
    expect(matchInboundFilter({ ...base, message: 'E1' }, { ignoreErrors: ['E?'] })).toBe(
      'error_message',
    );
    expect(matchInboundFilter({ ...base, message: 'E12' }, { ignoreErrors: ['E?'] })).toBeNull();
  });

  test('is case-insensitive', () => {
    expect(matchInboundFilter(base, { ignoreErrors: ['*NOT A FUNCTION*'] })).toBe('error_message');
  });

  test('regex metacharacters in a pattern are matched literally', () => {
    const input = { ...base, message: 'Error: a.b.c failed' };
    // The `.` is literal, so `a.b.c` matches but `axbxc` would not.
    expect(matchInboundFilter(input, { ignoreErrors: ['*a.b.c*'] })).toBe('error_message');
    expect(
      matchInboundFilter(
        { ...input, message: 'Error: axbxc failed' },
        { ignoreErrors: ['*a.b.c*'] },
      ),
    ).toBeNull();
  });
});

describe('matchInboundFilter - releases and environments', () => {
  test('release exact and wildcard match', () => {
    expect(matchInboundFilter(base, { ignoreReleases: ['web@1.2.3'] })).toBe('release');
    expect(matchInboundFilter(base, { ignoreReleases: ['web@1.*'] })).toBe('release');
    expect(matchInboundFilter(base, { ignoreReleases: ['web@2.*'] })).toBeNull();
  });

  test('environment match', () => {
    expect(matchInboundFilter(base, { ignoreEnvironments: ['production'] })).toBe('environment');
    expect(matchInboundFilter(base, { ignoreEnvironments: ['stag*'] })).toBeNull();
    expect(
      matchInboundFilter({ ...base, environment: 'staging' }, { ignoreEnvironments: ['stag*'] }),
    ).toBe('environment');
  });
});

describe('matchInboundFilter - file paths', () => {
  test('matches any frame path', () => {
    const input = { ...base, paths: ['app/main.js', 'chrome-extension://abc/inject.js'] };
    expect(matchInboundFilter(input, { ignorePaths: ['chrome-extension://*'] })).toBe('file_path');
  });

  test('no match when no frame path matches', () => {
    expect(matchInboundFilter(base, { ignorePaths: ['moz-extension://*'] })).toBeNull();
  });
});

describe('isWebCrawler / filterBots', () => {
  test('detects common crawlers', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'facebookexternalhit/1.1',
      'python-requests/2.31.0',
      'curl/8.4.0',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)',
      'ClaudeBot/1.0',
    ]) {
      expect(isWebCrawler(ua)).toBe(true);
    }
  });

  test('does not flag a normal browser', () => {
    expect(
      isWebCrawler(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      ),
    ).toBe(false);
  });

  test('filterBots only fires with a crawler user-agent', () => {
    expect(matchInboundFilter({ ...base, userAgent: 'Googlebot/2.1' }, { filterBots: true })).toBe(
      'web_crawler',
    );
    expect(
      matchInboundFilter({ ...base, userAgent: 'Mozilla/5.0 Chrome/124' }, { filterBots: true }),
    ).toBeNull();
    // No user-agent on the event: nothing to match.
    expect(matchInboundFilter(base, { filterBots: true })).toBeNull();
  });
});

describe('precedence and no-op behavior', () => {
  test('empty / undefined filters are a clean no-op', () => {
    expect(matchInboundFilter(base, undefined)).toBeNull();
    expect(matchInboundFilter(base, null)).toBeNull();
    expect(matchInboundFilter(base, {})).toBeNull();
    expect(matchInboundFilter(base, { ignoreErrors: [], filterBots: false })).toBeNull();
    expect(compileInboundFilters({}).active).toBe(false);
    expect(compileInboundFilters({ ignoreErrors: ['   '] }).active).toBe(false);
  });

  test('error message wins over release when both match (declaration order)', () => {
    const compiled = compileInboundFilters({
      ignoreErrors: ['*not a function*'],
      ignoreReleases: ['web@1.2.3'],
    });
    expect(matchCompiledFilter(base, compiled)).toBe('error_message');
  });

  test('compiling once and reusing across events works', () => {
    const compiled = compileInboundFilters({ ignoreEnvironments: ['production'] });
    expect(matchCompiledFilter(base, compiled)).toBe('environment');
    expect(matchCompiledFilter({ ...base, environment: 'staging' }, compiled)).toBeNull();
  });
});

describe('inboundFilterInput extraction', () => {
  test('pulls user-agent from request headers (case-insensitive) and frame paths', () => {
    const payload: SentryEventPayload = {
      platform: 'javascript',
      request: { headers: { 'User-Agent': 'Googlebot/2.1', Accept: '*/*' } },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'boom',
            stacktrace: {
              frames: [
                { filename: 'app/a.js', in_app: true },
                { abs_path: 'chrome-extension://x/b.js', in_app: false },
                { module: 'node:internal/c' },
              ],
            },
          },
        ],
      },
    };
    const input = inboundFilterInput(payload, {
      message: 'TypeError: boom',
      errorType: 'TypeError',
      release: undefined,
      environment: 'production',
    });
    expect(input.userAgent).toBe('Googlebot/2.1');
    expect(input.paths).toEqual(['app/a.js', 'chrome-extension://x/b.js', 'node:internal/c']);
    expect(matchCompiledFilter(input, compileInboundFilters({ filterBots: true }))).toBe(
      'web_crawler',
    );
    expect(
      matchCompiledFilter(input, compileInboundFilters({ ignorePaths: ['chrome-extension://*'] })),
    ).toBe('file_path');
  });

  test('no request headers yields an undefined user-agent', () => {
    const payload: SentryEventPayload = { platform: 'javascript' };
    const input = inboundFilterInput(payload, { message: 'x', environment: 'production' });
    expect(input.userAgent).toBeUndefined();
    expect(input.paths).toEqual([]);
  });
});
