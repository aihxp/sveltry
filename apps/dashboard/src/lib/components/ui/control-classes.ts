/**
 * Shared classNames for the native `<select>` / `<textarea>` controls, styled to
 * match the `ui/input` primitive. The long focus-ring class string used to be
 * hand-copied onto every control; keeping it here (one definition site) stops the
 * styling from drifting per-call-site (see codeaudit QUAL-001). Compose with
 * `cn(selectClass, 'sm:w-72')` for per-site width tweaks.
 */
export const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** Native `<textarea>` styled for the mono config/JSON inputs. */
export const textareaClass =
  'flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
