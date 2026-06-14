# Spike: Better Auth on Convex — findings (DO NOT MERGE)

Evaluating migrating auth from Better-Auth-on-Postgres to the `@convex-dev/better-auth`
Convex component, so Convex becomes the single database.

## Works (verified headless via curl against the self-hosted backend)

- `@convex-dev/better-auth@0.12.3` installs; peer deps satisfied (better-auth 1.6.18, convex 1.41).
- The component **installs and deploys** on the self-hosted backend (`Installed component betterAuth`).
- **Auth runs entirely on Convex (no Postgres):** sign-up, sign-in, get-session, and the
  JWKS endpoint (`/api/auth/convex/jwks`, RS256) all work; a real user persists in Convex.

## The org blocker — root cause (definitive)

`POST /api/auth/organization/create` → HTTP 500. The real error (from function logs):

```
ArgumentValidationError: Path: .model  Value: "member"
Validator: v.union("user","session","account","verification","twoFactor",
                   "oauthApplication","oauthAccessToken","oauthConsent","jwks","rateLimit")
```

The **component ships a fixed schema** that covers only the curated "supported plugins"
(user/session/account/verification/twoFactor/oauth*/jwks/rateLimit). It has **no
`member`/`organization`/`team`/`invitation` tables and no `session.activeOrganizationId`**, so
any organization-plugin write is rejected by the component's adapter.

This **rules out the memory mitigations**: the earlier `TooMuchMemoryCarryOver(63 MiB / 96 MiB)`
isolate warning was a red herring — `registerRoutesLazy` and raising the isolate memory limit do
not apply. The 500 is a schema-coverage error.

## The fix: Local Install mode

The organization plugin needs **local-install mode** (per Convex's docs): embed the component's
source into the app's Convex dir so the schema is generated from *your* plugin set (including
`organization`), which adds the org/member/team/invitation tables and the
`session.activeOrganizationId` field. This is a structural change and is the bulk of the real
migration; it also needs a browser login + org/role end-to-end to fully validate (not possible
headless).

## What this branch wires (component mode — the working baseline, minus org)

- `convex.config.ts` registers the betterAuth component.
- `betterauth.ts`: `createClient` + `createAuth` (`organization()` + `convex({ authConfig })`).
- `auth.config.ts` uses the component's `getAuthConfigProvider()`.
- `http.ts` mounts the auth handler via `authComponent.registerRoutes`.
- `better-auth` added to the backend workspace (was dashboard-only).

## Recommendation

Right end-state, and the core demonstrably works on Convex. Not turnkey: a 0.x component with
deploy-time-only config gotchas, a community SvelteKit adapter, and the org plugin requiring
local-install. Migrate as a focused, deliberate effort (do local-install first, validate the
browser org/role flow), or revisit at 1.0. Stay on Postgres until then.
