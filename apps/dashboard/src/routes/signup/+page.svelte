<script lang="ts">
  import { goto } from '$app/navigation';
  import { authClient } from '$lib/auth-client';
  import AuthShell from '$lib/components/AuthShell.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';
    const { error: err } = await authClient.signUp.email({ name, email, password });
    loading = false;
    if (err) {
      error = err.message ?? 'Sign up failed';
      return;
    }
    await goto('/onboarding');
  }
</script>

<svelte:head><title>Create account · Sveltry</title></svelte:head>

<AuthShell title="Create your account" subtitle="Start tracking errors in minutes.">
  <form class="space-y-4" onsubmit={submit}>
    <div class="space-y-1.5">
      <Label for="name">Name</Label>
      <Input id="name" bind:value={name} required autocomplete="name" placeholder="Ada Lovelace" />
    </div>
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
        minlength={8}
        autocomplete="new-password"
      />
    </div>
    {#if error}<p class="text-sm text-destructive">{error}</p>{/if}
    <Button type="submit" class="w-full" disabled={loading}
      >{loading ? 'Creating…' : 'Create account'}</Button
    >
  </form>
  <p class="mt-4 text-center text-sm text-muted-foreground">
    Already have an account? <a href="/login" class="text-primary hover:underline">Sign in</a>
  </p>
</AuthShell>
