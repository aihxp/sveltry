<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import {
    createSvelteAuthClient,
    type AuthClient,
  } from '@mmailaender/convex-better-auth-svelte/svelte';
  import { env } from '$env/dynamic/public';
  import { authClient } from '$lib/auth-client';

  let { children } = $props();

  // Sets up the shared Convex client and bridges the Better Auth session into
  // authenticated Convex queries (calls setupConvex + setupAuth internally). The
  // cast bridges a 0.x type mismatch between the adapter's AuthClient and the
  // better-auth client with the convexClient plugin (compatible at runtime).
  createSvelteAuthClient({
    authClient: authClient as unknown as AuthClient,
    convexUrl: env.PUBLIC_CONVEX_URL ?? 'http://127.0.0.1:3210',
  });
</script>

<ModeWatcher />
{@render children?.()}
