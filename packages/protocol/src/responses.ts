import { formatRateLimits, type RateLimitQuota } from './ratelimit.js';

/**
 * Build the HTTP responses a Sentry-compatible ingest endpoint returns. The
 * key compatibility rules:
 *  - Success is always `200` with JSON `{"id":"<32-hex>"}` and NO rate-limit
 *    headers (any `X-Sentry-Rate-Limits` header, even on a 200, makes the SDK
 *    drop the listed categories).
 *  - Malformed bodies/auth get a 4xx with the reason in `X-Sentry-Error`.
 *  - Throttling uses `429` + `Retry-After`, or `X-Sentry-Rate-Limits` to
 *    suppress specific categories without failing the request.
 */

export const SENTRY_ENVELOPE_CONTENT_TYPE = 'application/x-sentry-envelope';

/** A 200 acknowledging ingestion. Echoes the event id; emits no rate-limit headers. */
export function ingestSuccess(
  eventId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ id: eventId }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...extraHeaders,
    },
  });
}

/** A 4xx for malformed bodies/auth, with the reason surfaced via `X-Sentry-Error`. */
export function ingestError(
  status: number,
  reason: string,
  causes: string[] = [],
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ detail: reason, causes }), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-sentry-error': reason,
      ...extraHeaders,
    },
  });
}

/**
 * A 429 that throttles everything for `retryAfterSeconds`. `extraHeaders` lets the
 * caller attach CORS headers so browser SDKs can actually read the `Retry-After`
 * and `X-Sentry-Rate-Limits` values (a cross-origin 429 with no
 * `Access-Control-Allow-Origin` is opaque to the browser and the backoff is lost).
 */
export function rateLimited(
  retryAfterSeconds: number,
  quotas?: RateLimitQuota[],
  extraHeaders: Record<string, string> = {},
): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'retry-after': String(Math.ceil(retryAfterSeconds)),
    ...extraHeaders,
  };
  if (quotas && quotas.length > 0) {
    headers['x-sentry-rate-limits'] = formatRateLimits(quotas);
  }
  return new Response(JSON.stringify({ detail: 'rate limited' }), { status: 429, headers });
}

/** Standard CORS headers for browser SDKs hitting the ingest/HTTP-action origin. */
export function corsHeaders(origin = '*'): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type, X-Sentry-Auth, X-Sentry-Error, Authorization',
    'access-control-expose-headers': 'X-Sentry-Rate-Limits, X-Sentry-Error, Retry-After',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

/** The preflight response for an ingest endpoint. */
export function corsPreflight(origin = '*'): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
