<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import LoadError from '$lib/components/LoadError.svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { formatDuration, relativeTime } from '$lib/utils';

  const auth = useAuth();
  const replays = useQuery(api.replays.listReplays, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
</script>

<svelte:head><title>Replays · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Replays</h1>
    <p class="text-sm text-muted-foreground">
      Session recordings captured by the Sentry replay SDK.
    </p>
  </div>

  <Card.Root>
    <Card.Header><Card.Title>Recordings</Card.Title></Card.Header>
    <Card.Content class="px-0">
      {#if auth.isLoading || replays.isLoading}
        <div class="space-y-3 px-6">
          {#each Array(4) as _, i (i)}<Skeleton class="h-12 w-full" />{/each}
        </div>
      {:else if replays.error}
        <LoadError message="Couldn't load replays." error={replays.error} class="mx-6" />
      {:else if !replays.data || replays.data.length === 0}
        <div class="px-6 pb-2">
          <EmptyState
            title="No replays yet"
            description="Enable Session Replay in your browser SDK (replaysSessionSampleRate) to capture recordings."
          />
        </div>
      {:else}
        <div class="divide-y border-t">
          {#each replays.data as r (r._id)}
            <a
              href={`/replays/${r._id}`}
              class="flex items-center gap-3 px-6 py-3 text-sm hover:bg-muted/30"
            >
              <span class="min-w-0 flex-1">
                <div class="truncate font-medium">{r.url ?? 'Session replay'}</div>
                <div class="font-mono text-xs text-muted-foreground">{r.replayId.slice(0, 16)}</div>
              </span>
              {#if r.errorCount > 0}
                <Badge variant="muted" class="shrink-0 text-destructive"
                  >{r.errorCount} errors</Badge
                >
              {/if}
              <span class="hidden shrink-0 text-xs text-muted-foreground sm:inline"
                >{r.segmentCount} seg</span
              >
              <span class="shrink-0 tabular-nums">{formatDuration(r.durationMs)}</span>
              <span class="w-16 shrink-0 text-right text-xs text-muted-foreground"
                >{relativeTime(r.startedAt)}</span
              >
            </a>
          {/each}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
