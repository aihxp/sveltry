import { describe, expect, test } from 'bun:test';
import { deflateSync, gzipSync } from 'node:zlib';
import { DecodeError, decompressBody } from '../src/decompress.js';

// A compressible body large enough that SDKs would gzip it on the wire.
const text = JSON.stringify({ message: 'x'.repeat(4096), level: 'error' });
const bytes = new TextEncoder().encode(text);

describe('decompressBody', () => {
  test('identity / empty passes through unchanged', async () => {
    expect(await decompressBody(bytes, null)).toEqual(bytes);
    expect(await decompressBody(bytes, 'identity')).toEqual(bytes);
  });

  // Regression: DecompressionStream is absent in the Convex isolate, which made
  // every gzipped SDK envelope 400. fflate must decode real zlib gzip/deflate.
  test('decodes a real gzip body', async () => {
    const gz = new Uint8Array(gzipSync(bytes));
    expect(new TextDecoder().decode(await decompressBody(gz, 'gzip'))).toBe(text);
  });

  test('decodes a real deflate (zlib) body', async () => {
    const df = new Uint8Array(deflateSync(bytes));
    expect(new TextDecoder().decode(await decompressBody(df, 'deflate'))).toBe(text);
  });

  test('rejects unsupported encodings with a DecodeError', async () => {
    await expect(decompressBody(bytes, 'br')).rejects.toBeInstanceOf(DecodeError);
    await expect(decompressBody(bytes, 'zstd')).rejects.toBeInstanceOf(DecodeError);
  });

  // Decompression-bomb guard: a small compressed body that inflates past the cap
  // must be rejected mid-stream, not after fully inflating. We pass a tiny cap so
  // the test never allocates the real 200 MiB.
  test('aborts a body that inflates past the cap (gzip bomb)', async () => {
    const bomb = new Uint8Array(gzipSync(new Uint8Array(64 * 1024))); // 64 KiB of zeros, ~tiny gzipped
    await expect(decompressBody(bomb, 'gzip', 1024)).rejects.toBeInstanceOf(DecodeError);
    await expect(decompressBody(bomb, 'gzip', 1024)).rejects.toThrow(/too large/);
  });

  test('aborts a deflate body that inflates past the cap', async () => {
    const bomb = new Uint8Array(deflateSync(new Uint8Array(64 * 1024)));
    await expect(decompressBody(bomb, 'deflate', 1024)).rejects.toThrow(/too large/);
  });

  test('allows a body that inflates within the cap', async () => {
    const gz = new Uint8Array(gzipSync(bytes));
    expect((await decompressBody(gz, 'gzip', bytes.length + 64)).byteLength).toBe(bytes.length);
  });

  test('rejects an oversize identity body', async () => {
    await expect(decompressBody(bytes, 'identity', 16)).rejects.toThrow(/too large/);
  });
});
