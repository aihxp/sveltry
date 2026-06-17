<script lang="ts">
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { goto } from '$app/navigation';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { toast, errorMessage } from '$lib/toast.svelte';
  import { confirm } from '$lib/confirm.svelte';
  import { relativeTime } from '$lib/utils';
  import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
  import XIcon from '@lucide/svelte/icons/x';

  const auth = useAuth();
  const client = useConvexClient();
  const dashboards = useQuery(api.dashboards.listDashboards, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

  let name = $state('');
  let creating = $state(false);
  async function create() {
    const n = name.trim();
    if (!n || creating) return;
    creating = true;
    try {
      const id = await client.mutation(api.dashboards.createDashboard, { name: n });
      name = '';
      await goto(`/dashboards/${id}`);
    } finally {
      creating = false;
    }
  }
  async function remove(id: Id<'dashboards'>, name: string) {
    const ok = await confirm({
      title: 'Delete dashboard?',
      description: `"${name}" and all of its widgets will be deleted. This cannot be undone.`,
      confirmLabel: 'Delete dashboard',
    });
    if (!ok) return;
    try {
      await client.mutation(api.dashboards.deleteDashboard, { dashboardId: id });
      toast.success('Dashboard deleted');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the dashboard'));
    }
  }
</script>

<svelte:head><title>Dashboards · Sveltry</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Dashboards</h1>
    <p class="text-sm text-muted-foreground">
      Build dashboards from saved Discover queries. Add widgets from inside a dashboard.
    </p>
  </div>

  <Card.Root>
    <Card.Header><Card.Title>New dashboard</Card.Title></Card.Header>
    <Card.Content>
      <form class="flex gap-2" onsubmit={(e) => (e.preventDefault(), create())}>
        <Input
          bind:value={name}
          placeholder="Dashboard name, e.g. Ops overview"
          disabled={creating}
        />
        <Button type="submit" disabled={creating || !name.trim()}>Create</Button>
      </form>
    </Card.Content>
  </Card.Root>

  {#if auth.isLoading || dashboards.isLoading}
    <div class="space-y-3">
      {#each Array(2) as _, i (i)}<Skeleton class="h-16 w-full" />{/each}
    </div>
  {:else if !dashboards.data || dashboards.data.length === 0}
    <EmptyState title="No dashboards yet" description="Create one to start adding widgets." />
  {:else}
    <div class="divide-y rounded-lg border">
      {#each dashboards.data as d (d.id)}
        <div class="flex items-center gap-3 px-4 py-3">
          <LayoutDashboardIcon class="size-4 shrink-0 text-muted-foreground" />
          <a href={`/dashboards/${d.id}`} class="min-w-0 flex-1">
            <div class="truncate font-medium hover:text-primary">{d.name}</div>
            <div class="text-xs text-muted-foreground">
              {d.widgetCount}
              {d.widgetCount === 1 ? 'widget' : 'widgets'} · created {relativeTime(d.createdAt)}
            </div>
          </a>
          <button
            class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Delete dashboard"
            onclick={() => remove(d.id, d.name)}
          >
            <XIcon class="size-4" />
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
