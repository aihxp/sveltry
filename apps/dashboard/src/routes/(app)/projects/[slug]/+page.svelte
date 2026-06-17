<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import { env } from '$env/dynamic/public';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import { selectClass, textareaClass } from '$lib/components/ui/control-classes';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import { toast, errorMessage } from '$lib/toast.svelte';
  import { confirm } from '$lib/confirm.svelte';
  import { buildDsn } from '$lib/utils';
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  // Each feature section is its own focused component; this page composes them
  // and owns only the cohesive project-configuration + danger-zone sections.
  import IntegrationCard from '$lib/components/project/IntegrationCard.svelte';
  import UsageCard from '$lib/components/project/UsageCard.svelte';
  import DeploysCard from '$lib/components/project/DeploysCard.svelte';
  import AlertRulesCard from '$lib/components/project/AlertRulesCard.svelte';
  import WebhooksCard from '$lib/components/project/WebhooksCard.svelte';
  import MetricAlertsCard from '$lib/components/project/MetricAlertsCard.svelte';
  import UsageAlertsCard from '$lib/components/project/UsageAlertsCard.svelte';
  import NotificationDeliveriesCard from '$lib/components/project/NotificationDeliveriesCard.svelte';
  import SourceMapsCard from '$lib/components/project/SourceMapsCard.svelte';

  const auth = useAuth();
  const client = useConvexClient();
  const slug = $derived(page.params.slug);
  const ingestUrl = env.PUBLIC_SVELTRY_INGEST_URL ?? 'http://127.0.0.1:3211';

  const proj = useQuery(api.projects.getProjectBySlug, () =>
    auth.isAuthenticated && slug ? { slug } : ('skip' as const),
  );
  const projectId = $derived(proj.data?.project?._id as Id<'projects'> | undefined);

  const teams = useQuery(api.teams.listTeams, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

  const lines = (s: string): string[] =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

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
      const allowedOrigins = lines(originDrafts[keyId] ?? '');
      await client.mutation(api.projects.setKeyAllowedOrigins, { keyId, allowedOrigins });
      toast.success('Allowed domains saved');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save allowed domains'));
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
      toast.success('Project team updated');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the team'));
    } finally {
      assigningTeam = false;
    }
  }

  // Project limits/settings (seeded once from the loaded project)
  let projectName = $state('');
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
      projectName = p.name;
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
        name: projectName.trim() || undefined,
        eventRetentionDays: Number(retention),
        scrubPii: scrub,
        scrubConfig,
        monthlyEventQuota: quota === '' ? null : Number(quota),
        spikeThresholdPerMinute: spike === '' ? null : Number(spike),
      });
      toast.success('Settings saved');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save settings'));
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
      toast.success('Inbound filters saved');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save filters'));
    } finally {
      savingFilters = false;
    }
  }

  // Source repository for "open in repo" stack-frame links. Seeded once from the project.
  let repoProvider = $state<'' | 'github' | 'gitlab' | 'bitbucket'>('');
  let repoBaseUrl = $state('');
  let repoDefaultBranch = $state('');
  let repoSourceRoot = $state('');
  let savingRepo = $state(false);
  let repoError = $state('');
  let repoSeeded = false;
  $effect(() => {
    const r = proj.data?.project?.repoConfig;
    if (proj.data?.project && !repoSeeded) {
      repoSeeded = true;
      repoProvider = r?.provider ?? '';
      repoBaseUrl = r?.baseUrl ?? '';
      repoDefaultBranch = r?.defaultBranch ?? '';
      repoSourceRoot = r?.sourceRoot ?? '';
    }
  });
  async function saveRepo(e: SubmitEvent) {
    e.preventDefault();
    if (!projectId) return;
    repoError = '';
    if (repoProvider) {
      let ok = false;
      try {
        ok = new URL(repoBaseUrl.trim()).protocol === 'https:';
      } catch {
        ok = false;
      }
      if (!ok) {
        repoError = 'Repository URL must be a valid https URL.';
        return;
      }
    }
    savingRepo = true;
    try {
      const repoConfig = repoProvider
        ? {
            provider: repoProvider,
            baseUrl: repoBaseUrl.trim().replace(/\/+$/, ''),
            defaultBranch: repoDefaultBranch.trim() || 'main',
            sourceRoot: repoSourceRoot.trim() || undefined,
          }
        : null;
      await client.mutation(api.projects.updateProjectSettings, { projectId, repoConfig });
      toast.success('Repository saved');
    } catch (err) {
      repoError = err instanceof Error ? err.message : 'Failed to save repository config.';
    } finally {
      savingRepo = false;
    }
  }
  async function removeRepo() {
    if (!projectId) return;
    const ok = await confirm({
      title: 'Remove repository link?',
      description:
        'Stack frames will no longer show an "open in repo" link. You can re-add the repository later.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    repoError = '';
    savingRepo = true;
    try {
      await client.mutation(api.projects.updateProjectSettings, { projectId, repoConfig: null });
      // Clear the fields only after the clear actually persisted, so a failure
      // never leaves the form contradicting the still-saved config.
      repoProvider = '';
      repoBaseUrl = '';
      repoDefaultBranch = '';
      repoSourceRoot = '';
      toast.success('Repository removed');
    } catch (err) {
      repoError = err instanceof Error ? err.message : 'Failed to remove repository config.';
    } finally {
      savingRepo = false;
    }
  }

  // Delete project (danger zone): requires typing the exact project name.
  let deleteConfirm = $state('');
  let deleting = $state(false);
  let deleteError = $state('');
  const deleteArmed = $derived(
    !!proj.data?.project && deleteConfirm.trim() === proj.data.project.name,
  );
  async function deleteProject() {
    if (!projectId || !deleteArmed) return;
    deleting = true;
    deleteError = '';
    try {
      await client.mutation(api.projectLifecycle.deleteProject, {
        projectId,
        confirmName: deleteConfirm.trim(),
      });
      await goto('/projects');
    } catch (err) {
      deleting = false;
      deleteError = err instanceof Error ? err.message : 'Could not delete the project';
    }
  }

  // Transfer project (danger zone): move it (and all its data) to another org the
  // caller administers. The picker lists the caller's admin/owner orgs except the
  // current (active) one.
  const myOrgs = useQuery(api.organizations.listMyOrganizations, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
  const transferOrgs = $derived(
    (myOrgs.data ?? []).filter((o) => !o.isActive && (o.role === 'admin' || o.role === 'owner')),
  );
  let transferTarget = $state('');
  let transferConfirm = $state('');
  let transferring = $state(false);
  let transferError = $state('');
  const transferArmed = $derived(
    !!proj.data?.project && !!transferTarget && transferConfirm.trim() === proj.data.project.name,
  );
  async function transferProject() {
    if (!projectId || !transferArmed) return;
    transferring = true;
    transferError = '';
    try {
      await client.mutation(api.projectLifecycle.transferProject, {
        projectId,
        targetOrganizationId: transferTarget,
        confirmName: transferConfirm.trim(),
      });
    } catch (err) {
      transferring = false;
      transferError = err instanceof Error ? err.message : 'Could not transfer the project';
      return;
    }
    // The transfer committed; the project has left this org (and its slug may have
    // changed in the target), so leave the now-stale project view. Navigation runs
    // outside the try so a navigation hiccup never reads as a transfer failure.
    await goto('/projects');
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
      <Button variant="outline" href="/issues">View issues</Button>
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
            value={project.teamId ?? ''}
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

    <IntegrationCard projectId={project._id} />

    <Card.Root>
      <Card.Header>
        <Card.Title>Limits and settings</Card.Title>
        <Card.Description>Retention, PII scrubbing, and ingest protection.</Card.Description>
      </Card.Header>
      <Card.Content>
        <form class="space-y-3" onsubmit={saveSettings}>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5 sm:col-span-2">
              <Label for="projectName">Project name</Label>
              <Input id="projectName" bind:value={projectName} placeholder="Web App" />
            </div>
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
                    class={textareaClass}
                  ></textarea>
                </div>
                <div class="space-y-1.5">
                  <Label for="scrubSafe">Never scrub fields named</Label>
                  <textarea
                    id="scrubSafe"
                    bind:value={scrubSafe}
                    rows="3"
                    placeholder={'auth_method\nsession_count'}
                    class={textareaClass}
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
                class={textareaClass}
              ></textarea>
            </div>
            <div class="space-y-1.5">
              <Label for="filterPaths">Stack-frame paths</Label>
              <textarea
                id="filterPaths"
                bind:value={filterPaths}
                rows="3"
                placeholder={'chrome-extension://*\nmoz-extension://*'}
                class={textareaClass}
              ></textarea>
            </div>
            <div class="space-y-1.5">
              <Label for="filterReleases">Releases</Label>
              <textarea
                id="filterReleases"
                bind:value={filterReleases}
                rows="2"
                placeholder="1.0.0-rc*"
                class={textareaClass}
              ></textarea>
            </div>
            <div class="space-y-1.5">
              <Label for="filterEnvironments">Environments</Label>
              <textarea
                id="filterEnvironments"
                bind:value={filterEnvironments}
                rows="2"
                placeholder={'local\ntest'}
                class={textareaClass}
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

    <UsageCard projectId={project._id} />
    <DeploysCard projectId={project._id} />
    <AlertRulesCard projectId={project._id} />
    <WebhooksCard projectId={project._id} />
    <MetricAlertsCard projectId={project._id} />
    <UsageAlertsCard projectId={project._id} hasQuota={!!project.monthlyEventQuota} />
    <NotificationDeliveriesCard />
    <SourceMapsCard projectId={project._id} />

    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2">
          <GitBranchIcon class="size-4" />
          Repository
        </Card.Title>
        <Card.Description>
          Link this project to its source repo so in-app stack frames get an "open in repo" link.
          Sveltry only builds the URL; it never calls your provider.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <form class="space-y-3" onsubmit={saveRepo}>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="repoProvider">Provider</Label>
              <select id="repoProvider" bind:value={repoProvider} class={selectClass}>
                <option value="">None</option>
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
                <option value="bitbucket">Bitbucket</option>
              </select>
            </div>
            <div class="space-y-1.5">
              <Label for="repoDefaultBranch">Default branch</Label>
              <Input id="repoDefaultBranch" bind:value={repoDefaultBranch} placeholder="main" />
            </div>
            <div class="space-y-1.5 sm:col-span-2">
              <Label for="repoBaseUrl">Repository URL</Label>
              <Input
                id="repoBaseUrl"
                type="url"
                bind:value={repoBaseUrl}
                placeholder="https://github.com/acme/web"
              />
            </div>
            <div class="space-y-1.5 sm:col-span-2">
              <Label for="repoSourceRoot">Source-root prefix (optional)</Label>
              <Input id="repoSourceRoot" bind:value={repoSourceRoot} placeholder="apps/web/" />
            </div>
          </div>
          {#if repoError}<p class="text-sm text-destructive">{repoError}</p>{/if}
          <div class="flex gap-2">
            <Button type="submit" size="sm" disabled={savingRepo}>
              {savingRepo ? 'Saving…' : 'Save repository'}
            </Button>
            {#if project.repoConfig}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={savingRepo}
                onclick={removeRepo}>Remove</Button
              >
            {/if}
          </div>
        </form>
      </Card.Content>
    </Card.Root>

    <Card.Root class="border-destructive/40">
      <Card.Header>
        <Card.Title class="text-destructive">Transfer project</Card.Title>
        <Card.Description>
          Move <span class="font-medium">{project.name}</span> and all of its data to another organization
          you administer. The project leaves this organization immediately; re-stamping its data runs
          in the background. Type the project name to confirm.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-3">
        {#if transferOrgs.length === 0}
          <p class="text-sm text-muted-foreground">
            You do not administer another organization to transfer this project to.
          </p>
        {:else}
          <div class="space-y-1.5">
            <Label for="transferTarget">Destination organization</Label>
            <select
              id="transferTarget"
              bind:value={transferTarget}
              class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-72"
            >
              <option value="" disabled>Select an organization…</option>
              {#each transferOrgs as o (o.id)}
                <option value={o.id}>{o.name}</option>
              {/each}
            </select>
          </div>
          <Input
            bind:value={transferConfirm}
            placeholder={project.name}
            aria-label="Confirm project name to transfer"
          />
          {#if transferError}<p class="text-sm text-destructive">{transferError}</p>{/if}
          <Button
            variant="destructive"
            size="sm"
            disabled={!transferArmed || transferring}
            onclick={transferProject}
          >
            {transferring ? 'Transferring…' : 'Transfer this project'}
          </Button>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root class="border-destructive/40">
      <Card.Header>
        <Card.Title class="text-destructive">Delete project</Card.Title>
        <Card.Description>
          Permanently deletes <span class="font-medium">{project.name}</span> and all of its issues, events,
          and history. This cannot be undone. Type the project name to confirm.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-3">
        <Input
          bind:value={deleteConfirm}
          placeholder={project.name}
          aria-label="Confirm project name"
        />
        {#if deleteError}<p class="text-sm text-destructive">{deleteError}</p>{/if}
        <Button
          variant="destructive"
          size="sm"
          disabled={!deleteArmed || deleting}
          onclick={deleteProject}
        >
          {deleting ? 'Deleting…' : 'Delete this project'}
        </Button>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
