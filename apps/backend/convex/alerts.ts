import { v } from 'convex/values';
import { channelRequest } from '@sveltry/protocol';
import { internal } from './_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { requireOrg, requireRole } from './lib/auth';
import { alertChannelValidator, alertTriggerValidator, levelValidator } from './schema';

const LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warning: 2, error: 3, fatal: 4 };

// ---------------------------------------------------------------------------
// Dashboard-facing CRUD
// ---------------------------------------------------------------------------

export const listAlertRules = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return [];
    return ctx.db
      .query('alertRules')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
  },
});

export const createAlertRule = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    trigger: alertTriggerValidator,
    threshold: v.optional(v.number()),
    windowMinutes: v.optional(v.number()),
    minLevel: v.optional(levelValidator),
    channels: v.array(alertChannelValidator),
  },
  handler: async (ctx, args) => {
    const { activeOrganizationId } = await requireRole(ctx, 'admin');
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== activeOrganizationId)
      throw new Error('Project not found');
    return ctx.db.insert('alertRules', {
      organizationId: activeOrganizationId,
      projectId: args.projectId,
      name: args.name.trim() || 'Alert',
      trigger: args.trigger,
      threshold: args.threshold,
      windowMinutes: args.windowMinutes,
      minLevel: args.minLevel,
      channels: args.channels,
      isEnabled: true,
      createdAt: Date.now(),
    });
  },
});

export const setAlertRuleEnabled = mutation({
  args: { ruleId: v.id('alertRules'), isEnabled: v.boolean() },
  handler: async (ctx, { ruleId, isEnabled }) => {
    const { activeOrganizationId } = await requireRole(ctx, 'admin');
    const rule = await ctx.db.get(ruleId);
    if (!rule || rule.organizationId !== activeOrganizationId) throw new Error('Rule not found');
    await ctx.db.patch(ruleId, { isEnabled });
  },
});

export const deleteAlertRule = mutation({
  args: { ruleId: v.id('alertRules') },
  handler: async (ctx, { ruleId }) => {
    const { activeOrganizationId } = await requireRole(ctx, 'admin');
    const rule = await ctx.db.get(ruleId);
    if (!rule || rule.organizationId !== activeOrganizationId) throw new Error('Rule not found');
    await ctx.db.delete(ruleId);
  },
});

// ---------------------------------------------------------------------------
// Ingest-triggered dispatch
// ---------------------------------------------------------------------------

/** Load the issue, project, and enabled rules an event might trigger. */
export const rulesForIssue = internalQuery({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) return null;
    const project = await ctx.db.get(issue.projectId);
    if (!project) return null;
    const rules = await ctx.db
      .query('alertRules')
      .withIndex('by_project', (q) => q.eq('projectId', issue.projectId))
      .filter((q) => q.eq(q.field('isEnabled'), true))
      .collect();
    return { issue, project: { slug: project.slug, name: project.name }, rules };
  },
});

/** Count an issue's events since `since` (epoch ms), bounded for the alert check. */
export const countEventsSince = internalQuery({
  args: { issueId: v.id('issues'), since: v.number() },
  returns: v.number(),
  handler: async (ctx, { issueId, since }) => {
    const recent = await ctx.db
      .query('events')
      .withIndex('by_issue', (q) => q.eq('issueId', issueId).gte('timestamp', since))
      .take(1000);
    return recent.length;
  },
});

/** Whether `ruleId` already fired for `issueId` since `since` (per-window dedup). */
export const firedSince = internalQuery({
  args: { issueId: v.id('issues'), ruleId: v.id('alertRules'), since: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { issueId, ruleId, since }) => {
    const deliveries = await ctx.db
      .query('alertDeliveries')
      .withIndex('by_issue', (q) => q.eq('issueId', issueId))
      .order('desc')
      .take(50);
    return deliveries.some((d) => d.ruleId === ruleId && d.ok && d.deliveredAt >= since);
  },
});

export const recordDelivery = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    issueId: v.id('issues'),
    ruleId: v.id('alertRules'),
    trigger: alertTriggerValidator,
    channelType: v.string(),
    target: v.string(),
    ok: v.boolean(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('alertDeliveries', { ...args, deliveredAt: Date.now() });
  },
});

