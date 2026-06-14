/**
 * Notification channel request builders. Given a channel and a generic
 * `{ title, text, severity }`, produce the HTTP request (url, headers, body) for
 * that provider. Pure and unit-tested so the backend's alert delivery (both
 * issue alerts and metric alerts) can share one formatter. Email is handled
 * separately (it needs an SMTP transport, not an HTTP POST).
 */

export interface NotificationContent {
  title: string;
  text: string;
  /** 'error' raises severity for PagerDuty/Opsgenie/Teams color; default 'warning'. */
  severity?: 'error' | 'warning';
  url?: string;
}

export interface ChannelRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Build the outbound request for a channel, or null for unknown/email types. */
export function channelRequest(
  channel: { type: string; target: string },
  m: NotificationContent,
): ChannelRequest | null {
  const json = { 'content-type': 'application/json' };
  const isError = m.severity === 'error';
  const line = m.url ? `${m.text}\n${m.url}` : m.text;

  switch (channel.type) {
    case 'webhook':
      return {
        url: channel.target,
        headers: json,
        body: JSON.stringify({ ...m, source: 'sveltry' }),
      };
    case 'slack':
      return {
        url: channel.target,
        headers: json,
        body: JSON.stringify({ text: `${m.title}\n${line}` }),
      };
    case 'discord':
      return {
        url: channel.target,
        headers: json,
        body: JSON.stringify({ content: `**${m.title}**\n${line}` }),
      };
    case 'msteams':
      return {
        url: channel.target,
        headers: json,
        body: JSON.stringify({
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          summary: m.title,
          themeColor: isError ? 'EF4444' : 'F59E0B',
          title: m.title,
          text: line,
        }),
      };
    case 'pagerduty':
      return {
        url: 'https://events.pagerduty.com/v2/enqueue',
        headers: json,
        body: JSON.stringify({
          routing_key: channel.target,
          event_action: 'trigger',
          payload: {
            summary: `${m.title}: ${m.text}`.slice(0, 1024),
            source: 'sveltry',
            severity: isError ? 'error' : 'warning',
          },
          links: m.url ? [{ href: m.url, text: 'View in Sveltry' }] : undefined,
        }),
      };
    case 'opsgenie':
      return {
        url: 'https://api.opsgenie.com/v2/alerts',
        headers: { ...json, authorization: `GenieKey ${channel.target}` },
        body: JSON.stringify({
          message: m.title.slice(0, 130),
          description: line,
          priority: isError ? 'P2' : 'P3',
        }),
      };
    default:
      return null; // email or unknown
  }
}
