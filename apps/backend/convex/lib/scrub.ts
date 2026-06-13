/**
 * Default server-side PII scrubbing, applied at ingest before persistence (the
 * same ordering Sentry's Relay uses). This is intentionally conservative: it
 * redacts values under sensitive-looking keys and obvious secret patterns in
 * strings. Self-hosters can disable it per project via `scrubPii`.
 */

const SENSITIVE_KEY =
  /(password|passwd|secret|token|api[-_]?key|auth|authorization|credential|cookie|session|ssn|card[-_]?number|cvv|pin)/i;
const CREDIT_CARD = /\b(?:\d[ -]*?){13,16}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g;

const REDACTED = '[Filtered]';
const MAX_DEPTH = 12;

function scrubString(value: string): string {
  return value
    .replace(CREDIT_CARD, REDACTED)
    .replace(SSN, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`);
}

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(val, depth + 1);
    }
    return out;
  }
  return value;
}

/** Return a scrubbed deep copy of an event payload. */
export function scrubPayload(payload: unknown): unknown {
  return scrubValue(payload, 0);
}
