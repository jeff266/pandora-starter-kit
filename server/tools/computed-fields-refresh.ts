import { query, getClient } from '../db.js';
import { normalizeStage } from '../connectors/hubspot/transform.js';
import { getStageMapping } from '../config/index.js';

export async function refreshComputedFields(workspaceId: string): Promise<{
  stageNormalized: { updated: number; unchanged: number };
}> {
  const deals = await query<{ id: string; stage: string | null; stage_normalized: string | null }>(
    `SELECT id, stage, stage_normalized FROM deals WHERE workspace_id = $1`,
    [workspaceId]
  );

  // Load custom stage mapping for this workspace
  const customStageMapping = await getStageMapping(workspaceId);
  const customMappingCount = Object.keys(customStageMapping).length;
  if (customMappingCount > 0) {
    console.log(`[ComputedFields] Using ${customMappingCount} custom stage mappings`);
  }

  const client = await getClient();
  let updated = 0;
  let unchanged = 0;

  try {
    await client.query('BEGIN');

    for (const deal of deals.rows) {
      const newNormalized = normalizeStage(deal.stage, customStageMapping);
      if (newNormalized !== deal.stage_normalized) {
        await client.query(
          `UPDATE deals SET stage_normalized = $1, updated_at = NOW() WHERE id = $2 AND workspace_id = $3`,
          [newNormalized, deal.id, workspaceId]
        );
        updated++;
      } else {
        unchanged++;
      }
    }

    await client.query('COMMIT');
    console.log(`[ComputedFields] stage_normalized refresh: ${updated} updated, ${unchanged} unchanged for workspace ${workspaceId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ComputedFields] stage_normalized refresh failed:', err);
    throw err;
  } finally {
    client.release();
  }

  return { stageNormalized: { updated, unchanged } };
}
