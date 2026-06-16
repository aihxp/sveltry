import { v } from 'convex/values';
import { sha1Hex } from '@sveltry/protocol';
import { internalMutation, query } from './_generated/server';
import { requireOrg } from './lib/auth';

/**
 * Upsert a session by sid. Sessions are sent multiple times over their life
 * (init, then a terminal update); the latest update wins so the final status is
 * what counts. `errors` is monotonic (max seen).
 */
export const recordSession = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    sid: v.string(),
    did: v.optional(v.string()),
    release: v.string(),
    environment: v.string(),
    status: v.string(),
    errors: v.number(),
    startedAt: v.number(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('sessions')
      .withIndex('by_project_sid', (q) => q.eq('projectId', args.projectId).eq('sid', args.sid))
      .first();

    if (!existing) {
      await ctx.db.insert('sessions', {
        organizationId: args.organizationId,
        projectId: args.projectId,
        sid: args.sid,
        did: args.did,
        release: args.release,
        environment: args.environment,
        status: args.status,
        errors: args.errors,
        startedAt: args.startedAt,
        lastUpdate: args.timestamp,
      });
      return;
    }

    const isNewer = args.timestamp >= existing.lastUpdate;
    await ctx.db.patch(existing._id, {
      // Latest terminal status wins; never downgrade away from a newer update.
      status: isNewer ? args.status : existing.status,
      lastUpdate: Math.max(existing.lastUpdate, args.timestamp),
      errors: Math.max(existing.errors, args.errors),
      did: existing.did ?? args.did,
    });
  },
});

/** Insert pre-aggregated session buckets from a `sessions` (aggregate) item. */
export const recordSessionBuckets = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    release: v.string(),
    environment: v.string(),
    buckets: v.array(
      v.object({
        bucketStart: v.number(),
        exited: v.number(),
        errored: v.number(),
        crashed: v.number(),
        abnormal: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // A `sessions` aggregate item carries no event id, so a mid-batch failure
    // anywhere in the envelope makes the SDK retry the WHOLE envelope and these
    // buckets would be re-inserted, inflating releaseHealth's session/crash
    // counts. Dedup the entire delivery on a content key (release + environment
    // + every bucket value): an identical re-delivery is a no-op, while a
    // genuinely distinct delivery (different counts, even for the same minute)
    // has a different key and still inserts, so additive aggregation across
    // flushes is preserved. The buckets are inserted under one shared key, so
    // two same-minute buckets within one envelope are both kept.
    const ingestKey = sha1Hex(
      JSON.stringify([
        args.release,
        args.environment,
        args.buckets.map((b) => [b.bucketStart, b.exited, b.errored, b.crashed, b.abnormal]),
      ]),
    );
    const duplicate = await ctx.db
      .query('sessionBuckets')
      .withIndex('by_project_ingestKey', (q) =>
        q.eq('projectId', args.projectId).eq('ingestKey', ingestKey),
      )
      .first();
    if (duplicate) return;

    const now = Date.now();
    for (const b of args.buckets) {
      await ctx.db.insert('sessionBuckets', {
        organizationId: args.organizationId,
        projectId: args.projectId,
        release: args.release,
        environment: args.environment,
        bucketStart: b.bucketStart,
        exited: b.exited,
        errored: b.errored,
        crashed: b.crashed,
        abnormal: b.abnormal,
        receivedAt: now,
        ingestKey,
      });
    }
  },
});

const HEALTH_SAMPLE = 5000;
const BUCKET_SAMPLE = 5000;

/**
 * Per-release health over the most recent {@link HEALTH_SAMPLE} sessions in the
 * organization: session and user counts plus crash-free rates. A recent-window
 * approximation (no time-series store yet), enough to watch a rollout.
 */
export const releaseHealth = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const recent = await ctx.db
      .query('sessions')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(HEALTH_SAMPLE);

    type Agg = {
      release: string;
      sessions: number;
      crashed: number;
      abnormal: number;
      errored: number;
      users: Set<string>;
      crashedUsers: Set<string>;
      lastSeen: number;
    };
    const groups = new Map<string, Agg>();

    for (const s of recent) {
      const key = s.release || '(none)';
      let g = groups.get(key);
      if (!g) {
        g = {
          release: key,
          sessions: 0,
          crashed: 0,
          abnormal: 0,
          errored: 0,
          users: new Set(),
          crashedUsers: new Set(),
          lastSeen: 0,
        };
        groups.set(key, g);
      }
      g.sessions += 1;
      g.lastSeen = Math.max(g.lastSeen, s.lastUpdate);
      if (s.did) g.users.add(s.did);
      if (s.status === 'crashed') {
        g.crashed += 1;
        if (s.did) g.crashedUsers.add(s.did);
      } else if (s.status === 'abnormal') {
        g.abnormal += 1;
      } else if (s.status === 'errored' || s.errors > 0) {
        g.errored += 1;
      }
    }

    // Fold in pre-aggregated buckets from `sessions` items. These carry no user
    // ids, so they contribute to session counts but not crash-free-users.
    const ensureGroup = (release: string): Agg => {
      let g = groups.get(release);
      if (!g) {
        g = {
          release,
          sessions: 0,
          crashed: 0,
          abnormal: 0,
          errored: 0,
          users: new Set(),
          crashedUsers: new Set(),
          lastSeen: 0,
        };
        groups.set(release, g);
      }
      return g;
    };
    const buckets = await ctx.db
      .query('sessionBuckets')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(BUCKET_SAMPLE);
    for (const b of buckets) {
      const g = ensureGroup(b.release || '(none)');
      g.sessions += b.exited + b.errored + b.crashed + b.abnormal;
      g.crashed += b.crashed;
      g.abnormal += b.abnormal;
      g.errored += b.errored;
      g.lastSeen = Math.max(g.lastSeen, b.bucketStart);
    }

    const rows = [...groups.values()].map((g) => {
      const userCount = g.users.size;
      return {
        release: g.release,
        sessions: g.sessions,
        users: userCount,
        crashed: g.crashed,
        abnormal: g.abnormal,
        errored: g.errored,
        crashFreeSessions: g.sessions > 0 ? (g.sessions - g.crashed) / g.sessions : 1,
        crashFreeUsers: userCount > 0 ? (userCount - g.crashedUsers.size) / userCount : 1,
        lastSeen: g.lastSeen,
      };
    });
    rows.sort((a, b) => b.lastSeen - a.lastSeen);
    return { sampleSize: recent.length, rows };
  },
});
