'use node';

import nodemailer from 'nodemailer';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';

/**
 * Send an alert email over SMTP. Runs in the Convex Node runtime (`use node`) so
 * it can open an SMTP connection. Configured entirely by deployment env vars; if
 * `SMTP_HOST` is unset, delivery is a clean no-op so a fresh instance still works.
 *
 * Required env (set with `npx convex env set ...`):
 *  - SMTP_HOST                 e.g. smtp.example.com (unset = email disabled)
 *  - SMTP_PORT                 default 587
 *  - SMTP_SECURE               "true" for implicit TLS (port 465); default false
 *  - SMTP_USER / SMTP_PASS     optional auth
 *  - SMTP_FROM                 From address; defaults to SMTP_USER
 */
export const sendEmail = internalAction({
  args: { to: v.string(), subject: v.string(), text: v.string() },
  returns: v.object({
    ok: v.boolean(),
    skipped: v.optional(v.boolean()),
    detail: v.optional(v.string()),
  }),
  handler: async (_ctx, { to, subject, text }) => {
    const host = process.env.SMTP_HOST;
    if (!host) return { ok: false, skipped: true, detail: 'SMTP_HOST not set' };

    const port = Number(process.env.SMTP_PORT ?? 587);
    const secure = (process.env.SMTP_SECURE ?? '').toLowerCase() === 'true' || port === 465;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM ?? user ?? 'sveltry@localhost';

    try {
      const transport = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user && pass ? { user, pass } : undefined,
      });
      await transport.sendMail({ from, to, subject, text });
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  },
});
