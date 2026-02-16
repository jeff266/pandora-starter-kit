import { query } from '../db.js';

export async function cleanupExpiredAnnotations(): Promise<number> {
  const result = await query(
    `UPDATE workspace_annotations
     SET resolved_at = NOW()
     WHERE expires_at < NOW()
       AND resolved_at IS NULL
     RETURNING id`
  );
  const count = result.rowCount || 0;
  if (count > 0) {
    console.log(`[Annotation Cleanup] Expired ${count} annotations`);
  }
  return count;
}

export async function resolveClosedDealAnnotations(workspaceId: string, dealId: string): Promise<number> {
  const result = await query(
    `UPDATE workspace_annotations
     SET resolved_at = NOW()
     WHERE workspace_id = $1
       AND entity_type = 'deal'
       AND entity_id = $2
       AND resolved_at IS NULL
     RETURNING id`,
    [workspaceId, dealId]
  );
  const count = result.rowCount || 0;
  if (count > 0) {
    console.log(`[Annotation Cleanup] Resolved ${count} annotations for closed deal ${dealId}`);
  }
  return count;
}
