<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import LevelBadge from '$lib/components/LevelBadge.svelte';
  import StackTrace from '$lib/components/StackTrace.svelte';
  import { Input } from '$lib/components/ui/input';
  import { formatBytes, relativeTime } from '$lib/utils';
  import CheckIcon from '@lucide/svelte/icons/check';
  import BellOffIcon from '@lucide/svelte/icons/bell-off';
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import UserIcon from '@lucide/svelte/icons/user';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal';

  const auth = useAuth();
  const client = useConvexClient();
  const issueId = $derived(page.params.id as Id<'issues'>);
  const me = $derived((page.data as { user?: { id: string; email?: string } }).user);

  const issue = useQuery(api.issues.getIssue, () =>
    auth.isAuthenticated ? { issueId } : ('skip' as const),
  );
  const event = useQuery(api.events.latestEventForIssue, () =>
    auth.isAuthenticated ? { issueId } : ('skip' as const),
  );
  const suspects = useQuery(api.commits.suspectCommitsForIssue, () =>
    auth.isAuthenticated ? { issueId } : ('skip' as const),
  );
  const comments = useQuery(api.issues.listComments, () =>
    auth.isAuthenticated ? { issueId } : ('skip' as const),
  );
  const attachments = useQuery(api.feedback.eventAttachments, () =>
    auth.isAuthenticated && event.data?.eventId
      ? { eventId: event.data.eventId }
      : ('skip' as const),
  );

  let busy = $state(false);
  async function setStatus(status: 'unresolved' | 'resolved' | 'ignored') {
    busy = true;
    try {
      await client.mutation(api.issues.setIssueStatus, { issueId, status });
    } finally {
      busy = false;
    }
  }
  // Resolve, but reopen only when a release later than the current one appears.
  async function resolveInRelease() {
    busy = true;
    try {
      await client.mutation(api.issues.setIssueStatus, {
        issueId,
        status: 'resolved',
        resolvedInRelease: event.data?.release,
      });
    } finally {
      busy = false;
    }
  }

  const assignedToMe = $derived(!!me && issue.data?.assigneeId === me.id);
  async function toggleAssign() {
    if (!me) return;
    await client.mutation(api.issues.assignIssue, {
      issueId,
      assigneeId: assignedToMe ? undefined : me.id,
    });
  }

  // Merge another (duplicate) issue into this one.
  let mergeTerm = $state('');
  let merging = $state(false);
  const mergeCandidates = useQuery(api.issues.searchIssues, () =>
    auth.isAuthenticated && mergeTerm.trim().length > 1
      ? { query: mergeTerm, limit: 8 }
      : ('skip' as const),
  );
  async function mergeInto(sourceId: Id<'issues'>) {
    merging = true;
    try {
      await client.mutation(api.issues.mergeIssues, {
        sourceIssueId: sourceId,
        targetIssueId: issueId,
      });
      mergeTerm = '';
    } finally {
      merging = false;
    }
  }

  // Undo a previous merge: recreate the merged-away issue and move its events back.
  const merges = useQuery(api.issues.listIssueMerges, () =>
    auth.isAuthenticated ? { issueId } : ('skip' as const),
  );
  let unmerging = $state(false);
  async function unmerge(mergeId: Id<'issueMerges'>) {
    unmerging = true;
    try {
      const { newIssueId } = await client.mutation(api.issues.unmergeIssue, { mergeId });
      await goto(`/issues/${newIssueId}`);
    } finally {
      unmerging = false;
    }
  }

  let commentBody = $state('');
  let posting = $state(false);
  async function postComment(e: SubmitEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    posting = true;
    try {
      await client.mutation(api.issues.addComment, { issueId, body: commentBody });
      commentBody = '';
    } finally {
      posting = false;
    }
  }
  async function deleteComment(commentId: Id<'issueComments'>) {
    await client.mutation(api.issues.deleteComment, { commentId });
  }

  function breadcrumbs(payload: any): any[] {
    const b = payload?.breadcrumbs;
    if (!b) return [];
    return Array.isArray(b) ? b : (b.values ?? []);
  }
  function requestOf(payload: any) {
    return payload?.request ?? null;
  }
  const tagEntries = $derived(Object.entries(event.data?.tags ?? {}));
  const metaCards = $derived(
    issue.data
      ? [
          { label: 'Events', value: String(issue.data.count) },
          { label: 'Users', value: String(issue.data.userCount) },
          { label: 'First seen', value: relativeTime(issue.data.firstSeen) },
          { label: 'Last seen', value: relativeTime(issue.data.lastSeen) },
        ]
      : [],
  );
