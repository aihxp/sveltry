import { v } from 'convex/values';
import {
  coerceEventId,
  compileInboundFilters,
  computeGrouping,
  debugMetaImages,
  decompressBody,
  DecodeError,
  extractAuth,
  inboundFilterInput,
  ingestError,
  ingestSuccess,
  matchCompiledFilter,
  MAX_REQUEST_BODY_BYTES,
  normalizeCheckIn,
  normalizeEvent,
  normalizeProfile,
  normalizeSession,
  normalizeSessionAggregates,
  normalizeTransaction,
  originAllowed,
  parseEnvelope,
  projectIdFromPath,
  rateLimited,
  requestOrigin,
  scrubPayload,
  scrubString,
  splitReplayRecording,
  corsHeaders,
} from '@sveltry/protocol';
import type {
  EnvelopeItem,
  SentryCheckIn,
  SentryClientReport,
  SentryEventPayload,
  SentryProfile,
  SentryReplayEvent,
  SentrySession,
  SentrySessionAggregates,
  SentryUserReport,
} from '@sveltry/types';
import { internal } from './_generated/api';
import {
  type ActionCtx,
  httpAction,
  internalMutation,
  type MutationCtx,
} from './_generated/server';
import type { Id } from './_generated/dataModel';
import { levelValidator } from './schema';
import { generateShortId } from './lib/slug';

const decoder = new TextDecoder();

/** Parse a JSON envelope item and append it, skipping (never failing the whole
 * envelope on) an unparseable item. */
function pushParsed<T>(into: T[], payload: Uint8Array): void {
  try {
    into.push(JSON.parse(decoder.decode(payload)) as T);
  } catch {
    // Skip an unparseable envelope item.
  }
}

// ---------------------------------------------------------------------------
// Per-item-type persistence. The ingest action fans the parsed envelope out to
// these named helpers (one per item type) so the top-level handler reads as a
// sequence of named steps rather than ten inline near-identical loops. Each is a
// thin loop over already-normalized items; the events/transactions loops stay in
// the handler because they feed the per-batch usage counters. `IngestTarget` is
// the resolved-DSN context every helper needs (project, org, scrubbing config).
// ---------------------------------------------------------------------------

type IngestTarget = {
  projectId: Id<'projects'>;
  organizationId: string;
  scrubPii: boolean;
  scrubConfig?: Parameters<typeof scrubPayload>[1];
};

async function persistSessions(
  ctx: ActionCtx,
  target: IngestTarget,
  sessions: SentrySession[],
  receivedAt: number,
): Promise<void> {
  for (const payload of sessions) {
    const s = normalizeSession(payload, { receivedAt });
    if (!s.sid) continue;
    await ctx.runMutation(internal.sessions.recordSession, {
      projectId: target.projectId,
      organizationId: target.organizationId,
      sid: s.sid,
      did: s.did,
      release: s.release,
      environment: s.environment,
      status: s.status,
      errors: s.errors,
      startedAt: s.startedAt,
      timestamp: s.timestamp,
    });
  }
}

async function persistSessionAggregates(
  ctx: ActionCtx,
  target: IngestTarget,
  sessionAggregates: SentrySessionAggregates[],
  receivedAt: number,
): Promise<void> {
  for (const payload of sessionAggregates) {
    const agg = normalizeSessionAggregates(payload, { receivedAt });
    if (agg.buckets.length === 0) continue;
    await ctx.runMutation(internal.sessions.recordSessionBuckets, {
      projectId: target.projectId,
      organizationId: target.organizationId,
      release: agg.release,
      environment: agg.environment,
      buckets: agg.buckets,
    });
  }
}

