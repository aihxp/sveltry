<script lang="ts">
  import { useQuery } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { formatBytes, relativeTime } from '$lib/utils';
  import FileCode2Icon from '@lucide/svelte/icons/file-code-2';

  let { projectId }: { projectId: Id<'projects'> } = $props();

  const artifacts = useQuery(api.sourcemaps.listProjectArtifacts, () => ({ projectId }));
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Source maps</Card.Title>
    <Card.Description>
      Upload your release's <code class="font-mono">.map</code> files so minified production stack traces
      resolve to original source.
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    {#if artifacts.isLoading}
      <p class="text-sm text-muted-foreground">Loading artifacts…</p>
    {:else if artifacts.error}
      <p class="text-sm text-destructive">Failed to load artifacts.</p>
    {:else if artifacts.data && artifacts.data.length > 0}
      <div class="divide-y rounded-lg border">
        {#each artifacts.data as artifact (artifact.id)}
          <div class="flex items-center gap-3 px-3 py-2 text-sm">
            <FileCode2Icon class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate font-mono text-xs">{artifact.name}</span>
            <Badge variant={artifact.kind === 'sourcemap' ? 'success' : 'muted'}
              >{artifact.kind}</Badge
            >
            {#if artifact.debugId}
              <Badge
                variant="outline"
                class="shrink-0 font-mono"
                title={`debug id ${artifact.debugId}`}>{artifact.debugId.slice(0, 8)}</Badge
              >
            {/if}
            {#if artifact.storage === 's3'}
              <Badge variant="outline" class="shrink-0" title="Offloaded to S3/R2">S3</Badge>
            {/if}
            <span class="shrink-0 font-mono text-xs text-muted-foreground"
              >{artifact.release || 'no release'}</span
            >
            <span class="hidden shrink-0 text-xs text-muted-foreground sm:inline"
              >{formatBytes(artifact.size)} · {relativeTime(artifact.createdAt)}</span
            >
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">
        No source maps uploaded yet. Upload them from CI with the
        <code class="font-mono">@aihxp/sveltry-sdk</code> uploader or a direct POST to
        <code class="font-mono">/artifacts/upload</code>.
      </p>
    {/if}
  </Card.Content>
</Card.Root>
