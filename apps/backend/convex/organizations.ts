import { v } from 'convex/values';
import { type MutationCtx, mutation, query } from './_generated/server';
import { requireOrg, requireUser } from './lib/auth';
import { slugify } from './lib/slug';

// ---------------------------------------------------------------------------
// Organizations, modeled entirely in Convex (no external auth provider needed).
// `slug` is the tenant key used as `organizationId` everywhere. Membership lives
// in `memberRoles`; the active org per user lives in `userSettings`.
// ---------------------------------------------------------------------------

/** Create an org, make the caller its owner, and select it as active. */
export const createOrganization = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const { subject, email } = await requireUser(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new Error('An organization name is required');

    // Derive a slug not yet taken (the by_slug index is not a unique constraint).
    const base = slugify(trimmed);
    let slug = base;
    for (let n = 0; n < 50; n++) {
      const existing = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', slug))
        .first();
      if (!existing) break;
      slug = `${base}-${Math.floor(Math.random() * 9000 + 1000)}`;
    }

    const now = Date.now();
    await ctx.db.insert('organizations', {
      slug,
      name: trimmed.slice(0, 80),
      createdBy: subject,
      createdAt: now,
    });
    await ctx.db.insert('memberRoles', {
      organizationId: slug,
      userId: subject,
      role: 'owner',
      email,
      updatedAt: now,
    });
    await setActive(ctx, subject, slug);
    return { organizationId: slug, name: trimmed };
  },
});

/** The organizations the caller belongs to, with their role and which is active. */
export const listMyOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const { subject } = await requireUser(ctx);
    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_user', (q) => q.eq('userId', subject))
      .first();
    const memberships = await ctx.db
      .query('memberRoles')
      .withIndex('by_user', (q) => q.eq('userId', subject))
      .collect();
    return Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db
          .query('organizations')
          .withIndex('by_slug', (q) => q.eq('slug', m.organizationId))
          .first();
        return {
          id: m.organizationId,
          name: org?.name ?? m.organizationId,
          role: m.role,
          isActive: settings?.activeOrganizationId === m.organizationId,
        };
      }),
    );
  },
});

/** The caller's active org (name + role), or null if none selected. */
export const activeOrg = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const subject = (identity as unknown as { subject: string }).subject;
    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_user', (q) => q.eq('userId', subject))
      .first();
    const id = settings?.activeOrganizationId;
    if (!id) return null;
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', id))
      .first();
    const member = await ctx.db
      .query('memberRoles')
      .withIndex('by_org_user', (q) => q.eq('organizationId', id).eq('userId', subject))
      .first();
    return { id, name: org?.name ?? id, role: member?.role ?? null };
  },
});

/** Switch the caller's active org (must be a member). */
export const setActiveOrganization = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const { subject } = await requireUser(ctx);
    const member = await ctx.db
      .query('memberRoles')
      .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId).eq('userId', subject))
      .first();
    if (!member) throw new Error('You are not a member of that organization');
    await setActive(ctx, subject, organizationId);
  },
});

/** Members of the caller's active org (for the settings / teams member pickers). */
export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .collect();
    return rows.map((m) => ({
      userId: m.userId,
      email: m.email ?? null,
      name: m.name ?? null,
      role: m.role,
    }));
  },
});

/** Upsert the per-user active-org pointer. */
async function setActive(ctx: MutationCtx, userId: string, organizationId: string): Promise<void> {
  const existing = await ctx.db
    .query('userSettings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { activeOrganizationId: organizationId });
  } else {
    await ctx.db.insert('userSettings', { userId, activeOrganizationId: organizationId });
  }
}
