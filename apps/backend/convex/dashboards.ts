import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrg, requireRole } from './lib/auth';
import { discoverAggregateValidator, discoverDatasetValidator } from './schema';

// ---------------------------------------------------------------------------
// Custom dashboards: named, org-shared collections of saved Discover queries.
// Each widget stores the Discover parameters; the dashboard page renders it by
// running `discover.runDiscover` with those parameters. Read by any member;
// created/edited by member and up (billing is read-only).
// ---------------------------------------------------------------------------

export const listDashboards = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const dashboards = await ctx.db
      .query('dashboards')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .collect();
    dashboards.sort((a, b) => a.createdAt - b.createdAt);
    return Promise.all(
      dashboards.map(async (d) => {
        const widgets = await ctx.db
          .query('dashboardWidgets')
          .withIndex('by_dashboard', (q) => q.eq('dashboardId', d._id))
          .collect();
        return { id: d._id, name: d.name, createdAt: d.createdAt, widgetCount: widgets.length };
      }),
    );
  },
});

/** A dashboard with its widgets in display order. */
export const getDashboard = query({
  args: { dashboardId: v.id('dashboards') },
  handler: async (ctx, { dashboardId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const dashboard = await ctx.db.get(dashboardId);
    if (!dashboard || dashboard.organizationId !== activeOrganizationId) return null;
    const widgets = await ctx.db
      .query('dashboardWidgets')
      .withIndex('by_dashboard', (q) => q.eq('dashboardId', dashboardId))
      .collect();
    widgets.sort((a, b) => a.order - b.order);
    return {
      id: dashboard._id,
      name: dashboard.name,
      widgets: widgets.map((w) => ({
        id: w._id,
        title: w.title,
        dataset: w.dataset,
        groupBy: w.groupBy,
        aggregate: w.aggregate,
        hours: w.hours,
        projectId: w.projectId ?? null,
        filters: w.filters ?? [],
      })),
    };
  },
});

export const createDashboard = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const { activeOrganizationId, subject } = await requireRole(ctx, 'member');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('A dashboard name is required');
    return ctx.db.insert('dashboards', {
      organizationId: activeOrganizationId,
      name: trimmed.slice(0, 80),
      createdBy: subject,
      createdAt: Date.now(),
    });
  },
});

export const deleteDashboard = mutation({
  args: { dashboardId: v.id('dashboards') },
  handler: async (ctx, { dashboardId }) => {
    const { activeOrganizationId } = await requireRole(ctx, 'member');
    const dashboard = await ctx.db.get(dashboardId);
    if (!dashboard || dashboard.organizationId !== activeOrganizationId)
      throw new Error('Dashboard not found');
    const widgets = await ctx.db
      .query('dashboardWidgets')
      .withIndex('by_dashboard', (q) => q.eq('dashboardId', dashboardId))
      .collect();
    for (const w of widgets) await ctx.db.delete(w._id);
    await ctx.db.delete(dashboardId);
  },
});

export const addWidget = mutation({
  args: {
    dashboardId: v.id('dashboards'),
    title: v.string(),
    dataset: discoverDatasetValidator,
    groupBy: v.string(),
    aggregate: discoverAggregateValidator,
    hours: v.number(),
    projectId: v.optional(v.id('projects')),
    filters: v.optional(v.array(v.object({ field: v.string(), value: v.string() }))),
  },
  handler: async (ctx, args) => {
    const { activeOrganizationId } = await requireRole(ctx, 'member');
    const dashboard = await ctx.db.get(args.dashboardId);
    if (!dashboard || dashboard.organizationId !== activeOrganizationId)
      throw new Error('Dashboard not found');

    const existing = await ctx.db
      .query('dashboardWidgets')
      .withIndex('by_dashboard', (q) => q.eq('dashboardId', args.dashboardId))
      .collect();
    const order = existing.reduce((max, w) => Math.max(max, w.order), -1) + 1;

    return ctx.db.insert('dashboardWidgets', {
      organizationId: activeOrganizationId,
      dashboardId: args.dashboardId,
      title: args.title.trim().slice(0, 80) || `${args.dataset} by ${args.groupBy}`,
      dataset: args.dataset,
      groupBy: args.groupBy,
      aggregate: args.aggregate,
      hours: args.hours,
      projectId: args.projectId,
      filters: args.filters,
      order,
    });
  },
});

export const removeWidget = mutation({
  args: { widgetId: v.id('dashboardWidgets') },
  handler: async (ctx, { widgetId }) => {
    const { activeOrganizationId } = await requireRole(ctx, 'member');
    const widget = await ctx.db.get(widgetId);
    if (!widget || widget.organizationId !== activeOrganizationId)
      throw new Error('Widget not found');
    await ctx.db.delete(widgetId);
  },
});
