# Architecture

This document explains how Sveltry is put together for engineers who are evaluating it or planning
to extend it. Sveltry is an open-source, self-hosted, Sentry-compatible error tracker. It implements
a compatible subset of the Sentry ingestion wire protocol so that unmodified official `@sentry/*`
SDKs can report to it. It is not affiliated with Sentry or Functional Software.

For the exact wire-protocol surface see [SENTRY_COMPATIBILITY.md](./SENTRY_COMPATIBILITY.md); for
running it see [SELF_HOSTING.md](./SELF_HOSTING.md); for what is built versus planned see
[ROADMAP.md](./ROADMAP.md).

## 1. Overview and monorepo layout

Sveltry is a Bun-workspaces monorepo (with the dependency catalog feature) split into deployable
apps, shared packages, and infrastructure.

```
apps/
  dashboard/   SvelteKit 2 + Svelte 5 (runes) + Tailwind v4 + shadcn-svelte UI.
               Renders the reactive dashboard and proxies /api/auth/* to the
               Convex-served Better Auth handler.
  backend/     Self-hosted Convex backend. All functions live in
               apps/backend/convex/ (ingest, issues, events, alerts, crons, schema).

packages/
  protocol/    @sveltry/protocol: the pure wire-protocol core. DSN parse, envelope
               parser, auth extract, decompress, normalize, fingerprint (SHA-1),
               id generation, rate limit, HTTP responses. 45 passing bun tests.
  types/       @sveltry/types: shared Sentry payload + domain types.
  sdk/         @aihxp/sveltry-sdk: helpers that point Sentry SDKs at Sveltry
               (DSN builder, recommendedSentryOptions, createTunnelHandler).
               Published to GitHub Packages.

infra/         docker-compose.yml (postgres:17 + convex-backend + convex-dashboard),
               Caddyfile, postgres/init.sql, .env.example.
scripts/       setup.sh, the one-command local bring-up.
```

The split that matters most: `packages/protocol` is deliberately free of Convex, SvelteKit, and
Node specifics. It is plain TypeScript over web-standard APIs (`DecompressionStream`, `crypto`),
so it is unit-testable in isolation and reusable from any runtime. The Convex ingest action is a
thin host that wires that core to storage.

## 2. The two-path model

Sveltry has two fundamentally different traffic paths that meet only in the database.

**Ingest path (write, stateless, public).** A Sentry SDK posts an envelope to a Convex HTTP action.
The action authenticates the DSN key, parses and normalizes the payload, computes a grouping
fingerprint, and runs a mutation that upserts the issue and inserts the event. There is no user
session here; authentication is the DSN public key, scoped to a single project.

**Query path (read, reactive, authenticated).** The SvelteKit dashboard opens a WebSocket to Convex
and subscribes to queries. Convex pushes new results whenever underlying tables change, so an issue
list updates live as events arrive on the ingest path. Every query is authenticated by a Better Auth
JWT (issued by the Convex-hosted auth handler) and scoped to the caller's active organization.

```
   INGEST PATH (write)                          QUERY PATH (read)
   ------------------                           -----------------

   @sentry/* SDK in user's app                  Browser (dashboard user)
        |                                              |
        | HTTPS POST                                   | HTTPS (page load)
        | /api/<projectPublicId>/envelope/             v
        | X-Sentry-Auth or ?sentry_key           SvelteKit (apps/dashboard)
        v                                          - proxies /api/auth/* to Convex
   Convex HTTP action  (.site origin)             - Better Auth runs on Convex:
   apps/backend/convex/http.ts -> ingest.ts         identity + RS256 JWT + JWKS
     - projectIdFromPath / auth extract                 | WebSocket subscribe
     - decompress (gzip/deflate)                        | (JWT in connection)
     - envelope parse + normalize                       v
     - fingerprint (SHA-1)                       Convex client API  (.cloud origin)
     - PII scrub                                    - verifies JWT via JWKS
        |                                            - requireOrg(ctx) -> activeOrganizationId
        | internal mutation                          - reactive queries (issues/events/...)
        v                                                  |
   recordEvent (mutation)                                  |
     - upsert issue by (projectId, fingerprint)            |
     - insert event row, upsert release                    |
     - schedule alerts.dispatchForEvent                    |
        |                                                  |
        v                                                  v
   +------------------------------------------------------------+
   |  Self-hosted Convex backend  (state lives here)            |
   |  durably stored in ONE Postgres 17 server (DB: convex...)  |
   +------------------------------------------------------------+
```

The two Convex origins are real and distinct. The `.site` origin (default port 3211) serves HTTP
actions, which is where ingestion lands. The `.cloud` origin (default port 3210) serves the client
API that the dashboard subscribes to over WebSockets. DSNs always point at the `.site` origin.

## 3. The data model

The defining decision is the Issue versus Event split, the same model Sentry uses.

