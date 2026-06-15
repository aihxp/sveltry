<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';

  const auth = useAuth();
  let windowDays = $state(30);
  const usage = useQuery(api.usage.orgUsage, () =>
    auth.isAuthenticated ? { windowDays } : ('skip' as const),
  );

  const DAY_MS = 24 * 60 * 60 * 1000;
  // Gap-fill the sparse daily series into a continuous bar series across the window.
  const series = $derived.by(() => {
    const data = usage.data;
    if (!data) return [];
    const byDay = new Map(data.days.map((d) => [d.day, d]));
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const out: { day: number; events: number }[] = [];
    for (let i = data.windowDays - 1; i >= 0; i--) {
      const day = today - i * DAY_MS;
      out.push({ day, events: byDay.get(day)?.events ?? 0 });
    }
    return out;
  });
  const maxEvents = $derived(Math.max(1, ...series.map((d) => d.events)));
  const dayLabel = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const num = (n: number) => n.toLocaleString();
</script>

<svelte:head><title>Stats · Sveltry</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Stats</h1>
      <p class="text-sm text-muted-foreground">Organization-wide usage across all projects.</p>
    </div>
    <div class="flex gap-1">
      {#each [7, 30, 90] as w (w)}
        <Button
          variant={windowDays === w ? 'default' : 'outline'}
          size="sm"
          onclick={() => (windowDays = w)}>{w}d</Button
        >
      {/each}
    </div>
  </div>

  {#if auth.isLoading || usage.isLoading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if usage.data}
    <Card.Root>
      <Card.Header>
        <Card.Title>Last {usage.data.windowDays} days</Card.Title>
      </Card.Header>
      <Card.Content>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div class="text-xs uppercase tracking-wide text-muted-foreground">Events</div>
            <div class="text-2xl font-bold tabular-nums">{num(usage.data.totals.events)}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-muted-foreground">Transactions</div>
            <div class="text-2xl font-bold tabular-nums">{num(usage.data.totals.transactions)}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-muted-foreground">Dropped</div>
            <div class="text-2xl font-bold tabular-nums text-muted-foreground">
              {num(usage.data.totals.dropped)}
            </div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-muted-foreground">Filtered</div>
            <div class="text-2xl font-bold tabular-nums text-muted-foreground">
              {num(usage.data.totals.filtered)}
            </div>
          </div>
        </div>

        <div class="mt-6">
          <div class="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Events per day
          </div>
          {#if series.every((d) => d.events === 0)}
            <p class="py-4 text-sm text-muted-foreground">No events in this window yet.</p>
          {:else}
            <div class="flex h-32 items-end gap-px">
              {#each series as d (d.day)}
                <div class="flex-1" title={`${dayLabel(d.day)} · ${num(d.events)} events`}>
                  <div
                    class="rounded-t bg-primary/70 transition-colors hover:bg-primary"
                    style={`height:${d.events ? Math.max(2, (d.events / maxEvents) * 100) : 0}%`}
                  ></div>
                </div>
              {/each}
            </div>
            <div class="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>{dayLabel(series[0].day)}</span>
              <span>up to {num(maxEvents)} / day</span>
              <span>{dayLabel(series[series.length - 1].day)}</span>
            </div>
          {/if}
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header><Card.Title>By project</Card.Title></Card.Header>
      <Card.Content class="px-0">
        {#if usage.data.projects.length > 0}
          <div class="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 gap-y-1 px-6 text-sm">
            <div class="text-xs uppercase tracking-wide text-muted-foreground">Project</div>
            <div class="text-right text-xs uppercase tracking-wide text-muted-foreground">
              Events
            </div>
            <div class="text-right text-xs uppercase tracking-wide text-muted-foreground">Txns</div>
            <div class="text-right text-xs uppercase tracking-wide text-muted-foreground">
              Dropped
            </div>
            <div class="text-right text-xs uppercase tracking-wide text-muted-foreground">
              Filtered
            </div>
            {#each usage.data.projects as p (p.id)}
              <div class="min-w-0 truncate border-t py-1.5">
                {#if p.slug}
                  <a href={`/projects/${p.slug}`} class="hover:text-primary hover:underline"
                    >{p.name}</a
                  >
                {:else}
                  {p.name}
                {/if}
              </div>
              <div class="border-t py-1.5 text-right tabular-nums">{num(p.events)}</div>
              <div class="border-t py-1.5 text-right tabular-nums">{num(p.transactions)}</div>
              <div class="border-t py-1.5 text-right tabular-nums text-muted-foreground">
                {num(p.dropped)}
              </div>
              <div class="border-t py-1.5 text-right tabular-nums text-muted-foreground">
                {num(p.filtered)}
              </div>
            {/each}
          </div>
        {:else}
          <p class="px-6 text-sm text-muted-foreground">No usage recorded yet.</p>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
