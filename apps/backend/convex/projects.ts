import { v } from 'convex/values';
import { internalQuery, mutation, query } from './_generated/server';
import { requireOrg } from './lib/auth';
import { generatePublicId, generatePublicKey, slugify } from './lib/slug';

const DEFAULT_RETENTION_DAYS = 90;

/**
 * Validate an inbound DSN credential. Called by the ingest HTTP action (which is
 * authenticated by the DSN key, not a user JWT) to map a `(publicId, publicKey)`
 * pair to a project. Returns `null` for unknown or revoked keys.
 */
export const resolveIngestKey = internalQuery({
  args: { publicId: v.string(), publicKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      projectId: v.id('projects'),
      organizationId: v.string(),
      keyId: v.id('projectKeys'),
      scrubPii: v.boolean(),
      rateLimitCount: v.optional(v.number()),
      rateLimitWindowSeconds: v.optional(v.number()),
      monthlyEventQuota: v.optional(v.number()),
      spikeThresholdPerMinute: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { publicId, publicKey }) => {
    const key = await ctx.db
      .query('projectKeys')
      .withIndex('by_publicKey', (q) => q.eq('publicKey', publicKey))
      .first();
    if (!key || !key.isActive) return null;

    const project = await ctx.db.get(key.projectId);
    if (!project || project.publicId !== publicId) return null;

    return {
      projectId: project._id,
      organizationId: project.organizationId,
      keyId: key._id,
      scrubPii: project.scrubPii,
      rateLimitCount: key.rateLimitCount,
      rateLimitWindowSeconds: key.rateLimitWindowSeconds,
      monthlyEventQuota: project.monthlyEventQuota,
      spikeThresholdPerMinute: project.spikeThresholdPerMinute,
    };
  },
});

async function uniquePublicId(ctx: { db: any }): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const candidate = generatePublicId();
    const existing = await ctx.db
      .query('projects')
      .withIndex('by_publicId', (q: any) => q.eq('publicId', candidate))
      .first();
    if (!existing) return candidate;
  }
  // Extremely unlikely; fall back to a timestamp-derived id.
  return `${Date.now()}`;
}

/** Create a project (and a default DSN key) within the caller's organization. */
export const createProject = mutation({
  args: { name: v.string(), platform: v.optional(v.string()) },
  returns: v.object({
    projectId: v.id('projects'),
    slug: v.string(),
    publicId: v.string(),
    publicKey: v.string(),
  }),
  handler: async (ctx, { name, platform }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const now = Date.now();

    // Lazily mirror the organization for project-scoped settings.
    const orgMirror = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', activeOrganizationId))
      .first();
    if (!orgMirror) {
      await ctx.db.insert('organizations', {
        slug: activeOrganizationId,
        name: activeOrganizationId,
        createdAt: now,
      });
    }

    let slug = slugify(name);
    const clash = await ctx.db
      .query('projects')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', activeOrganizationId).eq('slug', slug),
      )
      .first();
    if (clash) slug = `${slug}-${Math.floor(Math.random() * 9000 + 1000)}`;

    const publicId = await uniquePublicId(ctx);
    const projectId = await ctx.db.insert('projects', {
      organizationId: activeOrganizationId,
      slug,
      name: name.trim() || slug,
      platform: platform ?? 'javascript',
      publicId,
      createdAt: now,
      eventRetentionDays: DEFAULT_RETENTION_DAYS,
      scrubPii: true,
    });

    const publicKey = generatePublicKey();
    await ctx.db.insert('projectKeys', {
      projectId,
      organizationId: activeOrganizationId,
      label: 'Default',
      publicKey,
      isActive: true,
      createdAt: now,
    });

    return { projectId, slug, publicId, publicKey };
  },
});

/** List the caller's projects with their primary active DSN key. */
export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const projects = await ctx.db
      .query('projects')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .collect();

    return Promise.all(
      projects.map(async (project) => {
        const key = await ctx.db
          .query('projectKeys')
          .withIndex('by_project', (q) => q.eq('projectId', project._id))
          .filter((q) => q.eq(q.field('isActive'), true))
          .first();
        return {
          ...project,
          publicKey: key?.publicKey ?? null,
        };
      }),
    );
  },
});

/** Fetch a single project (by slug) plus all of its DSN keys. */
export const getProjectBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db
      .query('projects')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', activeOrganizationId).eq('slug', slug),
      )
      .first();
    if (!project) return null;

    const keys = await ctx.db
      .query('projectKeys')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))
      .collect();

    return { project, keys };
  },
});

/** Mint an additional DSN key for a project. */
export const createProjectKey = mutation({
  args: { projectId: v.id('projects'), label: v.string() },
  handler: async (ctx, { projectId, label }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) {
      throw new Error('Project not found');
    }
    const publicKey = generatePublicKey();
    await ctx.db.insert('projectKeys', {
      projectId,
      organizationId: activeOrganizationId,
      label: label.trim() || 'Key',
      publicKey,
      isActive: true,
      createdAt: Date.now(),
    });
    return { publicKey };
  },
});

/** Enable or disable a DSN key. */
export const setProjectKeyActive = mutation({
  args: { keyId: v.id('projectKeys'), isActive: v.boolean() },
  handler: async (ctx, { keyId, isActive }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const key = await ctx.db.get(keyId);
    if (!key || key.organizationId !== activeOrganizationId) throw new Error('Key not found');
    await ctx.db.patch(keyId, { isActive });
  },
});

/** Update per-project settings (retention, PII scrubbing). */
export const updateProjectSettings = mutation({
  args: {
    projectId: v.id('projects'),
    eventRetentionDays: v.optional(v.number()),
    scrubPii: v.optional(v.boolean()),
    monthlyEventQuota: v.optional(v.union(v.number(), v.null())),
    spikeThresholdPerMinute: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== activeOrganizationId) {
      throw new Error('Project not found');
    }
    const patch: Record<string, unknown> = {};
    if (args.eventRetentionDays !== undefined) patch.eventRetentionDays = args.eventRetentionDays;
    if (args.scrubPii !== undefined) patch.scrubPii = args.scrubPii;
    // null clears the limit; a number sets it.
    if (args.monthlyEventQuota !== undefined)
      patch.monthlyEventQuota = args.monthlyEventQuota ?? undefined;
    if (args.spikeThresholdPerMinute !== undefined)
      patch.spikeThresholdPerMinute = args.spikeThresholdPerMinute ?? undefined;
    await ctx.db.patch(args.projectId, patch);
  },
});
