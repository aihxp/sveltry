import { afterEach, describe, expect, test, vi } from 'vitest';

// `net.ts` reads SSRF_DOH_RESOLVER once at module load. Disable the DoH resolve
// here (dynamic import AFTER setting the env) so these tests exercise only the
// synchronous literal/scheme guard against a mocked global fetch -- no real DNS
// or network. The DoH resolver has its own coverage via the pure predicates in
// `@sveltry/protocol`'s ssrf tests; what is untested (and tested here) is the
// fetch wrapper's per-hop re-validation of redirect targets.
process.env.SSRF_DOH_RESOLVER = 'off';
const { safeFetch } = await import('./net');

afterEach(() => vi.unstubAllGlobals());

describe('safeFetch redirect SSRF re-validation', () => {
  test('rejects a redirect hop whose Location points at a blocked (link-local) host', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }),
    );
    // GET is bodyless, so the 302 IS followed -- and the second hop's host (cloud
    // metadata) must be rejected by the pre-fetch guard before it is ever fetched.
    await expect(safeFetch('https://hook.example/x', { method: 'GET' })).rejects.toThrow();
    expect(calls).toEqual(['https://hook.example/x']);
  });

  test('does not replay a non-GET body across a 301/302/303 (returns the redirect as-is)', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: 'https://other.example/' },
        });
      }),
    );
    const res = await safeFetch('https://hook.example/x', { method: 'POST', body: 'payload' });
    expect(res.status).toBe(302); // returned, not followed
    expect(calls).toEqual(['https://hook.example/x']); // the POST body was never re-sent
  });

  test('follows a 307 to another safe host, preserving the method', async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        seen.push({ url, method: init?.method });
        if (url.includes('first.example')) {
          return new Response(null, {
            status: 307,
            headers: { location: 'https://second.example/' },
          });
        }
        return new Response('ok', { status: 200 });
      }),
    );
    const res = await safeFetch('https://first.example/x', { method: 'POST', body: 'payload' });
    expect(res.status).toBe(200);
    expect(seen.map((s) => s.url)).toEqual(['https://first.example/x', 'https://second.example/']);
    expect(seen[1]!.method).toBe('POST'); // 307 preserves method + body, re-validated host
  });
});
