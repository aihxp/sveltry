# Feature Parity

This matrix maps Sentry's product surface to what Sveltry actually does today. Sveltry is not
affiliated with Sentry; it implements a compatible subset of the Sentry ingestion wire protocol so
unmodified official `@sentry/*` SDKs can report to it. The goal is practical parity with the
most-used error-tracking features, not a clone of the entire product.

Status values:

- **Done** - implemented and verified end to end.
- **Partial** - some of the surface works; the rest is explicitly missing (see Notes).
- **Planned** - on the roadmap, not built yet.
- **Not planned** - deliberately out of scope.

For sequencing and what is coming Next vs Later, see [ROADMAP.md](./ROADMAP.md).

## Error tracking and issues

| Feature | Status | Notes |
| --- | --- | --- |
| Server-side grouping into issues | Done | `recordEvent` upserts one issue per `(projectId, fingerprint)`. |
| Grouping fingerprint | Done | SHA-1 over exception type + normalized in-app stack frames; line numbers and dynamic values (numbers, uuids, hex) stripped so near-identical errors group together. |
| SDK-provided custom fingerprint | Done | Honors the SDK `fingerprint` array, including the `{{ default }}` merge token. |
| Issue status workflow | Done | unresolved / resolved / ignored with new / ongoing / regressed / escalating / archived substatuses. |
| Regression detection | Done | A resolved issue that recurs reopens with substatus `regressed`. |
| Event and user counts | Done | `count` and `userCount` tracked per issue; `firstSeen` / `lastSeen` maintained. |
| Triage aging | Done | Hourly `sweepOngoing` cron ages `new` issues older than 7 days to `ongoing`. |
| Issue search | Done | Full-text search over issue titles (Convex search index) with status/level filters. |
| Saved views | Done | Named, org-shared issue-list presets (query, status, level) you can save and one-click apply. |
| Merge issues | Done | Merge a duplicate issue into another from the issue detail page (events and counts move). |
| Unmerge issues | Done | A merge is recorded (source snapshot + moved events); the issue page can undo it, recreating the issue and moving its events back. Reversible for merges performed after this shipped. |
| Issue assignment | Done | Assign/unassign to the current user from the issue detail page. |
| Issue comments | Done | Threaded comments per issue, authored from the Better Auth identity. |

## Events and payloads

| Feature | Status | Notes |
| --- | --- | --- |
| Full event storage | Done | Entire normalized Sentry payload stored in the `events.payload` blob (nodestore-equivalent). |
| Stack traces | Done | Frames preserved in the stored payload; in-app frames drive default grouping. |
| Breadcrumbs | Done | Stored as part of the event payload. |
| Tags | Done | Stored and indexed (`events.tags`) for later filtering. |
| Contexts and request data | Done | Preserved in the stored payload. |
| Event normalization | Done | Each event normalized at ingest before grouping and storage. |
| Attachments | Done | `attachment` items are stored in file storage and downloadable from the issue detail page. |

## Ingestion and SDK compatibility

| Feature | Status | Notes |
| --- | --- | --- |
| Envelope endpoint | Done | `POST /api/<id>/envelope/` for all item types. |
| Legacy store endpoint | Done | `POST /api/<id>/store/` for a single JSON event. |
| DSN format | Done | `https://PUBLIC_KEY@INGEST_HOST/PROJECT_PUBLIC_ID`; build via the dashboard or `@aihxp/sveltry-sdk` `buildSveltryDsn`. |
| Header auth | Done | `X-Sentry-Auth` (sentry_version=7, sentry_key, sentry_client); `sentry_secret` accepted and ignored. |
| Query-string auth | Done | `?sentry_key=...&sentry_version=7&sentry_client=...`; the header wins when both are present. |
| gzip / deflate decompression | Done | Transparent via `DecompressionStream`. |
| br / zstd decompression | Not planned | Returns HTTP 400; the common JS SDKs send uncompressed or gzip. |
| Content-Type tolerance | Done | Ignored, since browser SDKs send an empty Content-Type to dodge CORS preflight. |
| SDK-friendly success response | Done | HTTP 200 `application/json` `{"id":"<32-hex>"}` with NO rate-limit headers, so SDKs do not back off. |
| Error responses | Done | Bad/missing key -> 401 with `X-Sentry-Error`; malformed body -> 400 with `{detail, causes}`; throttle -> 429 + `Retry-After`. |
| CORS preflight | Done | `OPTIONS /api/*` handled; `GET /healthz` for liveness. |
| security / minidump endpoints | Partial | Recognized and tolerated (HTTP 200) but not stored. |
| transaction / session / sessions / replay / check_in items | Done | Persisted: performance, release health, cron monitors, and session replay. |
| profile items | Done | Persisted; rendered as a flamegraph on the Profiles page. |
| user feedback (`user_report` / `feedback`) | Done | Persisted and listed on a Feedback page. |
| client_report items | Done | SDK-dropped-event counts are accumulated into the project usage totals. |

