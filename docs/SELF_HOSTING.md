# Self-Hosting Sveltry

A practical guide to running Sveltry in production. Sveltry is an open-source,
Sentry-compatible error tracker: unmodified official `@sentry/*` SDKs report to it.

A deployment has four moving parts:

- **Postgres**: one server, two logical databases (`convex_self_hosted` for the
  Convex backend's store, `sveltry` for Better Auth identity).
- **Convex backend** (`ghcr.io/get-convex/convex-backend`): runs the app functions
  and the `/api/` ingest HTTP actions.
- **SvelteKit dashboard** (`apps/dashboard`): hosts Better Auth, issues the RS256
  JWTs Convex verifies, and publishes the JWKS at `/api/auth/jwks`.
- **Convex admin dashboard** (`ghcr.io/get-convex/convex-dashboard`): optional, for
  inspecting tables and logs.

Three public origins matter, and they must agree everywhere:

| Role | Backend env var | Dashboard env var | Local default |
| --- | --- | --- | --- |
| Client / WebSocket API (`.cloud`) | `CONVEX_CLOUD_ORIGIN` | `PUBLIC_CONVEX_URL` | `http://127.0.0.1:3210` |
| HTTP actions / ingest (`.site`) | `CONVEX_SITE_ORIGIN` | `PUBLIC_SVELTRY_INGEST_URL` | `http://127.0.0.1:3211` |
| Dashboard origin = JWT issuer | (Convex `SITE_URL`) | `PUBLIC_APP_URL` | `http://localhost:5173` |

The ingest origin (`.site`) is the host that goes into project DSNs. The dashboard
default `http://localhost:5173` is the Vite dev server used by `bun run dev:dashboard`;
the Docker `--profile app` path serves the built app on `http://localhost:3000` instead,
so set `PUBLIC_APP_URL` and the Convex `SITE_URL` to match whichever you run.

## Prerequisites

- **Docker** with the Compose plugin.
- **Bun** 1.3.11 (https://bun.com). Used to install, build, and run the Convex CLI.
- **openssl** for generating secrets.
- A Postgres 17 server. The Compose file ships one; in production you may point at
  managed Postgres instead.
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
2. Copies `apps/dashboard/.env.example` to `apps/dashboard/.env`, generates
   `BETTER_AUTH_SECRET`, and points `PUBLIC_CONVEX_URL`,
   `PUBLIC_SVELTRY_INGEST_URL`, and `DATABASE_URL` at the local backend.
3. Runs `bun install`, then brings up the `postgres` and `backend` services and
   waits for the backend `/version` endpoint to respond.
4. Generates a Convex admin key inside the backend container and writes
   `apps/backend/.env.local` (`CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY`).
5. Sets the Convex env vars `SITE_URL`, `SVELTRY_JWT_AUDIENCE` (= `convex`), and
   `SVELTRY_JWKS_URL` (= `SITE_URL` + `/api/auth/jwks`).
6. Deploys the Convex functions with `bunx convex dev --once`.
7. Migrates the Better Auth schema with `bunx @better-auth/cli migrate`.

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
openssl rand -hex 32   # -> BETTER_AUTH_SECRET in apps/dashboard/.env
```

Paste each value into the matching variable. `INSTANCE_SECRET` is the Convex
instance signing secret; `BETTER_AUTH_SECRET` signs sessions. Never commit either.

### 3. Bring up Postgres and the Convex backend

```sh
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d postgres backend
```

On first start, `infra/postgres/init.sql` creates both databases
(`convex_self_hosted` and `sveltry`) before the backend connects. Wait for the
backend to become healthy:

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
bunx convex env set SVELTRY_JWT_AUDIENCE "convex"
bunx convex env set SVELTRY_JWKS_URL "http://localhost:5173/api/auth/jwks"
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

`SITE_URL` is the dashboard origin and JWT issuer; it must equal `PUBLIC_APP_URL`.
`SVELTRY_JWT_AUDIENCE` is the JWT `aud` claim (`convex`). `SVELTRY_JWKS_URL` is
where the backend fetches signing keys to verify JWTs statelessly. In production,
use your real dashboard origin in both URLs.

### 7. Deploy the Convex functions

```sh
cd apps/backend
bunx convex dev --once       # deploy once and exit
# or for a non-watch production deploy:
bunx convex deploy
```

This pushes the schema and functions; on first run it creates the indexes.

### 8. Migrate the Better Auth schema

```sh
cd apps/dashboard
bunx @better-auth/cli migrate
```

This creates the users / sessions / accounts / organizations / jwks tables in the
`sveltry` database.

### 9. Run the app

For development, `bun run dev:dashboard` (http://localhost:5173). For production,
see the next section.

## Production

### Managed / external Postgres

You can replace the bundled `postgres` service with managed Postgres (Neon, RDS,
Cloud SQL). Three rules:

- **The backend's `POSTGRES_URL` must be host-only**: no database name, no query
  parameters. The backend derives the db name from `INSTANCE_NAME`
  (`convex-self-hosted` -> `convex_self_hosted`). Example:
  `postgres://user:pass@db.internal:5432`.
- **Pre-create the `convex_self_hosted` database** before first boot; the backend
  does not create it. Also create `sveltry` for Better Auth. (Locally,
  `infra/postgres/init.sql` does both.)
- **Keep SSL on**: managed Postgres uses TLS, so omit `DO_NOT_REQUIRE_SSL` (it is
  only `1` for the local non-TLS container).

Co-locate the database and backend in the same region/network; cross-region
latency is the most common cause of slow ingest and slow dashboard queries.

The dashboard's `DATABASE_URL` is separate and *does* include the db name and
options, e.g. `postgres://user:pass@db.internal:5432/sveltry?sslmode=require`.

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
PUBLIC_SVELTRY_INGEST_URL=https://ingest.example.com
PUBLIC_APP_URL=https://app.example.com
```

And update the Convex env vars to match the dashboard origin:

```sh
cd apps/backend
bunx convex env set SITE_URL "https://app.example.com"
bunx convex env set SVELTRY_JWKS_URL "https://app.example.com/api/auth/jwks"
```

`SITE_URL` (the JWT issuer) and `PUBLIC_APP_URL` must be identical, or Convex will
reject every JWT.

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

3. **The Compose `app` profile**, after the backend is deployed and Better Auth is
   migrated. It derives env from `infra/.env`, so set `BETTER_AUTH_SECRET` and
   `PUBLIC_APP_URL` there:

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
| `BETTER_AUTH_SECRET` | Session signing secret (used by the `app` profile) |
| `PUBLIC_APP_URL` | Dashboard public origin (used by the `app` profile) |

### Backend deployment (`apps/backend/.env.local` + Convex env)

| Variable | Where | Purpose |
| --- | --- | --- |
| `CONVEX_SELF_HOSTED_URL` | `.env.local` | Deployment URL the CLI targets |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | `.env.local` | Admin key from `generate_admin_key.sh` |
| `SITE_URL` | `convex env set` | Dashboard origin = JWT issuer (must equal `PUBLIC_APP_URL`) |
| `SVELTRY_JWT_AUDIENCE` | `convex env set` | JWT `aud` claim (`convex`) |
| `SVELTRY_JWKS_URL` | `convex env set` | JWKS URL the backend fetches (`SITE_URL` + `/api/auth/jwks`) |

### Dashboard (`apps/dashboard/.env`)

| Variable | Purpose |
| --- | --- |
| `PUBLIC_CONVEX_URL` | The `.cloud` origin (= `CONVEX_CLOUD_ORIGIN`) |
| `PUBLIC_SVELTRY_INGEST_URL` | The `.site` origin used to build DSNs (= `CONVEX_SITE_ORIGIN`) |
| `PUBLIC_APP_URL` | Dashboard public origin = Better Auth issuer = Convex `SITE_URL` |
| `DATABASE_URL` | Postgres connection for the `sveltry` database (with db name + options) |
| `BETTER_AUTH_SECRET` | Session signing secret (`openssl rand -hex 32`) |

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

## Backups

Back up both stores:

- **Better Auth identity (Postgres):**

  ```sh
  pg_dump "$DATABASE_URL" > sveltry-identity.sql
  ```

- **Convex data (events, issues, projects):**

  ```sh
  cd apps/backend
  bunx convex export --path ./convex-data.zip
  ```

Also back up the Postgres volume (or take a managed snapshot) so the
`convex_self_hosted` database is captured. Restore Convex data with
`bunx convex import`.

## Troubleshooting

- **Port conflicts.** The defaults are Postgres 5432, backend (`.cloud`) 3210,
  ingest (`.site`) 3211, Convex admin 6791, dashboard 5173 (dev) / 3000 (prod). If
  any are taken, change `POSTGRES_PORT`, `BACKEND_PORT`, `SITE_PROXY_PORT`, or
  `CONVEX_DASHBOARD_PORT` in `infra/.env` and update the matching public origins.

- **Backend never becomes healthy.** Check the logs for the `Connected to Postgres`
  line. If it is missing, the backend cannot reach Postgres or the
  `convex_self_hosted` database does not exist. Confirm `POSTGRES_URL` is host-only
  (no db name, no query params) and that the database was pre-created.

- **JWTs rejected / login loops.** The backend must be able to reach
  `SVELTRY_JWKS_URL` to fetch the signing keys. Make sure the dashboard is running,
  `SITE_URL` exactly equals `PUBLIC_APP_URL`, and the JWKS URL returns a document
  from the backend's network. A mismatched issuer is the most common cause.

- **SDK reports 400 on ingest.** Sveltry decompresses `gzip` and `deflate` only.
  `br` (Brotli) and `zstd` are not supported and return 400. Most JS SDKs send
  uncompressed or gzip, so this usually means a transport override; remove it.

- **Wrong key returns 401.** A bad or missing DSN public key returns HTTP 401 with
  an `X-Sentry-Error` header. Re-copy the DSN from the project page; the ingest host
  in the DSN must be your `.site` origin.
