import { httpRouter } from 'convex/server';
import { corsPreflight } from '@sveltry/protocol';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './betterauth';
import { uploadCommits } from './commits';
import { ingest } from './ingest';
import { apiV1 } from './publicApi';
import { uploadArtifact } from './sourcemaps';
import { recordDeployHttp } from './usage';

const http = httpRouter();

// Better Auth identity handler (/api/auth/*), served by Convex.
authComponent.registerRoutes(http, createAuth);

// Sentry SDKs POST to `/api/<projectId>/envelope/` (modern) or
// `/api/<projectId>/store/` (legacy). Match the whole `/api/` prefix and let the
// ingest action parse the project id and endpoint from the path.
http.route({ pathPrefix: '/api/', method: 'POST', handler: ingest });

// Public API (v1), authenticated by an organization API token (Bearer). GET is
// read-only; POST is for triage (write-scoped). Mounted on the more specific
// `/api/v1/` prefix; `/api/` POST ingest is unaffected (longer prefix wins for
// `/api/v1/` paths). OPTIONS is covered by the `/api/` preflight handler below.
http.route({ pathPrefix: '/api/v1/', method: 'GET', handler: apiV1 });
http.route({ pathPrefix: '/api/v1/', method: 'POST', handler: apiV1 });

// Source-map / build-artifact upload (DSN-key authenticated), used by CI and the
// SDK uploader to publish a release's bundles + maps for stack-frame resolution.
http.route({ path: '/artifacts/upload', method: 'POST', handler: uploadArtifact });

// Deploy API (DSN-key authenticated): record a deploy against a release.
http.route({ path: '/deploys', method: 'POST', handler: recordDeployHttp });

// Release commits (DSN-key authenticated): upload commit metadata for a release,
// powering suspect-commit association (Sentry's `set-commits`).
http.route({ path: '/releases/commits', method: 'POST', handler: uploadCommits });

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
