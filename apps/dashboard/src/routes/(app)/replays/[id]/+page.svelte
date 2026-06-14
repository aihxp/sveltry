<script lang="ts">
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { formatDuration, relativeTime } from '$lib/utils';

  const auth = useAuth();
  const replayDocId = $derived(page.params.id as Id<'replays'>);
  const data = useQuery(api.replays.getReplay, () =>
    auth.isAuthenticated ? { replayDocId } : ('skip' as const),
  );

  let container = $state<HTMLDivElement | null>(null);
  let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let errorMsg = $state('');
  let started = false;

  // The recording body is stored as-is (often gzip/deflate from the SDK); the
  // browser decompresses it before parsing the rrweb event stream.
  async function decompress(buf: ArrayBuffer, fmt: 'gzip' | 'deflate'): Promise<ArrayBuffer> {
    const ds = new DecompressionStream(fmt);
    const stream = new Response(new Blob([buf]).stream().pipeThrough(ds));
    return stream.arrayBuffer();
  }

  async function readRecording(url: string): Promise<unknown[]> {
    const res = await fetch(url);
    let buf = await res.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
    if (head[0] === 0x1f && head[1] === 0x8b) buf = await decompress(buf, 'gzip');
    else if (head[0] === 0x78) buf = await decompress(buf, 'deflate');
    return JSON.parse(new TextDecoder().decode(buf)) as unknown[];
  }

  // Fetch the rrweb recordings (one JSON array per segment) directly from storage,
  // concatenate, and hand them to the rrweb player, which is browser-only.
  $effect(() => {
    const d = data.data;
    if (!browser || !d || !container || started) return;
    started = true;
    status = 'loading';
    (async () => {
      try {
        const segments = await Promise.all(d.recordingUrls.map(readRecording));
        const events = segments.flat();
        if (events.length === 0) {
          status = 'error';
          errorMsg = 'This replay has no recorded events.';
          return;
        }
        const mod = await import('rrweb-player');
        await import('rrweb-player/dist/style.css');
        const RRWebPlayer = mod.default as unknown as new (opts: {
          target: HTMLElement;
          props: Record<string, unknown>;
        }) => unknown;
        new RRWebPlayer({
          target: container!,
          props: {
            events,
            autoPlay: false,
            width: container!.clientWidth || 900,
            height: 500,
          },
        });
        status = 'ready';
      } catch (e) {
        status = 'error';
        errorMsg = e instanceof Error ? e.message : String(e);
      }
    })();
  });
</script>

<svelte:head><title>Replay · Sveltry</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
  <a href="/replays" class="text-sm text-muted-foreground hover:text-foreground">&larr; Replays</a>

  {#if auth.isLoading || data.isLoading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if !data.data}
    <p class="text-sm text-destructive">Replay not found.</p>
  {:else}
    {@const r = data.data}
    <div class="space-y-1">
      <h1 class="break-all text-xl font-bold tracking-tight">{r.url ?? 'Session replay'}</h1>
      <p class="text-sm text-muted-foreground">
        {formatDuration(r.durationMs)} · {r.recordingUrls.length} segments
        {#if r.errorCount > 0}· <span class="text-destructive">{r.errorCount} errors</span>{/if}
        · {relativeTime(r.startedAt)}
      </p>
      <p class="font-mono text-xs text-muted-foreground">{r.replayId}</p>
    </div>

    <Card.Root>
      <Card.Content class="p-4">
        {#if status === 'loading'}
          <p class="text-sm text-muted-foreground">Loading recording…</p>
        {:else if status === 'error'}
          <p class="text-sm text-destructive">Could not play this replay: {errorMsg}</p>
        {/if}
        <div bind:this={container} class="overflow-hidden rounded"></div>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
