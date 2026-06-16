import { v } from 'convex/values';
import { discoverAggregate, type DiscoverAggregate, type DiscoverSample } from '@sveltry/protocol';
import { query } from './_generated/server';
import { requireOrg } from './lib/auth';

// ---------------------------------------------------------------------------
// Discover: an ad-hoc analytics query over errors or transactions. Scans a
// bounded window, applies filters, groups by a field, and computes an aggregate
// (count / unique users / avg / p50-p99). The aggregation math is the pure,
// unit-tested `discoverAggregate`; this query just gathers and shapes the rows.
// ---------------------------------------------------------------------------

const SCAN_CAP = 10_000;
const HOUR_MS = 3_600_000;

// Allowlisted fields per dataset, so a query can only group/filter on real columns.
const ERROR_FIELDS = ['level', 'environment', 'release', 'platform'] as const;
const TXN_FIELDS = ['name', 'op', 'status', 'environment', 'release', 'platform'] as const;

const aggregateValidator = v.union(
  v.literal('count'),
  v.literal('users'),
  v.literal('avg'),
  v.literal('p50'),
  v.literal('p75'),
  v.literal('p95'),
  v.literal('p99'),
);

type Row = Record<string, unknown> & {
  release?: string;
  durationMs?: number;
  payload?: unknown;
};

function fieldValue(row: Row, field: string): string {
  const raw = row[field];
  if (raw === undefined || raw === null || raw === '')
    return field === 'release' ? '(none)' : '(unknown)';
  return String(raw);
}

/** Extract a user identity from an event payload, for the distinct-user aggregate. */
function userOf(row: Row): string | undefined {
  const user = (row.payload as { user?: { id?: unknown; email?: unknown; username?: unknown } })
    ?.user;
  const id = user?.id ?? user?.email ?? user?.username;
  return typeof id === 'string' && id ? id : undefined;
}

export const runDiscover = query({
  args: {
    dataset: v.union(v.literal('errors'), v.literal('transactions')),
    projectId: v.optional(v.id('projects')),
    hours: v.number(),
    groupBy: v.string(),
    aggregate: aggregateValidator,
    filters: v.optional(v.array(v.object({ field: v.string(), value: v.string() }))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const fields = args.dataset === 'errors' ? ERROR_FIELDS : TXN_FIELDS;
    const allowed = new Set<string>(fields);

    if (!allowed.has(args.groupBy)) throw new Error(`Cannot group by "${args.groupBy}"`);
    const filters = (args.filters ?? []).filter((f) => allowed.has(f.field));
    if (args.dataset === 'transactions' && args.aggregate === 'users') {
      throw new Error('The users aggregate applies to errors only');
    }

    const hours = Math.min(Math.max(args.hours, 1), 720); // 1h .. 30d
    const since = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - hours * HOUR_MS;

    // Verify project ownership when scoped.
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.organizationId !== activeOrganizationId)
        throw new Error('Project not found');
    }

    // Gather the rows for the window (bounded).
    let rows: Row[] = [];
    if (args.dataset === 'transactions') {
      rows = args.projectId
        ? await ctx.db
            .query('transactions')
            .withIndex('by_project', (q) =>
              q.eq('projectId', args.projectId!).gte('timestamp', since),
            )
            .take(SCAN_CAP)
        : await ctx.db
            .query('transactions')
            .withIndex('by_org', (q) =>
              q.eq('organizationId', activeOrganizationId).gte('timestamp', since),
            )
            .take(SCAN_CAP);
    } else if (args.projectId) {
      rows = await ctx.db
        .query('events')
        .withIndex('by_project', (q) => q.eq('projectId', args.projectId!).gte('timestamp', since))
        .take(SCAN_CAP);
    } else {
      // Org-wide scan over a single time-ordered index (events.by_org), so the
      // SCAN_CAP window is the most-recent events org-wide rather than skewed
      // toward earlier-iterated projects (and no per-project fan-out).
      rows = await ctx.db
        .query('events')
        .withIndex('by_org', (q) =>
          q.eq('organizationId', activeOrganizationId).gte('timestamp', since),
        )
        .take(SCAN_CAP);
    }

    const scanned = rows.length;
    const sampled = scanned >= SCAN_CAP;

    // Apply filters and reduce to aggregation samples.
    const useUsers = args.aggregate === 'users';
    const samples: DiscoverSample[] = [];
    for (const row of rows) {
      if (filters.some((f) => fieldValue(row, f.field) !== f.value)) continue;
      samples.push({
        group: fieldValue(row, args.groupBy),
        value: args.dataset === 'transactions' ? (row.durationMs ?? 0) : undefined,
        user: useUsers ? userOf(row) : undefined,
      });
    }

    const limit = Math.min(args.limit ?? 50, 200);
    const result = discoverAggregate(samples, args.aggregate as DiscoverAggregate, limit);

    return {
      dataset: args.dataset,
      aggregate: args.aggregate,
      groupBy: args.groupBy,
      scanned,
      matched: samples.length,
      sampled,
      total: samples.length,
      rows: result,
    };
  },
});
