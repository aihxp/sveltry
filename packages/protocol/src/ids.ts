/** A 32-character lowercase-hex event id (a UUID4 with dashes removed). */
export function generateEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** True when `id` is a valid 32-char hex event id. */
export function isEventId(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id);
}

/** Normalize an event id to 32 lowercase hex chars, or generate a fresh one. */
export function coerceEventId(id: string | undefined): string {
  if (id) {
    const cleaned = id.replace(/-/g, '').toLowerCase();
    if (isEventId(cleaned)) return cleaned;
  }
  return generateEventId();
}
