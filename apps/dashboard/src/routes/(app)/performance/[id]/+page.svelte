<script lang="ts">
  import { page } from '$app/state';
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { cn, formatDuration, relativeTime } from '$lib/utils';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

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
    parent_span_id?: string;
    op?: string;
    description?: string;
    status?: string;
    start_timestamp?: number;
    timestamp?: number;
  };

  const opCategory = (op: string) => op.split('.')[0] || 'other';

  /**
   * Where the transaction's time goes, by operation category. Each span's
   * self-time (its duration minus the time covered by its direct children) is
   * summed per category; the remainder not covered by any span is the
   * transaction's own work. Self-times partition the duration, so the percentages
   * sum to ~100%.
   */
  const insights = $derived.by(() => {
    const t = txn.data;
    if (!t) return null;
    const spans = ((t.payload?.spans ?? []) as Span[])
      .map((s) => ({
        id: s.span_id,
        parent: s.parent_span_id,
        op: s.op ?? 'other',
        desc: s.description ?? '',
        start: toMs(s.start_timestamp),
        end: toMs(s.timestamp),
      }))
      .filter((s) => s.start != null && s.end != null) as {
      id?: string;
      parent?: string;
      op: string;
      desc: string;
      start: number;
      end: number;
    }[];

    const childrenOf = new Map<string, typeof spans>();
    for (const s of spans) {
      if (!s.parent) continue;
      const a = childrenOf.get(s.parent) ?? [];
      a.push(s);
      childrenOf.set(s.parent, a);
    }

    const total = Math.max(1, t.durationMs);
    const selfByCat = new Map<string, number>();
    let coveredBySpans = 0;
    for (const s of spans) {
      const dur = Math.max(0, s.end - s.start);
      let childCovered = 0;
      for (const k of s.id ? (childrenOf.get(s.id) ?? []) : []) {
        childCovered += Math.max(0, Math.min(k.end, s.end) - Math.max(k.start, s.start));
      }
      const self = Math.max(0, dur - childCovered);
      const cat = opCategory(s.op);
      selfByCat.set(cat, (selfByCat.get(cat) ?? 0) + self);
      coveredBySpans += self;
    }
    // Time the transaction spent outside any span is its own work.
    const remainder = Math.max(0, total - coveredBySpans);
    if (remainder > 0) {
      const cat = opCategory(t.op);
      selfByCat.set(cat, (selfByCat.get(cat) ?? 0) + remainder);
    }

    const breakdown = [...selfByCat.entries()]
      .map(([category, selfMs]) => ({ category, selfMs, pct: (selfMs / total) * 100 }))
      .filter((b) => b.selfMs > 0)
      .sort((a, b) => b.selfMs - a.selfMs);

    const slowest = spans
      .map((s) => ({ op: s.op, desc: s.desc, durationMs: Math.max(0, s.end - s.start) }))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 6);

    return { breakdown, slowest };
  });

  // Potential N+1: the same db / cache operation repeated many times in one
  // transaction (the classic "query in a loop"). High-signal and self-contained.
  const N1_THRESHOLD = 4;
  const N1_CATEGORIES = new Set(['db', 'cache']);
  const nPlusOne = $derived.by(() => {
    const t = txn.data;
    if (!t) return [];
    const spans = (t.payload?.spans ?? []) as Span[];
    const groups = new Map<
      string,
      { op: string; description: string; count: number; totalMs: number }
    >();
    for (const s of spans) {
      const op = s.op ?? '';
      if (!N1_CATEGORIES.has(opCategory(op))) continue;
      const description = s.description ?? '';
      const start = toMs(s.start_timestamp);
      const end = toMs(s.timestamp);
      const dur = start != null && end != null ? Math.max(0, end - start) : 0;
      const key = `${op}\n${description}`;
      const g = groups.get(key) ?? { op, description, count: 0, totalMs: 0 };
      g.count += 1;
      g.totalMs += dur;
      groups.set(key, g);
    }
    return [...groups.values()]
      .filter((g) => g.count >= N1_THRESHOLD)
      .sort((a, b) => b.count - a.count);
  });

  // A stable color per op category for the breakdown bar.
  const CAT_COLOR: Record<string, string> = {
    db: 'bg-sky-500',
    http: 'bg-violet-500',
    cache: 'bg-amber-500',
    ui: 'bg-emerald-500',
    browser: 'bg-emerald-500',
    resource: 'bg-rose-500',
    function: 'bg-teal-500',
    rpc: 'bg-indigo-500',
    serialize: 'bg-orange-500',
  };
  const catColor = (c: string) => CAT_COLOR[c] ?? 'bg-primary/60';

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
      {#if t.traceId}
        <a
          href={`/performance/trace/${t.traceId}`}
          class="text-sm font-medium text-primary hover:underline">View full trace</a
        >
      {/if}
    </div>

    {#if nPlusOne.length > 0}
      <div class="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <div
          class="flex items-center gap-2 text-sm font-semibold text-amber-600 dark:text-amber-400"
        >
          <TriangleAlertIcon class="size-4" />
          Potential N+1
        </div>
        <p class="text-xs text-muted-foreground">
          The same operation repeats many times in this transaction, which often means a query in a
          loop. Consider batching or eager-loading.
        </p>
        <div class="space-y-1.5">
          {#each nPlusOne as g (g.op + '\n' + g.description)}
            <div class="flex items-center gap-2 text-sm">
              <Badge variant="muted" class="shrink-0 font-mono">{g.op}</Badge>
              <span class="min-w-0 flex-1 truncate">{g.description || '(no description)'}</span>
              <span class="shrink-0 font-medium tabular-nums">{g.count}&times;</span>
              <span class="w-16 shrink-0 text-right tabular-nums text-muted-foreground"
                >{formatDuration(g.totalMs)}</span
              >
            </div>
          {/each}
        </div>
      </div>
    {/if}

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

    {#if insights && insights.breakdown.length > 0}
      <div class="grid gap-4 lg:grid-cols-2">
        <Card.Root>
          <Card.Header>
            <Card.Title>Operations</Card.Title>
            <Card.Description>Where this transaction's time goes (span self-time).</Card.Description
            >
          </Card.Header>
          <Card.Content class="space-y-3">
            <div class="flex h-2.5 w-full overflow-hidden rounded-full">
              {#each insights.breakdown as b (b.category)}
                <div
                  class={cn('h-full', catColor(b.category))}
                  style={`width:${b.pct}%`}
                  title={`${b.category} · ${formatDuration(b.selfMs)} (${Math.round(b.pct)}%)`}
                ></div>
              {/each}
            </div>
            <div class="space-y-1.5">
              {#each insights.breakdown as b (b.category)}
                <div class="flex items-center gap-2 text-sm">
                  <span class={cn('size-2.5 shrink-0 rounded-sm', catColor(b.category))}></span>
                  <span class="min-w-0 flex-1 truncate font-mono text-xs">{b.category}</span>
                  <span class="shrink-0 tabular-nums text-muted-foreground"
                    >{formatDuration(b.selfMs)}</span
                  >
                  <span class="w-10 shrink-0 text-right tabular-nums text-muted-foreground"
                    >{Math.round(b.pct)}%</span
                  >
                </div>
              {/each}
            </div>
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title>Slowest spans</Card.Title>
            <Card.Description
              >The longest individual operations in this transaction.</Card.Description
            >
          </Card.Header>
          <Card.Content class="space-y-2">
            {#each insights.slowest as s, i (i)}
              <div class="flex items-center gap-3 text-sm">
                <span class="shrink-0 font-mono text-xs text-muted-foreground">{s.op}</span>
                {#if s.desc}
                  <span class="min-w-0 flex-1 truncate">{s.desc}</span>
                {:else}
                  <span class="flex-1"></span>
                {/if}
                <span class="shrink-0 tabular-nums">{formatDuration(s.durationMs)}</span>
              </div>
            {/each}
          </Card.Content>
        </Card.Root>
      </div>
    {/if}

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
