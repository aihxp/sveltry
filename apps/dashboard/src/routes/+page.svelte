<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Logo from '$lib/components/Logo.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import StarIcon from '@lucide/svelte/icons/star';
  import ZapIcon from '@lucide/svelte/icons/zap';
  import ShieldIcon from '@lucide/svelte/icons/shield';
  import PlugIcon from '@lucide/svelte/icons/plug';
  import ServerIcon from '@lucide/svelte/icons/server';
  import Code2Icon from '@lucide/svelte/icons/code-2';
  import ActivityIcon from '@lucide/svelte/icons/activity';
  import GaugeIcon from '@lucide/svelte/icons/gauge';
  import CheckIcon from '@lucide/svelte/icons/check';

  const REPO = 'https://github.com/aihxp/sveltry';
  const DOCS = `${REPO}/tree/main/docs`;
  const QUICKSTART = `${REPO}/blob/main/docs/QUICKSTART.md`;

  const steps = [
    {
      icon: Code2Icon,
      title: 'Change one line',
      body: 'Point any official @sentry/* SDK at your Sveltry DSN. No forks, no shims, the same client you already use.',
    },
    {
      icon: ActivityIcon,
      title: 'Events stream in',
      body: 'Sveltry ingests over the real Sentry wire protocol, decodes the envelope, and groups errors into issues server-side.',
    },
    {
      icon: GaugeIcon,
      title: 'Triage live',
      body: 'Issues, performance, replays, and release health update in the dashboard the moment they land, over WebSockets.',
    },
  ];

  const reasons = [
    'Your data stays on your own infrastructure, including user identity.',
    'No per-event pricing or sampling, ingest is bounded by your hardware, not a plan.',
    'The same Sentry SDKs and source maps you already have, nothing to rewrite.',
  ];

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
      <Button href={DOCS} variant="ghost" size="sm" class="hidden sm:inline-flex">Docs</Button>
      <Button href={REPO} variant="ghost" size="sm">GitHub</Button>
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
        <Button href={REPO} variant="outline" size="lg">
          <StarIcon class="size-4" /> Star on GitHub
        </Button>
      </div>
      <p class="mt-4 text-sm text-muted-foreground">
        or <a href={QUICKSTART} class="text-foreground underline underline-offset-4"
          >read the 5-minute quickstart</a
        >
      </p>
      <pre
        class="mx-auto mt-12 max-w-xl overflow-x-auto rounded-lg border bg-card p-4 text-left font-mono text-sm text-muted-foreground"><code
          >Sentry.init({'{'}
  dsn: <span class="text-primary">'https://KEY@ingest.your-domain.com/1'</span>,
});</code
        ></pre>
    </section>

    <section class="pb-20">
      <h2 class="text-center text-2xl font-bold tracking-tight sm:text-3xl">
        From an SDK to a live issue in three steps
      </h2>
      <div class="mt-10 grid gap-6 sm:grid-cols-3">
        {#each steps as s, i (s.title)}
          <div class="relative rounded-xl border bg-card p-6">
            <span
              class="absolute right-4 top-4 text-4xl font-bold tabular-nums text-muted-foreground/15"
            >
              {i + 1}
            </span>
            <div
              class="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <s.icon class="size-5" />
            </div>
            <h3 class="mt-4 text-lg font-semibold">{s.title}</h3>
            <p class="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
          </div>
        {/each}
      </div>
    </section>

    <section class="grid gap-5 pb-20 sm:grid-cols-2">
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

    <section class="pb-24">
      <div class="rounded-2xl border bg-card p-8 sm:p-12">
        <div class="grid items-center gap-8 sm:grid-cols-2">
          <div>
            <h2 class="text-2xl font-bold tracking-tight sm:text-3xl">Why self-host?</h2>
            <ul class="mt-6 space-y-3">
              {#each reasons as reason (reason)}
                <li class="flex items-start gap-3 text-sm text-muted-foreground">
                  <CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{reason}</span>
                </li>
              {/each}
            </ul>
          </div>
          <div class="flex flex-col items-start gap-3 sm:items-end">
            <p class="text-balance text-lg font-medium sm:text-right">
              Drop-in Sentry compatibility, on infrastructure you control.
            </p>
            <div class="flex gap-3">
              <Button href="/signup" size="lg">Get started</Button>
              <Button href={DOCS} variant="outline" size="lg">Read the docs</Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="border-t">
    <div
      class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row"
    >
      <Logo class="opacity-80" />
      <nav class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
        <a href={QUICKSTART} class="text-muted-foreground hover:text-foreground">Quickstart</a>
        <a href={DOCS} class="text-muted-foreground hover:text-foreground">Docs</a>
        <a href={REPO} class="text-muted-foreground hover:text-foreground">GitHub</a>
        <a href={`${REPO}/blob/main/LICENSE`} class="text-muted-foreground hover:text-foreground"
          >Apache-2.0</a
        >
      </nav>
      <p class="text-sm text-muted-foreground">
        Built with SvelteKit &amp; Convex. Not affiliated with Sentry.
      </p>
    </div>
  </footer>
</div>
