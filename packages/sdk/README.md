# @aihxp/sveltry-sdk

Point official [Sentry](https://sentry.io) SDKs at a self-hosted
[Sveltry](https://github.com/aihxp/sveltry) deployment. Sveltry implements the
Sentry ingestion wire protocol, so you keep using the battle-tested `@sentry/*`
clients and only change where events are sent.

> This package contains no telemetry client of its own. It is a thin layer of
> helpers (DSN builder, recommended init options, and a tunnel handler) around
> the SDK you already use.

## Install

```sh
# from GitHub Packages (configure @aihxp registry in .npmrc first)
bun add @aihxp/sveltry-sdk
bun add @sentry/sveltekit   # or @sentry/node, @sentry/browser, ...
```

```ini
# .npmrc
@aihxp:registry=https://npm.pkg.github.com
```

## Usage (SvelteKit)

```ts
// src/instrumentation.server.ts (and src/hooks.client.ts)
import * as Sentry from '@sentry/sveltekit';
import { recommendedSentryOptions } from '@aihxp/sveltry-sdk';

Sentry.init(
  recommendedSentryOptions({
    ingestHost: 'https://ingest.sveltry.example.com',
    publicKey: 'YOUR_PROJECT_PUBLIC_KEY',
    projectId: 1,
    release: import.meta.env.VITE_RELEASE,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
  }),
);
```

You can also just build a DSN and pass it to any SDK:

```ts
import { buildSveltryDsn } from '@aihxp/sveltry-sdk';

const dsn = buildSveltryDsn({
  ingestHost: 'https://ingest.sveltry.example.com',
  publicKey: 'YOUR_PROJECT_PUBLIC_KEY',
  projectId: 1,
});
// => https://YOUR_PROJECT_PUBLIC_KEY@ingest.sveltry.example.com/1
```

## Tunneling (defeat ad-blockers)

Browser ad-blockers often block requests to `*.sentry.io`-style ingest hosts.
Route envelopes through your own origin instead:

```ts
// src/routes/monitoring/+server.ts
import { createTunnelHandler } from '@aihxp/sveltry-sdk';

const tunnel = createTunnelHandler({ allowedHosts: ['ingest.sveltry.example.com'] });
export const POST = ({ request }) => tunnel(request);
```

```ts
Sentry.init(recommendedSentryOptions({ /* ... */, tunnel: '/monitoring' }));
```

The handler reads the DSN from the envelope header, validates it against
`allowedHosts` (so it can't be abused as an open proxy), and forwards the raw
envelope to the upstream ingest endpoint.

## License

Apache-2.0
