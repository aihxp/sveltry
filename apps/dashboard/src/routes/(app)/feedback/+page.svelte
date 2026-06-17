<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import LoadError from '$lib/components/LoadError.svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { relativeTime } from '$lib/utils';

  const auth = useAuth();
  const feedback = useQuery(api.feedback.listFeedback, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
</script>

<svelte:head><title>Feedback · Sveltry</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">User feedback</h1>
    <p class="text-sm text-muted-foreground">
      Messages submitted via the Sentry user-feedback widget or API.
    </p>
  </div>

  {#if auth.isLoading || feedback.isLoading}
    <div class="space-y-3">
      {#each Array(3) as _, i (i)}<Skeleton class="h-20 w-full rounded-xl" />{/each}
    </div>
  {:else if feedback.error}
    <LoadError message="Couldn't load feedback." error={feedback.error} />
  {:else if !feedback.data || feedback.data.length === 0}
    <EmptyState
      title="No feedback yet"
      description="Collect user feedback with Sentry.captureFeedback() or the feedback widget."
    />
  {:else}
    <div class="space-y-3">
      {#each feedback.data as f (f._id)}
        <Card.Root>
          <Card.Content class="space-y-2 p-4">
            <div class="flex items-center justify-between text-sm">
              <span class="font-medium">{f.name || f.email || 'Anonymous'}</span>
              <span class="text-xs text-muted-foreground">{relativeTime(f.createdAt)}</span>
            </div>
            {#if f.email && f.name}
              <div class="text-xs text-muted-foreground">{f.email}</div>
            {/if}
            <p class="whitespace-pre-wrap text-sm">{f.message}</p>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {/if}
</div>
