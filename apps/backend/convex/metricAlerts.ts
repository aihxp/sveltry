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
import { requireOrg, requireRole } from './lib/auth';
import { safeFetch } from './lib/net';
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
    environment: v.optional(v.string()),
    windowMinutes: v.number(),
    threshold: v.number(),
    channels: v.array(alertChannelValidator),
  },
  handler: async (ctx, args) => {
    const { activeOrganizationId } = await requireRole(ctx, 'admin');
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== activeOrganizationId)
      throw new Error('Project not found');
    return ctx.db.insert('metricAlerts', {
      organizationId: activeOrganizationId,
      projectId: args.projectId,
      name: args.name.trim() || 'Metric alert',
      metric: args.metric,
      transactionName: args.transactionName,
      // Blank environment means "all environments".
      environment: args.environment?.trim() || undefined,
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
    const { activeOrganizationId } = await requireRole(ctx, 'admin');
    const a = await ctx.db.get(alertId);
    if (!a || a.organizationId !== activeOrganizationId) throw new Error('Not found');
    await ctx.db.delete(alertId);
  },
});

// ---------------------------------------------------------------------------
// Evaluation (cron)
// ---------------------------------------------------------------------------

/** Nearest-rank percentile of an ascending-sorted number array. */
function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return sortedAsc[idx]!;
}

/**
 * Compute a metric's current value over its window. When `environment` is set,
 * the metric is scoped to that environment: error_count and crash_free_rate
 * filter the scanned rows, and p95_latency is computed from raw transactions
 * (the precomputed rollups are not split by environment, so the env-scoped path
 * scans the raw `transactions` table within the window instead).
 */
export const metricValue = internalQuery({
  args: {
    metric: metricValidator,
    projectId: v.id('projects'),
    transactionName: v.optional(v.string()),
    environment: v.optional(v.string()),
    windowMinutes: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, { metric, projectId, transactionName, environment, windowMinutes }) => {
    const since = Date.now() - windowMinutes * 60_000;

    if (metric === 'error_count') {
      const rows = await ctx.db
        .query('events')
        .withIndex('by_project', (q) => q.eq('projectId', projectId).gte('timestamp', since))
        .take(5000);
      return environment ? rows.filter((e) => e.environment === environment).length : rows.length;
    }

    if (metric === 'p95_latency') {
      if (environment) {
        const rows =
          transactionName && transactionName.length > 0
            ? await ctx.db
                .query('transactions')
                .withIndex('by_project_name', (q) =>
                  q.eq('projectId', projectId).eq('name', transactionName).gte('timestamp', since),
                )
                .take(5000)
            : await ctx.db
                .query('transactions')
                .withIndex('by_project', (q) =>
                  q.eq('projectId', projectId).gte('timestamp', since),
                )
                .take(5000);
        const durations = rows
          .filter((t) => t.environment === environment)
          .map((t) => t.durationMs)
          .sort((a, b) => a - b);
        return percentile(durations, 95);
      }
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
    const all = await ctx.db
      .query('sessions')
      .withIndex('by_project', (q) => q.eq('projectId', projectId).gte('lastUpdate', since))
      .take(5000);
    const sessions = environment ? all.filter((s) => s.environment === environment) : all;
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
        environment: a.environment,
        windowMinutes: a.windowMinutes,
      });
      const breached = a.metric === 'crash_free_rate' ? value < a.threshold : value > a.threshold;
      if (!breached) continue;
      // One alert per window.
      if (a.lastFiredAt && now - a.lastFiredAt < a.windowMinutes * 60_000) continue;

      const unit = a.metric === 'p95_latency' ? 'ms' : a.metric === 'crash_free_rate' ? '%' : '';
      const scope = a.environment ? ` in ${a.environment}` : '';
      const subject = `[${a.projectName}] ${a.name}`;
      const text =
        `${METRIC_LABEL[a.metric]}${scope} is ${value.toFixed(a.metric === 'crash_free_rate' ? 2 : 0)}${unit} ` +
        `over the last ${a.windowMinutes}m (threshold ${a.threshold}${unit}).`;

      // Deliver to each channel, recording the outcome of every attempt. We only
      // advance lastFiredAt (which suppresses re-firing for the window) when at
      // least one channel actually delivered, so a broken endpoint no longer
      // silences a real regression for the whole window. Mirrors alerts.ts.
      let deliveredOk = a.channels.length === 0;
      for (const channel of a.channels) {
        let ok = false;
        let detail: string | undefined;
        try {
          if (channel.type === 'email') {
            const res = await ctx.runAction(internal.email.sendEmail, {
              to: channel.target,
              subject,
              text,
            });
            ok = res.ok;
            if (!ok) detail = res.skipped ? 'SMTP not configured' : (res.detail ?? 'send failed');
          } else {
            const req = channelRequest(channel, {
              title: subject,
              text,
              severity: a.metric === 'crash_free_rate' ? 'error' : 'warning',
            });
            if (req) {
              // safeFetch validates the target and every redirect hop (SSRF guard).
              const res = await safeFetch(req.url, {
                method: 'POST',
                headers: req.headers,
                body: req.body,
                signal: AbortSignal.timeout(8000),
              });
              ok = res.ok;
              if (!ok) detail = `non-2xx response (${res.status})`;
            } else {
              ok = true; // channel with no request builder (nothing to send) is not a failure
            }
          }
        } catch (err) {
          detail = err instanceof Error ? err.message : String(err);
        }
        deliveredOk = deliveredOk || ok;
        await ctx.runMutation(internal.notifications.record, {
          organizationId: a.organizationId,
          projectId: a.projectId,
          source: 'metric_alert',
          sourceId: a._id,
          label: a.name,
          channelType: channel.type,
          target: channel.target,
          ok,
          detail,
        });
        if (!ok) {
          console.error(
            `metric-alert delivery failed: alert=${a._id} channel=${channel.type} detail=${detail ?? 'unknown'}`,
          );
        }
      }
      if (deliveredOk) {
        await ctx.runMutation(internal.metricAlerts.recordMetricFiring, {
          alertId: a._id,
          value,
          firedAt: now,
        });
        fired += 1;
      }
    }
    console.log(`evaluateMetricAlerts: evaluated ${alerts.length}, fired ${fired}`);
    return { fired };
  },
});
