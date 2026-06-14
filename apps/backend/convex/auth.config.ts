// Convex verifies the JWTs the Better Auth component issues (no Postgres). The
// `issuer` matches the token's `iss` (the public CONVEX_SITE_URL); `jwks` is
// fetched by the backend itself, so it points at the in-container HTTP origin
// (CONVEX_INTERNAL_SITE_URL) which is reachable, unlike the host-mapped port.
const issuer = process.env.CONVEX_SITE_URL ?? 'http://127.0.0.1:3216';
const internal = process.env.CONVEX_INTERNAL_SITE_URL ?? issuer;

export default {
  providers: [
    {
      type: 'customJwt' as const,
      issuer,
      applicationID: 'convex',
      algorithm: 'RS256' as const,
      jwks: `${internal}/api/auth/convex/jwks`,
    },
  ],
};
