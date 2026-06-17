<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { useQuery, useAuth } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import { authClient } from '$lib/auth-client';
  import { authRedirect } from '$lib/auth-redirect';
  import Logo from '$lib/components/Logo.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import Toaster from '$lib/components/Toaster.svelte';
  import { cn } from '$lib/utils';
  import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
  import CompassIcon from '@lucide/svelte/icons/compass';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import GaugeIcon from '@lucide/svelte/icons/gauge';
  import RocketIcon from '@lucide/svelte/icons/rocket';
  import TimerIcon from '@lucide/svelte/icons/timer';
  import PlayCircleIcon from '@lucide/svelte/icons/play-circle';
  import FlameIcon from '@lucide/svelte/icons/flame';
  import MessageSquareIcon from '@lucide/svelte/icons/message-square';
  import BoxesIcon from '@lucide/svelte/icons/boxes';
  import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
  import UsersIcon from '@lucide/svelte/icons/users';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

  const REPO = 'https://github.com/aihxp/sveltry';
  const helpLinks = [
    { label: 'Documentation', href: `${REPO}/tree/main/docs` },
    { label: 'Quickstart', href: `${REPO}/blob/main/docs/QUICKSTART.md` },
    { label: 'Sentry SDK compatibility', href: `${REPO}/blob/main/docs/SENTRY_COMPATIBILITY.md` },
    { label: 'Self-hosting guide', href: `${REPO}/blob/main/docs/SELF_HOSTING.md` },
  ];

  // The Help dropdown, openable with `?` from anywhere (except while typing).
  let helpDetails = $state<HTMLDetailsElement | null>(null);
  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    const typing =
      !!el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable);
    if (e.key === '?' && !typing && helpDetails) {
      e.preventDefault();
      helpDetails.open = !helpDetails.open;
    }
  }

  const nav = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboardIcon },
    { href: '/issues', label: 'Issues', icon: CircleAlertIcon },
    { href: '/performance', label: 'Performance', icon: GaugeIcon },
    { href: '/discover', label: 'Discover', icon: CompassIcon },
    { href: '/dashboards', label: 'Dashboards', icon: LayoutDashboardIcon },
    { href: '/releases', label: 'Releases', icon: RocketIcon },
    { href: '/monitors', label: 'Monitors', icon: TimerIcon },
    { href: '/replays', label: 'Replays', icon: PlayCircleIcon },
    { href: '/profiles', label: 'Profiles', icon: FlameIcon },
    { href: '/feedback', label: 'Feedback', icon: MessageSquareIcon },
    { href: '/stats', label: 'Stats', icon: BarChart3Icon },
    { href: '/projects', label: 'Projects', icon: BoxesIcon },
    { href: '/teams', label: 'Teams', icon: UsersIcon },
    { href: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  let { children } = $props();

  const path = $derived(page.url.pathname);
  const auth = useAuth();
  const session = authClient.useSession();
  const user = $derived($session.data?.user);

  // Client-side auth gating: redirect to login when unauthenticated, and to
  // onboarding when the user has no active organization yet.
  const activeOrg = useQuery(api.organizations.activeOrg, () =>
    auth.isAuthenticated ? {} : ('skip' as const),
  );
  $effect(() => {
    const target = authRedirect({
      authLoading: auth.isLoading,
      authenticated: auth.isAuthenticated,
      orgLoading: activeOrg.isLoading,
      activeOrg: activeOrg.data,
      path: page.url.pathname,
    });
    if (target) goto(target);
  });

  async function signOut() {
    await authClient.signOut();
    await goto('/login');
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="flex min-h-screen bg-background">
  <aside class="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
    <div class="flex h-14 items-center border-b px-5"><Logo /></div>
    <nav class="flex-1 space-y-1 p-3">
      {#each nav as item (item.href)}
        {@const active = path === item.href || path.startsWith(item.href + '/')}
        <a
          href={item.href}
          class={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            active
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
          )}
        >
          <item.icon class="size-4" />
          {item.label}
        </a>
      {/each}
    </nav>
    <div class="border-t p-3 text-xs text-muted-foreground">
      <div class="truncate font-medium text-foreground">
        {activeOrg.data?.name ?? 'Organization'}
      </div>
      <div class="truncate">{user?.email ?? ''}</div>
    </div>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col">
    <header class="flex h-14 items-center justify-between border-b px-5">
      <div class="flex items-center gap-2 md:hidden"><Logo /></div>
      <div class="hidden text-sm text-muted-foreground md:block">{activeOrg.data?.name ?? ''}</div>
      <div class="flex items-center gap-1.5">
        <details class="group relative" bind:this={helpDetails}>
          <summary
            class="flex cursor-pointer list-none items-center rounded-md p-1.5 text-sm hover:bg-accent"
            title="Help (press ?)"
            aria-label="Help"
          >
            <CircleHelpIcon class="size-4 text-muted-foreground" />
          </summary>
          <div
            class="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-md border bg-popover p-1 shadow-md"
          >
            {#each helpLinks as link (link.href)}
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent"
              >
                {link.label}
                <ExternalLinkIcon class="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            {/each}
            <div class="my-1 border-t"></div>
            <a
              href={`${REPO}/issues/new`}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent"
            >
              Report an issue
              <ExternalLinkIcon class="size-3.5 shrink-0 text-muted-foreground" />
            </a>
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent"
            >
              GitHub repository
              <ExternalLinkIcon class="size-3.5 shrink-0 text-muted-foreground" />
            </a>
            <div class="my-1 border-t"></div>
            <p class="px-3 py-1.5 text-xs text-muted-foreground">
              Sveltry v{__APP_VERSION__} · press <kbd class="font-mono">?</kbd> for help
            </p>
          </div>
        </details>
        <ThemeToggle />
        <details class="group relative">
          <summary
            class="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <span
              class="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
            >
              {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
            </span>
            <span class="hidden max-w-[12rem] truncate sm:inline">{user?.email ?? ''}</span>
            <ChevronDownIcon class="size-3.5 text-muted-foreground" />
          </summary>
          <div
            class="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-md border bg-popover p-1 shadow-md"
          >
            <a href="/settings" class="block rounded-sm px-3 py-2 text-sm hover:bg-accent"
              >Settings</a
            >
            <button
              onclick={signOut}
              class="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
            >
              <LogOutIcon class="size-4" /> Sign out
            </button>
          </div>
        </details>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto p-6">
      {@render children?.()}
    </main>
  </div>
</div>

<Toaster />
