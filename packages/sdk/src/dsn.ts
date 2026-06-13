/**
 * Build a Sveltry DSN that official Sentry SDKs can use unmodified.
 *
 * A Sveltry DSN points at the ingest origin (the Convex HTTP-actions host when
 * self-hosted) and carries the project's public key and numeric public id:
 *   `{scheme}://{publicKey}@{host}[/{prefix}]/{projectId}`
 */
export interface SveltryDsnParts {
  /** The public ingest origin, e.g. `https://ingest.sveltry.example.com`. */
  ingestHost: string;
  /** The project's DSN public key (`sentry_key`). */
  publicKey: string;
  /** The project's numeric public id (the `/api/<id>/` segment). */
  projectId: string | number;
}

export function buildSveltryDsn(parts: SveltryDsnParts): string {
  const u = new URL(parts.ingestHost);
  const scheme = u.protocol.replace(/:$/, '');
  const host = u.host;
  const prefix = u.pathname.replace(/\/+$/, '').replace(/^\//, '');
  const path = prefix ? `/${prefix}` : '';
  return `${scheme}://${parts.publicKey}@${host}${path}/${parts.projectId}`;
}

/**
 * Read the `dsn` field from an envelope header line. Used by the tunnel handler
 * to know where to forward a tunneled envelope (the SDK puts the DSN in the
 * envelope header when tunneling).
 */
export function dsnFromEnvelopeHeader(raw: Uint8Array | string): string | null {
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  const firstLine = text.slice(0, text.indexOf('\n'));
  if (!firstLine) return null;
  try {
    const header = JSON.parse(firstLine) as { dsn?: string };
    return header.dsn ?? null;
  } catch {
    return null;
  }
}

/** Derive the upstream envelope ingest URL from a DSN string. */
export function ingestUrlFromDsn(dsn: string): string | null {
  let u: URL;
  try {
    u = new URL(dsn);
  } catch {
    return null;
  }
  const rawPath = u.pathname.replace(/\/+$/, '');
  const lastSlash = rawPath.lastIndexOf('/');
  const projectId = rawPath.slice(lastSlash + 1);
  if (!projectId) return null;
  const prefix = rawPath.slice(0, lastSlash);
  const scheme = u.protocol.replace(/:$/, '');
  return `${scheme}://${u.host}${prefix}/api/${projectId}/envelope/`;
}
