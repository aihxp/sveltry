# Self-Hosting Sveltry

A practical guide to running Sveltry in production. Sveltry is an open-source,
Sentry-compatible error tracker: unmodified official `@sentry/*` SDKs report to it.

A deployment has four moving parts:

- **Postgres**: one server, a single logical database (`convex_self_hosted`) that is
  the Convex backend's own store. The Sveltry app does not connect to Postgres.
- **Convex backend** (`ghcr.io/get-convex/convex-backend`): runs the app functions
  and the `/api/` ingest HTTP actions, and serves the Better Auth handler (Better
  Auth runs on Convex via the `@convex-dev/better-auth` component). It publishes the
  JWKS at `{CONVEX_SITE_URL}/api/auth/convex/jwks`.
- **SvelteKit dashboard** (`apps/dashboard`): the web UI. It proxies `/api/auth/*` to
  the Convex-served auth handler.
- **Convex admin dashboard** (`ghcr.io/get-convex/convex-dashboard`): optional, for
  inspecting tables and logs.

Three public origins matter, and they must agree everywhere:

| Role | Backend env var | Dashboard env var | Local default |
| --- | --- | --- | --- |
| Client / WebSocket API (`.cloud`) | `CONVEX_CLOUD_ORIGIN` | `PUBLIC_CONVEX_URL` | `http://127.0.0.1:3210` |
| HTTP actions / ingest / auth (`.site`) | `CONVEX_SITE_ORIGIN` | `PUBLIC_CONVEX_SITE_URL` / `PUBLIC_SVELTRY_INGEST_URL` | `http://127.0.0.1:3211` |
| Dashboard origin | (Convex `SITE_URL`) | `PUBLIC_APP_URL` | `http://localhost:5173` |

The `.site` origin is where Convex serves both the auth handler (`/api/auth/*`) and
the ingest HTTP actions; the ingest origin is the host that goes into project DSNs.
The dashboard default `http://localhost:5173` is the Vite dev server used by
`bun run dev:dashboard`; the Docker `--profile app` path serves the built app on
`http://localhost:3000` instead, so set `PUBLIC_APP_URL` and the Convex `SITE_URL`
to match whichever you run.

## Prerequisites