## Projects, orgs, teams, and access

| Feature | Status | Notes |
| --- | --- | --- |
| Multi-tenant organizations | Done | Better Auth organization plugin; active org folded into the JWT (`activeOrganizationId` claim). |
| Projects | Done | `projects` table, scoped per organization. |
| DSN / client keys | Done | `projectKeys` per project, resolved at ingest by `resolveIngestKey`. |
| Org-scoped data access | Done | Every dashboard query calls `requireOrg(ctx)`; Convex verifies RS256 JWTs statelessly via a Custom JWT provider. |
| Authentication and identity | Done | Better Auth in Postgres; RS256 JWTs with a published JWKS at `/api/auth/jwks`. |
| Teams | Done | Teams group org members and own projects (assignable per project). Modeled in Convex; managed on the Teams page. |
| Fine-grained roles / permissions | Done | owner / admin / member / billing roles, enforced in Convex via `requireRole`: admin+ manages projects/teams/alerts, member triages issues, billing is read-only. Managed on the settings page; the first user of a fresh org bootstraps as owner. |

## Alerts and integrations

| Feature | Status | Notes |
| --- | --- | --- |
| Alert rules | Done | `alertRules` per project with optional threshold and `minLevel`. |
| New-issue trigger | Done | `new_issue`. |
| Regression trigger | Done | `regression`. |
| Event-frequency trigger | Done | `event_frequency`. |
| Webhook delivery | Done | Generic `fetch` POST. |
| Discord delivery | Done | Via webhook. |
| Slack delivery | Done | Via webhook. |
| Delivery logging | Done | Each attempt recorded in `alertDeliveries`. |
| Email alerts | Done | The `email` channel sends over SMTP via a Convex Node action (`SMTP_HOST` etc.); a clean no-op until configured. |
| Metric / threshold alerts | Done | A cron evaluates p95-latency, error-count, and crash-free-rate thresholds over a window and fires to webhook/Slack/Discord/email. |
| Microsoft Teams / PagerDuty / Opsgenie | Done | Provider-specific channels (MessageCard, Events API v2, GenieKey) for issue and metric alerts. |
| Issue-tracker actions (Jira / Linear) | Planned | Not yet implemented. |

## Releases and deploys

| Feature | Status | Notes |
| --- | --- | --- |
| Basic releases | Done | Release upserted per event into the `releases` table. |
| Release health (crash-free rates) | Done | Individual `session` items (upserted by sid, latest status wins) and aggregated `sessions` buckets are both folded into crash-free sessions/users per release. |
| Resolve in next release | Done | Resolve and stay resolved while the same release recurs; reopen on a later release. |
| Suspect commits / commit association | Done | `POST /releases/commits` (DSN-key auth) uploads a release's commits and changed files (`set-commits`); the issue page surfaces the commits that touched a file in the stack trace, most recent first. |
| Deploy tracking | Done | `POST /deploys` (DSN-key auth) records deploys per release; shown on the project page. |

## Source maps and symbolication

