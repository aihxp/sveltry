import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';

// SPIKE: Convex verifies the JWTs that the Better Auth component (running in Convex)
// issues. The provider points at the component's OIDC/JWKS served by Convex itself.
export default {
  providers: [getAuthConfigProvider()],
};
