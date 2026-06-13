import { v } from 'convex/values';
import { query } from './_generated/server';
import { requireOrg } from './lib/auth';

/** List releases for a project, newest first. */
export const listReleases = query({
  args: { projectId: v.id('projects'), limit: v.optional(v.number()) },
  handler: async (ctx, { projectId, limit }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return [];
    return ctx.db
      .query('releases')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .order('desc')
      .take(Math.min(limit ?? 50, 200));
  },
});
