import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/** Severity levels, aligned with Sentry's vocabulary. */
export const levelValidator = v.union(
  v.literal('fatal'),
  v.literal('error'),
  v.literal('warning'),
  v.literal('info'),
  v.literal('debug'),
);

export const issueStatusValidator = v.union(
  v.literal('unresolved'),
  v.literal('resolved'),
  v.literal('ignored'),
);

export const issueSubstatusValidator = v.union(
  v.literal('new'),
  v.literal('ongoing'),
  v.literal('escalating'),
  v.literal('regressed'),
  v.literal('archived_until_escalating'),
  v.literal('archived_forever'),
);

export const alertTriggerValidator = v.union(
  v.literal('new_issue'),
  v.literal('regression'),
  v.literal('event_frequency'),
);

export const alertChannelValidator = v.object({
  type: v.union(v.literal('webhook'), v.literal('discord'), v.literal('slack'), v.literal('email')),
  target: v.string(),
});

/**
 * The Sveltry event-domain schema. Identity (users/sessions/orgs) lives in
 * Postgres via Better Auth; this database holds projects, DSN keys, and the
 * issue/event data, all scoped by `organizationId` (the Better Auth org id).
 */
export default defineSchema({
  // A thin mirror of the Better Auth organization, created on first use so the
  // dashboard can attach project-level settings without a Postgres round-trip.
  organizations: defineTable({
    slug: v.string(),
    name: v.string(),
    createdAt: v.number(),
  }).index('by_slug', ['slug']),

  projects: defineTable({
    organizationId: v.string(),
    slug: v.string(),
    name: v.string(),
    platform: v.string(),
    /** The numeric public id used in DSNs (`/api/<publicId>/`). */
    publicId: v.string(),
    createdAt: v.number(),
    eventRetentionDays: v.number(),
    scrubPii: v.boolean(),
  })
    .index('by_org', ['organizationId'])
    .index('by_publicId', ['publicId'])
    .index('by_org_slug', ['organizationId', 'slug']),

  projectKeys: defineTable({
    projectId: v.id('projects'),
    organizationId: v.string(),
    label: v.string(),
    /** The DSN public key (`sentry_key`). */
    publicKey: v.string(),
    isActive: v.boolean(),
    createdAt: v.number(),
    rateLimitCount: v.optional(v.number()),
    rateLimitWindowSeconds: v.optional(v.number()),
  })
    .index('by_publicKey', ['publicKey'])
    .index('by_project', ['projectId']),

  issues: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    fingerprint: v.string(),
    groupingConfig: v.string(),
    title: v.string(),
    culprit: v.string(),
    level: levelValidator,
    platform: v.string(),
    status: issueStatusValidator,
    substatus: issueSubstatusValidator,
    count: v.number(),
    userCount: v.number(),
    firstSeen: v.number(),
    lastSeen: v.number(),
    resolvedInRelease: v.optional(v.string()),
    snoozeUntil: v.optional(v.number()),
    assigneeId: v.optional(v.string()),
    errorType: v.optional(v.string()),
  })
    .index('by_project_fingerprint', ['projectId', 'fingerprint'])
    .index('by_project_status_lastSeen', ['projectId', 'status', 'lastSeen'])
    .index('by_org_status_lastSeen', ['organizationId', 'status', 'lastSeen'])
    .index('by_project_lastSeen', ['projectId', 'lastSeen'])
    .searchIndex('search_title', {
      searchField: 'title',
      filterFields: ['organizationId', 'status', 'level', 'platform', 'projectId'],
    }),

  // Threaded comments on an issue (the collaboration surface). Author identity
  // comes from the Better Auth JWT (no user data is stored in Convex otherwise).
  issueComments: defineTable({
    organizationId: v.string(),
    issueId: v.id('issues'),
    authorId: v.string(),
    authorEmail: v.optional(v.string()),
    body: v.string(),
    createdAt: v.number(),
  }).index('by_issue', ['issueId', 'createdAt']),

  events: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    issueId: v.id('issues'),
    eventId: v.string(),
    timestamp: v.number(),
    receivedAt: v.number(),
    level: levelValidator,
    platform: v.string(),
    environment: v.string(),
    release: v.optional(v.string()),
    message: v.string(),
    culprit: v.string(),
    tags: v.record(v.string(), v.string()),
    /** The full normalized Sentry payload (the "nodestore" blob). */
    payload: v.any(),
    /** True once minified stack frames have been resolved via source maps. */
    resolved: v.optional(v.boolean()),
  })
    .index('by_issue', ['issueId', 'timestamp'])
    .index('by_project', ['projectId', 'timestamp'])
    .index('by_eventId', ['eventId'])
    // Selective lookup used to make ingestion idempotent per project: an SDK
    // retry resending the same `event_id` must not double-count.
    .index('by_project_eventId', ['projectId', 'eventId']),

  // Distinct (issue, user) pairs, so `issues.userCount` reflects unique users
  // affected rather than the number of events that carried a user.
  issueUsers: defineTable({
    issueId: v.id('issues'),
    userId: v.string(),
    firstSeen: v.number(),
  }).index('by_issue_user', ['issueId', 'userId']),

  // Release-health sessions (envelope items with `type: "session"`). Upserted by
  // sid so the final status wins; aggregated per release for crash-free rates.
  sessions: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    sid: v.string(),
    did: v.optional(v.string()),
    release: v.string(),
    environment: v.string(),
    status: v.string(),
    errors: v.number(),
    startedAt: v.number(),
    lastUpdate: v.number(),
  })
    .index('by_project_sid', ['projectId', 'sid'])
    .index('by_org', ['organizationId', 'lastUpdate'])
    .index('by_project', ['projectId', 'lastUpdate'])
    .index('by_project_release', ['projectId', 'release']),

  // Pre-aggregated session counts from `sessions` (aggregate) items, folded into
  // release health alongside individual sessions.
  sessionBuckets: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    release: v.string(),
    environment: v.string(),
    bucketStart: v.number(),
    exited: v.number(),
    errored: v.number(),
    crashed: v.number(),
    abnormal: v.number(),
    receivedAt: v.number(),
  }).index('by_org', ['organizationId', 'bucketStart']),

  // Performance transactions (envelope items with `type: "transaction"`). The
  // full payload (including spans) is kept in `payload`; the columns are the
  // searchable/aggregatable summary.
  transactions: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
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
  })
    .index('by_org', ['organizationId', 'timestamp'])
    .index('by_project', ['projectId', 'timestamp'])
    .index('by_project_name', ['projectId', 'name', 'timestamp'])
    .index('by_project_eventId', ['projectId', 'eventId'])
    .index('by_trace', ['traceId']),

  // Hourly latency rollups: a fixed-bucket duration histogram per (project,
  // transaction, hour). Lets percentiles span arbitrary windows without scanning
  // raw transactions or needing a columnar store. Recomputed by an hourly cron.
  transactionRollups: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    transactionName: v.string(),
    bucketStart: v.number(),
    count: v.number(),
    sumMs: v.number(),
    maxMs: v.number(),
    histogram: v.array(v.number()),
  })
    .index('by_org_bucket', ['organizationId', 'bucketStart'])
    .index('by_project_name_bucket', ['projectId', 'transactionName', 'bucketStart'])
    .index('by_project_bucket', ['projectId', 'bucketStart']),

  // Event attachments (envelope items with `type: "attachment"`). Bytes live in
  // Convex file storage; linked to the event by its Sentry event_id.
  attachments: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    eventId: v.string(),
    filename: v.string(),
    contentType: v.optional(v.string()),
    attachmentType: v.optional(v.string()),
    size: v.number(),
    storageId: v.id('_storage'),
    createdAt: v.number(),
  }).index('by_event', ['eventId']),

  // User feedback (envelope items `user_report` or `feedback`).
  feedback: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    eventId: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    message: v.string(),
    createdAt: v.number(),
  })
    .index('by_org', ['organizationId', 'createdAt'])
    .index('by_event', ['eventId']),

  // Sampled performance profiles (envelope items with `type: "profile"`). The
  // full samples/stacks/frames payload is kept for flamegraph construction.
  profiles: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    profileId: v.string(),
    transactionName: v.string(),
    sampleCount: v.number(),
    durationMs: v.number(),
    platform: v.string(),
    release: v.optional(v.string()),
    environment: v.string(),
    timestamp: v.number(),
    payload: v.any(),
  })
    .index('by_org', ['organizationId', 'timestamp'])
    .index('by_project_profileId', ['projectId', 'profileId']),

  // Session replays. One `replays` row per replay (metadata), and one
  // `replaySegments` row per recording segment (rrweb stream in file storage).
  replays: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    replayId: v.string(),
    startedAt: v.number(),
    lastSegmentAt: v.number(),
    segmentCount: v.number(),
    url: v.optional(v.string()),
    errorCount: v.number(),
    platform: v.optional(v.string()),
    environment: v.optional(v.string()),
  })
    .index('by_project_replayId', ['projectId', 'replayId'])
    .index('by_org', ['organizationId', 'lastSegmentAt']),

  replaySegments: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    replayId: v.string(),
    segmentId: v.number(),
    storageId: v.id('_storage'),
    timestamp: v.number(),
  }).index('by_replay', ['projectId', 'replayId', 'segmentId']),

  // HTTP uptime monitors. A cron probes each URL on its interval and records the
  // result as a check-in (monitorSlug = the uptime monitor's slug), so uptime
  // history reuses the same Monitors surface as cron check-ins.
  uptimeMonitors: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    slug: v.string(),
    url: v.string(),
    method: v.string(),
    expectedStatus: v.number(),
    intervalSeconds: v.number(),
    enabled: v.boolean(),
    lastCheckedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_enabled', ['enabled']),

  // Cron monitors: one row per (project, slug), tracking the latest check-in.
  monitors: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    slug: v.string(),
    latestStatus: v.string(),
    lastCheckInAt: v.number(),
    lastDurationMs: v.optional(v.number()),
    environment: v.optional(v.string()),
    /** Expected seconds between check-ins, from the SDK's interval schedule. */
    expectedIntervalSeconds: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_project_slug', ['projectId', 'slug'])
    .index('by_org', ['organizationId', 'lastCheckInAt']),

  // Individual cron check-ins (envelope items with `type: "check_in"`). Upserted
  // by check_in_id so an `in_progress` start and its terminal update are one run.
  checkIns: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    monitorSlug: v.string(),
    checkInId: v.string(),
    status: v.string(),
    durationMs: v.optional(v.number()),
    environment: v.string(),
    release: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index('by_project_checkInId', ['projectId', 'checkInId'])
    .index('by_monitor', ['projectId', 'monitorSlug', 'timestamp']),

  releases: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    version: v.string(),
    ref: v.optional(v.string()),
    url: v.optional(v.string()),
    createdAt: v.number(),
    firstEventAt: v.optional(v.number()),
    lastEventAt: v.optional(v.number()),
  })
    .index('by_project_version', ['projectId', 'version'])
    .index('by_project', ['projectId', 'createdAt']),

  // Uploaded build artifacts (minified bundles and their source maps) used to
  // resolve minified production stack frames back to original source. Bytes live
  // in Convex file storage; this table is the index of names per release.
  releaseArtifacts: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    release: v.string(),
    /** The artifact path as it appears in stack frames, e.g. `~/app.min.js` or its `.map`. */
    name: v.string(),
    kind: v.union(v.literal('minified'), v.literal('sourcemap')),
    storageId: v.id('_storage'),
    size: v.number(),
    /** For a minified artifact, the `sourceMappingURL` annotation it carries, if any. */
    sourceMappingURL: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_project_release', ['projectId', 'release'])
    .index('by_project_release_name', ['projectId', 'release', 'name']),

  alertRules: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    name: v.string(),
    trigger: alertTriggerValidator,
    threshold: v.optional(v.number()),
    windowMinutes: v.optional(v.number()),
    minLevel: v.optional(levelValidator),
    channels: v.array(alertChannelValidator),
    isEnabled: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_project', ['projectId'])
    .index('by_org', ['organizationId']),

  // Threshold alerts over aggregates, evaluated periodically by a cron (distinct
  // from issue-triggered alertRules). Metric is p95 latency, error count, or
  // crash-free rate over a window; fires to channels when the threshold is crossed.
  metricAlerts: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    name: v.string(),
    metric: v.union(
      v.literal('p95_latency'),
      v.literal('error_count'),
      v.literal('crash_free_rate'),
    ),
    /** For p95_latency: which transaction to watch (empty = all). */
    transactionName: v.optional(v.string()),
    windowMinutes: v.number(),
    /** Latency: ms; error_count: events; crash_free_rate: percent (fires when below). */
    threshold: v.number(),
    channels: v.array(alertChannelValidator),
    enabled: v.boolean(),
    lastFiredAt: v.optional(v.number()),
    lastValue: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_project', ['projectId'])
    .index('by_enabled', ['enabled']),

  // An audit log of fired alerts, used for de-duplication and the activity feed.
  alertDeliveries: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    issueId: v.id('issues'),
    ruleId: v.id('alertRules'),
    trigger: alertTriggerValidator,
    channelType: v.string(),
    target: v.string(),
    ok: v.boolean(),
    detail: v.optional(v.string()),
    deliveredAt: v.number(),
  }).index('by_issue', ['issueId']),

  // A lightweight fixed-window rate limiter for ingestion, keyed per DSN key.
  // `by_window` lets a daily cron prune windows that have rolled over.
  ingestWindows: defineTable({
    keyId: v.id('projectKeys'),
    windowStart: v.number(),
    count: v.number(),
  })
    .index('by_key_window', ['keyId', 'windowStart'])
    .index('by_window', ['windowStart']),
});
