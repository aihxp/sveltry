import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireOrg } from './lib/auth';

/**
 * Record a cron check-in. Upserts the check-in by check_in_id (an `in_progress`
 * start and its terminal `ok`/`error` update are the same run) and rolls the
 * latest status onto the monitor row.
 */
export const recordCheckIn = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    monitorSlug: v.string(),
    checkInId: v.string(),
    status: v.string(),
    durationMs: v.optional(v.number()),
    environment: v.string(),
    release: v.optional(v.string()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // Upsert the individual check-in by check_in_id.
    if (args.checkInId) {
      const existing = await ctx.db
        .query('checkIns')
        .withIndex('by_project_checkInId', (q) =>
          q.eq('projectId', args.projectId).eq('checkInId', args.checkInId),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          status: args.status,
          durationMs: args.durationMs ?? existing.durationMs,
          timestamp: Math.max(existing.timestamp, args.timestamp),
        });
      } else {
        await ctx.db.insert('checkIns', {
          organizationId: args.organizationId,
          projectId: args.projectId,
          monitorSlug: args.monitorSlug,
          checkInId: args.checkInId,
          status: args.status,
          durationMs: args.durationMs,
          environment: args.environment,
          release: args.release,
          timestamp: args.timestamp,
        });
      }
    } else {
      await ctx.db.insert('checkIns', {
        organizationId: args.organizationId,
        projectId: args.projectId,
        monitorSlug: args.monitorSlug,
        checkInId: '',
        status: args.status,
        durationMs: args.durationMs,
        environment: args.environment,
        release: args.release,
        timestamp: args.timestamp,
      });
    }

    // Roll the latest status onto the monitor.
    const monitor = await ctx.db
      .query('monitors')
      .withIndex('by_project_slug', (q) =>
        q.eq('projectId', args.projectId).eq('slug', args.monitorSlug),
      )
      .first();
    if (monitor) {
      if (args.timestamp >= monitor.lastCheckInAt) {
        await ctx.db.patch(monitor._id, {
          latestStatus: args.status,
          lastCheckInAt: args.timestamp,
          lastDurationMs: args.durationMs ?? monitor.lastDurationMs,
          environment: args.environment,
        });
      }
    } else {
      await ctx.db.insert('monitors', {
        organizationId: args.organizationId,
        projectId: args.projectId,
        slug: args.monitorSlug,
        latestStatus: args.status,
        lastCheckInAt: args.timestamp,
        lastDurationMs: args.durationMs,
        environment: args.environment,
        createdAt: Date.now(),
      });
    }
  },
});

/** List the organization's cron monitors, most recent check-in first. */
export const listMonitors = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const monitors = await ctx.db
      .query('monitors')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(200);
    return monitors.map((m) => ({
      _id: m._id,
      slug: m.slug,
      latestStatus: m.latestStatus,
      lastCheckInAt: m.lastCheckInAt,
      lastDurationMs: m.lastDurationMs,
      environment: m.environment,
    }));
  },
});

/** Recent check-ins for one monitor (the detail view). */
export const monitorCheckIns = query({
  args: { monitorId: v.id('monitors'), limit: v.optional(v.number()) },
  handler: async (ctx, { monitorId, limit }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const monitor = await ctx.db.get(monitorId);
    if (!monitor || monitor.organizationId !== activeOrganizationId) return null;
    const checkIns = await ctx.db
      .query('checkIns')
      .withIndex('by_monitor', (q) =>
        q.eq('projectId', monitor.projectId).eq('monitorSlug', monitor.slug),
      )
      .order('desc')
      .take(Math.min(limit ?? 50, 200));
    return {
      monitor: {
        slug: monitor.slug,
        latestStatus: monitor.latestStatus,
        lastCheckInAt: monitor.lastCheckInAt,
        environment: monitor.environment,
      },
      checkIns: checkIns.map((c) => ({
        _id: c._id,
        status: c.status,
        durationMs: c.durationMs,
        release: c.release,
        timestamp: c.timestamp,
      })),
    };
  },
});
