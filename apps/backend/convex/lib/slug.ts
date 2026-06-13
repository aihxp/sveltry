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

/** Generate a numeric public id for a project (the `/api/<id>/` DSN segment). */
export function generatePublicId(): string {
  // 9-digit numeric id; uniqueness is verified by the caller against an index.
  const n = Math.floor(100000000 + Math.random() * 899999999);
  return String(n);
}
