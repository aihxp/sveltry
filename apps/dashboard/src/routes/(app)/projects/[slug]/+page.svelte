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
  import { buildDsn, formatBytes, relativeTime } from '$lib/utils';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import FileCode2Icon from '@lucide/svelte/icons/file-code-2';

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
  const artifacts = useQuery(api.sourcemaps.listProjectArtifacts, () =>
    projectId ? { projectId } : ('skip' as const),
  );
  const metricAlerts = useQuery(api.metricAlerts.listMetricAlerts, () =>
    projectId ? { projectId } : ('skip' as const),
  );

  // New metric alert form
  let maMetric = $state<'p95_latency' | 'error_count' | 'crash_free_rate'>('p95_latency');
  let maThreshold = $state(1000);
  let maTransaction = $state('');
  let maWindow = $state(60);
  let maChannelType = $state<'webhook' | 'discord' | 'slack' | 'email'>('webhook');
  let maTarget = $state('');
  let savingMetric = $state(false);
  const metricLabel = {
    p95_latency: 'p95 latency (ms)',
    error_count: 'errors',
    crash_free_rate: 'crash-free %',
  };

  async function addMetricAlert(e: SubmitEvent) {
    e.preventDefault();
    if (!projectId) return;
    savingMetric = true;
    try {
      await client.mutation(api.metricAlerts.createMetricAlert, {
        projectId,
        name: `${metricLabel[maMetric]} alert`,
        metric: maMetric,
        transactionName: maMetric === 'p95_latency' && maTransaction ? maTransaction : undefined,
        windowMinutes: maWindow,
        threshold: maThreshold,
        channels: [{ type: maChannelType, target: maTarget }],
      });
      maTarget = '';
    } finally {
      savingMetric = false;
    }
  }
  async function deleteMetricAlert(id: Id<'metricAlerts'>) {
    await client.mutation(api.metricAlerts.deleteMetricAlert, { alertId: id });
  }

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
                    {a.threshold} over {a.windowMinutes}m
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
              <select
                id="maMetric"
                bind:value={maMetric}
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
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
              <Label for="maChannel">Channel</Label>
              <select
                id="maChannel"
                bind:value={maChannelType}
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="webhook">Webhook</option>
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
                <option value="email">Email</option>
              </select>
            </div>
          </div>
          <div class="space-y-1.5">
            <Label for="maTarget"
              >{maChannelType === 'email' ? 'Email address' : 'Channel URL'}</Label
            >
            <Input id="maTarget" bind:value={maTarget} required />
          </div>
          <Button type="submit" size="sm" disabled={savingMetric}>Add metric alert</Button>
        </form>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>Source maps</Card.Title>
        <Card.Description>
          Upload your release's <code class="font-mono">.map</code> files so minified production stack
          traces resolve to original source.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        {#if artifacts.isLoading}
          <p class="text-sm text-muted-foreground">Loading artifacts…</p>
        {:else if artifacts.error}
          <p class="text-sm text-destructive">Failed to load artifacts.</p>
        {:else if artifacts.data && artifacts.data.length > 0}
          <div class="divide-y rounded-lg border">
            {#each artifacts.data as artifact (artifact.id)}
              <div class="flex items-center gap-3 px-3 py-2 text-sm">
                <FileCode2Icon class="size-4 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate font-mono text-xs">{artifact.name}</span>
                <Badge variant={artifact.kind === 'sourcemap' ? 'success' : 'muted'}
                  >{artifact.kind}</Badge
                >
                <span class="shrink-0 font-mono text-xs text-muted-foreground"
                  >{artifact.release}</span
                >
                <span class="hidden shrink-0 text-xs text-muted-foreground sm:inline"
                  >{formatBytes(artifact.size)} · {relativeTime(artifact.createdAt)}</span
                >
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">
            No source maps uploaded yet. Upload them from CI with the
            <code class="font-mono">@aihxp/sveltry-sdk</code> uploader or a direct POST to
            <code class="font-mono">/artifacts/upload</code>.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