async function persistCheckIns(
  ctx: ActionCtx,
  target: IngestTarget,
  checkIns: SentryCheckIn[],
  receivedAt: number,
): Promise<void> {
  for (const payload of checkIns) {
    const c = normalizeCheckIn(payload, { receivedAt });
    if (!c.monitorSlug) continue;
    await ctx.runMutation(internal.monitors.recordCheckIn, {
      projectId: target.projectId,
      organizationId: target.organizationId,
      monitorSlug: c.monitorSlug,
      checkInId: c.checkInId,
      status: c.status,
      durationMs: c.durationMs,
      environment: c.environment,
      release: c.release,
      timestamp: c.timestamp,
      expectedIntervalSeconds: c.expectedIntervalSeconds,
    });
  }
}

async function persistReplays(
  ctx: ActionCtx,
  target: IngestTarget,
  replayEvents: SentryReplayEvent[],
  replayRecordings: Uint8Array[],
  receivedAt: number,
): Promise<void> {
  // A replay_event (metadata) is paired with a replay_recording (the rrweb stream)
  // in the same envelope. Store the decompressed recording in file storage and roll
  // the metadata onto the replay row.
  for (let i = 0; i < replayEvents.length; i++) {
    const meta = replayEvents[i]!;
    const recording = replayRecordings[i];
    if (!meta.replay_id || !recording) continue;
    // Store the rrweb recording body as-is (it may be gzip/deflate compressed by
    // the SDK). Decompression happens in the browser at playback, where
    // DecompressionStream is reliable. `.slice()` detaches the nested subarray view.
    const { header, body } = splitReplayRecording(recording);
    const storageId = await ctx.storage.store(
      new Blob([body.slice() as BlobPart], { type: 'application/octet-stream' }),
    );
    const segmentId = (header.segment_id as number) ?? meta.segment_id ?? i;
    // Drop the just-stored blob if the row was deduped (retry) or the insert threw,
    // so a failed/duplicate write never leaks an orphaned storage object.
    let kept = false;
    try {
      const res = await ctx.runMutation(internal.replays.recordReplaySegment, {
        projectId: target.projectId,
        organizationId: target.organizationId,
        replayId: meta.replay_id,
        segmentId,
        storageId,
        timestamp: receivedAt,
        url: meta.urls?.[0],
        errorCount: meta.error_ids?.length ?? 0,
        platform: meta.platform,
        environment: meta.environment,
      });
      kept = res.inserted;
    } finally {
      if (!kept) await ctx.storage.delete(storageId).catch(() => {});
    }
  }
}

async function persistProfiles(
  ctx: ActionCtx,
  target: IngestTarget,
  profiles: SentryProfile[],
  receivedAt: number,
): Promise<void> {
  for (const payload of profiles) {
    const p = normalizeProfile(payload, { receivedAt });
    if (!p.profileId || p.sampleCount === 0) continue;
    await ctx.runMutation(internal.profiles.recordProfile, {
      projectId: target.projectId,
      organizationId: target.organizationId,
      profileId: p.profileId,
      transactionName: p.transactionName,
      sampleCount: p.sampleCount,
      durationMs: p.durationMs,
      platform: p.platform,
      release: p.release,
      environment: p.environment,
      timestamp: p.timestamp,
      payload: target.scrubPii ? scrubPayload(payload, target.scrubConfig) : payload,
    });
  }
}

async function persistAttachments(
  ctx: ActionCtx,
  target: IngestTarget,
  attachmentItems: EnvelopeItem[],
  attachEventId: string,
): Promise<void> {
  // Stored in file storage, linked to the envelope's event id.
  for (const item of attachmentItems) {
    const storageId = await ctx.storage.store(
      new Blob([item.payload.slice() as BlobPart], {
        type: item.header.content_type ?? 'application/octet-stream',
      }),
    );
    let kept = false;
    try {
      const res = await ctx.runMutation(internal.feedback.recordAttachment, {
        projectId: target.projectId,
        organizationId: target.organizationId,
        eventId: attachEventId,
        filename: item.header.filename ?? 'attachment',
        contentType: item.header.content_type,
        attachmentType: item.header.attachment_type,
        size: item.payload.byteLength,
        storageId,
      });
      kept = res.inserted;
    } finally {
      if (!kept) await ctx.storage.delete(storageId).catch(() => {});
    }
  }
}

