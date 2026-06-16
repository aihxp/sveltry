import { describe, expect, test } from 'bun:test';
import { httpUrlOnly } from '../src/url.js';

describe('httpUrlOnly', () => {
  test('keeps http(s) URLs', () => {
    expect(httpUrlOnly('https://github.com/o/r/commit/abc')).toBe(
      'https://github.com/o/r/commit/abc',
    );
    expect(httpUrlOnly('http://example.com/x')).toBe('http://example.com/x');
  });
  test('drops dangerous schemes (defeats stored XSS)', () => {
    expect(httpUrlOnly('javascript:alert(document.cookie)')).toBeUndefined();
    expect(httpUrlOnly('data:text/html,<script>1</script>')).toBeUndefined();
    expect(httpUrlOnly('vbscript:msgbox(1)')).toBeUndefined();
    expect(httpUrlOnly('file:///etc/passwd')).toBeUndefined();
  });
  test('drops non-strings and malformed URLs', () => {
    expect(httpUrlOnly(undefined)).toBeUndefined();
    expect(httpUrlOnly(123)).toBeUndefined();
    expect(httpUrlOnly('not a url')).toBeUndefined();
    expect(httpUrlOnly('')).toBeUndefined();
  });
});