</script>

<svelte:head><title>{issue.data?.title ?? 'Issue'} · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <a href="/issues" class="text-sm text-muted-foreground hover:text-foreground"
    >&larr; Back to issues</a
  >

  {#if auth.isLoading || issue.isLoading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if !issue.data}
    <p class="text-sm text-destructive">Issue not found.</p>
  {:else}
    {@const i = issue.data}
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 space-y-2">
        <div class="flex items-center gap-2">
          <LevelBadge level={i.level} />
          <Badge variant={i.status === 'unresolved' ? 'outline' : 'muted'}>{i.status}</Badge>
          {#if i.project}<span class="text-xs text-muted-foreground">{i.project.name}</span>{/if}
        </div>
        <h1 class="text-xl font-bold tracking-tight">{i.title}</h1>
        <p class="font-mono text-sm text-muted-foreground">{i.culprit}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          variant={assignedToMe ? 'default' : 'outline'}
          size="sm"
          onclick={toggleAssign}
          disabled={!me}
        >
          <UserIcon class="size-4" />
          {assignedToMe ? 'Assigned to you' : 'Assign to me'}
        </Button>
        {#if i.status === 'unresolved'}
          <Button variant="outline" size="sm" disabled={busy} onclick={() => setStatus('resolved')}>
            <CheckIcon class="size-4" /> Resolve
          </Button>
          {#if event.data?.release}
            <Button variant="outline" size="sm" disabled={busy} onclick={resolveInRelease}>
              <CheckIcon class="size-4" /> Resolve in next release
            </Button>
          {/if}
          <Button variant="outline" size="sm" disabled={busy} onclick={() => setStatus('ignored')}>
            <BellOffIcon class="size-4" /> Ignore
          </Button>
        {:else}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onclick={() => setStatus('unresolved')}
          >
            <RotateCcwIcon class="size-4" /> Reopen
          </Button>
        {/if}
      </div>
    </div>

    {#if i.status === 'resolved' && i.resolvedInRelease}
      <p class="text-xs text-muted-foreground">
        Resolved in <span class="font-mono">{i.resolvedInRelease}</span>; reopens if it recurs in a
        later release.
      </p>
    {/if}

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {#each metaCards as m (m.label)}
        <Card.Root>
          <Card.Content class="p-4">
            <div class="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</div>
            <div class="mt-1 text-lg font-semibold tabular-nums">{m.value}</div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>

    {#if suspects.data && suspects.data.length > 0}
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2">
            <GitCommitHorizontalIcon class="size-4" /> Suspect commits
          </Card.Title>
          <Card.Description
            >Commits in this release that changed a file in the stack trace.</Card.Description
          >
        </Card.Header>
        <Card.Content class="space-y-2">
          {#each suspects.data as c (c.commitId)}
            <div class="flex items-start gap-3 rounded-lg border px-3 py-2">
              <GitCommitHorizontalIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{c.message ?? c.shortId}</p>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {#if c.url}
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      class="font-mono hover:underline">{c.shortId}</a
                    >
                  {:else}
                    <span class="font-mono">{c.shortId}</span>
                  {/if}
                  {#if c.author}· {c.author}{/if} · touched
                  <span class="font-mono">{c.file}</span>
                </p>
              </div>
            </div>
          {/each}
        </Card.Content>
      </Card.Root>
    {/if}

    <Card.Root>
      <Card.Header><Card.Title>Stack trace</Card.Title></Card.Header>
      <Card.Content>
        {#if auth.isLoading || event.isLoading}
          <p class="text-sm text-muted-foreground">Loading latest event…</p>
        {:else if event.data}
          <StackTrace payload={event.data.payload} />
        {:else}
          <p class="text-sm text-muted-foreground">No events recorded.</p>
        {/if}
      </Card.Content>
    </Card.Root>

    {#if tagEntries.length > 0}
      <Card.Root>
        <Card.Header><Card.Title>Tags</Card.Title></Card.Header>
        <Card.Content class="flex flex-wrap gap-2">
          {#each tagEntries as [k, v] (k)}
            <span class="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs">
              <span class="text-muted-foreground">{k}</span>
              <span class="text-foreground">={v}</span>
            </span>
          {/each}
        </Card.Content>
      </Card.Root>
    {/if}

    {#if event.data}
      {@const crumbs = breadcrumbs(event.data.payload)}
      {@const req = requestOf(event.data.payload)}
      {#if req}
        <Card.Root>
          <Card.Header><Card.Title>Request</Card.Title></Card.Header>
          <Card.Content>
            <p class="font-mono text-sm">
              <span class="font-semibold text-primary">{req.method ?? 'GET'}</span>
              {req.url ?? ''}
            </p>
          </Card.Content>
        </Card.Root>
      {/if}
      {#if crumbs.length > 0}
        <Card.Root>
          <Card.Header><Card.Title>Breadcrumbs</Card.Title></Card.Header>
          <Card.Content class="space-y-2">
            {#each crumbs as crumb, ci (ci)}
              <div class="flex items-start gap-3 text-sm">
                <span class="mt-0.5 w-16 shrink-0 font-mono text-xs text-muted-foreground">
                  {crumb.category ?? crumb.type ?? 'log'}
                </span>
                <span class="min-w-0 flex-1 truncate"
                  >{crumb.message ?? JSON.stringify(crumb.data ?? {})}</span
                >
                <span class="shrink-0 text-xs text-muted-foreground">{crumb.level ?? ''}</span>
              </div>
            {/each}
          </Card.Content>
        </Card.Root>
      {/if}
    {/if}

    {#if attachments.data && attachments.data.length > 0}
      <Card.Root>
        <Card.Header><Card.Title>Attachments</Card.Title></Card.Header>
        <Card.Content class="space-y-2">
          {#each attachments.data as a (a._id)}
            <div class="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span class="min-w-0 flex-1 truncate font-mono text-xs">{a.filename}</span>
              <span class="shrink-0 text-xs text-muted-foreground">{formatBytes(a.size)}</span>
              {#if a.url}
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener"
                  class="shrink-0 text-xs font-medium text-primary hover:underline">Download</a
                >
              {/if}
            </div>
          {/each}
        </Card.Content>
      </Card.Root>
    {/if}

    <Card.Root>
      <Card.Header>
        <Card.Title>Merge duplicates</Card.Title>
        <Card.Description>
          Search for a duplicate issue to merge into this one. Its events and counts move here.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-2">
        <Input bind:value={mergeTerm} placeholder="Search issues to merge…" disabled={merging} />
        {#if mergeCandidates.data && mergeCandidates.data.length > 0}
          <div class="divide-y rounded-lg border">
            {#each mergeCandidates.data.filter((c) => c._id !== issueId) as c (c._id)}
              <button
                onclick={() => mergeInto(c._id)}
                disabled={merging}
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/30 disabled:opacity-50"
              >
                <LevelBadge level={c.level} />
                <span class="min-w-0 flex-1 truncate">{c.title}</span>
                <span class="shrink-0 text-xs text-muted-foreground">merge in</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if merges.data && merges.data.length > 0}
          <div class="space-y-1.5 pt-2">
            <p class="text-xs font-medium text-muted-foreground">Merged in (undo to re-split)</p>
            <div class="divide-y rounded-lg border">
              {#each merges.data as m (m.id)}
                <div class="flex items-center gap-2 px-3 py-2 text-sm">
                  <LevelBadge level={m.level} />
                  <span class="min-w-0 flex-1 truncate">
                    {m.title}
                    <span class="text-xs text-muted-foreground"
                      >· {m.eventCount} events · {relativeTime(m.mergedAt)}</span
                    >
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={unmerging}
                    onclick={() => unmerge(m.id)}
                  >
                    Unmerge
                  </Button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header><Card.Title>Comments</Card.Title></Card.Header>
      <Card.Content class="space-y-4">
        {#if comments.data && comments.data.length > 0}
          <div class="space-y-3">
            {#each comments.data as c (c._id)}
              <div class="rounded-lg border p-3">
                <div class="flex items-center justify-between text-xs text-muted-foreground">
                  <span class="font-medium text-foreground">{c.authorEmail ?? 'Someone'}</span>
                  <span class="flex items-center gap-2">
                    {relativeTime(c.createdAt)}
                    {#if me && c.authorId === me.id}
                      <button
                        onclick={() => deleteComment(c._id)}
                        aria-label="Delete comment"
                        class="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2Icon class="size-3.5" />
                      </button>
                    {/if}
                  </span>
                </div>
                <p class="mt-1.5 whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">No comments yet.</p>
        {/if}

        <form class="flex items-start gap-2" onsubmit={postComment}>
          <Input bind:value={commentBody} placeholder="Add a comment…" class="flex-1" />
          <Button type="submit" size="sm" disabled={posting || !commentBody.trim()}>Post</Button>
        </form>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
