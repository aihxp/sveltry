import { describe, expect, test } from 'bun:test';
import {
  assertResolvedHostSafe,
  assertSafeOutboundTarget,
  embeddedIpv4,
  isBlockedHost,
  isIpLiteral,
} from '../src/ssrf.js';

describe('embeddedIpv4', () => {
  test('extracts IPv4 from dotted and IPv4-mapped IPv6 forms', () => {
    expect(embeddedIpv4('169.254.169.254')).toBe('169.254.169.254');
    expect(embeddedIpv4('::ffff:169.254.169.254')).toBe('169.254.169.254');
    // URL-normalized IPv4-mapped form (hex groups): a9fe.a9fe == 169.254.169.254
    expect(embeddedIpv4('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
    expect(embeddedIpv4('example.com')).toBeNull();
  });
});

describe('isBlockedHost', () => {
  test('blocks cloud-metadata names and IPs in every encoding', () => {
    expect(isBlockedHost('metadata.google.internal')).toBe(true);
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    // The IPv4-mapped IPv6 bypass the string denylist missed:
    expect(isBlockedHost('[::ffff:a9fe:a9fe]')).toBe(true);
    expect(isBlockedHost('::ffff:169.254.169.254')).toBe(true);
    // Whole link-local /16, not just the single IMDS IP:
    expect(isBlockedHost('169.254.1.1')).toBe(true);
    expect(isBlockedHost('fd00:ec2::254')).toBe(true);
    expect(isBlockedHost('fe80::1')).toBe(true);
  });

  test('allows public and RFC1918 private hosts', () => {
    expect(isBlockedHost('hooks.slack.com')).toBe(false);
    expect(isBlockedHost('10.0.0.5')).toBe(false);
    expect(isBlockedHost('192.168.1.10')).toBe(false);
    expect(isBlockedHost('172.16.3.4')).toBe(false);
  });
});

describe('assertSafeOutboundTarget', () => {
  test('rejects non-http(s) schemes and blocked hosts', () => {
    expect(() => assertSafeOutboundTarget('ftp://example.com')).toThrow();
    expect(() => assertSafeOutboundTarget('http://169.254.169.254/latest')).toThrow();
    expect(() => assertSafeOutboundTarget('http://[::ffff:169.254.169.254]/latest')).toThrow();
    expect(() => assertSafeOutboundTarget('not a url')).toThrow();
  });

  test('accepts a normal https target', () => {
    expect(() =>
      assertSafeOutboundTarget('https://acme.atlassian.net/rest/api/3/issue'),
    ).not.toThrow();
  });
});

describe('isIpLiteral', () => {
  test('detects IPv4 / IPv6 literals but not hostnames', () => {
    expect(isIpLiteral('169.254.169.254')).toBe(true);
    expect(isIpLiteral('::ffff:a9fe:a9fe')).toBe(true);
    expect(isIpLiteral('2001:db8::1')).toBe(true);
    expect(isIpLiteral('[fe80::1]')).toBe(true);
    expect(isIpLiteral('example.com')).toBe(false);
    expect(isIpLiteral('hooks.slack.com')).toBe(false);
  });
});

describe('assertResolvedHostSafe (DNS-rebinding guard)', () => {
  const resolveTo = (ips: string[]) => async (): Promise<string[]> => ips;

  test('rejects a hostname whose record is a blocked IP', async () => {
    await expect(
      assertResolvedHostSafe('attacker.example', resolveTo(['169.254.169.254'])),
    ).rejects.toThrow();
  });

  test('rejects when ANY resolved address is blocked (mixed A/AAAA)', async () => {
    await expect(
      assertResolvedHostSafe('mix.example', resolveTo(['93.184.216.34', 'fd00:ec2::254'])),
    ).rejects.toThrow();
  });

  test('allows public and RFC1918 resolutions', async () => {
    await expect(
      assertResolvedHostSafe('ok.example', resolveTo(['93.184.216.34'])),
    ).resolves.toBeUndefined();
    await expect(
      assertResolvedHostSafe('internal.example', resolveTo(['10.0.0.5'])),
    ).resolves.toBeUndefined();
  });

  test('fails OPEN on a resolver error (availability)', async () => {
    const boom = async (): Promise<string[]> => {
      throw new Error('resolver down');
    };
    await expect(assertResolvedHostSafe('flaky.example', boom)).resolves.toBeUndefined();
  });

  test('skips resolution for an IP literal (already covered by isBlockedHost)', async () => {
    let called = false;
    const spy = async (): Promise<string[]> => {
      called = true;
      return [];
    };
    await assertResolvedHostSafe('203.0.113.7', spy);
    expect(called).toBe(false);
  });
});
