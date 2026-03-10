/**
 * Data Visibility Scoping
 *
 * Derives a DataScope from a user's resolved RBAC permissions.
 * This scope is attached to req.dataScope by workspace-context middleware
 * and returned in GET /api/auth/me so the frontend can enforce UI-level guards.
 *
 * NOTE: This does NOT yet filter query results — it establishes the contract
 * that RLS query-level enforcement will consume via req.dataScope.
 */

export interface DataScope {
  dealsFilter: 'all' | 'own';
  repsFilter: 'all' | 'team' | 'own';
  canExport: boolean;
}

type Permissions = Record<string, boolean>;

/**
 * Derive a DataScope from a resolved permission set.
 * Call this after resolving the user's workspace_role permissions.
 */
export function getDataVisibilityScope(permissions: Permissions): DataScope {
  const repsViewAll = permissions['data.reps_view_all'] === true;
  const repsViewTeam = permissions['data.reps_view_team'] === true;

  let repsFilter: DataScope['repsFilter'];
  if (repsViewAll) {
    repsFilter = 'all';
  } else if (repsViewTeam) {
    repsFilter = 'team';
  } else {
    repsFilter = 'own';
  }

  const dealsFilter: DataScope['dealsFilter'] = permissions['data.deals_view'] === true
    ? 'all'
    : 'own';

  const canExport = permissions['data.export'] === true;

  return { dealsFilter, repsFilter, canExport };
}

/**
 * Return the most permissive DataScope (for admins).
 */
export function adminDataScope(): DataScope {
  return { dealsFilter: 'all', repsFilter: 'all', canExport: true };
}
