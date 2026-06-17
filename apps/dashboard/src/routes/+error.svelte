<script lang="ts">
  // Root error boundary: replaces SvelteKit's unstyled default page for any
  // unhandled route error outside the authenticated app (and as the fallback).
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui/button';
  import Logo from '$lib/components/Logo.svelte';

  const REPO = 'https://github.com/aihxp/sveltry';
  const status = $derived(page.status);
  const message = $derived(
    page.error?.message ??
      (status === 404 ? 'This page could not be found.' : 'Something went wrong.'),
  );
</script>

<svelte:head><title>{status} · Sveltry</title></svelte:head>

<div
  class="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center"
>
  <Logo />
  <div class="space-y-2">
    <p class="text-5xl font-bold tracking-tight tabular-nums">{status}</p>
    <p class="max-w-md text-balance text-muted-foreground">{message}</p>
  </div>
  <div class="flex flex-wrap items-center justify-center gap-3">
    <Button href="/">Back to home</Button>
    <Button href={`${REPO}/issues/new`} variant="outline" target="_blank" rel="noopener noreferrer"
      >Report an issue</Button
    >
  </div>
</div>
