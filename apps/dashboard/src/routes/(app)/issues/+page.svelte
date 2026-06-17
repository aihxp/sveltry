<script lang="ts">
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import LoadError from '$lib/components/LoadError.svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import IssueRow from '$lib/components/IssueRow.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { toast, errorMessage } from '$lib/toast.svelte';
  import { confirm } from '$lib/confirm.svelte';
  import { cn } from '$lib/utils';
  import SearchIcon from '@lucide/svelte/icons/search';
  import BookmarkIcon from '@lucide/svelte/icons/bookmark';
  import XIcon from '@lucide/svelte/icons/x';

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
  const client = useConvexClient();
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

  // Saved views: named presets of the filters above, shared across the org.
  const savedViews = useQuery(api.savedViews.listSavedViews, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
  let naming = $state(false);
  let viewName = $state('');
  let savingView = $state(false);

  type SavedView = {
    _id: Id<'savedViews'>;
    name: string;
    query?: string;
    status?: Status;
    level?: Exclude<Level, ''>;
  };

  function applyView(v: SavedView) {
    status = v.status ?? 'unresolved';
    level = v.level ?? '';
    term = v.query ?? '';
  }

  async function saveView() {
    const name = viewName.trim();
    if (!name || savingView) return;
    savingView = true;
    try {
      await client.mutation(api.savedViews.createSavedView, {
        name,
        query: term.trim() || undefined,
        status,
        level: level || undefined,
      });
      viewName = '';
      naming = false;
    } finally {
      savingView = false;
    }
  }

  async function deleteView(viewId: Id<'savedViews'>, name: string) {
    const ok = await confirm({
      title: 'Delete saved view?',
      description: `"${name}" will be removed. This cannot be undone.`,
      confirmLabel: 'Delete view',
    });
    if (!ok) return;
    try {
      await client.mutation(api.savedViews.deleteSavedView, { viewId });
      toast.success('Saved view deleted');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the view'));
    }
  }
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

  {#if auth.isAuthenticated}
    <div class="flex flex-wrap items-center gap-2">
      {#each savedViews.data ?? [] as view (view._id)}
        <span
          class="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pl-2.5 pr-1 text-xs"
        >
          <button class="font-medium hover:text-primary" onclick={() => applyView(view)}>
            {view.name}
          </button>
          <button
            class="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Delete view ${view.name}`}
            onclick={() => deleteView(view._id, view.name)}
          >
            <XIcon class="size-3" />
          </button>
        </span>
      {/each}

      {#if naming}
        <form class="flex items-center gap-1.5" onsubmit={(e) => (e.preventDefault(), saveView())}>
          <!-- svelte-ignore a11y_autofocus -->
          <Input
            bind:value={viewName}
            placeholder="View name…"
            class="h-7 w-40 text-xs"
            autofocus
            onkeydown={(e) => e.key === 'Escape' && ((naming = false), (viewName = ''))}
          />
          <Button type="submit" size="sm" class="h-7" disabled={savingView || !viewName.trim()}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            class="h-7"
            onclick={() => ((naming = false), (viewName = ''))}
          >
            Cancel
          </Button>
        </form>
      {:else}
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1.5 text-xs text-muted-foreground"
          onclick={() => (naming = true)}
        >
          <BookmarkIcon class="size-3.5" />
          Save view
        </Button>
      {/if}
    </div>
  {/if}

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
        <LoadError message="Couldn't load issues." error={issues.error} />
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
