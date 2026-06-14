# Convex-only auth (no Postgres)

Status of removing Postgres so Sveltry runs on Convex alone.

## Proven + done

- **Identity on Convex works.** This branch wires `@convex-dev/better-auth` in
  COMPONENT mode (email+password + the `convex()` plugin, NO organization plugin) and it is
  deployed + verified on the self-hosted backend: `GET /api/auth/convex/jwks` returns RS256
  keys and `POST /api/auth/sign-up/email` + `get-session` create/return a user **in Convex,
  no Postgres**. Files: `apps/backend/convex/convex.config.ts`, `betterauth.ts`,
  `auth.config.ts` (getAuthConfigProvider), `http.ts` (registerRoutes), `better-auth` added to
  the backend workspace.
- **Organizations are Convex-native** (merged to main, PR #34): `organizations` source of
  truth, `memberRoles` membership, `userSettings` active org; `requireOrg` resolves from
  Convex. So the Better Auth organization plugin is no longer needed.

## Remaining: the SvelteKit frontend rewire (needs a browser to validate)

The login/cookie/token flow can only be confidence-validated in a browser. Exact wiring
(adapter `@mmailaender/convex-better-auth-svelte@0.8.0`, already installed):

1. `src/lib/auth-client.ts`: `createAuthClient({ baseURL: PUBLIC_APP_URL, plugins: [convexClient()] })`
   (`convexClient` from `@convex-dev/better-auth/client/plugins`). Drop `jwtClient`/`organizationClient`.
   `authClient.convex.token()` replaces `authClient.token()`.
2. `src/routes/api/auth/[...all]/+server.ts` (new):
   `export const { GET, POST } = createSvelteKitHandler({ convexSiteUrl: PUBLIC_CONVEX_SITE_URL })`
   (the backend HTTP origin, port 3216). This proxies /api/auth/* to Convex and sets the JWT cookie.
3. `src/routes/+layout.svelte`: replace `setupConvex`+`setupAuth`+the manual token bridge with
   `createSvelteAuthClient({ authClient, convexUrl: PUBLIC_CONVEX_URL })`.
4. `src/hooks.server.ts`: drop the standalone `auth.api.getSession` (no Postgres instance); keep
   `handleError`. Gate auth CLIENT-side (simplest, avoids SSR token plumbing).
5. `src/routes/(app)/+layout.server.ts`: drop the `activeOrganizationId` redirect. Move gating into
   `(app)/+layout.svelte`: `useAuth()` -> redirect `/login` if not authed; `useQuery(api.organizations.activeOrg)`
   -> redirect `/onboarding` if null; use its `name` for the org label.
6. `src/routes/onboarding/+page.svelte`: replace `authClient.organization.create/setActive` with
   `client.mutation(api.organizations.createOrganization, { name })` then `goto('/dashboard')`.
7. `settings/+page.svelte` + `teams/+page.svelte`: replace `authClient.useActiveOrganization()` /
   `$activeOrg.data.members` with `useQuery(api.organizations.activeOrg)` and
   `useQuery(api.organizations.listMembers)`.
8. `src/app.d.ts`: drop `activeOrganizationId` from PageData; simplify `Locals`.
9. Delete `src/lib/auth.ts` (the pg Pool + standalone instance). Remove `pg`/`@types/pg` and
   `DATABASE_URL`. Add `PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3216` to the dashboard env.
10. Remove the Postgres service from `infra/docker-compose.yml` once the migration is validated.

## Validate (in a browser)

`bun run dev`, then: sign up -> redirected to /onboarding -> create org (Convex
`createOrganization`) -> land on /dashboard -> confirm an authenticated Convex query (e.g. issues)
returns the org's data. Then sign out / sign in. Once green, drop Postgres and merge.
