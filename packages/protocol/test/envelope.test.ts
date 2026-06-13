import { describe, expect, test } from 'bun:test';
import { decodeItemJson, firstEvent, itemTypeCounts, parseEnvelope } from '../src/envelope.js';

const enc = new TextEncoder();

function concat(...chunks: (Uint8Array | string)[]): Uint8Array {
  const parts = chunks.map((c) => (typeof c === 'string' ? enc.encode(c) : c));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('parseEnvelope', () => {
  test('parses the canonical attachment + event fixture with binary, newline-containing payload', () => {
    const eventPayload = '{"message":"hello world","level":"error"}';
    const eventLen = enc.encode(eventPayload).length;
    const raw = concat(
      '{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc","dsn":"https://e12d836b15bb49d7bbf99e64295d995b@sentry.io/42"}\n',
      '{"type":"attachment","length":10,"content_type":"text/plain","filename":"hello.txt"}\n',
      new Uint8Array([0xef, 0xbb, 0xbf]), // UTF-8 BOM
      'Hello\r\n', // 7 bytes; 3 (BOM) + 7 = 10 = declared length
      '\n', // separator after length-delimited payload
      `{"type":"event","length":${eventLen},"content_type":"application/json"}\n`,
      eventPayload,
      '\n',
    );

    const env = parseEnvelope(raw);
    expect(env.header.event_id).toBe('9ec79c33ec9942ab8353589fcb2e04dc');
    expect(env.items).toHaveLength(2);

    const [attachment, event] = env.items;
    expect(attachment!.type).toBe('attachment');
    expect(attachment!.payload).toHaveLength(10);
    // The \r\n is part of the payload, not a separator.
    expect(Array.from(attachment!.payload.subarray(3))).toEqual(
      Array.from(enc.encode('Hello\r\n')),
    );

    expect(event!.type).toBe('event');
    expect(decodeItemJson<{ message: string; level: string }>(event!)).toEqual({
      message: 'hello world',
      level: 'error',
    });
  });

  test('handles items with implicit length (payload runs to next newline)', () => {
    const raw = concat('{"event_id":"abc"}\n', '{"type":"attachment"}\n', 'helloworld\n');
    const env = parseEnvelope(raw);
    expect(env.items).toHaveLength(1);
    expect(new TextDecoder().decode(env.items[0]!.payload)).toBe('helloworld');
  });

  test('parses a realistic error event envelope and extracts the first event', () => {
    const header =
      '{"event_id":"771a43a4192642f0b136d5159a501700","sent_at":"2026-06-13T14:16:00.000Z","sdk":{"name":"sentry.javascript.sveltekit","version":"10.57.0"}}';
    const eventJson = JSON.stringify({
      event_id: '771a43a4192642f0b136d5159a501700',
      timestamp: 1781705760.0,
      platform: 'javascript',
      level: 'error',
      exception: {
        values: [
          {
            type: 'TypeError',
            value: "Cannot read properties of undefined (reading 'id')",
            stacktrace: {
              frames: [
                { filename: 'app:///src/routes/+page.svelte', function: 'load', in_app: true },
              ],
            },
          },
        ],
      },
    });
    const raw = concat(header, '\n', '{"type":"event"}\n', eventJson, '\n');

    const env = parseEnvelope(raw);
    expect(itemTypeCounts(env)).toEqual({ event: 1 });
    const event = firstEvent(env);
    expect(event?.platform).toBe('javascript');
    expect(
      Array.isArray(event?.exception)
        ? undefined
        : (event?.exception as { values?: unknown[] }).values,
    ).toHaveLength(1);
  });

  test('tolerates blank separator lines and an empty envelope', () => {
    expect(parseEnvelope(new Uint8Array())).toEqual({ header: {}, items: [] });
    const raw = concat('{}\n', '\n', '{"type":"session"}\n', '{"sid":"x"}\n');
    const env = parseEnvelope(raw);
    expect(env.items).toHaveLength(1);
    expect(env.items[0]!.type).toBe('session');
  });

  test('throws on a truncated length-delimited item', () => {
    const raw = concat('{}\n', '{"type":"attachment","length":100}\n', 'short');
    expect(() => parseEnvelope(raw)).toThrow();
  });
});
