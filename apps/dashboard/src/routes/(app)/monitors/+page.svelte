<script lang="ts">
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn, formatDuration, relativeTime } from '$lib/utils';
  import TrashIcon from '@lucide/svelte/icons/trash-2';

  const auth = useAuth();
  const client = useConvexClient();
  const monitors = useQuery(api.monitors.listMonitors, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
  const uptime = useQuery(api.monitors.listUptimeMonitors, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
  const projects = useQuery(api.projects.listProjects, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

  let name = $state('');
  let url = $state('');
  let intervalMin = $state(5);
  let projectId = $state<string>('');
  let saving = $state(false);
  let error = $state('');

  async function addUptime(e: SubmitEvent) {
    e.preventDefault();
    const pid = projectId || projects.data?.[0]?._id;
    if (!pid || !url.trim()) return;
    saving = true;
    error = '';
    try {
      await client.mutation(api.monitors.createUptimeMonitor, {
        projectId: pid as Id<'projects'>,
        name: name.trim() || url,
        url: url.trim(),
        intervalSeconds: Math.max(60, intervalMin * 60),
      });
      name = '';
      url = '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
  async function deleteUptime(id: Id<'uptimeMonitors'>) {
    await client.mutation(api.monitors.deleteUptimeMonitor, { monitorId: id });
  }

  // ok = healthy, error/crashed/timeout = down, in_progress = running.
  function statusColor(status: string): string {
    if (status === 'ok') return 'bg-emerald-500';
    if (status === 'in_progress') return 'bg-sky-500 animate-pulse';
    if (status === 'missed') return 'bg-amber-500';
    if (status === 'error' || status === 'crashed' || status === 'timeout') return 'bg-destructive';
    return 'bg-muted-foreground';
  }
</script>

<svelte:head><title>Monitors · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Monitors</h1>
    <p class="text-sm text-muted-foreground">
      HTTP uptime checks and cron job check-ins. Each row is a monitor.
    </p>
  </div>

  <Card.Root>
    <Card.Header>
      <Card.Title>HTTP uptime checks</Card.Title>
      <Card.Description
        >Sveltry probes each URL on its interval; status shows below.</Card.Description
      >
    </Card.Header>
    <Card.Content class="space-y-4">
      {#if uptime.data && uptime.data.length > 0}
        <div class="space-y-2">
          {#each uptime.data as u (u._id)}
            <div class="flex items-center gap-3 rounded-lg border p-3 text-sm">
              <span class="min-w-0 flex-1">
                <div class="truncate font-medium">{u.slug}</div>
                <div class="truncate font-mono text-xs text-muted-foreground">{u.url}</div>
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">
                every {Math.round(u.intervalSeconds / 60)}m · expects {u.expectedStatus}
                {#if u.lastCheckedAt}· {relativeTime(u.lastCheckedAt)}{/if}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onclick={() => deleteUptime(u._id)}
                aria-label="Delete uptime monitor"
              >
                <TrashIcon class="size-4 text-destructive" />
              </Button>
            </div>
          {/each}
        </div>
      {/if}

      <form class="space-y-3 rounded-lg border border-dashed p-4" onsubmit={addUptime}>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="upname">Name</Label>
            <Input id="upname" bind:value={name} placeholder="API health" />
          </div>
          <div class="space-y-1.5">
            <Label for="upproject">Project</Label>
            <select
              id="upproject"
              bind:value={projectId}
              class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {#each projects.data ?? [] as p (p._id)}
                <option value={p._id}>{p.name}</option>
              {/each}
            </select>
          </div>
          <div class="space-y-1.5 sm:col-span-2">
            <Label for="upurl">URL</Label>
            <Input id="upurl" bind:value={url} placeholder="https://example.com/health" required />
          </div>
          <div class="space-y-1.5">
            <Label for="upinterval">Interval (minutes)</Label>
            <Input id="upinterval" type="number" min="1" bind:value={intervalMin} />
          </div>
        </div>
        {#if error}<p class="text-xs text-destructive">{error}</p>{/if}
        <Button type="submit" size="sm" disabled={saving || !url.trim()}>Add uptime check</Button>
      </form>
    </Card.Content>
  </Card.Root>

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
