/**
 * Transparent decompression of ingest request bodies. Sentry SDKs may compress
 * with gzip, deflate (zlib), br (Brotli), or zstd. Decompression uses `fflate`
 * (pure JS) rather than `DecompressionStream`, because the latter is not present
 * in every runtime (notably the self-hosted Convex isolate). Brotli/zstd are not
 * supported and raise an error so the caller can return a 400 with a reason.
 */

import { decompressSync } from 'fflate';

/** Guard against decompression bombs: reject bodies that expand past this. */
export const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MiB, per the envelope spec.

export class DecodeError extends Error {
  constructor(
    message: string,
    readonly causes: string[] = [],
  ) {
    super(message);
    this.name = 'DecodeError';
  }
}

function inflate(bytes: Uint8Array, format: 'gzip' | 'deflate'): Uint8Array {
  try {
    // `decompressSync` auto-detects gzip, zlib, and raw deflate.
    const buf = decompressSync(bytes);
    if (buf.byteLength > MAX_DECOMPRESSED_BYTES) {
      throw new DecodeError('payload too large', [
        `decompressed size exceeds ${MAX_DECOMPRESSED_BYTES}`,
      ]);
    }
    return buf;
  } catch (err) {
    if (err instanceof DecodeError) throw err;
    throw new DecodeError('failed to read request body', [
      `failed to decode ${format} payload`,
      err instanceof Error ? err.message : String(err),
    ]);
  }
}

/**
 * Decompress `bytes` according to the `Content-Encoding` header value.
 * `null`/`identity` returns the input unchanged.
 */
export async function decompressBody(
  bytes: Uint8Array,
  contentEncoding: string | null,
): Promise<Uint8Array> {
  const enc = (contentEncoding ?? '').trim().toLowerCase();
  switch (enc) {
    case '':
    case 'identity':
      return bytes;
    case 'gzip':
    case 'x-gzip':
      return inflate(bytes, 'gzip');
    case 'deflate':
      return inflate(bytes, 'deflate');
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
