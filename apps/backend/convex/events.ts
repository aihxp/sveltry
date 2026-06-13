import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { query } from './_generated/server';
import { requireOrg } from './lib/auth';

/** Paginated events for an issue, newest first. */
export const listEventsForIssue = query({
  args: { issueId: v.id('issues'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { issueId, paginationOpts }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.organizationId !== activeOrganizationId) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    return ctx.db
      .query('events')
      .withIndex('by_issue', (q) => q.eq('issueId', issueId))
      .order('desc')
      .paginate(paginationOpts);
  },
});

/** The latest event for an issue (the one rendered on the issue detail page). */
export const latestEventForIssue = query({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.organizationId !== activeOrganizationId) return null;
    return ctx.db
      .query('events')
      .withIndex('by_issue', (q) => q.eq('issueId', issueId))
      .order('desc')
      .first();
  },
});

/** A single event by its Convex id. */
export const getEvent = query({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const event = await ctx.db.get(eventId);
    if (!event || event.organizationId !== activeOrganizationId) return null;
    return event;
  },
});
