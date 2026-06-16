<script lang="ts">
  import LevelBadge from './LevelBadge.svelte';
  import { compactNumber, relativeTime } from '$lib/utils';

  type IssueLike = {
    _id: string;
    title: string;
    culprit: string;
    level: string;
    count: number;
    userCount: number;
    lastSeen: number;
    substatus: string;
    shortId?: string | null;
    project?: { slug: string; name: string } | null;
  };
  let { issue }: { issue: IssueLike } = $props();
</script>

<a
  href={`/issues/${issue._id}`}
  class="flex items-center gap-4 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-accent/40"
>
  <LevelBadge level={issue.level} />
  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-2">
      <span class="truncate text-sm font-semibold">{issue.title}</span>
      {#if issue.substatus === 'regressed'}
        <span
          class="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning-foreground"
        >
          regressed
        </span>
      {:else if issue.substatus === 'new'}
        <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
          >new</span
        >
      {/if}
    </div>
    <div class="truncate font-mono text-xs text-muted-foreground">
      {#if issue.shortId && issue.project}<span class="text-foreground/60"
          >{issue.project.slug.toUpperCase()}-{issue.shortId}</span
        > ·
      {/if}{issue.culprit}{#if issue.project}<span class="text-muted-foreground/60">
          · {issue.project.name}</span
        >{/if}
    </div>
  </div>
  <div class="hidden text-right sm:block">
    <div class="text-sm font-semibold tabular-nums">{compactNumber(issue.count)}</div>
    <div class="text-[10px] uppercase tracking-wide text-muted-foreground">events</div>
  </div>
  <div class="hidden text-right md:block">
    <div class="text-sm font-semibold tabular-nums">{compactNumber(issue.userCount)}</div>
    <div class="text-[10px] uppercase tracking-wide text-muted-foreground">users</div>
  </div>
  <div class="w-20 shrink-0 text-right text-xs text-muted-foreground">
    {relativeTime(issue.lastSeen)}
  </div>
</a>
