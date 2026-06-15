import { describe, expect, test } from 'bun:test';
import { scrubPayload } from '../src/scrub.js';

describe('scrubPayload - default ruleset (back-compat)', () => {
  test('redacts values under sensitive key names', () => {
    const out = scrubPayload({ password: 'hunter2', token: 'abc', name: 'Ada' }) as Record<
      string,
      unknown
    >;
    expect(out.password).toBe('[Filtered]');
    expect(out.token).toBe('[Filtered]');
    expect(out.name).toBe('Ada');
  });

  test('redacts secret patterns inside strings', () => {
    const out = scrubPayload({
      note: 'card 4111 1111 1111 1111 on file',
      ssn: '123-45-6789',
      header: 'Bearer abc.def.ghi',
    }) as Record<string, unknown>;
    // `ssn` is also a sensitive key, so the whole value is filtered.
    expect(out.ssn).toBe('[Filtered]');
    expect(out.note).toBe('card [Filtered] on file');
    // `header` is not a sensitive key name, so only the bearer pattern is scrubbed.
    expect(out.header).toBe('Bearer [Filtered]');
  });

  test('recurses into nested objects and arrays', () => {
    const out = scrubPayload({
      user: { password: 'x', profile: { api_key: 'k' } },
      list: [{ secret: 's' }, { ok: 1 }],
    }) as any;
    expect(out.user.password).toBe('[Filtered]');
    expect(out.user.profile.api_key).toBe('[Filtered]');
    expect(out.list[0].secret).toBe('[Filtered]');
    expect(out.list[1].ok).toBe(1);
  });

  test('no options behaves exactly as before', () => {
    const payload = { phone: '555-1234', ip_address: '1.2.3.4', auth_method: 'sso' };
    const out = scrubPayload(payload) as Record<string, unknown>;
    expect(out.phone).toBe('555-1234'); // not a default sensitive key
    expect(out.ip_address).toBe('1.2.3.4'); // not scrubbed unless scrubIp
    expect(out.auth_method).toBe('[Filtered]'); // matches default `auth`
  });
});

describe('scrubPayload - extra sensitive fields', () => {
  test('redacts additional key-name substrings (case-insensitive)', () => {
    const out = scrubPayload(
      { phone: '555-1234', home_address: '1 Main St', name: 'Ada' },
      { extraFields: ['phone', 'address'] },
    ) as Record<string, unknown>;
    expect(out.phone).toBe('[Filtered]');
    expect(out.home_address).toBe('[Filtered]');
    expect(out.name).toBe('Ada');
  });
});

describe('scrubPayload - safe fields (allowlist)', () => {
  test('a safe field is never redacted, even if it matches a default rule', () => {
    const out = scrubPayload(
      { auth_method: 'sso', password: 'x' },
      { safeFields: ['auth_method'] },
    ) as Record<string, unknown>;
    expect(out.auth_method).toBe('sso'); // exempted despite matching `auth`
    expect(out.password).toBe('[Filtered]'); // still scrubbed
  });

  test('safe field wins over extra fields too', () => {
    const out = scrubPayload(
      { phone_type: 'mobile', phone_number: '555' },
      { extraFields: ['phone'], safeFields: ['phone_type'] },
    ) as Record<string, unknown>;
    expect(out.phone_type).toBe('mobile');
    expect(out.phone_number).toBe('[Filtered]');
  });
});

describe('scrubPayload - IP addresses', () => {
  test('scrubIp redacts IP-address fields', () => {
    const payload = {
      user: { ip_address: '203.0.113.5', id: '42' },
      request: { env: { REMOTE_ADDR: '203.0.113.9' } },
    };
    const out = scrubPayload(payload, { scrubIp: true }) as any;
    expect(out.user.ip_address).toBe('[Filtered]');
    expect(out.request.env.REMOTE_ADDR).toBe('[Filtered]');
    expect(out.user.id).toBe('42');
  });

  test('without scrubIp, IP fields are preserved', () => {
    const out = scrubPayload({ ip_address: '203.0.113.5' }) as Record<string, unknown>;
    expect(out.ip_address).toBe('203.0.113.5');
  });

  test('"ip"-like substrings in unrelated keys are not over-scrubbed', () => {
    const out = scrubPayload({ zip: '90210', description: 'x' }, { scrubIp: true }) as Record<
      string,
      unknown
    >;
    expect(out.zip).toBe('90210');
    expect(out.description).toBe('x');
  });
});