async function persistFeedback(
  ctx: ActionCtx,
  target: IngestTarget,
  userReports: SentryUserReport[],
  feedbacks: SentryEventPayload[],
): Promise<void> {
  // Legacy `user_report` and the newer `feedback` event shape.
  for (const r of userReports) {
    if (!r.comments) continue;
    await ctx.runMutation(internal.feedback.recordFeedback, {
      projectId: target.projectId,
      organizationId: target.organizationId,
      eventId: r.event_id,
      name: r.name,
      email: r.email,
      message: target.scrubPii ? scrubString(r.comments) : r.comments,
    });
  }
  for (const f of feedbacks) {
    const fb = (f.contexts?.feedback ?? {}) as {
      message?: string;
      contact_email?: string;
      name?: string;
    };
    if (!fb.message) continue;
    await ctx.runMutation(internal.feedback.recordFeedback, {
      projectId: target.projectId,
      organizationId: target.organizationId,
      eventId: f.event_id,
      name: fb.name,
      email: fb.contact_email,
      // When PII scrubbing is on, redact embedded secrets (cards/SSNs/tokens) from
      // the free-text message, consistent with event scrubbing. The submitter's own
      // name/email are intentional contact info and kept.
      message: target.scrubPii ? scrubString(fb.message) : fb.message,
    });
  }
}

/**
 * The Sentry-compatible ingestion endpoint. Mounted in `http.ts` under the
 * `/api/` path prefix, it accepts both the modern `/api/<id>/envelope/` and the
 * legacy `/api/<id>/store/` routes from unmodified official Sentry SDKs.
 *
 * Compatibility contract (see docs/sentry-compatibility.md):
 *  - Auth from `X-Sentry-Auth` header OR query string (`?sentry_key=...`).
 *  - Bodies may be gzip/deflate compressed; decompressed transparently.
 *  - Success is always `200` with JSON `{"id":"<32-hex>"}` and no rate-limit
 *    headers; throttling uses `429` + `Retry-After`.
 *  - Unknown envelope item types and endpoints are tolerated (200), never fatal.
 */
