/**
 * Helpers for the Sentry replay recording wire format. A `replay_recording`
 * envelope item's payload is a JSON headers line, a newline, then the rrweb
 * event stream (usually zlib/gzip compressed by the SDK).
 */

const NEWLINE = 0x0a;

export interface ReplayRecordingParts {
  /** The parsed recording header, e.g. `{ segment_id: 0 }`. */
  header: Record<string, unknown>;
  /** The recording body bytes (the rrweb stream, possibly compressed). */
  body: Uint8Array;
}

/** Split a `replay_recording` payload into its header and body. */
export function splitReplayRecording(payload: Uint8Array): ReplayRecordingParts {
  const nl = payload.indexOf(NEWLINE);
  if (nl === -1) return { header: {}, body: payload };
  let header: Record<string, unknown> = {};
  try {
    header = JSON.parse(new TextDecoder().decode(payload.subarray(0, nl)));
  } catch {
    header = {};
  }
  return { header, body: payload.subarray(nl + 1) };
}

/**
 * Guess the compression of a replay recording body from its magic bytes:
 * gzip (1f 8b), zlib/deflate (78 ..), otherwise none.
 */
export function recordingEncoding(body: Uint8Array): 'gzip' | 'deflate' | null {
  if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) return 'gzip';
  if (body.length >= 2 && body[0] === 0x78) return 'deflate';
  return null;
}
