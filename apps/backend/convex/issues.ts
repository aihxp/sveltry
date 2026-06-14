import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrg } from './lib/auth';
import { issueStatusValidator, issueSubstatusValidator, levelValidator } from './schema';

/** Paginated issue list, scoped to the org and optionally a single project. */
export const listIssues = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(issueStatusValidator),
    projectId: v.optional(v.id('projects')),
  },
  handler: async (ctx, { paginationOpts, status, projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const effectiveStatus = status ?? 'unresolved';

    if (projectId) {
      const project = await ctx.db.get(projectId);
      if (!project || project.organizationId !== activeOrganizationId) {
        return { page: [], isDone: true, continueCursor: '' };
      }
      return ctx.db
        .query('issues')
        .withIndex('by_project_status_lastSeen', (q) =>
          q.eq('projectId', projectId).eq('status', effectiveStatus),
        )
        .order('desc')
        .paginate(paginationOpts);
    }

    return ctx.db
      .query('issues')
      .withIndex('by_org_status_lastSeen', (q) =>
        q.eq('organizationId', activeOrganizationId).eq('status', effectiveStatus),
      )
      .order('desc')
      .paginate(paginationOpts);
  },
});

/** The most recent issues for the live feed (reactive, no cursor). */
export const recentIssues = query({
  args: {
    status: v.optional(issueStatusValidator),
    projectId: v.optional(v.id('projects')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, projectId, limit }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const effectiveStatus = status ?? 'unresolved';
    const take = Math.min(limit ?? 50, 100);

    let issues;
    if (projectId) {
      const project = await ctx.db.get(projectId);
      if (!project || project.organizationId !== activeOrganizationId) return [];
      issues = await ctx.db
        .query('issues')
        .withIndex('by_project_status_lastSeen', (q) =>
          q.eq('projectId', projectId).eq('status', effectiveStatus),
        )
        .order('desc')
        .take(take);
    } else {
      issues = await ctx.db
        .query('issues')
        .withIndex('by_org_status_lastSeen', (q) =>
          q.eq('organizationId', activeOrganizationId).eq('status', effectiveStatus),
        )
        .order('desc')
        .take(take);
    }

    // Attach the project slug/name for display.
    const projectCache = new Map<string, { slug: string; name: string } | null>();
    return Promise.all(
      issues.map(async (issue) => {
        const key = issue.projectId as unknown as string;
        if (!projectCache.has(key)) {
          const p = await ctx.db.get(issue.projectId);
          projectCache.set(key, p ? { slug: p.slug, name: p.name } : null);
        }
        return { ...issue, project: projectCache.get(key) ?? null };
      }),
    );
  },
});

/** Full-text search over issue titles, with optional status/level/project filters. */
export const searchIssues = query({
  args: {
    query: v.string(),
    status: v.optional(issueStatusValidator),
    level: v.optional(levelValidator),
    projectId: v.optional(v.id('projects')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const term = args.query.trim();
    if (!term) return [];

    const issues = await ctx.db
      .query('issues')
      .withSearchIndex('search_title', (s) => {
        let b = s.search('title', term).eq('organizationId', activeOrganizationId);
        if (args.status) b = b.eq('status', args.status);
        if (args.level) b = b.eq('level', args.level);
        if (args.projectId) b = b.eq('projectId', args.projectId);
        return b;
      })
      .take(Math.min(args.limit ?? 50, 100));

    const projectCache = new Map<string, { slug: string; name: string } | null>();
    return Promise.all(
      issues.map(async (issue) => {
        const key = issue.projectId as unknown as string;
        if (!projectCache.has(key)) {
          const p = await ctx.db.get(issue.projectId);
          projectCache.set(key, p ? { slug: p.slug, name: p.name } : null);
        }
        return { ...issue, project: projectCache.get(key) ?? null };
      }),
    );
  },
});

/** A single issue with its owning project. */
export const getIssue = query({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.organizationId !== activeOrganizationId) return null;
    const project = await ctx.db.get(issue.projectId);
    return { ...issue, project: project ? { slug: project.slug, name: project.name } : null };
  },
});

/** Headline counts for the dashboard overview (bounded scan; see ROADMAP for aggregate). */
export const issueStats = query({
  args: { projectId: v.optional(v.id('projects')) },
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const statuses = ['unresolved', 'resolved', 'ignored'] as const;
    const counts: Record<string, number> = {};
    for (const status of statuses) {
      let rows;
      if (projectId) {
        rows = await ctx.db
          .query('issues')
          .withIndex('by_project_status_lastSeen', (q) =>
            q.eq('projectId', projectId).eq('status', status),
          )
          .take(1000);
      } else {
        rows = await ctx.db
          .query('issues')
          .withIndex('by_org_status_lastSeen', (q) =>
            q.eq('organizationId', activeOrganizationId).eq('status', status),
          )
          .take(1000);
      }
      counts[status] = rows.length;
    }
    return counts;
  },
});