export const ingest = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get('origin') ?? '*');

  const route = projectIdFromPath(url.pathname);
  if (!route) {
    return ingestError(404, 'unknown ingest endpoint', [], cors);
  }

  const auth = extractAuth(request.headers.get('x-sentry-auth'), url.searchParams);
  const publicKey = auth.sentry_key;
  if (!publicKey) {
    return ingestError(
      401,
      'missing sentry_key',
      ['no credential in X-Sentry-Auth or query string'],
      cors,
    );
  }

  const resolved = await ctx.runQuery(internal.projects.resolveIngestKey, {
    publicId: route.projectId,
    publicKey,
  });
  if (!resolved) {
    return ingestError(401, 'invalid dsn', ['unknown or revoked key for this project'], cors);
  }

  // Optional per-key allowed origins (Sentry's "Allowed Domains"). When the key
  // restricts origins and the browser request comes from a non-listed Origin/
  // Referer, reject with 403 (a permanent failure, so the SDK does not retry).
  // Server-side requests carry no Origin and are unaffected.
  if (resolved.allowedOrigins && resolved.allowedOrigins.length > 0) {
    const origin = requestOrigin(request.headers.get('origin'), request.headers.get('referer'));
    if (!originAllowed(origin, resolved.allowedOrigins)) {
      return ingestError(403, 'origin not allowed', [origin ?? 'no origin'], cors);
    }
  }

  // Optional per-key rate limiting (fixed window).
  if (resolved.rateLimitCount && resolved.rateLimitWindowSeconds) {
    const verdict = await ctx.runMutation(internal.ingest.checkRateLimit, {
      keyId: resolved.keyId,
      limitCount: resolved.rateLimitCount,
      windowSeconds: resolved.rateLimitWindowSeconds,
    });
    if (!verdict.ok) {
      // Pass CORS headers so browser SDKs can read Retry-After and honor the backoff.
      return rateLimited(verdict.retryAfter ?? 60, undefined, cors);
    }
  }

  // Reject an oversize body before buffering it (honest clients send a length).
  const declaredLen = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_REQUEST_BODY_BYTES) {
    return ingestError(
      413,
      'payload too large',
      [`body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`],
      cors,
    );
  }

  // Read + decompress the raw body. The decompressor aborts a bomb mid-stream,
  // and the raw-size check below catches a body whose Content-Length lied.
  let body: Uint8Array;
  try {
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.byteLength > MAX_REQUEST_BODY_BYTES) {
      return ingestError(
        413,
        'payload too large',
        [`body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`],
        cors,
      );
    }
    body = await decompressBody(raw, request.headers.get('content-encoding'));
  } catch (err) {
    if (err instanceof DecodeError) {
      return ingestError(400, err.message, err.causes, cors);
    }
    return ingestError(400, 'failed to read request body', [String(err)], cors);
  }

  // Collect the error/default events, transactions, and sessions from the request.
  let events: SentryEventPayload[] = [];
  const transactions: SentryEventPayload[] = [];
  const sessions: SentrySession[] = [];
  const sessionAggregates: SentrySessionAggregates[] = [];
  const checkIns: SentryCheckIn[] = [];
  const replayEvents: SentryReplayEvent[] = [];
  const replayRecordings: Uint8Array[] = [];
  const profiles: SentryProfile[] = [];
  const attachmentItems: EnvelopeItem[] = [];
  const userReports: SentryUserReport[] = [];
  const feedbacks: SentryEventPayload[] = [];
  const clientReports: SentryClientReport[] = [];
  let headerEventId: string | undefined;

  if (route.endpoint === 'store') {
    try {
      events = [JSON.parse(decoder.decode(body)) as SentryEventPayload];
    } catch (err) {
      return ingestError(400, 'invalid event', [String(err)], cors);
    }
  } else if (route.endpoint === 'envelope') {
    try {
      const env = parseEnvelope(body);
      headerEventId = env.header.event_id;
      for (const item of env.items) {
        if (item.type === 'event') {
          pushParsed<SentryEventPayload>(events, item.payload);
        } else if (item.type === 'transaction') {
          pushParsed<SentryEventPayload>(transactions, item.payload);
        } else if (item.type === 'session') {
          pushParsed<SentrySession>(sessions, item.payload);
        } else if (item.type === 'sessions') {
          pushParsed<SentrySessionAggregates>(sessionAggregates, item.payload);
        } else if (item.type === 'check_in') {
          pushParsed<SentryCheckIn>(checkIns, item.payload);
        } else if (item.type === 'replay_event') {
          pushParsed<SentryReplayEvent>(replayEvents, item.payload);
        } else if (item.type === 'replay_recording') {
          // Binary rrweb stream; keep the raw bytes for storage.
          replayRecordings.push(item.payload);
        } else if (item.type === 'profile') {
          pushParsed<SentryProfile>(profiles, item.payload);
        } else if (item.type === 'attachment') {
          attachmentItems.push(item); // binary; keep header (filename, type) + bytes
        } else if (item.type === 'user_report') {
          pushParsed<SentryUserReport>(userReports, item.payload);
        } else if (item.type === 'feedback') {
          pushParsed<SentryEventPayload>(feedbacks, item.payload);
        } else if (item.type === 'client_report') {
          pushParsed<SentryClientReport>(clientReports, item.payload);
        }
      }
    } catch (err) {
      return ingestError(400, 'invalid envelope', [String(err)], cors);
    }
  } else {
    // security/minidump/unreal/attachment endpoints: acknowledge without storing.
    return ingestSuccess(coerceEventId(headerEventId), cors);
  }

  const receivedAt = Date.now();
  let firstId: string | undefined;

  // Hard quota + automatic spike protection: drop error events (still 200, so the
  // SDK does not retry) when the project's monthly quota or per-minute spike
  // threshold is exceeded. Transactions/sessions are unaffected.
  let eventsDropped = 0;
  if (events.length > 0 && (resolved.monthlyEventQuota || resolved.spikeThresholdPerMinute)) {
    let accept = true;
    if (resolved.monthlyEventQuota) {
      const used = await ctx.runQuery(internal.usage.monthEventUsage, {
        projectId: resolved.projectId,
      });
      if (used >= resolved.monthlyEventQuota) accept = false;
    }
    if (accept && resolved.spikeThresholdPerMinute) {
      // The spike counter is incremented BEFORE events are stored, by design: the
      // whole point is to shed load before doing the per-item write work. That
      // makes it intentionally non-idempotent under a full-batch retry: a batch
      // that increments the counter and then 500s on a later item will, on the
      // SDK's retry within the same minute window, increment the same window
      // again. This over-counts the live minute window (self-correcting once it
      // rolls), which fails safe TOWARD spike protection rather than toward
      // unbounded ingest, and never affects billing (recordUsage counts only
      // inserted rows). Accepted over a post-store reconcile, which would defeat
      // the load-shed purpose. See codeaudit ERR-003.
      const exceeded = await ctx.runMutation(internal.usage.checkSpike, {
        projectId: resolved.projectId,
        increment: events.length,
        threshold: resolved.spikeThresholdPerMinute,
      });
      if (exceeded) accept = false;
    }
    if (!accept) {
      eventsDropped = events.length;
      events = [];
    }
  }

  // Inbound data filters: drop error events matching the project's filter rules
  // before they are stored, grouped, or counted (still 200, so the SDK does not
  // retry). Compile the globs once for the whole batch. Filtered drops are tracked
  // separately from quota/spike/client drops so nothing silently vanishes.
  let eventsFiltered = 0;
  if (events.length > 0 && resolved.ingestFilters) {
    const compiled = compileInboundFilters(resolved.ingestFilters);
    if (compiled.active) {
      const kept: SentryEventPayload[] = [];
      for (const payload of events) {
        const n = normalizeEvent(payload, { receivedAt });
        const reason = matchCompiledFilter(inboundFilterInput(payload, n), compiled);
        if (reason) eventsFiltered++;
        else kept.push(payload);
      }
      events = kept;
    }
  }

  // Count rows that were actually inserted (not deduped by an SDK retry), so
  // usage accounting reflects stored data and a full-batch retry does not
  // double-count toward the monthly quota.
  let newEvents = 0;
  let newTransactions = 0;

  for (const payload of events) {
    const normalized = normalizeEvent(payload, { receivedAt });
    const grouping = computeGrouping(payload, normalized);
    const storedPayload = resolved.scrubPii ? scrubPayload(payload, resolved.scrubConfig) : payload;
    if (!firstId) firstId = normalized.eventId;

    const res = await ctx.runMutation(internal.ingest.recordEvent, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
      eventId: normalized.eventId,
      timestamp: normalized.timestamp,
      receivedAt,
      level: normalized.level,
      platform: normalized.platform,
      environment: normalized.environment,
      release: normalized.release,
      message: normalized.message,
      culprit: normalized.culprit,
      errorType: normalized.errorType,
      tags: normalized.tags,
      userId: normalized.userId,
      fingerprint: grouping.fingerprint,
      groupingConfig: grouping.groupingConfig,
      payload: storedPayload,
    });
    if (!res.duplicate) newEvents += 1;
  }

  for (const payload of transactions) {
    const t = normalizeTransaction(payload, { receivedAt });
    const storedPayload = resolved.scrubPii ? scrubPayload(payload, resolved.scrubConfig) : payload;
    if (!firstId) firstId = t.eventId;
    const res = await ctx.runMutation(internal.ingest.recordTransaction, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
      eventId: t.eventId,
      traceId: t.traceId,
      spanId: t.spanId,
      name: t.name,
      op: t.op,
      status: t.status,
      timestamp: t.timestamp,
      endTimestamp: t.endTimestamp,
      durationMs: t.durationMs,
      platform: t.platform,
      environment: t.environment,
      release: t.release,
      tags: t.tags,
      spanCount: t.spanCount,
      payload: storedPayload,
    });
    if (res.inserted) newTransactions += 1;
  }

  // Persist the remaining item types. These do not touch the per-batch usage
  // counters (only events/transactions above do), so each is a self-contained
  // named step over its already-parsed items.
  //
  // Each item is recorded via its own runMutation (a separate transaction
  // boundary). That is deliberate, not an oversight (PERF-003): the common Sentry
  // envelope carries a single event or transaction, the per-item dedup keys make
  // each write independently idempotent under a retry, and the storage-backed
  // items (replays/attachments) must interleave blob writes. A batched
  // array-insert mutation would only help the rare many-items-per-envelope case
  // at the cost of that per-item idempotency, so it is intentionally not done.
  await persistSessions(ctx, resolved, sessions, receivedAt);
  await persistSessionAggregates(ctx, resolved, sessionAggregates, receivedAt);
  await persistCheckIns(ctx, resolved, checkIns, receivedAt);
  await persistReplays(ctx, resolved, replayEvents, replayRecordings, receivedAt);
  await persistProfiles(ctx, resolved, profiles, receivedAt);
  await persistAttachments(ctx, resolved, attachmentItems, coerceEventId(firstId ?? headerEventId));
  await persistFeedback(ctx, resolved, userReports, feedbacks);

  // One usage write per ingest batch (not per event), with client-side and
  // server-side (quota/spike) drops folded in, and inbound-filter drops tracked
  // under their own counter.
  let dropped = eventsDropped;
  for (const r of clientReports) {
    for (const d of r.discarded_events ?? []) dropped += d.quantity ?? 0;
  }
  if (newEvents || newTransactions || dropped || eventsFiltered) {
    await ctx.runMutation(internal.usage.recordUsage, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
      events: newEvents,
      transactions: newTransactions,
      dropped,
      filtered: eventsFiltered,
    });
  }

  return ingestSuccess(coerceEventId(firstId ?? headerEventId), cors);
});

