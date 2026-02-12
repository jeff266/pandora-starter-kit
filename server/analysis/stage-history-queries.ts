/**
 * Stage History Query Functions
 *
 * High-level queries for Pipeline Waterfall, Rep Scorecard,
 * and other skills that need stage transition data.
 */

import { query } from '../db.js';

export interface StageTransition {
  deal_id: string;
  deal_name: string;
  deal_source_id: string;
  from_stage: string | null;
  from_stage_normalized: string | null;
  to_stage: string;
  to_stage_normalized: string;
  changed_at: Date;
  duration_in_previous_stage_ms: number | null;
  duration_days: number | null;
  source: string;
}

export interface DealStageJourney {
  deal_id: string;
  deal_name: string;
  owner: string;
  amount: number;
  transitions: StageTransition[];
  total_transitions: number;
  current_stage: string;
  days_in_current_stage: number;
  created_at: Date;
}

export interface StageConversionRate {
  from_stage_normalized: string;
  to_stage_normalized: string;
  transition_count: number;
  avg_duration_days: number;
}

export interface RepStageMetrics {
  rep_name: string;
  stage_normalized: string;
  deals_entered: number;
  deals_exited: number;
  avg_duration_days: number;
  fastest_transition_days: number;
  slowest_transition_days: number;
}

/**
 * Get all stage transitions for a specific deal, ordered chronologically
 */
export async function getDealStageHistory(
  workspaceId: string,
  dealId: string
): Promise<DealStageJourney | null> {
  // Get deal info
  const dealResult = await query<{
    id: string;
    name: string;
    owner: string;
    amount: number;
    stage: string;
    stage_changed_at: Date;
    created_at: Date;
  }>(
    `SELECT id, name, owner, amount, stage, stage_changed_at, created_at
     FROM deals
     WHERE id = $1 AND workspace_id = $2`,
    [dealId, workspaceId]
  );

  if (dealResult.rows.length === 0) return null;

  const deal = dealResult.rows[0];

  // Get stage history
  const historyResult = await query<StageTransition>(
    `SELECT
      dsh.deal_id,
      d.name as deal_name,
      dsh.deal_source_id,
      dsh.from_stage,
      dsh.from_stage_normalized,
      dsh.to_stage,
      dsh.to_stage_normalized,
      dsh.changed_at,
      dsh.duration_in_previous_stage_ms,
      ROUND(dsh.duration_in_previous_stage_ms / 86400000.0, 1)::NUMERIC as duration_days,
      dsh.source
     FROM deal_stage_history dsh
     JOIN deals d ON d.id = dsh.deal_id
     WHERE dsh.deal_id = $1 AND dsh.workspace_id = $2
     ORDER BY dsh.changed_at ASC`,
    [dealId, workspaceId]
  );

  // Calculate days in current stage
  const daysInCurrentStage = deal.stage_changed_at
    ? Math.floor((Date.now() - new Date(deal.stage_changed_at).getTime()) / 86400000)
    : 0;

  return {
    deal_id: deal.id,
    deal_name: deal.name,
    owner: deal.owner,
    amount: deal.amount,
    transitions: historyResult.rows,
    total_transitions: historyResult.rows.length,
    current_stage: deal.stage,
    days_in_current_stage: daysInCurrentStage,
    created_at: deal.created_at,
  };
}

/**
 * Get stage transitions for all deals in a workspace within a time window
 * Useful for Pipeline Waterfall analysis
 */
export async function getStageTransitionsInWindow(
  workspaceId: string,
  startDate: Date,
  endDate: Date
): Promise<StageTransition[]> {
  const result = await query<StageTransition>(
    `SELECT
      dsh.deal_id,
      d.name as deal_name,
      dsh.deal_source_id,
      dsh.from_stage,
      dsh.from_stage_normalized,
      dsh.to_stage,
      dsh.to_stage_normalized,
      dsh.changed_at,
      dsh.duration_in_previous_stage_ms,
      ROUND(dsh.duration_in_previous_stage_ms / 86400000.0, 1)::NUMERIC as duration_days,
      dsh.source
     FROM deal_stage_history dsh
     JOIN deals d ON d.id = dsh.deal_id
     WHERE dsh.workspace_id = $1
       AND dsh.changed_at >= $2
       AND dsh.changed_at <= $3
     ORDER BY dsh.changed_at ASC`,
    [workspaceId, startDate, endDate]
  );

  return result.rows;
}

/**
 * Get stage conversion rates (how many deals moved from stage A to stage B)
 * Groups by normalized stages for consistent reporting
 */
