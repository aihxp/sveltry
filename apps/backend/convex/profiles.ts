import { v } from 'convex/values';
import { buildFlamegraph } from '@sveltry/protocol';
import type { SentryProfile } from '@sveltry/types';
import { internalMutation, query } from './_generated/server';
import { requireOrg } from './lib/auth';

/** Persist a sampled profile. Idempotent per (project, profileId). */
export const recordProfile = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    profileId: v.string(),
    transactionName: v.string(),
    sampleCount: v.number(),
    durationMs: v.number(),
    platform: v.string(),
    release: v.optional(v.string()),
    environment: v.string(),
    timestamp: v.number(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const dup = await ctx.db
      .query('profiles')
      .withIndex('by_project_profileId', (q) =>
        q.eq('projectId', args.projectId).eq('profileId', args.profileId),
      )
      .first();
    if (dup) return;
    await ctx.db.insert('profiles', args);
  },
});

/** List the organization's profiles, most recent first. */
export const listProfiles = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const profiles = await ctx.db
      .query('profiles')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .order('desc')
      .take(100);
    return profiles.map((p) => ({
      _id: p._id,
      transactionName: p.transactionName,
      sampleCount: p.sampleCount,
      durationMs: p.durationMs,
      platform: p.platform,
      release: p.release,
      timestamp: p.timestamp,
    }));
  },
});

/** A profile's metadata plus a computed flamegraph tree. */
export const getProfile = query({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const p = await ctx.db.get(profileId);
    if (!p || p.organizationId !== activeOrganizationId) return null;
    const payload = p.payload as SentryProfile;
    // Prune frames below 0.5% of samples so the tree stays renderable.
    const flame = buildFlamegraph(payload.profile, { minFraction: 0.005 });
    return {
      transactionName: p.transactionName,
      sampleCount: p.sampleCount,
      durationMs: p.durationMs,
      platform: p.platform,
      release: p.release,
      timestamp: p.timestamp,
      flame,
    };
  },
});
