<script lang="ts">
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { relativeTime } from '$lib/utils';
  import PlusIcon from '@lucide/svelte/icons/plus';

  const auth = useAuth();
  const projects = useQuery(api.projects.listProjects, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
</script>

<svelte:head><title>Projects · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Projects</h1>
      <p class="text-sm text-muted-foreground">Each project has its own DSN for sending events.</p>
    </div>
    <Button href="/projects/new"><PlusIcon class="size-4" /> New project</Button>
  </div>

  {#if auth.isLoading || projects.isLoading}
    <div class="grid gap-4 sm:grid-cols-2">
      {#each Array(2) as _, i (i)}<Skeleton class="h-28 w-full rounded-xl" />{/each}
    </div>
  {:else if !projects.data || projects.data.length === 0}
    <EmptyState
      title="No projects yet"
      description="Create a project to get a DSN and start receiving events."
    >
      <Button href="/projects/new"><PlusIcon class="size-4" /> New project</Button>
    </EmptyState>
  {:else}
    <div class="grid gap-4 sm:grid-cols-2">
      {#each projects.data as project (project._id)}
        <a href={`/projects/${project.slug}`} class="block">
          <Card.Root class="transition-colors hover:border-primary/50">
            <Card.Header class="flex-row items-start justify-between space-y-0">
              <div>
                <Card.Title>{project.name}</Card.Title>
                <Card.Description class="font-mono">{project.slug}</Card.Description>
              </div>
              <Badge variant="muted">{project.platform}</Badge>
            </Card.Header>
            <Card.Content>
              <p class="text-xs text-muted-foreground">Created {relativeTime(project.createdAt)}</p>
            </Card.Content>
          </Card.Root>
        </a>
      {/each}
    </div>
  {/if}
</div>
