<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { compactNumber, formatDuration } from '$lib/utils';
  import XIcon from '@lucide/svelte/icons/x';

  type Aggregate = 'count' | 'users' | 'avg' | 'p50' | 'p75' | 'p95' | 'p99';

  let {
    title,
    dataset,
    groupBy,
    aggregate,
    hours,
    projectId = null,
    filters = [],
    onremove,
  }: {
    title: string;
    dataset: 'errors' | 'transactions';
    groupBy: string;
    aggregate: Aggregate;
    hours: number;
    projectId?: string | null;
    filters?: { field: string; value: string }[];
    onremove?: () => void;
  } = $props();

  const auth = useAuth();
  const result = useQuery(api.discover.runDiscover, () =>
    auth.isAuthenticated
      ? {
          dataset,
          groupBy,
          aggregate,
          hours,
          projectId: projectId ? (projectId as Id<'projects'>) : undefined,
          filters: filters.length ? filters : undefined,
          limit: 8,
        }
      : ('skip' as const),
  );

  const isDuration = $derived(
    dataset === 'transactions' && aggregate !== 'count' && aggregate !== 'users',
  );
  const rows = $derived(result.data?.rows ?? []);
  const maxValue = $derived(Math.max(1, ...rows.map((r) => r.value)));
  function fmt(value: number): string {
    return isDuration ? formatDuration(value) : compactNumber(value);
  }
</script>

<Card.Root>
  <Card.Header class="flex-row items-start justify-between space-y-0 pb-3">
    <div>
      <Card.Title class="text-base">{title}</Card.Title>
      <Card.Description class="text-xs capitalize">
        {dataset} · {aggregate} by {groupBy} · {hours}h
      </Card.Description>
    </div>
    {#if onremove}
      <button
        class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Remove widget"
        onclick={onremove}
      >
        <XIcon class="size-4" />
      </button>
    {/if}
  </Card.Header>
  <Card.Content>
    {#if result.isLoading}
      <div class="space-y-2">
        {#each Array(4) as _, i (i)}<Skeleton class="h-5 w-full" />{/each}
      </div>
    {:else if result.error}
      <p class="text-sm text-destructive">Failed to load.</p>
    {:else if rows.length === 0}
      <p class="py-4 text-center text-sm text-muted-foreground">No data in this window.</p>
    {:else}
      <div class="space-y-1">
        {#each rows as row (row.group)}
          <div class="flex items-center gap-2 text-sm">
            <div class="w-28 shrink-0 truncate text-xs" title={row.group}>{row.group}</div>
            <div class="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
              <div
                class="absolute inset-y-0 left-0 rounded bg-primary/70"
                style={`width:${Math.max(2, (row.value / maxValue) * 100)}%`}
              ></div>
            </div>
            <div class="w-16 shrink-0 text-right font-mono text-xs tabular-nums">
              {fmt(row.value)}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
