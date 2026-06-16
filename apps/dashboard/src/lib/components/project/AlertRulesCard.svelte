<script lang="ts">
  import { useQuery, useConvexClient } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { CHANNEL_OPTIONS, type ChannelType } from './channels';

  let { projectId }: { projectId: Id<'projects'> } = $props();

  const client = useConvexClient();
  const rules = useQuery(api.alerts.listAlertRules, () => ({ projectId }));

  let ruleName = $state('');
  let trigger = $state<'new_issue' | 'regression' | 'event_frequency'>('new_issue');
  let threshold = $state(10);
  let ruleEnvironment = $state('');
  let channelType = $state<ChannelType>('webhook');
  let channelTarget = $state('');
  let savingRule = $state(false);

  async function addRule(e: SubmitEvent) {
    e.preventDefault();
    savingRule = true;
    try {
      await client.mutation(api.alerts.createAlertRule, {
        projectId,
        name: ruleName || `${trigger} alert`,
        trigger,
        threshold: trigger === 'event_frequency' ? threshold : undefined,
        environment: ruleEnvironment.trim() || undefined,
        channels: [{ type: channelType, target: channelTarget }],
      });
      ruleName = '';
      channelTarget = '';
      ruleEnvironment = '';
    } finally {
      savingRule = false;
    }
  }
  async function deleteRule(ruleId: Id<'alertRules'>) {
    await client.mutation(api.alerts.deleteAlertRule, { ruleId });
  }
</script>

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
                {rule.trigger}{rule.threshold ? ` ≥ ${rule.threshold}` : ''}{rule.environment
                  ? ` · env: ${rule.environment}`
                  : ''} ·
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
          <div class="space-y-1.5 sm:col-span-2">
            <Label for="threshold">Threshold (events)</Label>
            <Input id="threshold" type="number" min="1" bind:value={threshold} />
          </div>
        {/if}
        <div class="space-y-1.5">
          <Label for="ruleEnvironment">Environment (blank = all)</Label>
          <Input id="ruleEnvironment" bind:value={ruleEnvironment} placeholder="production" />
        </div>
        <div class="space-y-1.5">
          <Label for="channelType">Channel</Label>
          <select
            id="channelType"
            bind:value={channelType}
            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {#each CHANNEL_OPTIONS as o (o.value)}
              <option value={o.value}>{o.label}</option>
            {/each}
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
