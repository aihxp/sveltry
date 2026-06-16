import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, type MutationCtx } from './_generated/server';
import type { Id, TableNames } from './_generated/dataModel';
import { recordAudit } from './lib/audit';
import { ROLE_RANK, requireRole } from './lib/auth';
import { TENANT_SCOPED_TABLES, type ProjectScopedTable } from './lib/tenantTables';

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

/** Delete one bounded batch of a project's rows from a tenant table; returns whether more remain. */
type ProjectPurger = (ctx: MutationCtx, pid: Id<'projects'>) => Promise<boolean>;

/**
 * One purge drainer per registered tenant table, keyed by `ProjectScopedTable`.
 * Because the key type is the registry's element type, TypeScript fails the build
 * if a table is added to `TENANT_SCOPED_TABLES` (and thus the schema) without a
 * matching drainer here -- so purge coverage cannot silently fall behind the
 * registry the way the old hand-maintained list could. Each closure is fully
 * typed: the compiler verifies the index exists on the table and that `projectId`
 * is its first field. `replaySegments` reuses `by_replay` (projectId-prefixed);
 * the three storage-backed tables pass `{ storage: true }` so their blob is
 * deleted with the row. `issues` drains each issue's comments + users first, only
 * deleting the issue once its children are gone, so a high-cardinality issue never
 * leaves orphaned child rows.
 */
