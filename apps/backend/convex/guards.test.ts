import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { TENANT_SCOPED_TABLES } from './lib/tenantTables';

// convex-test loads every Convex module in-process. The glob excludes test files.
// `import.meta.glob` is a Vite/vitest API (typed via the vite/client reference
// above); it must stay in this literal call form for Vite to transform it.
const modules = import.meta.glob('./**/!(*.test).{ts,js}');

const PUBLIC_ID = '111111111';
const KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function seed(
  t: ReturnType<typeof convexTest>,
  org = 'org-a',
  publicId = PUBLIC_ID,
  key = KEY,
) {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: org,
      slug: `p-${org}`,
      name: 'P',
      platform: 'node',
      publicId,
      createdAt: 0,
      eventRetentionDays: 30,
      scrubPii: false,
    });
    const keyId = await ctx.db.insert('projectKeys', {
      projectId,
      organizationId: org,
      label: 'default',
      publicKey: key,
      isActive: true,
      createdAt: 0,
    });
    return { projectId, keyId };
  });
}

function envelope(eventId: string): string {
  return (
    JSON.stringify({ event_id: eventId }) +
    '\n' +
    JSON.stringify({ type: 'event' }) +
    '\n' +
    JSON.stringify({ event_id: eventId, message: 'boom', level: 'error' }) +
    '\n'
  );
}

/** An envelope carrying a single `sessions` aggregate item (no event id). */
function sessionAggEnvelope(release: string, exited: number, crashed: number): string {
  const payload = {
    attrs: { release, environment: 'production' },
    aggregates: [{ started: '2026-01-01T00:00:00.000Z', exited, crashed }],
  };
  return (
    JSON.stringify({}) +
    '\n' +
    JSON.stringify({ type: 'sessions' }) +
    '\n' +
    JSON.stringify(payload) +
    '\n'
  );
}

describe('ingest DSN authentication', () => {
  test('rejects an unknown / inactive DSN key with 401', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const res = await t.fetch(`/api/${PUBLIC_ID}/envelope/?sentry_key=wrongkey`, {
      method: 'POST',
      body: envelope('11111111111111111111111111111111'),
    });
    expect(res.status).toBe(401);
  });

  test('accepts a valid DSN key and stores the event tagged to the project org', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seed(t);
    const res = await t.fetch(`/api/${PUBLIC_ID}/envelope/?sentry_key=${KEY}`, {
      method: 'POST',
      body: envelope('22222222222222222222222222222222'),
    });
    expect(res.status).toBe(200);
    const events = await t.run((ctx) => ctx.db.query('events').collect());
    expect(events.length).toBe(1);
    expect(events[0]!.organizationId).toBe('org-a');
    expect(events[0]!.projectId).toBe(projectId);
  });

  test('a key from another project cannot inject into this project (publicId must match)', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    // Same key string but a different URL publicId -> resolveIngestKey rejects.
    const res = await t.fetch(`/api/999999999/envelope/?sentry_key=${KEY}`, {
      method: 'POST',
      body: envelope('33333333333333333333333333333333'),
    });
    expect(res.status).toBe(401);
  });
});

describe('ingest idempotency', () => {
  test('re-sending the same envelope does not duplicate the event or double-count usage', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const body = envelope('44444444444444444444444444444444');
    for (let i = 0; i < 2; i++) {
      const res = await t.fetch(`/api/${PUBLIC_ID}/envelope/?sentry_key=${KEY}`, {
        method: 'POST',
        body,
      });
      expect(res.status).toBe(200);
    }
    const events = await t.run((ctx) => ctx.db.query('events').collect());
    expect(events.length).toBe(1);
    const usage = await t.run((ctx) => ctx.db.query('usageDaily').collect());
    const totalEvents = usage.reduce((s, u) => s + u.eventCount, 0);
    expect(totalEvents).toBe(1);
  });
});

