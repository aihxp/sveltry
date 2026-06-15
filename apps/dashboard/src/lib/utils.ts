import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class lists, resolving conflicts (the shadcn `cn` helper). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** A human, relative timestamp like "3m ago" / "2d ago". */
export function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  // Future timestamps (clock skew between an SDK and the server) read as "just now"
  // rather than a nonsensical negative age.
  if (diff < 0) return 'just now';
  const sec = Math.round(diff / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/** Compact large counts: 1234 -> "1.2k". */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

/** Human-readable duration from milliseconds: 42 -> "42ms", 1500 -> "1.50s". */
export function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

/** Human-readable byte size: 2048 -> "2.0 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Build a Sentry-compatible DSN from the ingest origin (the Convex `.site`
 * host), the project's public key, and its numeric public id.
 */
export function buildDsn(ingestUrl: string, publicKey: string, publicId: string): string {
  try {
    const u = new URL(ingestUrl);
    const path = u.pathname.replace(/\/+$/, '').replace(/^\//, '');
    return `${u.protocol}//${publicKey}@${u.host}${path ? '/' + path : ''}/${publicId}`;
  } catch {
    return `${ingestUrl.replace(/\/$/, '')}/${publicId}`;
  }
}

export type RepoProvider = 'github' | 'gitlab' | 'bitbucket';

export interface RepoConfig {
  provider: RepoProvider;
  baseUrl: string;
  defaultBranch: string;
  sourceRoot?: string;
}

export interface RepoFrame {
  filename?: string;
  lineno?: number;
  /** Optional release commit SHA to pin instead of the default branch. */
  ref?: string;
}

/**
 * Build an "open in repo" web URL for a stack frame. Pure string construction:
 * no network calls, no token. Returns null when there is no usable file + line.
 *
 *   github:    <baseUrl>/blob/<ref>/<path>#L<lineno>
 *   gitlab:    <baseUrl>/-/blob/<ref>/<path>#L<lineno>
 *   bitbucket: <baseUrl>/src/<ref>/<path>#lines-<lineno>
 *
 * `<ref>`  = frame.ref (a release commit SHA) if present, else config.defaultBranch.
 * `<path>` = frame.filename with sourceRoot stripped, backslashes normalized, and
 *            any leading slash removed (best-effort: a non-matching sourceRoot
 *            leaves the path intact rather than dropping the link).
 */
export function buildRepoFileUrl(config: RepoConfig, frame: RepoFrame): string | null {
  if (!frame.filename || frame.lineno == null || frame.lineno < 1) return null;

  const ref = frame.ref || config.defaultBranch;
  const base = config.baseUrl.replace(/\/+$/, '');

  let path = frame.filename.replace(/\\/g, '/');
  if (config.sourceRoot) {
    let root = config.sourceRoot.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!root.endsWith('/')) root += '/';
    const normalized = path.replace(/^\/+/, '');
    if (normalized.startsWith(root)) path = normalized.slice(root.length);
  }
  path = path.replace(/^\/+/, '');
  if (!path) return null;

  // Encode per path segment so a branch like `release/1.x` keeps its slash while
  // special chars (#, ?, space) cannot corrupt the URL. SHA refs are already safe.
  const refPath = ref.split('/').map(encodeURIComponent).join('/');
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  switch (config.provider) {
    case 'github':
      return `${base}/blob/${refPath}/${encoded}#L${frame.lineno}`;
    case 'gitlab':
      return `${base}/-/blob/${refPath}/${encoded}#L${frame.lineno}`;
    case 'bitbucket':
      return `${base}/src/${refPath}/${encoded}#lines-${frame.lineno}`;
    default:
      return null;
  }
}
