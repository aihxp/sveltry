import type { SentryAuth } from '@sveltry/types';

/**
 * Extract Sentry auth fields from a request. JS/browser SDKs put the credential
 * in the query string (`?sentry_key=...&sentry_version=7&sentry_client=...`) to
 * avoid a CORS preflight, while server SDKs use the `X-Sentry-Auth` header. A
 * compatible backend must accept both; the header takes precedence when present.
 */
export function extractAuth(headerValue: string | null, searchParams: URLSearchParams): SentryAuth {
  const fields: SentryAuth = {};

  if (headerValue) {
    // Header form: `Sentry sentry_version=7, sentry_key=..., sentry_client=...`
    const trimmed = headerValue.replace(/^Sentry\s+/i, '');
    for (const part of trimmed.split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key) fields[key] = decodeURIComponent(value);
    }
  }

  // Merge query-string fields (do not overwrite header values).
  for (const key of ['sentry_key', 'sentry_version', 'sentry_client', 'sentry_secret']) {
    if (fields[key] === undefined) {
      const v = searchParams.get(key);
      if (v !== null) fields[key] = v;
    }
  }

  return fields;
}

/** The DSN public key the backend must validate, or `undefined` if absent. */
export function publicKeyFromAuth(auth: SentryAuth): string | undefined {
  return auth.sentry_key;
}
