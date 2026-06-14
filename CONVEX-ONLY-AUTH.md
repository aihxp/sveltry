# Convex-only auth (no Postgres)

Sveltry now runs auth entirely on Convex. Postgres is removed.

## How it works

- **Identity**: `@convex-dev/better-auth` in COMPONENT mode (email+password + the `convex()`
  plugin). Auth tables (user/session/account/jwks) live in Convex. The auth handler is served by
  Convex; the SvelteKit app proxies `/api/auth/*` to it via
  `@mmailaender/convex-better-auth-svelte`. No `organization` plugin.
- **Organizations**: modeled natively in Convex (`organizations` / `memberRoles` / `userSettings`);
  `requireOrg` resolves the active org from Convex. The dashboard uses `api.organizations.*`.
- **Gating**: client-side (`(app)/+layout.svelte` redirects to `/login` if unauthenticated and to
  `/onboarding` if the user has no active org).

Verified end-to-end in a browser: sign up -> onboarding -> create org -> dashboard, with
authenticated Convex queries (issue stats, members, roles) and the user/org/role shown in settings.

## Deployment env

Dashboard (`apps/dashboard/.env`):
- `PUBLIC_CONVEX_URL`: the Convex websocket/data URL (e.g. host `:3215`).
- `PUBLIC_CONVEX_SITE_URL`: the Convex HTTP origin where auth is served (e.g. host `:3216`).
- `PUBLIC_APP_URL`: the dashboard's own origin; must match where it is served (auth Origin check).

Convex backend (`npx convex env set ...`):
- `SITE_URL`: the dashboard origin. Better Auth's `trustedOrigins` defaults to this, so it must
  equal `PUBLIC_APP_URL` or sign-in fails with "Invalid origin".
- `CONVEX_INTERNAL_SITE_URL`: the in-container HTTP-actions origin the backend uses to fetch its
  own JWKS for token verification. Set this when the public `CONVEX_SITE_URL` is a host-mapped port
  the backend container cannot reach itself (this repo's docker maps host `:3216` -> container
  `:3211`, so set `http://localhost:3211`). Defaults to `CONVEX_SITE_URL` when unset (correct for
  setups without port-mapping divergence). Without it, `getUserIdentity()` returns null and every
  authenticated call is "Unauthenticated".

## Remaining

- One-time backfill for existing self-hosted instances that already have Better Auth (Postgres)
  orgs: ensure an `organizations` row + owner `memberRoles` row + `userSettings` per user, keyed by
  the existing `organizationId` slug. New instances need nothing.
- Remove the Postgres service from `infra/docker-compose.yml` (no longer used by the app).
