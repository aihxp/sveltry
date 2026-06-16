<script lang="ts">
  import { useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import { env } from '$env/dynamic/public';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import { buildDsn } from '$lib/utils';

  const client = useConvexClient();
  const auth = useAuth();

  const platforms = ['javascript', 'node', 'python', 'go', 'ruby', 'java', 'php', 'rust', 'other'];
  let name = $state('');
  let platform = $state('javascript');
  let creating = $state(false);
  let error = $state('');
  let result = $state<{ slug: string; publicId: string; publicKey: string } | null>(null);

  const ingestUrl = env.PUBLIC_SVELTRY_INGEST_URL ?? 'http://127.0.0.1:3211';
  const dsn = $derived(result ? buildDsn(ingestUrl, result.publicKey, result.publicId) : '');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!auth.isAuthenticated) return;
    creating = true;
    error = '';
    try {
      result = await client.mutation(api.projects.createProject, { name, platform });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create project';
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head><title>New project · Sveltry</title></svelte:head>

<div class="mx-auto max-w-xl space-y-6">
  <div>
    <a href="/projects" class="text-sm text-muted-foreground hover:text-foreground"
      >&larr; Projects</a
    >
    <h1 class="mt-2 text-2xl font-bold tracking-tight">New project</h1>
  </div>

  {#if !result}
    <Card.Root>
      <Card.Content class="pt-6">
        <form class="space-y-4" onsubmit={submit}>
          <div class="space-y-1.5">
            <Label for="name">Project name</Label>
            <Input id="name" bind:value={name} required placeholder="checkout-web" />
          </div>
          <div class="space-y-1.5">
            <Label for="platform">Platform</Label>
            <select
              id="platform"
              bind:value={platform}
              class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {#each platforms as p (p)}<option value={p}>{p}</option>{/each}
            </select>
          </div>
          {#if error}<p class="text-sm text-destructive">{error}</p>{/if}
          <Button type="submit" disabled={creating}
            >{creating ? 'Creating…' : 'Create project'}</Button
          >
        </form>
      </Card.Content>
    </Card.Root>
  {:else}
    <Card.Root>
      <Card.Header>
        <Card.Title>Project created</Card.Title>
        <Card.Description>
          Point a Sentry SDK at this DSN. The official <code class="font-mono">@sentry/*</code> clients
          work unmodified.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        <div>
          <Label>DSN</Label>
          <div class="mt-1.5 flex items-center gap-2">
            <code
              class="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs"
            >
              {dsn}
            </code>
            <CopyButton text={dsn} />
          </div>
        </div>
        <pre class="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs"><code
            >Sentry.init({'{'} dsn: '{dsn}' });</code
          ></pre>
        <div class="flex gap-2">
          <Button href={`/projects/${result.slug}`}>Go to project</Button>
          <Button variant="outline" href="/projects">All projects</Button>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