- An **issue** is a deduplicated group: one row per distinct fingerprint per project. It carries the
  rollup state a triager cares about: `title`, `culprit`, `level`, `status`, `substatus`, `count`,
  `userCount`, `firstSeen`, `lastSeen`, `errorType`.
- An **event** is a single occurrence. The full normalized Sentry payload (stack frames, breadcrumbs,
  contexts, request, user) is stored verbatim in a `payload` blob field, plus a small indexed `tags`
  field for filtering.

Tables (`apps/backend/convex/schema.ts`): `organizations`, `projects`, `projectKeys`, `issues`,
`events`, `releases`, `alertRules`, `alertDeliveries`, `ingestWindows`. Key indexes:

- `issues.by_project_fingerprint` `[projectId, fingerprint]` - the upsert key on every ingest. This
  is the hottest lookup in the system, so it is the primary issue index.
- `issues.by_org_status_lastSeen` `[organizationId, status, lastSeen]` - the dashboard's default
  issue stream (active issues across an org, most-recent-first).
- `issues.by_project_status_lastSeen` - the per-project issue stream.
- `events.by_issue` `[issueId, timestamp]` - the event list inside one issue.
- `events.by_eventId` - direct event lookup.
- `projectKeys.by_publicKey` - DSN key resolution at ingest.
- `projects.by_publicId` - resolving the project from the DSN path.

**Why store the raw payload as a blob alongside indexed tags?** A Sentry event is large, deeply
nested, and irregular, but you only ever query a handful of fields. Indexing everything would be
expensive and mostly wasted; discarding the rest would lose the detail an engineer needs when
opening a single event. So the design follows Sentry's nodestore idea: the full payload is an opaque
blob you fetch by id when rendering one event, while the few dimensions you actually filter and group
on (tags, fingerprint, level, timestamp) are promoted to indexed columns. You get cheap list/filter
queries and full fidelity on drill-down, without indexing fields nobody queries.

## 4. Grouping and fingerprinting

Grouping is what turns a flood of individual errors into a manageable list of issues. It happens at
ingest, in `packages/protocol/src/fingerprint.ts`, and produces a stable SHA-1 fingerprint per event.

Default grouping uses the **exception type plus the normalized in-app stack frames**. Normalization
is the load-bearing step: before hashing, the frames are stripped of values that legitimately differ
between two occurrences of the same bug. Line numbers are dropped, and dynamic tokens (numbers,
UUIDs, hex strings) are masked. Without this, every occurrence of one bug would hash differently and
the issue list would explode into thousands of near-duplicates.

The verified example: two `TypeError`s with the same stack shape but different line numbers and
different dynamic user ids normalized to the same fingerprint and grouped into a single issue
(count 2), while a `RangeError` produced a separate issue (count 1).

**SDK fingerprint override.** If the SDK supplies its own `fingerprint` array on the event, Sveltry
honors it. The array may contain the `{{ default }}` merge token, which expands to the
server-computed default fingerprint. This lets an SDK refine grouping (for example, fingerprint by a
custom key plus the default stack-based grouping) rather than replacing it wholesale.

Grouping is applied in the `recordEvent` mutation: look up the issue by `(projectId, fingerprint)`.
If none exists, insert one (`status: unresolved`, `substatus: new`). If one exists, increment its
`count`, bump `lastSeen`, and update `level`; if it had been resolved, it reopens with
`substatus: regressed`. Then the event row is inserted, the release is upserted, and an alert
dispatch is scheduled.

## 5. Auth and multi-tenancy

Identity and data live in different systems, joined only by a signed token.

- **Better Auth runs on Convex via the `@convex-dev/better-auth` component** (email + password). Its
  tables (user, session, account, jwks) live inside Convex, not Postgres. The SvelteKit app simply
  proxies `/api/auth/*` to the Convex-served auth handler. Convex publishes the JWKS at
  `{CONVEX_SITE_URL}/api/auth/convex/jwks` and issues RS256 JWTs.
- **Organizations are modeled natively in Convex**, not via a Better Auth plugin: the
  `organizations`, `memberRoles`, and `userSettings` tables provide multi-tenancy. The active
  organization id rides on the JWT under the `activeOrganizationId` claim. Switching the active org
  reissues the token with a new claim.
- **Convex verifies these JWTs statelessly.** `apps/backend/convex/auth.config.ts` registers a
  Custom JWT provider (`type: 'customJwt'`, `applicationID: 'convex'` matching the JWT `aud`,
  `issuer` = `SITE_URL` (which must equal `PUBLIC_APP_URL`), `jwks` =
  `{CONVEX_SITE_URL}/api/auth/convex/jwks`, `algorithm` RS256). The backend fetches the JWKS from its
  own HTTP-actions origin (see `CONVEX_INTERNAL_SITE_URL`) and validates the signature.
