/**
 * Scope Stamper
 *
 * Stamps deals with their correct scope_id based on confirmed analysis_scopes.
 *
 * Two exported functions:
 *   getScopeIdForDeal — pure function, no DB calls, used inline during upsert
 *   stampDealScopes   — batch stamper, fetches scopes then updates deal rows
 *
 * Called from:
 *   initialSync  — run inference + apply + stamp ALL deals for the workspace
 *   incrementalSync — stamp only the deals touched in that sync run
 */

import { query } from '../db.js';

// ============================================================================
// Types
// ============================================================================

export interface AnalysisScope {
  scope_id: string;
  filter_field: string;
  filter_operator: string;
  filter_values: string[];
}

export interface DealRow {
  id: string;
  pipeline: string | null;
  deal_type: string | null;
  custom_fields: Record<string, any>;
}

// ============================================================================
// getScopeIdForDeal — pure, no DB calls
// ============================================================================

/**
 * Evaluate a deal row against a list of confirmed scopes and return the
 * first matching scope_id. Returns 'default' if no scope matches.
 *
 * Scopes are evaluated in the order provided (callers should pass ORDER BY created_at ASC).
 * The 'default' scope (filter_field = '1=1') is always skipped here.
 *
 * Filter field semantics:
 *   'pipeline'               → match deal.pipeline
 *   'deal_type'              → match deal.deal_type
 *   other top-level text     → attempt deal[filter_field] lookup
 *   "custom_fields->>'key'"  → match deal.custom_fields[key]
 *   '1=1'                    → skip (default scope sentinel)
 */
export function getScopeIdForDeal(deal: DealRow, scopes: AnalysisScope[]): string {
  for (const scope of scopes) {
    if (scope.scope_id === 'default') continue;
    if (scope.filter_field === '1=1') continue;
    if (scope.filter_values.length === 0) continue;

    let dealValue: string | null | undefined;

    if (scope.filter_field === 'pipeline') {
      dealValue = deal.pipeline;
    } else if (scope.filter_field === 'deal_type') {
      dealValue = deal.deal_type;
    } else if (scope.filter_field.startsWith("custom_fields->>'")) {
      // Extract key name: "custom_fields->>'record_type_name'" → "record_type_name"
      const match = scope.filter_field.match(/custom_fields->>'([^']+)'/);
      if (match) {
        dealValue = deal.custom_fields?.[match[1]] ?? null;
      }
    } else {
      // Fallback: treat as top-level field on deal row
      dealValue = (deal as any)[scope.filter_field] ?? null;
    }

    if (dealValue != null && scope.filter_values.includes(String(dealValue))) {
      return scope.scope_id;
    }
  }

  return 'default';
}

// ============================================================================
// stampDealScopes — batch DB stamper
// ============================================================================

const STAMP_BATCH_SIZE = 100;

/**
 * Stamp deal rows with the correct scope_id based on confirmed analysis_scopes.
 *
 * If no confirmed non-default scopes exist for this workspace, this is a no-op —
 * all deals stay as 'default'. This is correct behavior for unconfigured workspaces.
 *
 * @param workspaceId  - workspace to stamp
 * @param dealIds      - UUIDs of deals to stamp (can be empty — returns immediately)
 */
export async function stampDealScopes(workspaceId: string, dealIds: string[]): Promise<void> {
  if (dealIds.length === 0) return;

  // 1. Fetch confirmed, non-default scopes for this workspace
  const scopesResult = await query<AnalysisScope & { created_at: string }>(
    `SELECT scope_id, filter_field, filter_operator, filter_values
     FROM analysis_scopes
     WHERE workspace_id = $1
       AND confirmed = true
       AND scope_id != 'default'
     ORDER BY created_at ASC`,
    [workspaceId]
  );

  const scopes = scopesResult.rows;

  // If no confirmed non-default scopes, skip — all deals stay 'default'
  if (scopes.length === 0) return;

  // 2. Fetch deal rows in batches and stamp
  const distribution: Record<string, number> = {};
  let totalStamped = 0;

  for (let i = 0; i < dealIds.length; i += STAMP_BATCH_SIZE) {
    const batchIds = dealIds.slice(i, i + STAMP_BATCH_SIZE);

    const dealsResult = await query<DealRow>(
      `SELECT id, pipeline, deal_type, custom_fields
       FROM deals
       WHERE workspace_id = $1 AND id = ANY($2)`,
      [workspaceId, batchIds]
    );

    for (const deal of dealsResult.rows) {
      const scopeId = getScopeIdForDeal(deal, scopes);

      await query(
        `UPDATE deals SET scope_id = $1, updated_at = now()
         WHERE workspace_id = $2 AND id = $3`,
        [scopeId, workspaceId, deal.id]
      );

      distribution[scopeId] = (distribution[scopeId] || 0) + 1;
      totalStamped++;
    }
  }

  console.log(`[Scope Stamper] workspace=${workspaceId} stamped=${totalStamped} deals`);
  const distStr = Object.entries(distribution)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  console.log(`[Scope Stamper] Distribution: ${distStr}`);
}

// ============================================================================
// stampAllDealsForWorkspace — convenience wrapper for initialSync
// ============================================================================

/**
 * Fetch all deal IDs for a workspace and stamp them.
 * Used by initialSync after inference + apply.
 */
export async function stampAllDealsForWorkspace(workspaceId: string): Promise<void> {
  const result = await query<{ id: string }>(
    `SELECT id FROM deals WHERE workspace_id = $1`,
    [workspaceId]
  );
  const allIds = result.rows.map(r => r.id);
  await stampDealScopes(workspaceId, allIds);
}
