<script lang="ts">
  // In-app error boundary: renders inside the app shell (sidebar/nav stay
  // available) so a route error gives the user a branded message and a way
  // forward instead of SvelteKit's default page.
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui/button';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';

  const REPO = 'https://github.com/aihxp/sveltry';
  const status = $derived(page.status);
  const message = $derived(page.error?.message ?? 'Something went wrong on this page.');
</script>

<svelte:head><title>Error · Sveltry</title></svelte:head>

<div class="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
  <div
    class="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
  >
    <CircleAlertIcon class="size-6" />
  </div>
  <div class="space-y-1.5">
    <h1 class="text-xl font-semibold">Something went wrong</h1>
    <p class="text-sm text-muted-foreground">{message}{status ? ` (${status})` : ''}</p>
  </div>
  <div class="flex flex-wrap items-center justify-center gap-2">
    <Button href="/dashboard">Back to overview</Button>
    <Button href={`${REPO}/issues/new`} variant="outline" target="_blank" rel="noopener noreferrer"
      >Report an issue</Button
    >
  </div>
</div>
