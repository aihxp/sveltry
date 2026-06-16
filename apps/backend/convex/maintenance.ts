import { addSample, emptyHistogram } from '@sveltry/protocol';
import { internalMutation } from './_generated/server';
import type { Id } from './_generated/dataModel';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Prune events past each project's retention window. Bounded per run so a single
 * cron tick never exceeds Convex transaction limits; the daily schedule plus the
 * bound keeps storage in check without long-running mutations.
 */
export const sweepRetention = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const projects = await ctx.db.query('projects').take(500);
    let deleted = 0;

    for (const project of projects) {
      if (deleted >= 2000) break;
      const cutoff = now - project.eventRetentionDays * DAY_MS;
      const stale = await ctx.db
        .query('events')
        .withIndex('by_project', (q) => q.eq('projectId', project._id).lt('timestamp', cutoff))
        .order('asc')
        .take(200);
      for (const event of stale) {
        await ctx.db.delete(event._id);
        deleted += 1;
      }
    }
    if (deleted) console.log(`sweepRetention: deleted ${deleted} expired events`);
    return { deleted };
  },
});

/**
 * Move `new` issues that are older than 7 days to `ongoing`, mirroring Sentry's
 * automatic triage transition. Bounded per run.
 */
export const sweepOngoing = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const orgs = await ctx.db.query('organizations').take(500);
    let updated = 0;

    for (const org of orgs) {
      if (updated >= 2000) break;
      const issues = await ctx.db
        .query('issues')
        .withIndex('by_org_status_lastSeen', (q) =>
          q.eq('organizationId', org.slug).eq('status', 'unresolved'),
        )
        .take(500);
      for (const issue of issues) {
        if (issue.substatus === 'new' && now - issue.firstSeen > SEVEN_DAYS_MS) {
          await ctx.db.patch(issue._id, { substatus: 'ongoing' });
          updated += 1;
        }
      }
    }
    return { updated };
  },
});

/**
 * Recompute hourly latency rollups for the recent window from raw transactions.
 * Each (project, transaction, hour) bucket gets a fixed-bucket duration histogram
 * so the trend query can derive percentiles over any window. Recomputing the last
 * few hours each run is idempotent (the bucket is replaced from raw), and older
 * buckets stay frozen once their hour has passed.
 */
export const rollupTransactions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const windowStart = Math.floor(now / HOUR_MS) * HOUR_MS - 2 * HOUR_MS;
    const orgs = await ctx.db.query('organizations').take(500);
    let upserts = 0;

    for (const org of orgs) {
      const txns = await ctx.db
        .query('transactions')
        .withIndex('by_org', (q) => q.eq('organizationId', org.slug).gte('timestamp', windowStart))
        .take(8000);

      type Agg = {
        projectId: Id<'projects'>;
        name: string;
        bucket: number;
        count: number;
        sum: number;
        max: number;
        histo: number[];
      };
      const groups = new Map<string, Agg>();
      for (const t of txns) {
        const bucket = Math.floor(t.timestamp / HOUR_MS) * HOUR_MS;
        const key = `${t.projectId}|${t.name}|${bucket}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            projectId: t.projectId,
            name: t.name,
            bucket,
            count: 0,
            sum: 0,
            max: 0,
            histo: emptyHistogram(),
          };
          groups.set(key, g);
        }
        g.count += 1;
        g.sum += t.durationMs;
        g.max = Math.max(g.max, t.durationMs);
        addSample(g.histo, t.durationMs);
      }

      for (const g of groups.values()) {
        const row = {
          organizationId: org.slug,
          projectId: g.projectId,
          transactionName: g.name,
          bucketStart: g.bucket,
          count: g.count,
          sumMs: g.sum,
          maxMs: g.max,
          histogram: g.histo,
        };
        const existing = await ctx.db
          .query('transactionRollups')
          .withIndex('by_project_name_bucket', (q) =>
            q
              .eq('projectId', g.projectId)
              .eq('transactionName', g.name)
              .eq('bucketStart', g.bucket),
          )
          .first();
        if (existing) await ctx.db.patch(existing._id, row);
        else await ctx.db.insert('transactionRollups', row);
        upserts += 1;
      }
    }
    return { upserts };
  },
});

/**
 * Flag cron monitors that should have checked in by now but did not. Only applies
 * to monitors with a known interval schedule; a 20% grace avoids flapping.
 */
export const detectMissedCheckIns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const orgs = await ctx.db.query('organizations').take(500);
    let missed = 0;
    for (const org of orgs) {
      const monitors = await ctx.db
        .query('monitors')
        .withIndex('by_org', (q) => q.eq('organizationId', org.slug))
        .take(500);
      for (const m of monitors) {
        if (!m.expectedIntervalSeconds || m.latestStatus === 'missed') continue;
        if (now - m.lastCheckInAt > m.expectedIntervalSeconds * 1000 * 1.2) {
          await ctx.db.patch(m._id, { latestStatus: 'missed' });
          missed += 1;
        }
      }
    }
    if (missed) console.warn(`detectMissedCheckIns: ${missed} monitor(s) marked missed`);
    return { missed };
  },
});

/**
 * Drop rate-limit windows that have already rolled over. Without this the
 * `ingestWindows` table grows by one row per DSN key per window forever; a window
 * older than a day can never be the current fixed window again, so it is dead.
 */
export const sweepRateLimitWindows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DAY_MS;
    const stale = await ctx.db
      .query('ingestWindows')
      .withIndex('by_window', (q) => q.lt('windowStart', cutoff))
      .take(4000);
    for (const window of stale) {
      await ctx.db.delete(window._id);
    }
    // Spike-protection minute windows are dead after a day too.
    const staleSpikes = await ctx.db
      .query('spikeWindows')
      .withIndex('by_window', (q) => q.lt('windowStart', cutoff))
      .take(4000);
    for (const w of staleSpikes) await ctx.db.delete(w._id);
    return { deleted: stale.length + staleSpikes.length };
  },
});
