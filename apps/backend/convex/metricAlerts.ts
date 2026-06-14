import { v } from 'convex/values';
import { channelRequest, mergeHistograms, percentileFromHistogram } from '@sveltry/protocol';
import { internal } from './_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { requireOrg } from './lib/auth';
import { alertChannelValidator } from './schema';

const metricValidator = v.union(
  v.literal('p95_latency'),
  v.literal('error_count'),
  v.literal('crash_free_rate'),
);

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const createMetricAlert = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    metric: metricValidator,
    transactionName: v.optional(v.string()),
    windowMinutes: v.number(),
    threshold: v.number(),
    channels: v.array(alertChannelValidator),
  },
  handler: async (ctx, args) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== activeOrganizationId)
      throw new Error('Project not found');
    return ctx.db.insert('metricAlerts', {
      organizationId: activeOrganizationId,
      projectId: args.projectId,
      name: args.name.trim() || 'Metric alert',
      metric: args.metric,
      transactionName: args.transactionName,
      windowMinutes: Math.max(5, args.windowMinutes),
      threshold: args.threshold,
      channels: args.channels,
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

export const listMetricAlerts = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return [];
    return ctx.db
      .query('metricAlerts')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
  },
});

export const deleteMetricAlert = mutation({
  args: { alertId: v.id('metricAlerts') },
  handler: async (ctx, { alertId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const a = await ctx.db.get(alertId);
    if (!a || a.organizationId !== activeOrganizationId) throw new Error('Not found');
    await ctx.db.delete(alertId);
  },
});

// ---------------------------------------------------------------------------
// Evaluation (cron)
// ---------------------------------------------------------------------------

/** Compute a metric's current value over its window. */
export const metricValue = internalQuery({
  args: {
    metric: metricValidator,
    projectId: v.id('projects'),
    transactionName: v.optional(v.string()),
    windowMinutes: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, { metric, projectId, transactionName, windowMinutes }) => {
    const since = Date.now() - windowMinutes * 60_000;

    if (metric === 'error_count') {
      const rows = await ctx.db
        .query('events')
        .withIndex('by_project', (q) => q.eq('projectId', projectId).gte('timestamp', since))
        .take(5000);
      return rows.length;
    }

    if (metric === 'p95_latency') {
      const HOUR = 3_600_000;
      const bucketSince = Math.floor(since / HOUR) * HOUR;
      const rollups =
        transactionName && transactionName.length > 0
          ? await ctx.db
              .query('transactionRollups')
              .withIndex('by_project_name_bucket', (q) =>
                q
                  .eq('projectId', projectId)
                  .eq('transactionName', transactionName)
                  .gte('bucketStart', bucketSince),
              )
              .collect()
          : await ctx.db
              .query('transactionRollups')
              .withIndex('by_project_bucket', (q) =>
                q.eq('projectId', projectId).gte('bucketStart', bucketSince),
              )
              .collect();
      if (rollups.length === 0) return 0;
      return percentileFromHistogram(mergeHistograms(rollups.map((r) => r.histogram)), 95);
    }

    // crash_free_rate (percent)
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_project', (q) => q.eq('projectId', projectId).gte('lastUpdate', since))
      .take(5000);
    if (sessions.length === 0) return 100;
    const crashed = sessions.filter((s) => s.status === 'crashed').length;
    return ((sessions.length - crashed) / sessions.length) * 100;
  },
});

export const enabledMetricAlerts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const alerts = await ctx.db
      .query('metricAlerts')
      .withIndex('by_enabled', (q) => q.eq('enabled', true))
      .take(500);
    return Promise.all(
      alerts.map(async (a) => {
        const project = await ctx.db.get(a.projectId);
        return { ...a, projectName: project?.name ?? 'project' };
      }),
    );
  },
});

export const recordMetricFiring = internalMutation({
  args: { alertId: v.id('metricAlerts'), value: v.number(), firedAt: v.number() },
  handler: async (ctx, { alertId, value, firedAt }) => {
    await ctx.db.patch(alertId, { lastFiredAt: firedAt, lastValue: value });
  },
});

const METRIC_LABEL: Record<string, string> = {
  p95_latency: 'p95 latency',
  error_count: 'error count',
  crash_free_rate: 'crash-free rate',
};

/** Evaluate all enabled metric alerts; fire to channels when a threshold is crossed. */
export const evaluateMetricAlerts = internalAction({
  args: {},
  handler: async (ctx): Promise<{ fired: number }> => {
    const now = Date.now();
    const alerts = await ctx.runQuery(internal.metricAlerts.enabledMetricAlerts, {});
    let fired = 0;

    for (const a of alerts) {
      const value = await ctx.runQuery(internal.metricAlerts.metricValue, {
        metric: a.metric,
        projectId: a.projectId,
        transactionName: a.transactionName,
        windowMinutes: a.windowMinutes,
      });
      const breached = a.metric === 'crash_free_rate' ? value < a.threshold : value > a.threshold;
      if (!breached) continue;
      // One alert per window.
      if (a.lastFiredAt && now - a.lastFiredAt < a.windowMinutes * 60_000) continue;

      const unit = a.metric === 'p95_latency' ? 'ms' : a.metric === 'crash_free_rate' ? '%' : '';
      const subject = `[${a.projectName}] ${a.name}`;
      const text =
        `${METRIC_LABEL[a.metric]} is ${value.toFixed(a.metric === 'crash_free_rate' ? 2 : 0)}${unit} ` +
        `over the last ${a.windowMinutes}m (threshold ${a.threshold}${unit}).`;

      for (const channel of a.channels) {
        try {
          if (channel.type === 'email') {
            await ctx.runAction(internal.email.sendEmail, { to: channel.target, subject, text });
          } else {
            const req = channelRequest(channel, {
              title: subject,
              text,
              severity: a.metric === 'crash_free_rate' ? 'error' : 'warning',
            });
            if (req) {
              await fetch(req.url, {
                method: 'POST',
                headers: req.headers,
                body: req.body,
                signal: AbortSignal.timeout(8000),
              });
            }
          }
        } catch {
          // Best-effort delivery; do not block other channels/alerts.
        }
      }
      await ctx.runMutation(internal.metricAlerts.recordMetricFiring, {
        alertId: a._id,
        value,
        firedAt: now,
      });
      fired += 1;
    }
    return { fired };
  },
});
