import { convexTest } from 'convex-test';
import { sha1Hex } from '@sveltry/protocol';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

const modules = import.meta.glob('./**/!(*.test).{ts,js}');

/** A well-formed org API token (`svtry_` + 64 hex). */
function rawToken(seed: string): string {
  return `svtry_${seed.repeat(64).slice(0, 64)}`;
}

/** Seed an org with one project; return the project id. */
async function seedOrg(t: ReturnType<typeof convexTest>, org: string): Promise<Id<'projects'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('projects', {
      organizationId: org,
      slug: `p-${org}`,
      name: 'P',
      platform: 'node',
      publicId: org,
      createdAt: 0,
      eventRetentionDays: 30,
      scrubPii: false,
    });
  });
}

/** Insert an org API token; returns the raw bearer value. */
async function seedToken(
  t: ReturnType<typeof convexTest>,
  org: string,
  scope: 'read' | 'write',
  seed: string,
): Promise<string> {
  const raw = rawToken(seed);
  await t.run(async (ctx) => {
    await ctx.db.insert('apiTokens', {
      organizationId: org,
      name: 'tok',
      tokenHash: sha1Hex(raw),
      tokenPrefix: raw.slice(0, 14),
      scope,
      createdBy: 'u',
      createdAt: 0,
    });
  });
  return raw;
}

/** Insert a minimal issue for a project; returns the issue id. */
async function seedIssue(
  t: ReturnType<typeof convexTest>,
  org: string,
  projectId: Id<'projects'>,
): Promise<Id<'issues'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('issues', {
      organizationId: org,
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
  });
}

function bearer(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } };
}

describe('public API v1 authentication and org scoping', () => {
  test('rejects a missing or malformed bearer token with 401', async () => {
    const t = convexTest(schema, modules);
    await seedOrg(t, 'org-a');
    expect((await t.fetch('/api/v1/projects')).status).toBe(401);
    expect((await t.fetch('/api/v1/projects', bearer('not-a-token'))).status).toBe(401);
    expect((await t.fetch('/api/v1/projects', bearer(rawToken('f')))).status).toBe(401); // unknown
  });

  test('a token only sees its own org projects', async () => {
    const t = convexTest(schema, modules);
    await seedOrg(t, 'org-a');
    await seedOrg(t, 'org-b');
    const tokA = await seedToken(t, 'org-a', 'read', 'a');

    const res = await t.fetch('/api/v1/projects', bearer(tokA));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: { slug: string }[] };
    expect(body.projects.map((p) => p.slug)).toEqual(['p-org-a']);
  });

  test('a token cannot read another org issue by id (cross-org isolation)', async () => {
    const t = convexTest(schema, modules);
    const projA = await seedOrg(t, 'org-a');
    const projB = await seedOrg(t, 'org-b');
    void projA;
    const issueB = await seedIssue(t, 'org-b', projB);
    const tokA = await seedToken(t, 'org-a', 'read', 'a');

    const res = await t.fetch(`/api/v1/issues/${issueB}`, bearer(tokA));
    expect(res.status).toBe(404); // org-a's token must not surface org-b's issue
  });

  test('GET /events/<id> is org-scoped: a shared eventId returns the caller own row', async () => {
    const t = convexTest(schema, modules);
    const projA = await seedOrg(t, 'org-a');
    const projB = await seedOrg(t, 'org-b');
    const issueA = await seedIssue(t, 'org-a', projA);
    const issueB = await seedIssue(t, 'org-b', projB);
    // Same Sentry event id in both orgs: eventId is unique per project, not global.
    await t.run(async (ctx) => {
      for (const [org, projectId, issueId, msg] of [
        ['org-a', projA, issueA, 'from-a'],
        ['org-b', projB, issueB, 'from-b'],
      ] as const) {
        await ctx.db.insert('events', {
          organizationId: org,
          projectId,
          issueId,
          eventId: 'SHARED',
          timestamp: 0,
          receivedAt: 0,
          level: 'error',
          platform: 'node',
          environment: 'production',
          message: msg,
          culprit: 'c',
          tags: {},
          payload: {},
        });
      }
    });
    const tokA = await seedToken(t, 'org-a', 'read', 'a');

    const res = await t.fetch('/api/v1/events/SHARED', bearer(tokA));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('from-a'); // not org-b's colliding row
  });
});

describe('public API v1 write-scope enforcement and issue-status parity', () => {
  test('a read token cannot triage; a write token can', async () => {
    const t = convexTest(schema, modules);
    const proj = await seedOrg(t, 'org-a');
    const issue = await seedIssue(t, 'org-a', proj);
    const readTok = await seedToken(t, 'org-a', 'read', 'a');
    const writeTok = await seedToken(t, 'org-a', 'write', 'b');

    const denied = await t.fetch(`/api/v1/issues/${issue}/resolve`, {
      method: 'POST',
      ...bearer(readTok),
    });
    expect(denied.status).toBe(403); // read-only token

    const ok = await t.fetch(`/api/v1/issues/${issue}/resolve`, {
      method: 'POST',
      ...bearer(writeTok),
    });
    expect(ok.status).toBe(200);
    const after = await t.run((ctx) => ctx.db.get(issue));
    expect(after!.status).toBe('resolved');
    expect(after!.substatus).toBe('ongoing'); // default substatus for resolved
  });

  test('dashboard and public API produce identical issue state (shared transition)', async () => {
    const t = convexTest(schema, modules);
    const proj = await seedOrg(t, 'org-a');
    const viaDashboard = await seedIssue(t, 'org-a', proj);
    const viaApi = await seedIssue(t, 'org-a', proj);

    // Dashboard transport: the authenticated mutation.
    const asMember = t.withIdentity({ subject: 'u', activeOrganizationId: 'org-a' });
    await asMember.mutation(api.issues.setIssueStatus, {
      issueId: viaDashboard,
      status: 'resolved',
    });

    // Public API transport: a write-scoped token POST.
    const writeTok = await seedToken(t, 'org-a', 'write', 'b');
    const res = await t.fetch(`/api/v1/issues/${viaApi}/resolve`, {
      method: 'POST',
      ...bearer(writeTok),
    });
    expect(res.status).toBe(200);

    const [d, a] = await t.run(async (ctx) => [
      await ctx.db.get(viaDashboard),
      await ctx.db.get(viaApi),
    ]);
    expect(a!.status).toBe(d!.status);
    expect(a!.substatus).toBe(d!.substatus);
  });

  test('the lifecycle webhook is scheduled only when the status actually changes', async () => {
    const t = convexTest(schema, modules);
    const proj = await seedOrg(t, 'org-a');
    const issue = await seedIssue(t, 'org-a', proj);
    const writeTok = await seedToken(t, 'org-a', 'write', 'b');

    const dispatchCount = async () =>
      await t.run(async (ctx) => {
        const jobs = await ctx.db.system.query('_scheduled_functions').collect();
        return jobs.filter((j) => j.name.includes('webhooks') && j.name.includes('dispatch'))
          .length;
      });

    // unresolved -> resolved is a real change: one dispatch scheduled.
    await t.fetch(`/api/v1/issues/${issue}/resolve`, { method: 'POST', ...bearer(writeTok) });
    expect(await dispatchCount()).toBe(1);

    // resolved -> resolved is a no-op: no additional dispatch scheduled.
    await t.fetch(`/api/v1/issues/${issue}/resolve`, { method: 'POST', ...bearer(writeTok) });
    expect(await dispatchCount()).toBe(1);
  });
});
