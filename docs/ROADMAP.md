# Roadmap

Sveltry aims for practical parity with Sentry's most-used features while staying wire-compatible
with the official SDKs. The work is sequenced so that each horizon is independently useful. Items
are not dated; they move from Later to Next to Now as they are picked up.

## Now (shipped in 0.1.0)

The error-tracking vertical slice, end to end:

- Sentry-compatible ingestion: `POST /api/<id>/envelope/` (modern) and `/store/` (legacy)
- DSN authentication from the `X-Sentry-Auth` header or the query string
- Transparent gzip / deflate decompression
- Server-side grouping into issues via a stable fingerprint (exception type + normalized stack trace)
- Issue status workflow: unresolved / resolved / ignored, with new / ongoing / regressed / escalating / archived substatuses
- Full event storage (stack frames, breadcrumbs, tags, contexts, request)
- Multi-tenant organizations, projects, and DSN keys
- Basic releases (recorded per event)
- Source-map symbolication: per-release `.map` upload (`POST /artifacts/upload`) and on-ingest resolution of minified JavaScript frames to original source
- Performance monitoring: `transaction` items persisted with spans, per-transaction p50/p95 latency over a recent-window sample, and a span-waterfall trace view
- Release health: individual `session` items persisted (upsert by sid) and aggregated `sessions` buckets, folded into crash-free sessions/users per release
- Cron monitors: `check_in` items persisted (upsert by id), with a Monitors page for per-monitor status and recent check-ins
- Session replay: `replay_event` + `replay_recording` items persisted (metadata + rrweb stream in file storage) with rrweb-player playback
- Profiling: `profile` items persisted and aggregated into a flamegraph on the Profiles page
- Latency trend: hourly transaction duration-histogram rollups (cron) with a p95-over-time chart, giving percentiles over arbitrary windows
- Alert rules (new issue, regression, event-frequency) to webhook / Discord / Slack / email (SMTP)
- Per-key fixed-window rate limiting
- Default PII scrubbing at ingest
- Retention and triage-aging crons
- A live, reactive dashboard (Convex over WebSockets)

## Shipped since 0.1.0

Most of what the original Next/Later horizons listed now ships. See
[FEATURE_PARITY.md](./FEATURE_PARITY.md) and the [CHANGELOG](../CHANGELOG.md) for detail.

- **Convex-only (Postgres removed for the app).** Auth runs entirely on Convex via the
  `@convex-dev/better-auth` component; organizations, membership, and roles are modeled natively in
  Convex. Postgres remains only as the Convex backend's own storage engine.
- **Issue triage.** Full-text search, saved views, merge / unmerge, assignment, threaded comments,
  resolve-in-next-release, fine-grained roles (owner / admin / member / billing), and teams.
- **Alerts and integrations.** Email (SMTP), Microsoft Teams, PagerDuty, Opsgenie; metric/threshold
  alerts; and Jira / Linear issue-tracker actions.
- **Performance and analytics.** Web vitals, distributed tracing across services, Discover, custom
  dashboards, and debug-ID artifact bundles.
- **Crons and uptime.** Missed-check-in detection and HTTP uptime monitors.
- **Releases.** Deeper release health (aggregated `sessions` buckets), suspect commits, and deploy
  tracking.
- **Data controls.** Hard quotas, spike protection, usage accounting, optional S3 / R2 storage
  offload, and inbound data filters (drop noisy events at ingest).

## Next

Highest-value additions that build on the existing tables:

- **Environment-scoped alerts.** Fire an alert only for a chosen environment (e.g. production).
- **Usage over time.** A daily usage time-series chart with an arbitrary date range on the project
  page (the per-day series is already returned by `usage.projectUsage`).
- **Member invitations.** Invite teammates by email (reusing the existing SMTP transport) and a
  join flow, instead of each user self-registering.
- **Per-key allowed origins.** An optional CORS/referrer allowlist on a DSN key, so a leaked browser
  DSN cannot be used to report from other sites.
- **Custom data scrubbing.** Per-project custom scrubbing rules and a safe-field allowlist, on top
  of the current default ruleset.

## Later

Valuable, but a larger surface or a new subsystem:

- **Public REST API.** Programmatic read access to issues / events / projects / releases, with
  scoped API tokens.
- **Source-code integration.** GitHub / GitLab / Bitbucket: "open in repo" stack-frame links,
  suspect commits from SCM, and auto-resolve from commit messages.
- **Performance insights.** Per-op span breakdowns (DB / HTTP / cache / queues), a trace explorer /
  span search, and n+1 / slow-span detection.
- **Account security and provisioning.** Two-factor auth (TOTP), then SSO (SAML / OIDC) and SCIM.
- **Org operations.** An organization audit log, project rename / transfer / delete, an org-level
  stats page, and usage/quota threshold alerts.
- **Finer percentiles.** p99 and higher-resolution histograms via a richer analytics tier.

## Non-goals (for now)

- A bespoke telemetry client. Sveltry deliberately reuses the official Sentry SDKs.
- Horizontal multi-node scaling of the backend. Self-hosted Convex is single-node; this is fine for
  the team-and-product scale Sveltry targets.

Have a feature you need? Open a
[feature request](https://github.com/aihxp/sveltry/issues/new?template=feature_request.yml).
