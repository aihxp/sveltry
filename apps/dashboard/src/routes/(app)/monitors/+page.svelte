<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn, formatDuration, relativeTime } from '$lib/utils';

  const auth = useAuth();
  const monitors = useQuery(api.monitors.listMonitors, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

  // ok = healthy, error/crashed/timeout = down, in_progress = running.
  function statusColor(status: string): string {
    if (status === 'ok') return 'bg-emerald-500';
    if (status === 'in_progress') return 'bg-sky-500 animate-pulse';
    if (status === 'error' || status === 'crashed' || status === 'timeout') return 'bg-destructive';
    return 'bg-muted-foreground';
  }
</script>

<svelte:head><title>Monitors · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Monitors</h1>
    <p class="text-sm text-muted-foreground">Cron job check-ins. Each row is a monitor slug.</p>
  </div>

  <Card.Root>
    <Card.Header><Card.Title>Cron monitors</Card.Title></Card.Header>
    <Card.Content class="px-0">
      {#if auth.isLoading || monitors.isLoading}
        <div class="space-y-3 px-6">
          {#each Array(4) as _, i (i)}<Skeleton class="h-10 w-full" />{/each}
        </div>
      {:else if monitors.error}
        <p class="px-6 text-sm text-destructive">Failed to load: {monitors.error.toString()}</p>
      {:else if !monitors.data || monitors.data.length === 0}
        <div class="px-6 pb-2">
          <EmptyState
            title="No monitors yet"
            description="Instrument a cron job with Sentry check-ins (Sentry.captureCheckIn) to track it here."
          />
        </div>
      {:else}
        <div class="divide-y border-t">
          {#each monitors.data as m (m._id)}
            <a
              href={`/monitors/${m._id}`}
              class="flex items-center gap-3 px-6 py-3 text-sm hover:bg-muted/30"
            >
              <span class={cn('size-2.5 shrink-0 rounded-full', statusColor(m.latestStatus))}
              ></span>
              <span class="min-w-0 flex-1 truncate font-mono font-medium">{m.slug}</span>
              <span
                class="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >{m.latestStatus}</span
              >
              {#if m.lastDurationMs != null}
                <span class="hidden shrink-0 tabular-nums sm:inline"
                  >{formatDuration(m.lastDurationMs)}</span
                >
              {/if}
              <span class="w-16 shrink-0 text-right text-xs text-muted-foreground"
                >{relativeTime(m.lastCheckInAt)}</span
              >
            </a>
          {/each}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