/** Persist a performance transaction. */
export const recordTransaction = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    eventId: v.string(),
    traceId: v.string(),
    spanId: v.string(),
    name: v.string(),
    op: v.string(),
    status: v.string(),
    timestamp: v.number(),
    endTimestamp: v.number(),
    durationMs: v.number(),
    platform: v.string(),
    environment: v.string(),
    release: v.optional(v.string()),
    tags: v.record(v.string(), v.string()),
    spanCount: v.number(),
    payload: v.any(),
  },
  handler: async (ctx, args): Promise<{ inserted: boolean }> => {
    // Idempotency: an SDK retry resending the same transaction event_id is a no-op.
    const dup = await ctx.db
      .query('transactions')
      .withIndex('by_project_eventId', (q) =>
        q.eq('projectId', args.projectId).eq('eventId', args.eventId),
      )
      .first();
    if (dup) return { inserted: false };
    const transactionId = await ctx.db.insert('transactions', args);
    // Lean projection (no span payload) for the high-frequency scalar analytics.
    // Written only here, on the same insert path, so it stays 1:1 with the row and
    // an SDK retry (deduped above) never double-writes it.
    await ctx.db.insert('transactionsMeta', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      transactionId,
      name: args.name,
      op: args.op,
      status: args.status,
      durationMs: args.durationMs,
      timestamp: args.timestamp,
      platform: args.platform,
      environment: args.environment,
      release: args.release,
      spanCount: args.spanCount,
      measurements: extractMeasurements(args.payload),
    });
    return { inserted: true };
  },
});

