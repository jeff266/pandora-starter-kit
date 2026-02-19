/**
 * Scope Loader
 *
 * Provides two utilities for skill execution:
 *
 *   getActiveScopes(workspaceId) — returns which scopes a skill should run against
 *   getScopeWhereClause(scope)  — returns the SQL WHERE fragment for a scope
 *
 * Fan-out rules:
 *   - Unconfigured workspace (only 'default' scope): return [default], skill runs once
 *   - Configured workspace (confirmed non-default scopes): return those scopes ONLY
 *     Do NOT include 'default' — non-default scopes collectively cover all deals.
 *     Running 'default' as well would double-count every deal.
 *
 * Graceful degradation:
 *   If the analysis_scopes table doesn't exist yet (pre-migration 058),
 *   getActiveScopes() catches the error and returns [DEFAULT_SCOPE].
 *   No skill execution is disrupted — workspaces silently run as single-scope.
 */

import { query } from '../db.js';

// ============================================================================
// Types
// ============================================================================

export interface ActiveScope {
  scope_id: string;
  name: string;
  filter_field: string;
  filter_operator: string;
  filter_values: string[];
  field_overrides: Record<string, any>;
}

// Fallback used when analysis_scopes table doesn't exist or workspace is unconfigured
export const DEFAULT_SCOPE: ActiveScope = {
  scope_id: 'default',
  name: 'All Deals',
  filter_field: '1=1',
  filter_operator: 'in',
  filter_values: [],
  field_overrides: {},
};

// ============================================================================
// getActiveScopes
// ============================================================================

/**
 * Return the list of scopes a skill should execute against for a workspace.
 *
 * Returns [DEFAULT_SCOPE] when:
 *   - The analysis_scopes table doesn't exist yet
 *   - No confirmed non-default scopes exist for this workspace
 *
 * Returns non-default scopes ONLY when confirmed non-default scopes exist.
 * Does NOT include 'default' in that case — callers must not double-run.
 */
export async function getActiveScopes(workspaceId: string): Promise<ActiveScope[]> {
  try {
    const result = await query<{
      scope_id: string;
      name: string;
      filter_field: string;
      filter_operator: string;
      filter_values: string[];
      field_overrides: any;
    }>(
      `SELECT scope_id, name, filter_field, filter_operator, filter_values, field_overrides
       FROM analysis_scopes
       WHERE workspace_id = $1
         AND confirmed = true
         AND included_in_default_scope = true
       ORDER BY
         CASE WHEN scope_id = 'default' THEN 1 ELSE 0 END ASC,
         created_at ASC`,
      [workspaceId]
    );

    const scopes: ActiveScope[] = result.rows.map(row => ({
      scope_id: row.scope_id,
      name: row.name,
      filter_field: row.filter_field,
      filter_operator: row.filter_operator,
      filter_values: Array.isArray(row.filter_values) ? row.filter_values : [],
      field_overrides: row.field_overrides || {},
    }));

    // Only confirmed non-default scopes → run per-scope, do NOT include default
    const nonDefault = scopes.filter(s => s.scope_id !== 'default');
    if (nonDefault.length > 0) {
      return nonDefault;
    }

    // Unconfigured workspace → single run, no scope filter
    return [DEFAULT_SCOPE];
  } catch (_err) {
    // Graceful degradation: analysis_scopes table may not exist yet (pre-migration 058)
    return [DEFAULT_SCOPE];
  }
}

// ============================================================================
// getScopeWhereClause
// ============================================================================

/**
 * Convert an ActiveScope into a SQL WHERE clause fragment.
 *
 * Returns an empty string for the default scope (no filter).
 * The returned string does NOT include a leading 'AND' — callers append as needed.
 *
 * All filter_values are SQL-escaped (single quotes doubled).
 *
 * Examples:
 *   { filter_field: 'pipeline', filter_values: ['Enterprise'] }
 *   → "pipeline = ANY(ARRAY['Enterprise'])"
 *
 *   { filter_field: "custom_fields->>'record_type_name'", filter_values: ['New Business', 'Renewal'] }
 *   → "custom_fields->>'record_type_name' = ANY(ARRAY['New Business','Renewal'])"
 *
 *   { scope_id: 'default', filter_field: '1=1' }
 *   → ""  (no filter)
 */
export function getScopeWhereClause(scope: ActiveScope): string {
  if (scope.scope_id === 'default' || scope.filter_field === '1=1') {
    return '';
  }

  if (!scope.filter_values || scope.filter_values.length === 0) {
    return '';
  }

  // SQL-escape each value: replace single quotes with ''
  const escaped = scope.filter_values.map(v => `'${String(v).replace(/'/g, "''")}'`);
  const arrayLiteral = `ARRAY[${escaped.join(',')}]`;

  const isNotIn = scope.filter_operator === 'not_in';

  // Resolve the SQL column/expression for the filter field
  let fieldExpr: string;
  if (scope.filter_field === 'pipeline') {
    fieldExpr = 'pipeline';
  } else if (scope.filter_field === 'deal_type') {
    fieldExpr = 'deal_type';
  } else {
    fieldExpr = scope.filter_field;
  }

  if (isNotIn) {
    return `(${fieldExpr} IS NULL OR ${fieldExpr} != ALL(${arrayLiteral}))`;
  }

  return `${fieldExpr} = ANY(${arrayLiteral})`;
}
