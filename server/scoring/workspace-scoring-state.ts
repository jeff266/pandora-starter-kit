/**
 * Workspace Scoring State
 *
 * Computes and persists the 4-state scoring unlock machine per workspace.
 * Called after CRM syncs, ICP Discovery completions, and scoring batch runs.
 */

import { query } from '../db.js';

export type ScoringState = 'locked' | 'ready' | 'processing' | 'active';

export interface WorkspaceScoringState {
  state: ScoringState;
  closedWonDealsCount: number;
  closedWonDealsMinimum: number;
  icpProfile: {
    id: string;
    dealsAnalyzed: number;
    wonDeals: number;
    lastRunAt: string;
    mode: string;
  } | null;
  coverage: {
    accountsTotal: number;
    accountsScored: number;
    accountsEnriched: number;
  };
  processing: {
    step: string | null;
    startedAt: string | null;
    skillRunId: string | null;
  };
}

export async function recomputeScoringState(workspaceId: string): Promise<void> {
  try {
    // Count closed-won deals
    const dealRows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM deals
       WHERE workspace_id = $1 AND stage_normalized = 'closed_won'`,
      [workspaceId]
    );
    const closedWonCount = parseInt(dealRows.rows[0]?.count ?? '0');

    // Check for active ICP profile (uses status column, not is_active)
    const icpRows = await query<{
      id: string;
      deals_analyzed: number;
      won_deals: number;
      generated_at: string;
      scoring_method: string;
    }>(
      `SELECT id, deals_analyzed, won_deals, generated_at, scoring_method
       FROM icp_profiles
       WHERE workspace_id = $1 AND status = 'active'
       ORDER BY generated_at DESC LIMIT 1`,
      [workspaceId]
    );
    const hasActiveICP = icpRows.rows.length > 0;
    const icp = icpRows.rows[0] ?? null;

    // Check for processing skill run (icp-discovery running or pending)
    const runRows = await query<{ id: string; status: string }>(
      `SELECT id, status FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'icp-discovery'
         AND status IN ('running', 'pending')
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId]
    );
    const isProcessing = runRows.rows.length > 0;
    const processingRun = runRows.rows[0] ?? null;

    // Count scoring coverage
    const coverageRows = await query<{ total: string; scored: string; enriched: string }>(
      `SELECT
         COUNT(DISTINCT a.id) AS total,
         COUNT(DISTINCT acs.account_id) AS scored,
         COUNT(DISTINCT asig.account_id) AS enriched
       FROM accounts a
       LEFT JOIN account_scores acs ON acs.account_id = a.id AND acs.workspace_id = a.workspace_id
       LEFT JOIN account_signals asig ON asig.account_id = a.id AND asig.workspace_id = a.workspace_id
       WHERE a.workspace_id = $1`,
      [workspaceId]
    );
    const coverage = coverageRows.rows[0] ?? { total: '0', scored: '0', enriched: '0' };

    // Derive state
    let state: ScoringState;
    if (isProcessing) {
      state = 'processing';
    } else if (hasActiveICP) {
      state = 'active';
    } else if (closedWonCount >= 5) {
      state = 'ready';
    } else {
      state = 'locked';
    }

    // Upsert workspace_scoring_state
    await query(
      `INSERT INTO workspace_scoring_state (
         workspace_id, state, closed_won_deals_count,
         active_icp_profile_id, icp_last_run_at, icp_deals_analyzed,
         accounts_total, accounts_scored, accounts_enriched,
         processing_skill_run_id, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (workspace_id) DO UPDATE SET
         state                    = EXCLUDED.state,
         closed_won_deals_count   = EXCLUDED.closed_won_deals_count,
         active_icp_profile_id    = EXCLUDED.active_icp_profile_id,
         icp_last_run_at          = EXCLUDED.icp_last_run_at,
         icp_deals_analyzed       = EXCLUDED.icp_deals_analyzed,
         accounts_total           = EXCLUDED.accounts_total,
         accounts_scored          = EXCLUDED.accounts_scored,
         accounts_enriched        = EXCLUDED.accounts_enriched,
         processing_skill_run_id  = EXCLUDED.processing_skill_run_id,
         updated_at               = now()`,
      [
        workspaceId,
        state,
        closedWonCount,
        icp?.id ?? null,
        icp?.generated_at ?? null,
        icp?.deals_analyzed ?? null,
        parseInt(coverage.total),
        parseInt(coverage.scored),
        parseInt(coverage.enriched),
        processingRun?.id ?? null,
      ]
    );

    console.log(`[ScoringState] workspace=${workspaceId} state=${state} closedWon=${closedWonCount} scored=${coverage.scored}/${coverage.total}`);
  } catch (err) {
    console.error('[ScoringState] recomputeScoringState failed:', err instanceof Error ? err.message : err);
  }
}

export async function getScoringState(workspaceId: string): Promise<WorkspaceScoringState> {
  const rows = await query<{
    state: string;
    closed_won_deals_count: number;
    closed_won_deals_minimum: number;
    active_icp_profile_id: string | null;
    icp_last_run_at: string | null;
    icp_deals_analyzed: number | null;
    accounts_total: number;
    accounts_scored: number;
    accounts_enriched: number;
    processing_step: string | null;
    processing_started_at: string | null;
    processing_skill_run_id: string | null;
  }>(
    `SELECT * FROM workspace_scoring_state WHERE workspace_id = $1`,
    [workspaceId]
  );

  if (rows.rows.length === 0) {
    // Row not yet created — compute on the fly
    await recomputeScoringState(workspaceId);
    return getScoringState(workspaceId);
  }

  const row = rows.rows[0];

  // Load ICP profile detail if active
  let icpProfile: WorkspaceScoringState['icpProfile'] = null;
  if (row.active_icp_profile_id) {
    const icpRows = await query<{ id: string; deals_analyzed: number; won_deals: number; generated_at: string; scoring_method: string }>(
      `SELECT id, deals_analyzed, won_deals, generated_at, scoring_method FROM icp_profiles WHERE id = $1`,
      [row.active_icp_profile_id]
    );
    const icp = icpRows.rows[0];
    if (icp) {
      icpProfile = {
        id: icp.id,
        dealsAnalyzed: icp.deals_analyzed ?? 0,
        wonDeals: icp.won_deals ?? 0,
        lastRunAt: icp.generated_at,
        mode: icp.scoring_method ?? 'point_based',
      };
    }
  }

  return {
    state: row.state as ScoringState,
    closedWonDealsCount: row.closed_won_deals_count,
    closedWonDealsMinimum: row.closed_won_deals_minimum,
    icpProfile,
    coverage: {
      accountsTotal: row.accounts_total,
      accountsScored: row.accounts_scored,
      accountsEnriched: row.accounts_enriched,
    },
    processing: {
      step: row.processing_step,
      startedAt: row.processing_started_at,
      skillRunId: row.processing_skill_run_id,
    },
  };
}
