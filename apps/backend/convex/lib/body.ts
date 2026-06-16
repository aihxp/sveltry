import { MAX_JSON_BODY_BYTES } from '@sveltry/protocol';

/**
 * Read and JSON-parse a request body with an explicit size cap, so the secondary
 * DSN/org-token endpoints cannot be made to buffer-and-parse an unbounded body
 * (the hot ingest + artifact endpoints already cap their bodies). Rejects via a
 * Content-Length pre-check and an actual-size re-check (a lying Content-Length is
 * caught after buffering). Returns the parsed JSON or a status + human reason the
 * caller maps to its own error response shape.
 */
export type CappedJson =
  | { ok: true; json: unknown }
  | { ok: false; status: 413 | 400; reason: string };

export async function readCappedJson(
  request: Request,
  max: number = MAX_JSON_BODY_BYTES,
): Promise<CappedJson> {
  const declaredLen = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLen) && declaredLen > max) {
    return { ok: false, status: 413, reason: 'payload too large' };
  }
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > max) {
    return { ok: false, status: 413, reason: 'payload too large' };
  }
  try {
    return { ok: true, json: JSON.parse(new TextDecoder().decode(raw)) };
  } catch {
    return { ok: false, status: 400, reason: 'invalid JSON body' };
  }
}
