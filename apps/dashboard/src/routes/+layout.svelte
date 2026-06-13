<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { setupConvex, setupAuth } from 'convex-svelte';
  import { env } from '$env/dynamic/public';
  import { authClient } from '$lib/auth-client';

  let { children } = $props();

  // One ConvexClient + WebSocket shared by every route.
  setupConvex(env.PUBLIC_CONVEX_URL ?? 'http://127.0.0.1:3210');

  const session = authClient.useSession();

  // Bridge the Better Auth JWT into authenticated Convex queries.
  setupAuth(() => ({
    isLoading: $session.isPending,
    isAuthenticated: !!$session.data,
    fetchAccessToken: async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!$session.data) return null;
      try {
        const { data } = await authClient.token(
          forceRefreshToken ? { query: { disableCache: true } } : {},
        );
        return data?.token ?? null;
      } catch {
        return null;
      }
    },
  }));
</script>

<ModeWatcher />
{@render children?.()}
