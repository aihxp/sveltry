/**
 * Helpers for the `X-Sentry-Rate-Limits` response header that SDKs honor.
 *
 * Grammar (comma-separated quotas):
 *   retry_after:categories:scope:reason_code:namespaces
 * where `categories` is a semicolon-separated list (empty means "all").
 * See https://develop.sentry.dev/sdk/foundations/transport/rate-limiting/.
 */

export type RateLimitScope = 'organization' | 'project' | 'key' | (string & {});

export interface RateLimitQuota {
  /** Seconds until the limit expires (may be fractional). */
  retryAfter: number;
  /** Affected data categories; empty array means all. */
  categories: string[];
  scope?: RateLimitScope;
  reasonCode?: string;
  namespaces?: string[];
}

/** Serialize quotas into an `X-Sentry-Rate-Limits` header value. */
export function formatRateLimits(quotas: RateLimitQuota[]): string {
  return quotas
    .map((q) => {
      const cats = q.categories.join(';');
      const scope = q.scope ?? '';
      const reason = q.reasonCode ?? '';
      const ns = (q.namespaces ?? []).join(';');
      // Trim trailing empty fields for compactness.
      const fields = [String(q.retryAfter), cats, scope, reason, ns];
      while (fields.length > 2 && fields[fields.length - 1] === '') fields.pop();
      return fields.join(':');
    })
    .join(', ');
}

/** Parse an `X-Sentry-Rate-Limits` header value into structured quotas. */
export function parseRateLimits(headerValue: string): RateLimitQuota[] {
  if (!headerValue.trim()) return [];
  const quotas: RateLimitQuota[] = [];
  for (const raw of headerValue.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const [retry, cats = '', scope = '', reason = '', ns = ''] = part.split(':');
    const retryAfter = Number.parseFloat(retry ?? '');
    if (Number.isNaN(retryAfter)) continue;
    quotas.push({
      retryAfter,
      categories: cats ? cats.split(';').filter(Boolean) : [],
      scope: scope || undefined,
      reasonCode: reason || undefined,
      namespaces: ns ? ns.split(';').filter(Boolean) : undefined,
    });
  }
  return quotas;
}
