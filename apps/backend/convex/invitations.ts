import { v } from 'convex/values';
import { type MutationCtx, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { recordAudit } from './lib/audit';
import { ROLE_RANK, type Role, requireRole, requireUser } from './lib/auth';
import { generateToken } from './lib/slug';
import { roleValidator } from './schema';

// ---------------------------------------------------------------------------
// Member invitations. An admin/owner invites an email at a role; the invitee
// opens the tokenized link, signs in (or up) as that email, and accepts, which
// creates their `memberRoles` row. Invites expire after 7 days. The email is
// sent over the existing SMTP action (a no-op when SMTP is unconfigured, so the
// admin can also just copy the link).
// ---------------------------------------------------------------------------

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const norm = (email: string) => email.trim().toLowerCase();

/** Whether an email already has a membership row in the org. */
async function isMember(ctx: MutationCtx, organizationId: string, email: string): Promise<boolean> {
  const rows = await ctx.db
    .query('memberRoles')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
    .collect();
  return rows.some((r) => r.email && norm(r.email) === email);
}

/**
 * Invite an email to the active org at a role. Requires admin+, and the caller
 * cannot grant a role above their own. Re-inviting the same email replaces any
 * pending invite (fresh token + expiry). Returns the token so the dashboard can
 * show a copyable link immediately (important when SMTP is not configured).
 */
export const createInvitation = mutation({
  args: { email: v.string(), role: roleValidator },
  returns: v.object({ token: v.string(), emailSent: v.boolean() }),
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, 'admin');
    const orgId = caller.activeOrganizationId;
    const email = norm(args.email);
    if (!email || !email.includes('@')) throw new Error('A valid email is required');

    // Cannot invite at a role higher than your own.
    if (ROLE_RANK[args.role] > ROLE_RANK[caller.role as Role]) {
      throw new Error('You can only invite up to your own role.');
    }
    if (await isMember(ctx, orgId, email)) {
      throw new Error('That email is already a member of this organization.');
    }

    // Replace any existing pending invite for this email so there is one live token.
    const existing = await ctx.db
      .query('invitations')
      .withIndex('by_org_email', (q) => q.eq('organizationId', orgId).eq('email', email))
      .collect();
    for (const row of existing) {
      if (!row.acceptedAt) await ctx.db.delete(row._id);
    }

    const now = Date.now();
    const token = generateToken();
    await ctx.db.insert('invitations', {
      organizationId: orgId,
      email,
      role: args.role,
      token,
      invitedBy: caller.subject,
      invitedByEmail: caller.email,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    });

    // Resolve the org's display name for the email body.
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgId))
      .first();
    const orgName = org?.name ?? orgId;
    const base = (process.env.SITE_URL ?? '').replace(/\/$/, '');
    const link = base ? `${base}/invite/${token}` : `/invite/${token}`;
    const emailConfigured = !!process.env.SMTP_HOST;

    // Best-effort email; a no-op when SMTP is unconfigured. The link is also shown
    // in the dashboard, so the invite works either way.
    await ctx.scheduler.runAfter(0, internal.email.sendEmail, {
      to: email,
      subject: `You're invited to ${orgName} on Sveltry`,
      text: [
        `${caller.email ?? 'A teammate'} invited you to join ${orgName} on Sveltry as ${args.role}.`,
        '',
        `Accept the invitation: ${link}`,
        '',
        'This link expires in 7 days. If you did not expect this, you can ignore it.',
      ].join('\n'),
    });

    await recordAudit(ctx, caller, 'invite.create', `${email} (${args.role})`);
    return { token, emailSent: emailConfigured };
  },
});

/** Pending (unaccepted, unexpired) invitations for the active org. Admin+ only. */
export const listInvitations = query({
  args: {},
  handler: async (ctx) => {
    const caller = await requireRole(ctx, 'admin');
    const now = Date.now();
    const rows = await ctx.db
      .query('invitations')
      .withIndex('by_org', (q) => q.eq('organizationId', caller.activeOrganizationId))
      .collect();
    return rows
      .filter((r) => !r.acceptedAt && r.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r._id,
        email: r.email,
        role: r.role,
        token: r.token,
        invitedByEmail: r.invitedByEmail ?? null,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }));
  },
});

/** Revoke (delete) a pending invitation. Admin+ only, scoped to the active org. */
export const revokeInvitation = mutation({
  args: { invitationId: v.id('invitations') },
  handler: async (ctx, { invitationId }) => {
    const caller = await requireRole(ctx, 'admin');
    const row = await ctx.db.get(invitationId);
    if (!row || row.organizationId !== caller.activeOrganizationId)
      throw new Error('Invitation not found');
    await ctx.db.delete(invitationId);
    await recordAudit(ctx, caller, 'invite.revoke', row.email);
  },
});

/**
 * Public lookup of an invitation by token, for the accept page (before the user
 * has joined). Returns only what the page needs to render; never the inviter's id
 * or other org data. `status` distinguishes not-found / expired / accepted / valid.
 */
export const getInvitation = query({
  args: { token: v.string() },
  returns: v.object({
    status: v.union(
      v.literal('valid'),
      v.literal('expired'),
      v.literal('accepted'),
      v.literal('not_found'),
    ),
    email: v.optional(v.string()),
    role: v.optional(roleValidator),
    organizationName: v.optional(v.string()),
  }),
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query('invitations')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first();
    if (!row) return { status: 'not_found' as const };
    if (row.acceptedAt) return { status: 'accepted' as const };
    if (row.expiresAt <= Date.now()) return { status: 'expired' as const };
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', row.organizationId))
      .first();
    return {
      status: 'valid' as const,
      email: row.email,
      role: row.role,
      organizationName: org?.name ?? row.organizationId,
    };
  },
});

/**
 * Accept an invitation as the logged-in user. The caller's email must match the
 * invited email (so a link cannot be redeemed by someone else). Creates the
 * membership, marks the invite accepted, and selects the org as active.
 */
export const acceptInvitation = mutation({
  args: { token: v.string() },
  returns: v.object({ organizationId: v.string() }),
  handler: async (ctx, { token }) => {
    const { subject, email } = await requireUser(ctx);
    const row = await ctx.db
      .query('invitations')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first();
    if (!row) throw new Error('This invitation is not valid.');
    if (row.acceptedAt) {
      // Idempotent for the original accepter (e.g. a double-click): they are
      // already a member, so just send them into the org.
      if (row.acceptedBy === subject) return { organizationId: row.organizationId };
      throw new Error('This invitation has already been accepted.');
    }
    if (row.expiresAt <= Date.now()) throw new Error('This invitation has expired.');
    if (!email || norm(email) !== row.email) {
      throw new Error(
        `This invitation was sent to ${row.email}. Sign in as that user to accept it.`,
      );
    }

    const orgId = row.organizationId;
    const now = Date.now();

    // Create the membership if the user is not already in the org.
    const existing = await ctx.db
      .query('memberRoles')
      .withIndex('by_org_user', (q) => q.eq('organizationId', orgId).eq('userId', subject))
      .first();
    if (!existing) {
      await ctx.db.insert('memberRoles', {
        organizationId: orgId,
        userId: subject,
        role: row.role,
        email,
        updatedAt: now,
      });
    }

    await ctx.db.patch(row._id, { acceptedAt: now, acceptedBy: subject });

    // Select the org as active so the user lands in it.
    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_user', (q) => q.eq('userId', subject))
      .first();
    if (settings) await ctx.db.patch(settings._id, { activeOrganizationId: orgId });
    else await ctx.db.insert('userSettings', { userId: subject, activeOrganizationId: orgId });

    return { organizationId: orgId };
  },
});
