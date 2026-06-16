/**
 * Transparent decompression of ingest request bodies. Sentry SDKs may compress
 * with gzip, deflate (zlib), br (Brotli), or zstd. Decompression uses `fflate`
 * (pure JS) rather than `DecompressionStream`, because the latter is not present
 * in every runtime (notably the self-hosted Convex isolate). Brotli/zstd are not
 * supported and raise an error so the caller can return a 400 with a reason.
 */

import { Decompress } from 'fflate';

/** Guard against decompression bombs: reject bodies that expand past this. */
export const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MiB, per the envelope spec.

/**
 * Cap on the raw request body the ingest/artifact endpoints will buffer. The
 * envelope spec tops out at 200 MiB decompressed, so an honest uncompressed
 * body fits; a compressed body is far smaller. Bodies past this are rejected
 * before decompression. The bomb guard below is the load-bearing defense (a
 * tiny compressed body can still inflate hugely); this is the coarse first cut.
 */
export const MAX_REQUEST_BODY_BYTES = MAX_DECOMPRESSED_BYTES;

export class DecodeError extends Error {
  constructor(
    message: string,
    readonly causes: string[] = [],
  ) {
    super(message);
    this.name = 'DecodeError';
  }
}

/**
 * Decompress incrementally, aborting the moment the running output exceeds
 * `maxDecompressed`. fflate's streaming `Decompress` auto-detects gzip / zlib /
 * raw deflate and emits output chunk-by-chunk; throwing from `ondata` unwinds
 * the inflate before it materializes the rest. This bounds peak memory to the
 * cap regardless of the input, defeating both the unbounded-growth deflate bomb
 * and the gzip trailer's attacker-controlled ISIZE pre-allocation (the one-shot
 * `decompressSync` path was vulnerable to both, because it only checked the size
 * AFTER fully inflating).
 */
function inflate(
  bytes: Uint8Array,
  format: 'gzip' | 'deflate',
  maxDecompressed: number,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const dec = new Decompress((chunk) => {
      total += chunk.length;
      if (total > maxDecompressed) {
        throw new DecodeError('payload too large', [
          `decompressed size exceeds ${maxDecompressed}`,
        ]);
      }
      chunks.push(chunk);
    });
    dec.push(bytes, true);
  } catch (err) {
    if (err instanceof DecodeError) throw err;
    throw new DecodeError('failed to read request body', [
      `failed to decode ${format} payload`,
      err instanceof Error ? err.message : String(err),
    ]);
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Decompress `bytes` according to the `Content-Encoding` header value.
 * `null`/`identity` returns the input unchanged. `maxDecompressed` bounds the
 * inflated size (defaults to the spec's 200 MiB); it is a parameter so the bomb
 * guard can be exercised in tests without allocating 200 MiB.
 */
export async function decompressBody(
  bytes: Uint8Array,
  contentEncoding: string | null,
  maxDecompressed: number = MAX_DECOMPRESSED_BYTES,
): Promise<Uint8Array> {
  const enc = (contentEncoding ?? '').trim().toLowerCase();
  switch (enc) {
    case '':
    case 'identity':
      if (bytes.byteLength > maxDecompressed) {
        throw new DecodeError('payload too large', [`size exceeds ${maxDecompressed}`]);
      }
      return bytes;
    case 'gzip':
    case 'x-gzip':
      return inflate(bytes, 'gzip', maxDecompressed);
    case 'deflate':
      return inflate(bytes, 'deflate', maxDecompressed);
    case 'br':
    case 'zstd': {
      // Not supported by DecompressionStream. Most JS SDKs use gzip or no
      // compression; surface a clear error for the rare br/zstd transport.
      throw new DecodeError('unsupported content-encoding', [`cannot decode ${enc} payload`]);
    }
    default:
      throw new DecodeError('unsupported content-encoding', [`unknown encoding: ${enc}`]);
  }
}
