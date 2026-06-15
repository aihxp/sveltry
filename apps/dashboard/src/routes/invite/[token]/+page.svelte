<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { useQuery, useConvexClient, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import { authClient } from '$lib/auth-client';
  import AuthShell from '$lib/components/AuthShell.svelte';
  import { Button } from '$lib/components/ui/button';

  const auth = useAuth();
  const client = useConvexClient();
  const session = authClient.useSession();
  const token = $derived(page.params.token ?? '');

  const invite = useQuery(api.invitations.getInvitation, () =>
    token ? { token } : ('skip' as const),
  );

  // Match the backend's normalization (trim + lowercase) so the gate agrees with it.
  const norm = (e?: string) => e?.trim().toLowerCase();
  const myEmail = $derived(norm($session.data?.user?.email));
  const inviteEmail = $derived(norm(invite.data?.email));
  const emailMatches = $derived(!!myEmail && !!inviteEmail && myEmail === inviteEmail);

  let accepting = $state(false);
  let error = $state('');

  async function accept() {
    accepting = true;
    error = '';
    try {
      await client.mutation(api.invitations.acceptInvitation, { token });
      await goto('/dashboard');
    } catch (err) {
      accepting = false;
      error = err instanceof Error ? err.message : 'Could not accept the invitation';
    }
  }

  async function switchAccount() {
    await authClient.signOut();
    location.href = `/login?redirectTo=/invite/${token}`;
  }

  const loginHref = $derived(`/login?redirectTo=${encodeURIComponent(`/invite/${token}`)}`);
  const signupHref = $derived(`/signup?redirectTo=${encodeURIComponent(`/invite/${token}`)}`);
</script>

<svelte:head><title>Accept invitation · Sveltry</title></svelte:head>

<AuthShell title="Join organization" subtitle="You've been invited to a Sveltry organization.">
  {#if invite.isLoading}
    <p class="text-sm text-muted-foreground">Loading invitation…</p>
  {:else if !invite.data || invite.data.status === 'not_found'}
    <p class="text-sm text-destructive">This invitation link is not valid.</p>
  {:else if invite.data.status === 'expired'}
    <p class="text-sm text-destructive">This invitation has expired. Ask an admin to re-send it.</p>
  {:else if invite.data.status === 'accepted'}
    <p class="text-sm text-muted-foreground">This invitation has already been accepted.</p>
    <a href="/login" class="mt-3 inline-block text-sm text-primary hover:underline">Sign in</a>
  {:else}
    <div class="space-y-4">
      <p class="text-sm">
        You're invited to join <span class="font-medium">{invite.data.organizationName}</span>
        as <span class="font-medium">{invite.data.role}</span>, for
        <span class="font-medium">{invite.data.email}</span>.
      </p>

      {#if auth.isLoading}
        <p class="text-sm text-muted-foreground">Checking your session…</p>
      {:else if !auth.isAuthenticated}
        <p class="text-sm text-muted-foreground">
          Sign in or create an account with {invite.data.email} to accept.
        </p>
        <div class="flex gap-2">
          <Button href={signupHref} class="flex-1">Create account</Button>
          <Button href={loginHref} variant="outline" class="flex-1">Sign in</Button>
        </div>
      {:else if emailMatches}
        {#if error}<p class="text-sm text-destructive">{error}</p>{/if}
        <Button onclick={accept} disabled={accepting} class="w-full">
          {accepting ? 'Joining…' : `Join ${invite.data.organizationName}`}
        </Button>
      {:else}
        <p class="text-sm text-destructive">
          This invitation is for {invite.data.email}, but you're signed in as
          {$session.data?.user?.email}. Sign in as {invite.data.email} to accept.
        </p>
        <Button onclick={switchAccount} variant="outline" class="w-full">Switch account</Button>
      {/if}
    </div>
  {/if}
</AuthShell>
