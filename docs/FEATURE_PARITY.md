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
| Issue search and saved views | Planned | Tag and full-text filtering over the `tags` index. |
| Merge / unmerge issues | Planned | Not yet implemented. |
| Issue assignment and comments | Planned | Not yet implemented. |

## Events and payloads

| Feature | Status | Notes |
| --- | --- | --- |
| Full event storage | Done | Entire normalized Sentry payload stored in the `events.payload` blob (nodestore-equivalent). |
| Stack traces | Done | Frames preserved in the stored payload; in-app frames drive default grouping. |
| Breadcrumbs | Done | Stored as part of the event payload. |
| Tags | Done | Stored and indexed (`events.tags`) for later filtering. |
| Contexts and request data | Done | Preserved in the stored payload. |
| Event normalization | Done | Each event normalized at ingest before grouping and storage. |
| Attachments | Partial | Attachment envelope items are accepted (HTTP 200) but not stored. |

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
| transaction / session / sessions / replay / profile / check_in / client_report / feedback items | Partial | Accepted (HTTP 200) but not yet persisted or aggregated. |

## Projects, orgs, teams, and access

| Feature | Status | Notes |
| --- | --- | --- |
| Multi-tenant organizations | Done | Better Auth organization plugin; active org folded into the JWT (`activeOrganizationId` claim). |
| Projects | Done | `projects` table, scoped per organization. |
| DSN / client keys | Done | `projectKeys` per project, resolved at ingest by `resolveIngestKey`. |
| Org-scoped data access | Done | Every dashboard query calls `requireOrg(ctx)`; Convex verifies RS256 JWTs statelessly via a Custom JWT provider. |
| Authentication and identity | Done | Better Auth in Postgres; RS256 JWTs with a published JWKS at `/api/auth/jwks`. |
| Teams | Planned | Org membership exists; team-level grouping not yet modeled. |
| Fine-grained roles / permissions | Planned | Beyond organization membership. |

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
| Email alerts | Partial | The `email` channel exists but is a no-op logged as undelivered; no SMTP / transactional transport is wired. |
| Metric / threshold alerts over aggregates | Planned | Needs an analytics tier (error rate, latency, crash rate). |
| Microsoft Teams / PagerDuty / Opsgenie | Planned | Additional alert integrations. |
| Issue-tracker actions (Jira / Linear) | Planned | Not yet implemented. |

## Releases and deploys

| Feature | Status | Notes |
| --- | --- | --- |
| Basic releases | Done | Release upserted per event into the `releases` table. |
| Release health (crash-free rates) | Partial | `session` / `sessions` envelope items are accepted at ingest but not aggregated yet. |
| Resolve in next release | Planned | Not yet implemented. |
| Suspect commits / commit association | Planned | Not yet implemented. |
| Deploy tracking | Planned | Not yet implemented. |

## Source maps and symbolication

| Feature | Status | Notes |
| --- | --- | --- |
| Source-map / artifact upload | Done | `POST /artifacts/upload` (DSN-key auth) per release; `uploadSourceMaps()` in the SDK and the project Source maps panel. |
| Server-side symbolication | Done | Minified JavaScript frames are resolved to original source (file, line, function, context) against uploaded maps, on ingest. |
| Debug-ID artifact bundles | Planned | Name-based matching today; debug-ID bundle matching is not yet implemented. |
| Native symbolication (debug files) | Not planned | Out of scope for now. |

## Performance and tracing

| Feature | Status | Notes |
| --- | --- | --- |
| Transactions and spans | Done | `transaction` items are persisted with their spans; a Performance page lists them. |
| Latency percentiles (p50/p95) | Done | Per-transaction p50/p95/avg/max computed over a recent-window sample (no columnar store yet, so percentiles are a recent approximation). |
| Trace view (span waterfall) | Done | The transaction detail page renders the span waterfall. |
| Web vitals | Planned | Needs a columnar / time-series store. |
| Distributed tracing across services | Planned | Transactions carry their trace id, but cross-service trace stitching is not yet built. |

## Dashboards and Discover

| Feature | Status | Notes |
| --- | --- | --- |
| Live issues dashboard | Done | Reactive SvelteKit UI over Convex (WebSockets). |
| Custom dashboards / widgets | Planned | Composable widgets over a query engine. |
| Discover-style query builder | Planned | Needs an analytics tier. |

## Session replay

| Feature | Status | Notes |
| --- | --- | --- |
| Replay ingestion | Partial | `replay_*` envelope items are accepted (HTTP 200) but not stored. |
| Replay viewer | Planned | rrweb-style playback with a dedicated blob store and consumer. |

## Crons and uptime

| Feature | Status | Notes |
| --- | --- | --- |
| Cron / check-in monitors | Planned | `check_in` items are accepted but not stored. |
| HTTP uptime monitors | Planned | Would reuse the existing alert pipeline. |
| Backend maintenance crons | Done | Daily `sweepRetention` and hourly `sweepOngoing` (Sveltry's own crons, not user-facing monitors). |

## Data privacy and quotas

| Feature | Status | Notes |
| --- | --- | --- |
| PII scrubbing at ingest | Done | Default scrubbing applied per project before storage. |
| Per-key rate limiting | Done | Optional fixed-window limit per project key (`ingestWindows`). |
| Data retention | Done | Daily `sweepRetention` prunes events past each project's retention, bounded per run. |
| S3 / R2 storage offload | Planned | Event payloads are stored inline in Convex documents today; offloading large objects/attachments to S3/R2 is not yet wired in Sveltry. |
| Spike protection / dynamic sampling | Planned | Not yet implemented. |
| Quota and usage accounting | Planned | Not yet implemented. |

---

Missing something you need? Open a
[feature request](https://github.com/aihxp/sveltry/issues/new?template=feature_request.yml) or see
the [ROADMAP.md](./ROADMAP.md) for what is coming Next vs Later.
