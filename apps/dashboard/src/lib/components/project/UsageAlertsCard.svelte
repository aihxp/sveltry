<script lang="ts">
  import { useQuery, useConvexClient } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { relativeTime } from '$lib/utils';
  import { selectClass } from '$lib/components/ui/control-classes';
  import { toast, errorMessage } from '$lib/toast.svelte';
  import { confirm } from '$lib/confirm.svelte';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { CHANNEL_OPTIONS, type ChannelType } from './channels';

  let { projectId, hasQuota }: { projectId: Id<'projects'>; hasQuota: boolean } = $props();

  const client = useConvexClient();
  const usageAlerts = useQuery(api.usageAlerts.listUsageAlerts, () => ({ projectId }));

  let uaThreshold = $state(80);
  let uaChannelType = $state<ChannelType>('webhook');
  let uaTarget = $state('');
  let savingUsageAlert = $state(false);

  async function addUsageAlert(e: SubmitEvent) {
    e.preventDefault();
    savingUsageAlert = true;
    try {
      await client.mutation(api.usageAlerts.createUsageAlert, {
        projectId,
        thresholdPercent: Number(uaThreshold),
        channels: [{ type: uaChannelType, target: uaTarget }],
      });
      uaTarget = '';
    } finally {
      savingUsageAlert = false;
    }
  }
  async function deleteUsageAlert(id: Id<'usageAlerts'>, thresholdPercent: number) {
    const ok = await confirm({
      title: 'Delete usage alert?',
      description: `The alert at ${thresholdPercent}% of quota will stop firing. This cannot be undone.`,
      confirmLabel: 'Delete alert',
    });
    if (!ok) return;
    try {
      await client.mutation(api.usageAlerts.deleteUsageAlert, { alertId: id });
      toast.success('Usage alert deleted');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the usage alert'));
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Usage alerts</Card.Title>
    <Card.Description>
      Get notified when this month's events reach a percentage of the monthly quota.{!hasQuota
        ? ' Set a monthly event quota above first.'
        : ''}
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    {#if usageAlerts.data && usageAlerts.data.length > 0}
      <div class="space-y-2">
        {#each usageAlerts.data as a (a._id)}
          <div class="flex items-center justify-between rounded-lg border p-3">
            <div class="min-w-0">
              <div class="text-sm font-medium">At {a.thresholdPercent}% of quota</div>
              <div class="truncate text-xs text-muted-foreground">
                {a.channels.map((c) => c.type).join(', ')}
                {#if a.lastFiredAt}· fired {relativeTime(a.lastFiredAt)}{/if}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onclick={() => deleteUsageAlert(a._id, a.thresholdPercent)}
              aria-label="Delete usage alert"
            >
              <TrashIcon class="size-4 text-destructive" />
            </Button>
          </div>
        {/each}
      </div>
    {/if}
    <form class="space-y-3 rounded-lg border border-dashed p-4" onsubmit={addUsageAlert}>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1.5">
          <Label for="uaThreshold">Threshold (% of quota)</Label>
          <Input id="uaThreshold" type="number" min="1" max="100" bind:value={uaThreshold} />
        </div>
        <div class="space-y-1.5">
          <Label for="uaChannel">Channel</Label>
          <select id="uaChannel" bind:value={uaChannelType} class={selectClass}>
            {#each CHANNEL_OPTIONS as o (o.value)}
              <option value={o.value}>{o.label}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="space-y-1.5">
        <Label for="uaTarget">{uaChannelType === 'email' ? 'Email address' : 'Channel URL'}</Label>
        <Input id="uaTarget" bind:value={uaTarget} required />
      </div>
      <Button type="submit" size="sm" disabled={savingUsageAlert}>Add usage alert</Button>
    </form>
  </Card.Content>
</Card.Root>
