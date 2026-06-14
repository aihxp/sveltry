import { httpRouter } from 'convex/server';
import { corsPreflight } from '@sveltry/protocol';
import { httpAction } from './_generated/server';
import { ingest } from './ingest';
import { uploadArtifact } from './sourcemaps';

const http = httpRouter();

// Sentry SDKs POST to `/api/<projectId>/envelope/` (modern) or
// `/api/<projectId>/store/` (legacy). Match the whole `/api/` prefix and let the
// ingest action parse the project id and endpoint from the path.
http.route({ pathPrefix: '/api/', method: 'POST', handler: ingest });

// Source-map / build-artifact upload (DSN-key authenticated), used by CI and the
// SDK uploader to publish a release's bundles + maps for stack-frame resolution.
http.route({ path: '/artifacts/upload', method: 'POST', handler: uploadArtifact });

const preflight = httpAction(async (_ctx, request) =>
  corsPreflight(request.headers.get('origin') ?? '*'),
);

// CORS preflight for browser SDKs hitting the ingest origin.
http.route({ pathPrefix: '/api/', method: 'OPTIONS', handler: preflight });
http.route({ path: '/artifacts/upload', method: 'OPTIONS', handler: preflight });

// Liveness probe for load balancers / uptime checks.
http.route({
  path: '/healthz',
  method: 'GET',
  handler: httpAction(
    async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
  ),
});

export default http;
