# Changelog

All notable changes to Sveltry are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Sveltry is now Convex-only (Postgres removed).** Auth runs entirely on Convex: identity uses
  `@convex-dev/better-auth` in component mode (email + password, served by Convex and proxied
  through the SvelteKit app), and organizations/membership/roles are modeled natively in Convex
  (`organizations` source of truth, `memberRoles` membership, `userSettings` active org). The
  dashboard's Postgres Better Auth instance, the `pg` dependency, and `DATABASE_URL` are gone.
  `requireOrg` resolves the active org from Convex. Verified end to end in a browser: sign up,
  onboarding, create org, dashboard, sign out, sign in, with authenticated Convex queries
  throughout. New backend env: `CONVEX_INTERNAL_SITE_URL` (the in-container origin for JWKS
  verification when the public site URL is a host-mapped port). Postgres remains only as the Convex backend's own store; the app no longer connects to it.

### Security

- **Hardened the outbound-request SSRF guard.** Every server-side fetch to a user-influenced
  target (alert webhooks, tracker `siteUrl`) now follows redirects manually and re-validates the
  host on every hop, so a target that passes the denylist can no longer redirect the credentialed
  request to a cloud-metadata endpoint. The host check also now blocks the whole link-local range
  in any encoding (including IPv4-mapped IPv6 like `::ffff:169.254.169.254`), closing a denylist
  bypass. The guard is now a unit-tested helper shared by the alert and tracker delivery paths.

### Added

- **Inbound data filters.** Per-project rules that drop matching error events at ingest, before
  they are stored, grouped, or counted against a quota (still HTTP 200, so SDKs do not retry).
  Filter by error message/type, release, environment, or stack-frame path (case-insensitive globs,
  `*`/`?` wildcards), and by known web-crawler user-agent. The matcher is a pure, unit-tested module
  in `@sveltry/protocol`; rules are configured on the project page and are a clean no-op when unset.
  Dropped events are counted under a new `filtered` usage reason, shown alongside dropped on the
  project's Usage card.
- **S3 / R2 storage offload.** Large blobs (source maps today) can be offloaded to an S3-compatible
  bucket instead of living inline in Convex, configured entirely by env vars (`S3_BUCKET`, ...). It
  is a clean no-op when unconfigured, so existing instances are unaffected; stack-trace resolution
  reads offloaded maps back transparently. The S3 work runs in a Convex Node action; the pure
  config/key logic is unit-tested.
- **Jira and Linear integrations.** Connect a project to Jira (REST v3) or Linear (GraphQL) and
  create a tracker ticket from a Sveltry issue, either on demand from the issue page or
  automatically when a new issue appears. Credentials are configured per project by the
  self-hoster, stored on the instance, and never returned to the browser; the outbound request is
  built by a shared, unit-tested formatter and guarded against SSRF.
- **Custom dashboards.** Build named, org-shared dashboards from saved Discover queries. Each
  widget stores its dataset, group-by, aggregate, time range, and project, and renders as a chart;
  add or remove widgets from the dashboard page. Built on the Discover query engine.
- **Discover.** A new analytics page queries errors or transactions over a time window: group
  by a field (level, environment, release, transaction, op, status, ...), aggregate (event count,
  unique users, avg / p50-p99 duration), optionally scope to a project, and see the result as a
  ranked bar chart. Aggregation runs over a bounded scan (capped at 10k rows, disclosed when hit).
- **Fine-grained roles.** Members now have a Sveltry role (owner / admin / member / billing),
  enforced in Convex with a `requireRole` helper: admin and owner manage projects, teams, alerts,
  and monitors; member can triage issues (resolve/ignore/assign/merge/comment); billing is
  read-only. Roles are managed on the settings page. A fresh org's first user bootstraps as owner.
- **Teams.** Group an organization's members into teams and assign projects to a team. A new
  Teams page creates teams, adds/removes members (picked from the org's member list), and shows
  each team's projects; projects gain an owning-team selector. Modeled in Convex alongside the
  rest of the data.
- **Unmerge issues.** Merges are now recorded (the merged-away issue's snapshot plus the
  events that moved), so the issue page can undo one: it recreates the original issue, moves
  its events back, and reverses the count changes. Reversible for merges performed from now on.
- **Suspect commits.** Upload a release's commits and their changed files via
  `POST /releases/commits` (DSN-key auth, mirrors `sentry-cli releases set-commits`,
  accepts `files` or `patch_set`). The issue page then shows the commits that changed
  a file appearing in the stack trace, most recent first, as the likely cause.
- **Debug-ID source maps.** Artifacts now carry a debug id (parsed from a minified file's
  `//# debugId=` comment or a source map's `debugId` field). Stack frames resolve by matching
  the event's `debug_meta` images to that id, independent of release name or file path, so
  symbolication works even for events without a release. Name+release matching stays as the
  fallback. The project Source maps panel shows each artifact's debug id.
- **Saved views.** Save the current issues-list filters (search text, status, level) as a named,
  org-shared preset and apply it again in one click. Presets appear as removable chips above the
  list.
- **More alert channels.** Microsoft Teams (MessageCard), PagerDuty (Events API v2 routing key),
  and Opsgenie (GenieKey) join webhook/Slack/Discord/email for both issue and metric alerts,
  via a shared, unit-tested channel formatter.
- **Hard quotas and spike protection.** Optional per-project monthly event quota and per-minute
  spike threshold; events over the limit are dropped (still HTTP 200, so SDKs do not retry).
  Configurable in a new Limits and settings card on the project page.
- **Merge issues.** Merge a duplicate issue into another from the issue detail page (search,
  pick, merge); its events are re-pointed and counts folded into the target.
- **Usage accounting and deploy tracking.** Per-project, per-day event/transaction counters
  (plus client-side drops from `client_report`), shown as 30-day totals on the project page;
  and a DSN-authenticated deploy API (`POST /deploys`) recording deploys per release.
- **Web Vitals and distributed tracing.** LCP/INP/CLS/FCP/FID/TTFB p75 are read from transaction
  `measurements` and shown on the Performance page; transactions sharing a trace id are stitched
  into a single cross-service trace waterfall (a new trace view).
- **Metric/threshold alerts.** Per-project alerts on p95 latency, error count, or crash-free rate
  over a window, evaluated by a cron and delivered to webhook/Slack/Discord/email. Plus
  missed-check-in detection: cron monitors with an interval schedule are flagged "missed" when
  overdue.
- **HTTP uptime monitors.** Configure URL probes (interval, expected status); a per-minute
  cron checks due ones and records each result as a check-in, so uptime history appears on
  the Monitors page next to cron check-ins.
- **Attachments and user feedback.** `attachment` envelope items are stored in file storage
  and downloadable from the issue detail page; `user_report` and `feedback` items are
  persisted and listed on a new Feedback page.
- **Issue triage and collaboration.** Full-text issue search (Convex search index) with
  status/level filters on the Issues page; per-issue threaded comments; assign/unassign to
  yourself; and "resolve in next release" (stays resolved while the same release recurs,
  reopens on a later one).
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