| Feature | Status | Notes |
| --- | --- | --- |
| Source-map / artifact upload | Done | `POST /artifacts/upload` (DSN-key auth) per release; `uploadSourceMaps()` in the SDK and the project Source maps panel. |
| Server-side symbolication | Done | Minified JavaScript frames are resolved to original source (file, line, function, context) against uploaded maps, on ingest. |
| Debug-ID artifact bundles | Done | Frames resolve by debug id (from `//# debugId=` / source map `debugId`, matched via `debug_meta`), independent of release or path; name+release matching remains the fallback. |
| Native symbolication (debug files) | Not planned | Out of scope for now. |

## Performance and tracing

| Feature | Status | Notes |
| --- | --- | --- |
| Transactions and spans | Done | `transaction` items are persisted with their spans; a Performance page lists them. |
| Latency percentiles (p50/p95) | Done | Per-transaction p50/p95/avg/max. The summary table uses a recent-window sample; the latency-over-time chart uses hourly histogram rollups, giving percentiles over arbitrary windows at bucket resolution. |
| Latency trend over time | Done | An hourly p95 chart on the Performance page, backed by precomputed duration-histogram rollups (a cron aggregates raw transactions). |
| Trace view (span waterfall) | Done | The transaction detail page renders the span waterfall. |
| Profiling (flamegraph) | Done | `profile` items are persisted; samples/stacks/frames are aggregated into a flamegraph on the Profiles page. |
| Web vitals | Done | LCP/INP/CLS/FCP/FID/TTFB p75 from transaction `measurements`, on the Performance page. |
| Distributed tracing | Done | Transactions sharing a trace id are stitched into one waterfall (the trace view). |

## Dashboards and Discover

| Feature | Status | Notes |
| --- | --- | --- |
| Live issues dashboard | Done | Reactive SvelteKit UI over Convex (WebSockets). |
| Custom dashboards / widgets | Planned | Composable widgets over a query engine. |
| Discover-style query builder | Planned | Needs an analytics tier. |

## Session replay

| Feature | Status | Notes |
| --- | --- | --- |
| Replay ingestion | Done | `replay_event` + `replay_recording` items are persisted (metadata in `replays`, rrweb stream in file storage). |
| Replay viewer | Done | A Replays page lists recordings; the detail page plays them back with rrweb-player. |

## Crons and uptime

| Feature | Status | Notes |
| --- | --- | --- |
| Cron / check-in monitors | Done | `check_in` items are persisted (upserted by id, so in-progress + terminal are one run); a Monitors page shows each monitor's status and recent check-ins. |
| Missed check-in detection | Done | Monitors with an interval schedule are flagged "missed" by a cron when overdue (20% grace). |
| HTTP uptime monitors | Done | Configurable URL probes run by a per-minute cron; each result is recorded as a check-in so uptime history shows on the Monitors page. |
| Backend maintenance crons | Done | Daily `sweepRetention` and hourly `sweepOngoing` (Sveltry's own crons, not user-facing monitors). |

## Data privacy and quotas

| Feature | Status | Notes |
| --- | --- | --- |
| PII scrubbing at ingest | Done | Default scrubbing applied per project before storage. |
| Per-key rate limiting | Done | Optional fixed-window limit per project key (`ingestWindows`). |
| Data retention | Done | Daily `sweepRetention` prunes events past each project's retention, bounded per run. |
| S3 / R2 storage offload | Planned | Event payloads are stored inline in Convex documents today; offloading large objects/attachments to S3/R2 is not yet wired in Sveltry. |
| Spike protection | Done | Optional per-project per-minute cap; excess error events are dropped (still HTTP 200). |
| Usage accounting | Done | Per-project, per-day event/transaction/dropped counters (30-day totals on the project page). |
| Hard quotas | Done | Optional per-project monthly event quota; events over quota are dropped. Configurable on the project page. |

---

Missing something you need? Open a
[feature request](https://github.com/aihxp/sveltry/issues/new?template=feature_request.yml) or see
the [ROADMAP.md](./ROADMAP.md) for what is coming Next vs Later.