const PROJECT_PURGERS: Record<ProjectScopedTable, ProjectPurger> = {
  issues: async (ctx, pid) => {
    const issues = await ctx.db
      .query('issues')
      .withIndex('by_project_lastSeen', (q) => q.eq('projectId', pid))
      .take(ISSUE_BATCH);
    let issuesIncomplete = false;
    for (const issue of issues) {
      if (await purgeIssueChildren(ctx, issue._id)) issuesIncomplete = true;
      else await ctx.db.delete(issue._id);
    }
    return issues.length === ISSUE_BATCH || issuesIncomplete;
  },
  events: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('events')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  transactions: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('transactions')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  transactionRollups: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('transactionRollups')
        .withIndex('by_project_bucket', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  sessions: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('sessions')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  sessionBuckets: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('sessionBuckets')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  profiles: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('profiles')
        .withIndex('by_project_profileId', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  replaySegments: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('replaySegments')
        .withIndex('by_replay', (q) => q.eq('projectId', pid))
        .take(BATCH),
      { storage: true },
    ),
  replays: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('replays')
        .withIndex('by_project_replayId', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  attachments: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('attachments')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
      { storage: true },
    ),
  feedback: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('feedback')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  monitors: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('monitors')
        .withIndex('by_project_slug', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  checkIns: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('checkIns')
        .withIndex('by_project_checkInId', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  uptimeMonitors: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('uptimeMonitors')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  releases: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('releases')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  releaseArtifacts: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('releaseArtifacts')
        .withIndex('by_project_release', (q) => q.eq('projectId', pid))
        .take(BATCH),
      { storage: true },
    ),
  releaseCommits: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('releaseCommits')
        .withIndex('by_project_release', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  deploys: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('deploys')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  usageDaily: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('usageDaily')
        .withIndex('by_project_day', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  alertRules: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('alertRules')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  metricAlerts: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('metricAlerts')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  usageAlerts: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('usageAlerts')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  alertDeliveries: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('alertDeliveries')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  notificationDeliveries: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('notificationDeliveries')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  webhooks: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('webhooks')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  webhookDeliveries: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('webhookDeliveries')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  issueMerges: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('issueMerges')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  projectIntegrations: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('projectIntegrations')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  spikeWindows: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('spikeWindows')
        .withIndex('by_project_window', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  savedViews: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('savedViews')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  dashboardWidgets: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('dashboardWidgets')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
  projectKeys: async (ctx, pid) =>
    purgeRows(
      ctx,
      await ctx.db
        .query('projectKeys')
        .withIndex('by_project', (q) => q.eq('projectId', pid))
        .take(BATCH),
    ),
};

/**
 * Delete a project's data across all scoped tables, a batch at a time, by
 * iterating the registry-keyed `PROJECT_PURGERS`. Each drainer returns whether
 * its table still has rows; when any does, reschedule until everything is gone.
 */
export const purgeProjectData = internalMutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId: pid }) => {
    let more = false;
    for (const table of TENANT_SCOPED_TABLES) {
      more = (await PROJECT_PURGERS[table](ctx, pid)) || more;
    }
    if (more) {
      await ctx.scheduler.runAfter(0, internal.projectLifecycle.purgeProjectData, {
        projectId: pid,
      });
    }
  },
});

type DrainResult = { count: number; isDone: boolean; cursor: string };

/** Re-stamp / detach one page of a tenant table for a transferred project. */
type OrgDrainer = (
  ctx: MutationCtx,
  pid: Id<'projects'>,
  to: string,
  cursor: string | null,
) => Promise<DrainResult>;

/** A no-op drainer for tables that are not re-stamped here (see notes per entry). */
const noopDrain: OrgDrainer = async () => ({ count: 0, isDone: true, cursor: '' });

/**
 * One re-stamp drainer per registered tenant table, keyed by `ProjectScopedTable`
 * exactly like `PROJECT_PURGERS`, so the compiler likewise fails the build if a
 * registered table has no transfer step. Org-rewrite steps cursor-paginate and
 * patch `organizationId` (re-stamping does NOT remove a row from `by_project`, so
 * a `.take()`+reschedule loop would never terminate). The two detach steps clear
 * the optional `projectId` (which DOES remove the row, so `.take()` drains them).
 * `projectKeys` is re-stamped atomically inside `transferProject`, and
 * `spikeWindows` carries no `organizationId` (a transient per-minute counter), so
 * both are no-ops here. Idempotent and re-runnable: every step filters by
 * `projectId` and writes a fixed value.
 */
const ORG_DRAINERS: Record<ProjectScopedTable, OrgDrainer> = {
  events: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('events')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  transactions: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('transactions')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  transactionRollups: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('transactionRollups')
      .withIndex('by_project_bucket', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  sessions: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('sessions')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  sessionBuckets: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('sessionBuckets')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  profiles: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('profiles')
      .withIndex('by_project_profileId', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  replaySegments: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('replaySegments')
      .withIndex('by_replay', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  replays: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('replays')
      .withIndex('by_project_replayId', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  attachments: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('attachments')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  feedback: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('feedback')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  monitors: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('monitors')
      .withIndex('by_project_slug', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  checkIns: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('checkIns')
      .withIndex('by_project_checkInId', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  uptimeMonitors: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('uptimeMonitors')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  releases: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('releases')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  releaseArtifacts: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('releaseArtifacts')
      .withIndex('by_project_release', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  releaseCommits: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('releaseCommits')
      .withIndex('by_project_release', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  deploys: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('deploys')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  usageDaily: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('usageDaily')
      .withIndex('by_project_day', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  alertRules: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('alertRules')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  metricAlerts: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('metricAlerts')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  usageAlerts: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('usageAlerts')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  alertDeliveries: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('alertDeliveries')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  notificationDeliveries: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('notificationDeliveries')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  // Webhooks + delivery log move with the project (they carry organizationId).
  // Historically absent here, which left a transferred project's webhook rows
  // stamped with the SOURCE org's id (a cross-tenant residue).
  webhooks: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('webhooks')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  webhookDeliveries: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  issueMerges: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('issueMerges')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  projectIntegrations: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('projectIntegrations')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .paginate({ numItems: BATCH, cursor: c });
    for (const r of p.page) await ctx.db.patch(r._id, { organizationId: to });
    return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
  },
  // Issues: re-stamp the issue row and walk its comments (also org-bearing).
  // `issueUsers` is intentionally skipped -- it has no organizationId.
  issues: async (ctx, pid, to, c) => {
    const p = await ctx.db
      .query('issues')
      .withIndex('by_project_lastSeen', (q) => q.eq('projectId', pid))
      .paginate({ numItems: ISSUE_BATCH, cursor: c });
    let count = p.page.length;
    for (const issue of p.page) {
      await ctx.db.patch(issue._id, { organizationId: to });
      const comments = await ctx.db
        .query('issueComments')
        .withIndex('by_issue', (q) => q.eq('issueId', issue._id))
        .collect();
      for (const cm of comments) await ctx.db.patch(cm._id, { organizationId: to });
      count += comments.length;
    }
    return { count, isDone: p.isDone, cursor: p.continueCursor };
  },
  // Detach steps: these rows belong to the SOURCE org (a user's saved view, a
  // dashboard's widget) and must NOT move; only their optional project pointer is
  // cleared. Clearing projectId removes the row from `by_project`, so `.take()`
  // drains them (cursor pagination would never terminate over a fixed `by_project`).
  savedViews: async (ctx, pid) => {
    const rows = await ctx.db
      .query('savedViews')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .take(BATCH);
    for (const r of rows) await ctx.db.patch(r._id, { projectId: undefined });
    return { count: rows.length, isDone: rows.length < BATCH, cursor: '' };
  },
  dashboardWidgets: async (ctx, pid) => {
    const rows = await ctx.db
      .query('dashboardWidgets')
      .withIndex('by_project', (q) => q.eq('projectId', pid))
      .take(BATCH);
    for (const r of rows) await ctx.db.patch(r._id, { projectId: undefined });
    return { count: rows.length, isDone: rows.length < BATCH, cursor: '' };
  },
  // `projectKeys` is re-stamped atomically inside `transferProject`; `spikeWindows`
  // has no `organizationId`. Both are intentional no-ops, but they must appear so
  // the registry stays the single, exhaustive source of truth.
  projectKeys: noopDrain,
  spikeWindows: noopDrain,
};

/**
 * Re-stamp a transferred project's data onto its new organization by walking the
 * registry-keyed `ORG_DRAINERS` as a state machine: each invocation runs exactly
 * ONE step's one page (Convex allows a single paginated query per call), then
 * reschedules from where it left off. `step` indexes `TENANT_SCOPED_TABLES`.
 */
export const restampProjectOrg = internalMutation({
  args: {
    projectId: v.id('projects'),
    targetOrganizationId: v.string(),
    step: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { projectId: pid, targetOrganizationId: to, step = 0, cursor = null }) => {
    if (step >= TENANT_SCOPED_TABLES.length) return;
    const res = await ORG_DRAINERS[TENANT_SCOPED_TABLES[step]!](ctx, pid, to, cursor);
    const nextStep = res.isDone ? step + 1 : step;
    const nextCursor = res.isDone ? null : res.cursor;

    if (nextStep < TENANT_SCOPED_TABLES.length) {
      await ctx.scheduler.runAfter(0, internal.projectLifecycle.restampProjectOrg, {
        projectId: pid,
        targetOrganizationId: to,
        step: nextStep,
        cursor: nextCursor,
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

/**
 * Transfer a project (and all its data) to another organization. The caller must
 * be admin+ of BOTH the source (active) org and the target org. The project row
 * and its DSN keys flip to the target org synchronously, so the project leaves
 * the source org and ingest attributes new events to the target immediately; a
 * background sweep ({@link restampProjectOrg}) then re-stamps the rest of the
 * scoped data. Requires a typed-name confirmation. If the project's slug already
 * exists in the target org it is auto-suffixed; the final slug is returned.
 */
export const transferProject = mutation({
  args: {
    projectId: v.id('projects'),
    targetOrganizationId: v.string(),
    confirmName: v.string(),
  },
  returns: v.object({ ok: v.boolean(), slug: v.string() }),
  handler: async (ctx, { projectId, targetOrganizationId, confirmName }) => {
    const caller = await requireRole(ctx, 'admin');
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== caller.activeOrganizationId) {
      throw new Error('Project not found');
    }
    if (targetOrganizationId === caller.activeOrganizationId) {
      throw new Error('The project is already in that organization.');
    }
    const targetOrg = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', targetOrganizationId))
      .first();
    if (!targetOrg) throw new Error('Target organization not found');

    // The caller must administer the target org too (transfer reshapes both orgs'
    // data scoping), verified directly against memberRoles.
    const targetMember = await ctx.db
      .query('memberRoles')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', targetOrganizationId).eq('userId', caller.subject),
      )
      .first();
    if (!targetMember || ROLE_RANK[targetMember.role] < ROLE_RANK.admin) {
      throw new Error('You must be an admin of the target organization.');
    }
    if (confirmName.trim() !== project.name) {
      throw new Error('Type the project name exactly to confirm the transfer.');
    }

    // Guarantee (organizationId, slug) uniqueness in the target by auto-suffixing.
    let finalSlug = project.slug;
    const collision = await ctx.db
      .query('projects')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', targetOrganizationId).eq('slug', finalSlug),
      )
      .first();
    if (collision) {
      let n = 2;
      for (; n <= 1000; n++) {
        const candidate = `${project.slug}-${n}`;
        const taken = await ctx.db
          .query('projects')
          .withIndex('by_org_slug', (q) =>
            q.eq('organizationId', targetOrganizationId).eq('slug', candidate),
          )
          .first();
        if (!taken) {
          finalSlug = candidate;
          break;
        }
      }
      if (n > 1000) throw new Error('Could not find a free slug in the target organization.');
    }

    const from = project.organizationId;
    const to = targetOrganizationId;

    // Flip the project row (drop the source-org team reference) and its DSN keys.
    await ctx.db.patch(projectId, { organizationId: to, slug: finalSlug, teamId: undefined });
    const keys = await ctx.db
      .query('projectKeys')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    for (const k of keys) await ctx.db.patch(k._id, { organizationId: to });

    // Audit in both orgs (recordAudit keys to the actor's active = source org).
    await recordAudit(ctx, caller, 'project.transfer', project.name, { from, to });
    await ctx.db.insert('auditLog', {
      organizationId: to,
      actorId: caller.subject,
      actorEmail: caller.email,
      action: 'project.transfer',
      target: project.name,
      metadata: { from, to },
      createdAt: Date.now(),
    });

    // Flip-then-sweep: the project (and ingest) move immediately, but the bulk of
    // its rows are re-stamped asynchronously. Until the sweep catches up, the
    // source org's org-wide views can still surface this project's residual rows
    // (data its own members owned a moment ago) and the target's views show it
    // trickling in. This eventual-consistency window is bounded and symmetric, and
    // is an accepted property of the transfer (no row is lost and ingest attributes
    // correctly to the target from the first post-flip event).
    await ctx.scheduler.runAfter(0, internal.projectLifecycle.restampProjectOrg, {
      projectId,
      targetOrganizationId: to,
    });
    return { ok: true, slug: finalSlug };
  },
});
