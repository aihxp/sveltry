import { describe, expect, test } from 'bun:test';
import { coerceEventId, generateEventId, isEventId } from '../src/ids.js';

describe('event ids', () => {
  test('generateEventId produces 32 hex chars', () => {
    const id = generateEventId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(isEventId(id)).toBe(true);
  });

  test('isEventId rejects malformed ids', () => {
    expect(isEventId('too-short')).toBe(false);
    expect(isEventId('9ec79c33-ec99-42ab-8353-589fcb2e04dc')).toBe(false); // dashes
  });

  test('coerceEventId normalizes dashed/uppercase ids and falls back when invalid', () => {
    expect(coerceEventId('9EC79C33-EC99-42AB-8353-589FCB2E04DC')).toBe(
      '9ec79c33ec9942ab8353589fcb2e04dc',
    );
    expect(isEventId(coerceEventId('garbage'))).toBe(true);
    expect(isEventId(coerceEventId(undefined))).toBe(true);
  });
});
