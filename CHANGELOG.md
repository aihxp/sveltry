# Changelog

All notable changes to Sveltry are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **p99 latency.** The Performance views now surface the p99 percentile: a p99 column on the
  per-transaction stats table (exact, over the recent-window sample) and a p50 / p95 / p99 selector
  on the latency-over-time chart (over the hourly histogram rollups, at bucket resolution).

## [0.4.0] - 2026-06-15

### Added

- **Source-code integration: "open in repo" stack-frame links.** Configure a project's source
  repository (GitHub, GitLab, or Bitbucket) under Project Settings -> Repository (provider, repo
  URL, default branch, and an optional source-root prefix to strip from frame paths). Each in-app
  stack frame on an issue then gets an "open in repo" link that opens the file and line on your
  provider's web UI. This is URL construction only: Sveltry never calls your provider, so no token
  or network access is required. Frame links pin to the configured default branch, unless the
  event's release looks like a commit SHA (then that SHA is used).

## [0.3.0] - 2026-06-15

### Added

- **Project transfer.** Move a project (and all of its data) to another organization you administer,
  from the project settings danger zone. Requires admin on both the source and target org and a
  typed-name confirmation. The project row and its DSN keys flip to the target immediately (so it
  leaves the source org and ingest attributes new events to the target at once); a bounded,
  self-rescheduling background sweep then re-stamps the rest of its scoped data (events,
  transactions, issues and comments, releases, alerts, and more) onto the new org. The slug is
  auto-suffixed if it collides in the target org, saved views and dashboard widgets that reference
  the project are detached (they stay with the source org), and a `project.transfer` entry is
  recorded in both orgs' audit logs.

## [0.2.0] - 2026-06-15

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

- **Public API, deeper.** The v1 REST API gains resources and writes: `GET /api/v1/releases`
  (org-scoped, with an optional `?project=<slug>` filter), `GET /api/v1/members`, `GET
  /api/v1/events/<eventId>` (a single event with its full stored payload), and `POST
  /api/v1/issues/<id>/assign` (write scope; body `{ assigneeId }`, validated to be a member of the
  org, `null` to unassign). The list endpoints for releases, members, a project's issues, and an
  issue's events now support opaque cursor pagination: pass `?cursor=` and `?limit=` (default 50,
  max 100) and read the additive `nextCursor` field (`null` when exhausted). Pagination is
  backward-compatible (existing array keys are unchanged, `nextCursor` is additive, and `/projects`
  stays unbounded); an invalid cursor returns `400`. Adds `releases.by_org` and `events.by_org_eventId`
  indexes to back the new releases listing and the single-event lookup.
- **Performance issues list.** A new Performance issues page (linked from the Performance header)
  surfaces detected performance problems across recent transactions: N+1 queries (the same database
  or cache operation repeated within one transaction), slow database queries, and slow outbound HTTP
  calls. Findings are grouped by (type, operation, description) and ranked by total impact time, with
  a per-type filter and a drill-down to the worst sample transaction. Detected on read over the span
  data already stored with each transaction (a recent-window sample), consistent with the other
  performance views; nothing new is persisted.
- **Span search (trace explorer).** A new Span search page (linked from the Performance header)
  finds individual spans across recent transactions by operation or description, ranked by
  duration, each row linking back to its transaction. The "Slowest operations" rows now drill into
  it, so you can go from "this query costs the most overall" to the specific transactions running
  it. Backed by a recent-window span scan, consistent with the existing latency percentiles.
- **N+1 detection.** The transaction detail page now flags a potential N+1 when the same database
  or cache operation repeats many times within one transaction (the classic query-in-a-loop),
  showing the operation, its repeat count, and the total time, with a hint to batch or eager-load.
  Frontend-only, over the span data already stored with each transaction.
- **Slowest operations (cross-transaction).** The Performance page now aggregates spans across the
  recent transactions, grouped by operation and description and ranked by total time spent (with
  count, average, and p95), so you can see which database queries, HTTP calls, etc. cost the most
  across the app. Includes an operation-category filter (db / http / cache / ...). A recent-window
  sample, consistent with the existing latency percentiles.
- **Span operations breakdown.** The transaction detail page now shows where a transaction's time
  goes by operation category (db / http / cache / ui / ...), computed from each span's self-time
  (its duration minus the time covered by its children, so nested spans are not double-counted) and
  rendered as a stacked bar with per-category totals and percentages, plus a slowest-spans list.
  Frontend-only, over the span data already stored with each transaction.
- **Project delete.** A project can be deleted from its settings page (danger zone, with a
  typed-name confirmation). The project row is removed immediately (it leaves listings and ingest
  stops resolving its DSN), and a self-rescheduling background sweep purges all of its data across
  every scoped table (issues and their comments/users, events, transactions, sessions, replays,
  profiles, monitors, releases, usage, alerts, and more) in bounded batches, including the file
  storage blobs for attachments, replay recordings, and artifacts. Admin-only and audited.
