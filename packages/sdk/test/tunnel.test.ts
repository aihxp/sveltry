import { describe, expect, test } from 'bun:test';
import { createTunnelHandler } from '../src/tunnel.js';

/** A minimal Sentry envelope whose header optionally carries a `dsn`. */
function envelope(dsn?: string): Uint8Array {
  const header = dsn ? JSON.stringify({ dsn }) : JSON.stringify({ event_id: 'abc' });
  return new TextEncoder().encode(
    `${header}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify({})}\n`,
  );
}

function post(body: Uint8Array): Request {
  return new Request('http://localhost/monitoring', { method: 'POST', body });
}

const DSN = 'https://publickey@ingest.example.com/42';

describe('createTunnelHandler', () => {
  test('forwards a well-formed envelope to the DSN host when it is allow-listed', async () => {
    let target = '';
    const handler = createTunnelHandler({
      allowedHosts: ['ingest.example.com'],
      fetch: async (url) => {
        target = String(url);
        return new Response('ok', { status: 200 });
      },
    });
    const res = await handler(post(envelope(DSN)));
    expect(res.status).toBe(200);
    expect(new URL(target).host).toBe('ingest.example.com');
  });

  test('does NOT forward to a DSN host outside the allow-list (open-proxy guard)', async () => {
    let forwarded = false;
    const handler = createTunnelHandler({
      allowedHosts: ['ingest.example.com'],
      fetch: async () => {
        forwarded = true;
        return new Response('', { status: 200 });
      },
    });
    const res = await handler(post(envelope('https://k@evil.example.com/1')));
    expect(res.status).toBe(403);
    expect(forwarded).toBe(false);
  });

  test('does NOT forward when the envelope header has no usable DSN', async () => {
    let forwarded = false;
    const handler = createTunnelHandler({
      allowedHosts: ['ingest.example.com'],
      fetch: async () => {
        forwarded = true;
        return new Response('', { status: 200 });
      },
    });
    const res = await handler(post(envelope(undefined)));
    expect(res.status).toBe(400);
    expect(forwarded).toBe(false);
  });

  test('honors a server-configured upstreamOrigin instead of the payload host', async () => {
    let target = '';
    const handler = createTunnelHandler({
      allowedHosts: ['ingest.example.com'],
      upstreamOrigin: 'https://proxy.internal:8443',
      fetch: async (url) => {
        target = String(url);
        return new Response('ok', { status: 200 });
      },
    });
    const res = await handler(post(envelope(DSN)));
    expect(res.status).toBe(200);
    // The allow-list is still checked against the payload DSN host, but the actual
    // forward goes to the operator-configured origin, not the attacker-supplied one.
    expect(new URL(target).host).toBe('proxy.internal:8443');
  });
});
