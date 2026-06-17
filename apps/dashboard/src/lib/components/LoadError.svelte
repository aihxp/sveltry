<script lang="ts">
  // A shared "couldn't load this" block for failed reactive queries. Shows a
  // plain, human message and a Retry action; the raw error is logged to the
  // console for developers rather than rendered to users.
  import { Button } from '$lib/components/ui/button';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { cn } from '$lib/utils';

  let {
    message = 'Something went wrong while loading this.',
    error = undefined,
    onretry = undefined,
    class: className = undefined,
  }: {
    message?: string;
    error?: unknown;
    onretry?: () => void;
    class?: string;
  } = $props();

  // Surface the real error to developers; users only see the friendly message.
  $effect(() => {
    if (error) console.error('[LoadError]', message, error);
  });

  function retry() {
    // A reactive Convex subscription recovers on reconnect, so a reload is a
    // reliable universal retry unless the caller supplies its own.
    if (onretry) onretry();
    else location.reload();
  }
</script>

<div
  class={cn(
    'flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4',
    className,
  )}
  role="alert"
>
  <p class="flex items-center gap-2 text-sm text-destructive">
    <CircleAlertIcon class="size-4 shrink-0" />
    {message}
  </p>
  <Button variant="outline" size="sm" onclick={retry}>Retry</Button>
</div>
