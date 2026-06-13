<script lang="ts">
  import { authClient } from '$lib/auth-client';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';

  let { data } = $props();
  const activeOrg = authClient.useActiveOrganization();
</script>

<svelte:head><title>Settings · Sveltry</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <h1 class="text-2xl font-bold tracking-tight">Settings</h1>

  <Card.Root>
    <Card.Header><Card.Title>Account</Card.Title></Card.Header>
    <Card.Content class="space-y-2 text-sm">
      <div class="flex justify-between">
        <span class="text-muted-foreground">Name</span><span>{data.user.name}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-muted-foreground">Email</span><span>{data.user.email}</span>
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header><Card.Title>Organization</Card.Title></Card.Header>
    <Card.Content class="space-y-2 text-sm">
      <div class="flex justify-between">
        <span class="text-muted-foreground">Name</span><span
          >{$activeOrg.data?.name ?? 'Unknown'}</span
        >
      </div>
      <div class="flex justify-between">
        <span class="text-muted-foreground">ID</span>
        <span class="font-mono text-xs">{data.activeOrganizationId}</span>
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Session</Card.Title>
      <Card.Description>Sign out of this device.</Card.Description>
    </Card.Header>
    <Card.Content>
      <Button
        variant="outline"
        onclick={async () => {
          await authClient.signOut();
          location.href = '/login';
        }}
      >
        Sign out
      </Button>
    </Card.Content>
  </Card.Root>
</div>
