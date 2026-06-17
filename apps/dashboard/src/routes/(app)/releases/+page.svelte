<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import LoadError from '$lib/components/LoadError.svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn, relativeTime } from '$lib/utils';

  const auth = useAuth();
  const health = useQuery(api.sessions.releaseHealth, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

  function pct(rate: number): string {
    return `${(rate * 100).toFixed(2)}%`;
  }
  // Crash-free rate color: green healthy, amber watch, red regressed.
  function rateClass(rate: number): string {
    if (rate >= 0.99) return 'text-emerald-600 dark:text-emerald-400';
    if (rate >= 0.95) return 'text-amber-600 dark:text-amber-400';
    return 'text-destructive';
  }
</script>

<svelte:head><title>Releases · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Releases</h1>
    <p class="text-sm text-muted-foreground">
      Crash-free sessions and users per release.
      {#if health.data}
        <span class="text-muted-foreground/70"
          >Over the last {health.data.sampleSize.toLocaleString()} sessions.</span
        >
      {/if}
    </p>
  </div>

  <Card.Root>
    <Card.Header><Card.Title>Release health</Card.Title></Card.Header>
    <Card.Content class="px-0">
      {#if auth.isLoading || health.isLoading}
        <div class="space-y-3 px-6">
          {#each Array(4) as _, i (i)}<Skeleton class="h-9 w-full" />{/each}
        </div>
      {:else if health.error}
        <LoadError message="Couldn't load release health." error={health.error} class="mx-6" />
      {:else if !health.data || health.data.rows.length === 0}
        <div class="px-6 pb-2">
          <EmptyState
            title="No session data yet"
            description="Enable release health in your SDK (session tracking) and set a release to see crash-free rates."
          />
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-y text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th class="px-6 py-2 text-left font-medium">Release</th>
                <th class="px-3 py-2 text-right font-medium">Sessions</th>
                <th class="px-3 py-2 text-right font-medium">Users</th>
                <th class="px-3 py-2 text-right font-medium">Crash-free sessions</th>
                <th class="px-3 py-2 text-right font-medium">Crash-free users</th>
                <th class="px-6 py-2 text-right font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              {#each health.data.rows as row (row.release)}
                <tr class="hover:bg-muted/30">
                  <td class="max-w-[16rem] px-6 py-2">
                    <div class="truncate font-mono font-medium">{row.release}</div>
                    {#if row.crashed > 0 || row.abnormal > 0}
                      <div class="text-xs text-destructive">
                        {row.crashed} crashed{row.abnormal ? `, ${row.abnormal} abnormal` : ''}
                      </div>
                    {/if}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">{row.sessions}</td>
                  <td class="px-3 py-2 text-right tabular-nums">{row.users}</td>
                  <td
                    class={cn(
                      'px-3 py-2 text-right font-medium tabular-nums',
                      rateClass(row.crashFreeSessions),
                    )}
                  >
                    {pct(row.crashFreeSessions)}
                  </td>
                  <td
                    class={cn(
                      'px-3 py-2 text-right font-medium tabular-nums',
                      rateClass(row.crashFreeUsers),
                    )}
                  >
                    {pct(row.crashFreeUsers)}
                  </td>
                  <td class="px-6 py-2 text-right text-xs text-muted-foreground"
                    >{relativeTime(row.lastSeen)}</td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
