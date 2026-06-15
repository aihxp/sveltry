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
import { httpAction, internalMutation, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { levelValidator } from './schema';
import { scrubPayload } from './lib/scrub';

const decoder = new TextDecoder();

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

  // Read + decompress the raw body.
  let body: Uint8Array;
  try {
    const raw = new Uint8Array(await request.arrayBuffer());
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
          try {
            events.push(JSON.parse(decoder.decode(item.payload)) as SentryEventPayload);
          } catch {
            // Skip an unparseable item; do not fail the whole envelope.
          }
        } else if (item.type === 'transaction') {
          try {
            transactions.push(JSON.parse(decoder.decode(item.payload)) as SentryEventPayload);
          } catch {
            // Skip an unparseable transaction; do not fail the whole envelope.
          }
        } else if (item.type === 'session') {
          try {
            sessions.push(JSON.parse(decoder.decode(item.payload)) as SentrySession);
          } catch {
            // Skip an unparseable session; do not fail the whole envelope.
          }
        } else if (item.type === 'sessions') {
          try {
            sessionAggregates.push(
              JSON.parse(decoder.decode(item.payload)) as SentrySessionAggregates,
            );
          } catch {
            // Skip an unparseable aggregate; do not fail the whole envelope.
          }
        } else if (item.type === 'check_in') {
          try {
            checkIns.push(JSON.parse(decoder.decode(item.payload)) as SentryCheckIn);
          } catch {
            // Skip an unparseable check-in; do not fail the whole envelope.
          }
        } else if (item.type === 'replay_event') {
          try {
            replayEvents.push(JSON.parse(decoder.decode(item.payload)) as SentryReplayEvent);
          } catch {
            // Skip an unparseable replay event.
          }
        } else if (item.type === 'replay_recording') {
          // Binary rrweb stream; keep the raw bytes for storage.
          replayRecordings.push(item.payload);
        } else if (item.type === 'profile') {
          try {
            profiles.push(JSON.parse(decoder.decode(item.payload)) as SentryProfile);
          } catch {
            // Skip an unparseable profile.
          }
        } else if (item.type === 'attachment') {
          attachmentItems.push(item); // binary; keep header (filename, type) + bytes
        } else if (item.type === 'user_report') {
          try {
            userReports.push(JSON.parse(decoder.decode(item.payload)) as SentryUserReport);
          } catch {
            // Skip an unparseable user report.
          }
        } else if (item.type === 'feedback') {
          try {
            feedbacks.push(JSON.parse(decoder.decode(item.payload)) as SentryEventPayload);
          } catch {
            // Skip an unparseable feedback event.
          }
        } else if (item.type === 'client_report') {
          try {
            clientReports.push(JSON.parse(decoder.decode(item.payload)) as SentryClientReport);
          } catch {
            // Skip an unparseable client report.
          }
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

  for (const payload of events) {
    const normalized = normalizeEvent(payload, { receivedAt });
    const grouping = computeGrouping(payload, normalized);
    const storedPayload = resolved.scrubPii ? scrubPayload(payload) : payload;
    if (!firstId) firstId = normalized.eventId;

    await ctx.runMutation(internal.ingest.recordEvent, {
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
  }

  for (const payload of transactions) {
    const t = normalizeTransaction(payload, { receivedAt });
    const storedPayload = resolved.scrubPii ? scrubPayload(payload) : payload;
    if (!firstId) firstId = t.eventId;
    await ctx.runMutation(internal.ingest.recordTransaction, {
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
  }

  for (const payload of sessions) {
    const s = normalizeSession(payload, { receivedAt });
    if (!s.sid) continue;
    await ctx.runMutation(internal.sessions.recordSession, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
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

  for (const payload of sessionAggregates) {
    const agg = normalizeSessionAggregates(payload, { receivedAt });
    if (agg.buckets.length === 0) continue;
    await ctx.runMutation(internal.sessions.recordSessionBuckets, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
      release: agg.release,
      environment: agg.environment,
      buckets: agg.buckets,
    });
  }

  for (const payload of checkIns) {
    const c = normalizeCheckIn(payload, { receivedAt });
    if (!c.monitorSlug) continue;
    await ctx.runMutation(internal.monitors.recordCheckIn, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
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

  // Replays: a replay_event (metadata) is paired with a replay_recording (the
  // rrweb stream) in the same envelope. Store the decompressed recording in file
  // storage and roll the metadata onto the replay row.
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
    await ctx.runMutation(internal.replays.recordReplaySegment, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
      replayId: meta.replay_id,
      segmentId,
      storageId,
      timestamp: receivedAt,
      url: meta.urls?.[0],
      errorCount: meta.error_ids?.length ?? 0,
      platform: meta.platform,
      environment: meta.environment,
    });
  }

  for (const payload of profiles) {
    const p = normalizeProfile(payload, { receivedAt });
    if (!p.profileId || p.sampleCount === 0) continue;
    await ctx.runMutation(internal.profiles.recordProfile, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
      profileId: p.profileId,
      transactionName: p.transactionName,
      sampleCount: p.sampleCount,
      durationMs: p.durationMs,
      platform: p.platform,
      release: p.release,
      environment: p.environment,
      timestamp: p.timestamp,
      payload: resolved.scrubPii ? scrubPayload(payload) : payload,
    });
  }

  // Attachments: stored in file storage, linked to the envelope's event id.
  const attachEventId = coerceEventId(firstId ?? headerEventId);
  for (const item of attachmentItems) {
    const storageId = await ctx.storage.store(
      new Blob([item.payload.slice() as BlobPart], {
        type: item.header.content_type ?? 'application/octet-stream',
      }),
    );
    await ctx.runMutation(internal.feedback.recordAttachment, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
      eventId: attachEventId,
      filename: item.header.filename ?? 'attachment',
      contentType: item.header.content_type,
      attachmentType: item.header.attachment_type,
      size: item.payload.byteLength,
      storageId,
    });
  }

  // User feedback: legacy `user_report` and the newer `feedback` event shape.
  for (const r of userReports) {
    if (!r.comments) continue;
    await ctx.runMutation(internal.feedback.recordFeedback, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
      eventId: r.event_id,
      name: r.name,
      email: r.email,
      message: r.comments,
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
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
      eventId: f.event_id,
      name: fb.name,
      email: fb.contact_email,
      message: fb.message,
    });
  }

  // One usage write per ingest batch (not per event), with client-side and
  // server-side (quota/spike) drops folded in, and inbound-filter drops tracked
  // under their own counter.
  let dropped = eventsDropped;
  for (const r of clientReports) {
    for (const d of r.discarded_events ?? []) dropped += d.quantity ?? 0;
  }
  if (events.length || transactions.length || dropped || eventsFiltered) {
    await ctx.runMutation(internal.usage.recordUsage, {
      projectId: resolved.projectId,
      organizationId: resolved.organizationId,
      events: events.length,
      transactions: transactions.length,
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
  handler: async (ctx, args) => {
    // Idempotency: an SDK retry resending the same transaction event_id is a no-op.
    const dup = await ctx.db
      .query('transactions')
      .withIndex('by_project_eventId', (q) =>
        q.eq('projectId', args.projectId).eq('eventId', args.eventId),
      )
      .first();
    if (dup) return;
    await ctx.db.insert('transactions', args);
  },
});

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

    return { eventId: args.eventId };
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
