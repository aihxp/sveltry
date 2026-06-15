import { v } from 'convex/values';
import { sha1Hex } from '@sveltry/protocol';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { requireRole } from './lib/auth';
import { generateToken } from './lib/slug';

// ---------------------------------------------------------------------------
// Organization API tokens for the public read API. Only a SHA-1 hash of the raw
// token is stored; the token grants read access scoped to its organization and
// is authenticated by the `apiV1` HTTP action via a Bearer header. Admin+ manages
// tokens on the settings page.
// ---------------------------------------------------------------------------

const TOKEN_PREFIX = 'svtry_';
/** A well-formed token: the prefix followed by 64 lowercase hex chars. */
const TOKEN_RE = /^svtry_[0-9a-f]{64}$/;

/** Create an API token for the active org. Returns the raw token once. */
export const createApiToken = mutation({
  args: { name: v.string() },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, { name }) => {
    const caller = await requireRole(ctx, 'admin');
    const raw = `${TOKEN_PREFIX}${generateToken()}`;
    await ctx.db.insert('apiTokens', {
      organizationId: caller.activeOrganizationId,
      name: name.trim() || 'API token',
      tokenHash: sha1Hex(raw),
      tokenPrefix: raw.slice(0, TOKEN_PREFIX.length + 8),
      createdBy: caller.subject,
      createdByEmail: caller.email,
      createdAt: Date.now(),
    });
    return { token: raw };
  },
});

/** List the active org's API tokens (never the hash or raw value). */
export const listApiTokens = query({
  args: {},
  handler: async (ctx) => {
    const caller = await requireRole(ctx, 'admin');
    const rows = await ctx.db
      .query('apiTokens')
      .withIndex('by_org', (q) => q.eq('organizationId', caller.activeOrganizationId))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r._id,
        name: r.name,
        prefix: r.tokenPrefix,
        createdByEmail: r.createdByEmail ?? null,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt ?? null,
      }));
  },
});

/** Revoke (delete) an API token. Admin+ only, scoped to the active org. */
export const revokeApiToken = mutation({
  args: { tokenId: v.id('apiTokens') },
  handler: async (ctx, { tokenId }) => {
    const caller = await requireRole(ctx, 'admin');
    const row = await ctx.db.get(tokenId);
    if (!row || row.organizationId !== caller.activeOrganizationId)
      throw new Error('Token not found');
    await ctx.db.delete(tokenId);
  },
});

/** Resolve a raw Bearer token to its org (for the public API HTTP action). */
export const resolveApiToken = internalQuery({
  args: { rawToken: v.string() },
  returns: v.union(v.null(), v.object({ tokenId: v.id('apiTokens'), organizationId: v.string() })),
  handler: async (ctx, { rawToken }) => {
    // Reject anything that is not shaped like a token before touching the index.
    if (!TOKEN_RE.test(rawToken)) return null;
    // The stored value is a digest of a 256-bit random secret: security here comes
    // from the token's entropy and the digest's preimage resistance (not collision
    // resistance), so sha1Hex of the full token is sufficient for lookup.
    const row = await ctx.db
      .query('apiTokens')
      .withIndex('by_hash', (q) => q.eq('tokenHash', sha1Hex(rawToken)))
      .first();
    if (!row) return null;
    return { tokenId: row._id, organizationId: row.organizationId };
  },
});

/** Record that a token was used (throttled to once a minute to avoid write churn). */
export const touchApiToken = internalMutation({
  args: { tokenId: v.id('apiTokens') },
  handler: async (ctx, { tokenId }) => {
    const row = await ctx.db.get(tokenId);
    if (!row) return;
    const now = Date.now();
    if (!row.lastUsedAt || now - row.lastUsedAt > 60_000) {
      await ctx.db.patch(tokenId, { lastUsedAt: now });
    }
  },
});
