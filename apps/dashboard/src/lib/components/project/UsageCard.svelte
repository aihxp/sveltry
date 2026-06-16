<script lang="ts">
  import { useQuery } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';

  let { projectId }: { projectId: Id<'projects'> } = $props();

  let usageWindow = $state(30);
  const usage = useQuery(api.usage.projectUsage, () => ({ projectId, windowDays: usageWindow }));

  // Gap-fill the sparse daily series into a continuous bar series across the window.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const usageSeries = $derived.by(() => {
    const data = usage.data;
    if (!data) return [];
    const byDay = new Map(data.days.map((d) => [d.day, d]));
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const out: {
      day: number;
      events: number;
      transactions: number;
      dropped: number;
      filtered: number;
    }[] = [];
    for (let i = data.windowDays - 1; i >= 0; i--) {
      const day = today - i * DAY_MS;
      const row = byDay.get(day);
      out.push({
        day,
        events: row?.events ?? 0,
        transactions: row?.transactions ?? 0,
        dropped: row?.dropped ?? 0,
        filtered: row?.filtered ?? 0,
      });
    }
    return out;
  });
  const usageMax = $derived(Math.max(1, ...usageSeries.map((d) => d.events)));
  const dayLabel = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
</script>

{#if usage.data}
  <Card.Root>
    <Card.Header class="flex-row items-center justify-between space-y-0">
      <Card.Title>Usage (last {usage.data.windowDays} days)</Card.Title>
      <div class="flex gap-1">
        {#each [7, 30, 90] as w (w)}
          <Button
            variant={usageWindow === w ? 'default' : 'outline'}
            size="sm"
            onclick={() => (usageWindow = w)}>{w}d</Button
          >
        {/each}
      </div>
    </Card.Header>
    <Card.Content>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div class="text-xs uppercase tracking-wide text-muted-foreground">Events</div>
          <div class="text-2xl font-bold tabular-nums">
            {usage.data.totals.events.toLocaleString()}
          </div>
        </div>
        <div>
          <div class="text-xs uppercase tracking-wide text-muted-foreground">Transactions</div>
          <div class="text-2xl font-bold tabular-nums">
            {usage.data.totals.transactions.toLocaleString()}
          </div>
        </div>
        <div>
          <div class="text-xs uppercase tracking-wide text-muted-foreground">Dropped</div>
          <div class="text-2xl font-bold tabular-nums text-muted-foreground">
            {usage.data.totals.dropped.toLocaleString()}
          </div>
        </div>
        <div>
          <div class="text-xs uppercase tracking-wide text-muted-foreground">Filtered</div>
          <div class="text-2xl font-bold tabular-nums text-muted-foreground">
            {usage.data.totals.filtered.toLocaleString()}
          </div>
        </div>
      </div>

      <div class="mt-6">
        <div class="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Events per day</div>
        {#if usageSeries.every((d) => d.events === 0)}
          <p class="py-4 text-sm text-muted-foreground">No events in this window yet.</p>
        {:else}
          <div class="flex h-32 items-end gap-px">
            {#each usageSeries as d (d.day)}
              <div
                class="flex-1"
                title={`${dayLabel(d.day)} · ${d.events.toLocaleString()} events · ${d.transactions.toLocaleString()} txns · ${d.dropped.toLocaleString()} dropped · ${d.filtered.toLocaleString()} filtered`}
              >
                <div
                  class="rounded-t bg-primary/70 transition-colors hover:bg-primary"
                  style={`height:${d.events ? Math.max(2, (d.events / usageMax) * 100) : 0}%`}
                ></div>
              </div>
            {/each}
          </div>
          <div class="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{dayLabel(usageSeries[0].day)}</span>
            <span>up to {usageMax.toLocaleString()} / day</span>
            <span>{dayLabel(usageSeries[usageSeries.length - 1].day)}</span>
          </div>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>
{/if}