- **Quota-usage alerts.** A per-project alert that fires when this calendar month's events reach a
  chosen percentage of the project's monthly event quota. An hourly cron evaluates enabled alerts
  and delivers to any channel (webhook / Slack / Discord / email / Teams / PagerDuty / Opsgenie) via
  the existing SSRF-guarded path, at most once per month. Configured on the project page next to the
  metric alerts.
- **Org-wide Stats page and project rename.** A new Stats page aggregates usage across all of an
  organization's projects: window totals (events / transactions / dropped / filtered), a daily
  events chart, and a per-project breakdown, over a selectable 7 / 30 / 90-day window
  (`usage.orgUsage`, backed by a new `usageDaily` by-org index). Projects can also be renamed from
  their settings page (the slug, which is the ingest/tenant key, stays stable); the rename is
  recorded in the audit log.
- **Organization audit log.** Configuration and access changes are now recorded with the actor and
  time: project create/update, DSN key create / enable / disable / allowed-domains, member role
  set/remove, invitation create/revoke, API-token create/revoke, and alert-rule create / delete /
  enable / disable. Admins see the recent activity on the settings page. Append-only, org-scoped,
  written from the mutating paths via a shared `recordAudit` helper.
- **Public API and API tokens.** An `/api/v1/...` surface authenticated by an organization API token
  (`Authorization: Bearer <token>`), so issues can be queried and triaged from CI and other tools.
  Read endpoints: `GET /api/v1/projects`, `/projects/<slug>/issues` (with `?status=` and `?limit=`),
  `/issues/<id>`, and `/issues/<id>/events`. Write endpoints (a `read+write` token): `POST
  /issues/<id>/{resolve,ignore,unresolve}` (a read-only token gets `403`). Tokens are created,
  listed, and revoked on the settings page (admin/owner) with a read or read+write scope; only a
  SHA-1 hash is stored and the raw token is shown once. Every response is scoped to the token's
  organization. See [docs/API.md](docs/API.md).
- **Custom PII scrubbing.** The default ingest scrubber (credit cards, SSNs, bearer tokens,
  secret-named fields) is now customizable per project: add extra sensitive field-name keywords, an
  allowlist of safe fields that are never redacted (so a field like `auth_method` survives the
  default `auth` rule), and a toggle to scrub IP-address fields (`user.ip_address`, `REMOTE_ADDR`).
  The scrubber moved to `@sveltry/protocol` as a pure, unit-tested module; the defaults are
  unchanged when no custom rules are set. Configured on the project page when scrubbing is on.
- **Environment-scoped metric alerts.** A metric/threshold alert (p95 latency, error count, or
  crash-free rate) can now be scoped to a single environment, matching the environment scope already
  on issue alerts. The metric is computed over only that environment's data (error-count and
  crash-free filter the scanned rows; the env-scoped p95 path reads raw transactions, since the
  precomputed rollups are not split by environment), and the alert message names the environment.
  Unscoped alerts still span all environments. Set it on the project page's metric-alert form.
- **Per-key allowed domains.** A DSN key can carry an optional origin allowlist (Sentry's "Allowed
  Domains"). When set, a browser ingest request whose `Origin` (or `Referer`) is not listed is
  rejected with HTTP 403, so a leaked public browser DSN cannot report from another site. Patterns
  support exact hosts, `*.example.com` subdomain wildcards, and scheme-qualified forms
  (`https://example.com`); server-side requests (no origin) are unaffected, and an empty list is a
  clean no-op. The matcher is a pure, unit-tested module in `@sveltry/protocol`; configured per key
  on the project page.
- **Member invitations.** An owner or admin can invite teammates by email at a chosen role from the
  settings page, instead of each person self-registering into a new org. The invitee opens a
  tokenized link, signs in or signs up as that email, and accepts to join the org. Invites are
  emailed over the existing SMTP transport (or the link is copied from the settings page when SMTP
  is unconfigured), expire after 7 days, cap at the inviter's own role, require the accepting user's
  email to match, and can be revoked. Pending invitations are listed on the settings page.
- **Usage over time.** The project page's Usage card now charts events per day across a selectable
  7 / 30 / 90-day window (gap-filled so empty days show), with a per-day tooltip breaking down
  events / transactions / dropped / filtered. `usage.projectUsage` takes an optional `windowDays`
  (clamped to 1-90); the totals and chart follow the chosen window.
- **Environment-scoped alerts.** An issue alert rule can be scoped to a single environment, so it
  fires only for events from that environment (e.g. notify on new production issues but stay quiet
  for staging). Event-frequency rules count only the scoped environment's events, and the
  notification body now includes the triggering environment. Unscoped rules still match every
  environment, so existing rules are unchanged. Set it on the project page's alert-rule form.
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

[Unreleased]: https://github.com/aihxp/sveltry/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/aihxp/sveltry/releases/tag/v0.4.0
[0.3.0]: https://github.com/aihxp/sveltry/releases/tag/v0.3.0
[0.2.0]: https://github.com/aihxp/sveltry/releases/tag/v0.2.0
[0.1.0]: https://github.com/aihxp/sveltry/releases/tag/v0.1.0
