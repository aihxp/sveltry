import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { internal } from './_generated/api';
import { recordAudit } from './lib/audit';
import { requireOrg, requireRole } from './lib/auth';
import { generateToken } from './lib/slug';
import { safeFetch } from './lib/net';
import { webhookEventValidator } from './schema';

// ---------------------------------------------------------------------------
// Outbound webhooks. A project registers an endpoint + a set of issue-lifecycle
// events; when one fires (from the dashboard or the public API), a signed JSON
// payload is POSTed to the endpoint. Delivery happens in a scheduled action (off
// the mutation transaction) via the SSRF-guarded `safeFetch`, signed with the
// webhook's secret (HMAC-SHA256). Best-effort, fire-once, each attempt logged.
// ---------------------------------------------------------------------------

const WEBHOOK_TIMEOUT_MS = 8000;

/** The project's webhooks (never the secret, only an 11-char prefix hint). */
export const listWebhooks = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return [];
    const rows = await ctx.db
      .query('webhooks')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((w) => ({
        _id: w._id,
        url: w.url,
        events: w.events,
        enabled: w.enabled,
        secretPrefix: w.secret.slice(0, 11),
        createdAt: w.createdAt,
        createdByEmail: w.createdByEmail ?? null,
        lastDeliveryAt: w.lastDeliveryAt ?? null,
      }));
  },
});

/** Create a webhook. Admin+ only. Returns the signing secret once (never again). */
export const createWebhook = mutation({
  args: {
    projectId: v.id('projects'),
    url: v.string(),
    events: v.array(webhookEventValidator),
  },
  returns: v.object({ webhookId: v.id('webhooks'), secret: v.string() }),
  handler: async (ctx, { projectId, url, events }) => {
    const caller = await requireRole(ctx, 'admin');
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== caller.activeOrganizationId) {
      throw new Error('Project not found');
    }
    const trimmed = url.trim();
    // Fast feedback at create time; `safeFetch` is the real guard on every delivery.
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error('Invalid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('URL must be http or https');
    }
    if (events.length === 0) throw new Error('Select at least one event');

    const secret = `whsec_${generateToken()}`;
    const webhookId = await ctx.db.insert('webhooks', {
      organizationId: caller.activeOrganizationId,
      projectId,
      url: trimmed,
      secret,
      events,
      enabled: true,
      createdBy: caller.subject,
      createdByEmail: caller.email,
      createdAt: Date.now(),
    });
    await recordAudit(ctx, caller, 'webhook.create', `${project.name}: ${trimmed}`);
    return { webhookId, secret };
  },
});

/** Enable/disable a webhook. Admin+ only. */
export const setWebhookEnabled = mutation({
  args: { webhookId: v.id('webhooks'), enabled: v.boolean() },
  handler: async (ctx, { webhookId, enabled }) => {
    const caller = await requireRole(ctx, 'admin');
    const wh = await ctx.db.get(webhookId);
    if (!wh || wh.organizationId !== caller.activeOrganizationId) {
      throw new Error('Webhook not found');
    }
    await ctx.db.patch(webhookId, { enabled });
    await recordAudit(ctx, caller, 'webhook.update', wh.url);
  },
});

/** Delete a webhook. Admin+ only. */
export const deleteWebhook = mutation({
  args: { webhookId: v.id('webhooks') },
  handler: async (ctx, { webhookId }) => {
    const caller = await requireRole(ctx, 'admin');
    const wh = await ctx.db.get(webhookId);
    if (!wh || wh.organizationId !== caller.activeOrganizationId) {
      throw new Error('Webhook not found');
    }
    await ctx.db.delete(webhookId);
    await recordAudit(ctx, caller, 'webhook.delete', wh.url);
  },
});

/** Load the (post-patch) issue, its project slug, and the enabled webhooks subscribed
 * to `event`. Returns null if the issue was deleted between the schedule and dispatch. */
export const webhooksForEvent = internalQuery({
  args: { projectId: v.id('projects'), issueId: v.id('issues'), event: v.string() },
  handler: async (ctx, { projectId, issueId, event }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.projectId !== projectId) return null;
    const project = await ctx.db.get(projectId);
    const hooks = await ctx.db
      .query('webhooks')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    const matching = hooks.filter((w) => w.enabled && w.events.some((e) => e === event));
    return {
      issue,
      projectSlug: project?.slug ?? null,
      webhooks: matching.map((w) => ({ _id: w._id, url: w.url, secret: w.secret })),
    };
  },
});

/** Record one delivery attempt and stamp the webhook's last-delivery time. */
export const recordWebhookDelivery = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    webhookId: v.id('webhooks'),
    issueId: v.id('issues'),
    event: v.string(),
    url: v.string(),
    ok: v.boolean(),
    statusCode: v.optional(v.number()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert('webhookDeliveries', { ...args, deliveredAt: now });
    const wh = await ctx.db.get(args.webhookId);
    if (wh) await ctx.db.patch(args.webhookId, { lastDeliveryAt: now });
  },
});

/** HMAC-SHA256 of `body` keyed by `secret`, as lowercase hex. */
async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build the signed payload once and POST it to each subscribed webhook. */
export const dispatch = internalAction({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    event: v.string(),
    issueId: v.id('issues'),
  },
  handler: async (ctx, { organizationId, projectId, event, issueId }) => {
    const data = await ctx.runQuery(internal.webhooks.webhooksForEvent, {
      projectId,
      issueId,
      event,
    });
    if (!data || data.webhooks.length === 0) return;

    const { issue, projectSlug } = data;
    const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
    const timestamp = Date.now();
    const body = JSON.stringify({
      event,
      timestamp,
      source: 'sveltry',
      issue: {
        id: issue._id,
        shortId: projectSlug && issue.shortId ? `${projectSlug}-${issue.shortId}` : undefined,
        projectSlug: projectSlug ?? undefined,
        title: issue.title,
        culprit: issue.culprit,
        level: issue.level,
        status: issue.status,
        substatus: issue.substatus,
        assigneeId: issue.assigneeId ?? null,
        url: siteUrl ? `${siteUrl}/issues/${issue._id}` : undefined,
      },
    });

    for (const wh of data.webhooks) {
      let ok = false;
      let statusCode: number | undefined;
      let detail: string | undefined;
      try {
        const sig = await signBody(wh.secret, body);
        const res = await safeFetch(wh.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Sveltry-Event': event,
            'X-Sveltry-Timestamp': String(timestamp),
            'X-Sveltry-Signature': `sha256=${sig}`,
          },
          body,
          // One timeout for the whole delivery; safe because safeFetch walks
          // redirect hops sequentially with this same signal.
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        statusCode = res.status;
        ok = res.ok;
        if (!ok) detail = 'non-2xx response';
      } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
      }
      await ctx.runMutation(internal.webhooks.recordWebhookDelivery, {
        organizationId,
        projectId,
        webhookId: wh._id,
        issueId,
        event,
        url: wh.url,
        ok,
        statusCode,
        detail,
      });
    }
  },
});
