import type { DataModel, TableNames } from '../_generated/dataModel';

/**
 * Single source of truth for the project-scoped (tenant) tables. The project
 * lifecycle operations -- delete (`purgeProjectData`), transfer
 * (`restampProjectOrg`), and the retention sweep -- must each cover this set.
 * They used to be three independently hand-maintained ~25-table lists, which
 * drifted: `webhooks` / `webhookDeliveries` were in none of them, so deleting a
 * project orphaned a plaintext webhook secret and transferring one left those
 * rows stamped with the source org's id (a cross-tenant isolation residue).
 *
 * `ProjectScopedTable` is derived from the schema, so the registry below cannot
 * silently fall behind: the compile-time assertion fails the build if a table
 * gains a `projectId` and is not registered here. Whenever you add a table to
 * this list, also add it to `purgeProjectData` and (if it carries
 * `organizationId`) to `restampProjectOrg`.
 */
export type ProjectScopedTable = {
  [T in TableNames]: 'projectId' extends keyof DataModel[T]['document'] ? T : never;
}[TableNames];

export const TENANT_SCOPED_TABLES = [
  'events',
  'transactions',
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
