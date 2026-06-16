import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { TENANT_SCOPED_TABLES } from './lib/tenantTables';

const modules = import.meta.glob('./**/!(*.test).{ts,js}');

const ORG = 'org-a';
const CHANNELS = [{ type: 'webhook' as const, target: 'https://example/x' }];

/**
 * Seed exactly one row in every project-scoped tenant table (plus the two
 * issue-scoped children purge must also drain), so the registry-driven
 * `purgeProjectData` / `restampProjectOrg` are exercised against the full set.
 * Returns the project + the seeded issue id.
 */
async function seedEveryTenantTable(
  t: ReturnType<typeof convexTest>,
): Promise<{ projectId: Id<'projects'>; issueId: Id<'issues'> }> {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      slug: 'p',
      name: 'P',
      platform: 'node',
      publicId: '1',
      createdAt: 0,
      eventRetentionDays: 30,
      scrubPii: false,
    });
    const issueId = await ctx.db.insert('issues', {
      organizationId: ORG,
      projectId,
      fingerprint: 'fp',
      groupingConfig: 'g',
      title: 'boom',
      culprit: 'c',
      level: 'error',
      platform: 'node',
      status: 'unresolved',
      substatus: 'new',
      count: 1,
      userCount: 1,
      firstSeen: 0,
      lastSeen: 0,
    });
    const dashboardId = await ctx.db.insert('dashboards', {
      organizationId: ORG,
      name: 'D',
      createdBy: 'u',
      createdAt: 0,
    });
    const webhookId = await ctx.db.insert('webhooks', {
      organizationId: ORG,
      projectId,
      url: 'https://hook/x',
      secret: 's',
      events: ['issue.resolved'],
      enabled: true,
      createdBy: 'u',
      createdAt: 0,
    });
    const ruleId = await ctx.db.insert('alertRules', {
      organizationId: ORG,
      projectId,
      name: 'R',
      trigger: 'new_issue',
      channels: CHANNELS,
      isEnabled: true,
      createdAt: 0,
    });
    const blob1 = await ctx.storage.store(new Blob(['a']));
    const blob2 = await ctx.storage.store(new Blob(['b']));

    // Issue-scoped children (drained by the issues purger, re-stamped via it).
    await ctx.db.insert('issueComments', {
      organizationId: ORG,
      issueId,
      authorId: 'u',
      body: 'b',
      createdAt: 0,
    });
    await ctx.db.insert('issueUsers', { issueId, userId: 'u', firstSeen: 0 });

    await ctx.db.insert('projectKeys', {
      projectId,
      organizationId: ORG,
      label: 'default',
      publicKey: 'k',
      isActive: true,
      createdAt: 0,
    });
    await ctx.db.insert('events', {
      organizationId: ORG,
      projectId,
      issueId,
      eventId: 'e1',
      timestamp: 0,
      receivedAt: 0,
      level: 'error',
      platform: 'node',
      environment: 'production',
      message: 'm',
      culprit: 'c',
      tags: {},
      payload: {},
    });
    await ctx.db.insert('transactions', {
      organizationId: ORG,
      projectId,
      eventId: 't1',
      traceId: 'tr',
      spanId: 'sp',
      name: 'GET /',
      op: 'http.server',
      status: 'ok',
      timestamp: 0,
      endTimestamp: 1,
      durationMs: 1,
      platform: 'node',
      environment: 'production',
      tags: {},
      spanCount: 1,
      payload: {},
    });
    await ctx.db.insert('transactionRollups', {
      organizationId: ORG,
      projectId,
      transactionName: 'GET /',
      bucketStart: 0,
      count: 1,
      sumMs: 1,
      maxMs: 1,
      histogram: [1],
    });
    await ctx.db.insert('sessions', {
      organizationId: ORG,
      projectId,
      sid: 's1',
      release: '1',
      environment: 'production',
      status: 'exited',
      errors: 0,
      startedAt: 0,
      lastUpdate: 0,
    });
    await ctx.db.insert('sessionBuckets', {
      organizationId: ORG,
      projectId,
      release: '1',
      environment: 'production',
      bucketStart: 0,
      exited: 1,
      errored: 0,
      crashed: 0,
      abnormal: 0,
      receivedAt: 0,
    });
    await ctx.db.insert('profiles', {
      organizationId: ORG,
      projectId,
      profileId: 'pr1',
      transactionName: 'GET /',
      sampleCount: 1,
      durationMs: 1,
      platform: 'node',
      environment: 'production',
      timestamp: 0,
      payload: {},
    });
    await ctx.db.insert('replays', {
      organizationId: ORG,
      projectId,
      replayId: 'r1',
      startedAt: 0,
      lastSegmentAt: 0,
      segmentCount: 1,
      errorCount: 0,
    });
    await ctx.db.insert('replaySegments', {
      organizationId: ORG,
      projectId,
      replayId: 'r1',
      segmentId: 0,
      storageId: blob1,
      timestamp: 0,
    });
    await ctx.db.insert('attachments', {
      organizationId: ORG,
      projectId,
      eventId: 'e1',
      filename: 'f',
      size: 1,
      storageId: blob2,
      createdAt: 0,
    });
    await ctx.db.insert('feedback', {
      organizationId: ORG,
      projectId,
      message: 'hi',
      createdAt: 0,
    });
    await ctx.db.insert('monitors', {
      organizationId: ORG,
      projectId,
      slug: 'cron',
      latestStatus: 'ok',
      lastCheckInAt: 0,
      createdAt: 0,
    });
    await ctx.db.insert('checkIns', {
      organizationId: ORG,
      projectId,
      monitorSlug: 'cron',
      checkInId: 'ci1',
      status: 'ok',
      environment: 'production',
      timestamp: 0,
    });
    await ctx.db.insert('uptimeMonitors', {
      organizationId: ORG,
      projectId,
      slug: 'up',
      url: 'https://x',
      method: 'GET',
      expectedStatus: 200,
      intervalSeconds: 60,
      enabled: true,
      createdAt: 0,
    });
    await ctx.db.insert('releases', {
      organizationId: ORG,
      projectId,
      version: '1',
      createdAt: 0,
    });
    await ctx.db.insert('releaseArtifacts', {
      organizationId: ORG,
      projectId,
      release: '1',
      name: '~/app.js',
      kind: 'minified',
      size: 1,
      createdAt: 0,
    });
    await ctx.db.insert('releaseCommits', {
      organizationId: ORG,
      projectId,
      release: '1',
      commitId: 'abc',
      timestamp: 0,
      files: [],
      createdAt: 0,
    });
    await ctx.db.insert('deploys', {
      organizationId: ORG,
      projectId,
      release: '1',
      environment: 'production',
      deployedAt: 0,
    });
    await ctx.db.insert('usageDaily', {
      organizationId: ORG,
      projectId,
      day: 0,
      eventCount: 1,
      transactionCount: 0,
      droppedCount: 0,
    });
    await ctx.db.insert('metricAlerts', {
      organizationId: ORG,
      projectId,
      name: 'M',
      metric: 'error_count',
      windowMinutes: 5,
      threshold: 1,
      channels: CHANNELS,
      enabled: true,
      createdAt: 0,
    });
    await ctx.db.insert('usageAlerts', {
      organizationId: ORG,
      projectId,
      thresholdPercent: 80,
      channels: CHANNELS,
      enabled: true,
      createdAt: 0,
    });
    await ctx.db.insert('alertDeliveries', {
      organizationId: ORG,
      projectId,
      issueId,
      ruleId,
      trigger: 'new_issue',
      channelType: 'webhook',
      target: 'https://x',
      ok: true,
      deliveredAt: 0,
    });
    await ctx.db.insert('notificationDeliveries', {
      organizationId: ORG,
      projectId,
      source: 'metric_alert',
      sourceId: 'x',
      label: 'L',
      channelType: 'webhook',
      target: 'https://x',
      ok: true,
      deliveredAt: 0,
    });
    await ctx.db.insert('webhookDeliveries', {
      organizationId: ORG,
      projectId,
      webhookId,
      issueId,
      event: 'issue.resolved',
      url: 'https://hook/x',
      ok: true,
      deliveredAt: 0,
    });
    await ctx.db.insert('issueMerges', {
      organizationId: ORG,
      projectId,
      targetIssueId: issueId,
      source: {
        fingerprint: 'fp2',
        groupingConfig: 'g',
        title: 't',
        culprit: 'c',
        level: 'error',
        firstSeen: 0,
        platform: 'node',
        count: 1,
        userCount: 0,
      },
      movedEventIds: [],
      mergedAt: 0,
    });
    await ctx.db.insert('projectIntegrations', {
      organizationId: ORG,
      projectId,
      config: { type: 'linear', apiKey: 'k', teamId: 't' },
      isEnabled: true,
      autoCreate: false,
      createdAt: 0,
    });
    await ctx.db.insert('spikeWindows', { projectId, windowStart: 0, count: 1 });
    await ctx.db.insert('savedViews', {
      organizationId: ORG,
      userId: 'u',
      name: 'v',
      projectId,
      createdAt: 0,
    });
    await ctx.db.insert('dashboardWidgets', {
      organizationId: ORG,
      dashboardId,
      title: 'W',
      dataset: 'errors',
      groupBy: 'release',
      aggregate: 'count',
      hours: 24,
      projectId,
      order: 0,
    });
    return { projectId, issueId };
  });
}

