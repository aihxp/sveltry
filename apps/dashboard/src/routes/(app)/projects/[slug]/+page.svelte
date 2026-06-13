<script lang="ts">
  import { page } from '$app/state';
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import { env } from '$env/dynamic/public';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import { buildDsn } from '$lib/utils';
  import TrashIcon from '@lucide/svelte/icons/trash-2';

  const auth = useAuth();
  const client = useConvexClient();
  const slug = $derived(page.params.slug);
  const ingestUrl = env.PUBLIC_SVELTRY_INGEST_URL ?? 'http://127.0.0.1:3211';

  const proj = useQuery(api.projects.getProjectBySlug, () =>
    auth.isAuthenticated && slug ? { slug } : ('skip' as const),
  );
  const projectId = $derived(proj.data?.project?._id as Id<'projects'> | undefined);
  const rules = useQuery(api.alerts.listAlertRules, () =>
    projectId ? { projectId } : ('skip' as const),
  );

  // New alert rule form
  let ruleName = $state('');
  let trigger = $state<'new_issue' | 'regression' | 'event_frequency'>('new_issue');
  let threshold = $state(10);
  let channelType = $state<'webhook' | 'discord' | 'slack'>('webhook');
  let channelTarget = $state('');
  let savingRule = $state(false);

  async function addRule(e: SubmitEvent) {
    e.preventDefault();
    if (!projectId) return;
    savingRule = true;
    try {
      await client.mutation(api.alerts.createAlertRule, {
        projectId,
        name: ruleName || `${trigger} alert`,
        trigger,
        threshold: trigger === 'event_frequency' ? threshold : undefined,
        channels: [{ type: channelType, target: channelTarget }],
      });
      ruleName = '';
      channelTarget = '';
    } finally {
      savingRule = false;
    }
  }

  async function deleteRule(ruleId: Id<'alertRules'>) {
    await client.mutation(api.alerts.deleteAlertRule, { ruleId });
  }
</script>

<svelte:head><title>{proj.data?.project?.name ?? 'Project'} · Sveltry</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
  <a href="/projects" class="text-sm text-muted-foreground hover:text-foreground">&larr; Projects</a
  >

  {#if auth.isLoading || proj.isLoading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if !proj.data}
    <p class="text-sm text-destructive">Project not found.</p>
  {:else}
    {@const project = proj.data.project}
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">{project.name}</h1>
        <p class="font-mono text-sm text-muted-foreground">{project.slug}</p>
      </div>
      <Button variant="outline" href={`/issues`}>View issues</Button>
    </div>

    <Card.Root>
      <Card.Header>
        <Card.Title>Client keys (DSN)</Card.Title>
        <Card.Description>Use a DSN with any official Sentry SDK.</Card.Description>
      </Card.Header>
      <Card.Content class="space-y-3">
        {#each proj.data.keys as key (key._id)}
          {@const dsn = buildDsn(ingestUrl, key.publicKey, project.publicId)}
          <div class="space-y-1.5 rounded-lg border p-3">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">{key.label}</span>
              <Badge variant={key.isActive ? 'success' : 'muted'}
                >{key.isActive ? 'active' : 'revoked'}</Badge
              >
            </div>
            <div class="flex items-center gap-2">
              <code
                class="min-w-0 flex-1 truncate rounded bg-muted/40 px-2 py-1.5 font-mono text-xs"
                >{dsn}</code
              >
              <CopyButton text={dsn} />
            </div>
          </div>
        {/each}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>Alert rules</Card.Title>
        <Card.Description>Get notified when issues appear or spike.</Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        {#if rules.isLoading}
          <p class="text-sm text-muted-foreground">Loading alert rules…</p>
        {:else if rules.error}
          <p class="text-sm text-destructive">Failed to load alert rules.</p>
        {:else if rules.data && rules.data.length > 0}
          <div class="space-y-2">
            {#each rules.data as rule (rule._id)}
              <div class="flex items-center justify-between rounded-lg border p-3">
                <div class="min-w-0">
                  <div class="text-sm font-medium">{rule.name}</div>
                  <div class="truncate text-xs text-muted-foreground">
                    {rule.trigger}{rule.threshold ? ` ≥ ${rule.threshold}` : ''} ·
                    {rule.channels.map((c) => c.type).join(', ')}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onclick={() => deleteRule(rule._id)}
                  aria-label="Delete rule"
                >
                  <TrashIcon class="size-4 text-destructive" />
                </Button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">No alert rules yet.</p>
        {/if}

        <form class="space-y-3 rounded-lg border border-dashed p-4" onsubmit={addRule}>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="ruleName">Name</Label>
              <Input id="ruleName" bind:value={ruleName} placeholder="Notify on new errors" />
            </div>
            <div class="space-y-1.5">
              <Label for="trigger">Trigger</Label>
              <select
                id="trigger"
                bind:value={trigger}
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="new_issue">New issue</option>
                <option value="regression">Regression</option>
                <option value="event_frequency">Event frequency</option>
              </select>
            </div>
            {#if trigger === 'event_frequency'}
              <div class="space-y-1.5">
                <Label for="threshold">Threshold (events)</Label>
                <Input id="threshold" type="number" min="1" bind:value={threshold} />
              </div>
            {/if}
            <div class="space-y-1.5">
              <Label for="channelType">Channel</Label>
              <select
                id="channelType"
                bind:value={channelType}
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="webhook">Webhook</option>
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
              </select>
            </div>
          </div>
          <div class="space-y-1.5">
            <Label for="target">Channel URL</Label>
            <Input
              id="target"
              bind:value={channelTarget}
              required
              placeholder="https://hooks.slack.com/…"
            />
          </div>
          <Button type="submit" size="sm" disabled={savingRule}>
            {savingRule ? 'Adding…' : 'Add alert rule'}
          </Button>
        </form>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
