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
| gzip / deflate decompression | Done | Transparent via `fflate` (pure JS); `DecompressionStream` is absent from the self-hosted Convex isolate. |
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
| Multi-tenant organizations | Done | Organizations, members, and roles are modeled natively in Convex (`organizations` / `memberRoles` / `userSettings`); there is no Better Auth organization plugin. |
| Projects | Done | `projects` table, scoped per organization; renamable from the project settings page (the slug stays stable), and deletable (a typed-name confirm removes the project and purges all its data across every table in a bounded background sweep). Transfer between orgs is planned. |
| DSN / client keys | Done | `projectKeys` per project, resolved at ingest by `resolveIngestKey`. |
| Org-scoped data access | Done | Every dashboard query calls `requireOrg(ctx)`; Convex verifies RS256 JWTs statelessly against the JWKS served by its own Better Auth component. |
| Authentication and identity | Done | Better Auth runs on Convex via the `@convex-dev/better-auth` component (Convex-only, no Postgres; email + password). RS256 JWTs are verified against a Convex-served JWKS at `{CONVEX_SITE_URL}/api/auth/convex/jwks`. |
| Teams | Done | Teams group org members and own projects (assignable per project). Modeled in Convex; managed on the Teams page. |
| Fine-grained roles / permissions | Done | owner / admin / member / billing roles, enforced in Convex via `requireRole`: admin+ manages projects/teams/alerts, member triages issues, billing is read-only. Managed on the settings page; the first user of a fresh org bootstraps as owner. |
| Member invitations | Done | An owner/admin invites an email at a role; the invitee opens a tokenized link, signs in or up as that email, and accepts to join. Invites expire after 7 days, are emailed over SMTP (or the link is copied from the settings page when SMTP is unconfigured), and can be revoked. |
| Public REST API / API tokens | Partial | A v1 API authenticated by org API tokens (Bearer, `read` or `read+write` scope, managed on the settings page): `GET /projects`, `/projects/<slug>/issues`, `/issues/<id>`, `/issues/<id>/events`, and `POST /issues/<id>/{resolve,ignore,unresolve}` (write scope). Broader resource coverage (releases, members) and pagination cursors are not built yet. |
| Organization audit log | Done | Config and access changes (projects, DSN keys, roles, alerts, invitations, API tokens) are recorded with the actor and time, and shown to admins on the settings page. |
| SSO / SAML / 2FA | Not planned | Out of scope for now; email + password only. |

## Alerts and integrations

| Feature | Status | Notes |
| --- | --- | --- |
| Alert rules | Done | `alertRules` per project with optional threshold, `minLevel`, and environment scope. |
| New-issue trigger | Done | `new_issue`. |
| Regression trigger | Done | `regression`. |
| Event-frequency trigger | Done | `event_frequency`. |
| Environment-scoped alerts | Done | Both issue alert rules and metric/threshold alerts can be scoped to one environment: an issue rule fires only on that environment's events (event-frequency counts only them), and a metric alert computes p95-latency / error-count / crash-free-rate over only that environment. Unscoped rules match all environments. |
| Webhook delivery | Done | Generic `fetch` POST. |
| Discord delivery | Done | Via webhook. |
| Slack delivery | Done | Via webhook. |
| Delivery logging | Done | Each attempt recorded in `alertDeliveries`. |
| Email alerts | Done | The `email` channel sends over SMTP via a Convex Node action (`SMTP_HOST` etc.); a clean no-op until configured. |
| Metric / threshold alerts | Done | A cron evaluates p95-latency, error-count, and crash-free-rate thresholds over a window and fires to webhook/Slack/Discord/email. |
| Quota-usage alerts | Done | Per-project alert when this month's events reach a chosen percentage of the monthly quota; an hourly cron fires to any channel, at most once per month. |
| Microsoft Teams / PagerDuty / Opsgenie | Done | Provider-specific channels (MessageCard, Events API v2, GenieKey) for issue and metric alerts. |
| Issue-tracker actions (Jira / Linear) | Done | Per-project Jira (REST v3) and Linear (GraphQL) integration: create a ticket from an issue manually, or auto-create on a new issue. Credentials are self-hoster supplied and never returned to the client. |

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
| Span operations breakdown | Done | The transaction detail page shows where the time went by operation category (db / http / cache / ...), computed from each span's self-time (duration minus its children), plus a slowest-spans list. |
| Slowest operations (cross-transaction) | Done | The Performance page aggregates spans across recent transactions, grouped by operation and description, ranked by total time spent (count / avg / p95 / total), with an operation-category filter. A recent-window sample (no columnar store yet); a trace explorer / span search and n+1 detection are not built yet. |
| Profiling (flamegraph) | Done | `profile` items are persisted; samples/stacks/frames are aggregated into a flamegraph on the Profiles page. |
| Web vitals | Done | LCP/INP/CLS/FCP/FID/TTFB p75 from transaction `measurements`, on the Performance page. |
| Distributed tracing | Done | Transactions sharing a trace id are stitched into one waterfall (the trace view). |