/** Pull the numeric web-vitals values out of a transaction payload's `measurements`. */
function extractMeasurements(payload: unknown): Record<string, number> | undefined {
  const m = (payload as { measurements?: Record<string, { value?: unknown }> } | null)
    ?.measurements;
  if (!m || typeof m !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(m)) {
    const v = (val as { value?: unknown } | null)?.value;
    if (typeof v === 'number') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Upsert an issue and persist an event. Schedules alert dispatch. */
export const recordEvent = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    eventId: v.string(),
    timestamp: v.number(),
    receivedAt: v.number(),
    level: levelValidator,
    platform: v.string(),
    environment: v.string(),
    release: v.optional(v.string()),
    message: v.string(),
    culprit: v.string(),
    errorType: v.optional(v.string()),
    tags: v.record(v.string(), v.string()),
    userId: v.optional(v.string()),
    fingerprint: v.string(),
    groupingConfig: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    // Idempotency: an SDK retry resending the same event_id must not double-count
    // the issue or insert a duplicate event row. Scope the lookup to the project
    // so the index stays selective.
    const duplicate = await ctx.db
      .query('events')
      .withIndex('by_project_eventId', (q) =>
        q.eq('projectId', args.projectId).eq('eventId', args.eventId),
      )
      .first();
    if (duplicate) return { eventId: args.eventId, duplicate: true };

    const existing = await ctx.db
      .query('issues')
      .withIndex('by_project_fingerprint', (q) =>
        q.eq('projectId', args.projectId).eq('fingerprint', args.fingerprint),
      )
      .first();

    let issueId;
    let isNew = false;
    let isRegression = false;

    if (existing) {
      issueId = existing._id;
      // A resolved issue reopens on a new event, except when it was "resolved in
      // release X" and the event is still from X (expected during that rollout).
      const reopen =
        existing.status === 'resolved' &&
        (!existing.resolvedInRelease || args.release !== existing.resolvedInRelease);
      if (reopen) isRegression = true;
      const newUser = args.userId ? await markIssueUser(ctx, issueId, args.userId) : false;
      await ctx.db.patch(existing._id, {
        count: existing.count + 1,
        userCount: existing.userCount + (newUser ? 1 : 0),
        // Late-arriving events can be older than what we have seen; keep the
        // true first/last bounds.
        firstSeen: Math.min(existing.firstSeen, args.timestamp),
        lastSeen: Math.max(existing.lastSeen, args.timestamp),
        level: args.level,
        title: existing.title || args.message,
        culprit: args.culprit || existing.culprit,
        ...(reopen ? { status: 'unresolved' as const, substatus: 'regressed' as const } : {}),
      });
    } else {
      isNew = true;
      issueId = await ctx.db.insert('issues', {
        organizationId: args.organizationId,
        projectId: args.projectId,
        fingerprint: args.fingerprint,
        groupingConfig: args.groupingConfig,
        title: args.message,
        culprit: args.culprit,
        level: args.level,
        platform: args.platform,
        status: 'unresolved',
        substatus: 'new',
        count: 1,
        userCount: args.userId ? 1 : 0,
        firstSeen: args.timestamp,
        lastSeen: args.timestamp,
        errorType: args.errorType,
        shortId: generateShortId(),
      });
      if (args.userId) await markIssueUser(ctx, issueId, args.userId);
    }

    const eventDocId = await ctx.db.insert('events', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      issueId,
      eventId: args.eventId,
      timestamp: args.timestamp,
      receivedAt: args.receivedAt,
      level: args.level,
      platform: args.platform,
      environment: args.environment,
      release: args.release,
      message: args.message,
      culprit: args.culprit,
      tags: args.tags,
      payload: args.payload,
    });

    // Resolve minified frames against uploaded source maps, off the ingest hot
    // path. A release lets us match maps by name; a debug id (debug_meta) matches
    // them independent of release, so either is enough to attempt resolution.
    if (hasMinifiedFrames(args.payload) && (args.release || hasDebugIds(args.payload))) {
      await ctx.scheduler.runAfter(0, internal.sourcemaps.resolveEvent, { eventDocId });
    }

    if (args.release) {
      const existingRelease = await ctx.db
        .query('releases')
        .withIndex('by_project_version', (q) =>
          q.eq('projectId', args.projectId).eq('version', args.release as string),
        )
        .first();
      if (existingRelease) {
        await ctx.db.patch(existingRelease._id, {
          lastEventAt: Math.max(existingRelease.lastEventAt ?? 0, args.timestamp),
          firstEventAt: Math.min(existingRelease.firstEventAt ?? args.timestamp, args.timestamp),
        });
      } else {
        await ctx.db.insert('releases', {
          organizationId: args.organizationId,
          projectId: args.projectId,
          version: args.release,
          createdAt: args.receivedAt,
          firstEventAt: args.timestamp,
          lastEventAt: args.timestamp,
        });
      }
    }

    // Fan out alert evaluation without blocking the ingest path. The triggering
    // event's environment lets environment-scoped rules match.
    await ctx.scheduler.runAfter(0, internal.alerts.dispatchForEvent, {
      issueId,
      isNew,
      isRegression,
      environment: args.environment,
    });

    return { eventId: args.eventId, duplicate: false };
  },
});

