import { v } from 'convex/values';
import { channelRequest } from '@sveltry/protocol';
import { internal } from './_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { recordAudit } from './lib/audit';
import { requireOrg, requireRole } from './lib/auth';
import { safeFetch } from './lib/net';
import { alertChannelValidator } from './schema';

// ---------------------------------------------------------------------------
// Quota-usage alerts: notify when a project's events this calendar month reach a
// percentage of its monthly quota. A cron evaluates enabled alerts; each fires at
// most once per month. Channels reuse the shared alert delivery (SSRF-guarded).
// ---------------------------------------------------------------------------

const WEBHOOK_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const createUsageAlert = mutation({
  args: {
    projectId: v.id('projects'),
    thresholdPercent: v.number(),
    channels: v.array(alertChannelValidator),
  },
  handler: async (ctx, { projectId, thresholdPercent, channels }) => {
    const caller = await requireRole(ctx, 'admin');
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== caller.activeOrganizationId)
      throw new Error('Project not found');
    const pct = Math.min(100, Math.max(1, Math.round(thresholdPercent)));
    const id = await ctx.db.insert('usageAlerts', {
      organizationId: caller.activeOrganizationId,
      projectId,
      thresholdPercent: pct,
      channels,
      enabled: true,
      createdAt: Date.now(),
    });
    await recordAudit(ctx, caller, 'usagealert.create', `${project.name}: ${pct}%`);
    return id;
  },
});

export const listUsageAlerts = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return [];
    return ctx.db
      .query('usageAlerts')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
  },
});

export const deleteUsageAlert = mutation({
  args: { alertId: v.id('usageAlerts') },
  handler: async (ctx, { alertId }) => {
    const caller = await requireRole(ctx, 'admin');
    const a = await ctx.db.get(alertId);
    if (!a || a.organizationId !== caller.activeOrganizationId) throw new Error('Not found');
    await ctx.db.delete(alertId);
    await recordAudit(ctx, caller, 'usagealert.delete', `${a.thresholdPercent}%`);
  },
});

// ---------------------------------------------------------------------------
// Evaluation (cron)
// ---------------------------------------------------------------------------

/** Enabled usage alerts joined with their project's name, quota, and this month's usage. */
export const enabledUsageAlerts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const DAY_MS = 24 * 60 * 60 * 1000;
    const alerts = await ctx.db
      .query('usageAlerts')
      .withIndex('by_enabled', (q) => q.eq('enabled', true))
      .take(500);
    return Promise.all(
      alerts.map(async (a) => {
        const project = await ctx.db.get(a.projectId);
        const quota = project?.monthlyEventQuota ?? 0;
        const rows = quota
          ? await ctx.db
              .query('usageDaily')
              .withIndex('by_project_day', (q) =>
                q.eq('projectId', a.projectId).gte('day', Math.floor(monthStart / DAY_MS) * DAY_MS),
              )
              .collect()
          : [];
        const used = rows.reduce((s, r) => s + r.eventCount, 0);
        return {
          _id: a._id,
          projectName: project?.name ?? 'project',
          quota,
          used,
          thresholdPercent: a.thresholdPercent,
          channels: a.channels,
          lastFiredMonth: a.lastFiredMonth ?? null,
          monthStart,
        };
      }),
    );
  },
});

export const recordUsageAlertFiring = internalMutation({
  args: { alertId: v.id('usageAlerts'), month: v.number(), firedAt: v.number() },
  handler: async (ctx, { alertId, month, firedAt }) => {
    await ctx.db.patch(alertId, { lastFiredMonth: month, lastFiredAt: firedAt });
  },
});

/** Evaluate enabled quota-usage alerts; fire to channels when over threshold (once per month). */
export const evaluateUsageAlerts = internalAction({
  args: {},
  handler: async (ctx): Promise<{ fired: number }> => {
    const alerts = await ctx.runQuery(internal.usageAlerts.enabledUsageAlerts, {});
    const now = Date.now();
    let fired = 0;

    for (const a of alerts) {
      if (!a.quota) continue; // no monthly quota set on the project
      if (a.lastFiredMonth === a.monthStart) continue; // already fired this month
      const pct = (a.used / a.quota) * 100;
      if (pct < a.thresholdPercent) continue;

      const subject = `[${a.projectName}] usage at ${Math.round(pct)}% of monthly quota`;
      const text =
        `${a.used.toLocaleString()} of ${a.quota.toLocaleString()} events used this month ` +
        `(${Math.round(pct)}%, alert threshold ${a.thresholdPercent}%).`;

      for (const channel of a.channels) {
        try {
          if (channel.type === 'email') {
            await ctx.runAction(internal.email.sendEmail, { to: channel.target, subject, text });
          } else {
            const req = channelRequest(channel, { title: subject, text, severity: 'warning' });
            if (req) {
              // safeFetch validates the target and every redirect hop (SSRF guard).
              await safeFetch(req.url, {
                method: 'POST',
                headers: req.headers,
                body: req.body,
                signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
              });
            }
          }
        } catch {
          // Best-effort delivery; do not block other channels/alerts.
        }
      }
      await ctx.runMutation(internal.usageAlerts.recordUsageAlertFiring, {
        alertId: a._id,
        month: a.monthStart,
        firedAt: now,
      });
      fired += 1;
    }
    return { fired };
  },
});
