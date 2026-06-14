import { createAuthClient } from 'better-auth/svelte';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { env } from '$env/dynamic/public';

/**
 * Browser auth client. Auth requests go to this app's `/api/auth/*`, which the
 * handler at `routes/api/auth/[...all]` proxies to the Convex-served Better Auth
 * (no Postgres). The `convexClient()` plugin exposes `authClient.convex.token()`,
 * the JWT that authenticates Convex queries.
 */
export const authClient = createAuthClient({
  baseURL: env.PUBLIC_APP_URL ?? undefined,
  plugins: [convexClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
