import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireOrg } from './lib/auth';

/** Store a replay recording segment and roll metadata onto the replay row. */
export const recordReplaySegment = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    replayId: v.string(),
    segmentId: v.number(),
    storageId: v.id('_storage'),
    timestamp: v.number(),
    url: v.optional(v.string()),
    errorCount: v.number(),
    platform: v.optional(v.string()),
    environment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('replaySegments', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      replayId: args.replayId,
      segmentId: args.segmentId,
      storageId: args.storageId,
      timestamp: args.timestamp,
    });

    const replay = await ctx.db
      .query('replays')
      .withIndex('by_project_replayId', (q) =>
        q.eq('projectId', args.projectId).eq('replayId', args.replayId),
      )
      .first();
    if (replay) {
      await ctx.db.patch(replay._id, {
        segmentCount: replay.segmentCount + 1,
        lastSegmentAt: Math.max(replay.lastSegmentAt, args.timestamp),
        // error_ids is cumulative per segment; take the max rather than summing.
        errorCount: Math.max(replay.errorCount, args.errorCount),
        url: replay.url ?? args.url,
      });
    } else {
      await ctx.db.insert('replays', {
        organizationId: args.organizationId,
        projectId: args.projectId,
        replayId: args.replayId,
        startedAt: args.timestamp,
        lastSegmentAt: args.timestamp,
        segmentCount: 1,
        url: args.url,
        errorCount: args.errorCount,
        platform: args.platform,
        environment: args.environment,
      });
    }
  },
});

/** List the organization's replays, most recent first. */
export const listReplays = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const replays = await ctx.db
      .query('replays')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(100);
    return replays.map((r) => ({
      _id: r._id,
      replayId: r.replayId,
      startedAt: r.startedAt,
      durationMs: Math.max(0, r.lastSegmentAt - r.startedAt),
      segmentCount: r.segmentCount,
      url: r.url,
      errorCount: r.errorCount,
      platform: r.platform,
    }));
  },
});

/** A replay's metadata plus ordered recording URLs the player fetches directly. */
export const getReplay = query({
  args: { replayDocId: v.id('replays') },
  handler: async (ctx, { replayDocId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const replay = await ctx.db.get(replayDocId);
    if (!replay || replay.organizationId !== activeOrganizationId) return null;
    const segments = await ctx.db
      .query('replaySegments')
      .withIndex('by_replay', (q) =>
        q.eq('projectId', replay.projectId).eq('replayId', replay.replayId),
      )
      .collect();
    segments.sort((a, b) => a.segmentId - b.segmentId);
    const urls = await Promise.all(segments.map((s) => ctx.storage.getUrl(s.storageId)));
    return {
      replayId: replay.replayId,
      startedAt: replay.startedAt,
      durationMs: Math.max(0, replay.lastSegmentAt - replay.startedAt),
      url: replay.url,
      errorCount: replay.errorCount,
      platform: replay.platform,
      recordingUrls: urls.filter((u): u is string => u !== null),
    };
  },
});
