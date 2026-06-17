<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import LoadError from '$lib/components/LoadError.svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn, compactNumber, formatDuration } from '$lib/utils';

  const auth = useAuth();

  type Dataset = 'errors' | 'transactions';
  type Aggregate = 'count' | 'users' | 'avg' | 'p50' | 'p75' | 'p95' | 'p99';

  const GROUP_FIELDS: Record<Dataset, { value: string; label: string }[]> = {
    errors: [
      { value: 'level', label: 'Level' },
      { value: 'environment', label: 'Environment' },
      { value: 'release', label: 'Release' },
      { value: 'platform', label: 'Platform' },
    ],
    transactions: [
      { value: 'name', label: 'Transaction' },
      { value: 'op', label: 'Operation' },
      { value: 'status', label: 'Status' },
      { value: 'environment', label: 'Environment' },
      { value: 'release', label: 'Release' },
      { value: 'platform', label: 'Platform' },
    ],
  };
  const AGGREGATES: Record<Dataset, { value: Aggregate; label: string }[]> = {
    errors: [
      { value: 'count', label: 'Event count' },
      { value: 'users', label: 'Unique users' },
    ],
    transactions: [
      { value: 'count', label: 'Count' },
      { value: 'avg', label: 'Avg duration' },
      { value: 'p50', label: 'p50 duration' },
      { value: 'p75', label: 'p75 duration' },
      { value: 'p95', label: 'p95 duration' },
      { value: 'p99', label: 'p99 duration' },
    ],
  };
  const RANGES = [
    { value: 1, label: 'Last hour' },
    { value: 24, label: 'Last 24 hours' },
    { value: 168, label: 'Last 7 days' },
    { value: 336, label: 'Last 14 days' },
    { value: 720, label: 'Last 30 days' },
  ];

  let dataset = $state<Dataset>('errors');
  let hours = $state(24);
  let groupBy = $state('level');
  let aggregate = $state<Aggregate>('count');

  const projects = useQuery(api.projects.listProjects, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
  let projectId = $state<string>('');

  // Keep groupBy / aggregate valid when the dataset changes.
  function switchDataset(d: Dataset) {
    dataset = d;
    groupBy = GROUP_FIELDS[d][0]!.value;
    aggregate = AGGREGATES[d][0]!.value;
  }

  const result = useQuery(api.discover.runDiscover, () =>
    auth.isAuthenticated
      ? {
          dataset,
          hours,
          groupBy,
          aggregate,
          projectId: projectId ? (projectId as Id<'projects'>) : undefined,
          limit: 50,
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

<svelte:head><title>Discover · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Discover</h1>
    <p class="text-sm text-muted-foreground">
      Group and aggregate your errors and transactions over a time window.
    </p>
  </div>

  <Card.Root>
    <Card.Content class="flex flex-wrap items-end gap-3 py-4">
      <div class="flex rounded-lg border bg-card p-1">
        {#each ['errors', 'transactions'] as const as d (d)}
          <button
            onclick={() => switchDataset(d)}
            class={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
              dataset === d
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {d}
          </button>
        {/each}
      </div>

      <label class="space-y-1 text-xs text-muted-foreground">
        <span>Group by</span>
        <select
          bind:value={groupBy}
          class="block h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {#each GROUP_FIELDS[dataset] as f (f.value)}
            <option value={f.value}>{f.label}</option>
          {/each}
        </select>
      </label>

      <label class="space-y-1 text-xs text-muted-foreground">
        <span>Aggregate</span>
        <select
          bind:value={aggregate}
          class="block h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {#each AGGREGATES[dataset] as a (a.value)}
            <option value={a.value}>{a.label}</option>
          {/each}
        </select>
      </label>

      <label class="space-y-1 text-xs text-muted-foreground">
        <span>Project</span>
        <select
          bind:value={projectId}
          class="block h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">All projects</option>
          {#each projects.data ?? [] as p (p._id)}
            <option value={p._id}>{p.name}</option>
          {/each}
        </select>
      </label>

      <label class="space-y-1 text-xs text-muted-foreground">
        <span>Range</span>
        <select
          bind:value={hours}
          class="block h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {#each RANGES as r (r.value)}
            <option value={r.value}>{r.label}</option>
          {/each}
        </select>
      </label>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="capitalize">{dataset} by {groupBy}</Card.Title>
      {#if result.data}
        <Card.Description>
          {compactNumber(result.data.matched)} rows analyzed{result.data.sampled
            ? ' (sampled, capped at 10k)'
            : ''}.
        </Card.Description>
      {/if}
    </Card.Header>
    <Card.Content>
      {#if auth.isLoading || result.isLoading}
        <div class="space-y-2">
          {#each Array(6) as _, i (i)}<Skeleton class="h-7 w-full" />{/each}
        </div>
      {:else if result.error}
        <LoadError message="Couldn't run the query." error={result.error} />
      {:else if rows.length === 0}
        <EmptyState title="No data" description="No matching rows in this window." />
      {:else}
        <div class="space-y-1.5">
          {#each rows as row (row.group)}
            <div class="flex items-center gap-3 text-sm">
              <div class="w-48 shrink-0 truncate font-medium" title={row.group}>{row.group}</div>
              <div class="relative h-6 flex-1 overflow-hidden rounded bg-muted/40">
                <div
                  class="absolute inset-y-0 left-0 rounded bg-primary/70"
                  style={`width:${Math.max(2, (row.value / maxValue) * 100)}%`}
                ></div>
              </div>
              <div class="w-24 shrink-0 text-right font-mono tabular-nums">{fmt(row.value)}</div>
              <div class="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {compactNumber(row.count)}
              </div>
            </div>
          {/each}
        </div>
        <div class="mt-2 flex gap-3 text-right text-xs text-muted-foreground">
          <div class="w-48 shrink-0"></div>
          <div class="flex-1"></div>
          <div class="w-24 shrink-0">value</div>
          <div class="w-16 shrink-0">events</div>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
