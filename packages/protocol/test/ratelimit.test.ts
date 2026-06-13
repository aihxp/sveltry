import { describe, expect, test } from 'bun:test';
import { formatRateLimits, parseRateLimits } from '../src/ratelimit.js';

describe('rate limit header', () => {
  test('parses a multi-quota header', () => {
    const quotas = parseRateLimits('60:transaction:key, 2700:default;error;security:organization');
    expect(quotas).toHaveLength(2);
    expect(quotas[0]).toMatchObject({ retryAfter: 60, categories: ['transaction'], scope: 'key' });
    expect(quotas[1]).toMatchObject({
      retryAfter: 2700,
      categories: ['default', 'error', 'security'],
      scope: 'organization',
    });
  });

  test('empty categories means all', () => {
    const quotas = parseRateLimits('60::organization');
    expect(quotas[0]!.categories).toEqual([]);
    expect(quotas[0]!.scope).toBe('organization');
  });

  test('format round-trips', () => {
    const header = formatRateLimits([
      { retryAfter: 60, categories: ['transaction'], scope: 'key' },
      { retryAfter: 30, categories: [], scope: 'organization' },
    ]);
    expect(header).toBe('60:transaction:key, 30::organization');
    const reparsed = parseRateLimits(header);
    expect(reparsed[0]!.categories).toEqual(['transaction']);
    expect(reparsed[1]!.categories).toEqual([]);
  });

  test('handles fractional retry_after and empty input', () => {
    expect(parseRateLimits('1.5:error')[0]!.retryAfter).toBeCloseTo(1.5);
    expect(parseRateLimits('')).toEqual([]);
  });
});
