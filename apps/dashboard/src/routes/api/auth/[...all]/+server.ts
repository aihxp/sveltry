import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { env } from '$env/dynamic/public';

// Proxies /api/auth/* to the Convex-served Better Auth handler and manages cookies.
export const { GET, POST } = createSvelteKitHandler({
  convexSiteUrl: env.PUBLIC_CONVEX_SITE_URL,
});
