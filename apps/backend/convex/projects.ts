import { v } from 'convex/values';
import { internalQuery, mutation, type QueryCtx, query } from './_generated/server';
import { ingestFiltersValidator, repoConfigValidator, scrubConfigValidator } from './schema';
import { recordAudit } from './lib/audit';
import { requireOrg, requireRole } from './lib/auth';
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
      scrubConfig: v.optional(scrubConfigValidator),
      rateLimitCount: v.optional(v.number()),
      rateLimitWindowSeconds: v.optional(v.number()),
      monthlyEventQuota: v.optional(v.number()),
      spikeThresholdPerMinute: v.optional(v.number()),
      ingestFilters: v.optional(ingestFiltersValidator),
      allowedOrigins: v.optional(v.array(v.string())),
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
      scrubConfig: project.scrubConfig,
      rateLimitCount: key.rateLimitCount,
      rateLimitWindowSeconds: key.rateLimitWindowSeconds,
      monthlyEventQuota: project.monthlyEventQuota,
      spikeThresholdPerMinute: project.spikeThresholdPerMinute,
      ingestFilters: project.ingestFilters,
      allowedOrigins: key.allowedOrigins,
    };
  },
});

async function uniquePublicId(ctx: QueryCtx): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const candidate = generatePublicId();
    const existing = await ctx.db
      .query('projects')
      .withIndex('by_publicId', (q) => q.eq('publicId', candidate))
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
    const caller = await requireRole(ctx, 'admin');
    const { activeOrganizationId } = caller;
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

    await recordAudit(ctx, caller, 'project.create', name.trim() || slug);
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

/**
 * Whether a project has received its first event yet, for the activation flow.
 * Reactive: the new-project setup card subscribes to this and flips from
 * "waiting" to "received" the instant the first event is ingested, linking to the
 * issue it created. Reads the oldest event over `by_project`.
 */
export const firstEventForProject = query({
  args: { projectId: v.id('projects') },
  returns: v.object({ received: v.boolean(), issueId: v.union(v.id('issues'), v.null()) }),
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) {
      return { received: false, issueId: null };
    }
    const first = await ctx.db
      .query('events')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .order('asc')
      .first();
    return { received: first !== null, issueId: first?.issueId ?? null };
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

/** A project's source-repo config (or null), scoped to the active org. Used by the
 * issue detail page to build "open in repo" stack-frame links. */
export const getProjectRepoConfig = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return null;
    return project.repoConfig ?? null;
  },
});

/** Mint an additional DSN key for a project. */
export const createProjectKey = mutation({
  args: { projectId: v.id('projects'), label: v.string() },
  handler: async (ctx, { projectId, label }) => {
    const caller = await requireRole(ctx, 'admin');
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== caller.activeOrganizationId) {
      throw new Error('Project not found');
    }
    const publicKey = generatePublicKey();
    await ctx.db.insert('projectKeys', {
      projectId,
      organizationId: caller.activeOrganizationId,
      label: label.trim() || 'Key',
      publicKey,
      isActive: true,
      createdAt: Date.now(),
    });
    await recordAudit(ctx, caller, 'key.create', `${project.name}: ${label.trim() || 'Key'}`);
    return { publicKey };
  },
});

/** Enable or disable a DSN key. */
export const setProjectKeyActive = mutation({
  args: { keyId: v.id('projectKeys'), isActive: v.boolean() },
  handler: async (ctx, { keyId, isActive }) => {
    const caller = await requireRole(ctx, 'admin');
    const key = await ctx.db.get(keyId);
    if (!key || key.organizationId !== caller.activeOrganizationId)
      throw new Error('Key not found');
    await ctx.db.patch(keyId, { isActive });
    await recordAudit(ctx, caller, isActive ? 'key.enable' : 'key.disable', key.label);
  },
});

/**
 * Set a key's allowed-origin patterns (Sentry's "Allowed Domains"). An empty list
 * clears the restriction (any origin accepted). Admin+ only.
 */
export const setKeyAllowedOrigins = mutation({
  args: { keyId: v.id('projectKeys'), allowedOrigins: v.array(v.string()) },
  handler: async (ctx, { keyId, allowedOrigins }) => {
    const caller = await requireRole(ctx, 'admin');
    const key = await ctx.db.get(keyId);
    if (!key || key.organizationId !== caller.activeOrganizationId)
      throw new Error('Key not found');
    const cleaned = allowedOrigins.map((o) => o.trim()).filter(Boolean);
    await ctx.db.patch(keyId, { allowedOrigins: cleaned.length ? cleaned : undefined });
    await recordAudit(ctx, caller, 'key.origins', key.label);
  },
});

/** Update per-project settings (retention, PII scrubbing, limits, inbound filters). */
export const updateProjectSettings = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.optional(v.string()),
    eventRetentionDays: v.optional(v.number()),
    scrubPii: v.optional(v.boolean()),
    scrubConfig: v.optional(v.union(scrubConfigValidator, v.null())),
    monthlyEventQuota: v.optional(v.union(v.number(), v.null())),
    spikeThresholdPerMinute: v.optional(v.union(v.number(), v.null())),
    ingestFilters: v.optional(v.union(ingestFiltersValidator, v.null())),
    repoConfig: v.optional(v.union(repoConfigValidator, v.null())),
  },
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, 'admin');
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== caller.activeOrganizationId) {
      throw new Error('Project not found');
    }
    const patch: Record<string, unknown> = {};
    // Rename keeps the slug stable (the slug is the ingest/tenant key).
    if (args.name !== undefined && args.name.trim()) patch.name = args.name.trim();
    if (args.eventRetentionDays !== undefined) patch.eventRetentionDays = args.eventRetentionDays;
    if (args.scrubPii !== undefined) patch.scrubPii = args.scrubPii;
    // null clears the custom scrub rules; an object replaces them.
    if (args.scrubConfig !== undefined) patch.scrubConfig = args.scrubConfig ?? undefined;
    // null clears the limit; a number sets it.
    if (args.monthlyEventQuota !== undefined)
      patch.monthlyEventQuota = args.monthlyEventQuota ?? undefined;
    if (args.spikeThresholdPerMinute !== undefined)
      patch.spikeThresholdPerMinute = args.spikeThresholdPerMinute ?? undefined;
    // null clears all filters; an object replaces them wholesale.
    if (args.ingestFilters !== undefined) patch.ingestFilters = args.ingestFilters ?? undefined;
    // null clears the repo link; an object sets it (with a validated https base URL).
    if (args.repoConfig !== undefined) {
      if (args.repoConfig === null) {
        patch.repoConfig = undefined;
      } else {
        const { provider, baseUrl, defaultBranch, sourceRoot } = args.repoConfig;
        let url: URL;
        try {
          url = new URL(baseUrl);
        } catch {
          throw new Error('Repository URL must be a valid URL');
        }
        if (url.protocol !== 'https:') {
          throw new Error('Repository URL must be an https URL');
        }
        patch.repoConfig = {
          provider,
          baseUrl: baseUrl.trim().replace(/\/+$/, ''),
          defaultBranch: defaultBranch.trim() || 'main',
          sourceRoot: sourceRoot?.trim() || undefined,
        };
      }
    }
    await ctx.db.patch(args.projectId, patch);
    await recordAudit(ctx, caller, 'project.update', project.name);
  },
});
