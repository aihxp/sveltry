/** Turn an arbitrary name into a URL-safe slug. */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}

/** Generate a 32-char lowercase-hex DSN public key. */
export function generatePublicKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 32);
  }
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** Generate a 64-char lowercase-hex secret (e.g. an invitation token). */
export function generateToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return (crypto.randomUUID() + crypto.randomUUID() + crypto.randomUUID() + crypto.randomUUID())
      .replace(/-/g, '')
      .slice(0, 64);
  }
  let s = '';
  for (let i = 0; i < 64; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** Generate a numeric public id for a project (the `/api/<id>/` DSN segment). */
export function generatePublicId(): string {
  // 9-digit numeric id; uniqueness is verified by the caller against an index.
  const n = Math.floor(100000000 + Math.random() * 899999999);
  return String(n);
}

// Crockford base32 (no I, L, O, U) for unambiguous, readable short ids.
const SHORTID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A short, human-friendly issue id (7 Crockford-base32 chars, a ~34-billion
 * space). Random and unchecked, so no counter or extra read is needed on the
 * ingest hot path. A collision is rare and low-impact at the team-and-product
 * scale Sveltry targets: the short-id search returns the first match, but both
 * issues stay reachable by title search and direct link.
 */
export function generateShortId(length = 7): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SHORTID_ALPHABET[Math.floor(Math.random() * SHORTID_ALPHABET.length)];
  }
  return out;
}
