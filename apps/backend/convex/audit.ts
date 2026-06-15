import { v } from 'convex/values';
import { query } from './_generated/server';
import { requireRole } from './lib/auth';

/** Recent audit-log entries for the active org, newest first. Admin+ only. */
export const listAuditLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const caller = await requireRole(ctx, 'admin');
    const take = Math.min(200, Math.max(1, limit ?? 50));
    const rows = await ctx.db
      .query('auditLog')
      .withIndex('by_org', (q) => q.eq('organizationId', caller.activeOrganizationId))
      .order('desc')
      .take(take);
    return rows.map((r) => ({
      id: r._id,
      actorEmail: r.actorEmail ?? null,
      action: r.action,
      target: r.target ?? null,
      createdAt: r.createdAt,
    }));
  },
});
