# Sentry Wire Protocol Compatibility

Sveltry implements a compatible subset of the Sentry ingestion wire protocol. Unmodified
official `@sentry/*` SDKs can report errors to a Sveltry deployment by changing a single
value: the DSN. No SDK forks, shims, or patches are required.

Sveltry is not affiliated with Sentry or Functional Software. This document is the
definitive reference for exactly what Sveltry accepts, what it persists, and how it
responds, so you can predict SDK behavior against a Sveltry endpoint.

## DSN format

```
https://PUBLIC_KEY@INGEST_HOST/PROJECT_PUBLIC_ID
```

- `PUBLIC_KEY` is the project's public key (Sveltry uses it as `sentry_key`).
- `INGEST_HOST` is the Convex `.site` origin that serves the ingest HTTP actions
  (`PUBLIC_SVELTRY_INGEST_URL` in `apps/dashboard/.env`). In local development this is the
  Convex `.site` port (default 3211).
- `PROJECT_PUBLIC_ID` is the project's public id (the trailing path segment).

### How to obtain a DSN

- In the dashboard: open the project and copy its DSN from the project settings page.
- Programmatically with the `@aihxp/sveltry-sdk` helper:

```ts
import { buildSveltryDsn } from "@aihxp/sveltry-sdk";

const dsn = buildSveltryDsn({
  ingestHost: "https://your-deployment.convex.site",
  publicKey: "PUBLIC_KEY",
  projectId: "PROJECT_PUBLIC_ID",
});
```

Auth validates the `(publicId, publicKey)` pair against the `projectKeys` table via the
internal `resolveIngestKey` query. A mismatch is rejected (see error contract below).

## Endpoints

Ingestion is served by Convex HTTP actions on the `.site` origin. The HTTP router
(`apps/backend/convex/http.ts`) maps `pathPrefix '/api/'`:

- `POST /api/<id>/envelope/` - modern envelope endpoint. Accepts all item types.
- `POST /api/<id>/store/` - legacy single-event endpoint. Body is one JSON event.
- `OPTIONS /api/...` - CORS preflight.
- `GET /healthz` - readiness probe (touches the DB; returns 503 if the backend cannot serve).

The project id is extracted from the path by `projectIdFromPath`. It also recognizes
`security` and `minidump` routes and tolerates them: such requests return `200` but the
payload is not stored.

## Authentication

Credentials may be supplied two ways. The header wins when both are present.

