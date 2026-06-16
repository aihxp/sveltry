import type { DataModel, TableNames } from '../_generated/dataModel';

/**
 * Single source of truth for the project-scoped (tenant) tables. The two
 * whole-project lifecycle operations -- delete (`purgeProjectData`) and transfer
 * (`restampProjectOrg`) -- cover exactly this set, and now do so under compiler
 * enforcement: both are driven by a `Record<ProjectScopedTable, ...>` drainer map
 * (`PROJECT_PURGERS` / `ORG_DRAINERS`), so the build fails if a registered table
 * has no purge / transfer step. They used to be hand-maintained ~25-table lists,
 * which drifted: `webhooks` / `webhookDeliveries` were in none of them, so
 * deleting a project orphaned a plaintext webhook secret and transferring one
 * left those rows stamped with the source org's id (a cross-tenant residue).
 *
 * `ProjectScopedTable` is derived from the schema, so the registry below also
 * cannot silently fall behind the schema: the compile-time assertion fails the
 * build if a table gains a `projectId` and is not registered here. The two links
 * together (schema -> registry -> drainers) make adding a `projectId` table a
 * compile error until it is registered AND drained by both lifecycle ops.
 *
 * Note the retention sweep (`maintenance.sweepRetention`) intentionally prunes
 * only the high-volume time-series subset by age; it is NOT expected to cover this
 * whole set (you do not age out a project's alert rules), so it is not registry-driven.
 */
export type ProjectScopedTable = {
  [T in TableNames]: 'projectId' extends keyof DataModel[T]['document'] ? T : never;
}[TableNames];

export const TENANT_SCOPED_TABLES = [
  'events',
  'transactions',
  'transactionsMeta',
  'transactionRollups',
  'sessions',
  'sessionBuckets',
  'profiles',
  'replaySegments',
  'replays',
  'attachments',
  'feedback',
  'monitors',
  'checkIns',
  'uptimeMonitors',
  'releases',
  'releaseArtifacts',
  'releaseCommits',
  'deploys',
  'usageDaily',
  'alertRules',
  'metricAlerts',
  'usageAlerts',
  'alertDeliveries',
  'notificationDeliveries',
  'webhooks',
  'webhookDeliveries',
  'issueMerges',
  'projectIntegrations',
  'spikeWindows',
  'savedViews',
  'dashboardWidgets',
  'projectKeys',
  'issues',
] as const satisfies readonly ProjectScopedTable[];

// Compile-time exhaustiveness: the registry must equal the schema's project-scoped
// set. If either side has a table the other lacks, one of these aliases becomes a
// non-`never` union and the assignment below fails to compile, naming the table.
type _Registered = (typeof TENANT_SCOPED_TABLES)[number];
type _MissingFromRegistry = Exclude<ProjectScopedTable, _Registered>;
type _ExtraInRegistry = Exclude<_Registered, ProjectScopedTable>;
const _tenantTablesInSyncWithSchema: [_MissingFromRegistry, _ExtraInRegistry] extends [never, never]
  ? true
  : {
      error: 'TENANT_SCOPED_TABLES is out of sync with the schema';
      missing: _MissingFromRegistry;
      extra: _ExtraInRegistry;
    } = true;
void _tenantTablesInSyncWithSchema;
