import { internalQuery, query } from './_generated/server';
import { requireRole } from './lib/auth';

/**
 * Readiness probe: actually touch the database so `/healthz` reflects whether the
 * backend can serve queries, not just that the HTTP layer is up. A failed query
 * makes the probe return non-200 (see http.ts), so an orchestrator can restart or
 * stop routing to a degraded instance instead of trusting a paper 200.
 */
export const ready = internalQuery({
  args: {},
  handler: async (ctx) => {
    // A bounded read that exercises the storage path without scanning a table.
    await ctx.db.query('organizations').take(1);
    return {};
  },
});

/**
 * Config readiness for operators (admin-gated): which optional-but-important
 * environment variables are set. Missing config otherwise degrades silently
 * (e.g. no SMTP = email alerts are a no-op; no SITE_URL = alert links are blank).
 */
export const configStatus = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireRole(ctx, 'admin');
    const has = (v: string | undefined) => typeof v === 'string' && v.length > 0;
    const siteUrl = has(process.env.SITE_URL);
    const smtp = has(process.env.SMTP_URL) || has(process.env.SMTP_HOST);

    // Actionable warnings, so a misconfiguration surfaces proactively (a settings
    // banner) instead of only via this admin-pull readout. The email warning is
    // gated on actual use: warn only when an alert rule for this org has an email
    // channel while SMTP is unset (otherwise no SMTP is a fine, intentional state).
    const warnings: string[] = [];
    if (!siteUrl) {
      warnings.push('SITE_URL is unset, so alert and webhook "View" links render blank.');
    }
    if (!smtp) {
      const rules = await ctx.db
        .query('alertRules')
        .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
        .take(500);
      if (rules.some((r) => r.channels.some((c) => c.type === 'email'))) {
        warnings.push(
          'An alert rule uses an email channel but SMTP is not configured, so those emails are silently skipped.',
        );
      }
    }

    return {
      siteUrl,
      smtp,
      s3Offload: has(process.env.S3_BUCKET),
      ssrfDohResolver:
        process.env.SSRF_DOH_RESOLVER === undefined
          ? 'default'
          : has(process.env.SSRF_DOH_RESOLVER)
            ? 'custom'
            : 'disabled',
      warnings,
    };
  },
});
