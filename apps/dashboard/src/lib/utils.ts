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
