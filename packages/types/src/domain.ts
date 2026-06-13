/**
 * The Sveltry domain model: the normalized, storage-facing shapes that the
 * Convex backend persists and the dashboard renders. These are framework- and
 * database-agnostic so they can be shared across the SDK, backend, and UI.
 */

import type { SentryLevel } from './sentry.js';

/** Severity of an issue/event, aligned with Sentry's level vocabulary. */
export type IssueLevel = SentryLevel;

/** The platform an event originated from. */
export type Platform =
  | 'javascript'
  | 'node'
  | 'python'
  | 'ruby'
  | 'go'
  | 'java'
  | 'php'
  | 'csharp'
  | 'rust'
  | 'cocoa'
  | 'android'
  | 'other'
  | (string & {});

/**
 * The lifecycle status of an issue. Mirrors Sentry's triage workflow:
 * a primary status plus a substatus that captures automatic transitions.
 */
export type IssueStatus = 'unresolved' | 'resolved' | 'ignored';

export type IssueSubstatus =
  | 'new'
  | 'ongoing'
  | 'escalating'
  | 'regressed'
  | 'archived_until_escalating'
  | 'archived_forever';

/** A grouped issue: many events with the same fingerprint roll up into one. */
export interface Issue {
  id: string;
  projectId: string;
  organizationId: string;
  /** Stable grouping hash; see {@link IssueGrouping}. */
  fingerprint: string;
  /** Version of the grouping algorithm that produced `fingerprint`. */
  groupingConfig: string;
  title: string;
  /** The file/function/route blamed for the issue. */
  culprit: string;
  level: IssueLevel;
  platform: Platform;
  status: IssueStatus;
  substatus: IssueSubstatus;
  /** Number of events seen. */
  count: number;
  /** Approximate number of distinct users affected. */
  userCount: number;
  firstSeen: number;
  lastSeen: number;
  /** The release in which the issue was marked resolved, if any. */
  resolvedInRelease?: string;
  /** Epoch ms until which alerts are snoozed (ignore-for-duration). */
  snoozeUntil?: number;
  assigneeId?: string;
  /** The exception type, e.g. `TypeError`. */
  errorType?: string;
}

/** A single occurrence of an issue. The full Sentry payload lives in `payload`. */
export interface EventRecord {
  id: string;
  issueId: string;
  projectId: string;
  organizationId: string;
  /** The SDK-provided or server-generated 32-char hex id. */
  eventId: string;
  timestamp: number;
  receivedAt: number;
  level: IssueLevel;
  platform: Platform;
  environment: string;
  release?: string;
  message: string;
  /** Searchable, indexed key/value tags. */
  tags: Record<string, string>;
  /** Full normalized Sentry event payload (the "nodestore" blob). */
  payload: unknown;
}

/** A monitored project. Owns one or more DSN keys. */
export interface Project {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  platform: Platform;
  /** A numeric public id used in DSNs (Sentry SDKs expect `/api/<id>/`). */
  publicId: string;
  createdAt: number;
  /** Retention window for events, in days. */
  eventRetentionDays: number;
  /** Whether to apply default PII scrubbing at ingest. */
  scrubPii: boolean;
}

/** A DSN key: the credential an SDK uses to authenticate ingestion. */
export interface ProjectKey {
  id: string;
  projectId: string;
  organizationId: string;
  label: string;
  /** The DSN public key (`sentry_key`). */
  publicKey: string;
  isActive: boolean;
  createdAt: number;
  /** Optional per-key rate limit: max events per window. */
  rateLimitCount?: number;
  rateLimitWindowSeconds?: number;
}

/** A release/version that events can be associated with. */
export interface Release {
  id: string;
  organizationId: string;
  projectId: string;
  version: string;
  ref?: string;
  url?: string;
  createdAt: number;
  firstEventAt?: number;
  lastEventAt?: number;
}

/** What kind of trigger fires an alert rule. */
export type AlertTrigger = 'new_issue' | 'regression' | 'event_frequency';

/** Where an alert is delivered. */
export type AlertChannelType = 'webhook' | 'discord' | 'slack' | 'email';

export interface AlertChannel {
  type: AlertChannelType;
  /** Webhook/Discord/Slack URL, or an email address. */
  target: string;
}

/** A rule that turns issue activity into a notification. */
export interface AlertRule {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  trigger: AlertTrigger;
  /** For `event_frequency`: fire when count >= threshold within windowMinutes. */
  threshold?: number;
  windowMinutes?: number;
  /** Only fire for issues at or above this level. */
  minLevel?: IssueLevel;
  channels: AlertChannel[];
  isEnabled: boolean;
  createdAt: number;
}

/** An organization (the multi-tenancy boundary; identity is owned by Better Auth). */
export interface Organization {
  id: string;
  /** The Better Auth organization id this maps to. */
  slug: string;
  name: string;
  createdAt: number;
}

/** The result of grouping an event into an issue. */
export interface IssueGrouping {
  fingerprint: string;
  groupingConfig: string;
  title: string;
  culprit: string;
  errorType?: string;
}

/** The normalized event Sveltry stores, distilled from a raw Sentry payload. */
export interface NormalizedEvent {
  eventId: string;
  timestamp: number;
  level: IssueLevel;
  platform: Platform;
  environment: string;
  release?: string;
  message: string;
  culprit: string;
  errorType?: string;
  tags: Record<string, string>;
  userId?: string;
  /** The original Sentry payload, retained verbatim. */
  raw: unknown;
}
