<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { page } from '$app/state';
  import { replaceState, afterNavigate } from '$app/navigation';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import SearchIcon from '@lucide/svelte/icons/search';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import { cn, formatDuration, relativeTime } from '$lib/utils';

  const auth = useAuth();

  // Seed from ?q= so links from "Slowest operations" (and shared URLs) land pre-searched.
  let inputText = $state(page.url.searchParams.get('q') ?? '');
  // The committed term actually sent to the backend, debounced from the input.
  let term = $state(page.url.searchParams.get('q') ?? '');

  let debounce: ReturnType<typeof setTimeout> | undefined;
  function onInput() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      term = inputText.trim();
      const url = new URL(page.url);
      if (term) url.searchParams.set('q', term);
      else url.searchParams.delete('q');
      replaceState(url, {});
    }, 300);
  }
  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    clearTimeout(debounce);
    term = inputText.trim();
    const url = new URL(page.url);
    if (term) url.searchParams.set('q', term);
    else url.searchParams.delete('q');
    replaceState(url, {});
  }

  // Re-seed from the URL on real navigations (back/forward, or arriving at
  // /performance/spans?q=… while this component is already mounted). afterNavigate
  // does NOT fire for our own shallow replaceState calls, so this never fights the
  // search box or loops.
  afterNavigate(() => {
    const urlQ = page.url.searchParams.get('q') ?? '';
    if (urlQ !== term) {
      term = urlQ;
      inputText = urlQ;
    }
  });

  const results = useQuery(api.transactions.spanSearch, () =>
    auth.isAuthenticated && term.length > 0 ? { query: term, limit: 100 } : ('skip' as const),
  );

  function latencyClass(ms: number): string {
    if (ms >= 1000) return 'text-destructive';
    if (ms >= 300) return 'text-amber-600 dark:text-amber-400';
    return 'text-foreground';
  }
</script>

<svelte:head><title>Span search · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div>
    <a
      href="/performance"
      class="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon class="size-4" />
      Performance
    </a>
    <h1 class="text-2xl font-bold tracking-tight">Span search</h1>
    <p class="text-sm text-muted-foreground">
      Find individual spans across recent transactions by operation or description.
    </p>
  </div>

  <form onsubmit={onSubmit}>
    <div class="relative">
      <SearchIcon
        class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        bind:value={inputText}
        oninput={onInput}
        placeholder="db.query, SELECT users, http.client …"
        class="pl-9"
        autofocus
      />
    </div>
  </form>

  <Card.Root>
    <Card.Header>
      <Card.Title>Matching spans</Card.Title>
      <Card.Description>
        {#if results.data}
          {results.data.total.toLocaleString()}
          match{results.data.total === 1 ? '' : 'es'} across the last
          {results.data.sampleSize.toLocaleString()} transactions{results.data.total >
          results.data.matches.length
            ? `, showing the ${results.data.matches.length} slowest`
            : ''}.
        {:else}
          Spans whose operation or description contains your search, ranked by duration.
        {/if}
      </Card.Description>
    </Card.Header>
    <Card.Content class="px-0">
      {#if term.length === 0}
        <div class="px-6 pb-2">
          <EmptyState
            title="Search for an operation"
            description="Type a span operation (db.query, http.client) or part of a description (a SQL fragment, a URL) to find which transactions run it."
          />
        </div>
      {:else if auth.isLoading || results.isLoading}
        <div class="space-y-3 px-6">
          {#each Array(5) as _, i (i)}<Skeleton class="h-9 w-full" />{/each}
        </div>
      {:else if results.error}
        <p class="px-6 text-sm text-destructive">Failed to load: {results.error.toString()}</p>
      {:else if !results.data || results.data.matches.length === 0}
        <p class="px-6 text-sm text-muted-foreground">
          No spans match "{term}" in the recent window.
        </p>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-y text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th class="px-6 py-2 text-left font-medium">Span</th>
                <th class="px-3 py-2 text-left font-medium">Transaction</th>
                <th class="px-3 py-2 text-right font-medium">Duration</th>
                <th class="px-6 py-2 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              {#each results.data.matches as m, i (m.transactionId + '\n' + m.op + '\n' + m.description + '\n' + i)}
                <tr class="hover:bg-muted/30">
                  <td class="max-w-[24rem] px-6 py-2">
                    <div class="flex items-center gap-2">
                      <Badge variant="muted" class="shrink-0 font-mono">{m.op}</Badge>
                      <span class="min-w-0 truncate text-muted-foreground"
                        >{m.description || '(no description)'}</span
                      >
                    </div>
                  </td>
                  <td class="max-w-[16rem] px-3 py-2">
                    <a
                      href={`/performance/${m.transactionId}`}
                      class="block truncate font-medium hover:underline"
                      title={m.transactionName}>{m.transactionName}</a
                    >
                  </td>
                  <td
                    class={cn(
                      'px-3 py-2 text-right font-medium tabular-nums',
                      latencyClass(m.spanDurationMs),
                    )}
                  >
                    {formatDuration(m.spanDurationMs)}
                  </td>
                  <td class="px-6 py-2 text-right text-xs tabular-nums text-muted-foreground">
                    {relativeTime(m.timestamp)}
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
