/**
 * Bridge Better Auth (Postgres-backed identity) into Convex. Better Auth's JWT
 * plugin issues RS256 tokens and publishes a JWKS; Convex verifies them
 * statelessly via this Custom JWT provider. No auth data is stored in Convex.
 *
 * Required deployment env vars (set with `npx convex env set ...`):
 *  - SITE_URL          the dashboard origin, e.g. https://sveltry.example.com
 *                      (must equal Better Auth's `jwt.issuer`)
 *  - SVELTRY_JWKS_URL  optional override of the JWKS endpoint; defaults to
 *                      `${SITE_URL}/api/auth/jwks`
 *
 * `applicationID` must equal Better Auth's `jwt.audience` (default: "convex").
 */
const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');

export default {
  providers: [
    {
      type: 'customJwt',
      applicationID: process.env.SVELTRY_JWT_AUDIENCE ?? 'convex',
      issuer: siteUrl,
      jwks: process.env.SVELTRY_JWKS_URL ?? `${siteUrl}/api/auth/jwks`,
      algorithm: 'RS256',
    },
  ],
};
