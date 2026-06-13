import { describe, expect, test } from 'bun:test';
import { sha1Hex } from '../src/hash.js';

describe('sha1Hex', () => {
  test('known vectors', () => {
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1Hex('The quick brown fox jumps over the lazy dog')).toBe(
      '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
    );
  });

  test('is deterministic and unicode-safe', () => {
    expect(sha1Hex('héllo -> world')).toBe(sha1Hex('héllo -> world'));
    expect(sha1Hex('a')).not.toBe(sha1Hex('b'));
  });

  test('handles input that crosses block boundaries', () => {
    const long = 'x'.repeat(1000);
    expect(sha1Hex(long)).toHaveLength(40);
    expect(sha1Hex(long)).toMatch(/^[0-9a-f]{40}$/);
  });
});
