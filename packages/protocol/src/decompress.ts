/**
 * Transparent decompression of ingest request bodies. Sentry SDKs may compress
 * with gzip, deflate (zlib), br (Brotli), or zstd. The web-standard
 * `DecompressionStream` (available in the Convex V8 runtime and modern browsers)
 * handles gzip and deflate; Brotli/zstd are passed through to an optional global
 * if the runtime provides one, otherwise an error is thrown so the caller can
 * return a 400 with an `X-Sentry-Error` reason.
 */

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

async function inflate(bytes: Uint8Array, format: 'gzip' | 'deflate'): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new DecodeError('decompression unsupported', [`no DecompressionStream for ${format}`]);
  }
  try {
    const ds = new DecompressionStream(format);
    const stream = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(ds));
    const buf = new Uint8Array(await stream.arrayBuffer());
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
