<script lang="ts">
  import { useQuery, useConvexClient } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import { toast, errorMessage } from '$lib/toast.svelte';
  import { confirm } from '$lib/confirm.svelte';
  import { relativeTime } from '$lib/utils';
  import TrashIcon from '@lucide/svelte/icons/trash-2';

  let { projectId }: { projectId: Id<'projects'> } = $props();

  const client = useConvexClient();
  const webhooks = useQuery(api.webhooks.listWebhooks, () => ({ projectId }));
  const webhookDeliveries = useQuery(api.webhooks.recentDeliveries, () => ({
    projectId,
    limit: 10,
  }));

  const WEBHOOK_EVENTS = [
    { value: 'issue.resolved', label: 'Issue resolved' },
    { value: 'issue.unresolved', label: 'Issue unresolved' },
    { value: 'issue.ignored', label: 'Issue ignored' },
    { value: 'issue.assigned', label: 'Issue assigned' },
    { value: 'issue.unassigned', label: 'Issue unassigned' },
  ] as const;
  type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]['value'];

  let webhookUrl = $state('');
  let webhookEvents = $state<WebhookEvent[]>(['issue.resolved']);
  let creatingWebhook = $state(false);
  let webhookError = $state('');
  let newWebhookSecret = $state('');

  function toggleWebhookEvent(value: WebhookEvent, checked: boolean) {
    webhookEvents = checked ? [...webhookEvents, value] : webhookEvents.filter((e) => e !== value);
  }
  async function addWebhook(e: SubmitEvent) {
    e.preventDefault();
    creatingWebhook = true;
    webhookError = '';
    newWebhookSecret = '';
    try {
      const res = await client.mutation(api.webhooks.createWebhook, {
        projectId,
        url: webhookUrl.trim(),
        events: webhookEvents,
      });
      newWebhookSecret = res.secret;
      webhookUrl = '';
      webhookEvents = ['issue.resolved'];
      toast.success('Webhook created');
    } catch (err) {
      webhookError = err instanceof Error ? err.message : 'Could not create webhook';
    } finally {
      creatingWebhook = false;
    }
  }
  async function removeWebhook(id: Id<'webhooks'>) {
    const ok = await confirm({
      title: 'Delete webhook?',
      description:
        'This permanently deletes the webhook and its signing secret. Your endpoint will stop receiving events.',
      confirmLabel: 'Delete webhook',
    });
    if (!ok) return;
    try {
      await client.mutation(api.webhooks.deleteWebhook, { webhookId: id });
      toast.success('Webhook deleted');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the webhook'));
    }
  }
  async function toggleWebhookEnabled(id: Id<'webhooks'>, enabled: boolean) {
    try {
      await client.mutation(api.webhooks.setWebhookEnabled, { webhookId: id, enabled });
      toast.success(enabled ? 'Webhook enabled' : 'Webhook disabled');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the webhook'));
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Webhooks</Card.Title>
    <Card.Description>
      POST a signed JSON payload to your endpoint on issue lifecycle events. Each request is signed
      with the webhook's secret (HMAC-SHA256) in the
      <code class="font-mono">X-Sveltry-Signature</code> header.
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    {#if webhooks.isLoading}
      <p class="text-sm text-muted-foreground">Loading webhooks…</p>
    {:else if webhooks.error}
      <p class="text-sm text-destructive">Failed to load webhooks.</p>
    {:else if webhooks.data && webhooks.data.length > 0}
      <div class="space-y-2">
        {#each webhooks.data as wh (wh._id)}
          <div class="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-medium">{wh.url}</div>
              <div class="truncate text-xs text-muted-foreground">
                {wh.events.join(', ')} ·
                <code class="font-mono">{wh.secretPrefix}…</code>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Badge variant={wh.enabled ? 'success' : 'muted'}>
                {wh.enabled ? 'enabled' : 'disabled'}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => toggleWebhookEnabled(wh._id, !wh.enabled)}
              >
                {wh.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onclick={() => removeWebhook(wh._id)}
                aria-label="Delete webhook"
              >
                <TrashIcon class="size-4 text-destructive" />
              </Button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">No webhooks yet.</p>
    {/if}

    {#if webhookDeliveries.data && webhookDeliveries.data.length > 0}
      <div class="mt-3 space-y-1">
        <p class="text-xs font-medium text-muted-foreground">Recent deliveries</p>
        {#each webhookDeliveries.data as d (d._id)}
          <div class="flex items-center justify-between gap-2 text-xs">
            <span class="min-w-0 truncate">
              {d.event}{#if d.detail && !d.ok}<span class="text-muted-foreground">
                  · {d.detail}</span
                >{/if}
            </span>
            <span class="flex shrink-0 items-center gap-2">
              <Badge variant={d.ok ? 'success' : 'destructive'}
                >{d.ok ? (d.statusCode ?? 'ok') : (d.statusCode ?? 'failed')}</Badge
              >
              <span class="text-muted-foreground">{relativeTime(d.deliveredAt)}</span>
            </span>
          </div>
        {/each}
      </div>
    {/if}

    {#if newWebhookSecret}
      <div class="space-y-1.5 rounded-lg border border-dashed p-3">
        <p class="text-xs text-muted-foreground">
          Copy this signing secret now. You will not be able to see it again.
        </p>
        <div class="flex items-center gap-2">
          <code class="min-w-0 flex-1 truncate rounded bg-muted/40 px-2 py-1.5 font-mono text-xs"
            >{newWebhookSecret}</code
          >
          <CopyButton text={newWebhookSecret} />
        </div>
      </div>
    {/if}

    <form class="space-y-3 rounded-lg border border-dashed p-4" onsubmit={addWebhook}>
      <div class="space-y-1.5">
        <Label for="webhookUrl">Endpoint URL</Label>
        <Input
          id="webhookUrl"
          type="url"
          bind:value={webhookUrl}
          required
          placeholder="https://example.com/hooks/sveltry"
        />
      </div>
      <div class="space-y-1.5">
        <Label>Events</Label>
        <div class="flex flex-wrap gap-x-4 gap-y-2">
          {#each WEBHOOK_EVENTS as ev (ev.value)}
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                class="size-4"
                checked={webhookEvents.includes(ev.value)}
                onchange={(e) => toggleWebhookEvent(ev.value, e.currentTarget.checked)}
              />
              {ev.label}
            </label>
          {/each}
        </div>
      </div>
      {#if webhookError}<p class="text-sm text-destructive">{webhookError}</p>{/if}
      <Button type="submit" size="sm" disabled={creatingWebhook || webhookEvents.length === 0}>
        {creatingWebhook ? 'Adding…' : 'Add webhook'}
      </Button>
    </form>
  </Card.Content>
</Card.Root>
