import { query } from '../db.js';

export interface PreviousRunResult {
  runId: string;
  completedAt: string;
  result: Record<string, any> | null;
  outputText: string | null;
  steps: Record<string, any> | null;
}

export async function getPreviousRun(
  workspaceId: string,
  skillId: string,
  currentRunId?: string
): Promise<PreviousRunResult | null> {
  const params: any[] = [workspaceId, skillId];
  let excludeClause = '';

  if (currentRunId) {
    excludeClause = ' AND run_id != $3';
    params.push(currentRunId);
  }

  const res = await query(
    `SELECT run_id, completed_at, result, output_text, steps
     FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id = $2
       AND status = 'completed'
       ${excludeClause}
     ORDER BY completed_at DESC
     LIMIT 1`,
    params
  );

  if (res.rows.length === 0) return null;

  const row = res.rows[0];
  return {
    runId: row.run_id,
    completedAt: row.completed_at?.toISOString?.() || String(row.completed_at),
    result: row.result,
    outputText: row.output_text,
    steps: row.steps,
  };
}

export function extractStepOutput(
  previousRun: PreviousRunResult,
  outputKey: string
): any | null {
  if (!previousRun.steps) return null;

  for (const step of Object.values(previousRun.steps) as any[]) {
    if (step?.outputKey === outputKey && step?.output !== undefined) {
      return step.output;
    }
  }

  if (previousRun.result && previousRun.result[outputKey] !== undefined) {
    return previousRun.result[outputKey];
  }

  return null;
}
