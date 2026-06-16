import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireOrg } from './lib/auth';

/** Record an uploaded event attachment (bytes already in file storage). */
export const recordAttachment = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    eventId: v.string(),
    filename: v.string(),
    contentType: v.optional(v.string()),
    attachmentType: v.optional(v.string()),
    size: v.number(),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args): Promise<{ inserted: boolean }> => {
    // Idempotency: an SDK retry resending the same (eventId, filename) attachment
    // must not duplicate the row (or orphan the freshly stored blob). The caller
    // drops the blob when inserted=false.
    const dup = await ctx.db
      .query('attachments')
      .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
      .filter((q) => q.eq(q.field('filename'), args.filename))
      .first();
    if (dup) return { inserted: false };
    await ctx.db.insert('attachments', { ...args, createdAt: Date.now() });
    return { inserted: true };
  },
});

/** Record a user-feedback submission. */
export const recordFeedback = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    eventId: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    // Idempotency: dedupe a resent feedback by its event id (when present), so an
    // SDK retry does not store the same feedback twice.
    if (args.eventId) {
      const eventId = args.eventId;
      const dup = await ctx.db
        .query('feedback')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first();
      if (dup) return;
    }
    await ctx.db.insert('feedback', {
      ...args,
      message: args.message.slice(0, 10_000),
      createdAt: Date.now(),
    });
  },
});

/** Attachments for an event, with download URLs, for the issue detail page. */
export const eventAttachments = query({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query('attachments')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    const mine = rows.filter((a) => a.organizationId === activeOrganizationId);
    return Promise.all(
      mine.map(async (a) => ({
        _id: a._id,
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        url: await ctx.storage.getUrl(a.storageId),
      })),
    );
  },
});

/** The organization's user feedback, most recent first. */
export const listFeedback = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query('feedback')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(100);
    return rows.map((f) => ({
      _id: f._id,
      name: f.name,
      email: f.email,
      message: f.message,
      eventId: f.eventId,
      createdAt: f.createdAt,
    }));
  },
});
