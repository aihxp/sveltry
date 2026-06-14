<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { formatDuration, relativeTime } from '$lib/utils';

  const auth = useAuth();
  const profiles = useQuery(api.profiles.listProfiles, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
</script>

<svelte:head><title>Profiles · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Profiles</h1>
    <p class="text-sm text-muted-foreground">Sampled CPU profiles. Open one for its flamegraph.</p>
  </div>

  <Card.Root>
    <Card.Header><Card.Title>Profiles</Card.Title></Card.Header>
    <Card.Content class="px-0">
      {#if auth.isLoading || profiles.isLoading}
        <div class="space-y-3 px-6">
          {#each Array(4) as _, i (i)}<Skeleton class="h-10 w-full" />{/each}
        </div>
      {:else if profiles.error}
        <p class="px-6 text-sm text-destructive">Failed to load: {profiles.error.toString()}</p>
      {:else if !profiles.data || profiles.data.length === 0}
        <div class="px-6 pb-2">
          <EmptyState
            title="No profiles yet"
            description="Enable the profiling integration in your SDK (profilesSampleRate) to capture CPU profiles."
          />
        </div>
      {:else}
        <div class="divide-y border-t">
          {#each profiles.data as p (p._id)}
            <a
              href={`/profiles/${p._id}`}
              class="flex items-center gap-3 px-6 py-3 text-sm hover:bg-muted/30"
            >
              <span class="min-w-0 flex-1 truncate font-medium">{p.transactionName}</span>
              <span class="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline"
                >{p.platform}</span
              >
              <span class="shrink-0 text-xs text-muted-foreground">{p.sampleCount} samples</span>
              <span class="shrink-0 tabular-nums">{formatDuration(p.durationMs)}</span>
              <span class="w-16 shrink-0 text-right text-xs text-muted-foreground"
                >{relativeTime(p.timestamp)}</span
              >
            </a>
          {/each}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