// Tables restamp does NOT rewrite to the target org: the two detach steps and the
// two no-ops (projectKeys is moved atomically by transferProject; spikeWindows has
// no organizationId). Mirrors the intentional exceptions in `restampProjectOrg`.
const RESTAMP_EXCEPTIONS = new Set([
  'savedViews',
  'dashboardWidgets',
  'projectKeys',
  'spikeWindows',
]);

describe('project lifecycle covers every registered tenant table (TEST-001)', () => {
  test('purgeProjectData empties all 32 tenant tables (and issue children)', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seedEveryTenantTable(t);

    // Sanity: every registered table actually has a seeded row to delete.
    await t.run(async (ctx) => {
      for (const table of TENANT_SCOPED_TABLES) {
        const rows = await ctx.db.query(table).collect();
        expect(rows.length, `${table} should be seeded`).toBeGreaterThan(0);
      }
    });

    await t.mutation(internal.projectLifecycle.purgeProjectData, { projectId });

    await t.run(async (ctx) => {
      for (const table of [...TENANT_SCOPED_TABLES, 'issueComments', 'issueUsers'] as const) {
        const rows = await ctx.db.query(table).collect();
        expect(rows.length, `${table} should be empty after purge`).toBe(0);
      }
    });
  });

  test('restampProjectOrg rewrites every org-bearing table and detaches the rest', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seedEveryTenantTable(t);

    // Drive the step machine one step per registered table (each holds one row).
    for (let step = 0; step < TENANT_SCOPED_TABLES.length; step++) {
      await t.mutation(internal.projectLifecycle.restampProjectOrg, {
        projectId,
        targetOrganizationId: 'org-b',
        step,
        cursor: null,
      });
    }

    await t.run(async (ctx) => {
      for (const table of TENANT_SCOPED_TABLES) {
        if (RESTAMP_EXCEPTIONS.has(table)) continue;
        const rows = await ctx.db.query(table).collect();
        for (const r of rows) {
          expect((r as { organizationId?: string }).organizationId, `${table} restamped`).toBe(
            'org-b',
          );
        }
      }
      // issueComments are re-stamped via the issues drainer.
      const comments = await ctx.db.query('issueComments').collect();
      expect(comments[0]!.organizationId).toBe('org-b');

      // Detach (not move): the project pointer is cleared, the source org is kept.
      for (const table of ['savedViews', 'dashboardWidgets'] as const) {
        const rows = await ctx.db.query(table).collect();
        expect(rows[0]!.projectId, `${table} detached`).toBeUndefined();
        expect(rows[0]!.organizationId, `${table} keeps source org`).toBe('org-a');
      }
      // No-ops here: projectKeys (moved by transferProject) keeps the source org;
      // spikeWindows carries no organizationId and is left in place.
      const keys = await ctx.db.query('projectKeys').collect();
      expect(keys[0]!.organizationId).toBe('org-a');
      const spikes = await ctx.db.query('spikeWindows').collect();
      expect(spikes.length).toBe(1);
    });
  });
});