export async function getStageConversionRates(
  workspaceId: string,
  startDate?: Date,
  endDate?: Date
): Promise<StageConversionRate[]> {
  const conditions = ['workspace_id = $1'];
  const params: any[] = [workspaceId];

  if (startDate) {
    params.push(startDate);
    conditions.push(`changed_at >= $${params.length}`);
  }

  if (endDate) {
    params.push(endDate);
    conditions.push(`changed_at <= $${params.length}`);
  }

  const result = await query<StageConversionRate>(
    `SELECT
      from_stage_normalized,
      to_stage_normalized,
      COUNT(*)::INTEGER as transition_count,
      ROUND(AVG(duration_in_previous_stage_ms / 86400000.0), 1)::NUMERIC as avg_duration_days
     FROM deal_stage_history
     WHERE ${conditions.join(' AND ')}
       AND from_stage_normalized IS NOT NULL
       AND to_stage_normalized IS NOT NULL
     GROUP BY from_stage_normalized, to_stage_normalized
     ORDER BY transition_count DESC`,
    params
  );

  return result.rows;
}

/**
 * Get stage performance metrics by rep
 * Shows how long deals stay in each stage per rep
 */
export async function getRepStageMetrics(
  workspaceId: string,
  startDate?: Date,
  endDate?: Date
): Promise<RepStageMetrics[]> {
  const conditions = ['dsh.workspace_id = $1'];
  const params: any[] = [workspaceId];

  if (startDate) {
    params.push(startDate);
    conditions.push(`dsh.changed_at >= $${params.length}`);
  }

  if (endDate) {
    params.push(endDate);
    conditions.push(`dsh.changed_at <= $${params.length}`);
  }

  const result = await query<RepStageMetrics>(
    `SELECT
      d.owner as rep_name,
      dsh.from_stage_normalized as stage_normalized,
      COUNT(*)::INTEGER as deals_entered,
      COUNT(*)::INTEGER as deals_exited,
      ROUND(AVG(dsh.duration_in_previous_stage_ms / 86400000.0), 1)::NUMERIC as avg_duration_days,
      ROUND(MIN(dsh.duration_in_previous_stage_ms / 86400000.0), 1)::NUMERIC as fastest_transition_days,
      ROUND(MAX(dsh.duration_in_previous_stage_ms / 86400000.0), 1)::NUMERIC as slowest_transition_days
     FROM deal_stage_history dsh
     JOIN deals d ON d.id = dsh.deal_id
     WHERE ${conditions.join(' AND ')}
       AND dsh.from_stage_normalized IS NOT NULL
       AND dsh.duration_in_previous_stage_ms IS NOT NULL
     GROUP BY d.owner, dsh.from_stage_normalized
     ORDER BY d.owner, avg_duration_days DESC`,
    params
  );

  return result.rows;
}

/**
 * Get deals that have been stuck in a stage longer than a threshold
 * Useful for Pipeline Hygiene alerts
 */
export async function getStalledDeals(
  workspaceId: string,
  stageNormalized: string,
  daysThreshold: number
): Promise<Array<{
  deal_id: string;
  deal_name: string;
  owner: string;
  amount: number;
  stage: string;
  days_in_stage: number;
  last_changed_at: Date;
}>> {
  const result = await query<{
    deal_id: string;
    deal_name: string;
    owner: string;
    amount: number;
    stage: string;
    days_in_stage: number;
    last_changed_at: Date;
  }>(
    `SELECT
      d.id as deal_id,
      d.name as deal_name,
      d.owner,
      d.amount,
      d.stage,
      EXTRACT(EPOCH FROM (NOW() - d.stage_changed_at)) / 86400 as days_in_stage,
      d.stage_changed_at as last_changed_at
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized = $2
       AND d.stage_changed_at IS NOT NULL
       AND EXTRACT(EPOCH FROM (NOW() - d.stage_changed_at)) / 86400 > $3
     ORDER BY days_in_stage DESC`,
    [workspaceId, stageNormalized, daysThreshold]
  );

  return result.rows;
}

/**
 * Get average time-in-stage for each normalized stage
 * Useful for benchmarking and identifying bottlenecks
 */
export async function getAverageTimeInStage(
  workspaceId: string
): Promise<Array<{
  stage_normalized: string;
  avg_duration_days: number;
  median_duration_days: number;
  deal_count: number;
  min_duration_days: number;
  max_duration_days: number;
}>> {
  const result = await query<{
    stage_normalized: string;
    avg_duration_days: number;
    median_duration_days: number;
    deal_count: number;
    min_duration_days: number;
    max_duration_days: number;
  }>(
    `SELECT
      from_stage_normalized as stage_normalized,
      ROUND(AVG(duration_in_previous_stage_ms / 86400000.0), 1)::NUMERIC as avg_duration_days,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_in_previous_stage_ms / 86400000.0), 1)::NUMERIC as median_duration_days,
      COUNT(*)::INTEGER as deal_count,
      ROUND(MIN(duration_in_previous_stage_ms / 86400000.0), 1)::NUMERIC as min_duration_days,
      ROUND(MAX(duration_in_previous_stage_ms / 86400000.0), 1)::NUMERIC as max_duration_days
     FROM deal_stage_history
     WHERE workspace_id = $1
       AND from_stage_normalized IS NOT NULL
       AND duration_in_previous_stage_ms IS NOT NULL
     GROUP BY from_stage_normalized
     ORDER BY avg_duration_days DESC`,
    [workspaceId]
  );

  return result.rows;
}
