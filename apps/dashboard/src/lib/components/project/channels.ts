/** Notification channel kinds shared by alert rules, metric alerts, and usage alerts. */
export type ChannelType =
  | 'webhook'
  | 'discord'
  | 'slack'
  | 'email'
  | 'msteams'
  | 'pagerduty'
  | 'opsgenie';

export const CHANNEL_OPTIONS: { value: ChannelType; label: string }[] = [
  { value: 'webhook', label: 'Webhook' },
  { value: 'slack', label: 'Slack' },
  { value: 'discord', label: 'Discord' },
  { value: 'email', label: 'Email' },
  { value: 'msteams', label: 'MS Teams' },
  { value: 'pagerduty', label: 'PagerDuty (routing key)' },
  { value: 'opsgenie', label: 'Opsgenie (API key)' },
];
