import { assertSafeOutboundTarget } from '@sveltry/protocol';

// Re-export the pure SSRF host guard (unit-tested in @sveltry/protocol) so existing
// imports keep working.
export { assertSafeOutboundTarget };

/**
 * Fetch with SSRF protection that survives redirects. The host denylist is only
 * meaningful if it is enforced on every hop: a target that passes the guard could
 * otherwise 3xx-redirect to a blocked host (e.g. cloud metadata), and the browser
 * fetch default (`redirect: 'follow'`) would send the credentialed request there.
 * This validates each URL, follows redirects manually, and re-validates the
 * Location of every hop, bounded by `maxHops`.
 */
export async function safeFetch(
  target: string,
  init: RequestInit = {},
  maxHops = 5,
): Promise<Response> {
  let current = target;
  for (let hop = 0; hop <= maxHops; hop++) {
    assertSafeOutboundTarget(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}
