import { betterAuth } from 'better-auth';
import { jwt, organization } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { Pool } from 'pg';

/**
 * Better Auth server instance. Identity (users, sessions, accounts,
 * organizations, JWKS) lives in Postgres via the Kysely/pg adapter.
 *
 * The `jwt` plugin issues RS256 tokens and publishes a JWKS at
 * `/api/auth/jwks`; Convex verifies them via its Custom JWT provider
 * (see apps/backend/convex/auth.config.ts). The active organization is folded
 * into the token so Convex can scope every query to the caller's tenant.
 */
const appUrl = publicEnv.PUBLIC_APP_URL ?? 'http://localhost:5173';

export const auth = betterAuth({
  baseURL: appUrl,
  secret: env.BETTER_AUTH_SECRET,
  database: new Pool({ connectionString: env.DATABASE_URL }),
  emailAndPassword: {
    enabled: true,
    // Self-hosters can wire an email provider; verification is off by default
    // so a fresh instance is usable immediately.
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  plugins: [
    jwt({
      jwt: {
        issuer: appUrl, // must equal Convex provider `issuer` (SITE_URL)
        audience: 'convex', // must equal Convex `applicationID`
        expirationTime: '1h',
        definePayload: ({ user, session }) => ({
          id: user.id,
          email: user.email,
          activeOrganizationId: session.activeOrganizationId ?? null,
        }),
      },
      jwks: {
        // Convex's Custom JWT provider accepts RS256 / ES256.
        keyPairConfig: { alg: 'RS256' },
      },
    }),
    organization(),
    sveltekitCookies(getRequestEvent),
  ],
});

export type Auth = typeof auth;
