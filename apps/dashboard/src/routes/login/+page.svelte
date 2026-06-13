<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth-client';
  import AuthShell from '$lib/components/AuthShell.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';
    const { error: err } = await authClient.signIn.email({ email, password });
    loading = false;
    if (err) {
      error = err.message ?? 'Sign in failed';
      return;
    }
    await goto(page.url.searchParams.get('redirectTo') ?? '/dashboard');
  }
</script>

<svelte:head><title>Sign in · Sveltry</title></svelte:head>

<AuthShell title="Sign in" subtitle="Welcome back to Sveltry.">
  <form class="space-y-4" onsubmit={submit}>
    <div class="space-y-1.5">
      <Label for="email">Email</Label>
      <Input
        id="email"
        type="email"
        bind:value={email}
        required
        autocomplete="email"
        placeholder="you@example.com"
      />
    </div>
    <div class="space-y-1.5">
      <Label for="password">Password</Label>
      <Input
        id="password"
        type="password"
        bind:value={password}
        required
        autocomplete="current-password"
      />
    </div>
    {#if error}<p class="text-sm text-destructive">{error}</p>{/if}
    <Button type="submit" class="w-full" disabled={loading}
      >{loading ? 'Signing in…' : 'Sign in'}</Button
    >
  </form>
  <p class="mt-4 text-center text-sm text-muted-foreground">
    No account? <a href="/signup" class="text-primary hover:underline">Create one</a>
  </p>
</AuthShell>
