import { v } from 'convex/values';
import { internal } from './_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { requireOrg, requireRole } from './lib/auth';
import { assertSafeOutboundTarget, safeFetch } from './lib/net';
import { slugify } from './lib/slug';

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
    expectedIntervalSeconds: v.optional(v.number()),
    detail: v.optional(v.string()),
    // For uptime probes: mark this monitor checked in the SAME transaction as the
    // check-in, so a failure between the two writes cannot leave the monitor
    // un-marked (and re-probed every tick).
    markUptimeMonitorId: v.optional(v.id('uptimeMonitors')),
  },
  handler: async (ctx, args) => {
    if (args.markUptimeMonitorId) {
      await ctx.db.patch(args.markUptimeMonitorId, { lastCheckedAt: args.timestamp });
    }
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
        detail: args.detail,
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
          expectedIntervalSeconds: args.expectedIntervalSeconds ?? monitor.expectedIntervalSeconds,
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
        expectedIntervalSeconds: args.expectedIntervalSeconds,
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

// ---------------------------------------------------------------------------
// HTTP uptime monitors
// ---------------------------------------------------------------------------

const UPTIME_TIMEOUT_MS = 10_000;

/** Create an HTTP uptime monitor for the caller's organization. */
export const createUptimeMonitor = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    url: v.string(),
    intervalSeconds: v.optional(v.number()),
    expectedStatus: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { activeOrganizationId } = await requireRole(ctx, 'admin');
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== activeOrganizationId)
      throw new Error('Project not found');

    // Reuse the shared SSRF host guard (scheme + full blocked-host denylist:
    // the whole 169.254.0.0/16 link-local range, IPv6 link-local, and the
    // cloud-metadata names, in every encoding) instead of a 3-host literal set.
    // The resolve-time (DNS rebinding) half runs in runUptimeChecks via
    // safeFetch, since a Convex mutation cannot do network I/O.
    let url: URL;
    try {
      url = new URL(args.url);
    } catch {
      throw new Error('Invalid URL');
    }
    try {
      assertSafeOutboundTarget(args.url);
    } catch {
      throw new Error('That URL is not allowed (must be http(s) and not a private/metadata host)');
    }

    return ctx.db.insert('uptimeMonitors', {
      organizationId: activeOrganizationId,
      projectId: args.projectId,
      slug: slugify(args.name) || url.hostname,
      url: args.url,
      method: 'GET',
      expectedStatus: args.expectedStatus ?? 200,
      intervalSeconds: Math.max(60, args.intervalSeconds ?? 300),
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

/** List the organization's uptime monitors. */
export const listUptimeMonitors = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query('uptimeMonitors')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .collect();
    return rows.map((m) => ({
      _id: m._id,
      slug: m.slug,
      url: m.url,
      intervalSeconds: m.intervalSeconds,
      expectedStatus: m.expectedStatus,
      enabled: m.enabled,
      lastCheckedAt: m.lastCheckedAt,
    }));
  },
});

/** Delete an uptime monitor. */
export const deleteUptimeMonitor = mutation({
  args: { monitorId: v.id('uptimeMonitors') },
  handler: async (ctx, { monitorId }) => {
    const { activeOrganizationId } = await requireRole(ctx, 'admin');
    const m = await ctx.db.get(monitorId);
    if (!m || m.organizationId !== activeOrganizationId) throw new Error('Not found');
    await ctx.db.delete(monitorId);
  },
});

/** Enabled uptime monitors whose interval has elapsed since the last probe. */
export const dueUptimeMonitors = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const enabled = await ctx.db
      .query('uptimeMonitors')
      .withIndex('by_enabled', (q) => q.eq('enabled', true))
      .take(500);
    return enabled.filter(
      (m) => !m.lastCheckedAt || now - m.lastCheckedAt >= m.intervalSeconds * 1000,
    );
  },
});

/**
 * Probe due uptime monitors and record each result as a check-in (so uptime
 * history shows up alongside cron check-ins on the Monitors page).
 */
export const runUptimeChecks = internalAction({
  args: {},
  // Explicit return type breaks the self-referential `internal.monitors` cycle.
  handler: async (ctx): Promise<{ checked: number }> => {
    const now = Date.now();
    const due = await ctx.runQuery(internal.monitors.dueUptimeMonitors, { now });
    let failed = 0;
    for (const m of due) {
      const start = Date.now();
      let ok = false;
      let detail: string | undefined;
      try {
        // safeFetch enforces the SSRF guard (literal denylist + DoH-resolved-IP
        // rebinding check) on every redirect hop. A blocked target throws and
        // is recorded as a failed probe, never reaching the address.
        const res = await safeFetch(m.url, {
          method: m.method,
          signal: AbortSignal.timeout(UPTIME_TIMEOUT_MS),
        });
        ok = res.status === m.expectedStatus;
        if (!ok) detail = `unexpected status ${res.status} (expected ${m.expectedStatus})`;
      } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
      }
      const latency = Date.now() - start;
      if (!ok) {
        failed += 1;
        console.warn(
          `uptime probe failed: monitor=${m.slug} url=${m.url} detail=${detail ?? 'unknown'}`,
        );
      }
      await ctx.runMutation(internal.monitors.recordCheckIn, {
        projectId: m.projectId,
        organizationId: m.organizationId,
        monitorSlug: m.slug,
        checkInId: '',
        status: ok ? 'ok' : 'error',
        durationMs: latency,
        environment: 'uptime',
        timestamp: Date.now(),
        detail,
        // Record the check-in and mark the monitor checked atomically.
        markUptimeMonitorId: m._id,
      });
    }
    if (due.length > 0) console.log(`runUptimeChecks: probed ${due.length}, ${failed} failed`);
    return { checked: due.length };
  },
});
