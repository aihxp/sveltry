// A tiny, app-wide toast store (Svelte 5 runes). Mutations across the dashboard
// emit success/error feedback here; <Toaster /> (mounted once in the app layout)
// renders the list. Reactivity crosses the module boundary because `$state`
// returns a deep proxy, so push/splice on the exported array are tracked by
// consumers without re-exporting a new binding.
export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

export interface ToastOptions {
  /** Auto-dismiss after this many ms; 0 keeps it until dismissed. */
  duration?: number;
  /** An optional action (e.g. "Undo") rendered alongside the message. */
  action?: ToastAction;
}

export const toasts = $state<Toast[]>([]);

let nextId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function push(message: string, variant: ToastVariant, opts: ToastOptions = {}): number {
  const id = ++nextId;
  toasts.push({ id, message, variant, action: opts.action });
  // Errors linger a little longer; an actionable toast stays until dismissed so
  // its action cannot expire out from under the user.
  const duration = opts.duration ?? (opts.action ? 0 : variant === 'error' ? 6000 : 4000);
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismiss(id), duration),
    );
  }
  return id;
}

export function dismiss(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i !== -1) toasts.splice(i, 1);
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

export const toast = {
  success: (message: string, opts?: ToastOptions) => push(message, 'success', opts),
  error: (message: string, opts?: ToastOptions) => push(message, 'error', opts),
  info: (message: string, opts?: ToastOptions) => push(message, 'info', opts),
};

/** Narrow an unknown thrown value to a user-facing message. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
