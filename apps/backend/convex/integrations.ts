import { v } from 'convex/values';
import {
  parseJiraResult,
  parseLinearResult,
  trackerRequest,
  type TrackerConfig,
} from '@sveltry/protocol';
import { internal } from './_generated/api';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { requireOrg, requireRole } from './lib/auth';
import { safeFetch } from './lib/net';
import { trackerConfigValidator } from './schema';

const TRACKER_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Issue-tracker integrations (Jira / Linear). Credentials are self-hoster
// supplied and stored per project; queries return only non-secret display fields.
// ---------------------------------------------------------------------------

/** The integration for a project with secrets stripped (for the settings UI). */
export const getProjectIntegration = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return null;
    const row = await ctx.db
      .query('projectIntegrations')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .first();
    if (!row) return null;
    const c = row.config;
    // Never return apiToken / apiKey.
    const display =
      c.type === 'jira'
        ? {
            type: 'jira' as const,
            siteUrl: c.siteUrl,
            projectKey: c.projectKey,
            email: c.email,
            issueTypeName: c.issueTypeName ?? 'Task',
            hasToken: c.apiToken.length > 0,
          }
        : { type: 'linear' as const, teamId: c.teamId, hasToken: c.apiKey.length > 0 };
    return { id: row._id, isEnabled: row.isEnabled, autoCreate: row.autoCreate, display };
  },
});

/** Create or replace a project's tracker integration (admin only). */
export const upsertIntegration = mutation({
  args: {
    projectId: v.id('projects'),
    config: trackerConfigValidator,
    isEnabled: v.boolean(),
    autoCreate: v.boolean(),
  },
  handler: async (ctx, { projectId, config, isEnabled, autoCreate }) => {
    const { activeOrganizationId } = await requireRole(ctx, 'admin');
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId)
      throw new Error('Project not found');
    const existing = await ctx.db
      .query('projectIntegrations')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { config, isEnabled, autoCreate });
      return existing._id;
    }
    return ctx.db.insert('projectIntegrations', {
      organizationId: activeOrganizationId,
      projectId,
      config,
      isEnabled,
      autoCreate,
      createdAt: Date.now(),
    });
  },
});

export const deleteIntegration = mutation({
  args: { integrationId: v.id('projectIntegrations') },
  handler: async (ctx, { integrationId }) => {
    const { activeOrganizationId } = await requireRole(ctx, 'admin');
    const row = await ctx.db.get(integrationId);
    if (!row || row.organizationId !== activeOrganizationId) throw new Error('Not found');
    await ctx.db.delete(integrationId);
  },
});

// ---------------------------------------------------------------------------
// Creating a tracker ticket from an issue.
// ---------------------------------------------------------------------------

/** Authorize a manual "create tracker issue" call (member+, issue in the caller's org). */
export const assertCanCreateTracker = internalQuery({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const { activeOrganizationId } = await requireRole(ctx, 'member');
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.organizationId !== activeOrganizationId) throw new Error('Issue not found');
    const row = await ctx.db
      .query('projectIntegrations')
      .withIndex('by_project', (q) => q.eq('projectId', issue.projectId))
      .first();
    if (!row || !row.isEnabled)
      throw new Error('No tracker integration is configured for this project');
    return true;
  },
});

/** Load the issue + integration config (with secrets) for the outbound action. */
export const loadForCreate = internalQuery({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) return null;
    const row = await ctx.db
      .query('projectIntegrations')
      .withIndex('by_project', (q) => q.eq('projectId', issue.projectId))
      .first();
    const project = await ctx.db.get(issue.projectId);
    return {
      config: row && row.isEnabled ? (row.config as TrackerConfig) : null,
      autoCreate: row?.autoCreate ?? false,
      title: `[${project?.name ?? 'project'}] ${issue.title}`,
      text: `${issue.culprit} · ${issue.level} · ${issue.count} events`,
    };
  },
});

/**
 * Atomically claim the right to create a tracker ticket for an issue. Convex
 * serializes mutations on the same document, so exactly one concurrent caller wins:
 * the loser sees `trackerProvider` already set and is told to back off (preventing
 * two real tickets). Dedup keys on `trackerProvider`, which is always set on a
 * successful create even when the provider returns no url/key.
 */
