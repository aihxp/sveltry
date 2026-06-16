/**
 * Server-side PII scrubbing, applied at ingest before persistence (the same
 * ordering Sentry's Relay uses). The default ruleset is intentionally
 * conservative: it redacts values under sensitive-looking keys and obvious
 * secret patterns in strings. A project can extend it with custom options:
 * additional sensitive field-name keywords, a safe-field allowlist that exempts
 * keys from redaction, and an IP-address toggle. Pure and unit-tested; the
 * backend calls it with the project's stored config.
 */

const SENSITIVE_KEY =
  /(password|passwd|secret|token|api[-_]?key|auth|authorization|credential|cookie|session|ssn|card[-_]?number|cvv|pin)/i;
const CREDIT_CARD = /\b(?:\d[ -]*?){13,16}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g;

/** Key names treated as IP-address fields when `scrubIp` is enabled. */
const IP_KEYS = new Set([
  'ip',
  'ip_address',
  'ipaddress',
  'remote_addr',
  'remoteaddr',
  'client_ip',
  'clientip',
  'x_forwarded_for',
  'x-forwarded-for',
]);

const REDACTED = '[Filtered]';
const MAX_DEPTH = 12;

/** Per-project scrubbing options layered on top of the default ruleset. */
export interface ScrubOptions {
  /** Extra key-name substrings to redact (case-insensitive), beyond the defaults. */
  extraFields?: string[];
  /** Key-name substrings that must never be redacted (wins over every rule). */
  safeFields?: string[];
  /** Also redact IP-address fields (`user.ip_address`, `REMOTE_ADDR`, ...). */
  scrubIp?: boolean;
}

interface CompiledScrub {
  extra: string[];
  safe: string[];
  scrubIp: boolean;
}

function compile(opts: ScrubOptions | undefined | null): CompiledScrub {
  const norm = (xs: string[] | undefined) =>
    (xs ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    extra: norm(opts?.extraFields),
    safe: norm(opts?.safeFields),
    scrubIp: !!opts?.scrubIp,
  };
}

/** Whether a key should have its value redacted, honoring the safe-field allowlist. */
function keyIsSensitive(key: string, c: CompiledScrub): boolean {
  const lower = key.toLowerCase();
  if (c.safe.some((f) => lower.includes(f))) return false;
  if (SENSITIVE_KEY.test(key)) return true;
  if (c.extra.some((f) => lower.includes(f))) return true;
  if (c.scrubIp && IP_KEYS.has(lower)) return true;
  return false;
}

/** Redact embedded secrets (credit cards, SSNs, bearer tokens) from a free-text
 * string. Exported so non-event free text (e.g. a user-feedback message) can be
 * scrubbed consistently with event payloads when a project enables PII scrubbing. */
export function scrubString(value: string): string {
  return value
    .replace(CREDIT_CARD, REDACTED)
    .replace(SSN, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`);
}

function scrubValue(value: unknown, depth: number, c: CompiledScrub): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1, c));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = keyIsSensitive(key, c) ? REDACTED : scrubValue(val, depth + 1, c);
    }
    return out;
  }
  return value;
}

/** Return a scrubbed deep copy of an event payload, applying the project's options. */
export function scrubPayload(payload: unknown, opts?: ScrubOptions | null): unknown {
  return scrubValue(payload, 0, compile(opts));
}
