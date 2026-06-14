import type {
  IssueLevel,
  NormalizedEvent,
  NormalizedSession,
  NormalizedTransaction,
  Platform,
  SentryCheckIn,
  SentryEventPayload,
  SentryException,
  SentrySession,
  SentrySessionAggregates,
  SentryStackFrame,
} from '@sveltry/types';

/** Normalize `exception` (which may be `{values:[]}` or `[]`) to an array. */
export function exceptionValues(payload: SentryEventPayload): SentryException[] {
  const ex = payload.exception;
  if (!ex) return [];
  if (Array.isArray(ex)) return ex;
  return ex.values ?? [];
}

/** Coerce a Sentry message (string or structured) to a plain string. */
export function messageString(payload: SentryEventPayload): string {
  const m = payload.message;
  if (!m) return '';
  if (typeof m === 'string') return m;
  return m.formatted ?? m.message ?? '';
}

/** Normalize tags (object or `[key,value][]`) to a string map. */
export function normalizeTags(payload: SentryEventPayload): Record<string, string> {
  const out: Record<string, string> = {};
  const t = payload.tags;
  if (!t) return out;
  if (Array.isArray(t)) {
    for (const pair of t) {
      if (Array.isArray(pair) && pair.length >= 2 && pair[0] != null) {
        out[String(pair[0])] = String(pair[1] ?? '');
      }
    }
  } else {
    for (const [k, v] of Object.entries(t)) {
      if (v != null) out[k] = String(v);
    }
  }
  return out;
}

/** Parse a Sentry timestamp (RFC 3339 string or Unix epoch seconds) to epoch ms. */
export function timestampToMs(ts: number | string | undefined, fallback: number): number {
  if (ts == null) return fallback;
  if (typeof ts === 'number') {
    // Heuristic: values past ~year 2001 in seconds are < 1e12; ms are larger.
    return ts > 1e12 ? Math.round(ts) : Math.round(ts * 1000);
  }
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** The last "interesting" frame: prefer the deepest in-app frame, else the last frame. */
export function culpritFrame(frames: SentryStackFrame[] | undefined): SentryStackFrame | undefined {
  if (!frames || frames.length === 0) return undefined;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i]!.in_app) return frames[i];
  }
  return frames[frames.length - 1];
}

function deriveCulprit(payload: SentryEventPayload): string {
  if (payload.transaction) return payload.transaction;
  if (payload.culprit) return payload.culprit;
  const top = exceptionValues(payload)[0];
  const frame = culpritFrame(top?.stacktrace?.frames);
  if (frame) {
    const where = frame.filename ?? frame.module ?? frame.abs_path ?? '?';
    const fn = frame.function ?? '?';
    return `${fn} (${where})`;
  }
  return payload.logger ?? 'unknown';
}

function deriveTitle(payload: SentryEventPayload, errorType: string | undefined): string {
  const top = exceptionValues(payload)[0];
  if (top) {
    const type = errorType ?? top.type ?? 'Error';
    const value = top.value ?? '';
    return value ? `${type}: ${value}` : type;
  }
  const msg = messageString(payload);
  if (msg) return msg;
  return errorType ?? 'Unknown error';
}

const DEFAULT_TimestampNow = () => Date.now();

/**
 * Distill a raw Sentry event payload into the normalized, storage-facing shape
 * Sveltry persists. The original payload is retained verbatim in `raw`.
 */
export function normalizeEvent(
  payload: SentryEventPayload,
  opts: { receivedAt?: number } = {},
): NormalizedEvent {
  const receivedAt = opts.receivedAt ?? DEFAULT_TimestampNow();
  const top = exceptionValues(payload)[0];
  const errorType = top?.type;

  const tags = normalizeTags(payload);
  // Promote common dimensions into tags so they are searchable.
  if (payload.release && !tags.release) tags.release = payload.release;
  if (payload.environment && !tags.environment) tags.environment = payload.environment;
  if (payload.level && !tags.level) tags.level = payload.level;

  return {
    eventId: (payload.event_id ?? '').replace(/-/g, '').toLowerCase() || generatePlaceholderId(),
    timestamp: timestampToMs(payload.timestamp, receivedAt),
    level: (payload.level as IssueLevel) ?? 'error',
    platform: (payload.platform as Platform) ?? 'other',
    environment: payload.environment ?? 'production',
    release: payload.release,
    message: deriveTitle(payload, errorType),
    culprit: deriveCulprit(payload),
    errorType,
    tags,
    userId: payload.user?.id ?? payload.user?.email,
    raw: payload,
  };
}

