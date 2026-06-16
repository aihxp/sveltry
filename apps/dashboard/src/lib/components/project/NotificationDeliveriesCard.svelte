<script lang="ts">
  import { useQuery } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { relativeTime } from '$lib/utils';

  // Recent cron-driven notification deliveries (metric/usage alerts), org-wide,
  // so a failing channel is visible instead of silently swallowed.
  const notificationDeliveries = useQuery(api.notifications.listRecent, () => ({ limit: 20 }));
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Notification deliveries</Card.Title>
    <Card.Description>
      Recent metric and usage alert deliveries across this organization. A failed delivery no longer
      silently suppresses the alert.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    {#if !notificationDeliveries.data}
      <p class="text-sm text-muted-foreground">Loading…</p>
    {:else if notificationDeliveries.data.length === 0}
      <p class="text-sm text-muted-foreground">No notification deliveries yet.</p>
    {:else}
      <ul class="divide-y">
        {#each notificationDeliveries.data as d (d._id)}
          <li class="flex items-center justify-between gap-2 py-2 text-sm">
            <div class="min-w-0">
              <span class="font-medium">{d.label}</span>
              <span class="text-muted-foreground">
                · {d.source.replace('_', ' ')} · {d.channelType}</span
              >
              {#if d.detail && !d.ok}
                <p class="truncate text-xs text-muted-foreground">{d.detail}</p>
              {/if}
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Badge variant={d.ok ? 'success' : 'destructive'}>{d.ok ? 'ok' : 'failed'}</Badge>
              <span class="text-xs text-muted-foreground">{relativeTime(d.deliveredAt)}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>
