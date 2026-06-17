// An imperative, app-wide confirmation dialog (Svelte 5 runes). Destructive
// handlers call `await confirm({...})` and bail when it resolves false; a single
// <ConfirmDialog /> (mounted once in the (app) layout) renders the active request
// and resolves the promise. Keeping the dialog state in module scope lets any
// handler trigger it without threading props through the component tree.
export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Confirm button label. Default "Delete". */
  confirmLabel?: string;
  /** Cancel button label. Default "Cancel". */
  cancelLabel?: string;
  /** Button styling. Destructive (red) by default. */
  variant?: 'destructive' | 'default';
  /**
   * When set, the confirm button stays disabled until the user types this exact
   * string, the typed-name guard used for the highest-stakes actions.
   */
  requireText?: string;
}

interface ActiveConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export const confirmState = $state<{ active: ActiveConfirm | null }>({ active: null });

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  // Resolve any dialog already open as cancelled before replacing it, so a
  // dangling promise never leaks.
  confirmState.active?.resolve(false);
  return new Promise<boolean>((resolve) => {
    confirmState.active = { ...opts, resolve };
  });
}

export function resolveConfirm(ok: boolean): void {
  const active = confirmState.active;
  if (!active) return;
  confirmState.active = null;
  active.resolve(ok);
}
