<script lang="ts">
  import { page } from '$app/state';
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { formatDuration, relativeTime } from '$lib/utils';

  interface FlameNode {
    name: string;
    file?: string;
    inApp: boolean;
    value: number;
    children: FlameNode[];
  }

  const auth = useAuth();
  const profileId = $derived(page.params.id as Id<'profiles'>);
  const data = useQuery(api.profiles.getProfile, () =>
    auth.isAuthenticated ? { profileId } : ('skip' as const),
  );
  const total = $derived(data.data?.flame.value ?? 1);

  // A warm, flamegraph-style color keyed by frame name; in-app frames stand out.
  function warmHue(name: string): number {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    return 8 + (h % 50);
  }
  function barStyle(node: FlameNode): string {
    const h = warmHue(node.name);
    return `background: hsl(${h} ${node.inApp ? 85 : 28}% ${node.inApp ? 62 : 72}%)`;
  }
</script>

<svelte:head><title>{data.data?.transactionName ?? 'Profile'} · Sveltry</title></svelte:head>

{#snippet frame(node: FlameNode)}
  <div class="w-full">
    <div
      class="h-[22px] cursor-default truncate rounded-sm px-1.5 text-[11px] leading-[22px] text-black/80"
      style={barStyle(node)}
      title={`${node.name}${node.file ? ' (' + node.file + ')' : ''}: ${node.value} samples (${((node.value / total) * 100).toFixed(1)}%)`}
    >
      {node.name}
    </div>
    {#if node.children.length}
      <div class="mt-px flex gap-px">
        {#each node.children as child, i (child.name + (child.file ?? '') + i)}
          <div class="min-w-0" style={`width:${(child.value / node.value) * 100}%`}>
            {@render frame(child)}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<div class="mx-auto max-w-5xl space-y-6">
  <a href="/profiles" class="text-sm text-muted-foreground hover:text-foreground">&larr; Profiles</a
  >

  {#if auth.isLoading || data.isLoading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if !data.data}
    <p class="text-sm text-destructive">Profile not found.</p>
  {:else}
    {@const p = data.data}
    <div class="space-y-1">
      <h1 class="break-all text-xl font-bold tracking-tight">{p.transactionName}</h1>
      <p class="text-sm text-muted-foreground">
        {p.sampleCount} samples · {formatDuration(p.durationMs)} · {p.platform}
        {#if p.release}· {p.release}{/if} · {relativeTime(p.timestamp)}
      </p>
    </div>

    <Card.Root>
      <Card.Header><Card.Title>Flamegraph</Card.Title></Card.Header>
      <Card.Content>
        {#if p.flame.value === 0}
          <p class="text-sm text-muted-foreground">No samples to render.</p>
        {:else}
          <div class="overflow-x-auto">
            <div class="min-w-[40rem]">{@render frame(p.flame)}</div>
          </div>
          <p class="mt-3 text-xs text-muted-foreground">
            Width is sample share; in-app frames are saturated. Hover a frame for details.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
