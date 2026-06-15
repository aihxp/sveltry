import type { MutationCtx } from '../_generated/server';

/** The caller fields an audit entry needs (a superset is fine, e.g. requireRole's result). */
interface AuditActor {
  activeOrganizationId: string;
  subject: string;
  email?: string;
}

/**
 * Append an organization audit-log entry. Called from the mutating dashboard
 * paths (projects, keys, roles, invitations, tokens, alerts) after the change
 * succeeds, so the log records who did what. Best-effort and append-only; it
 * never blocks the underlying mutation's result.
 */
export async function recordAudit(
  ctx: MutationCtx,
  actor: AuditActor,
  action: string,
  target?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await ctx.db.insert('auditLog', {
    organizationId: actor.activeOrganizationId,
    actorId: actor.subject,
    actorEmail: actor.email,
    action,
    target,
    metadata,
    createdAt: Date.now(),
  });
}
