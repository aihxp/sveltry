import type {
  EnvelopeHeader,
  EnvelopeItem,
  EnvelopeItemHeader,
  ParsedEnvelope,
  SentryEventPayload,
} from '@sveltry/types';

const NEWLINE = 0x0a; // ASCII '\n'

export class EnvelopeParseError extends Error {
  constructor(
    message: string,
    readonly causes: string[] = [],
  ) {
    super(message);
    this.name = 'EnvelopeParseError';
  }
}

const decoder = new TextDecoder();

/**
 * Parse a Sentry envelope from raw bytes, honoring the strict newline framing
 * and the optional item-header `length` field.
 *
 * Grammar (https://develop.sentry.dev/sdk/data-model/envelopes/):
 *   Envelope = Headers { "\n" Item } [ "\n" ]
 *   Item     = Headers "\n" Payload
 *
 * - Newlines are strictly Unix `\n` (0x0A); a `\r` before `\n` is payload.
 * - If an item header declares `length`, exactly that many bytes are the
 *   payload (then one trailing `\n` is consumed). Otherwise the payload runs to
 *   the next `\n`, so length-less payloads cannot contain newlines.
 * - The parser operates on bytes; only the header lines are decoded as UTF-8.
 * - Unknown item types are preserved (the caller decides what to skip), so
 *   envelopes from any SDK version round-trip.
 */
export function parseEnvelope(raw: Uint8Array): ParsedEnvelope {
  let pos = 0;

  const readLine = (): Uint8Array => {
    const nl = raw.indexOf(NEWLINE, pos);
    if (nl === -1) {
      const line = raw.subarray(pos);
      pos = raw.length;
      return line;
    }
    const line = raw.subarray(pos, nl);
    pos = nl + 1;
    return line;
  };

  const parseJson = <T>(line: Uint8Array, what: string): T => {
    const text = decoder.decode(line).trim();
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new EnvelopeParseError('invalid envelope', [
        `failed to parse ${what}`,
        err instanceof Error ? err.message : String(err),
      ]);
    }
  };

  if (raw.length === 0) {
    return { header: {}, items: [] };
  }

  const header = parseJson<EnvelopeHeader>(readLine(), 'envelope header');
  const items: EnvelopeItem[] = [];

  while (pos < raw.length) {
    // Tolerate blank separator lines / trailing newline.
    if (raw[pos] === NEWLINE) {
      pos += 1;
      continue;
    }

    const itemHeader = parseJson<EnvelopeItemHeader>(readLine(), 'item header');

    let payload: Uint8Array;
    if (typeof itemHeader.length === 'number' && Number.isFinite(itemHeader.length)) {
      const end = pos + itemHeader.length;
      if (end > raw.length) {
        throw new EnvelopeParseError('invalid envelope', [
          `item declares length ${itemHeader.length} but only ${raw.length - pos} bytes remain`,
        ]);
      }
      payload = raw.subarray(pos, end);
      pos = end;
      // Consume the single separator newline that follows a length-delimited payload.
      if (pos < raw.length && raw[pos] === NEWLINE) pos += 1;
    } else {
      payload = readLine();
    }

    items.push({
      type: itemHeader.type,
      header: itemHeader,
      payload,
    });
  }

  return { header, items };
}

/** Decode an item's payload as JSON. */
export function decodeItemJson<T = unknown>(item: EnvelopeItem): T {
  const text = decoder.decode(item.payload).trim();
  return JSON.parse(text) as T;
}

/**
 * Find and decode the first error/default event in an envelope, if any.
 * Transactions, sessions, attachments, etc. are ignored here (handled
 * separately by the ingest pipeline).
 */
export function firstEvent(env: ParsedEnvelope): SentryEventPayload | null {
  for (const item of env.items) {
    if (item.type === 'event') {
      try {
        return decodeItemJson<SentryEventPayload>(item);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Count items by type, useful for client-report accounting and metrics. */
export function itemTypeCounts(env: ParsedEnvelope): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of env.items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }
  return counts;
}
