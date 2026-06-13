<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import IssueRow from '$lib/components/IssueRow.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn } from '$lib/utils';

  type Status = 'unresolved' | 'resolved' | 'ignored';
  let status = $state<Status>('unresolved');
  const tabs: { value: Status; label: string }[] = [
    { value: 'unresolved', label: 'Unresolved' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'ignored', label: 'Ignored' },
  ];

  const auth = useAuth();
  const issues = useQuery(api.issues.recentIssues, () =>
    auth.isAuthenticated ? { status, limit: 100 } : ('skip' as const),
  );
</script>

<svelte:head><title>Issues · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Issues</h1>
    <p class="text-sm text-muted-foreground">Grouped errors across all of your projects.</p>
  </div>

  <div class="flex gap-1 rounded-lg border bg-card p-1">
    {#each tabs as tab (tab.value)}
      <button
        onclick={() => (status = tab.value)}
        class={cn(
          'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          status === tab.value
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <Card.Root>
    <Card.Content class="px-0 py-0">
      {#if auth.isLoading || issues.isLoading}
        <div class="space-y-3 p-4">
          {#each Array(6) as _, i (i)}<Skeleton class="h-12 w-full" />{/each}
        </div>
      {:else if issues.error}
        <p class="p-4 text-sm text-destructive">Failed to load: {issues.error.toString()}</p>
      {:else if !issues.data || issues.data.length === 0}
        <div class="p-6">
          <EmptyState title={`No ${status} issues`} description="Nothing here right now.">
            <Button href="/projects">Connect a project</Button>
          </EmptyState>
        </div>
      {:else}
        {#each issues.data as issue (issue._id)}<IssueRow {issue} />{/each}
      {/if}
    </Card.Content>
  </Card.Root>
</div>
