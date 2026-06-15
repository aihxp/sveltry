<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { cn, formatDuration } from '$lib/utils';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import SearchIcon from '@lucide/svelte/icons/search';

  const auth = useAuth();
  let typeFilter = $state('');

  const issues = useQuery(api.transactions.performanceIssues, () =>
    auth.isAuthenticated
      ? typeFilter
        ? { type: typeFilter, limit: 100 }
        : { limit: 100 }
      : ('skip' as const),
  );

  // Keyed by string (not the union) so an unexpected/future type falls through to
  // the muted fallback rather than failing to type-check.
  const TYPE_META: Record<
    string,
    { label: string; variant: 'warning' | 'destructive' | 'secondary' | 'muted' }
  > = {
    n_plus_one: { label: 'N+1 Query', variant: 'warning' },
    slow_db: { label: 'Slow DB Query', variant: 'destructive' },
    slow_http: { label: 'Slow HTTP Request', variant: 'secondary' },
  };

  const TYPE_FILTERS = [
    { value: '', label: 'All' },
    { value: 'n_plus_one', label: 'N+1 Query' },
    { value: 'slow_db', label: 'Slow DB Query' },
    { value: 'slow_http', label: 'Slow HTTP Request' },
  ];

  function latencyClass(ms: number): string {
    if (ms >= 1000) return 'text-destructive';
    if (ms >= 300) return 'text-amber-600 dark:text-amber-400';
    return 'text-foreground';
  }
</script>

<svelte:head><title>Performance issues · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <a
        href="/performance"
        class="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon class="size-4" />
        Performance
      </a>
      <h1 class="text-2xl font-bold tracking-tight">Performance issues</h1>
      <p class="text-sm text-muted-foreground">
        Detected performance problems across your projects, grouped by type and ranked by total
        impact time.
        {#if issues.data}
          <span class="text-muted-foreground/70"
            >Over the last {issues.data.sampleSize.toLocaleString()} transactions.</span
          >
        {/if}
      </p>
    </div>
    <Button href="/performance/spans" variant="outline" size="sm" class="shrink-0">
      <SearchIcon class="size-4" />
      Search spans
    </Button>
  </div>

  <div class="flex flex-wrap gap-1">
    {#each TYPE_FILTERS as f (f.value)}
      <Button
        variant={typeFilter === f.value ? 'default' : 'outline'}
        size="sm"
        onclick={() => (typeFilter = f.value)}
      >
        {f.label}
      </Button>
    {/each}
  </div>

  <Card.Root>
    <Card.Content class="px-0">
      {#if auth.isLoading || !auth.isAuthenticated || issues.isLoading}
        <div class="space-y-3 px-6 py-2">
          {#each Array(6) as _, i (i)}<Skeleton class="h-12 w-full" />{/each}
        </div>
      {:else if issues.error}
        <p class="px-6 py-2 text-sm text-destructive">Failed to load: {issues.error.toString()}</p>
      {:else if !issues.data || issues.data.issues.length === 0}
        <div class="px-6 pb-2">
          <EmptyState
            title="No performance issues"
            description="Sveltry surfaces N+1 queries and slow operations once transactions with spans are ingested."
          >
            <Button href="/performance/spans" variant="outline" size="sm">Search spans</Button>
          </EmptyState>
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-y text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th class="px-6 py-2 text-left font-medium">Issue</th>
                <th class="px-3 py-2 text-right font-medium">Occurrences</th>
                <th class="px-3 py-2 text-right font-medium">Transactions</th>
                <th class="px-3 py-2 text-right font-medium">Total time</th>
                <th class="px-6 py-2 text-right font-medium">Sample</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              {#each issues.data.issues as it (it.type + '\n' + it.op + '\n' + it.description)}
                {@const meta = TYPE_META[it.type] ?? { label: it.type, variant: 'muted' as const }}
                <tr class="hover:bg-muted/30">
                  <td class="max-w-[28rem] px-6 py-2">
                    <div class="flex min-w-0 items-center gap-2">
                      <Badge variant={meta.variant} class="shrink-0">{meta.label}</Badge>
                      <Badge variant="muted" class="shrink-0 font-mono">{it.op}</Badge>
                      <span class="min-w-0 truncate text-muted-foreground"
                        >{it.description || '(no description)'}</span
                      >
                    </div>
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums"
                    >{it.occurrences.toLocaleString()}</td
                  >
                  <td class="px-3 py-2 text-right tabular-nums">
                    {it.affectedTransactions.toLocaleString()}
                  </td>
                  <td
                    class={cn(
                      'px-3 py-2 text-right font-medium tabular-nums',
                      latencyClass(it.totalMs),
                    )}
                  >
                    {formatDuration(it.totalMs)}
                  </td>
                  <td class="px-6 py-2 text-right">
                    <a
                      href={`/performance/${it.sample.transactionId}`}
                      class="text-xs text-primary hover:underline"
                      title={it.sample.transactionName}
                    >
                      View
                    </a>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
