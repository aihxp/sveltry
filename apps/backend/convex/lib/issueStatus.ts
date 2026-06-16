import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

type IssueStatus = 'unresolved' | 'resolved' | 'ignored';

/** Maps an issue status to its outbound-webhook lifecycle event. */
export const ISSUE_STATUS_WEBHOOK_EVENT: Record<IssueStatus, string> = {
  resolved: 'issue.resolved',
  ignored: 'issue.ignored',
  unresolved: 'issue.unresolved',
};

/** The default substatus Sveltry assigns when a status changes (Sentry's model). */
export function defaultSubstatusFor(status: IssueStatus): Doc<'issues'>['substatus'] {
  if (status === 'resolved') return 'ongoing';
  if (status === 'ignored') return 'archived_forever';
  return 'ongoing';
}

/**
 * Apply an issue status transition once, the same way for every transport
 * (dashboard mutation, public REST API). Patches status / substatus /
 * resolvedInRelease and fires the lifecycle webhook only when the status
 * actually changed. Shared so the two call sites cannot drift.
 */
export async function applyIssueStatusTransition(
  ctx: MutationCtx,
  issue: Doc<'issues'>,
  status: IssueStatus,
  opts: { substatus?: Doc<'issues'>['substatus']; resolvedInRelease?: string } = {},
): Promise<void> {
  await ctx.db.patch(issue._id, {
    status,
    substatus: opts.substatus ?? defaultSubstatusFor(status),
    resolvedInRelease: status === 'resolved' ? opts.resolvedInRelease : undefined,
  });
  if (issue.status !== status) {
    await ctx.scheduler.runAfter(0, internal.webhooks.dispatch, {
      organizationId: issue.organizationId,
      projectId: issue.projectId,
      event: ISSUE_STATUS_WEBHOOK_EVENT[status],
      issueId: issue._id,
    });
  }
}
