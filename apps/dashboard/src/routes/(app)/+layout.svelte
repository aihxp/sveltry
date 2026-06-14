<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth-client';
  import Logo from '$lib/components/Logo.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import { cn } from '$lib/utils';
  import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import GaugeIcon from '@lucide/svelte/icons/gauge';
  import RocketIcon from '@lucide/svelte/icons/rocket';
  import TimerIcon from '@lucide/svelte/icons/timer';
  import PlayCircleIcon from '@lucide/svelte/icons/play-circle';
  import BoxesIcon from '@lucide/svelte/icons/boxes';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

  let { data, children } = $props();

  const nav = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboardIcon },
    { href: '/issues', label: 'Issues', icon: CircleAlertIcon },
    { href: '/performance', label: 'Performance', icon: GaugeIcon },
    { href: '/releases', label: 'Releases', icon: RocketIcon },
    { href: '/monitors', label: 'Monitors', icon: TimerIcon },
    { href: '/replays', label: 'Replays', icon: PlayCircleIcon },
    { href: '/projects', label: 'Projects', icon: BoxesIcon },
    { href: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  const path = $derived(page.url.pathname);
  const activeOrg = authClient.useActiveOrganization();

  async function signOut() {
    await authClient.signOut();
    await goto('/login');
  }
</script>

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
        {$activeOrg.data?.name ?? 'Organization'}
      </div>
      <div class="truncate">{data.user.email}</div>
    </div>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col">
    <header class="flex h-14 items-center justify-between border-b px-5">
      <div class="flex items-center gap-2 md:hidden"><Logo /></div>
      <div class="hidden text-sm text-muted-foreground md:block">{$activeOrg.data?.name ?? ''}</div>
      <div class="flex items-center gap-1.5">
        <ThemeToggle />
        <details class="group relative">
          <summary
            class="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <span
              class="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
            >
              {(data.user.name || data.user.email).slice(0, 1).toUpperCase()}
            </span>
            <span class="hidden max-w-[12rem] truncate sm:inline">{data.user.email}</span>
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
