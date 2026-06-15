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

/**
 * Per-project inbound data filters: drop matching error events at ingest before
 * they are stored or counted. Patterns are case-insensitive globs (see
 * `@sveltry/protocol` `inboundfilters`). An empty config is a clean no-op.
 */
export const ingestFiltersValidator = v.object({
  ignoreErrors: v.optional(v.array(v.string())),
  ignoreReleases: v.optional(v.array(v.string())),
  ignoreEnvironments: v.optional(v.array(v.string())),
  ignorePaths: v.optional(v.array(v.string())),
  filterBots: v.optional(v.boolean()),
});

/**
 * Per-project custom PII scrubbing, layered on the default ruleset (applies only
 * when `scrubPii` is on). See `@sveltry/protocol` `scrub`.
 */
export const scrubConfigValidator = v.object({
  /** Extra key-name substrings to redact, beyond the defaults. */
  extraFields: v.optional(v.array(v.string())),
  /** Key-name substrings that must never be redacted (allowlist). */
  safeFields: v.optional(v.array(v.string())),
  /** Also redact IP-address fields (`user.ip_address`, `REMOTE_ADDR`, ...). */
  scrubIp: v.optional(v.boolean()),
});

/** Sveltry member roles, ranked owner > admin > member > billing. */
export const roleValidator = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
  v.literal('billing'),
);

