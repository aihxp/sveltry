import { createAuthClient } from 'better-auth/svelte';
import { jwtClient, organizationClient } from 'better-auth/client/plugins';
import { env } from '$env/dynamic/public';

/**
 * Browser auth client. `jwtClient()` exposes `authClient.token()` (the JWT
 * Convex consumes); `organizationClient()` exposes org create / setActive /
 * useActiveOrganization for multi-tenancy.
 */
export const authClient = createAuthClient({
  baseURL: env.PUBLIC_APP_URL ?? undefined,
  plugins: [jwtClient(), organizationClient()],
});

export const { signIn, signUp, signOut, useSession, organization } = authClient;
