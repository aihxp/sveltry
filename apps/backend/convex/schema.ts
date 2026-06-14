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
    .index('by_project_lastSeen', ['projectId', 'lastSeen']),

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
