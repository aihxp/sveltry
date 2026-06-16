import { assertResolvedHostSafe, assertSafeOutboundTarget } from '@sveltry/protocol';

// Re-export the pure SSRF host guard (unit-tested in @sveltry/protocol) so existing
// imports keep working.
export { assertSafeOutboundTarget };

// DNS-over-HTTPS resolver used to catch a hostname whose A/AAAA record is a blocked
// IP (DNS rebinding) -- the default Convex runtime has no `node:dns`, so DoH is the
// only in-runtime way to resolve. Configurable: set `SSRF_DOH_RESOLVER` to a custom
// DoH endpoint, or to `off` / empty to disable the resolve-time check (the literal
// host guard stays on regardless). Defaults to Cloudflare.
const DOH_RESOLVER: string | null = (() => {
  const v = process.env.SSRF_DOH_RESOLVER;
  if (v === undefined) return 'https://cloudflare-dns.com/dns-query';
  if (v === '' || v.toLowerCase() === 'off') return null;
  return v;
})();

/** Resolve a name's A + AAAA records via DoH. Throws on any failure (the caller
 * treats a throw as fail-open). Never recurses through the SSRF guard -- the
 * resolver endpoint is a fixed, trusted operator config. */
async function dohResolve(name: string): Promise<string[]> {
  if (!DOH_RESOLVER) throw new Error('dns resolution disabled');
  const ips: string[] = [];
  for (const type of ['A', 'AAAA']) {
    const url = `${DOH_RESOLVER}?name=${encodeURIComponent(name)}&type=${type}`;
    const res = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) continue;
    const data = (await res.json()) as { Answer?: { type?: number; data?: string }[] };
    for (const ans of data.Answer ?? []) {
      // type 1 = A, 28 = AAAA; ignore CNAMEs (the resolver chases them to A/AAAA).
      if ((ans.type === 1 || ans.type === 28) && typeof ans.data === 'string') ips.push(ans.data);
    }
  }
  // No records (NXDOMAIN, or an internal name the public resolver can't see) ->
  // throw so the caller fails open and the literal guard alone decides.
  if (ips.length === 0) throw new Error('no addresses resolved');
  return ips;
}

/**
 * Fetch with SSRF protection that survives redirects. The host guard is only
 * meaningful if it is enforced on every hop: a target that passes could otherwise
 * 3xx-redirect to a blocked host (e.g. cloud metadata). Each hop is validated two
 * ways -- the synchronous literal/scheme guard, and (unless disabled) a DoH resolve
 * that rejects a hostname pointing at a blocked IP. Redirects are followed only
 * when safe: 307/308 preserve the method + body (and we re-validate the new host);
 * 301/302/303 are followed only for bodyless GET/HEAD, so a signed POST body is
 * never silently re-sent to a different host.
 */
export async function safeFetch(
  target: string,
  init: RequestInit = {},
  maxHops = 5,
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const bodyless = method === 'GET' || method === 'HEAD';
  let current = target;
  for (let hop = 0; hop <= maxHops; hop++) {
    assertSafeOutboundTarget(current);
    if (DOH_RESOLVER) await assertResolvedHostSafe(new URL(current).hostname, dohResolve);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      if (res.status === 307 || res.status === 308 || bodyless) {
        current = new URL(location, current).toString();
        continue;
      }
      return res; // don't silently replay a non-GET body across a 301/302/303
    }
    return res;
  }
  throw new Error('too many redirects');
}
