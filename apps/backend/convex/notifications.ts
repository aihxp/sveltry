import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireOrg } from './lib/auth';

/**
 * Per-attempt delivery records for the non-issue notification paths (metric
 * alerts, quota/usage alerts, tracker auto-create). The issue-alert path records
 * into `alertDeliveries`; this is the generic sibling so cron-driven deliveries
 * are no longer silently swallowed. See `notificationDeliveries` in schema.ts.
 */
export const record = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.optional(v.id('projects')),
    source: v.string(),
    sourceId: v.string(),
    label: v.string(),
    channelType: v.string(),
    target: v.string(),
    ok: v.boolean(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('notificationDeliveries', { ...args, deliveredAt: Date.now() });
  },
});

/** Recent notification deliveries for the active org, newest first (for the UI). */
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query('notificationDeliveries')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(Math.min(limit ?? 50, 200));
    return rows.map((r) => ({
      _id: r._id,
      source: r.source,
      label: r.label,
      channelType: r.channelType,
      target: r.target,
      ok: r.ok,
      detail: r.detail,
      deliveredAt: r.deliveredAt,
    }));
  },
});
