<script lang="ts">
  import { useQuery } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { relativeTime } from '$lib/utils';

  let { projectId }: { projectId: Id<'projects'> } = $props();

  const deploys = useQuery(api.usage.listDeploys, () => ({ projectId }));
</script>

{#if deploys.data && deploys.data.length > 0}
  <Card.Root>
    <Card.Header><Card.Title>Deploys</Card.Title></Card.Header>
    <Card.Content class="px-0">
      <div class="divide-y border-t">
        {#each deploys.data as d (d._id)}
          <div class="flex items-center gap-3 px-6 py-2.5 text-sm">
            <Badge variant="muted" class="shrink-0">{d.environment}</Badge>
            <span class="min-w-0 flex-1 truncate font-mono text-xs">{d.release}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{relativeTime(d.deployedAt)}</span>
          </div>
        {/each}
      </div>
    </Card.Content>
  </Card.Root>
{/if}
