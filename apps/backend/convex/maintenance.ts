import { internalMutation } from './_generated/server';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

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
    return { deleted: stale.length };
  },
});
