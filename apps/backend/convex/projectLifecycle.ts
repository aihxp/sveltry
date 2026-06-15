import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, type MutationCtx } from './_generated/server';
import type { Id, TableNames } from './_generated/dataModel';
import { recordAudit } from './lib/audit';
import { ROLE_RANK, requireRole } from './lib/auth';

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
 * Re-stamp a transferred project's data onto its new organization. The
 * `transferProject` mutation flips the project row (and its DSN keys) atomically;
 * this background sweep walks every other scoped table and rewrites
 * `organizationId` to the target. It is a state machine over an ordered list of
 * per-table "drainers": each invocation runs exactly ONE step's one page, then
 * reschedules from where it left off (Convex allows only a single paginated query
 * per function call, so steps are not batched together).
 *
 * Unlike the delete purge, re-stamping does NOT remove a row from its
 * `by_project` index, so a `.take()`+reschedule loop would never terminate. The
 * org-rewrite steps therefore use cursor pagination (each row is visited exactly
 * once); the two detach steps clear an optional `projectId`, which DOES remove
 * the row from the index, so they use the simple `.take()` drain. Idempotent and
 * re-runnable: every step filters by `projectId` and writes a fixed value.
 */
export const restampProjectOrg = internalMutation({
  args: {
    projectId: v.id('projects'),
    targetOrganizationId: v.string(),
    step: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { projectId: pid, targetOrganizationId: to, step = 0, cursor = null }) => {
    const db = ctx.db;
    type DrainResult = { count: number; isDone: boolean; cursor: string };

    // Org-rewrite drainers (cursor-paginated). Order mirrors `purgeProjectData`.
    // Every table below carries `organizationId` (verified against the schema);
    // `issueUsers` and `spikeWindows` are intentionally absent (no org field), and
    // `savedViews` / `dashboardWidgets` are handled as detach steps, not here.
    const drains: Array<(c: string | null) => Promise<DrainResult>> = [
      async (c) => {
        const p = await db
          .query('events')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('transactions')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('transactionRollups')
          .withIndex('by_project_bucket', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('sessions')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('sessionBuckets')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('profiles')
          .withIndex('by_project_profileId', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('replaySegments')
          .withIndex('by_replay', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('replays')
          .withIndex('by_project_replayId', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('attachments')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('feedback')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('monitors')
          .withIndex('by_project_slug', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('checkIns')
          .withIndex('by_project_checkInId', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('uptimeMonitors')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('releases')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('releaseArtifacts')
          .withIndex('by_project_release', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('releaseCommits')
          .withIndex('by_project_release', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('deploys')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('usageDaily')
          .withIndex('by_project_day', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('alertRules')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('metricAlerts')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('usageAlerts')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('alertDeliveries')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('issueMerges')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      async (c) => {
        const p = await db
          .query('projectIntegrations')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .paginate({ numItems: BATCH, cursor: c });
        for (const r of p.page) await db.patch(r._id, { organizationId: to });
        return { count: p.page.length, isDone: p.isDone, cursor: p.continueCursor };
      },
      // Issues: re-stamp the issue row and walk its comments (also org-bearing).
      // `issueUsers` is intentionally skipped -- it has no organizationId.
      async (c) => {
        const p = await db
          .query('issues')
          .withIndex('by_project_lastSeen', (q) => q.eq('projectId', pid))
          .paginate({ numItems: ISSUE_BATCH, cursor: c });
        let count = p.page.length;
        for (const issue of p.page) {
          await db.patch(issue._id, { organizationId: to });
          const comments = await db
            .query('issueComments')
            .withIndex('by_issue', (q) => q.eq('issueId', issue._id))
            .collect();
          for (const cm of comments) await db.patch(cm._id, { organizationId: to });
          count += comments.length;
        }
        return { count, isDone: p.isDone, cursor: p.continueCursor };
      },
      // Detach steps: these rows belong to the SOURCE org (a user's saved view, a
      // dashboard's widget) and must NOT move; only their optional project pointer
      // is cleared. Clearing projectId removes the row from `by_project`, so the
      // simple `.take()` drain terminates.
      async () => {
        const rows = await db
          .query('savedViews')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH);
        for (const r of rows) await db.patch(r._id, { projectId: undefined });
        return { count: rows.length, isDone: rows.length < BATCH, cursor: '' };
      },
      async () => {
        const rows = await db
          .query('dashboardWidgets')
          .withIndex('by_project', (q) => q.eq('projectId', pid))
          .take(BATCH);
        for (const r of rows) await db.patch(r._id, { projectId: undefined });
        return { count: rows.length, isDone: rows.length < BATCH, cursor: '' };
      },
    ];

    // Run exactly one step's one page per invocation (single paginate per call).
    if (step >= drains.length) return;
    const res = await drains[step]!(cursor);
    const nextStep = res.isDone ? step + 1 : step;
    const nextCursor = res.isDone ? null : res.cursor;

    if (nextStep < drains.length) {
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
