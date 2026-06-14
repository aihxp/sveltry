/**
 * Outbound-request SSRF guard. Every server-side fetch to a user-influenced target
 * (alert webhooks, tracker `siteUrl`) is validated against this. The goal is narrow
 * and deliberate: block cloud instance-metadata endpoints and link-local space,
 * while leaving RFC1918 private networks reachable on purpose (self-hosters point
 * alerts at internal proxies/relays). Pure and unit-tested; the actual fetch (with
 * per-redirect-hop re-validation) lives in the backend.
 */

/** Strip surrounding brackets from an IPv6 literal host. */
function unbracket(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * If `host` is an IPv4 address, an IPv4-mapped IPv6 (`::ffff:a.b.c.d` or the
 * URL-normalized `::ffff:HHHH:HHHH`), return the dotted IPv4; otherwise null.
 */
export function embeddedIpv4(host: string): string | null {
  const dotted = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) return host;
  const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mappedDotted) return mappedDotted[1]!;
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

/**
 * Whether a URL host points at a blocked target: cloud-metadata names, the
 * 169.254.0.0/16 link-local range (which includes the AWS/GCP IMDS IP in any
 * encoding), IPv6 link-local, and the EC2 IMDS IPv6. RFC1918 is intentionally
 * allowed.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = unbracket(hostname.toLowerCase());
  if (h === 'metadata.google.internal') return true;
  if (h === 'fd00:ec2::254') return true;
  if (h.startsWith('fe80:')) return true; // IPv6 link-local
  const v4 = embeddedIpv4(h);
  if (v4) {
    const o = v4.split('.').map(Number);
    if (o.length === 4 && o[0] === 169 && o[1] === 254) return true; // link-local /16
  }
  return false;
}

/** Reject non-http(s) schemes and blocked hosts. Throws on an unsafe target. */
export function assertSafeOutboundTarget(target: string): void {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error('invalid url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`unsupported scheme: ${url.protocol}`);
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error('target host is not allowed');
  }
}
