<script lang="ts">
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import { env } from '$env/dynamic/public';
  import { authClient } from '$lib/auth-client';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { relativeTime } from '$lib/utils';

  const auth = useAuth();
  const client = useConvexClient();
  const session = authClient.useSession();
  const user = $derived($session.data?.user);
  const activeOrg = useQuery(api.organizations.activeOrg, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

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
  const orgMembers = $derived(
    (roleData.data?.roles ?? []).map(
      (r): OrgMember => ({
        userId: r.userId,
        user: { email: r.email ?? undefined, name: r.name ?? undefined },
      }),
    ),
  );
  const callerRole = $derived(roleData.data?.callerRole ?? 'member');
  const canManage = $derived(callerRole === 'owner' || callerRole === 'admin');

  // Member invitations (admin/owner only).
  const invitations = useQuery(api.invitations.listInvitations, () =>
    auth.isAuthenticated && canManage ? {} : ('skip' as const),
  );
  const appUrl = $derived((env.PUBLIC_APP_URL ?? '').replace(/\/$/, ''));
  const inviteLink = (token: string) => `${appUrl}/invite/${token}`;
  let inviteEmail = $state('');
  let inviteRole = $state<Role>('member');
  let inviting = $state(false);
  let inviteError = $state('');
  let inviteNotice = $state('');

  async function sendInvite(e: SubmitEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviting = true;
    inviteError = '';
    inviteNotice = '';
    try {
      const res = await client.mutation(api.invitations.createInvitation, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      inviteNotice = res.emailSent
        ? `Invitation emailed to ${inviteEmail.trim()}.`
        : `Invitation created. SMTP is not configured, so copy the link below to share it.`;
      inviteEmail = '';
    } catch (err) {
      inviteError = err instanceof Error ? err.message : 'Could not send invitation';
    } finally {
      inviting = false;
    }
  }

  async function revokeInvite(id: Id<'invitations'>) {
    await client.mutation(api.invitations.revokeInvitation, { invitationId: id });
  }

  // API tokens (admin/owner only).
  const apiTokens = useQuery(api.apiTokens.listApiTokens, () =>
    auth.isAuthenticated && canManage ? {} : ('skip' as const),
  );
  let tokenName = $state('');
  let tokenScope = $state<'read' | 'write'>('read');
  let creatingToken = $state(false);
  let tokenError = $state('');
  let newToken = $state(''); // the raw token, shown once after creation

  async function createToken(e: SubmitEvent) {
    e.preventDefault();
    if (!tokenName.trim()) return;
    creatingToken = true;
    tokenError = '';
    newToken = '';
    try {
      const res = await client.mutation(api.apiTokens.createApiToken, {
        name: tokenName.trim(),
        scope: tokenScope,
      });
      newToken = res.token;
      tokenName = '';
    } catch (err) {
      tokenError = err instanceof Error ? err.message : 'Could not create token';
    } finally {
      creatingToken = false;
    }
  }

  async function revokeToken(id: Id<'apiTokens'>) {
    await client.mutation(api.apiTokens.revokeApiToken, { tokenId: id });
  }

  // Audit log (admin/owner only).
  const auditLog = useQuery(api.audit.listAuditLog, () =>
    auth.isAuthenticated && canManage ? { limit: 50 } : ('skip' as const),
  );
  // `domain.verb` -> "verb domain" for a readable label.
  function auditLabel(action: string): string {
    const [domain, verb] = action.split('.');
    return verb ? `${verb} ${domain}` : action;
  }

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
        <span class="text-muted-foreground">Name</span><span>{user?.name ?? ''}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-muted-foreground">Email</span><span>{user?.email ?? ''}</span>
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header><Card.Title>Organization</Card.Title></Card.Header>
    <Card.Content class="space-y-2 text-sm">
      <div class="flex justify-between">
        <span class="text-muted-foreground">Name</span><span
          >{activeOrg.data?.name ?? 'Unknown'}</span
        >
      </div>
      <div class="flex justify-between">
        <span class="text-muted-foreground">ID</span>
        <span class="font-mono text-xs">{activeOrg.data?.id ?? ''}</span>
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

  {#if canManage}
    <Card.Root>
      <Card.Header>
        <Card.Title>Invite members</Card.Title>
        <Card.Description>
          Invite teammates by email. They join this organization at the chosen role after accepting.
          The invite is emailed when SMTP is configured; otherwise share the generated link.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        <form class="flex flex-col gap-2 sm:flex-row sm:items-end" onsubmit={sendInvite}>
          <div class="flex-1 space-y-1.5">
            <Label for="inviteEmail">Email</Label>
            <Input
              id="inviteEmail"
              type="email"
              bind:value={inviteEmail}
              required
              placeholder="teammate@company.com"
            />
          </div>
          <div class="space-y-1.5">
            <Label for="inviteRole">Role</Label>
            <select
              id="inviteRole"
              bind:value={inviteRole}
              class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-36"
            >
              {#each ROLES as r (r)}
                <option value={r} disabled={r === 'owner' && callerRole !== 'owner'}>{r}</option>
              {/each}
            </select>
          </div>
          <Button type="submit" disabled={inviting}>{inviting ? 'Sending…' : 'Send invite'}</Button>
        </form>
        {#if inviteError}<p class="text-sm text-destructive">{inviteError}</p>{/if}
        {#if inviteNotice}<p class="text-sm text-muted-foreground">{inviteNotice}</p>{/if}

        {#if invitations.data && invitations.data.length > 0}
          <div class="space-y-2">
            <div class="text-xs uppercase tracking-wide text-muted-foreground">
              Pending invitations
            </div>
            {#each invitations.data as inv (inv.id)}
              <div class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <span class="min-w-0 flex-1 truncate">{inv.email}</span>
                <Badge variant="muted">{inv.role}</Badge>
                <CopyButton text={inviteLink(inv.token)} />
                <Button
                  variant="ghost"
                  size="icon"
                  onclick={() => revokeInvite(inv.id)}
                  aria-label="Revoke invitation"
                >
                  <TrashIcon class="size-4 text-destructive" />
                </Button>
              </div>
            {/each}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if canManage}
    <Card.Root>
      <Card.Header>
        <Card.Title>API tokens</Card.Title>
        <Card.Description>
          Read-only tokens for the public API (<code class="font-mono">GET /api/v1/...</code>). Send
          as <code class="font-mono">Authorization: Bearer &lt;token&gt;</code>. A token grants read
          access to this organization and is shown only once.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        <form class="flex flex-col gap-2 sm:flex-row sm:items-end" onsubmit={createToken}>
          <div class="flex-1 space-y-1.5">
            <Label for="tokenName">Name</Label>
            <Input id="tokenName" bind:value={tokenName} required placeholder="CI pipeline" />
          </div>
          <div class="space-y-1.5">
            <Label for="tokenScope">Access</Label>
            <select
              id="tokenScope"
              bind:value={tokenScope}
              class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-36"
            >
              <option value="read">Read only</option>
              <option value="write">Read &amp; write</option>
            </select>
          </div>
          <Button type="submit" disabled={creatingToken}>
            {creatingToken ? 'Creating…' : 'Create token'}
          </Button>
        </form>
        {#if tokenError}<p class="text-sm text-destructive">{tokenError}</p>{/if}
        {#if newToken}
          <div class="space-y-1.5 rounded-lg border border-dashed p-3">
            <p class="text-xs text-muted-foreground">
              Copy this token now. You will not be able to see it again.
            </p>
            <div class="flex items-center gap-2">
              <code
                class="min-w-0 flex-1 truncate rounded bg-muted/40 px-2 py-1.5 font-mono text-xs"
                >{newToken}</code
              >
              <CopyButton text={newToken} />
            </div>
          </div>
        {/if}

        {#if apiTokens.data && apiTokens.data.length > 0}
          <div class="space-y-2">
            {#each apiTokens.data as t (t.id)}
              <div class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <span class="min-w-0 flex-1 truncate">
                  {t.name}
                  <code class="ml-1 font-mono text-xs text-muted-foreground">{t.prefix}…</code>
                </span>
                <Badge variant={t.scope === 'write' ? 'default' : 'muted'} class="shrink-0">
                  {t.scope === 'write' ? 'read/write' : 'read'}
                </Badge>
                <span class="shrink-0 text-xs text-muted-foreground">
                  {t.lastUsedAt ? 'used' : 'never used'}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onclick={() => revokeToken(t.id)}
                  aria-label="Revoke token"
                >
                  <TrashIcon class="size-4 text-destructive" />
                </Button>
              </div>
            {/each}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if canManage}
    <Card.Root>
      <Card.Header>
        <Card.Title>Audit log</Card.Title>
        <Card.Description>
          Recent configuration and access changes in this organization.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {#if auditLog.data && auditLog.data.length > 0}
          <div class="divide-y rounded-lg border text-sm">
            {#each auditLog.data as e (e.id)}
              <div class="flex items-center gap-3 px-3 py-2">
                <span class="shrink-0 font-medium">{auditLabel(e.action)}</span>
                {#if e.target}
                  <span class="min-w-0 flex-1 truncate text-muted-foreground">{e.target}</span>
                {:else}
                  <span class="flex-1"></span>
                {/if}
                <span class="shrink-0 truncate text-xs text-muted-foreground"
                  >{e.actorEmail ?? 'unknown'}</span
                >
                <span class="shrink-0 text-xs text-muted-foreground"
                  >{relativeTime(e.createdAt)}</span
                >
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">No activity recorded yet.</p>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

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
