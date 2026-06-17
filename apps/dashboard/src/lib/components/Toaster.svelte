<script lang="ts">
  // App-wide toast viewport. Mounted once in the (app) layout; renders the shared
  // toast store and announces messages to assistive tech (status messages,
  // WCAG 4.1.3). Entrance motion is gated behind prefers-reduced-motion.
  import { toasts, dismiss } from '$lib/toast.svelte';
  import { fly } from 'svelte/transition';
  import { cn } from '$lib/utils';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check-big';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import InfoIcon from '@lucide/svelte/icons/info';
  import XIcon from '@lucide/svelte/icons/x';
  import type { ToastVariant } from '$lib/toast.svelte';

  const icons = { success: CircleCheckIcon, error: CircleAlertIcon, info: InfoIcon };
  const accent: Record<ToastVariant, string> = {
    success: 'text-success',
    error: 'text-destructive',
    info: 'text-primary',
  };

  // Honor the OS reduced-motion setting: skip the slide-in when set.
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const flyIn = (node: Element) =>
    fly(node, { y: reduceMotion ? 0 : 8, duration: reduceMotion ? 0 : 150 });
</script>

<div
  class="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm"
  aria-live="polite"
  aria-atomic="false"
>
  {#each toasts as t (t.id)}
    {@const Icon = icons[t.variant]}
    <div
      class="pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-popover p-3 text-sm shadow-lg"
      role={t.variant === 'error' ? 'alert' : 'status'}
      transition:flyIn
    >
      <Icon class={cn('mt-0.5 size-4 shrink-0', accent[t.variant])} />
      <span class="min-w-0 flex-1 break-words">{t.message}</span>
      {#if t.action}
        <button
          class="shrink-0 font-medium text-primary hover:underline"
          onclick={() => {
            t.action?.onClick();
            dismiss(t.id);
          }}
        >
          {t.action.label}
        </button>
      {/if}
      <button
        class="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
        aria-label="Dismiss notification"
        onclick={() => dismiss(t.id)}
      >
        <XIcon class="size-4" />
      </button>
    </div>
  {/each}
</div>
