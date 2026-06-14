import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrg } from './lib/auth';
import { slugify } from './lib/slug';

// ---------------------------------------------------------------------------
// Teams: org-scoped groupings of members that own a subset of projects. Modeled
// in Convex; membership references the Better Auth user id (`subject`), with
// email/name denormalized for display.
// ---------------------------------------------------------------------------

/** All teams in the active org with their members and project counts. */
export const listTeams = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const teams = await ctx.db
      .query('teams')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .collect();
    teams.sort((a, b) => a.name.localeCompare(b.name));

    return Promise.all(
      teams.map(async (team) => {
        const members = await ctx.db
          .query('teamMembers')
          .withIndex('by_team', (q) => q.eq('teamId', team._id))
          .collect();
        const projects = await ctx.db
          .query('projects')
          .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
          .filter((q) => q.eq(q.field('teamId'), team._id))
          .collect();
        return {
          id: team._id,
          name: team.name,
          slug: team.slug,
          createdAt: team.createdAt,
          members: members.map((m) => ({
            id: m._id,
            userId: m.userId,
            email: m.email ?? null,
            name: m.name ?? null,
          })),
          projects: projects.map((p) => ({ id: p._id, name: p.name, slug: p.slug })),
        };
      }),
    );
  },
});

/** The team ids the caller belongs to (for filtering their projects/issues). */
export const myTeamIds = query({
  args: {},
  handler: async (ctx) => {
    const { activeOrganizationId, subject } = await requireOrg(ctx);
    const rows = await ctx.db
      .query('teamMembers')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', activeOrganizationId).eq('userId', subject),
      )
      .collect();
    return rows.map((r) => r.teamId);
  },
});

export const createTeam = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new Error('A team name is required');

    // Probe for a slug not yet used within the org.
    const base = slugify(trimmed);
    let slug = base;
    for (let n = 2; ; n++) {
      const existing = await ctx.db
        .query('teams')
        .withIndex('by_org_slug', (q) =>
          q.eq('organizationId', activeOrganizationId).eq('slug', slug),
        )
        .first();
      if (!existing) break;
      slug = `${base}-${n}`;
    }

    return ctx.db.insert('teams', {
      organizationId: activeOrganizationId,
      name: trimmed.slice(0, 80),
      slug,
      createdAt: Date.now(),
    });
  },
});

export const deleteTeam = mutation({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const team = await ctx.db.get(teamId);
    if (!team || team.organizationId !== activeOrganizationId) throw new Error('Team not found');

    // Detach the team's projects and drop its memberships.
    const projects = await ctx.db
      .query('projects')
      .withIndex('by_org', (q) => q.eq('organizationId', activeOrganizationId))
      .filter((q) => q.eq(q.field('teamId'), teamId))
      .collect();
    for (const p of projects) await ctx.db.patch(p._id, { teamId: undefined });

    const members = await ctx.db
      .query('teamMembers')
      .withIndex('by_team', (q) => q.eq('teamId', teamId))
      .collect();
    for (const m of members) await ctx.db.delete(m._id);

    await ctx.db.delete(teamId);
  },
});

export const addTeamMember = mutation({
  args: {
    teamId: v.id('teams'),
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { teamId, userId, email, name }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const team = await ctx.db.get(teamId);
    if (!team || team.organizationId !== activeOrganizationId) throw new Error('Team not found');

    const existing = await ctx.db
      .query('teamMembers')
      .withIndex('by_team_user', (q) => q.eq('teamId', teamId).eq('userId', userId))
      .first();
    if (existing) return existing._id;

    return ctx.db.insert('teamMembers', {
      organizationId: activeOrganizationId,
      teamId,
      userId,
      email,
      name,
      addedAt: Date.now(),
    });
  },
});

export const removeTeamMember = mutation({
  args: { memberId: v.id('teamMembers') },
  handler: async (ctx, { memberId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const member = await ctx.db.get(memberId);
    if (!member || member.organizationId !== activeOrganizationId)
      throw new Error('Member not found');
    await ctx.db.delete(memberId);
  },
});

/** Assign a project to a team (or pass `teamId: null` to make it org-wide). */
export const assignProjectTeam = mutation({
  args: { projectId: v.id('projects'), teamId: v.union(v.id('teams'), v.null()) },
  handler: async (ctx, { projectId, teamId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId)
      throw new Error('Project not found');
    if (teamId) {
      const team = await ctx.db.get(teamId);
      if (!team || team.organizationId !== activeOrganizationId) throw new Error('Team not found');
    }
    await ctx.db.patch(projectId, { teamId: teamId ?? undefined });
  },
});
