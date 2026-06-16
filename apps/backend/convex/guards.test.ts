import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

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
