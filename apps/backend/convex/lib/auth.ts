import type { QueryCtx } from '../_generated/server';

/**
 * The verified identity Sveltry expects from a Better Auth JWT. `subject` is the
 * user id; `activeOrganizationId` is a custom claim set via Better Auth's
 * `jwt.definePayload`, which Convex forwards on the identity object.
 */
export interface SveltryIdentity {
  subject: string;
  email?: string;
  activeOrganizationId: string;
}

interface Claims {
  subject: string;
  email?: string;
  activeOrganizationId?: string | null;
  org?: string | null;
}

export interface SveltryUser {
  subject: string;
  email?: string;
}

/** The caller's identity without requiring an active org (e.g. before they have one). */
export async function requireUser(ctx: QueryCtx): Promise<SveltryUser> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('Unauthenticated');
  const claims = identity as unknown as Claims;
  return { subject: claims.subject, email: claims.email };
}

/**
 * Resolve the caller's active organization from Convex (the source of truth),
 * with backward-compatible fallbacks so the change is safe mid-transition:
 *   1. `userSettings.activeOrganizationId` (Convex-native; set by setActiveOrganization),
 *      validated against membership so a removed user's stale pointer is ignored.
 *   2. A legacy `activeOrganizationId` JWT claim (older auth provider).
 *   3. The user's sole membership, when they belong to exactly one org.
 */
export async function resolveActiveOrg(
  ctx: QueryCtx,
  userId: string,
  jwtClaim: string | null,
): Promise<string | null> {
  const settings = await ctx.db
    .query('userSettings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();
  const active = settings?.activeOrganizationId;
  if (active) {
    const member = await ctx.db
      .query('memberRoles')
      .withIndex('by_org_user', (q) => q.eq('organizationId', active).eq('userId', userId))
      .first();
    if (member) return active;
    // Allow an org that has no role rows yet (self-hosted bootstrap, see roleFor);
    // only treat the pointer as stale when the org has members the caller is not in.
    const anyMember = await ctx.db
      .query('memberRoles')
      .withIndex('by_org', (q) => q.eq('organizationId', active))
      .first();
    if (!anyMember) return active;
  }

  if (jwtClaim) return jwtClaim;

  const memberships = await ctx.db
    .query('memberRoles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .take(2);
  if (memberships.length === 1) return memberships[0]!.organizationId;

  return null;
}

/**
 * Resolve the caller's identity and active organization, or throw. Every
 * dashboard-facing query/mutation runs this first so all data access is scoped
 * to the caller's tenant. The active org is resolved from Convex (see
 * {@link resolveActiveOrg}); the JWT only needs to carry the user id.
 */
export async function requireOrg(ctx: QueryCtx): Promise<SveltryIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('Unauthenticated');
  }
  const claims = identity as unknown as Claims;
  const activeOrganizationId = await resolveActiveOrg(
    ctx,
    claims.subject,
    claims.activeOrganizationId ?? claims.org ?? null,
  );
  if (!activeOrganizationId) {
    throw new Error('No active organization. Create or select an organization first.');
  }
  return {
    subject: claims.subject,
    email: claims.email,
    activeOrganizationId,
  };
}

export type Role = 'owner' | 'admin' | 'member' | 'billing';

/** Role precedence: owner can do everything an admin can, and so on down. */
export const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1, billing: 0 };

export interface SveltryMember extends SveltryIdentity {
  role: Role;
}

/**
 * The caller's identity plus their Sveltry role in the active org. Roles live in
 * the `memberRoles` table. Bootstrap: an org with no role rows treats its caller as
 * `owner` (the first user of a fresh, self-hosted org); once any role is assigned,
 * an unassigned member defaults to `member`.
 */
export async function roleFor(ctx: QueryCtx): Promise<SveltryMember> {
  const identity = await requireOrg(ctx);
  const row = await ctx.db
    .query('memberRoles')
    .withIndex('by_org_user', (q) =>
      q.eq('organizationId', identity.activeOrganizationId).eq('userId', identity.subject),
    )
    .first();
  if (row) return { ...identity, role: row.role };
  const anyRow = await ctx.db
    .query('memberRoles')
    .withIndex('by_org', (q) => q.eq('organizationId', identity.activeOrganizationId))
    .first();
  return { ...identity, role: anyRow ? 'member' : 'owner' };
}

/** Resolve the caller's role and throw unless it is at least `min`. */
export async function requireRole(ctx: QueryCtx, min: Role): Promise<SveltryMember> {
  const member = await roleFor(ctx);
  if (ROLE_RANK[member.role] < ROLE_RANK[min]) {
    throw new Error(`This action requires the ${min} role or higher.`);
  }
  return member;
}

/** Like {@link requireOrg} but returns null instead of throwing when unauthenticated. */
export async function optionalOrg(ctx: QueryCtx): Promise<SveltryIdentity | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const claims = identity as unknown as Claims;
  const activeOrganizationId = await resolveActiveOrg(
    ctx,
    claims.subject,
    claims.activeOrganizationId ?? claims.org ?? null,
  );
  if (!activeOrganizationId) return null;
  return { subject: claims.subject, email: claims.email, activeOrganizationId };
}
