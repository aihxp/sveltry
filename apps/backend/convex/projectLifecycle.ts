import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, type MutationCtx } from './_generated/server';
import type { Id, TableNames } from './_generated/dataModel';
import { recordAudit } from './lib/audit';
import { requireRole } from './lib/auth';

// ---------------------------------------------------------------------------
// Project deletion. `deleteProject` removes the project row immediately (so it
// disappears from listings and ingest stops resolving its DSN) and schedules a
// background purge. `purgeProjectData` deletes the project's rows across every
// scoped table in bounded batches, rescheduling itself until nothing remains, so
// a large project does not blow a single transaction. Idempotent and re-runnable.
// ---------------------------------------------------------------------------

const BATCH = 100;
// Issues are drained a few at a time because each may have many children
// (issueUsers can be huge for a high-cardinality issue); see the issues block.
const ISSUE_BATCH = 25;
const CHILD_BATCH = 200;

/** Delete a fetched batch of rows (optionally their file-storage blob). */
async function purgeRows(
  ctx: MutationCtx,
  rows: Array<{ _id: Id<TableNames> }>,
  opts?: { storage?: boolean },
): Promise<boolean> {
  for (const row of rows) {
    if (opts?.storage) {
      const sid = (row as { storageId?: Id<'_storage'> }).storageId;
      if (sid) {
        try {
          await ctx.storage.delete(sid);
        } catch {
          // Blob may already be gone; deleting the row is what matters.
        }
      }
    }
    await ctx.db.delete(row._id);
  }
  return rows.length === BATCH;
}

/** Delete an issue's children (comments + users) up to a batch; returns true if more remain. */
async function purgeIssueChildren(ctx: MutationCtx, issueId: Id<'issues'>): Promise<boolean> {
  const comments = await ctx.db
    .query('issueComments')
    .withIndex('by_issue', (q) => q.eq('issueId', issueId))
    .take(CHILD_BATCH);
  for (const c of comments) await ctx.db.delete(c._id);
  const users = await ctx.db
    .query('issueUsers')
    .withIndex('by_issue_user', (q) => q.eq('issueId', issueId))
    .take(CHILD_BATCH);
  for (const u of users) await ctx.db.delete(u._id);
  return comments.length === CHILD_BATCH || users.length === CHILD_BATCH;
}

/**
 * Delete a project's data across all scoped tables, a batch at a time. Each table
 * is queried by a `projectId`-prefixed index; the helper returns whether a table
 * was full (more rows remain). When any table still has data, reschedule.
 */
export const purgeProjectData = internalMutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId: pid }) => {
    const db = ctx.db;
    // Each call below is fully typed: the compiler verifies the index exists on
    // the table and that `projectId` is its first field. `replaySegments` reuses
    // `by_replay` (projectId-prefixed); tables that had no project index gained a
    // `by_project` one in this change.
    let more = false;
    // Issues: drain each issue's comments + users in bounded batches, and only
    // delete the issue once its children are gone, so a high-cardinality issue
    // (many affected users) never leaves orphaned child rows. Issues whose
    // children are not yet drained are kept and re-processed on the next pass.
    const issues = await db
      .query('issues')
      .withIndex('by_project_lastSeen', (q) => q.eq('projectId', pid))
      .take(ISSUE_BATCH);
    let issuesIncomplete = false;
    for (const issue of issues) {
      if (await purgeIssueChildren(ctx, issue._id)) issuesIncomplete = true;
      else await db.delete(issue._id);
    }
    if (issues.length === ISSUE_BATCH || issuesIncomplete) more = true;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('events')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('transactions')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('transactionRollups')
          .withIndex('by_project_bucket', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('sessions')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('sessionBuckets')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('profiles')
          .withIndex('by_project_profileId', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('replaySegments')
          .withIndex('by_replay', (q) => q.eq('projectId', pid))
          .take(BATCH),
        { storage: true },
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('replays')
          .withIndex('by_project_replayId', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('attachments')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
        { storage: true },
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('feedback')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('monitors')
          .withIndex('by_project_slug', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('checkIns')
          .withIndex('by_project_checkInId', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('uptimeMonitors')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('releases')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('releaseArtifacts')
          .withIndex('by_project_release', (q) => q.eq('projectId', pid))
          .take(BATCH),
        { storage: true },
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('releaseCommits')
          .withIndex('by_project_release', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('deploys')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('usageDaily')
          .withIndex('by_project_day', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('alertRules')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('metricAlerts')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('usageAlerts')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('alertDeliveries')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('issueMerges')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('projectIntegrations')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('spikeWindows')
          .withIndex('by_project_window', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('savedViews')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('dashboardWidgets')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;
    more =
      (await purgeRows(
        ctx,
        await db
          .query('projectKeys')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH),
      )) || more;

    if (more) {
      await ctx.scheduler.runAfter(0, internal.projectLifecycle.purgeProjectData, {
        projectId: pid,
      });
    }
  },
});

/**
 * Delete a project. Requires admin and a typed-name confirmation. Removes the
 * project row at once (it leaves listings and ingest immediately) and schedules
 * the background data purge.
 */
export const deleteProject = mutation({
  args: { projectId: v.id('projects'), confirmName: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { projectId, confirmName }) => {
    const caller = await requireRole(ctx, 'admin');
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== caller.activeOrganizationId) {
      throw new Error('Project not found');
    }
    if (confirmName.trim() !== project.name) {
      throw new Error('Type the project name exactly to confirm deletion.');
    }
    await recordAudit(ctx, caller, 'project.delete', project.name);
    await ctx.db.delete(projectId);
    await ctx.scheduler.runAfter(0, internal.projectLifecycle.purgeProjectData, { projectId });
    return { ok: true };
  },
});
