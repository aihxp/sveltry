import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireRole, roleFor, type Role } from './lib/auth';
import { roleValidator } from './schema';

// ---------------------------------------------------------------------------
// Member roles: Sveltry's own RBAC, enforced in Convex. owner > admin > member >
// billing. owner/admin manage configuration; member can triage; billing is
// read-only. See lib/auth `requireRole`.
// ---------------------------------------------------------------------------

/** The org's explicit role assignments, plus the caller's own (effective) role. */
export const listMemberRoles = query({
  args: {},
  handler: async (ctx) => {
    const caller = await roleFor(ctx);
    const rows = await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', caller.activeOrganizationId))
      .collect();
    return {
      callerRole: caller.role,
      callerUserId: caller.subject,
      bootstrapped: rows.length > 0,
      roles: rows.map((r) => ({
        id: r._id,
        userId: r.userId,
        role: r.role,
        email: r.email ?? null,
        name: r.name ?? null,
      })),
    };
  },
});

/** Persist the caller as owner if the org has no role assignments yet (bootstrap). */
export const ensureBootstrapOwner = mutation({
  args: {},
  handler: async (ctx) => {
    const caller = await roleFor(ctx);
    const existing = await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', caller.activeOrganizationId))
      .first();
    if (existing) return { role: caller.role };
    await ctx.db.insert('memberRoles', {
      organizationId: caller.activeOrganizationId,
      userId: caller.subject,
      role: 'owner',
      email: caller.email,
      updatedAt: Date.now(),
    });
    return { role: 'owner' as Role };
  },
});

/**
 * Set a member's role. Requires admin or owner. Guards: only an owner may grant or
 * change the `owner` role or modify an existing owner; the last owner cannot be
 * demoted (which would lock the org out of administration).
 */
export const setMemberRole = mutation({
  args: {
    userId: v.string(),
    role: roleValidator,
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { userId, role, email, name }) => {
    const caller = await requireRole(ctx, 'admin');
    const orgId = caller.activeOrganizationId;

    // Persist the bootstrap owner before changing anyone else, so the implied owner
    // becomes a recorded one (and the org is never left with no owner row).
    let allRows = await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', orgId))
      .collect();
    if (allRows.length === 0 && caller.subject !== userId) {
      await ctx.db.insert('memberRoles', {
        organizationId: orgId,
        userId: caller.subject,
        role: 'owner',
        email: caller.email,
        updatedAt: Date.now(),
      });
      allRows = await ctx.db
        .query('memberRoles')
        .withIndex('by_org', (q) => q.eq('organizationId', orgId))
        .collect();
    }

    const target = allRows.find((r) => r.userId === userId);

    // Only an owner may involve the owner role (grant it, or change an owner).
    const touchesOwner = role === 'owner' || target?.role === 'owner';
    if (touchesOwner && caller.role !== 'owner') {
      throw new Error('Only an owner can grant or change the owner role.');
    }

    // Never remove the last owner.
    if (target?.role === 'owner' && role !== 'owner') {
      const owners = allRows.filter((r) => r.role === 'owner');
      if (owners.length <= 1) throw new Error('Cannot demote the only owner.');
    }

    if (target) {
      await ctx.db.patch(target._id, { role, email, name, updatedAt: Date.now() });
      return target._id;
    }
    return ctx.db.insert('memberRoles', {
      organizationId: orgId,
      userId,
      role,
      email,
      name,
      updatedAt: Date.now(),
    });
  },
});

/** Remove an explicit role assignment (the member falls back to the default). */
export const removeMemberRole = mutation({
  args: { roleId: v.id('memberRoles') },
  handler: async (ctx, { roleId }) => {
    const caller = await requireRole(ctx, 'admin');
    const row = await ctx.db.get(roleId);
    if (!row || row.organizationId !== caller.activeOrganizationId)
      throw new Error('Assignment not found');
    if (row.role === 'owner') {
      if (caller.role !== 'owner') throw new Error('Only an owner can remove an owner.');
      const owners = await ctx.db
        .query('memberRoles')
        .withIndex('by_org', (q) => q.eq('organizationId', caller.activeOrganizationId))
        .filter((q) => q.eq(q.field('role'), 'owner'))
        .collect();
      if (owners.length <= 1) throw new Error('Cannot remove the only owner.');
    }
    await ctx.db.delete(roleId);
  },
});