describe('session-aggregate idempotency (ERR-001)', () => {
  test('re-sending the same sessions aggregate is a no-op, but distinct counts still insert', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const body = sessionAggEnvelope('1.0.0', 3, 1);
    // Two identical deliveries (the second models a full-batch SDK retry).
    for (let i = 0; i < 2; i++) {
      const res = await t.fetch(`/api/${PUBLIC_ID}/envelope/?sentry_key=${KEY}`, {
        method: 'POST',
        body,
      });
      expect(res.status).toBe(200);
    }
    let buckets = await t.run((ctx) => ctx.db.query('sessionBuckets').collect());
    expect(buckets.length).toBe(1);
    expect(buckets[0]!.exited + buckets[0]!.crashed).toBe(4);

    // A genuinely distinct delivery (different counts, same minute) still inserts,
    // so additive aggregation across legitimate flushes is preserved.
    const res = await t.fetch(`/api/${PUBLIC_ID}/envelope/?sentry_key=${KEY}`, {
      method: 'POST',
      body: sessionAggEnvelope('1.0.0', 5, 0),
    });
    expect(res.status).toBe(200);
    buckets = await t.run((ctx) => ctx.db.query('sessionBuckets').collect());
    expect(buckets.length).toBe(2);
  });
});

describe('transaction lean projection (PERF-001)', () => {
  const txnArgs = (projectId: Id<'projects'>) => ({
    projectId,
    organizationId: 'org-a',
    eventId: 'tx1',
    traceId: 'tr',
    spanId: 'sp',
    name: 'GET /a',
    op: 'http.server',
    status: 'ok',
    timestamp: 5,
    endTimestamp: 6,
    durationMs: 42,
    platform: 'javascript',
    environment: 'production',
    tags: {},
    spanCount: 3,
    payload: { measurements: { lcp: { value: 1200 }, cls: { value: 0.1 } }, spans: [{}, {}, {}] },
  });

  test('recordTransaction writes a 1:1 lean meta row with web vitals extracted', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seed(t);

    const res = await t.mutation(internal.ingest.recordTransaction, txnArgs(projectId));
    expect(res.inserted).toBe(true);

    const meta = await t.run((ctx) => ctx.db.query('transactionsMeta').collect());
    expect(meta.length).toBe(1);
    expect(meta[0]!.name).toBe('GET /a');
    expect(meta[0]!.durationMs).toBe(42);
    expect(meta[0]!.spanCount).toBe(3);
    // The numeric web-vitals values are extracted from payload.measurements.
    expect(meta[0]!.measurements).toEqual({ lcp: 1200, cls: 0.1 });
    // The meta row points back at its transaction (1:1).
    const txns = await t.run((ctx) => ctx.db.query('transactions').collect());
    expect(txns.length).toBe(1);
    expect(meta[0]!.transactionId).toBe(txns[0]!._id);
  });

  test('an SDK retry (same eventId) does not double-write the meta row', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seed(t);
    await t.mutation(internal.ingest.recordTransaction, txnArgs(projectId));
    const retry = await t.mutation(internal.ingest.recordTransaction, txnArgs(projectId));
    expect(retry.inserted).toBe(false);
    const meta = await t.run((ctx) => ctx.db.query('transactionsMeta').collect());
    expect(meta.length).toBe(1);
  });
});

