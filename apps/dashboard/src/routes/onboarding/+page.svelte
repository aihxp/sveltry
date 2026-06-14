<script lang="ts">
  import { goto } from '$app/navigation';
  import { useConvexClient } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import AuthShell from '$lib/components/AuthShell.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  const client = useConvexClient();
  let name = $state('');
  let error = $state('');
  let loading = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';
    try {
      // Creates the org, makes the caller its owner, and sets it active (all in Convex).
      await client.mutation(api.organizations.createOrganization, { name });
      await goto('/dashboard');
    } catch (err) {
      loading = false;
      error = err instanceof Error ? err.message : 'Could not create organization';
    }
  }
</script>

<svelte:head><title>Create organization · Sveltry</title></svelte:head>

<AuthShell
  title="Create your organization"
  subtitle="Projects and issues live inside an organization."
>
  <form class="space-y-4" onsubmit={submit}>
    <div class="space-y-1.5">
      <Label for="orgname">Organization name</Label>
      <Input id="orgname" bind:value={name} required placeholder="Acme Inc." />
    </div>
    {#if error}<p class="text-sm text-destructive">{error}</p>{/if}
    <Button type="submit" class="w-full" disabled={loading}>
      {loading ? 'Creating…' : 'Create organization'}
    </Button>
  </form>
</AuthShell>
