/**
 * Types describing the subset of the Sentry wire protocol that Sveltry ingests.
 *
 * These mirror the canonical schemas documented at
 * https://develop.sentry.dev/sdk/data-model/event-payloads/ and
 * https://develop.sentry.dev/sdk/data-model/envelopes/. They are intentionally
 * permissive (most fields optional, unknown fields allowed) so that events from
 * any official Sentry SDK version are accepted.
 */

/** Severity levels used by Sentry events and breadcrumbs. */
export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/** The parsed components of a Sentry DSN. */
export interface DsnComponents {
  /** URL scheme, e.g. `https`. */
  protocol: string;
  /** The public key (the only credential a backend must validate). */
  publicKey: string;
  /** Deprecated secret key; accepted but ignored. */
  secretKey?: string;
  /** Ingest host, e.g. `sveltry.example.com`. */
  host: string;
  /** Optional port. */
  port?: string;
  /** Optional path prefix that precedes `/api/...`. */
  path?: string;
  /** The trailing project identifier. */
  projectId: string;
}

/** A single stack frame. Frames are ordered oldest-to-newest (raise site is last). */
export interface SentryStackFrame {
  filename?: string;
  function?: string;
  raw_function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  abs_path?: string;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app?: boolean;
  vars?: Record<string, unknown>;
  package?: string;
  platform?: string;
  instruction_addr?: string;
  addr_mode?: string;
  symbol_addr?: string;
  image_addr?: string;
  [key: string]: unknown;
}

export interface SentryStacktrace {
  frames?: SentryStackFrame[];
  registers?: Record<string, string>;
  [key: string]: unknown;
}

export interface SentryExceptionMechanism {
  type: string;
  handled?: boolean;
  synthetic?: boolean;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SentryException {
  type?: string;
  value?: string;
  module?: string;
  thread_id?: number | string;
  mechanism?: SentryExceptionMechanism;
  stacktrace?: SentryStacktrace;
  [key: string]: unknown;
}

export interface SentryBreadcrumb {
  timestamp?: number | string;
  type?: string;
  category?: string;
  message?: string;
  level?: SentryLevel;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SentryUser {
  id?: string;
  email?: string;
  username?: string;
  ip_address?: string;
  [key: string]: unknown;
}

export interface SentryRequest {
  url?: string;
  method?: string;
  query_string?: string | Record<string, string>;
  headers?: Record<string, string>;
  data?: unknown;
  [key: string]: unknown;
}

export interface SentrySdkInfo {
  name?: string;
  version?: string;
  integrations?: string[];
  packages?: Array<{ name: string; version: string }>;
  [key: string]: unknown;
}

/** A span within a transaction (a timed unit of work). */
export interface SentrySpan {
  span_id?: string;
  parent_span_id?: string;
  trace_id?: string;
  op?: string;
  description?: string;
  status?: string;
  /** Unix epoch seconds (or RFC 3339). */
  start_timestamp?: number | string;
  timestamp?: number | string;
  data?: Record<string, unknown>;
  tags?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * A Sentry error/default event payload. This is the JSON carried by an
 * envelope item with `type: "event"` (or the whole body of a legacy `/store/`
 * request). Transaction items (`type: "transaction"`) reuse this shape and add
 * `start_timestamp` and `spans`.
 */
export interface SentryEventPayload {
  /** 32-char hex UUID (no dashes). */
  event_id?: string;
  /** For transactions: the event type discriminator. */
  type?: string;
  /** RFC 3339 string or Unix epoch seconds (the end time for a transaction). */
  timestamp?: number | string;
  /** Transaction start time (Unix epoch seconds or RFC 3339). */
  start_timestamp?: number | string;
  /** The spans of a transaction. */
  spans?: SentrySpan[];
  platform?: string;
  level?: SentryLevel;
  logger?: string;
  transaction?: string;
  server_name?: string;
  release?: string;
  dist?: string;
  environment?: string;
  message?: string | { message?: string; formatted?: string; params?: unknown[] };
  culprit?: string;
  fingerprint?: string[];
  tags?: Record<string, string | number | boolean | null> | Array<[string, string]>;
  extra?: Record<string, unknown>;
  modules?: Record<string, string>;
  exception?: { values?: SentryException[] } | SentryException[];
  threads?: { values?: unknown[] };
  breadcrumbs?: { values?: SentryBreadcrumb[] } | SentryBreadcrumb[];
  user?: SentryUser;
  request?: SentryRequest;
  contexts?: Record<string, Record<string, unknown>>;
  sdk?: SentrySdkInfo;
  debug_meta?: { images?: unknown[] };
  [key: string]: unknown;
}

/** Envelope-level header (the first line of an envelope). */
export interface EnvelopeHeader {
  event_id?: string;
  dsn?: string;
  sent_at?: string;
  sdk?: SentrySdkInfo;
  trace?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The distinct envelope item types Sveltry recognizes. */
export type EnvelopeItemType =
  | 'event'
  | 'transaction'
  | 'attachment'
  | 'session'
  | 'sessions'
  | 'client_report'
  | 'check_in'
  | 'replay_event'
  | 'replay_recording'
  | 'profile'
  | 'profile_chunk'
  | 'feedback'
  | 'user_report'
  | 'span'
  | 'log'
  | 'statsd'
  | 'metric_meta'
  | (string & {});

/** A single item header line within an envelope. */
export interface EnvelopeItemHeader {
  type: EnvelopeItemType;
  /** Byte length of the payload, when declared. */
  length?: number;
  content_type?: string;
  filename?: string;
  attachment_type?: string;
  [key: string]: unknown;
}

/** A parsed envelope item: its header plus raw payload bytes. */
export interface EnvelopeItem {
  type: EnvelopeItemType;
  header: EnvelopeItemHeader;
  payload: Uint8Array;
}

/** A fully parsed envelope. */
export interface ParsedEnvelope {
  header: EnvelopeHeader;
  items: EnvelopeItem[];
}

/** A release-health session update (envelope item `type: "session"`). */
export interface SentrySession {
  sid?: string;
  did?: string;
  init?: boolean;
  /** RFC 3339 string or Unix epoch seconds. */
  started?: number | string;
  timestamp?: number | string;
  status?: 'ok' | 'exited' | 'crashed' | 'abnormal' | 'errored';
  errors?: number;
  duration?: number;
  attrs?: {
    release?: string;
    environment?: string;
    ip_address?: string;
    user_agent?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** One time-bucketed aggregate within a `sessions` (aggregate) envelope item. */
export interface SentrySessionAggregate {
  /** Bucket start (RFC 3339 string or Unix epoch seconds). */
  started?: number | string;
  did?: string;
  exited?: number;
  errored?: number;
  crashed?: number;
  abnormal?: number;
  [key: string]: unknown;
}

/** A `sessions` (aggregate) envelope item: pre-bucketed session counts. */
export interface SentrySessionAggregates {
  attrs?: { release?: string; environment?: string; [key: string]: unknown };
  aggregates?: SentrySessionAggregate[];
  [key: string]: unknown;
}

/** A client report (SDK-side dropped-event accounting). */
export interface SentryClientReport {
  timestamp?: string;
  discarded_events?: Array<{ reason: string; category: string; quantity: number }>;
  [key: string]: unknown;
}

/** Auth fields extracted from the `X-Sentry-Auth` header or the query string. */
export interface SentryAuth {
  sentry_key?: string;
  sentry_version?: string;
  sentry_client?: string;
  sentry_secret?: string;
  [key: string]: string | undefined;
}
