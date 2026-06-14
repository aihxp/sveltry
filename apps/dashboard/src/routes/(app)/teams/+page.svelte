<script lang="ts">
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import type { Id } from '$convex/_generated/dataModel';
  import { authClient } from '$lib/auth-client';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import UsersIcon from '@lucide/svelte/icons/users';
  import XIcon from '@lucide/svelte/icons/x';
  import BoxIcon from '@lucide/svelte/icons/box';

  const auth = useAuth();
  const client = useConvexClient();
  const activeOrg = authClient.useActiveOrganization();

  const teams = useQuery(api.teams.listTeams, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );

  type OrgMember = { userId: string; user?: { email?: string; name?: string } };
  const orgMembers = $derived(($activeOrg.data?.members ?? []) as OrgMember[]);

  let newTeam = $state('');
  let creating = $state(false);
  async function createTeam() {
    const name = newTeam.trim();
    if (!name || creating) return;
    creating = true;
    try {
      await client.mutation(api.teams.createTeam, { name });
      newTeam = '';
    } finally {
      creating = false;
    }
  }

  // Per-team picker state: maps team id -> selected member userId.
  let pick = $state<Record<string, string>>({});
  async function addMember(teamId: Id<'teams'>) {
    const userId = pick[teamId];
    if (!userId) return;
    const m = orgMembers.find((x) => x.userId === userId);
    await client.mutation(api.teams.addTeamMember, {
      teamId,
      userId,
      email: m?.user?.email,
      name: m?.user?.name,
    });
    pick[teamId] = '';
  }
  async function removeMember(memberId: Id<'teamMembers'>) {
    await client.mutation(api.teams.removeTeamMember, { memberId });
  }
  async function deleteTeam(teamId: Id<'teams'>) {
    await client.mutation(api.teams.deleteTeam, { teamId });
  }
</script>

<svelte:head><title>Teams · Sveltry</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">Teams</h1>
    <p class="text-sm text-muted-foreground">
      Group members and assign projects to teams. Projects can be assigned to a team from the
      project page.
    </p>
  </div>

  <Card.Root>
    <Card.Header><Card.Title>Create a team</Card.Title></Card.Header>
    <Card.Content>
      <form class="flex gap-2" onsubmit={(e) => (e.preventDefault(), createTeam())}>
        <Input bind:value={newTeam} placeholder="Team name, e.g. Platform" disabled={creating} />
        <Button type="submit" disabled={creating || !newTeam.trim()}>Create</Button>
      </form>
    </Card.Content>
  </Card.Root>

  {#if auth.isLoading || teams.isLoading}
    <div class="space-y-3">
      {#each Array(2) as _, i (i)}<Skeleton class="h-28 w-full" />{/each}
    </div>
  {:else if !teams.data || teams.data.length === 0}
    <EmptyState title="No teams yet" description="Create a team to group members and projects." />
  {:else}
    {#each teams.data as team (team.id)}
      {@const onTeam = new Set(team.members.map((m) => m.userId))}
      <Card.Root>
        <Card.Header class="flex-row items-center justify-between space-y-0">
          <Card.Title class="flex items-center gap-2">
            <UsersIcon class="size-4" />
            {team.name}
            <span class="font-mono text-xs font-normal text-muted-foreground">#{team.slug}</span>
          </Card.Title>
          <Button variant="ghost" size="sm" onclick={() => deleteTeam(team.id)}>Delete</Button>
        </Card.Header>
        <Card.Content class="space-y-4">
          <div>
            <p class="mb-1.5 text-xs font-medium text-muted-foreground">Members</p>
            {#if team.members.length === 0}
              <p class="text-sm text-muted-foreground">No members yet.</p>
            {:else}
              <div class="flex flex-wrap gap-2">
                {#each team.members as m (m.id)}
                  <span
                    class="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pl-2.5 pr-1 text-xs"
                  >
                    {m.email ?? m.name ?? m.userId}
                    <button
                      class="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Remove member"
                      onclick={() => removeMember(m.id)}
                    >
                      <XIcon class="size-3" />
                    </button>
                  </span>
                {/each}
              </div>
            {/if}
            {#if orgMembers.some((m) => !onTeam.has(m.userId))}
              <div class="mt-2 flex gap-2">
                <select
                  bind:value={pick[team.id]}
                  class="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Add a member…</option>
                  {#each orgMembers.filter((m) => !onTeam.has(m.userId)) as m (m.userId)}
                    <option value={m.userId}>{m.user?.email ?? m.user?.name ?? m.userId}</option>
                  {/each}
                </select>
                <Button
                  variant="outline"
                  disabled={!pick[team.id]}
                  onclick={() => addMember(team.id)}
                >
                  Add
                </Button>
              </div>
            {/if}
          </div>

          <div>
            <p class="mb-1.5 text-xs font-medium text-muted-foreground">Projects</p>
            {#if team.projects.length === 0}
              <p class="text-sm text-muted-foreground">No projects assigned.</p>
            {:else}
              <div class="flex flex-wrap gap-2">
                {#each team.projects as p (p.id)}
                  <Badge variant="muted" class="gap-1">
                    <BoxIcon class="size-3" />
                    <a href={`/projects/${p.slug}`} class="hover:underline">{p.name}</a>
                  </Badge>
                {/each}
              </div>
            {/if}
          </div>
        </Card.Content>
      </Card.Root>
    {/each}
  {/if}
</div>
