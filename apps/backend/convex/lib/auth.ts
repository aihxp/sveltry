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

/**
 * Resolve the caller's identity and active organization, or throw. Every
 * dashboard-facing query/mutation runs this first so all data access is scoped
 * to the caller's tenant.
 */
export async function requireOrg(ctx: QueryCtx): Promise<SveltryIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('Unauthenticated');
  }
  const claims = identity as unknown as {
    subject: string;
    email?: string;
    activeOrganizationId?: string | null;
    org?: string | null;
  };
  const activeOrganizationId = claims.activeOrganizationId ?? claims.org ?? null;
  if (!activeOrganizationId) {
    throw new Error('No active organization. Create or select an organization first.');
  }
  return {
    subject: claims.subject,
    email: claims.email,
    activeOrganizationId,
  };
}

/** Like {@link requireOrg} but returns null instead of throwing when unauthenticated. */
export async function optionalOrg(ctx: QueryCtx): Promise<SveltryIdentity | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const claims = identity as unknown as {
    subject: string;
    email?: string;
    activeOrganizationId?: string | null;
    org?: string | null;
  };
  const activeOrganizationId = claims.activeOrganizationId ?? claims.org ?? null;
  if (!activeOrganizationId) return null;
  return { subject: claims.subject, email: claims.email, activeOrganizationId };
}
