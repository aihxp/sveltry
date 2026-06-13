import { httpRouter } from 'convex/server';
import { corsPreflight } from '@sveltry/protocol';
import { httpAction } from './_generated/server';
import { ingest } from './ingest';

const http = httpRouter();

// Sentry SDKs POST to `/api/<projectId>/envelope/` (modern) or
// `/api/<projectId>/store/` (legacy). Match the whole `/api/` prefix and let the
// ingest action parse the project id and endpoint from the path.
http.route({ pathPrefix: '/api/', method: 'POST', handler: ingest });

// CORS preflight for browser SDKs hitting the ingest origin.
http.route({
  pathPrefix: '/api/',
  method: 'OPTIONS',
  handler: httpAction(async (_ctx, request) => corsPreflight(request.headers.get('origin') ?? '*')),
});

// Liveness probe for load balancers / uptime checks.
http.route({
  path: '/healthz',
  method: 'GET',
  handler: httpAction(
    async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
  ),
});

export default http;
