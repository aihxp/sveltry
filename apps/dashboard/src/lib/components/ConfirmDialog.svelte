<script lang="ts">
  // App-wide confirmation dialog. Mounted once in the (app) layout; renders the
  // active request from the confirm store. Accessible: role="alertdialog",
  // aria-modal, labelled/described by its heading and body, Escape cancels,
  // focus is moved in on open / restored on close, and Tab is trapped inside.
  import { tick } from 'svelte';
  import { confirmState, resolveConfirm } from '$lib/confirm.svelte';
  import { Button } from '$lib/components/ui/button';

  const active = $derived(confirmState.active);

  let typed = $state('');
  let dialogEl = $state<HTMLDivElement | null>(null);
  let restoreFocus: HTMLElement | null = null;

  const armed = $derived(!active?.requireText || typed === active.requireText);

  // Reset the typed guard and manage focus whenever a dialog opens or closes.
  $effect(() => {
    if (active) {
      typed = '';
      restoreFocus = document.activeElement as HTMLElement | null;
      void tick().then(() => {
        const target =
          dialogEl?.querySelector<HTMLElement>('input') ??
          dialogEl?.querySelector<HTMLElement>('[data-confirm-cancel]');
        target?.focus();
      });
    } else if (restoreFocus) {
      restoreFocus.focus();
      restoreFocus = null;
    }
  });

  function cancel() {
    resolveConfirm(false);
  }
  function ok() {
    if (armed) resolveConfirm(true);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Enter' && armed && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
      // Enter in the text field confirms (when armed); on a button, let the
      // native click fire instead.
      e.preventDefault();
      ok();
      return;
    }
    if (e.key === 'Tab' && dialogEl) {
      const list = [...dialogEl.querySelectorAll<HTMLElement>('button, input')].filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement as HTMLElement;
      if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if active}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      type="button"
      class="absolute inset-0 cursor-default bg-black/50"
      aria-label="Cancel"
      tabindex="-1"
      onclick={cancel}
    ></button>
    <div
      bind:this={dialogEl}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby={active.description ? 'confirm-desc' : undefined}
      class="relative w-full max-w-md rounded-lg border bg-card p-6 shadow-lg"
    >
      <h2 id="confirm-title" class="text-lg font-semibold">{active.title}</h2>
      {#if active.description}
        <p id="confirm-desc" class="mt-2 text-sm text-muted-foreground">{active.description}</p>
      {/if}
      {#if active.requireText}
        <div class="mt-4 space-y-1.5">
          <label for="confirm-input" class="text-sm text-muted-foreground">
            Type <span class="font-medium text-foreground">{active.requireText}</span> to confirm.
          </label>
          <input
            id="confirm-input"
            bind:value={typed}
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      {/if}
      <div class="mt-6 flex justify-end gap-2">
        <Button variant="outline" size="sm" data-confirm-cancel onclick={cancel}>
          {active.cancelLabel ?? 'Cancel'}
        </Button>
        <Button
          variant={active.variant === 'default' ? 'default' : 'destructive'}
          size="sm"
          disabled={!armed}
          onclick={ok}
        >
          {active.confirmLabel ?? 'Delete'}
        </Button>
      </div>
    </div>
  </div>
{/if}
