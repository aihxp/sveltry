<script lang="ts">
  import { page } from '$app/state';
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { cn, formatDuration, relativeTime } from '$lib/utils';

  const auth = useAuth();
  const transactionId = $derived(page.params.id as Id<'transactions'>);
  const txn = useQuery(api.transactions.getTransaction, () =>
    auth.isAuthenticated ? { transactionId } : ('skip' as const),
  );

  /** Sentry timestamps are unix seconds (floats); normalize to ms. */
  function toMs(ts: unknown): number | null {
    if (typeof ts !== 'number') return null;
    return ts > 1e12 ? ts : ts * 1000;
  }

  type Span = {
    span_id?: string;
    op?: string;
    description?: string;
    status?: string;
    start_timestamp?: number;
    timestamp?: number;
  };

  type WaterfallRow = {
    label: string;
    detail: string;
    durationMs: number;
    offsetPct: number;
    widthPct: number;
    isRoot: boolean;
  };

  const rows = $derived.by<WaterfallRow[]>(() => {
    const t = txn.data;
    if (!t) return [];
    const txStart = t.timestamp;
    const total = Math.max(1, t.durationMs);
    const out: WaterfallRow[] = [
      {
        label: t.op,
        detail: t.name,
        durationMs: t.durationMs,
        offsetPct: 0,
        widthPct: 100,
        isRoot: true,
      },
    ];
    const spans = (t.payload?.spans ?? []) as Span[];
    const withTimes = spans
      .map((s) => ({ s, start: toMs(s.start_timestamp), end: toMs(s.timestamp) }))
      .filter((x) => x.start != null && x.end != null) as {
      s: Span;
      start: number;
      end: number;
    }[];
    withTimes.sort((a, b) => a.start - b.start);
    for (const { s, start, end } of withTimes) {
      const offsetPct = Math.min(100, Math.max(0, ((start - txStart) / total) * 100));
      const widthPct = Math.min(100 - offsetPct, Math.max(0.5, ((end - start) / total) * 100));
      out.push({
        label: s.op ?? 'span',
        detail: s.description ?? '',
        durationMs: end - start,
        offsetPct,
        widthPct,
        isRoot: false,
      });
    }
    return out;
  });
</script>

<svelte:head><title>{txn.data?.name ?? 'Transaction'} · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <a href="/performance" class="text-sm text-muted-foreground hover:text-foreground"
    >&larr; Performance</a
  >

  {#if auth.isLoading || txn.isLoading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if !txn.data}
    <p class="text-sm text-destructive">Transaction not found.</p>
  {:else}
    {@const t = txn.data}
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <Badge variant={t.status === 'ok' ? 'success' : 'muted'}>{t.status}</Badge>
        <span class="font-mono text-xs text-muted-foreground">{t.op}</span>
      </div>
      <h1 class="break-all text-xl font-bold tracking-tight">{t.name}</h1>
      <p class="text-sm text-muted-foreground">
        {formatDuration(t.durationMs)} · {t.spanCount} spans · {relativeTime(t.timestamp)}
      </p>
    </div>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {#each [{ label: 'Duration', value: formatDuration(t.durationMs) }, { label: 'Spans', value: String(t.spanCount) }, { label: 'Environment', value: t.environment }, { label: 'Release', value: t.release ?? 'none' }] as m (m.label)}
        <Card.Root>
          <Card.Content class="p-4">
            <div class="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</div>
            <div class="mt-1 truncate text-sm font-semibold">{m.value}</div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>

    <Card.Root>
      <Card.Header><Card.Title>Trace</Card.Title></Card.Header>
      <Card.Content class="space-y-1">
        {#each rows as row, i (i)}
          <div class="flex items-center gap-3 text-sm">
            <div class="w-1/3 min-w-0 truncate">
              <span class={cn('font-mono text-xs', row.isRoot ? 'font-semibold' : '')}
                >{row.label}</span
              >
              {#if row.detail}<span class="ml-1 truncate text-muted-foreground">{row.detail}</span
                >{/if}
            </div>
            <div class="relative h-5 flex-1 rounded bg-muted/40">
              <div
                class={cn(
                  'absolute top-0 flex h-5 items-center rounded px-1.5 text-[10px] font-medium text-primary-foreground',
                  row.isRoot ? 'bg-primary' : 'bg-primary/70',
                )}
                style={`left:${row.offsetPct}%;width:${row.widthPct}%;min-width:2px`}
              ></div>
            </div>
            <span class="w-16 shrink-0 text-right tabular-nums text-muted-foreground"
              >{formatDuration(row.durationMs)}</span
            >
          </div>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
