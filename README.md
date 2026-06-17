<div align="center">

<img src="apps/dashboard/static/favicon.svg" width="72" alt="Sveltry" />

# Sveltry

**The reactive, self-hosted, Sentry-compatible error tracker built for the modern web.**

Point the official Sentry SDKs you already use at your own infrastructure. Sveltry speaks the
Sentry wire protocol, groups your errors into issues, and streams them to a live dashboard.

[![CI](https://github.com/aihxp/sveltry/actions/workflows/ci.yml/badge.svg)](https://github.com/aihxp/sveltry/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Made with Bun](https://img.shields.io/badge/Bun-1.3-black?logo=bun)](https://bun.com)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2-ff3e00?logo=svelte)](https://svelte.dev)
[![Convex](https://img.shields.io/badge/Convex-self--hosted-orange)](https://www.convex.dev)

</div>

---

> [!NOTE]
> Sveltry is an independent, open-source project. It is not affiliated with, endorsed by, or
> sponsored by Functional Software, Inc. or the Sentry project. It implements a compatible subset
> of the Sentry ingestion protocol so that unmodified official Sentry SDKs can report to a
> self-hosted Sveltry deployment.

## Why Sveltry

- **Sentry-compatible.** Change one DSN string and the official `@sentry/*` SDKs (SvelteKit, Node,
  browser, Python, Go, and the rest) send events straight to Sveltry. No custom client to maintain.
- **Reactive by default.** New issues appear in the dashboard the instant they are ingested, over a
  WebSocket, powered by Convex. No polling, no refresh.
- **Self-hosted.** Your data lives on your infrastructure: the app runs entirely on self-hosted
  open-source Convex (which uses Postgres only as its own internal storage engine) plus a SvelteKit
  app, all in Docker. The application itself never talks to Postgres directly.
- **Private.** Default PII scrubbing happens at ingest, before anything is written. Identity never
  leaves your Convex deployment.

## How it works

```
  +--------------+   Sentry envelope    +---------------------------+
  | Your app +   |  POST /api/ID/       |  Convex HTTP action        |
  | @sentry/ SDK |  ===== envelope/ ==> |  (ingest, .site origin)    |
  +--------------+                      |   parse, auth, scrub       |
                                        |   normalize, fingerprint   |
                                        +------------+--------------+
                                                     | mutation
                                                     v
                                        +---------------------------+
                       live WebSocket   |  Convex (backed by Postgres)|
  +--------------+ <==================== |  issues, events, alerts    |
  |  SvelteKit   |                      +---------------------------+
  |  dashboard   |   Better Auth runs on Convex and issues an RS256 JWT;
  +--------------+   Convex verifies it and scopes data per organization.
```

Errors are grouped into **issues** by a stable fingerprint derived from the exception type and the
normalized stack trace, so a thousand occurrences of the same bug show up as one issue, not a
thousand rows. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Prerequisites: [Bun](https://bun.com) 1.3+, Docker, and `openssl`.

```sh
git clone https://github.com/aihxp/sveltry.git
cd sveltry
./scripts/setup.sh        # secrets, Postgres + Convex, deploy functions
bun run dev:dashboard     # http://localhost:5173
```

`setup.sh` brings up the self-hosted Convex backend (with its Postgres store), generates an admin
key, and deploys the backend functions. Better Auth runs on Convex, so its tables (user, session,
account, jwks) are created as part of the Convex deployment. Then:

1. Open the app, create an account and an organization.
2. Create a project. Copy its DSN.
3. Point a Sentry SDK at the DSN and throw an error:

```ts
import * as Sentry from '@sentry/sveltekit';

Sentry.init({
  // Use the exact DSN shown when you create the project. The scheme matches your
  // ingest origin: http for a local backend, https once it is behind TLS.
  dsn: 'http://YOUR_PUBLIC_KEY@127.0.0.1:3211/1',
});
```

The issue streams into your dashboard live. The optional [`@aihxp/sveltry-sdk`](packages/sdk)
helper builds DSNs, sets sensible defaults, and provides an ad-blocker-proof tunnel handler.

For production (TLS, domains, the Convex Postgres store, S3), see
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Project structure

```
sveltry/
├─ apps/
│  ├─ dashboard/        SvelteKit + Svelte 5 + Tailwind v4 dashboard, Better Auth
│  └─ backend/          Convex backend: ingest, grouping, queries, alerts, crons
├─ packages/
│  ├─ protocol/         Sentry wire protocol: DSN, envelope, auth, fingerprint (tested)
│  ├─ types/            Shared domain + Sentry payload types
│  └─ sdk/              @aihxp/sveltry-sdk: point Sentry SDKs at Sveltry
├─ infra/               docker-compose (Postgres + Convex), Caddyfile, env examples
└─ scripts/             setup.sh
```

## Tech stack

| Layer        | Choice                                                            |
| ------------ | ----------------------------------------------------------------- |
| Monorepo     | Bun workspaces + catalog                                          |
| Dashboard    | SvelteKit 2, Svelte 5 (runes), Tailwind CSS v4, shadcn-svelte     |
| Live data    | Convex (`convex-svelte`)                                          |
| Backend      | Self-hosted open-source Convex (HTTP actions, queries, crons)     |
| Database     | PostgreSQL 17 (storage for the self-hosted Convex backend)        |
| Auth         | Better Auth on Convex (email/password); orgs modeled in Convex; RS256 JWT |
| Compatibility| `@sveltry/protocol` (envelope parser, DSN, fingerprinting)        |

## Status

Sveltry's first milestone is a complete, genuinely usable **error-tracking vertical slice** that is
wire-compatible with the Sentry SDKs, including server-side **source-map symbolication** of minified
JavaScript stack traces, **performance monitoring** (transactions, p50/p95 latency, and a span
waterfall), **release health** (crash-free sessions and users per release), and **cron monitors**
(check-ins), **session replay** (rrweb playback), and **profiling** (flamegraphs). See the
[feature parity matrix](docs/FEATURE_PARITY.md) for the honest current-vs-planned breakdown
and the [roadmap](docs/ROADMAP.md) for what is next.

What works today: DSN-authenticated ingestion (envelope + legacy store), server-side grouping into
issues, the resolve/ignore/reopen workflow, full event payloads with stack traces, breadcrumbs and
tags, multi-tenant organizations and projects with DSN keys, alert rules to webhook/Discord/Slack,
per-key rate limiting, PII scrubbing, retention crons, and a live dashboard.

## Documentation

Start at the [documentation index](docs/README.md). Highlights:

- [Quickstart](docs/QUICKSTART.md) - send your first error in five minutes
- [Integrations](docs/INTEGRATIONS.md) - install an SDK for your platform
- [Self-hosting guide](docs/SELF_HOSTING.md)
- [Sentry compatibility](docs/SENTRY_COMPATIBILITY.md)
- [Public API](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Feature parity matrix](docs/FEATURE_PARITY.md) · [Roadmap](docs/ROADMAP.md)
- [SDK](packages/sdk/README.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

## Contributing

Contributions are welcome. Run `bun install`, then `bun run --filter '@sveltry/protocol' test`,
`bun run check`, and `bun run build` before opening a PR. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE) © The Sveltry Authors.