- Every dashboard query calls `requireOrg(ctx)`, which reads `identity.activeOrganizationId` and
  scopes all data by `organizationId`. Tenancy is enforced server-side on every read, not in the UI.

This is why the JWKS endpoint matters: Convex is both the issuer/key publisher and the verifier. The
trust boundary is the signature, so the `issuer`, `aud`, and JWKS URL must line up exactly: `SITE_URL`
must equal `PUBLIC_APP_URL`, or Better Auth's trusted-origin check rejects sign-in with "Invalid
origin".

**`.cloud` versus `.site` again, from the auth angle.** The authenticated WebSocket query path uses
the `.cloud` client-API origin, which is where JWT verification and `requireOrg` run. The public
ingest path uses the `.site` HTTP-actions origin and is authenticated by the DSN key, not a JWT.
The two auth schemes never mix: a DSN key cannot read the dashboard, and a user JWT is not used to
ingest.

## 6. Alerting and crons

**Alerting.** `alertRules` are configured per project. A rule has a `trigger`
(`new_issue` | `regression` | `event_frequency`), an optional `threshold` and `minLevel`, and one or
more channels (`webhook` | `discord` | `slack` | `email`). When `recordEvent` finishes, it schedules
the `alerts.dispatchForEvent` internal action. That action loads the project's enabled rules, decides
whether each one fires for this event, and delivers via `fetch` to webhook / Discord / Slack. Email
is not yet wired: with no SMTP transport it is a logged no-op, recorded as undelivered. Every attempt
is written to `alertDeliveries` for an audit trail. SMTP is on the Next horizon in
[ROADMAP.md](./ROADMAP.md).

**Crons** (`apps/backend/convex/crons.ts`), each bounded per run so a single invocation cannot run
unbounded:

- `sweepRetention` (daily) prunes events older than each project's configured retention.
- `sweepOngoing` (hourly) ages `new` issues older than 7 days to `ongoing`, so triage state reflects
  reality without manual upkeep.

## 7. Why Postgres backs only the Convex backend

There is a single Postgres 17 server, and it has exactly one owner: the self-hosted Convex backend.
The Sveltry app never connects to Postgres directly.

- `convex_self_hosted` - the self-hosted Convex backend's own internal store. Convex derives this
  name from the instance name (`convex-self-hosted` -> `convex_self_hosted`); the database must
  pre-exist. All Sveltry domain data (issues, events, etc.) and all auth data (users, sessions,
  accounts, jwks, organizations) live inside Convex and therefore inside this database.

This keeps self-hosting to a single stateful dependency to back up, monitor, and operate. Convex
manages this database through its own migrations and you must never hand-edit it. Note that
`POSTGRES_URL` for the Convex backend must be host-only (no database name, no query parameters);
Convex appends the derived name itself. See [SELF_HOSTING.md](./SELF_HOSTING.md) for the full setup.

## 8. Scaling and known limitations

- **Single-node Convex.** Self-hosted Convex runs as a single backend node. This is a deliberate
  non-goal rather than an oversight: it suits the team-and-product scale Sveltry targets and keeps
  operations simple. Horizontal multi-node scaling of the backend is explicitly out of scope (see the
  Non-goals section of [ROADMAP.md](./ROADMAP.md)). You scale by giving the node and its Postgres
  more resources, plus optional S3 / R2 blob offload via the `S3_BUCKET` env vars (see
  [SELF_HOSTING.md](./SELF_HOSTING.md)).

- **Accepted-but-not-stored envelope items.** Only the `event` item type is parsed and persisted.
  `transaction`, `session` / `sessions`, `attachment`, `replay_*`, `profile`, `check_in`,
  `client_report`, and `feedback` items return HTTP 200 (so SDKs do not back off or retry) but are
  not yet persisted or aggregated. See [SENTRY_COMPATIBILITY.md](./SENTRY_COMPATIBILITY.md).

- **The analytics tier is the real ceiling.** Convex over Postgres is excellent for the
  document-and-index workload that error tracking is (upsert an issue, insert an event, subscribe to
  a filtered list). It is not a columnar or time-series engine, so percentile aggregates over
  arbitrary windows are out of reach today. The Later horizon in [ROADMAP.md](./ROADMAP.md), namely
  performance / tracing, Discover-style dashboards, metric alerts, and session replay, depends on
  adding a dedicated analytics store. The `session` / `sessions` items already accepted at ingest are
  the seam where release-health aggregation will plug in once that tier exists.

- **Compression.** Only `gzip` and `deflate` request bodies are decompressed (via
  `DecompressionStream`); `br` and `zstd` return 400. This matches what mainstream JS SDKs send and
  avoids pulling in extra native codecs.

For anything in the Next or Later horizons, the existing tables and the protocol package are designed
to be extended rather than replaced: new envelope item types parse into the same normalize step, new
alert channels add to the same dispatch action, and new analytics consumers read the same event
blobs.
