#!/usr/bin/env bash
# One-command local setup for Sveltry.
#
#   ./scripts/setup.sh
#
# Brings up Postgres + the self-hosted Convex backend, generates secrets and an
# admin key, deploys the Convex functions, and migrates the Better Auth schema.
# Idempotent: safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\033[1;31m▌\033[0m %s\n' "$*"; }

command -v docker >/dev/null || { echo "docker is required"; exit 1; }
command -v bun >/dev/null || { echo "bun is required (https://bun.com)"; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required"; exit 1; }

# --- 1. Environment files ---------------------------------------------------
if [ ! -f infra/.env ]; then
  say "Creating infra/.env"
  cp infra/.env.example infra/.env
  SECRET="$(openssl rand -hex 32)"
  AUTH_SECRET="$(openssl rand -hex 32)"
  # macOS/BSD and GNU sed compatible in-place edit
  sed -i.bak "s/^INSTANCE_SECRET=.*/INSTANCE_SECRET=${SECRET}/" infra/.env
  # Seed the Better Auth secret too, so the Docker `--profile app` path works.
  sed -i.bak "s/^BETTER_AUTH_SECRET=.*/BETTER_AUTH_SECRET=${AUTH_SECRET}/" infra/.env
  rm -f infra/.env.bak
fi

# shellcheck disable=SC1091
set -a; source infra/.env; set +a
BACKEND_PORT="${BACKEND_PORT:-3210}"
SITE_PROXY_PORT="${SITE_PROXY_PORT:-3211}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-sveltry_dev_password}"
APP_URL="http://localhost:5173"

if [ ! -f apps/dashboard/.env ]; then
  say "Creating apps/dashboard/.env"
  cp apps/dashboard/.env.example apps/dashboard/.env
  AUTH_SECRET="$(openssl rand -hex 32)"
  sed -i.bak "s/^BETTER_AUTH_SECRET=.*/BETTER_AUTH_SECRET=${AUTH_SECRET}/" apps/dashboard/.env
  sed -i.bak "s|^PUBLIC_CONVEX_URL=.*|PUBLIC_CONVEX_URL=http://127.0.0.1:${BACKEND_PORT}|" apps/dashboard/.env
  sed -i.bak "s|^PUBLIC_SVELTRY_INGEST_URL=.*|PUBLIC_SVELTRY_INGEST_URL=http://127.0.0.1:${SITE_PROXY_PORT}|" apps/dashboard/.env
  sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/sveltry|" apps/dashboard/.env
  rm -f apps/dashboard/.env.bak
fi

# --- 2. Install + infra -----------------------------------------------------
say "Installing dependencies"
bun install

say "Starting Postgres + Convex backend"
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d postgres backend

say "Waiting for the backend to become healthy"
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/version" >/dev/null 2>&1; then break; fi
  sleep 2
done

# --- 3. Admin key + Convex deploy ------------------------------------------
if [ ! -f apps/backend/.env.local ]; then
  say "Generating Convex admin key"
  ADMIN_KEY="$(docker compose --env-file infra/.env -f infra/docker-compose.yml exec -T backend ./generate_admin_key.sh | tail -1 | tr -d '\r')"
  {
    echo "CONVEX_SELF_HOSTED_URL=http://127.0.0.1:${BACKEND_PORT}"
    echo "CONVEX_SELF_HOSTED_ADMIN_KEY=${ADMIN_KEY}"
  } > apps/backend/.env.local
fi

say "Configuring Convex environment variables"
( cd apps/backend
  bunx convex env set SITE_URL "${APP_URL}" >/dev/null
  bunx convex env set SVELTRY_JWT_AUDIENCE convex >/dev/null
  bunx convex env set SVELTRY_JWKS_URL "${APP_URL}/api/auth/jwks" >/dev/null
)

say "Deploying Convex functions"
( cd apps/backend && bunx convex dev --once )

# --- 4. Better Auth schema --------------------------------------------------
say "Migrating the Better Auth (Postgres) schema"
( cd apps/dashboard && bunx @better-auth/cli migrate -y ) || \
  say "Better Auth migrate skipped/failed - run 'cd apps/dashboard && bunx @better-auth/cli migrate' manually."

cat <<EOF

$(say 'Setup complete.')
  Convex dashboard : http://localhost:${CONVEX_DASHBOARD_PORT:-6791}   (run: bun run infra:up to start it)
  Start the app    : bun run dev:dashboard   ->  ${APP_URL}

Create an account, make a project, copy its DSN, and point a Sentry SDK at it.
EOF