describe('onboarding status (setup checklist)', () => {
  test('reflects project + event state, and dismissal sticks', async () => {
    const t = convexTest(schema, modules);
    const asMember = t.withIdentity({ subject: 'u', activeOrganizationId: 'org-a' });

    // Fresh org: nothing done yet.
    let s = await asMember.query(api.organizations.onboardingStatus, {});
    expect(s).toEqual({ hasProject: false, hasEvent: false, dismissed: false });

    // After a project exists.
    const { projectId } = await seed(t);
    s = await asMember.query(api.organizations.onboardingStatus, {});
    expect(s.hasProject).toBe(true);
    expect(s.hasEvent).toBe(false);

    // After a first event lands.
    await t.run(async (ctx) => {
      const issueId = await ctx.db.insert('issues', {
        organizationId: 'org-a',
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
        userCount: 0,
        firstSeen: 0,
        lastSeen: 0,
      });
      await ctx.db.insert('events', {
        organizationId: 'org-a',
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
    });
    s = await asMember.query(api.organizations.onboardingStatus, {});
    expect(s.hasEvent).toBe(true);

    // Dismissal persists for the user.
    await asMember.mutation(api.organizations.dismissOnboarding, {});
    s = await asMember.query(api.organizations.onboardingStatus, {});
    expect(s.dismissed).toBe(true);
  });
});

describe('first-event activation check (firstEventForProject)', () => {
  async function seedIssueAndEvent(t: ReturnType<typeof convexTest>, projectId: Id<'projects'>) {
    return await t.run(async (ctx) => {
      const issueId = await ctx.db.insert('issues', {
        organizationId: 'org-a',
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
        userCount: 0,
        firstSeen: 0,
        lastSeen: 0,
      });
      await ctx.db.insert('events', {
        organizationId: 'org-a',
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
      return issueId;
    });
  }

  test('reports received=false before any event, true (with the issue) after', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seed(t);
    const asMember = t.withIdentity({ subject: 'u', activeOrganizationId: 'org-a' });

    const before = await asMember.query(api.projects.firstEventForProject, { projectId });
    expect(before.received).toBe(false);
    expect(before.issueId).toBe(null);

    const issueId = await seedIssueAndEvent(t, projectId);
    const after = await asMember.query(api.projects.firstEventForProject, { projectId });
    expect(after.received).toBe(true);
    expect(after.issueId).toBe(issueId);
  });

  test('is org-scoped: another org cannot see this project as activated', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seed(t);
    await seedIssueAndEvent(t, projectId);
    // A caller in a different org gets received=false (project not found for them).
    const asOther = t.withIdentity({ subject: 'v', activeOrganizationId: 'org-b' });
    const res = await asOther.query(api.projects.firstEventForProject, { projectId });
    expect(res.received).toBe(false);
    expect(res.issueId).toBe(null);
  });
});

describe('project lifecycle (registry-driven purge / restamp)', () => {
  // Seed one row in a representative spread of tenant tables: a hot table
  // (events), the historically-orphaned webhooks (with a secret), an issue plus
  // its non-registry children (comments + users), a savedView (detached on
  // transfer, deleted on purge), and a sessionBucket. Returns the issue id.
  async function seedLifecycleRows(
    t: ReturnType<typeof convexTest>,
    projectId: Id<'projects'>,
  ): Promise<Id<'issues'>> {
    return await t.run(async (ctx) => {
      const issueId = await ctx.db.insert('issues', {
        organizationId: 'org-a',
        projectId,
        fingerprint: 'f',
        groupingConfig: 'g',
        title: 'T',
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
      await ctx.db.insert('events', {
        organizationId: 'org-a',
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
      await ctx.db.insert('issueComments', {
        organizationId: 'org-a',
        issueId,
        authorId: 'u',
        body: 'b',
        createdAt: 0,
      });
      await ctx.db.insert('issueUsers', { issueId, userId: 'u', firstSeen: 0 });
      await ctx.db.insert('webhooks', {
        organizationId: 'org-a',
        projectId,
        url: 'https://hook.example/x',
        secret: 's3cr3t',
        events: ['issue.resolved'],
        enabled: true,
        createdBy: 'u',
        createdAt: 0,
      });
      await ctx.db.insert('savedViews', {
        organizationId: 'org-a',
        userId: 'u',
        name: 'v',
        projectId,
        createdAt: 0,
      });
      await ctx.db.insert('sessionBuckets', {
        organizationId: 'org-a',
        projectId,
        release: '1.0.0',
        environment: 'production',
        bucketStart: 0,
        exited: 1,
        errored: 0,
        crashed: 0,
        abnormal: 0,
        receivedAt: 0,
      });
      return issueId;
    });
  }

  test('purgeProjectData empties tenant tables, incl. webhooks and issue children', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seed(t);
    await seedLifecycleRows(t, projectId);

    await t.mutation(internal.projectLifecycle.purgeProjectData, { projectId });

    await t.run(async (ctx) => {
      for (const table of [
        'events',
        'webhooks',
        'issues',
        'issueComments',
        'issueUsers',
        'savedViews',
        'sessionBuckets',
        'projectKeys',
      ] as const) {
        const rows = await ctx.db.query(table).collect();
        expect(rows.length, `${table} should be empty after purge`).toBe(0);
      }
    });
  });

  test('restampProjectOrg rewrites org-bearing rows and detaches savedViews', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seed(t);
    const issueId = await seedLifecycleRows(t, projectId);

    // Drive the step machine one step per table (each seeded table holds <= 1 row,
    // so every step completes in a single page).
    for (let step = 0; step < TENANT_SCOPED_TABLES.length; step++) {
      await t.mutation(internal.projectLifecycle.restampProjectOrg, {
        projectId,
        targetOrganizationId: 'org-b',
        step,
        cursor: null,
      });
    }

    await t.run(async (ctx) => {
      const ev = await ctx.db.query('events').collect();
      expect(ev[0]!.organizationId).toBe('org-b');
      const wh = await ctx.db.query('webhooks').collect();
      expect(wh[0]!.organizationId).toBe('org-b');
      const issue = await ctx.db.get(issueId);
      expect(issue!.organizationId).toBe('org-b');
      const comments = await ctx.db.query('issueComments').collect();
      expect(comments[0]!.organizationId).toBe('org-b');
      const sb = await ctx.db.query('sessionBuckets').collect();
      expect(sb[0]!.organizationId).toBe('org-b');
      // savedViews belong to the SOURCE org: detached from the project, not moved.
      const sv = await ctx.db.query('savedViews').collect();
      expect(sv[0]!.projectId).toBeUndefined();
      expect(sv[0]!.organizationId).toBe('org-a');
    });
  });
});

describe('multi-tenant isolation', () => {
  test('a query is scoped to the caller active org and a cross-org project returns nothing', async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, 'org-a', '111111111', 'a'.repeat(32));
    const b = await seed(t, 'org-b', '222222222', 'b'.repeat(32));
    // Create one issue in each org via the (already-tested) ingest path.
    await t.fetch(`/api/111111111/envelope/?sentry_key=${'a'.repeat(32)}`, {
      method: 'POST',
      body: envelope('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'),
    });
    await t.fetch(`/api/222222222/envelope/?sentry_key=${'b'.repeat(32)}`, {
      method: 'POST',
      body: envelope('b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'),
    });

    const asA = t.withIdentity({ subject: 'user-a', activeOrganizationId: 'org-a' });
    const opts = { numItems: 50, cursor: null };

    // org-a sees exactly its own issue, org-wide.
    const aOrgWide = await asA.query(api.issues.listIssues, { paginationOpts: opts });
    expect(aOrgWide.page.length).toBe(1);
    expect(aOrgWide.page[0]!.organizationId).toBe('org-a');

    // org-a asking for org-b's project gets nothing (the org re-check rejects it).
    const aIntoB = await asA.query(api.issues.listIssues, {
      paginationOpts: opts,
      projectId: b.projectId,
    });
    expect(aIntoB.page.length).toBe(0);

    // org-b, by contrast, sees its own issue in that project.
    const asB = t.withIdentity({ subject: 'user-b', activeOrganizationId: 'org-b' });
    const bIntoB = await asB.query(api.issues.listIssues, {
      paginationOpts: opts,
      projectId: b.projectId,
    });
    expect(bIntoB.page.length).toBe(1);
    void a;
  });

  test('an unauthenticated query is rejected', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.issues.listIssues, { paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow();
  });
});

describe('config warnings (OBS-002)', () => {
  test('warns when an email alert channel exists while SMTP is unconfigured', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert('alertRules', {
        organizationId: 'org-a',
        projectId,
        name: 'R',
        trigger: 'new_issue',
        channels: [{ type: 'email', target: 'x@example.com' }],
        isEnabled: true,
        createdAt: 0,
      }),
    );
    const asAdmin = t.withIdentity({ subject: 'u', activeOrganizationId: 'org-a' });
    const status = await asAdmin.query(api.health.configStatus, {});
    // SMTP is unset in the test env, and an email channel now exists.
    expect(status.warnings.some((w) => w.toLowerCase().includes('email channel'))).toBe(true);
  });

  test('no email-channel warning when no email channel is configured', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asAdmin = t.withIdentity({ subject: 'u', activeOrganizationId: 'org-a' });
    const status = await asAdmin.query(api.health.configStatus, {});
    expect(status.warnings.some((w) => w.toLowerCase().includes('email channel'))).toBe(false);
  });
});

describe('per-key rate limiting', () => {
  test('checkRateLimit allows up to the limit, then throttles', async () => {
    const t = convexTest(schema, modules);
    const { keyId } = await seed(t);
    const args = { keyId: keyId as Id<'projectKeys'>, limitCount: 2, windowSeconds: 60 };
    expect((await t.mutation(internal.ingest.checkRateLimit, args)).ok).toBe(true);
    expect((await t.mutation(internal.ingest.checkRateLimit, args)).ok).toBe(true);
    expect((await t.mutation(internal.ingest.checkRateLimit, args)).ok).toBe(false);
  });
});
