import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import authConfig from './auth.config';

/**
 * SPIKE: Better Auth running on the Convex component (no Postgres). The component
 * stores all auth tables in Convex; `ctx.auth.getUserIdentity()` keeps working via
 * the `convex()` identity plugin, so the existing `requireOrg` helper survives.
 */
export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.SITE_URL ?? 'http://localhost:5173',
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    plugins: [organization(), convex({ authConfig })],
  });
