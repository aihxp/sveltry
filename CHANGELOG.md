# Changelog

All notable changes to Sveltry are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Latency time-series.** An hourly cron rolls raw transaction durations into per-(project,
  transaction, hour) fixed-bucket histograms (`transactionRollups`). A `transactionTrend`
  query derives p50/p95 over arbitrary windows from the merged histograms, and the Performance
  page shows a p95-over-time chart. Percentiles over long windows no longer need to scan raw
  transactions.
- **Profiling.** `profile` envelope items are persisted; their samples/stacks/frames are
  aggregated into a flamegraph rendered on a new Profiles page.
- **Session replay.** `replay_event` and `replay_recording` envelope items are persisted
  (metadata in a `replays` table, the rrweb recording in file storage). A new Replays page
  lists recordings, and the detail page plays them back with rrweb-player (the browser
  decompresses the recording stream).
- **Cron monitors.** `check_in` envelope items are persisted (upserted by id, so an
  in-progress start and its terminal status are one run). A new Monitors page shows each
  monitor's latest status and recent check-ins.
- **Email alerts.** The `email` alert channel now delivers over SMTP via a Convex Node
  action, configured by `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/
  `SMTP_FROM`. It is a clean no-op until `SMTP_HOST` is set.
- **Aggregated session buckets.** `sessions` (aggregate) envelope items are now persisted
  and folded into release-health crash-free rates alongside individual sessions.
- **Release health.** Individual `session` envelope items are now persisted (upserted by
  sid, so the final status wins) and aggregated into crash-free sessions and crash-free
  users per release. A new Releases page surfaces the rates. Aggregated `sessions` buckets
  are accepted but not yet folded in.
- **Performance monitoring.** `transaction` envelope items are now persisted with their spans.
  A new Performance page lists transactions with per-transaction p50/p95/avg/max latency
  (computed over a recent-window sample) and failure rate, and a transaction detail page
  renders the span waterfall. Ingest is idempotent per transaction `event_id`.
- **Source-map symbolication.** Per-release artifact upload at `POST /artifacts/upload`
  (DSN-key authenticated) and on-ingest resolution of minified JavaScript stack frames to
  original file, line, function, and source context. The dashboard shows resolved frames with
  a `source-mapped` badge and a per-project Source maps panel. The `@aihxp/sveltry-sdk`
  gains `uploadSourceMaps()` (for CI) and `parseDsn()`.

### Fixed

- **Gzip/deflate envelope decompression.** Request-body decompression now uses `fflate`
  (pure JS) instead of `DecompressionStream`, which is absent from the self-hosted Convex
  isolate. Previously every gzip- or deflate-compressed SDK envelope returned `400` and the
  event was dropped; compressed traffic from official SDKs now ingests correctly.

## [0.1.0] - 2026-06-13

The first release: a complete, Sentry-wire-compatible error-tracking vertical slice.

### Added

- **`@sveltry/protocol`**: a standalone, tested implementation of the Sentry ingestion wire
  protocol: DSN parsing, a byte-accurate envelope parser (honoring optional item `length` and
  binary payloads), auth extraction from the `X-Sentry-Auth` header or query string, transparent
  gzip/deflate decompression, event normalization, issue fingerprinting (SHA-1 over a normalized
  grouping signature), and the response contract.
- **Convex backend** (self-hosted): Sentry-compatible ingestion HTTP actions for the
  `/api/<id>/envelope/` and `/api/<id>/store/` endpoints; issue grouping and the
  resolve/ignore/reopen status workflow; reactive queries for issues, events, projects, and
  releases; alert rules (new issue, regression, event frequency) delivered to webhook/Discord/Slack;
  per-key fixed-window rate limiting; default PII scrubbing at ingest; and retention/triage crons.
- **SvelteKit dashboard**: a live issue stream, issue detail with stack traces, breadcrumbs and
  tags, projects with DSN management, and alert-rule configuration. Built on Svelte 5, Tailwind
  CSS v4, and shadcn-svelte, with dark mode.
- **Better Auth** integration: email/password auth and organizations backed by Postgres, bridged to
  Convex via an RS256 JWT and a JWKS-verified Custom JWT provider for per-organization data scoping.
- **`@aihxp/sveltry-sdk`**: helpers to point official Sentry SDKs at a Sveltry deployment (DSN
  builder, recommended init options, and an ad-blocker-proof tunnel handler).
- **Infrastructure**: a Docker Compose stack (Postgres + open-source Convex + the Convex admin
  dashboard), an optional containerized app service, a Caddy reverse-proxy example, and a one-command
  `scripts/setup.sh`.
- **Tooling**: Bun workspaces with a shared dependency catalog, CI (test/type-check/build/format),
  Changesets-based releases, and a publishable SDK package.

[0.1.0]: https://github.com/aihxp/sveltry/releases/tag/v0.1.0
