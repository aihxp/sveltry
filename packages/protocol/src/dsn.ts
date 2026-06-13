import type { DsnComponents } from '@sveltry/types';

/**
 * Parse a Sentry DSN of the form
 * `{PROTOCOL}://{PUBLIC_KEY}[:{SECRET}]@{HOST}[:{PORT}][{PATH}]/{PROJECT_ID}`.
 *
 * The secret key is deprecated; modern DSNs omit it. Returns `null` if the
 * string is not a well-formed DSN.
 */
export function parseDsn(dsn: string): DsnComponents | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }

  const publicKey = url.username;
  if (!publicKey) return null;

  // The path is everything up to the last segment; the last segment is the project id.
  const rawPath = url.pathname.replace(/\/+$/, '');
  const lastSlash = rawPath.lastIndexOf('/');
  const projectId = rawPath.slice(lastSlash + 1);
  if (!projectId) return null;
  const path = rawPath.slice(0, lastSlash).replace(/^\//, '');

  return {
    protocol: url.protocol.replace(/:$/, ''),
    publicKey,
    secretKey: url.password || undefined,
    host: url.hostname,
    port: url.port || undefined,
    path: path || undefined,
    projectId,
  };
}

/** Build the base API endpoint (`{scheme}://{host}[:{port}][/{path}]/api/`). */
export function baseApiEndpoint(dsn: DsnComponents): string {
  const port = dsn.port ? `:${dsn.port}` : '';
  const path = dsn.path ? `/${dsn.path}` : '';
  return `${dsn.protocol}://${dsn.host}${port}${path}/api/`;
}

/** The modern ingestion endpoint a Sentry SDK POSTs envelopes to. */
export function envelopeEndpoint(dsn: DsnComponents): string {
  return `${baseApiEndpoint(dsn)}${dsn.projectId}/envelope/`;
}

/** The legacy ingestion endpoint for single events. */
export function storeEndpoint(dsn: DsnComponents): string {
  return `${baseApiEndpoint(dsn)}${dsn.projectId}/store/`;
}

/**
 * Construct a DSN string from Sveltry's own parts. `ingestHost` is the public
 * origin of the Convex HTTP-actions endpoint (the `.site` host when
 * self-hosted), e.g. `https://ingest.sveltry.example.com`.
 */
export function buildDsn(opts: {
  ingestHost: string;
  publicKey: string;
  publicId: string | number;
}): string {
  const u = new URL(opts.ingestHost);
  const scheme = u.protocol.replace(/:$/, '');
  const host = u.host; // includes port if present
  const path = u.pathname.replace(/\/+$/, '').replace(/^\//, '');
  const prefix = path ? `/${path}` : '';
  return `${scheme}://${opts.publicKey}@${host}${prefix}/${opts.publicId}`;
}

/**
 * Extract the project id from an ingestion request path such as
 * `/api/42/envelope/` or `/api/42/store/`. Returns `null` when the path is not
 * a recognized ingest route.
 */
export function projectIdFromPath(pathname: string): {
  projectId: string;
  endpoint: 'envelope' | 'store' | 'security' | 'minidump' | 'unknown';
} | null {
  const m = pathname.match(
    /\/api\/([^/]+)\/(envelope|store|security|minidump|unreal|attachment)\/?$/,
  );
  if (!m) return null;
  const endpoint =
    m[2] === 'envelope'
      ? 'envelope'
      : m[2] === 'store'
        ? 'store'
        : m[2] === 'security'
          ? 'security'
          : m[2] === 'minidump'
            ? 'minidump'
            : 'unknown';
  return { projectId: m[1]!, endpoint };
}
