<script lang="ts">
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import { authClient } from '$lib/auth-client';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';

  let { data } = $props();
  const auth = useAuth();
  const client = useConvexClient();
  const activeOrg = authClient.useActiveOrganization();

  const roleData = useQuery(api.roles.listMemberRoles, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

  // Persist the bootstrap owner once, so the org has a recorded owner.
  let bootstrapped = false;
  $effect(() => {
    if (auth.isAuthenticated && roleData.data && !roleData.data.bootstrapped && !bootstrapped) {
      bootstrapped = true;
      void client.mutation(api.roles.ensureBootstrapOwner, {});
    }
  });

  const ROLES = ['owner', 'admin', 'member', 'billing'] as const;
  type Role = (typeof ROLES)[number];

  type OrgMember = { userId: string; user?: { email?: string; name?: string } };
  const orgMembers = $derived(($activeOrg.data?.members ?? []) as OrgMember[]);
  const callerRole = $derived(roleData.data?.callerRole ?? 'member');
  const canManage = $derived(callerRole === 'owner' || callerRole === 'admin');

  // userId -> assigned role (falls back to default for unassigned members).
  const roleByUser = $derived(
    new Map((roleData.data?.roles ?? []).map((r) => [r.userId, r.role as Role])),
  );
  function effectiveRole(userId: string): Role {
    return roleByUser.get(userId) ?? (roleData.data?.roles?.length ? 'member' : 'owner');
  }

  async function setRole(m: OrgMember, role: Role) {
    await client.mutation(api.roles.setMemberRole, {
      userId: m.userId,
      role,
      email: m.user?.email,
      name: m.user?.name,
    });
  }

  const roleBadge: Record<Role, 'success' | 'default' | 'muted' | 'outline'> = {
    owner: 'success',
    admin: 'default',
    member: 'muted',
    billing: 'outline',
  };
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
      <div class="flex justify-between">
        <span class="text-muted-foreground">Your role</span>
        <Badge variant={roleBadge[callerRole as Role]}>{callerRole}</Badge>
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Members and roles</Card.Title>
      <Card.Description>
        owner &gt; admin can manage projects, teams, and alerts; member can triage issues; billing
        is read-only.{!canManage ? ' Only an owner or admin can change roles.' : ''}
      </Card.Description>
    </Card.Header>
    <Card.Content class="space-y-2">
      {#if orgMembers.length === 0}
        <p class="text-sm text-muted-foreground">No members found.</p>
      {:else}
        {#each orgMembers as m (m.userId)}
          {@const role = effectiveRole(m.userId)}
          <div class="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
            <span class="min-w-0 flex-1 truncate">
              {m.user?.email ?? m.user?.name ?? m.userId}
              {#if m.userId === roleData.data?.callerUserId}
                <span class="text-xs text-muted-foreground">(you)</span>
              {/if}
            </span>
            {#if canManage}
              <select
                value={role}
                onchange={(e) => setRole(m, e.currentTarget.value as Role)}
                class="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {#each ROLES as r (r)}
                  <option value={r} disabled={r === 'owner' && callerRole !== 'owner'}>{r}</option>
                {/each}
              </select>
            {:else}
              <Badge variant={roleBadge[role]}>{role}</Badge>
            {/if}
          </div>
        {/each}
      {/if}
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
