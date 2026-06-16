<script lang="ts">
  import { useQuery, useConvexClient } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { selectClass } from '$lib/components/ui/control-classes';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { CHANNEL_OPTIONS, type ChannelType } from './channels';

  let { projectId }: { projectId: Id<'projects'> } = $props();

  const client = useConvexClient();
  const metricAlerts = useQuery(api.metricAlerts.listMetricAlerts, () => ({ projectId }));

  let maMetric = $state<'p95_latency' | 'error_count' | 'crash_free_rate'>('p95_latency');
  let maThreshold = $state(1000);
  let maTransaction = $state('');
  let maEnvironment = $state('');
  let maWindow = $state(60);
  let maChannelType = $state<ChannelType>('webhook');
  let maTarget = $state('');
  let savingMetric = $state(false);
  const metricLabel = {
    p95_latency: 'p95 latency (ms)',
    error_count: 'errors',
    crash_free_rate: 'crash-free %',
  };

  async function addMetricAlert(e: SubmitEvent) {
    e.preventDefault();
    savingMetric = true;
    try {
      await client.mutation(api.metricAlerts.createMetricAlert, {
        projectId,
        name: `${metricLabel[maMetric]} alert`,
        metric: maMetric,
        transactionName: maMetric === 'p95_latency' && maTransaction ? maTransaction : undefined,
        environment: maEnvironment.trim() || undefined,
        windowMinutes: maWindow,
        threshold: maThreshold,
        channels: [{ type: maChannelType, target: maTarget }],
      });
      maTarget = '';
      maEnvironment = '';
    } finally {
      savingMetric = false;
    }
  }
  async function deleteMetricAlert(id: Id<'metricAlerts'>) {
    await client.mutation(api.metricAlerts.deleteMetricAlert, { alertId: id });
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Metric alerts</Card.Title>
    <Card.Description
      >Alert when latency, error count, or crash-free rate crosses a threshold.</Card.Description
    >
  </Card.Header>
  <Card.Content class="space-y-4">
    {#if metricAlerts.data && metricAlerts.data.length > 0}
      <div class="space-y-2">
        {#each metricAlerts.data as a (a._id)}
          <div class="flex items-center justify-between rounded-lg border p-3">
            <div class="min-w-0">
              <div class="text-sm font-medium">{a.name}</div>
              <div class="truncate text-xs text-muted-foreground">
                {metricLabel[a.metric]}
                {a.metric === 'crash_free_rate' ? '<' : '>'}
                {a.threshold} over {a.windowMinutes}m{a.environment
                  ? ` · env: ${a.environment}`
                  : ''}
                {#if a.lastValue != null}· last {Math.round(a.lastValue)}{/if}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onclick={() => deleteMetricAlert(a._id)}
              aria-label="Delete metric alert"
            >
              <TrashIcon class="size-4 text-destructive" />
            </Button>
          </div>
        {/each}
      </div>
    {/if}
    <form class="space-y-3 rounded-lg border border-dashed p-4" onsubmit={addMetricAlert}>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1.5">
          <Label for="maMetric">Metric</Label>
          <select id="maMetric" bind:value={maMetric} class={selectClass}>
            <option value="p95_latency">p95 latency (ms)</option>
            <option value="error_count">Error count</option>
            <option value="crash_free_rate">Crash-free rate (%)</option>
          </select>
        </div>
        <div class="space-y-1.5">
          <Label for="maThreshold">
            Threshold {maMetric === 'crash_free_rate' ? '(alert below)' : '(alert above)'}
          </Label>
          <Input id="maThreshold" type="number" bind:value={maThreshold} />
        </div>
        {#if maMetric === 'p95_latency'}
          <div class="space-y-1.5 sm:col-span-2">
            <Label for="maTransaction">Transaction (blank = all)</Label>
            <Input id="maTransaction" bind:value={maTransaction} placeholder="GET /api/users" />
          </div>
        {/if}
        <div class="space-y-1.5">
          <Label for="maWindow">Window (minutes)</Label>
          <Input id="maWindow" type="number" min="5" bind:value={maWindow} />
        </div>
        <div class="space-y-1.5">
          <Label for="maEnvironment">Environment (blank = all)</Label>
          <Input id="maEnvironment" bind:value={maEnvironment} placeholder="production" />
        </div>
        <div class="space-y-1.5">
          <Label for="maChannel">Channel</Label>
          <select id="maChannel" bind:value={maChannelType} class={selectClass}>
            {#each CHANNEL_OPTIONS as o (o.value)}
              <option value={o.value}>{o.label}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="space-y-1.5">
        <Label for="maTarget">{maChannelType === 'email' ? 'Email address' : 'Channel URL'}</Label>
        <Input id="maTarget" bind:value={maTarget} required />
      </div>
      <Button type="submit" size="sm" disabled={savingMetric}>Add metric alert</Button>
    </form>
  </Card.Content>
</Card.Root>