/** Whether any exception frame has a line+column, i.e. looks worth source-mapping. */
function hasMinifiedFrames(payload: SentryEventPayload): boolean {
  const ex = payload.exception;
  const values = !ex ? [] : Array.isArray(ex) ? ex : (ex.values ?? []);
  return values.some((v) =>
    (v.stacktrace?.frames ?? []).some(
      (f) => typeof f.lineno === 'number' && typeof f.colno === 'number',
    ),
  );
}

/** Whether the event carries any debug_meta image with a debug id. */
function hasDebugIds(payload: SentryEventPayload): boolean {
  return debugMetaImages(payload.debug_meta?.images).length > 0;
}

/**
 * Record that `userId` was seen on `issueId`, returning true only the first time.
 * Backs the distinct `issues.userCount` ("users affected") metric.
 */
async function markIssueUser(
  ctx: MutationCtx,
  issueId: Id<'issues'>,
  userId: string,
): Promise<boolean> {
  const seen = await ctx.db
    .query('issueUsers')
    .withIndex('by_issue_user', (q) => q.eq('issueId', issueId).eq('userId', userId))
    .first();
  if (seen) return false;
  await ctx.db.insert('issueUsers', { issueId, userId, firstSeen: Date.now() });
  return true;
}

/** Fixed-window rate limiter for a DSN key. Returns `{ ok, retryAfter }`. */
export const checkRateLimit = internalMutation({
  args: { keyId: v.id('projectKeys'), limitCount: v.number(), windowSeconds: v.number() },
  returns: v.object({ ok: v.boolean(), retryAfter: v.optional(v.number()) }),
  handler: async (ctx, { keyId, limitCount, windowSeconds }) => {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;

    const existing = await ctx.db
      .query('ingestWindows')
      .withIndex('by_key_window', (q) => q.eq('keyId', keyId).eq('windowStart', windowStart))
      .first();

    if (!existing) {
      await ctx.db.insert('ingestWindows', { keyId, windowStart, count: 1 });
      return { ok: true };
    }
    if (existing.count >= limitCount) {
      return { ok: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
    }
    await ctx.db.patch(existing._id, { count: existing.count + 1 });
    return { ok: true };
  },
});