- **Docker** with the Compose plugin.
- **Bun** 1.3.11 (https://bun.com). Used to install, build, and run the Convex CLI.
- **openssl** for generating secrets.
- A Postgres 17 server for the Convex backend's store. The Compose file ships one;
  in production you may point at managed Postgres instead.
- For production: a domain (or subdomains) and a TLS-terminating reverse proxy. An
  example Caddyfile is in `infra/Caddyfile`.

## Quick local path

From the repo root:

```sh
bun install
./scripts/setup.sh
```

`scripts/setup.sh` is idempotent and does the following:

1. Copies `infra/.env.example` to `infra/.env` and fills `INSTANCE_SECRET` with
   `openssl rand -hex 32`.
2. Copies `apps/dashboard/.env.example` to `apps/dashboard/.env`, and points
   `PUBLIC_CONVEX_URL`, `PUBLIC_CONVEX_SITE_URL`, `PUBLIC_SVELTRY_INGEST_URL`, and
   `PUBLIC_APP_URL` at the local backend and dashboard.
3. Runs `bun install`, then brings up the `postgres` and `backend` services and
   waits for the backend `/version` endpoint to respond.
4. Generates a Convex admin key inside the backend container and writes
   `apps/backend/.env.local` (`CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY`).
5. Sets the Convex env var `SITE_URL` (= `PUBLIC_APP_URL`), and `CONVEX_INTERNAL_SITE_URL`
   if the backend container cannot reach its own public `.site` origin.
6. Deploys the Convex functions with `bunx convex dev --once`. Better Auth runs on
   Convex via the `@convex-dev/better-auth` component, so its tables
   (user / session / account / jwks) are created by the Convex schema push; there is
   no separate schema-migration step.

When it finishes, start the dashboard:

```sh
bun run dev:dashboard   # http://localhost:5173
```

Create an account, make a project, copy its DSN, and point a Sentry SDK at it.

## Manual path, step by step

Use this to understand each step or when deploying to a server.

### 1. Copy the env examples

```sh
cp infra/.env.example infra/.env
cp apps/dashboard/.env.example apps/dashboard/.env
```

### 2. Generate secrets

```sh
openssl rand -hex 32   # -> INSTANCE_SECRET in infra/.env
```

Paste the value into `INSTANCE_SECRET`, the Convex instance signing secret. Never
commit it.

### 3. Bring up Postgres and the Convex backend

```sh
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d postgres backend
```

On first start, `infra/postgres/init.sql` creates the `convex_self_hosted` database
before the backend connects. Wait for the backend to become healthy:

```sh
docker compose --env-file infra/.env -f infra/docker-compose.yml logs -f backend
# wait for the "Connected to Postgres" line, then a healthy /version response
curl -fsS http://127.0.0.1:3210/version
```

### 4. Generate the Convex admin key

```sh
docker compose --env-file infra/.env -f infra/docker-compose.yml \
  exec backend ./generate_admin_key.sh
```

### 5. Write `apps/backend/.env.local`

This tells the Convex CLI which deployment to target:

```sh
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=<the admin key from step 4>
```

In production, set `CONVEX_SELF_HOSTED_URL` to the public `CONVEX_CLOUD_ORIGIN`
(for example `https://convex.example.com`).

### 6. Set the Convex environment variables

Run from `apps/backend/`:

```sh
cd apps/backend
bunx convex env set SITE_URL "http://localhost:5173"
# Set CONVEX_INTERNAL_SITE_URL only if the backend container cannot reach its own
# public .site origin (for example a host-mapped port). It defaults to
# CONVEX_SITE_URL when unset.
bunx convex env set CONVEX_INTERNAL_SITE_URL "http://localhost:3211"
```

To deliver **email alerts**, also set the SMTP env vars (email is a clean no-op until
`SMTP_HOST` is set, so this is optional):

```sh
bunx convex env set SMTP_HOST "smtp.example.com"
bunx convex env set SMTP_PORT "587"          # 465 for implicit TLS
bunx convex env set SMTP_SECURE "false"      # "true" for port 465
bunx convex env set SMTP_USER "apikey"       # optional
bunx convex env set SMTP_PASS "..."          # optional
bunx convex env set SMTP_FROM "alerts@example.com"
```

To **offload large blobs** (source maps today) to an S3-compatible bucket instead of
storing them inline in Convex, set the S3 env vars. Offload is a clean no-op until
`S3_BUCKET` is set, so this is optional; unset leaves all blobs in Convex storage.

```sh
bunx convex env set S3_BUCKET "sveltry-blobs"
bunx convex env set S3_ACCESS_KEY_ID "..."
bunx convex env set S3_SECRET_ACCESS_KEY "..."
bunx convex env set S3_REGION "auto"          # "auto" for R2; the AWS region for S3
bunx convex env set S3_ENDPOINT "https://<acct>.r2.cloudflarestorage.com"  # set for R2/MinIO; unset for AWS S3
bunx convex env set S3_FORCE_PATH_STYLE "true"  # "true" for MinIO (fine for R2)
bunx convex env set S3_OFFLOAD_MIN_BYTES "102400"  # only offload blobs this size or larger
```

To tune the **outbound SSRF guard's DNS-rebinding check**, set `SSRF_DOH_RESOLVER`.
Every outbound webhook/alert/uptime/integration request goes through `safeFetch`, which
(beyond a literal host/scheme denylist re-checked on each redirect hop) resolves the
target hostname over DNS-over-HTTPS and rejects it if any A/AAAA record is a blocked IP,
defeating DNS rebinding. This var controls that resolve step:

```sh
# Unset (default): resolve via Cloudflare DoH (https://cloudflare-dns.com/dns-query).
bunx convex env set SSRF_DOH_RESOLVER "https://dns.google/resolve"  # a custom DoH endpoint
bunx convex env set SSRF_DOH_RESOLVER "off"                          # disable the resolve check
```

Set a custom URL if Cloudflare DoH is unreachable from your network. Setting it to `off`
(or empty) disables only the resolve-time rebinding check; the literal host/scheme guard
stays on, but a hostname whose DNS record points at a blocked IP would no longer be
caught, so leave it enabled unless you have a specific reason. The current mode shows up
in the admin `configStatus` readout.

`SITE_URL` is the dashboard origin and must equal `PUBLIC_APP_URL`; it is Better
Auth's trusted-origin check, and a mismatch fails sign-in with "Invalid origin". In
production, use your real dashboard origin.

`CONVEX_INTERNAL_SITE_URL` is the in-container HTTP-actions origin the backend uses
to fetch its own JWKS (at `/api/auth/convex/jwks`) for token verification. Set it
when the public `CONVEX_SITE_URL` is a host-mapped port the backend container cannot
reach itself; otherwise `getUserIdentity()` returns null and every authenticated
call fails "Unauthenticated". It defaults to `CONVEX_SITE_URL` when unset.

### 7. Deploy the Convex functions

```sh
cd apps/backend
bunx convex dev --once       # deploy once and exit
# or for a non-watch production deploy:
bunx convex deploy
```

This pushes the schema and functions; on first run it creates the indexes. Because
Better Auth runs on Convex via the `@convex-dev/better-auth` component, this same
push creates its tables (user / session / account / jwks) in Convex. Organizations,
members, and roles are modeled natively in Convex (`organizations` / `memberRoles` /
`userSettings`), so there is no separate Better Auth schema migration to run.

### 8. Run the app

For development, `bun run dev:dashboard` (http://localhost:5173). For production,
see the next section.

## Production

### Managed / external Postgres

Postgres is used only as the Convex backend's own store. The Sveltry app does not
connect to Postgres. You can replace the bundled `postgres` service with managed
Postgres (Neon, RDS, Cloud SQL). Three rules:

- **The backend's `POSTGRES_URL` must be host-only**: no database name, no query
  parameters. The backend derives the db name from `INSTANCE_NAME`
  (`convex-self-hosted` -> `convex_self_hosted`). Example:
  `postgres://user:pass@db.internal:5432`.
- **Pre-create the `convex_self_hosted` database** before first boot; the backend
  does not create it. (Locally, `infra/postgres/init.sql` does this.)
- **Keep SSL on**: managed Postgres uses TLS, so omit `DO_NOT_REQUIRE_SSL` (it is
  only `1` for the local non-TLS container).

Co-locate the database and backend in the same region/network; cross-region
latency is the most common cause of slow ingest and slow dashboard queries.

### TLS and domains via the Caddyfile

`infra/Caddyfile` is a starting point. Caddy auto-provisions TLS certificates.
Replace the example domains with your own and map the four upstreams:

| Subdomain | Upstream | Purpose |
| --- | --- | --- |
| `app.example.com` | `127.0.0.1:3000` | SvelteKit dashboard (adapter-node) |
| `convex.example.com` | `127.0.0.1:3210` | Convex client / WebSocket API |
| `ingest.example.com` | `127.0.0.1:3211` | Sentry ingest endpoint (goes into DSNs) |
| `convex-admin.example.com` | `127.0.0.1:6791` | Convex admin dashboard (lock this down) |

Restrict the admin dashboard with basic auth or an IP allowlist; it has full read
access to your data.

```sh
caddy run --config infra/Caddyfile
```

### Wiring the public origins

Once TLS is in place, set the origins so every component agrees. In `infra/.env`
(read by the backend container):

```sh
CONVEX_CLOUD_ORIGIN=https://convex.example.com
CONVEX_SITE_ORIGIN=https://ingest.example.com
```

In `apps/dashboard/.env` (read by the SvelteKit app):

```sh
PUBLIC_CONVEX_URL=https://convex.example.com
PUBLIC_CONVEX_SITE_URL=https://ingest.example.com
PUBLIC_SVELTRY_INGEST_URL=https://ingest.example.com
PUBLIC_APP_URL=https://app.example.com
```

`PUBLIC_CONVEX_SITE_URL` is the Convex HTTP origin where the auth handler
(`/api/auth/*`) and ingest are served; `PUBLIC_SVELTRY_INGEST_URL` is the same HTTP
origin, used in project DSNs.

And update the Convex env var to match the dashboard origin:

```sh
cd apps/backend
bunx convex env set SITE_URL "https://app.example.com"
# If the public .site origin is not reachable from inside the backend container,
# also set the internal origin the backend uses to fetch its own JWKS:
bunx convex env set CONVEX_INTERNAL_SITE_URL "http://localhost:3211"
```

`SITE_URL` and `PUBLIC_APP_URL` must be identical, or Better Auth's trusted-origin
check rejects sign-in with "Invalid origin".

### Optional S3 / R2 file storage

By default Convex stores file data on the `backend-data` volume. To offload to S3
or an S3-compatible store (Cloudflare R2), set the `S3_STORAGE_*_BUCKET` variables
on the backend container, along with the AWS credential and region variables your
provider needs. This is optional.

### Running the SvelteKit app in production

The dashboard builds with `adapter-node`. Three ways to run it:

1. **adapter-node directly** (provide env via `apps/dashboard/.env` or the process):

   ```sh
   bun run build                          # builds all workspaces
   bun ./apps/dashboard/build/index.js    # serves on :3000 (PORT overridable)
   ```

2. **The dashboard Dockerfile** (`apps/dashboard/Dockerfile`), built from the repo
   root so the Bun workspace resolves:

   ```sh
   docker build -f apps/dashboard/Dockerfile -t sveltry-dashboard .
   docker run -p 3000:3000 --env-file apps/dashboard/.env sveltry-dashboard
   ```

3. **The Compose `app` profile**, after the backend is deployed. It derives env from
   `infra/.env`, so set `PUBLIC_APP_URL` there (and make sure the Convex `SITE_URL`
   matches it):

   ```sh
   docker compose --env-file infra/.env -f infra/docker-compose.yml \
     --profile app up -d --build app
   ```

## Environment variable reference

### Infra (`infra/.env`, read by `docker compose`)

| Variable | Purpose |
| --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | Postgres superuser credentials |
| `POSTGRES_PORT` | Host port for Postgres (default 5432) |
| `INSTANCE_NAME` | Convex instance name; determines the db name (`convex_self_hosted`) |
| `INSTANCE_SECRET` | Convex instance signing secret (`openssl rand -hex 32`) |
| `BACKEND_PORT` | Host port for the `.cloud` API (default 3210) |
| `SITE_PROXY_PORT` | Host port for the `.site` ingest origin (default 3211) |
| `CONVEX_DASHBOARD_PORT` | Host port for the Convex admin dashboard (default 6791) |
| `CONVEX_CLOUD_ORIGIN` | Public client / WebSocket origin |
| `CONVEX_SITE_ORIGIN` | Public HTTP-actions / ingest origin |
| `DO_NOT_REQUIRE_SSL` | `1` for local non-TLS Postgres; omit for managed TLS Postgres |
| `PUBLIC_APP_URL` | Dashboard public origin (used by the `app` profile) |

### Backend deployment (`apps/backend/.env.local` + Convex env)

| Variable | Where | Purpose |
| --- | --- | --- |
| `CONVEX_SELF_HOSTED_URL` | `.env.local` | Deployment URL the CLI targets |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | `.env.local` | Admin key from `generate_admin_key.sh` |
| `SITE_URL` | `convex env set` | Dashboard origin; Better Auth trusted-origin check (must equal `PUBLIC_APP_URL`) |
| `CONVEX_INTERNAL_SITE_URL` | `convex env set` | In-container HTTP-actions origin the backend uses to fetch its own JWKS; defaults to `CONVEX_SITE_URL`. Set when the public `.site` origin is unreachable from inside the container |

### Dashboard (`apps/dashboard/.env`)

| Variable | Purpose |
| --- | --- |
| `PUBLIC_CONVEX_URL` | The `.cloud` origin, Convex client / WebSocket origin (= `CONVEX_CLOUD_ORIGIN`) |
| `PUBLIC_CONVEX_SITE_URL` | The `.site` HTTP origin where auth (`/api/auth/*`) and ingest are served (= `CONVEX_SITE_ORIGIN`) |
| `PUBLIC_SVELTRY_INGEST_URL` | The same `.site` HTTP origin, used to build project DSNs (= `CONVEX_SITE_ORIGIN`) |
| `PUBLIC_APP_URL` | The dashboard's own origin (must equal Convex `SITE_URL`) |

## Upgrades

The Compose file pins the backend and dashboard images to `:latest`. To upgrade
safely, **export before bumping the image tag** so you can roll back:

```sh
cd apps/backend
bunx convex export --path ./convex-backup.zip
```

Then pull the new image and recreate the service:

```sh
docker compose --env-file infra/.env -f infra/docker-compose.yml pull backend
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d backend
```

Re-deploy functions if the schema changed (`bunx convex deploy`). For predictable
upgrades, pin the image to a specific tag instead of `:latest`.

### Migrating a pre-Convex-auth deployment

Older Sveltry ran Better Auth on a separate Postgres `sveltry` database with
organizations from the Better Auth org plugin. Auth and organizations now live in
Convex. New installs need nothing. If you are upgrading an instance that already has
data, after deploying the new backend:

- Set `SITE_URL` (and `CONVEX_INTERNAL_SITE_URL` if needed) per step 6, drop
  `DATABASE_URL` / `BETTER_AUTH_SECRET` from the dashboard env, and remove the
  obsolete `SVELTRY_JWKS_URL` / `SVELTRY_JWT_AUDIENCE` Convex env vars.
- Existing tenant data is keyed by the organization slug (`organizationId`). For each
  such org, insert an `organizations` row (`slug` = that id) and an owner `memberRoles`
  row for its owner, and a `userSettings` row per user pointing at their org, so
  `requireOrg` resolves the same tenant. Users re-register with email + password (Better
  Auth password hashes do not carry over). The old `sveltry` Postgres database can then
  be dropped (the `convex_self_hosted` database stays, it is Convex's own store).

## Backups

All application data, including auth (user / session / account / jwks tables) and
organizations, lives in Convex, so there is no separate identity database to dump.

- **Convex data (events, issues, projects, auth, organizations):**

  ```sh
  cd apps/backend
  bunx convex export --path ./convex-data.zip
  ```

Also back up the Postgres volume (or take a managed snapshot) so the
`convex_self_hosted` database, the Convex backend's own store, is captured. Restore
Convex data with `bunx convex import`.

## Health and metrics

`GET /healthz` (on the backend `.site` origin) is a **readiness** probe: it runs a
real bounded DB read and returns `503` when the backend cannot serve, not just when
the process is up. Wire it to a load balancer's readiness check or a Kubernetes
`readinessProbe`; do not use it as a `livenessProbe`, since a DB-touching check can
flap a healthy process into a restart loop during a brief DB blip.

There is no Prometheus/OpenTelemetry `/metrics` endpoint: for this single-node
self-hosted target, rely on the Convex dashboard for per-function request rates,
latency, and error counts, and on the backend log stream for the crons' summary
lines and the delivery-failure warnings (webhooks, alerts, metric/usage/uptime/
tracker). Admins can also pull `health.configStatus` (surfaced as a banner on the
Settings page) to confirm `SITE_URL`, SMTP, S3, and the SSRF resolver are configured.

## Troubleshooting

- **Port conflicts.** The defaults are Postgres 5432, backend (`.cloud`) 3210,
  ingest (`.site`) 3211, Convex admin 6791, dashboard 5173 (dev) / 3000 (prod). If
  any are taken, change `POSTGRES_PORT`, `BACKEND_PORT`, `SITE_PROXY_PORT`, or
  `CONVEX_DASHBOARD_PORT` in `infra/.env` and update the matching public origins.

- **Backend never becomes healthy.** Check the logs for the `Connected to Postgres`
  line. If it is missing, the backend cannot reach Postgres or the
  `convex_self_hosted` database does not exist. Confirm `POSTGRES_URL` is host-only
  (no db name, no query params) and that the database was pre-created.

- **"Invalid origin" on sign-in.** Better Auth rejects requests whose origin is not
  trusted. The Convex `SITE_URL` must exactly equal `PUBLIC_APP_URL` (the dashboard's
  own origin); a mismatch is the most common cause.

- **Authenticated calls fail "Unauthenticated" / `getUserIdentity()` is null.** The
  backend fetches its own JWKS at `{CONVEX_SITE_URL}/api/auth/convex/jwks` to verify
  tokens. If the public `.site` origin is a host-mapped port the backend container
  cannot reach itself, set `CONVEX_INTERNAL_SITE_URL` (for example
  `http://localhost:3211`) to the in-container HTTP-actions origin. It defaults to
  `CONVEX_SITE_URL` when unset.

- **SDK reports 400 on ingest.** Sveltry decompresses `gzip` and `deflate` only.
  `br` (Brotli) and `zstd` are not supported and return 400. Most JS SDKs send
  uncompressed or gzip, so this usually means a transport override; remove it.

- **Wrong key returns 401.** A bad or missing DSN public key returns HTTP 401 with
  an `X-Sentry-Error` header. Re-copy the DSN from the project page; the ingest host
  in the DSN must be your `.site` origin.