/** The dataset and aggregate a Discover query / dashboard widget runs over. */
export const discoverDatasetValidator = v.union(v.literal('errors'), v.literal('transactions'));
export const discoverAggregateValidator = v.union(
  v.literal('count'),
  v.literal('users'),
  v.literal('avg'),
  v.literal('p50'),
  v.literal('p75'),
  v.literal('p95'),
  v.literal('p99'),
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

/** Per-project issue-tracker integration config (credentials are self-hoster supplied). */
export const trackerConfigValidator = v.union(
  v.object({
    type: v.literal('jira'),
    siteUrl: v.string(),
    projectKey: v.string(),
    email: v.string(),
    apiToken: v.string(),
    issueTypeName: v.optional(v.string()),
  }),
  v.object({
    type: v.literal('linear'),
    apiKey: v.string(),
    teamId: v.string(),
  }),
);

export const alertChannelValidator = v.object({
  type: v.union(
    v.literal('webhook'),
    v.literal('discord'),
    v.literal('slack'),
    v.literal('email'),
    v.literal('msteams'),
    v.literal('pagerduty'),
    v.literal('opsgenie'),
  ),
  target: v.string(),
});

/**
 * The Sveltry event-domain schema. Identity (users/sessions/orgs) lives in
 * Postgres via Better Auth; this database holds projects, DSN keys, and the
 * issue/event data, all scoped by `organizationId` (the Better Auth org id).
 */
export default defineSchema({
  // Organizations (tenants). The Convex-native source of truth: `slug` is the
  // tenant key used as `organizationId` across every domain table. `createdBy` is
  // the owner's user id. (Historically a thin mirror of a Better Auth org; now
  // authoritative so the org model lives entirely in Convex.)
  organizations: defineTable({
    slug: v.string(),
    name: v.string(),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_slug', ['slug']),

  // Per-user app settings, including which organization is active. Resolved by
  // `requireOrg` (replaces the active-org JWT claim, so no auth provider is needed
  // to track it).
  userSettings: defineTable({
    userId: v.string(),
    activeOrganizationId: v.optional(v.string()),
  }).index('by_user', ['userId']),

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
    /** Optional custom scrubbing rules layered on the default ruleset (when scrubPii is on). */
    scrubConfig: v.optional(scrubConfigValidator),
    /** Optional hard cap on events accepted per calendar month (drops excess). */
    monthlyEventQuota: v.optional(v.number()),
    /** Optional automatic spike protection: max events accepted per minute. */
    spikeThresholdPerMinute: v.optional(v.number()),
    /** Optional inbound data filters: drop matching error events at ingest. */
    ingestFilters: v.optional(ingestFiltersValidator),
    /** Optional owning team (see the `teams` table); null = org-wide. */
    teamId: v.optional(v.id('teams')),
  })
    .index('by_org', ['organizationId'])
    .index('by_publicId', ['publicId'])
    .index('by_org_slug', ['organizationId', 'slug']),

  // Per-project issue-tracker integration (Jira / Linear). Credentials are supplied
  // by the self-hoster and stored here; queries never return the raw secrets.
  projectIntegrations: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    config: trackerConfigValidator,
    isEnabled: v.boolean(),
    /** Create a tracker ticket automatically when a new issue appears. */
    autoCreate: v.boolean(),
    createdAt: v.number(),
  }).index('by_project', ['projectId']),

  // Custom dashboards: named, org-shared collections of saved Discover queries.
  dashboards: defineTable({
    organizationId: v.string(),
    name: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index('by_org', ['organizationId']),

  // A single dashboard widget: a saved Discover query rendered as a chart.
  dashboardWidgets: defineTable({
    organizationId: v.string(),
    dashboardId: v.id('dashboards'),
    title: v.string(),
    dataset: discoverDatasetValidator,
    groupBy: v.string(),
    aggregate: discoverAggregateValidator,
    hours: v.number(),
    projectId: v.optional(v.id('projects')),
    filters: v.optional(v.array(v.object({ field: v.string(), value: v.string() }))),
    order: v.number(),
  })
    .index('by_dashboard', ['dashboardId', 'order'])
    .index('by_project', ['projectId']),

  // Sveltry's own per-member roles, layered on Better Auth org membership and keyed
  // by the Better Auth user id. Enforced in Convex (see lib/auth `requireRole`). An
  // org with no rows treats its first caller as owner (self-hosted bootstrap).
  memberRoles: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    role: roleValidator,
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_org_user', ['organizationId', 'userId'])
    .index('by_user', ['userId']),

  // Organization API tokens for the public read API (Bearer auth). Only the SHA-1
  // hash of the token is stored; the raw value is shown once at creation. A token
  // grants read access scoped to its organization.
  // Organization audit log: a record of who changed what (config, access,
  // credentials). Append-only; surfaced to admins on the settings page.
  auditLog: defineTable({
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    /** A dotted action key, e.g. `role.set`, `token.create`, `key.disable`. */
    action: v.string(),
    /** Human-readable target (a name, slug, or email). */
    target: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  }).index('by_org', ['organizationId']),

  apiTokens: defineTable({
    organizationId: v.string(),
    name: v.string(),
    tokenHash: v.string(),
    /** First chars of the raw token (e.g. `svtry_1a2b3c4d`), for display only. */
    tokenPrefix: v.string(),
    /** Access level: `read` (default) or `write` (read + triage). Optional for back-compat. */
    scope: v.optional(v.union(v.literal('read'), v.literal('write'))),
    createdBy: v.string(),
    createdByEmail: v.optional(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index('by_org', ['organizationId'])
    .index('by_hash', ['tokenHash']),

  // Pending email invitations to join an org with a given role. The `token` is the
  // unguessable secret in the accept link; an invite is accepted by a logged-in
  // user whose email matches. Accepted/expired rows are retained for the record.
  invitations: defineTable({
    organizationId: v.string(),
    email: v.string(),
    role: roleValidator,
    token: v.string(),
    invitedBy: v.string(),
    invitedByEmail: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedBy: v.optional(v.string()),
  })
    .index('by_token', ['token'])
    .index('by_org', ['organizationId'])
    .index('by_org_email', ['organizationId', 'email']),

  // Teams group an org's members and own a subset of its projects (Sentry's teams).
  // Modeled in Convex (alongside projects and all other data) rather than in Better
  // Auth's Postgres, so project/team access logic lives in one place.
  teams: defineTable({
    organizationId: v.string(),
    name: v.string(),
    slug: v.string(),
    createdAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_org_slug', ['organizationId', 'slug']),

  // Which users belong to a team. `email`/`name` are denormalized from the Better
  // Auth member record at add time, for display without a cross-system join.
  teamMembers: defineTable({
    organizationId: v.string(),
    teamId: v.id('teams'),
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    addedAt: v.number(),
  })
    .index('by_team', ['teamId'])
    .index('by_team_user', ['teamId', 'userId'])
    .index('by_org_user', ['organizationId', 'userId']),

  // Per-project fixed one-minute windows for automatic spike protection.
  spikeWindows: defineTable({
    projectId: v.id('projects'),
    windowStart: v.number(),
    count: v.number(),
  })
    .index('by_project_window', ['projectId', 'windowStart'])
    .index('by_window', ['windowStart']),

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
    /** Optional allowed-origin patterns (Sentry's "Allowed Domains"); empty = any. */
    allowedOrigins: v.optional(v.array(v.string())),
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
    /** A linked tracker ticket (Jira/Linear), set once created from this issue. */
    trackerProvider: v.optional(v.string()),
    trackerKey: v.optional(v.string()),
    trackerUrl: v.optional(v.string()),
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
  })
    .index('by_org', ['organizationId', 'bucketStart'])
    .index('by_project', ['projectId']),

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
  })
    .index('by_event', ['eventId'])
    .index('by_project', ['projectId']),

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
    .index('by_event', ['eventId'])
    .index('by_project', ['projectId']),

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
    .index('by_enabled', ['enabled'])
    .index('by_project', ['projectId']),

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

  // Deploys recorded against a release (via the deploy API).
  deploys: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    release: v.string(),
    environment: v.string(),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    deployedAt: v.number(),
  }).index('by_project', ['projectId', 'deployedAt']),

  // Per-project, per-day usage counters (events/transactions accepted, plus
  // client-side/quota/spike drops and inbound-filter drops). One write per ingest
  // batch. `filteredCount` is optional so existing rows keep working.
  usageDaily: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    day: v.number(),
    eventCount: v.number(),
    transactionCount: v.number(),
    droppedCount: v.number(),
    /** Error events dropped by inbound data filters (see `projects.ingestFilters`). */
    filteredCount: v.optional(v.number()),
  })
    .index('by_project_day', ['projectId', 'day'])
    .index('by_org_day', ['organizationId', 'day']),

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
    /** Convex file-storage id when the blob lives in Convex; unset once offloaded to S3. */
    storageId: v.optional(v.id('_storage')),
    /** Set when the blob has been offloaded to S3/R2 (see lib `parseS3Env`). */
    s3Bucket: v.optional(v.string()),
    s3Key: v.optional(v.string()),
    size: v.number(),
    /** For a minified artifact, the `sourceMappingURL` annotation it carries, if any. */
    sourceMappingURL: v.optional(v.string()),
    /**
     * The artifact's debug id (from a `//# debugId=` comment on a minified file, or
     * the `debugId` field of a source map). Lets resolution match a frame to its map
     * by stable identity instead of path/release. See {@link parseDebugId}.
     */
    debugId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_project_release', ['projectId', 'release'])
    .index('by_project_release_name', ['projectId', 'release', 'name'])
    .index('by_project_debugid', ['projectId', 'debugId']),

  alertRules: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    name: v.string(),
    trigger: alertTriggerValidator,
    threshold: v.optional(v.number()),
    windowMinutes: v.optional(v.number()),
    minLevel: v.optional(levelValidator),
    /** Optional environment scope; when set, only events from this environment fire the rule. */
    environment: v.optional(v.string()),
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
    /** Optional environment scope; when set, the metric is computed over only that environment. */
    environment: v.optional(v.string()),
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

  // Per-project quota-usage alerts: notify when this calendar month's events reach
  // a percentage of the project's monthly quota. A cron evaluates them; each fires
  // at most once per month (tracked by `lastFiredMonth`).
  usageAlerts: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    /** Fire when month usage reaches this percent of the project's monthly quota. */
    thresholdPercent: v.number(),
    channels: v.array(alertChannelValidator),
    enabled: v.boolean(),
    /** UTC month-start (ms) this alert last fired, so it fires once per month. */
    lastFiredMonth: v.optional(v.number()),
    lastFiredAt: v.optional(v.number()),
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
  })
    .index('by_issue', ['issueId'])
    .index('by_project', ['projectId']),

  // History of issue merges, so a merge can be undone. Captures the merged-away
  // (source) issue's identifying snapshot and the events that moved into the target,
  // which `unmergeIssue` recreates and moves back. Only merges recorded here (i.e.
  // performed after this feature) are reversible.
  issueMerges: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    targetIssueId: v.id('issues'),
    source: v.object({
      fingerprint: v.string(),
      groupingConfig: v.string(),
      title: v.string(),
      culprit: v.string(),
      level: levelValidator,
      platform: v.string(),
      errorType: v.optional(v.string()),
      firstSeen: v.number(),
      count: v.number(),
      userCount: v.number(),
    }),
    movedEventIds: v.array(v.id('events')),
    mergedAt: v.number(),
  })
    .index('by_target', ['targetIssueId'])
    .index('by_project', ['projectId']),

  // Commit metadata uploaded with a release (Sentry's `set-commits`). Used to find
  // an issue's "suspect commit": the most recent commit that changed a file in the
  // issue's stack trace. `files` is the commit's changed paths.
  releaseCommits: defineTable({
    organizationId: v.string(),
    projectId: v.id('projects'),
    release: v.string(),
    commitId: v.string(),
    message: v.optional(v.string()),
    author: v.optional(v.string()),
    authorEmail: v.optional(v.string()),
    url: v.optional(v.string()),
    timestamp: v.number(),
    files: v.array(v.string()),
    createdAt: v.number(),
  }).index('by_project_release', ['projectId', 'release']),

  // Named issue-list filter presets (Sentry's "saved searches"). Org-shared so a
  // team converges on the same triage views; `userId` records the author. The
  // fields mirror the issues list filter state.
  savedViews: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    name: v.string(),
    query: v.optional(v.string()),
    status: v.optional(issueStatusValidator),
    level: v.optional(levelValidator),
    projectId: v.optional(v.id('projects')),
    createdAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_project', ['projectId']),

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
