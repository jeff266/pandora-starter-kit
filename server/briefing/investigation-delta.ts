/**
 * Investigation Delta Comparison
 *
 * Compare current investigation results with previous runs to detect changes
 */

import { query } from '../db.js';

export interface InvestigationDelta {
  skillId: string;
  previousRunId: string | null;
  previousCompletedAt: string | null;
  currentFindings: number;
  previousFindings: number;
  deltaFindings: number;  // Positive = more findings than before
  deltaSeverity: 'improved' | 'worsened' | 'unchanged';
  newHighRiskDeals: Array<{ name: string; amount: number }>;
  improvedDeals: Array<{ name: string; amount: number }>;
}

/**
 * Get the previous completed run for a skill (most recent before current run)
 */
async function getPreviousRun(
  workspaceId: string,
  skillId: string,
  beforeTimestamp: string
): Promise<{ runId: string; completedAt: string; output: any } | null> {
  const result = await query<{ run_id: string; completed_at: string; output: any }>(
    `SELECT run_id, completed_at, output
     FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id = $2
       AND status = 'completed'
       AND completed_at < $3
     ORDER BY completed_at DESC
     LIMIT 1`,
    [workspaceId, skillId, beforeTimestamp]
  );

  if (result.rows.length === 0) return null;

  return {
    runId: result.rows[0].run_id,
    completedAt: result.rows[0].completed_at,
    output: result.rows[0].output,
  };
}

/**
 * Compare current investigation results with previous run
 */
export async function compareInvestigationRuns(
  workspaceId: string,
  skillId: string,
  currentOutput: any
): Promise<InvestigationDelta> {
  const currentRun = await query<{ completed_at: string }>(
    `SELECT completed_at FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
     ORDER BY completed_at DESC LIMIT 1`,
    [workspaceId, skillId]
  );

  const previousRun = currentRun.rows[0]
    ? await getPreviousRun(workspaceId, skillId, currentRun.rows[0].completed_at)
    : null;

  // Extract findings counts
  const currentFindings = currentOutput?.evidence?.evaluated_records?.length || 0;
  const previousFindings = previousRun?.output?.evidence?.evaluated_records?.length || 0;
  const deltaFindings = currentFindings - previousFindings;

  // Determine severity change
  let deltaSeverity: 'improved' | 'worsened' | 'unchanged' = 'unchanged';
  if (deltaFindings > 0) deltaSeverity = 'worsened';
  else if (deltaFindings < 0) deltaSeverity = 'improved';

  // Identify new high-risk deals
  const currentHighRisk = (currentOutput?.evidence?.evaluated_records || [])
    .filter((d: any) => d.risk_score === 'high' || d.risk_level === 'high')
    .map((d: any) => ({ name: d.deal_name || d.name, amount: d.amount || 0 }));

  const previousHighRisk = (previousRun?.output?.evidence?.evaluated_records || [])
    .filter((d: any) => d.risk_score === 'high' || d.risk_level === 'high')
    .map((d: any) => ({ name: d.deal_name || d.name, amount: d.amount || 0 }));

  const newHighRiskDeals = currentHighRisk.filter(
    (d: any) => !previousHighRisk.find((p: any) => p.name === d.name)
  );

  const improvedDeals = previousHighRisk.filter(
    (p: any) => !currentHighRisk.find((d: any) => d.name === p.name)
  );

  return {
    skillId,
    previousRunId: previousRun?.runId || null,
    previousCompletedAt: previousRun?.completedAt || null,
    currentFindings,
    previousFindings,
    deltaFindings,
    deltaSeverity,
    newHighRiskDeals: newHighRiskDeals.slice(0, 5),
    improvedDeals: improvedDeals.slice(0, 5),
  };
}

/**
 * Get all deltas for display in greeting
 */
export async function getInvestigationDeltas(
  workspaceId: string
): Promise<InvestigationDelta[]> {
  const skillIds = ['deal-risk-review', 'data-quality-audit', 'forecast-rollup'];
  const deltas: InvestigationDelta[] = [];

  for (const skillId of skillIds) {
    const latestRun = await query<{ output: any }>(
      `SELECT output FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1`,
      [workspaceId, skillId]
    );

    if (latestRun.rows[0]) {
      const delta = await compareInvestigationRuns(
        workspaceId,
        skillId,
        latestRun.rows[0].output
      );
      deltas.push(delta);
    }
  }

  return deltas.filter(d => d.previousRunId !== null);  // Only return if we have comparison
}
