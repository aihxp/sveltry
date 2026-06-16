import { extractAuth, ingestError } from '@sveltry/protocol';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';

/**
 * Shared DSN-key authentication for the `?o=<publicId>` artifact-style HTTP
 * actions (artifact upload, deploys, set-commits). Reads the `sentry_key`, the
 * `o` project id, and resolves the project key, returning either the resolved
 * context or the error Response to send. The main ingest endpoint authenticates
 * inline because its public id comes from the URL path and is interleaved with
 * origin/rate-limit/quota gates.
 */
export async function resolveDsnRequest(
  ctx: ActionCtx,
  request: Request,
  url: URL,
  cors: Record<string, string>,
) {
  const publicKey = extractAuth(request.headers.get('x-sentry-auth'), url.searchParams).sentry_key;
  const publicId = url.searchParams.get('o') ?? '';
  if (!publicKey) {
    return { ok: false as const, response: ingestError(401, 'missing sentry_key', [], cors) };
  }
  if (!publicId) {
    return {
      ok: false as const,
      response: ingestError(400, 'missing project id (o=<publicId>)', [], cors),
    };
  }
  const resolved = await ctx.runQuery(internal.projects.resolveIngestKey, { publicId, publicKey });
  if (!resolved) {
    return { ok: false as const, response: ingestError(401, 'invalid dsn', [], cors) };
  }
  return { ok: true as const, resolved };
}
