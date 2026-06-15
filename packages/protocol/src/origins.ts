/**
 * Allowed-origin matching for DSN keys (Sentry's per-key "Allowed Domains"). A
 * browser DSN is public by design, so if it leaks into another site the events
 * still carry an `Origin`/`Referer`. A key with an allowlist accepts events only
 * from those origins, so a copied DSN cannot report from someone else's page.
 *
 * Pure and string-only so it unit-tests like the inbound-filters and ssrf
 * modules; the ingest action calls it before reading the body and rejects with
 * 403 on a mismatch. An empty allowlist is a clean no-op (allow all), and a
 * request with no `Origin`/`Referer` (a server-side SDK) is allowed, since the
 * allowlist only governs browser origins.
 *
 * Patterns match the request origin's host (port ignored) and optional scheme:
 *  - `*`                      allow any origin
 *  - `example.com`            host match under any scheme
 *  - `*.example.com`          the apex and any subdomain, any scheme
 *  - `https://example.com`    host match only under https
 *  - `https://*.example.com`  scheme + subdomain wildcard
 * Only `*` is special in a host; every other character is matched literally.
 */

/** Parsed scheme + host (no port) of a request origin. */
interface ParsedOrigin {
  scheme: string;
  host: string;
}

function parseOrigin(value: string): ParsedOrigin | null {
  try {
    const u = new URL(value);
    return { scheme: u.protocol.replace(/:$/, '').toLowerCase(), host: u.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * The effective origin of an ingest request: the `Origin` header when present
 * (ignoring the literal `null` that sandboxed/file origins send), else the
 * `Referer`'s origin, else null (a non-browser request).
 */
export function requestOrigin(
  originHeader: string | null | undefined,
  referer: string | null | undefined,
): string | null {
  if (originHeader && originHeader !== 'null') return originHeader;
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // fall through
    }
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether a host matches a host pattern (`*` is the only wildcard). */
function hostMatches(host: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '') return pattern === '*';
  if (pattern.startsWith('*.')) {
    const bare = pattern.slice(2);
    return host === bare || host.endsWith(`.${bare}`);
  }
  if (pattern.includes('*')) {
    const re = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
    return re.test(host);
  }
  return host === pattern;
}

function patternMatches(origin: ParsedOrigin, raw: string): boolean {
  let pattern = raw.trim().toLowerCase().replace(/\/+$/, '');
  if (!pattern) return false;
  if (pattern === '*') return true;

  let scheme: string | null = null;
  const schemeIdx = pattern.indexOf('://');
  if (schemeIdx >= 0) {
    scheme = pattern.slice(0, schemeIdx);
    pattern = pattern.slice(schemeIdx + 3);
  }
  // Strip any path and port from the host pattern.
  const host = pattern.replace(/\/.*$/, '').replace(/:\d+$/, '');

  if (scheme && scheme !== '*' && scheme !== origin.scheme) return false;
  return hostMatches(origin.host, host);
}

/**
 * Whether `origin` is permitted by `patterns`. An empty/`*` allowlist permits
 * everything; a null origin (no `Origin`/`Referer`, i.e. a server-side request)
 * is permitted; an origin that is present but unparseable or unmatched is denied.
 */
export function originAllowed(origin: string | null, patterns: string[]): boolean {
  const list = patterns.map((p) => p.trim()).filter(Boolean);
  if (list.length === 0 || list.includes('*')) return true;
  if (!origin) return true;
  const parsed = parseOrigin(origin);
  if (!parsed) return false;
  return list.some((p) => patternMatches(parsed, p));
}
