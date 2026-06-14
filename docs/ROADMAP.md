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
- Release health: individual `session` items persisted (upsert by sid) and aggregated into crash-free sessions/users per release
- Alert rules (new issue, regression, event-frequency) to webhook / Discord / Slack
- Per-key fixed-window rate limiting
- Default PII scrubbing at ingest
- Retention and triage-aging crons
- A live, reactive dashboard (Convex over WebSockets)

## Next

Highest-value additions that build on the existing tables:

- **Debug-ID artifact bundles.** Match source maps by debug ID (in addition to the current
  name-based matching) so bundler plugins that emit debug IDs work without naming conventions.
- **Release health, deeper.** Aggregated `sessions` buckets, session adoption over time,
  resolve-in-next-release, and suspect commits (the crash-free-rate core already ships).
- **Email alerts.** Wire an SMTP / transactional-email transport to the existing alert pipeline.
- **More alert integrations.** Microsoft Teams, PagerDuty / Opsgenie, and issue-tracker actions
  (Jira / Linear).
- **Issue search and saved views.** Tag and full-text filtering, merge / unmerge.
- **User feedback.** Crash-linked feedback, then a standalone widget.

## Later (needs an analytics tier)

These depend on a columnar / time-series store for percentile aggregates over arbitrary windows:

- **Performance / tracing.** Transactions and spans, p50/p75/p95/p99, web vitals.
- **Dashboards and Discover.** Composable widgets over a query engine.
- **Metric alerts.** Threshold alerts over aggregates (error rate, latency, crash rate).
- **Session replay.** rrweb-style DOM recording with a dedicated blob store and consumer.
- **Cron and uptime monitors.** Check-in monitors and HTTP uptime checks reusing the alert pipeline.

## Non-goals (for now)

- A bespoke telemetry client. Sveltry deliberately reuses the official Sentry SDKs.
- Horizontal multi-node scaling of the backend. Self-hosted Convex is single-node; this is fine for
  the team-and-product scale Sveltry targets.

Have a feature you need? Open a
[feature request](https://github.com/aihxp/sveltry/issues/new?template=feature_request.yml).
