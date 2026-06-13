import { dsnFromEnvelopeHeader, ingestUrlFromDsn } from './dsn.js';

/** Options controlling which DSNs a tunnel will forward to. */
export interface TunnelOptions {
  /**
   * Allowed ingest hosts. A tunneled envelope is only forwarded if its DSN host
   * is in this list, preventing the tunnel from being abused as an open proxy.
   */
  allowedHosts: string[];
  /** Optional override of the upstream origin (defaults to the DSN's own host). */
  upstreamOrigin?: string;
  /** `fetch` implementation (defaults to the global). */
  fetch?: typeof fetch;
}

/**
 * Create a request handler that forwards Sentry "tunneled" envelopes to the
 * upstream ingest endpoint. Mount it at the path you pass to
 * `Sentry.init({ tunnel: '/monitoring' })`. Works in any Fetch-API runtime
 * (SvelteKit `+server.ts`, Bun, Cloudflare Workers).
 *
 * ```ts
 * // src/routes/monitoring/+server.ts
 * import { createTunnelHandler } from '@aihxp/sveltry-sdk';
 * const tunnel = createTunnelHandler({ allowedHosts: ['ingest.sveltry.example.com'] });
 * export const POST = ({ request }) => tunnel(request);
 * ```
 */
export function createTunnelHandler(
  options: TunnelOptions,
): (request: Request) => Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  const allowed = new Set(options.allowedHosts);

  return async (request: Request): Promise<Response> => {
    const body = new Uint8Array(await request.arrayBuffer());
    const dsn = dsnFromEnvelopeHeader(body);
    if (!dsn) {
      return new Response(JSON.stringify({ detail: 'missing dsn in envelope header' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    let upstream = ingestUrlFromDsn(dsn);
    if (!upstream) {
      return new Response(JSON.stringify({ detail: 'invalid dsn' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const upstreamUrl = new URL(upstream);
    if (!allowed.has(upstreamUrl.host)) {
      return new Response(JSON.stringify({ detail: 'dsn host not allowed' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (options.upstreamOrigin) {
      const o = new URL(options.upstreamOrigin);
      upstreamUrl.protocol = o.protocol;
      upstreamUrl.host = o.host;
      upstream = upstreamUrl.toString();
    }

    return doFetch(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body,
    });
  };
}
