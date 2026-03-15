import { query } from '../db.js';
import { computeBearingCalibration } from '../analysis/forecast-bearing-calibration.js';

/**
 * Refresh forecast bearing calibration for a single workspace.
 * Stores the result in context_layer.definitions->'bearing_calibration'.
 * Run Monday at 6:05 AM UTC — after monte-carlo (6:00), before forecast-rollup (8:00).
 */
export async function refreshBearingCalibration(workspaceId: string): Promise<void> {
  const calibration = await computeBearingCalibration(workspaceId);

  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(
       COALESCE(definitions, '{}'),
       '{bearing_calibration}',
       $2::jsonb
     ),
     updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(calibration)]
  );

  console.log(
    `[BearingCalibration] Refreshed for workspace ${workspaceId}: ` +
    `primaryBearing=${calibration.primaryBearing ?? 'none'}, ` +
    `methods with data=${calibration.calibrations.filter(c => c.weight !== 'unavailable').length}/7`
  );
}

/**
 * Refresh bearing calibration for all workspaces that have forecast_accuracy_log data.
 */
export async function refreshBearingCalibrationAllWorkspaces(): Promise<void> {
  const result = await query<{ workspace_id: string }>(
    `SELECT DISTINCT workspace_id FROM forecast_accuracy_log`
  );

  console.log(`[BearingCalibration] Refreshing ${result.rows.length} workspace(s)...`);

  for (const { workspace_id } of result.rows) {
    try {
      await refreshBearingCalibration(workspace_id);
    } catch (err: any) {
      console.error(
        `[BearingCalibration] Failed for workspace ${workspace_id}: ${err.message}`
      );
    }
  }

  console.log(`[BearingCalibration] Refresh complete`);
}
