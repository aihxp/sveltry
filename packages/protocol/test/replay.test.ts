import { describe, expect, test } from 'bun:test';
import { recordingEncoding, splitReplayRecording } from '../src/replay.js';

const enc = (s: string) => new TextEncoder().encode(s);

describe('splitReplayRecording', () => {
  test('splits the header line from the body', () => {
    const payload = enc('{"segment_id":3}\n[{"type":4}]');
    const { header, body } = splitReplayRecording(payload);
    expect(header).toEqual({ segment_id: 3 });
    expect(new TextDecoder().decode(body)).toBe('[{"type":4}]');
  });

  test('handles a payload with no header newline', () => {
    const payload = enc('[{"type":2}]');
    const { header, body } = splitReplayRecording(payload);
    expect(header).toEqual({});
    expect(new TextDecoder().decode(body)).toBe('[{"type":2}]');
  });
});

describe('recordingEncoding', () => {
  test('detects gzip, zlib, and none from magic bytes', () => {
    expect(recordingEncoding(new Uint8Array([0x1f, 0x8b, 0x08]))).toBe('gzip');
    expect(recordingEncoding(new Uint8Array([0x78, 0x9c]))).toBe('deflate');
    expect(recordingEncoding(enc('[{'))).toBeNull();
  });
});
