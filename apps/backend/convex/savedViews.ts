import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrg, requireRole } from './lib/auth';
import { issueStatusValidator, levelValidator } from './schema';

/** All saved issue-list views for the active organization, oldest first. */
export const listSavedViews = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    return ctx.db
      .query('savedViews')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('asc')
      .take(100);
  },
});

/** Persist the current issue-list filter state as a named, org-shared view. */
export const createSavedView = mutation({
  args: {
    name: v.string(),
    query: v.optional(v.string()),
    status: v.optional(issueStatusValidator),
    level: v.optional(levelValidator),
    projectId: v.optional(v.id('projects')),
  },
  handler: async (ctx, args) => {
    const { activeOrganizationId, subject } = await requireRole(ctx, 'member');
    const name = args.name.trim();
    if (!name) throw new Error('A name is required');

    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.organizationId !== activeOrganizationId)
        throw new Error('Project not found');
    }

    return ctx.db.insert('savedViews', {
      organizationId: activeOrganizationId,
      userId: subject,
      name: name.slice(0, 80),
      query: args.query?.trim() || undefined,
      status: args.status,
      level: args.level,
      projectId: args.projectId,
      createdAt: Date.now(),
    });
  },
});

export const deleteSavedView = mutation({
  args: { viewId: v.id('savedViews') },
  handler: async (ctx, { viewId }) => {
    const { activeOrganizationId } = await requireRole(ctx, 'member');
    const view = await ctx.db.get(viewId);
    if (!view || view.organizationId !== activeOrganizationId) throw new Error('View not found');
    await ctx.db.delete(viewId);
  },
});
