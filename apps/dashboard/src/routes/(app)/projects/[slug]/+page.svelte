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
  let usageWindow = $state(30);
  const usage = useQuery(api.usage.projectUsage, () =>
    projectId ? { projectId, windowDays: usageWindow } : ('skip' as const),
  );
  // Gap-fill the sparse daily series into a continuous bar series across the window.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const usageSeries = $derived.by(() => {
    const data = usage.data;
    if (!data) return [];
    const byDay = new Map(data.days.map((d) => [d.day, d]));
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const out: {
      day: number;
      events: number;
      transactions: number;
      dropped: number;
      filtered: number;
    }[] = [];
    for (let i = data.windowDays - 1; i >= 0; i--) {
      const day = today - i * DAY_MS;
      const row = byDay.get(day);
      out.push({
        day,
        events: row?.events ?? 0,
        transactions: row?.transactions ?? 0,
        dropped: row?.dropped ?? 0,
        filtered: row?.filtered ?? 0,
      });
    }
    return out;
  });
  const usageMax = $derived(Math.max(1, ...usageSeries.map((d) => d.events)));
  const dayLabel = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const deploys = useQuery(api.usage.listDeploys, () =>
    projectId ? { projectId } : ('skip' as const),
  );
  const teams = useQuery(api.teams.listTeams, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

  // Per-key allowed domains (one pattern per line). Seeded once per key from the
  // loaded keys; saving an empty list clears the restriction.
  let originDrafts = $state<Record<string, string>>({});
  $effect(() => {
    const keys = proj.data?.keys;
    if (!keys) return;
    for (const k of keys) {
      if (!(k._id in originDrafts)) originDrafts[k._id] = (k.allowedOrigins ?? []).join('\n');
    }
  });
  let savingOrigins = $state<string | null>(null);
  async function saveOrigins(keyId: Id<'projectKeys'>) {
    savingOrigins = keyId;
    try {
      const allowedOrigins = (originDrafts[keyId] ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await client.mutation(api.projects.setKeyAllowedOrigins, { keyId, allowedOrigins });
    } finally {
      savingOrigins = null;
    }
  }

  // Owning team assignment.
  let assigningTeam = $state(false);
  async function assignTeam(value: string) {
    if (!projectId) return;
    assigningTeam = true;
    try {
      await client.mutation(api.teams.assignProjectTeam, {
        projectId,
        teamId: value ? (value as Id<'teams'>) : null,
      });
    } finally {
      assigningTeam = false;
    }
  }

  // Issue-tracker integration (Jira / Linear).
  const integration = useQuery(api.integrations.getProjectIntegration, () =>
    projectId ? { projectId } : ('skip' as const),
  );
  let provider = $state<'' | 'jira' | 'linear'>('');
  let jiraSite = $state('');
  let jiraProjectKey = $state('');
  let jiraEmail = $state('');
  let jiraType = $state('Task');
  let linearTeam = $state('');
  let secret = $state('');
  let intEnabled = $state(true);
  let intAuto = $state(false);
  let intSeeded = false;
  let savingInt = $state(false);
  $effect(() => {
    const d = integration.data;
    if (d && !intSeeded) {
      intSeeded = true;
      intEnabled = d.isEnabled;
      intAuto = d.autoCreate;
      provider = d.display.type;
      if (d.display.type === 'jira') {
        jiraSite = d.display.siteUrl;
        jiraProjectKey = d.display.projectKey;
        jiraEmail = d.display.email;
        jiraType = d.display.issueTypeName;
      } else {
        linearTeam = d.display.teamId;
      }
    }
  });
  async function saveIntegration() {
    if (!projectId || !provider || savingInt) return;
    savingInt = true;
    try {
      const config =
        provider === 'jira'
          ? {
              type: 'jira' as const,
              siteUrl: jiraSite.trim(),
              projectKey: jiraProjectKey.trim(),
              email: jiraEmail.trim(),
              apiToken: secret,
              issueTypeName: jiraType.trim() || 'Task',
            }
          : { type: 'linear' as const, apiKey: secret, teamId: linearTeam.trim() };
      await client.mutation(api.integrations.upsertIntegration, {
        projectId,
        config,
        isEnabled: intEnabled,
        autoCreate: intAuto,
      });
      secret = '';
    } finally {
      savingInt = false;
    }
  }
  async function removeIntegration() {
    if (!integration.data) return;
    await client.mutation(api.integrations.deleteIntegration, {
      integrationId: integration.data.id,
    });
    intSeeded = false;
    provider = '';
  }

  // Project limits/settings (seeded once from the loaded project)
  let retention = $state(90);
  let scrub = $state(true);
  let scrubExtra = $state('');
  let scrubSafe = $state('');
  let scrubIp = $state(false);
  let quota = $state<number | ''>('');
  let spike = $state<number | ''>('');
  let savingSettings = $state(false);
  let seeded = false;
  $effect(() => {
    const p = proj.data?.project;
    if (p && !seeded) {
      seeded = true;
      retention = p.eventRetentionDays;
      scrub = p.scrubPii;
      scrubExtra = (p.scrubConfig?.extraFields ?? []).join('\n');
      scrubSafe = (p.scrubConfig?.safeFields ?? []).join('\n');
      scrubIp = p.scrubConfig?.scrubIp ?? false;
      quota = p.monthlyEventQuota ?? '';
      spike = p.spikeThresholdPerMinute ?? '';
    }
  });
  async function saveSettings(e: SubmitEvent) {
    e.preventDefault();
    if (!projectId) return;
    savingSettings = true;
    try {
      const extraFields = lines(scrubExtra);
      const safeFields = lines(scrubSafe);
      const scrubConfig =
        extraFields.length || safeFields.length || scrubIp
          ? { extraFields, safeFields, scrubIp }
          : null;
      await client.mutation(api.projects.updateProjectSettings, {
        projectId,
        eventRetentionDays: Number(retention),
        scrubPii: scrub,
        scrubConfig,
        monthlyEventQuota: quota === '' ? null : Number(quota),
        spikeThresholdPerMinute: spike === '' ? null : Number(spike),
      });
    } finally {
      savingSettings = false;
    }
  }

  // Inbound data filters (one glob pattern per line). Seeded once from the project.
  let filterErrors = $state('');
  let filterReleases = $state('');
  let filterEnvironments = $state('');
  let filterPaths = $state('');
  let filterBots = $state(false);
  let savingFilters = $state(false);
  let filtersSeeded = false;
  $effect(() => {
    const f = proj.data?.project?.ingestFilters;
    if (proj.data?.project && !filtersSeeded) {
      filtersSeeded = true;
      filterErrors = (f?.ignoreErrors ?? []).join('\n');
      filterReleases = (f?.ignoreReleases ?? []).join('\n');
      filterEnvironments = (f?.ignoreEnvironments ?? []).join('\n');
      filterPaths = (f?.ignorePaths ?? []).join('\n');
      filterBots = f?.filterBots ?? false;
    }
  });
  const lines = (s: string): string[] =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  async function saveFilters(e: SubmitEvent) {
    e.preventDefault();
    if (!projectId) return;
    savingFilters = true;
    try {
      const ignoreErrors = lines(filterErrors);
      const ignoreReleases = lines(filterReleases);
      const ignoreEnvironments = lines(filterEnvironments);
      const ignorePaths = lines(filterPaths);
      const empty =
        !ignoreErrors.length &&
        !ignoreReleases.length &&
        !ignoreEnvironments.length &&
        !ignorePaths.length &&
        !filterBots;
      await client.mutation(api.projects.updateProjectSettings, {
        projectId,
        // null clears all filters when nothing is configured.
        ingestFilters: empty
          ? null
          : { ignoreErrors, ignoreReleases, ignoreEnvironments, ignorePaths, filterBots },
      });
    } finally {
      savingFilters = false;
    }
  }

  // New metric alert form
  let maMetric = $state<'p95_latency' | 'error_count' | 'crash_free_rate'>('p95_latency');
  let maThreshold = $state(1000);
  let maTransaction = $state('');
  let maEnvironment = $state('');
  let maWindow = $state(60);
  let maChannelType = $state<
    'webhook' | 'discord' | 'slack' | 'email' | 'msteams' | 'pagerduty' | 'opsgenie'
  >('webhook');
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

  // New alert rule form
  let ruleName = $state('');
  let trigger = $state<'new_issue' | 'regression' | 'event_frequency'>('new_issue');
  let threshold = $state(10);
  let ruleEnvironment = $state('');
  let channelType = $state<
    'webhook' | 'discord' | 'slack' | 'email' | 'msteams' | 'pagerduty' | 'opsgenie'
  >('webhook');
  const CHANNEL_OPTIONS = [
    { value: 'webhook', label: 'Webhook' },
    { value: 'slack', label: 'Slack' },
    { value: 'discord', label: 'Discord' },
    { value: 'email', label: 'Email' },
    { value: 'msteams', label: 'MS Teams' },
    { value: 'pagerduty', label: 'PagerDuty (routing key)' },
    { value: 'opsgenie', label: 'Opsgenie (API key)' },
  ];
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
            <div class="space-y-1.5">
              <label class="text-xs text-muted-foreground" for={`origins-${key._id}`}>
                Allowed domains (one per line; blank = any). Restricts which sites this browser DSN
                may report from.
              </label>
              <textarea
                id={`origins-${key._id}`}
                bind:value={originDrafts[key._id]}
                rows="2"
                placeholder={'https://app.example.com\n*.example.com'}
                class="flex w-full rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              ></textarea>
              <Button
                size="sm"
                variant="outline"
                onclick={() => saveOrigins(key._id)}
                disabled={savingOrigins === key._id}
              >
                {savingOrigins === key._id ? 'Saving…' : 'Save domains'}
              </Button>
            </div>
          </div>
        {/each}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>Team</Card.Title>
        <Card.Description>The team that owns this project.</Card.Description>
      </Card.Header>
      <Card.Content>
        {#if teams.data && teams.data.length > 0}
          <select
            value={proj.data?.project?.teamId ?? ''}
            disabled={assigningTeam}
            onchange={(e) => assignTeam(e.currentTarget.value)}
            class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-72"
          >
            <option value="">No team (org-wide)</option>
            {#each teams.data as t (t.id)}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>
        {:else}
          <p class="text-sm text-muted-foreground">
            No teams yet. Create one on the <a href="/teams" class="text-primary hover:underline"
              >Teams</a
            > page.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>Issue tracker</Card.Title>
        <Card.Description>
          Create Jira or Linear tickets from issues. Credentials are stored on your instance and
          never shown again.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-3">
        <select
          bind:value={provider}
          class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-72"
        >
          <option value="">No integration</option>
          <option value="jira">Jira</option>
          <option value="linear">Linear</option>
        </select>

        {#if provider === 'jira'}
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label>Site URL</Label>
              <Input bind:value={jiraSite} placeholder="https://you.atlassian.net" />
            </div>
            <div class="space-y-1.5">
              <Label>Project key</Label>
              <Input bind:value={jiraProjectKey} placeholder="OPS" />
            </div>
            <div class="space-y-1.5">
              <Label>Account email</Label>
              <Input bind:value={jiraEmail} placeholder="you@company.com" />
            </div>
            <div class="space-y-1.5">
              <Label>Issue type</Label>
              <Input bind:value={jiraType} placeholder="Task" />
            </div>
            <div class="space-y-1.5 sm:col-span-2">
              <Label>API token</Label>
              <Input
                bind:value={secret}
                type="password"
                placeholder={integration.data ? 'Re-enter to save changes' : 'Atlassian API token'}
              />
            </div>
          </div>
        {:else if provider === 'linear'}
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label>Team ID (UUID)</Label>
              <Input bind:value={linearTeam} placeholder="9cfb482a-81e3-..." />
            </div>
            <div class="space-y-1.5">
              <Label>API key</Label>
              <Input
                bind:value={secret}
                type="password"
                placeholder={integration.data ? 'Re-enter to save changes' : 'Linear API key'}
              />
            </div>
          </div>
        {/if}

        {#if provider}
          <div class="flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={intEnabled} class="size-4" /> Enabled
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={intAuto} class="size-4" /> Auto-create on new issue
            </label>
          </div>
          <div class="flex gap-2">
            <Button onclick={saveIntegration} disabled={savingInt || !secret}>Save</Button>
            {#if integration.data}
              <Button variant="outline" onclick={removeIntegration}>Remove</Button>
            {/if}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>Limits and settings</Card.Title>
        <Card.Description>Retention, PII scrubbing, and ingest protection.</Card.Description>
      </Card.Header>
      <Card.Content>
        <form class="space-y-3" onsubmit={saveSettings}>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="retention">Event retention (days)</Label>
              <Input id="retention" type="number" min="1" bind:value={retention} />
            </div>
            <div class="space-y-1.5">
              <Label for="quota">Monthly event quota (blank = none)</Label>
              <Input id="quota" type="number" min="0" bind:value={quota} placeholder="unlimited" />
            </div>
            <div class="space-y-1.5">
              <Label for="spike">Spike protection (events/min, blank = off)</Label>
              <Input id="spike" type="number" min="0" bind:value={spike} placeholder="off" />
            </div>
            <label class="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" bind:checked={scrub} class="size-4" />
              Scrub PII at ingest
            </label>
          </div>
          {#if scrub}
            <div class="space-y-3 rounded-lg border border-dashed p-3">
              <p class="text-xs text-muted-foreground">
                Custom scrubbing, layered on the default rules (credit cards, SSNs, bearer tokens,
                and common secret-named fields). One field-name keyword per line; matching is a
                case-insensitive substring.
              </p>
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="space-y-1.5">
                  <Label for="scrubExtra">Also scrub fields named</Label>
                  <textarea
                    id="scrubExtra"
                    bind:value={scrubExtra}
                    rows="3"
                    placeholder={'phone\naddress'}
                    class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  ></textarea>
                </div>
                <div class="space-y-1.5">
                  <Label for="scrubSafe">Never scrub fields named</Label>
                  <textarea
                    id="scrubSafe"
                    bind:value={scrubSafe}
                    rows="3"
                    placeholder={'auth_method\nsession_count'}
                    class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  ></textarea>
                </div>
              </div>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" bind:checked={scrubIp} class="size-4" />
                Scrub IP addresses (user IP, REMOTE_ADDR, ...)
              </label>
            </div>
          {/if}
          <Button type="submit" size="sm" disabled={savingSettings}>Save settings</Button>
        </form>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>Inbound filters</Card.Title>
        <Card.Description>
          Drop matching error events at ingest, before they are stored, grouped, or counted against
          your quota. One glob pattern per line: <code class="font-mono">*</code> matches any text,
          <code class="font-mono">?</code> matches one character, and a pattern matches the whole
          field (wrap with <code class="font-mono">*</code> for a substring).
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <form class="space-y-3" onsubmit={saveFilters}>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="filterErrors">Error messages</Label>
              <textarea
                id="filterErrors"
                bind:value={filterErrors}
                rows="3"
                placeholder={'*ResizeObserver loop*\n*Non-Error promise rejection*'}
                class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              ></textarea>
            </div>
            <div class="space-y-1.5">
              <Label for="filterPaths">Stack-frame paths</Label>
              <textarea
                id="filterPaths"
                bind:value={filterPaths}
                rows="3"
                placeholder={'chrome-extension://*\nmoz-extension://*'}
                class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              ></textarea>
            </div>
            <div class="space-y-1.5">
              <Label for="filterReleases">Releases</Label>
              <textarea
                id="filterReleases"
                bind:value={filterReleases}
                rows="2"
                placeholder={'1.0.0-rc*'}
                class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              ></textarea>
            </div>
            <div class="space-y-1.5">
              <Label for="filterEnvironments">Environments</Label>
              <textarea
                id="filterEnvironments"
                bind:value={filterEnvironments}
                rows="2"
                placeholder={'local\ntest'}
                class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              ></textarea>
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={filterBots} class="size-4" />
            Filter known web crawlers and bots (by request user-agent)
          </label>
          <Button type="submit" size="sm" disabled={savingFilters}>Save filters</Button>
        </form>
      </Card.Content>
    </Card.Root>

    {#if usage.data}
      <Card.Root>
        <Card.Header class="flex-row items-center justify-between space-y-0">
          <Card.Title>Usage (last {usage.data.windowDays} days)</Card.Title>
          <div class="flex gap-1">
            {#each [7, 30, 90] as w (w)}
              <Button
                variant={usageWindow === w ? 'default' : 'outline'}
                size="sm"
                onclick={() => (usageWindow = w)}>{w}d</Button
              >
            {/each}
          </div>
        </Card.Header>
        <Card.Content>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div class="text-xs uppercase tracking-wide text-muted-foreground">Events</div>
              <div class="text-2xl font-bold tabular-nums">
                {usage.data.totals.events.toLocaleString()}
              </div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-muted-foreground">Transactions</div>
              <div class="text-2xl font-bold tabular-nums">
                {usage.data.totals.transactions.toLocaleString()}
              </div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-muted-foreground">Dropped</div>
              <div class="text-2xl font-bold tabular-nums text-muted-foreground">
                {usage.data.totals.dropped.toLocaleString()}
              </div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-muted-foreground">Filtered</div>
              <div class="text-2xl font-bold tabular-nums text-muted-foreground">
                {usage.data.totals.filtered.toLocaleString()}
              </div>
            </div>
          </div>

          <div class="mt-6">
            <div class="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              Events per day
            </div>
            {#if usageSeries.every((d) => d.events === 0)}
              <p class="py-4 text-sm text-muted-foreground">No events in this window yet.</p>
            {:else}
              <div class="flex h-32 items-end gap-px">
                {#each usageSeries as d (d.day)}
                  <div
                    class="flex-1"
                    title={`${dayLabel(d.day)} · ${d.events.toLocaleString()} events · ${d.transactions.toLocaleString()} txns · ${d.dropped.toLocaleString()} dropped · ${d.filtered.toLocaleString()} filtered`}
                  >
                    <div
                      class="rounded-t bg-primary/70 transition-colors hover:bg-primary"
                      style={`height:${d.events ? Math.max(2, (d.events / usageMax) * 100) : 0}%`}
                    ></div>
                  </div>
                {/each}
              </div>
              <div class="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>{dayLabel(usageSeries[0].day)}</span>
                <span>up to {usageMax.toLocaleString()} / day</span>
                <span>{dayLabel(usageSeries[usageSeries.length - 1].day)}</span>
              </div>
            {/if}
          </div>
        </Card.Content>
      </Card.Root>
    {/if}

    {#if deploys.data && deploys.data.length > 0}
      <Card.Root>
        <Card.Header><Card.Title>Deploys</Card.Title></Card.Header>
        <Card.Content class="px-0">
          <div class="divide-y border-t">
            {#each deploys.data as d (d._id)}
              <div class="flex items-center gap-3 px-6 py-2.5 text-sm">
                <Badge variant="muted" class="shrink-0">{d.environment}</Badge>
                <span class="min-w-0 flex-1 truncate font-mono text-xs">{d.release}</span>
                <span class="shrink-0 text-xs text-muted-foreground"
                  >{relativeTime(d.deployedAt)}</span
                >
              </div>
            {/each}
          </div>
        </Card.Content>
      </Card.Root>
    {/if}

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
              <Label for="maEnvironment">Environment (blank = all)</Label>
              <Input id="maEnvironment" bind:value={maEnvironment} placeholder="production" />
            </div>
            <div class="space-y-1.5">
              <Label for="maChannel">Channel</Label>
              <select
                id="maChannel"
                bind:value={maChannelType}
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {#each CHANNEL_OPTIONS as o (o.value)}
                  <option value={o.value}>{o.label}</option>
                {/each}
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
                {#if artifact.debugId}
                  <Badge
                    variant="outline"
                    class="shrink-0 font-mono"
                    title={`debug id ${artifact.debugId}`}>{artifact.debugId.slice(0, 8)}</Badge
                  >
                {/if}
                {#if artifact.storage === 's3'}
                  <Badge variant="outline" class="shrink-0" title="Offloaded to S3/R2">S3</Badge>
                {/if}
                <span class="shrink-0 font-mono text-xs text-muted-foreground"
                  >{artifact.release || 'no release'}</span
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
