<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Logo from '$lib/components/Logo.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import StarIcon from '@lucide/svelte/icons/star';
  import ZapIcon from '@lucide/svelte/icons/zap';
  import ShieldIcon from '@lucide/svelte/icons/shield';
  import PlugIcon from '@lucide/svelte/icons/plug';
  import ServerIcon from '@lucide/svelte/icons/server';

  const features = [
    {
      icon: PlugIcon,
      title: 'Sentry-compatible',
      body: 'Point official @sentry/* SDKs at Sveltry by changing one DSN. The envelope and store endpoints speak the real wire protocol.',
    },
    {
      icon: ZapIcon,
      title: 'Reactive by default',
      body: 'New issues stream into the dashboard live over WebSockets, powered by Convex. No polling, no refresh.',
    },
    {
      icon: ServerIcon,
      title: 'Self-hosted',
      body: 'Your data, your infrastructure. SvelteKit + open-source Convex (backed by Postgres), all in Docker.',
    },
    {
      icon: ShieldIcon,
      title: 'Private',
      body: 'Default PII scrubbing at ingest, per-project retention, and an auth model where identity never leaves your own infrastructure.',
    },
  ];
</script>

<svelte:head>
  <title>Sveltry · The reactive, self-hosted, Sentry-compatible error tracker</title>
  <meta
    name="description"
    content="Sveltry is an open-source, self-hosted error tracker that speaks the Sentry wire protocol. Built on SvelteKit and self-hosted Convex."
  />
</svelte:head>

<div class="min-h-screen bg-background">
  <header class="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
    <Logo />
    <nav class="flex items-center gap-2">
      <Button href="https://github.com/aihxp/sveltry" variant="ghost" size="sm">GitHub</Button>
      <ThemeToggle />
      <Button href="/login" variant="ghost" size="sm">Sign in</Button>
      <Button href="/signup" size="sm">Get started</Button>
    </nav>
  </header>

  <main class="mx-auto max-w-6xl px-6">
    <section class="py-20 text-center sm:py-28">
      <span
        class="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground"
      >
        <span class="size-2 animate-pulse rounded-full bg-primary"></span>
        Open source · Apache-2.0
      </span>
      <h1 class="mx-auto mt-6 max-w-3xl text-balance text-5xl font-bold tracking-tight sm:text-6xl">
        Error tracking that's
        <span class="text-primary">reactive</span>, self-hosted, and
        <span class="text-primary">Sentry-compatible</span>.
      </h1>
      <p class="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
        Sveltry catches your exceptions, groups them into issues, and streams them to a live
        dashboard, using the Sentry SDKs you already have. Run it entirely on your own
        infrastructure.
      </p>
      <div class="mt-8 flex items-center justify-center gap-3">
        <Button href="/signup" size="lg">Start tracking errors</Button>
        <Button href="https://github.com/aihxp/sveltry" variant="outline" size="lg">
          <StarIcon class="size-4" /> Star on GitHub
        </Button>
      </div>
      <pre
        class="mx-auto mt-12 max-w-xl overflow-x-auto rounded-lg border bg-card p-4 text-left font-mono text-sm text-muted-foreground"><code
          >Sentry.init({'{'}
  dsn: <span class="text-primary">'https://KEY@ingest.your-domain.com/1'</span>,
});</code
        ></pre>
    </section>

    <section class="grid gap-5 pb-24 sm:grid-cols-2">
      {#each features as f (f.title)}
        <div class="rounded-xl border bg-card p-6">
          <div
            class="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <f.icon class="size-5" />
          </div>
          <h3 class="mt-4 text-lg font-semibold">{f.title}</h3>
          <p class="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
        </div>
      {/each}
    </section>
  </main>

  <footer class="border-t">
    <div
      class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 sm:flex-row"
    >
      <Logo class="opacity-80" />
      <p class="text-sm text-muted-foreground">
        Built with SvelteKit &amp; Convex. Not affiliated with Sentry.
      </p>
    </div>
  </footer>
</div>