1. `X-Sentry-Auth` header (Sentry's standard form):

   ```
   X-Sentry-Auth: Sentry sentry_version=7, sentry_key=PUBLIC_KEY, sentry_client=sentry.javascript.node/10.57.0
   ```

2. Query string on the request URL:

   ```
   ?sentry_key=PUBLIC_KEY&sentry_version=7&sentry_client=sentry.javascript.node/10.57.0
   ```

`sentry_secret` is accepted and ignored (it is legacy and not required). The
`(publicId, publicKey)` pair is the unit of authorization, scoped to one project.

## Decompression

The request body is decompressed transparently based on `Content-Encoding`:

- `gzip` - supported (via `fflate`, pure JS so it works in the Convex isolate).
- `deflate` - supported (via `fflate`).
- `br` (Brotli) - not supported. Returns `400`.
- `zstd` - not supported. Returns `400`.

Most JavaScript SDKs send the body uncompressed or gzip-compressed, so this covers the
common path. If you control transport options, prefer no compression or gzip.

## Content-Type handling

`Content-Type` is ignored. Browser SDKs intentionally send an empty `Content-Type` to
avoid triggering a CORS preflight, so Sveltry does not gate on it. The body is parsed as
an envelope (newline-delimited) or, on the `/store/` route, as a single JSON event.

## Response contract

### Success

```
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"<32 lowercase hex>"}
```

The `id` echoes the ingested event id. Notably, success responses carry **no rate-limit
headers**, so SDKs do not enter a back-off state and keep reporting normally.

### Bad or missing key

```
HTTP/1.1 401 Unauthorized
X-Sentry-Error: <reason>
```

### Malformed body

```
HTTP/1.1 400 Bad Request
X-Sentry-Error: <reason>

{"detail":"...","causes":[...]}
```

Unsupported compression (`br`, `zstd`) also returns `400`.

### Throttled

```
HTTP/1.1 429 Too Many Requests
Retry-After: <seconds>
```

Rate limiting is an optional per-key fixed-window limit. When configured and exceeded, the
request is throttled with `429` and a `Retry-After` header.

## Envelope item types

Sveltry parses every item in an envelope but only persists what it currently models.

| Item type        | Behavior                                  |
| ---------------- | ----------------------------------------- |
| `event`          | Parsed and persisted (grouped into issues)|
| `transaction`    | Parsed and persisted (performance + traces)|
| `session`        | Parsed and persisted (release health)     |
| `sessions`       | Parsed and persisted (release-health buckets)|
| `attachment`     | Parsed and persisted (event attachments)  |
| `replay_event`   | Parsed and persisted (replay metadata)    |
| `replay_recording`| Parsed and persisted (rrweb recording)   |
| `profile`        | Parsed and persisted (flamegraph)         |
| `check_in`       | Parsed and persisted (cron monitors)      |
| `client_report`  | Accepted (200); discarded-event counts folded into usage accounting |
| `feedback`       | Parsed and persisted (user feedback)      |

"Accepted, not yet persisted" means the request succeeds with `200` and the SDK is happy,
but no aggregation, storage, or UI surface exists for that item type yet.

## Fingerprinting and grouping

Each `event` is normalized, then a SHA-1 grouping fingerprint is computed. Grouping
behaves as follows:

- If the SDK supplies a `fingerprint` array, Sveltry honors it. The `{{ default }}` merge
  token is supported: it expands to Sveltry's default fingerprint, so you can combine your
  own keys with the default grouping.
- The default fingerprint uses the exception type plus the normalized in-app stack frames.
  Normalization strips line numbers and dynamic values (numbers, UUIDs, hex strings) so
  near-identical errors collapse into one issue.

`recordEvent` upserts an issue keyed by `(projectId, fingerprint)`:

- New fingerprint: insert a new issue (`status: unresolved`, `substatus: new`).
- Existing fingerprint: increment `count`, bump `lastSeen`, update `level`. If the issue
  was resolved, it reopens with `substatus: regressed`.

This was verified end to end: two `TypeError` events with the same stack shape but
different line numbers and dynamic user ids grouped into one issue (count 2), while a
`RangeError` formed a separate issue (count 1).

## Point your SDK at Sveltry

In every case you only change the `dsn`. Everything else is standard Sentry SDK usage.

### @sentry/sveltekit

```ts
// hooks.client.ts / hooks.server.ts
import * as Sentry from "@sentry/sveltekit";

Sentry.init({
  dsn: "https://PUBLIC_KEY@your-deployment.convex.site/PROJECT_PUBLIC_ID",
});
```

### @sentry/node

```ts
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://PUBLIC_KEY@your-deployment.convex.site/PROJECT_PUBLIC_ID",
});
```

### @sentry/browser

```ts
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "https://PUBLIC_KEY@your-deployment.convex.site/PROJECT_PUBLIC_ID",
});
```

### Helper and tunnel

The `@aihxp/sveltry-sdk` package provides:

- `buildSveltryDsn(...)` to construct a DSN from parts.
- `recommendedSentryOptions` for sensible defaults against a Sveltry endpoint.
- `createTunnelHandler(...)` to set up a Sentry `tunnel`. A tunnel routes browser SDK
  events through your own origin, which sidesteps ad blockers that target Sentry hosts and
  avoids cross-origin concerns. Point the SDK's `tunnel` option at the handler's route.

## Test it with curl

Send a newline-delimited envelope. The body is three lines: an envelope header, an item
header, and the item payload (the event).

```bash
curl -i \
  -X POST \
  "https://your-deployment.convex.site/api/PROJECT_PUBLIC_ID/envelope/?sentry_key=PUBLIC_KEY&sentry_version=7" \
  -H "Content-Type: application/x-sentry-envelope" \
  --data-binary $'{"event_id":"fc6d8c0c43fc4630ad850ee518f1b9d0","sent_at":"2026-06-13T00:00:00.000Z"}\n{"type":"event"}\n{"event_id":"fc6d8c0c43fc4630ad850ee518f1b9d0","level":"error","platform":"javascript","exception":{"values":[{"type":"TypeError","value":"Cannot read properties of undefined (reading \'id\')"}]}}'
```

Expected response:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"fc6d8c0c43fc4630ad850ee518f1b9d0"}
```

A request with a wrong `sentry_key` returns `401`:

```
HTTP/1.1 401 Unauthorized
X-Sentry-Error: <reason>
```

You can also verify the deployment is up:

```bash
curl -i https://your-deployment.convex.site/healthz
```

## Source maps

Upload a release's `.map` files so minified production stack frames resolve to original
source. The endpoint is on the ingest (`.site`) origin, DSN-key authenticated, one file per
request:

```
POST /artifacts/upload?sentry_key=<publicKey>&o=<projectId>&release=<version>&name=<name>
<raw file bytes>
```

`name` is the artifact path as it appears in stack frames (or its `.map`), e.g.
`~/app.min.js.map`. Files ending in `.map` are stored as source maps. From CI, prefer the
SDK helper:

```ts
import { uploadSourceMaps } from '@aihxp/sveltry-sdk';
import { readFileSync } from 'node:fs';

await uploadSourceMaps({
  dsn: process.env.SVELTRY_DSN!,
  release: process.env.GIT_SHA!, // must match your Sentry SDK's `release`
  files: [{ name: '~/app.min.js.map', content: readFileSync('dist/app.min.js.map', 'utf8') }],
});
```

On ingest, any event with matching maps has its minified JavaScript frames resolved to
original file, line, function, and surrounding source context. Resolution runs off the
ingest hot path and matches a frame to a map by **debug ID** first (from a `//# debugId=`
comment / the map's `debugId` field, via the event's `debug_meta`, independent of release),
falling back to **name + release** matching. Debug-ID matching means events without a
release still symbolicate.

To associate the commits that may have caused an issue, upload a release's commits and their
changed files (DSN-key authenticated, mirrors `sentry-cli releases set-commits`):

```
POST /releases/commits?sentry_key=<publicKey>&o=<projectId>
{ "release": "<version>", "commits": [{ "id": "<sha>", "message": "...", "author": "...",
  "timestamp": "2026-06-12T00:00:00Z", "files": ["src/app.ts"] }] }
```

`files` may instead be given as a `patch_set` of `{ path, type }` entries. The issue page then
shows the commits that changed a file appearing in the stack trace, most recent first.

## Known limitations

- `br` (Brotli) and `zstd` request compression are not supported and return `400`. Send
  the body uncompressed or gzip/deflate.
- `event`, `transaction`, and individual `session` items are persisted (errors,
  performance, and release health, including aggregated `sessions` buckets), along with
  `check_in` items (cron monitors), `replay_event` + `replay_recording` items (session
  replay), and `profile` items (flamegraphs). `client_report` is accepted with `200` but
  not yet surfaced (SDK-dropped-event accounting).
- Minidumps are not processed. The `minidump` route is recognized and tolerated (`200`)
  but the payload is discarded, so native crash reports are not decoded.