/** Evaluate alert rules for a freshly ingested event and dispatch notifications. */
export const dispatchForEvent = internalAction({
  args: { issueId: v.id('issues'), isNew: v.boolean(), isRegression: v.boolean() },
  handler: async (ctx, { issueId, isNew, isRegression }) => {
    const data = await ctx.runQuery(internal.alerts.rulesForIssue, { issueId });
    if (!data) return;
    const { issue, project, rules } = data;

    const now = Date.now();
    if (issue.status === 'ignored' && issue.snoozeUntil && issue.snoozeUntil > now) return;

    const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
    const issueUrl = siteUrl ? `${siteUrl}/issues/${issueId}` : undefined;

    for (const rule of rules) {
      if (rule.minLevel && (LEVEL_RANK[issue.level] ?? 0) < (LEVEL_RANK[rule.minLevel] ?? 0))
        continue;

      let fires = false;
      if (rule.trigger === 'new_issue') {
        fires = isNew;
      } else if (rule.trigger === 'regression') {
        fires = isRegression;
      } else if (rule.trigger === 'event_frequency' && rule.threshold != null) {
        // Fire when the event count within the rolling window reaches the
        // threshold, and at most once per window (so a busy issue does not
        // re-alert on every event once it is over the line).
        const windowMs = (rule.windowMinutes ?? 60) * 60_000;
        const since = now - windowMs;
        const recentCount = await ctx.runQuery(internal.alerts.countEventsSince, {
          issueId,
          since,
        });
        if (recentCount >= rule.threshold) {
          const alreadyFired = await ctx.runQuery(internal.alerts.firedSince, {
            issueId,
            ruleId: rule._id,
            since,
          });
          fires = !alreadyFired;
        }
      }
      if (!fires) continue;

      const content: AlertContent = {
        trigger: rule.trigger,
        ruleName: rule.name,
        projectName: project.name,
        issueTitle: issue.title,
        culprit: issue.culprit,
        level: issue.level,
        count: issue.count,
        issueUrl,
      };

      for (const channel of rule.channels) {
        let ok = false;
        let detail: string | undefined;
        try {
          if (channel.type === 'email') {
            // Email runs in the Node runtime over SMTP; the others are fetch-based.
            const res = await ctx.runAction(internal.email.sendEmail, {
              to: channel.target,
              subject: `[${content.projectName}] ${content.issueTitle}`,
              text: alertBody(content),
            });
            ok = res.ok;
            if (!ok) detail = res.skipped ? 'SMTP not configured' : (res.detail ?? 'send failed');
          } else {
            ok = await deliver(channel, content);
            if (!ok) detail = 'non-2xx response';
          }
        } catch (err) {
          detail = err instanceof Error ? err.message : String(err);
        }
        await ctx.runMutation(internal.alerts.recordDelivery, {
          organizationId: issue.organizationId,
          projectId: issue.projectId,
          issueId,
          ruleId: rule._id,
          trigger: rule.trigger,
          channelType: channel.type,
          target: channel.target,
          ok,
          detail,
        });
      }
    }
  },
});

interface AlertContent {
  trigger: string;
  ruleName: string;
  projectName: string;
  issueTitle: string;
  culprit: string;
  level: string;
  count: number;
  issueUrl?: string;
}

/** The plain-text body shared by the Slack and email notifications. */
function alertBody(content: AlertContent): string {
  return [
    `[${content.projectName}] ${content.issueTitle}`,
    `Culprit: ${content.culprit}`,
    `Level: ${content.level} · Events: ${content.count} · Trigger: ${content.trigger}`,
    content.issueUrl ? `View: ${content.issueUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const WEBHOOK_TIMEOUT_MS = 8000;

// Cloud instance-metadata endpoints: the highest-value SSRF target. Blocked for
// every outbound alert regardless of channel. Private-network targets are left
// reachable on purpose: self-hosters routinely point alerts at internal Slack
// proxies or chat relays on the same network.
const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', '[fd00:ec2::254]']);

/** Reject non-http(s) schemes and known cloud-metadata hosts before fetching. */
function assertSafeWebhookTarget(target: string): void {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error('invalid webhook url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`unsupported webhook scheme: ${url.protocol}`);
  }
  if (BLOCKED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('webhook target is not allowed');
  }
}

/** Deliver a single notification to a channel. Returns true on a 2xx response. */
async function deliver(
  channel: { type: string; target: string },
  content: AlertContent,
): Promise<boolean> {
  assertSafeWebhookTarget(channel.target);
  const headline = `[${content.projectName}] ${content.issueTitle}`;
  const lines = alertBody(content);

  if (channel.type === 'webhook') {
    const res = await fetch(channel.target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...content, source: 'sveltry' }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    return res.ok;
  }

  if (channel.type === 'slack') {
    const res = await fetch(channel.target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: lines }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    return res.ok;
  }

  if (channel.type === 'discord') {
    const res = await fetch(channel.target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: content.issueUrl ?? headline,
        embeds: [
          {
            title: content.issueTitle.slice(0, 240),
            description: `${content.culprit}\n\`${content.level}\` · ${content.count} events`,
            url: content.issueUrl,
            color: content.level === 'fatal' || content.level === 'error' ? 0xef4444 : 0xf59e0b,
          },
        ],
      }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    return res.ok;
  }

  // MS Teams / PagerDuty / Opsgenie share a generic payload builder.
  const req = channelRequest(channel, {
    title: headline,
    text: `${content.culprit} · ${content.level} · ${content.count} events · ${content.trigger}`,
    severity: content.level === 'fatal' || content.level === 'error' ? 'error' : 'warning',
    url: content.issueUrl,
  });
  if (req) {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    return res.ok;
  }

  // email is handled in dispatchForEvent via the Node SMTP action, not here.
  return false;
}
