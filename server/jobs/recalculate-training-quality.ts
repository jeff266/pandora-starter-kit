import { query } from '../db.js';

/**
 * Recalculates the quality label for all training pairs in a workspace based on updated thresholds or logic.
 * Logic per spec:
 * - good: edit_distance < 0.1 AND was_distributed = true
 * - needs_improvement: edit_distance < 0.4
 * - poor: edit_distance >= 0.4
 */
export async function recalculateTrainingPairQuality(workspaceId: string): Promise<void> {
  await query(
    `UPDATE document_training_pairs
     SET quality_label = CASE
       WHEN edit_distance < 0.1 AND was_distributed = TRUE THEN 'good'
       WHEN edit_distance < 0.4 THEN 'needs_improvement'
       ELSE 'poor'
     END
     WHERE workspace_id = $1`,
    [workspaceId]
  );
}

/**
 * Loops through all workspaces and recalculates training pair quality.
 */
export async function recalculateAllWorkspacesQuality(): Promise<void> {
  const result = await query<{ id: string }>('SELECT id FROM workspaces');
  for (const row of result.rows) {
    try {
      await recalculateTrainingPairQuality(row.id);
    } catch (err) {
      console.error(`[QualityRecalculator] Failed for workspace ${row.id}:`, err);
    }
  }
}