/** Change an issue's status (resolve / ignore / reopen). */
export const setIssueStatus = mutation({
  args: {
    issueId: v.id('issues'),
    status: issueStatusValidator,
    substatus: v.optional(issueSubstatusValidator),
    resolvedInRelease: v.optional(v.string()),
  },
  handler: async (ctx, { issueId, status, substatus, resolvedInRelease }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.organizationId !== activeOrganizationId) throw new Error('Issue not found');

    const defaultSubstatus =
      status === 'resolved' ? 'ongoing' : status === 'ignored' ? 'archived_forever' : 'ongoing';

    await ctx.db.patch(issueId, {
      status,
      substatus: substatus ?? defaultSubstatus,
      resolvedInRelease: status === 'resolved' ? resolvedInRelease : undefined,
    });
  },
});

/** Assign or unassign an issue. */
export const assignIssue = mutation({
  args: { issueId: v.id('issues'), assigneeId: v.optional(v.string()) },
  handler: async (ctx, { issueId, assigneeId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.organizationId !== activeOrganizationId) throw new Error('Issue not found');
    await ctx.db.patch(issueId, { assigneeId });
  },
});

/** Snooze alerts for an issue until a given epoch-ms timestamp. */
export const snoozeIssue = mutation({
  args: { issueId: v.id('issues'), until: v.number() },
  handler: async (ctx, { issueId, until }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.organizationId !== activeOrganizationId) throw new Error('Issue not found');
    await ctx.db.patch(issueId, {
      status: 'ignored',
      substatus: 'archived_until_escalating',
      snoozeUntil: until,
    });
  },
});

/**
 * Merge one issue into another: re-point the source issue's events to the target,
 * fold the counts together, and delete the source. Bounded per call; very large
 * issues move up to 2000 events here (a follow-up could batch the tail).
 */
export const mergeIssues = mutation({
  args: { sourceIssueId: v.id('issues'), targetIssueId: v.id('issues') },
  returns: v.object({ movedEvents: v.number() }),
  handler: async (ctx, { sourceIssueId, targetIssueId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    if (sourceIssueId === targetIssueId) throw new Error('Cannot merge an issue into itself');
    const source = await ctx.db.get(sourceIssueId);
    const target = await ctx.db.get(targetIssueId);
    if (
      !source ||
      !target ||
      source.organizationId !== activeOrganizationId ||
      target.organizationId !== activeOrganizationId
    ) {
      throw new Error('Issue not found');
    }

    const events = await ctx.db
      .query('events')
      .withIndex('by_issue', (q) => q.eq('issueId', sourceIssueId))
      .take(2000);
    for (const e of events) await ctx.db.patch(e._id, { issueId: targetIssueId });

    await ctx.db.patch(targetIssueId, {
      count: target.count + source.count,
      userCount: target.userCount + source.userCount,
      firstSeen: Math.min(target.firstSeen, source.firstSeen),
      lastSeen: Math.max(target.lastSeen, source.lastSeen),
    });
    await ctx.db.delete(sourceIssueId);
    return { movedEvents: events.length };
  },
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/** List an issue's comments, oldest first. */
export const listComments = query({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.organizationId !== activeOrganizationId) return [];
    return ctx.db
      .query('issueComments')
      .withIndex('by_issue', (q) => q.eq('issueId', issueId))
      .order('asc')
      .take(200);
  },
});

/** Post a comment on an issue, authored by the caller. */
export const addComment = mutation({
  args: { issueId: v.id('issues'), body: v.string() },
  handler: async (ctx, { issueId, body }) => {
    const { activeOrganizationId, subject, email } = await requireOrg(ctx);
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.organizationId !== activeOrganizationId) throw new Error('Issue not found');
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Comment is empty');
    return ctx.db.insert('issueComments', {
      organizationId: activeOrganizationId,
      issueId,
      authorId: subject,
      authorEmail: email,
      body: trimmed.slice(0, 10_000),
      createdAt: Date.now(),
    });
  },
});

/** Delete a comment (author only). */
export const deleteComment = mutation({
  args: { commentId: v.id('issueComments') },
  handler: async (ctx, { commentId }) => {
    const { activeOrganizationId, subject } = await requireOrg(ctx);
    const comment = await ctx.db.get(commentId);
    if (!comment || comment.organizationId !== activeOrganizationId) throw new Error('Not found');
    if (comment.authorId !== subject) throw new Error('Only the author can delete a comment');
    await ctx.db.delete(commentId);
  },
});
