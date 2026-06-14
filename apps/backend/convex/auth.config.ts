import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';

// Convex verifies the JWTs the Better Auth component issues; the component serves
// its OIDC/JWKS from this Convex deployment (CONVEX_SITE_URL), no Postgres.
export default {
  providers: [getAuthConfigProvider()],
};
