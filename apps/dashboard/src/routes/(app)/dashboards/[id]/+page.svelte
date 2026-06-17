<script lang="ts">
  import { page } from '$app/state';
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import DiscoverWidget from '$lib/components/DiscoverWidget.svelte';
  import { toast, errorMessage } from '$lib/toast.svelte';
  import { confirm } from '$lib/confirm.svelte';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import PlusIcon from '@lucide/svelte/icons/plus';

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

  const auth = useAuth();
  const client = useConvexClient();
  const dashboardId = $derived(page.params.id as Id<'dashboards'>);

  const dashboard = useQuery(api.dashboards.getDashboard, () =>
    auth.isAuthenticated ? { dashboardId } : ('skip' as const),
  );
  const projects = useQuery(api.projects.listProjects, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

  // Add-widget form state.
  let adding = $state(false);
  let title = $state('');
  let dataset = $state<Dataset>('errors');
  let groupBy = $state('level');
  let aggregate = $state<Aggregate>('count');
  let hours = $state(24);
  let projectId = $state('');
  let saving = $state(false);

  function switchDataset(d: Dataset) {
    dataset = d;
    groupBy = GROUP_FIELDS[d][0]!.value;
    aggregate = AGGREGATES[d][0]!.value;
  }

  async function addWidget() {
    if (saving) return;
    saving = true;
    try {
      await client.mutation(api.dashboards.addWidget, {
        dashboardId,
        title: title.trim(),
        dataset,
        groupBy,
        aggregate,
        hours,
        projectId: projectId ? (projectId as Id<'projects'>) : undefined,
      });
      title = '';
      adding = false;
    } finally {
      saving = false;
    }
  }
  async function removeWidget(widgetId: Id<'dashboardWidgets'>, title: string) {
    const ok = await confirm({
      title: 'Remove widget?',
      description: `"${title}" will be removed from this dashboard. You can add it again later.`,
      confirmLabel: 'Remove widget',
    });
    if (!ok) return;
    try {
      await client.mutation(api.dashboards.removeWidget, { widgetId });
      toast.success('Widget removed');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not remove the widget'));
    }
  }

  const selectClass =
    'block h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
</script>

<svelte:head><title>{dashboard.data?.name ?? 'Dashboard'} · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <a
    href="/dashboards"
    class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
  >
    <ChevronLeftIcon class="size-4" /> Dashboards
  </a>

  {#if auth.isLoading || dashboard.isLoading}
    <Skeleton class="h-8 w-48" />
    <div class="grid gap-4 sm:grid-cols-2">
      {#each Array(2) as _, i (i)}<Skeleton class="h-48 w-full" />{/each}
    </div>
  {:else if !dashboard.data}
    <EmptyState title="Dashboard not found" description="It may have been deleted." />
  {:else}
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold tracking-tight">{dashboard.data.name}</h1>
      <Button variant="outline" size="sm" onclick={() => (adding = !adding)}>
        <PlusIcon class="size-4" /> Add widget
      </Button>
    </div>

    {#if adding}
      <Card.Root>
        <Card.Header><Card.Title>New widget</Card.Title></Card.Header>
        <Card.Content class="space-y-3">
          <div class="flex flex-wrap items-end gap-3">
            <div class="flex rounded-lg border bg-card p-1">
              {#each ['errors', 'transactions'] as const as d (d)}
                <button
                  onclick={() => switchDataset(d)}
                  class={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${dataset === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                  {d}
                </button>
              {/each}
            </div>
            <select bind:value={groupBy} class={selectClass}>
              {#each GROUP_FIELDS[dataset] as f (f.value)}<option value={f.value}>{f.label}</option
                >{/each}
            </select>
            <select bind:value={aggregate} class={selectClass}>
              {#each AGGREGATES[dataset] as a (a.value)}<option value={a.value}>{a.label}</option
                >{/each}
            </select>
            <select bind:value={projectId} class={selectClass}>
              <option value="">All projects</option>
              {#each projects.data ?? [] as p (p._id)}<option value={p._id}>{p.name}</option>{/each}
            </select>
            <select bind:value={hours} class={selectClass}>
              {#each RANGES as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
            </select>
          </div>
          <div class="flex gap-2">
            <Input bind:value={title} placeholder="Widget title (optional)" class="max-w-xs" />
            <Button onclick={addWidget} disabled={saving}>Add</Button>
            <Button variant="ghost" onclick={() => (adding = false)}>Cancel</Button>
          </div>
        </Card.Content>
      </Card.Root>
    {/if}

    {#if dashboard.data.widgets.length === 0}
      <EmptyState title="No widgets yet" description="Add a widget to chart a Discover query." />
    {:else}
      <div class="grid gap-4 sm:grid-cols-2">
        {#each dashboard.data.widgets as w (w.id)}
          <DiscoverWidget
            title={w.title}
            dataset={w.dataset}
            groupBy={w.groupBy}
            aggregate={w.aggregate}
            hours={w.hours}
            projectId={w.projectId}
            filters={w.filters}
            onremove={() => removeWidget(w.id, w.title)}
          />
        {/each}
      </div>
    {/if}
  {/if}
</div>
