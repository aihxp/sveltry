/**
 * A compact, dependency-free, synchronous SHA-1 implementation.
 *
 * Sveltry uses this to derive stable issue fingerprints from grouping inputs.
 * SHA-1 is more than strong enough for grouping (we are de-duplicating, not
 * authenticating), and a synchronous hash keeps the grouping path simple inside
 * Convex mutations. The output is a 40-character lowercase hex string.
 */

function rotl(n: number, s: number): number {
  return (n << s) | (n >>> (32 - s));
}

export function sha1Hex(input: string): string {
  // UTF-8 encode.
  const bytes = new TextEncoder().encode(input);
  const ml = bytes.length * 8;

  // Pre-processing: append 0x80, pad with zeros, append 64-bit length.
  const withOne = new Uint8Array((((bytes.length + 8) >> 6) << 6) + 64);
  withOne.set(bytes);
  withOne[bytes.length] = 0x80;
  const view = new DataView(withOne.buffer);
  // 64-bit length; high word is effectively zero for our input sizes.
  view.setUint32(withOne.length - 8, Math.floor(ml / 0x100000000));
  view.setUint32(withOne.length - 4, ml >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);
  for (let i = 0; i < withOne.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getInt32(i + j * 4);
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rotl(w[j - 3]! ^ w[j - 8]! ^ w[j - 14]! ^ w[j - 16]!, 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let j = 0; j < 80; j++) {
      let f: number;
      let k: number;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[j]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}
