<script lang="ts">
  import { page } from '$app/state';
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { cn, formatDuration, relativeTime } from '$lib/utils';

  const auth = useAuth();
  const monitorId = $derived(page.params.id as Id<'monitors'>);
  const data = useQuery(api.monitors.monitorCheckIns, () =>
    auth.isAuthenticated ? { monitorId, limit: 100 } : ('skip' as const),
  );

  function statusColor(status: string): string {
    if (status === 'ok') return 'bg-emerald-500';
    if (status === 'in_progress') return 'bg-sky-500 animate-pulse';
    if (status === 'error' || status === 'crashed' || status === 'timeout') return 'bg-destructive';
    return 'bg-muted-foreground';
  }
</script>

<svelte:head><title>{data.data?.monitor.slug ?? 'Monitor'} · Sveltry</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
  <a href="/monitors" class="text-sm text-muted-foreground hover:text-foreground">&larr; Monitors</a
  >

  {#if auth.isLoading || data.isLoading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if !data.data}
    <p class="text-sm text-destructive">Monitor not found.</p>
  {:else}
    {@const m = data.data.monitor}
    <div class="flex items-center gap-3">
      <span class={cn('size-3 rounded-full', statusColor(m.latestStatus))}></span>
      <h1 class="font-mono text-xl font-bold tracking-tight">{m.slug}</h1>
      <span class="text-xs uppercase tracking-wide text-muted-foreground">{m.latestStatus}</span>
    </div>

    <Card.Root>
      <Card.Header><Card.Title>Recent check-ins</Card.Title></Card.Header>
      <Card.Content class="px-0">
        {#if data.data.checkIns.length === 0}
          <p class="px-6 text-sm text-muted-foreground">No check-ins recorded.</p>
        {:else}
          <div class="divide-y border-t">
            {#each data.data.checkIns as c (c._id)}
              <div class="flex items-center gap-3 px-6 py-2.5 text-sm">
                <span class={cn('size-2 shrink-0 rounded-full', statusColor(c.status))}></span>
                <span class="w-24 shrink-0 text-xs font-medium uppercase tracking-wide"
                  >{c.status}</span
                >
                <span class="flex-1 tabular-nums text-muted-foreground">
                  {c.durationMs != null ? formatDuration(c.durationMs) : ''}
                </span>
                {#if c.release}<span
                    class="hidden truncate font-mono text-xs text-muted-foreground sm:inline"
                    >{c.release}</span
                  >{/if}
                <span class="w-16 shrink-0 text-right text-xs text-muted-foreground"
                  >{relativeTime(c.timestamp)}</span
                >
              </div>
            {/each}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