export const claimTrackerLink = internalMutation({
  args: { issueId: v.id('issues'), provider: v.string() },
  handler: async (ctx, { issueId, provider }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) return { won: false as const, existing: null };
    if (issue.trackerProvider) {
      return {
        won: false as const,
        existing: { key: issue.trackerKey ?? undefined, url: issue.trackerUrl ?? undefined },
      };
    }
    await ctx.db.patch(issueId, { trackerProvider: provider });
    return { won: true as const, existing: null };
  },
});

/** Release a claim whose create failed, so it can be retried. */
export const clearTrackerClaim = internalMutation({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const issue = await ctx.db.get(issueId);
    // Only clear an unfulfilled claim; never wipe a recorded link.
    if (issue && !issue.trackerUrl && !issue.trackerKey) {
      await ctx.db.patch(issueId, { trackerProvider: undefined });
    }
  },
});

export const recordTrackerLink = internalMutation({
  args: {
    issueId: v.id('issues'),
    provider: v.string(),
    key: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, { issueId, provider, key, url }) => {
    await ctx.db.patch(issueId, {
      trackerProvider: provider,
      trackerKey: key,
      trackerUrl: url,
    });
  },
});

interface TrackerOutcome {
  ok: boolean;
  key?: string;
  url?: string;
  detail?: string;
  skipped?: string;
}

/**
 * Create a tracker ticket for an issue. Internal so it can run from both the
 * manual action and the auto-create trigger (no user role required here; the
 * manual entry point authorizes separately). De-duplicates on an existing link.
 */
export const runTrackerCreate = internalAction({
  args: { issueId: v.id('issues'), requireAuto: v.optional(v.boolean()) },
  handler: async (ctx, { issueId, requireAuto }): Promise<TrackerOutcome> => {
    const data = await ctx.runQuery(internal.integrations.loadForCreate, { issueId });
    if (!data || !data.config) return { ok: false, skipped: 'not configured' };
    if (requireAuto && !data.autoCreate) return { ok: false, skipped: 'auto-create off' };

    // Atomically claim the create. If we lose, another run already linked (or is
    // linking) this issue, so return its result instead of POSTing a duplicate.
    const claim = await ctx.runMutation(internal.integrations.claimTrackerLink, {
      issueId,
      provider: data.config.type,
    });
    if (!claim.won) {
      return { ok: true, key: claim.existing?.key, url: claim.existing?.url };
    }

    const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
    const issueUrl = siteUrl ? `${siteUrl}/issues/${issueId}` : undefined;

    const req = trackerRequest(data.config, { title: data.title, text: data.text, url: issueUrl });
    if (!req) {
      await ctx.runMutation(internal.integrations.clearTrackerClaim, { issueId });
      return { ok: false, detail: 'unsupported provider' };
    }

    let outcome: TrackerOutcome;
    try {
      // safeFetch enforces the SSRF guard on the initial target and every redirect.
      const res = await safeFetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: req.body,
        signal: AbortSignal.timeout(TRACKER_TIMEOUT_MS),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      outcome =
        data.config.type === 'jira'
          ? parseJiraResult(res.status, json, data.config.siteUrl)
          : parseLinearResult(json);
    } catch (err) {
      outcome = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }

    if (outcome.ok) {
      await ctx.runMutation(internal.integrations.recordTrackerLink, {
        issueId,
        provider: data.config.type,
        key: outcome.key,
        url: outcome.url,
      });
    } else {
      // Release the claim so a corrected retry can run. Log the failure: when
      // this runs from the auto-create trigger the returned outcome is discarded,
      // so without a log line an operator has no signal the ticket never created.
      console.error(
        `tracker create failed: issue=${issueId} provider=${data.config.type} detail=${outcome.detail ?? 'unknown'}`,
      );
      await ctx.runMutation(internal.integrations.clearTrackerClaim, { issueId });
    }
    return outcome;
  },
});

/** Manually create a tracker ticket from the issue page (member+). */
export const createTrackerIssue = action({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }): Promise<TrackerOutcome> => {
    await ctx.runQuery(internal.integrations.assertCanCreateTracker, { issueId });
    return ctx.runAction(internal.integrations.runTrackerCreate, { issueId });
  },
});
