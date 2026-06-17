<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import IssueRow from '$lib/components/IssueRow.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';

  const auth = useAuth();
  const skip = () => (auth.isAuthenticated ? {} : ('skip' as const));
  const stats = useQuery(api.issues.issueStats, skip);
  const recent = useQuery(api.issues.recentIssues, () =>
    auth.isAuthenticated ? { limit: 12 } : ('skip' as const),
  );
  // Distinguish "no issues because all is well" from "no issues because there are
  // no projects yet" so a brand-new org gets a get-started nudge, not a false
  // "everything is running smoothly".
  const projects = useQuery(api.projects.listProjects, skip);
  const hasProjects = $derived((projects.data?.length ?? 0) > 0);

  const cards = $derived([
    { label: 'Unresolved', value: stats.data?.unresolved ?? 0, accent: true },
    { label: 'Resolved', value: stats.data?.resolved ?? 0 },
    { label: 'Ignored', value: stats.data?.ignored ?? 0 },
  ]);
</script>

<svelte:head><title>Overview · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Overview</h1>
      <p class="text-sm text-muted-foreground">A live look at what's breaking.</p>
    </div>
    <Button href="/issues">View all issues</Button>
  </div>

  <div class="grid grid-cols-3 gap-4">
    {#each cards as c (c.label)}
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Description>{c.label}</Card.Description>
        </Card.Header>
        <Card.Content>
          {#if auth.isLoading || stats.isLoading}
            <Skeleton class="h-9 w-16" />
          {:else}
            <div class="text-3xl font-bold tabular-nums {c.accent ? 'text-primary' : ''}">
              {c.value}
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    {/each}
  </div>

  <Card.Root>
    <Card.Header class="flex-row items-center justify-between space-y-0">
      <Card.Title>Live issue stream</Card.Title>
      <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span class="size-2 animate-pulse rounded-full bg-primary"></span> live
      </span>
    </Card.Header>
    <Card.Content class="px-0">
      {#if auth.isLoading || recent.isLoading}
        <div class="space-y-3 px-4">
          {#each Array(4) as _, i (i)}<Skeleton class="h-12 w-full" />{/each}
        </div>
      {:else if recent.error}
        <p class="px-4 text-sm text-destructive">Failed to load: {recent.error.toString()}</p>
      {:else if !recent.data || recent.data.length === 0}
        <div class="px-6 py-4">
          {#if !hasProjects}
            <EmptyState
              title="Create your first project"
              description="You haven't connected any projects yet. Create one to get a DSN and start receiving events."
            >
              <Button href="/projects/new">New project</Button>
            </EmptyState>
          {:else}
            <EmptyState title="No unresolved issues" description="Everything is running smoothly.">
              <Button href="/projects">View projects</Button>
            </EmptyState>
          {/if}
        </div>
      {:else}
        <div class="border-t">
          {#each recent.data as issue (issue._id)}<IssueRow {issue} />{/each}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
