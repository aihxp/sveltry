<script lang="ts">
  import { useQuery, useConvexClient } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { toast, errorMessage } from '$lib/toast.svelte';
  import { confirm } from '$lib/confirm.svelte';

  let { projectId }: { projectId: Id<'projects'> } = $props();

  const client = useConvexClient();
  const integration = useQuery(api.integrations.getProjectIntegration, () => ({ projectId }));

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
    if (!provider || savingInt) return;
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
    const ok = await confirm({
      title: 'Remove issue-tracker integration?',
      description:
        'This deletes the stored credentials and stops creating tickets from issues. You can reconnect later.',
      confirmLabel: 'Remove integration',
    });
    if (!ok) return;
    try {
      await client.mutation(api.integrations.deleteIntegration, {
        integrationId: integration.data.id,
      });
      intSeeded = false;
      provider = '';
      toast.success('Integration removed');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not remove the integration'));
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Issue tracker</Card.Title>
    <Card.Description>
      Create Jira or Linear tickets from issues. Credentials are stored on your instance and never
      shown again.
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
