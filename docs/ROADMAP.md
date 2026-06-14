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

## Later

Latency percentiles over arbitrary windows already ship via hourly duration-histogram
rollups (in Convex, no separate store). The following would still benefit from a richer
analytics tier:

- **Web vitals and finer percentiles.** LCP/CLS/INP and p75/p99 with higher-resolution
  histograms or a columnar store.
- **Dashboards and Discover.** Composable widgets over a query engine.
- **Metric alerts.** Threshold alerts over aggregates (error rate, latency, crash rate).
- **Uptime monitors.** HTTP uptime checks reusing the alert pipeline (cron check-ins ship).
- **Distributed tracing across services.** Stitch transactions into full cross-service traces.

## Non-goals (for now)

- A bespoke telemetry client. Sveltry deliberately reuses the official Sentry SDKs.
- Horizontal multi-node scaling of the backend. Self-hosted Convex is single-node; this is fine for
  the team-and-product scale Sveltry targets.

Have a feature you need? Open a
[feature request](https://github.com/aihxp/sveltry/issues/new?template=feature_request.yml).
