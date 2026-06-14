<script lang="ts">
  import { page } from '$app/state';
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { cn, formatDuration, relativeTime } from '$lib/utils';

  const auth = useAuth();
  const traceId = $derived(page.params.traceId);
  const trace = useQuery(api.transactions.getTrace, () =>
    auth.isAuthenticated && traceId ? { traceId } : ('skip' as const),
  );
</script>

<svelte:head><title>Trace · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <a href="/performance" class="text-sm text-muted-foreground hover:text-foreground"
    >&larr; Performance</a
  >

  {#if auth.isLoading || trace.isLoading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if !trace.data}
    <p class="text-sm text-destructive">Trace not found.</p>
  {:else}
    {@const tr = trace.data}
    <div class="space-y-1">
      <h1 class="text-xl font-bold tracking-tight">Distributed trace</h1>
      <p class="text-sm text-muted-foreground">
        {tr.transactions.length} transactions · {formatDuration(tr.durationMs)} · {relativeTime(
          tr.startedAt,
        )}
      </p>
      <p class="font-mono text-xs text-muted-foreground">{tr.traceId}</p>
    </div>

    <Card.Root>
      <Card.Header><Card.Title>Transactions in this trace</Card.Title></Card.Header>
      <Card.Content class="space-y-1.5">
        {#each tr.transactions as t (t._id)}
          {@const total = Math.max(1, tr.durationMs)}
          <a href={`/performance/${t._id}`} class="block rounded p-1 text-sm hover:bg-muted/30">
            <div class="flex items-center gap-3">
              <div class="w-1/3 min-w-0 truncate">
                <Badge variant={t.status === 'ok' ? 'success' : 'muted'} class="mr-1">{t.op}</Badge>
                <span class="text-xs">{t.name}</span>
              </div>
              <div class="relative h-5 flex-1 rounded bg-muted/40">
                <div
                  class={cn(
                    'absolute top-0 h-5 rounded',
                    t.status === 'ok' ? 'bg-primary/70' : 'bg-destructive/70',
                  )}
                  style={`left:${(t.offsetMs / total) * 100}%;width:${Math.max(1, (t.durationMs / total) * 100)}%`}
                ></div>
              </div>
              <span class="w-16 shrink-0 text-right tabular-nums text-muted-foreground"
                >{formatDuration(t.durationMs)}</span
              >
            </div>
          </a>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