function generatePlaceholderId(): string {
  // Deterministic-free fallback only used when an SDK omits event_id.
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/**
 * Distill a Sentry `transaction` envelope item into the normalized shape Sveltry
 * persists for performance monitoring: name, trace ids, root op/status, wall-clock
 * duration, and span count. The original payload (with all spans) is kept in `raw`.
 */
export function normalizeTransaction(
  payload: SentryEventPayload,
  opts: { receivedAt?: number } = {},
): NormalizedTransaction {
  const receivedAt = opts.receivedAt ?? DEFAULT_TimestampNow();
  const trace = (payload.contexts?.trace ?? {}) as {
    trace_id?: string;
    span_id?: string;
    op?: string;
    status?: string;
  };
  const start = timestampToMs(payload.start_timestamp, receivedAt);
  const end = timestampToMs(payload.timestamp, start);
  const spans = Array.isArray(payload.spans) ? payload.spans : [];

  const tags = normalizeTags(payload);
  if (payload.release && !tags.release) tags.release = payload.release;
  if (payload.environment && !tags.environment) tags.environment = payload.environment;
  if (trace.op && !tags['transaction.op']) tags['transaction.op'] = trace.op;

  return {
    eventId: (payload.event_id ?? '').replace(/-/g, '').toLowerCase() || generatePlaceholderId(),
    traceId: trace.trace_id ?? '',
    spanId: trace.span_id ?? '',
    name: payload.transaction || trace.op || '<unnamed transaction>',
    op: trace.op ?? 'default',
    status: trace.status ?? 'unknown',
    timestamp: start,
    endTimestamp: end,
    durationMs: Math.max(0, end - start),
    platform: (payload.platform as Platform) ?? 'other',
    environment: payload.environment ?? 'production',
    release: payload.release,
    tags,
    spanCount: spans.length,
    raw: payload,
  };
}

/**
 * Distill a Sentry `session` envelope item into the normalized shape used for
 * release health. Release and environment come from `attrs`.
 */
export function normalizeSession(
  payload: SentrySession,
  opts: { receivedAt?: number } = {},
): NormalizedSession {
  const now = opts.receivedAt ?? DEFAULT_TimestampNow();
  const attrs = payload.attrs ?? {};
  return {
    sid: payload.sid ?? '',
    did: payload.did,
    release: attrs.release ?? '',
    environment: attrs.environment ?? 'production',
    status: payload.status ?? 'ok',
    errors: typeof payload.errors === 'number' ? payload.errors : 0,
    startedAt: timestampToMs(payload.started, now),
    timestamp: timestampToMs(payload.timestamp, now),
  };
}

/** A normalized aggregate session bucket. */
export interface NormalizedSessionBucket {
  bucketStart: number;
  exited: number;
  errored: number;
  crashed: number;
  abnormal: number;
}

/**
 * Distill a `sessions` (aggregate) item into per-bucket counts plus the release
 * and environment they belong to. Empty buckets are dropped.
 */
export function normalizeSessionAggregates(
  payload: SentrySessionAggregates,
  opts: { receivedAt?: number } = {},
): { release: string; environment: string; buckets: NormalizedSessionBucket[] } {
  const now = opts.receivedAt ?? DEFAULT_TimestampNow();
  const attrs = payload.attrs ?? {};
  const buckets: NormalizedSessionBucket[] = [];
  for (const agg of payload.aggregates ?? []) {
    const exited = agg.exited ?? 0;
    const errored = agg.errored ?? 0;
    const crashed = agg.crashed ?? 0;
    const abnormal = agg.abnormal ?? 0;
    if (exited + errored + crashed + abnormal === 0) continue;
    buckets.push({
      bucketStart: timestampToMs(agg.started, now),
      exited,
      errored,
      crashed,
      abnormal,
    });
  }
  return {
    release: attrs.release ?? '',
    environment: attrs.environment ?? 'production',
    buckets,
  };
}

/** A normalized cron check-in. */
export interface NormalizedCheckIn {
  checkInId: string;
  monitorSlug: string;
  status: string;
  durationMs?: number;
  environment: string;
  release?: string;
  timestamp: number;
  /** Expected seconds between check-ins, from an interval schedule (if any). */
  expectedIntervalSeconds?: number;
}

const UNIT_SECONDS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 604800,
};

/** Seconds between runs for a Sentry interval schedule, or undefined for crontab. */
function scheduleIntervalSeconds(config: SentryCheckIn['monitor_config']): number | undefined {
  const schedule = config?.schedule as { type?: string; value?: number; unit?: string } | undefined;
  if (!schedule || schedule.type !== 'interval') return undefined;
  const unit = UNIT_SECONDS[(schedule.unit ?? 'minute').replace(/s$/, '')];
  if (!unit || typeof schedule.value !== 'number') return undefined;
  return schedule.value * unit;
}

/** Distill a `check_in` item. Check-ins carry no timestamp, so `receivedAt` is used. */
export function normalizeCheckIn(
  payload: SentryCheckIn,
  opts: { receivedAt?: number } = {},
): NormalizedCheckIn {
  return {
    checkInId: payload.check_in_id ?? '',
    monitorSlug: payload.monitor_slug ?? '',
    status: payload.status ?? 'unknown',
    durationMs:
      typeof payload.duration === 'number' ? Math.round(payload.duration * 1000) : undefined,
    environment: payload.environment ?? 'production',
    release: payload.release,
    timestamp: opts.receivedAt ?? DEFAULT_TimestampNow(),
    expectedIntervalSeconds: scheduleIntervalSeconds(payload.monitor_config),
  };
}
