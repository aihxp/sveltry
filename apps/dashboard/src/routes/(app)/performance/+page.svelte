<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn, formatDuration, relativeTime } from '$lib/utils';

  const auth = useAuth();
  const stats = useQuery(api.transactions.transactionStats, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
  const recent = useQuery(api.transactions.recentTransactions, () =>
    auth.isAuthenticated ? { limit: 25 } : ('skip' as const),
  );
  const trend = useQuery(api.transactions.transactionTrend, () =>
    auth.isAuthenticated ? { hours: 24 } : ('skip' as const),
  );
  const vitals = useQuery(api.transactions.webVitals, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
  const maxP95 = $derived(Math.max(1, ...(trend.data ?? []).map((d) => d.p95Ms)));

  // Cross-transaction "slowest operations", with an optional op-category filter.
  let opCategory = $state('');
  const spanOps = useQuery(api.transactions.spanOperations, () =>
    auth.isAuthenticated ? { category: opCategory || undefined, limit: 25 } : ('skip' as const),
  );

  // Web Vitals thresholds (good / needs-improvement / poor) per Google.
  const VITAL_META: Record<string, { label: string; unit: string; good: number; poor: number }> = {
    lcp: { label: 'LCP', unit: 'ms', good: 2500, poor: 4000 },
    inp: { label: 'INP', unit: 'ms', good: 200, poor: 500 },
    fid: { label: 'FID', unit: 'ms', good: 100, poor: 300 },
    cls: { label: 'CLS', unit: '', good: 0.1, poor: 0.25 },
    fcp: { label: 'FCP', unit: 'ms', good: 1800, poor: 3000 },
    ttfb: { label: 'TTFB', unit: 'ms', good: 800, poor: 1800 },
  };
  function vitalClass(vital: string, value: number): string {
    const m = VITAL_META[vital];
    if (!m) return 'text-foreground';
    if (value <= m.good) return 'text-emerald-600 dark:text-emerald-400';
    if (value <= m.poor) return 'text-amber-600 dark:text-amber-400';
    return 'text-destructive';
  }

  // Color a p95 cell by latency band for an at-a-glance read.
  function latencyClass(ms: number): string {
    if (ms >= 1000) return 'text-destructive';
    if (ms >= 300) return 'text-amber-600 dark:text-amber-400';
    return 'text-foreground';
  }
  function barColor(ms: number): string {
    if (ms >= 1000) return 'bg-destructive';
    if (ms >= 300) return 'bg-amber-500';
    return 'bg-primary';
  }
  function hourLabel(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<svelte:head><title>Performance · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Performance</h1>
    <p class="text-sm text-muted-foreground">
      Transaction latency across your projects.
      {#if stats.data}
        <span class="text-muted-foreground/70"
          >Percentiles over the last {stats.data.sampleSize.toLocaleString()} transactions.</span
        >
      {/if}
    </p>
  </div>

  {#if vitals.data && vitals.data.length > 0}
    <Card.Root>
      <Card.Header><Card.Title>Web Vitals (p75)</Card.Title></Card.Header>
      <Card.Content>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {#each vitals.data as v (v.vital)}
            {@const meta = VITAL_META[v.vital]}
            <div>
              <div class="text-xs uppercase tracking-wide text-muted-foreground">
                {meta?.label ?? v.vital}
              </div>
              <div class={cn('text-lg font-semibold tabular-nums', vitalClass(v.vital, v.p75))}>
                {v.vital === 'cls' ? (v.p75 / 1).toFixed(0) : v.p75}{meta?.unit ?? ''}
              </div>
              <div class="text-[10px] text-muted-foreground">{v.count} samples</div>
            </div>
          {/each}
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  <Card.Root>
    <Card.Header><Card.Title>Latency over time (24h, p95)</Card.Title></Card.Header>
    <Card.Content>
      {#if auth.isLoading || trend.isLoading}
        <Skeleton class="h-32 w-full" />
      {:else if !trend.data || trend.data.length === 0}
        <p class="text-sm text-muted-foreground">
          No latency history yet. Hourly rollups populate this chart over time.
        </p>
      {:else}
        <div class="flex h-32 items-end gap-0.5">
          {#each trend.data as pt (pt.bucketStart)}
            <div
              class="flex-1"
              title={`${hourLabel(pt.bucketStart)} · p95 ${formatDuration(pt.p95Ms)} · p50 ${formatDuration(pt.p50Ms)} · ${pt.count} txns`}
            >
              <div
                class={cn('rounded-t', barColor(pt.p95Ms))}
                style={`height:${Math.max(2, (pt.p95Ms / maxP95) * 100)}%`}
              ></div>
            </div>
          {/each}
        </div>
        <div class="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{hourLabel(trend.data[0]!.bucketStart)}</span>
          <span>p95 up to {formatDuration(maxP95)}</span>
          <span>{hourLabel(trend.data[trend.data.length - 1]!.bucketStart)}</span>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Slowest operations</Card.Title>
      <Card.Description>
        Spans across recent transactions, grouped by operation and ranked by total time spent.
      </Card.Description>
    </Card.Header>
    <Card.Content class="space-y-4">
      {#if spanOps.data && (spanOps.data.categories.length > 0 || spanOps.data.rows.length > 0)}
        {#if spanOps.data.categories.length > 0}
          <div class="flex flex-wrap gap-1">
            <Button
              variant={opCategory === '' ? 'default' : 'outline'}
              size="sm"
              onclick={() => (opCategory = '')}>All</Button
            >
            {#each spanOps.data.categories as c (c)}
              <Button
                variant={opCategory === c ? 'default' : 'outline'}
                size="sm"
                onclick={() => (opCategory = c)}>{c}</Button
              >
            {/each}
          </div>
        {/if}
        {#if spanOps.data.rows.length > 0}
          <div
            class="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 gap-y-1 text-sm"
          >
            <div class="text-xs uppercase tracking-wide text-muted-foreground">Operation</div>
            <div class="text-right text-xs uppercase tracking-wide text-muted-foreground">
              Count
            </div>
            <div class="text-right text-xs uppercase tracking-wide text-muted-foreground">Avg</div>
            <div class="text-right text-xs uppercase tracking-wide text-muted-foreground">p95</div>
            <div class="text-right text-xs uppercase tracking-wide text-muted-foreground">
              Total
            </div>
            {#each spanOps.data.rows as r (r.op + '\n' + r.description)}
              <div class="flex min-w-0 items-center gap-2 border-t py-1.5">
                <Badge variant="muted" class="shrink-0 font-mono">{r.op}</Badge>
                <span class="min-w-0 truncate text-muted-foreground"
                  >{r.description || '(no description)'}</span
                >
              </div>
              <div class="border-t py-1.5 text-right tabular-nums">{r.count.toLocaleString()}</div>
              <div class="border-t py-1.5 text-right tabular-nums">{formatDuration(r.avgMs)}</div>
              <div class={cn('border-t py-1.5 text-right tabular-nums', latencyClass(r.p95Ms))}>
                {formatDuration(r.p95Ms)}
              </div>
              <div class="border-t py-1.5 text-right font-medium tabular-nums">
                {formatDuration(r.totalMs)}
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">No operations in this category.</p>
        {/if}
      {:else}
        <p class="text-sm text-muted-foreground">
          No spans yet. Operations appear once transactions with spans are ingested.
        </p>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header><Card.Title>Transactions</Card.Title></Card.Header>
    <Card.Content class="px-0">
      {#if auth.isLoading || stats.isLoading}
        <div class="space-y-3 px-6">
          {#each Array(5) as _, i (i)}<Skeleton class="h-9 w-full" />{/each}
        </div>
      {:else if stats.error}
        <p class="px-6 text-sm text-destructive">Failed to load: {stats.error.toString()}</p>
      {:else if !stats.data || stats.data.rows.length === 0}
        <div class="px-6 pb-2">
          <EmptyState
            title="No transactions yet"
            description="Enable tracing in your SDK (set a non-zero tracesSampleRate) to see latency here."
          />
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-y text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th class="px-6 py-2 text-left font-medium">Transaction</th>
                <th class="px-3 py-2 text-right font-medium">Count</th>
                <th class="px-3 py-2 text-right font-medium">p50</th>
                <th class="px-3 py-2 text-right font-medium">p95</th>
                <th class="px-3 py-2 text-right font-medium">Max</th>
                <th class="px-6 py-2 text-right font-medium">Fail %</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              {#each stats.data.rows as row (row.name)}
                <tr class="hover:bg-muted/30">
                  <td class="max-w-[20rem] px-6 py-2">
                    <div class="truncate font-medium">{row.name}</div>
                    <div class="font-mono text-xs text-muted-foreground">{row.op}</div>
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">{row.count}</td>
                  <td class="px-3 py-2 text-right tabular-nums">{formatDuration(row.p50Ms)}</td>
                  <td
                    class={cn(
                      'px-3 py-2 text-right font-medium tabular-nums',
                      latencyClass(row.p95Ms),
                    )}
                  >
                    {formatDuration(row.p95Ms)}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatDuration(row.maxMs)}
                  </td>
                  <td
                    class={cn(
                      'px-6 py-2 text-right tabular-nums',
                      row.failureRate > 0 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {(row.failureRate * 100).toFixed(1)}%
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header><Card.Title>Recent transactions</Card.Title></Card.Header>
    <Card.Content class="px-0">
      {#if auth.isLoading || recent.isLoading}
        <div class="space-y-3 px-6">
          {#each Array(4) as _, i (i)}<Skeleton class="h-10 w-full" />{/each}
        </div>
      {:else if !recent.data || recent.data.length === 0}
        <p class="px-6 text-sm text-muted-foreground">No transactions recorded.</p>
      {:else}
        <div class="divide-y border-t">
          {#each recent.data as t (t._id)}
            <a
              href={`/performance/${t._id}`}
              class="flex items-center gap-3 px-6 py-2.5 text-sm hover:bg-muted/30"
            >
              <Badge variant={t.status === 'ok' ? 'success' : 'muted'} class="shrink-0"
                >{t.status}</Badge
              >
              <span class="min-w-0 flex-1 truncate font-medium">{t.name}</span>
              <span class="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline"
                >{t.op}</span
              >
              <span class="shrink-0 tabular-nums">{formatDuration(t.durationMs)}</span>
              <span class="hidden w-16 shrink-0 text-right text-xs text-muted-foreground md:inline"
                >{relativeTime(t.timestamp)}</span
              >
            </a>
          {/each}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
