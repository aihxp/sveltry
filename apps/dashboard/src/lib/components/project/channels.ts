import { type AlertChannelType } from '@sveltry/types';

/**
 * Notification channel kinds shared by alert rules, metric alerts, and usage
 * alerts. The set is the single shared `ALERT_CHANNEL_TYPES` source (which also
 * drives the Convex `alertChannelValidator`), so the two stay in lockstep.
 */
export type ChannelType = AlertChannelType;

// Display order + labels for the UI. Typed as `Record<ChannelType, ...>`, so a
// channel added to the shared `ALERT_CHANNEL_TYPES` set forces a label here at
// compile time (and a removed one fails the build) -- no silent drift.
const CHANNEL_LABELS: Record<ChannelType, string> = {
  webhook: 'Webhook',
  slack: 'Slack',
  discord: 'Discord',
  email: 'Email',
  msteams: 'MS Teams',
  pagerduty: 'PagerDuty (routing key)',
  opsgenie: 'Opsgenie (API key)',
};

const DISPLAY_ORDER: ChannelType[] = [
  'webhook',
  'slack',
  'discord',
  'email',
  'msteams',
  'pagerduty',
  'opsgenie',
];

export const CHANNEL_OPTIONS: { value: ChannelType; label: string }[] = DISPLAY_ORDER.map(
  (value) => ({ value, label: CHANNEL_LABELS[value] }),
);
