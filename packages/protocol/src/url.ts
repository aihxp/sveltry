/**
 * Return `value` only when it is a well-formed `http:`/`https:` URL, otherwise
 * `undefined`. Used to sanitize third-party / SDK-supplied URLs (commit URLs,
 * tracker URLs) before they are stored and later rendered into an anchor href,
 * defeating stored XSS via a `javascript:` or `data:` scheme.
 */
export function httpUrlOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}