## Dashboards and Discover

| Feature | Status | Notes |
| --- | --- | --- |
| Live issues dashboard | Done | Reactive SvelteKit UI over Convex (WebSockets). |
| Custom dashboards / widgets | Done | Named, org-shared dashboards of saved Discover queries; each widget renders a grouped aggregate as a chart. Add/remove widgets from the dashboard page. |
| Discover-style query builder | Done | A Discover page queries errors or transactions over a time window: group by a field, aggregate (count / unique users / avg / p50-p99), filter and scope by project, rendered as a ranked bar chart. |

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
| PII scrubbing at ingest | Done | A default ruleset (credit cards, SSNs, bearer tokens, sensitive-key-named fields) applied per project before storage, with a per-project on/off toggle. Customizable per project: extra sensitive field-name keywords, a safe-field allowlist that exempts keys from redaction, and an IP-address toggle. The matcher is a pure, unit-tested module in `@sveltry/protocol`. |
| Inbound data filters | Done | Optional per-project filters drop matching error events at ingest, before they are stored, grouped, or counted: by error message/type, release, environment, or stack-frame path (case-insensitive globs), and by known web-crawler user-agent. Pure matcher in `@sveltry/protocol`; configured on the project page; a clean no-op when unset. Filtered drops are counted separately (`filteredCount`). |
| Per-key rate limiting | Done | Optional fixed-window limit per project key (`ingestWindows`). |
| Allowed domains (per key) | Done | Optional per-key origin allowlist (Sentry's "Allowed Domains"): when set, a browser request whose `Origin`/`Referer` is not listed is rejected with 403, so a leaked browser DSN cannot report from other sites. Supports exact hosts, `*.example.com`, and scheme-qualified patterns; server-side requests (no origin) are unaffected. Pure matcher in `@sveltry/protocol`. |
| Data retention | Done | Daily `sweepRetention` prunes events past each project's retention, bounded per run. |
| S3 / R2 storage offload | Done | Optional offload of large blobs (source maps) to an S3-compatible bucket, configured by env vars (no-op when unset). Resolution reads offloaded maps back transparently. Inline event payloads are not yet offloaded. |
| Spike protection | Done | Optional per-project per-minute cap; excess error events are dropped (still HTTP 200). Applies to error events only; transactions and sessions are not counted or dropped. |
| Usage accounting | Done | Per-project, per-day event/transaction/dropped/filtered counters, shown as window totals plus a daily events-per-day chart on the project page (selectable 7 / 30 / 90-day window). |
| Org-wide stats | Done | A Stats page aggregates usage across all of an organization's projects: window totals (events / transactions / dropped / filtered), a daily chart, and a per-project breakdown (selectable 7 / 30 / 90-day window). |
| Hard quotas | Done | Optional per-project monthly event quota; events over quota are dropped. Configurable on the project page. |

---

Missing something you need? Open a
[feature request](https://github.com/aihxp/sveltry/issues/new?template=feature_request.yml) or see
the [ROADMAP.md](./ROADMAP.md) for what is coming Next vs Later.
