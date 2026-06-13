<script lang="ts">
  import { goto } from '$app/navigation';
  import { authClient } from '$lib/auth-client';
  import AuthShell from '$lib/components/AuthShell.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let name = $state('');
  let error = $state('');
  let loading = $state(false);

  function toSlug(s: string): string {
    return (
      s
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || `org-${Math.floor(Math.random() * 100000)}`
    );
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';
    const slug = toSlug(name) + '-' + Math.floor(Math.random() * 9000 + 1000);
    const { data, error: err } = await authClient.organization.create({ name, slug });
    if (err || !data) {
      loading = false;
      error = err?.message ?? 'Could not create organization';
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    await goto('/dashboard');
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
