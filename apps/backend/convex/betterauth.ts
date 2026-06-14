import { betterAuth } from 'better-auth';
import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import authConfig from './auth.config';

/**
 * Better Auth identity running on the Convex component (no Postgres). Email +
 * password only; `ctx.auth.getUserIdentity()` keeps working via the convex()
 * plugin, so requireOrg/roleFor are unchanged. Organizations are Convex-native
 * (organizations.ts), so the Better Auth organization plugin is NOT used.
 */
export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.SITE_URL ?? 'http://localhost:5173',
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    plugins: [convex({ authConfig })],
  });
