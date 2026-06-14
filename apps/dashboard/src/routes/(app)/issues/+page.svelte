<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import IssueRow from '$lib/components/IssueRow.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn } from '$lib/utils';
  import SearchIcon from '@lucide/svelte/icons/search';

  type Status = 'unresolved' | 'resolved' | 'ignored';
  type Level = '' | 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  let status = $state<Status>('unresolved');
  let term = $state('');
  let level = $state<Level>('');
  const tabs: { value: Status; label: string }[] = [
    { value: 'unresolved', label: 'Unresolved' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'ignored', label: 'Ignored' },
  ];

  const auth = useAuth();
  const searching = $derived(term.trim().length > 0);

  const recent = useQuery(api.issues.recentIssues, () =>
    auth.isAuthenticated && !searching ? { status, limit: 100 } : ('skip' as const),
  );
  const results = useQuery(api.issues.searchIssues, () =>
    auth.isAuthenticated && searching
      ? { query: term, status, level: level || undefined, limit: 100 }
      : ('skip' as const),
  );
  const issues = $derived(searching ? results : recent);
</script>

<svelte:head><title>Issues · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Issues</h1>
    <p class="text-sm text-muted-foreground">Grouped errors across all of your projects.</p>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <div class="relative min-w-0 flex-1">
      <SearchIcon
        class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input bind:value={term} placeholder="Search issues by title…" class="pl-8" />
    </div>
    <select
      bind:value={level}
      class="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="">All levels</option>
      <option value="fatal">Fatal</option>
      <option value="error">Error</option>
      <option value="warning">Warning</option>
      <option value="info">Info</option>
      <option value="debug">Debug</option>
    </select>
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
          {#if searching}
            <EmptyState
              title="No matching issues"
              description={`Nothing matches "${term.trim()}" in ${status} issues.`}
            />
          {:else}
            <EmptyState title={`No ${status} issues`} description="Nothing here right now.">
              <Button href="/projects">Connect a project</Button>
            </EmptyState>
          {/if}
        </div>
      {:else}
        {#each issues.data as issue (issue._id)}<IssueRow {issue} />{/each}
      {/if}
    </Card.Content>
  </Card.Root>
</div>
