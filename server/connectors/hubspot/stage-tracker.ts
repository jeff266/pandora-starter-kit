/**
 * HubSpot Stage Tracker
 *
 * Detects and records deal stage changes during incremental sync.
 * This is the "going forward" tracking - catches changes as they happen.
 */

import { query } from '../../db.js';

export interface StageChange {
  dealId: string;          // our internal UUID
  dealSourceId: string;    // HubSpot deal ID
  workspaceId: string;
  fromStage: string | null;
  fromStageNormalized: string | null;
  toStage: string;
  toStageNormalized: string;
  changedAt: Date;
  durationMs: number | null;
}

export interface IncomingDeal {
  sourceId: string;
  stage: string;
  stage_normalized: string;
}

/**
 * Detect stage changes by comparing incoming deals to existing deals
 * MUST be called BEFORE the deal upsert to capture the previous stage
 */
export async function detectStageChanges(
  workspaceId: string,
  incomingDeals: IncomingDeal[]
): Promise<StageChange[]> {
  if (incomingDeals.length === 0) return [];

  // 1. Batch-fetch current stages for all incoming deals
  const sourceIds = incomingDeals.map(d => d.sourceId);
  const existingDeals = await query<{
    id: string;
    source_id: string;
    stage: string;
    stage_normalized: string;
    stage_changed_at: string | null;
  }>(
    `SELECT id, source_id, stage, stage_normalized, stage_changed_at
     FROM deals
     WHERE workspace_id = $1 AND source_id = ANY($2)`,
    [workspaceId, sourceIds]
  );

  // 2. Build lookup map
  const existingMap = new Map(existingDeals.rows.map(d => [d.source_id, d]));

  // 3. Compare and detect changes
  const changes: StageChange[] = [];
  const now = new Date();

  for (const incoming of incomingDeals) {
    const existing = existingMap.get(incoming.sourceId);
    if (!existing) continue; // New deal, no previous stage to compare

    // Check if stage actually changed
    if (existing.stage !== incoming.stage) {
      const durationMs = existing.stage_changed_at
        ? now.getTime() - new Date(existing.stage_changed_at).getTime()
        : null;

      changes.push({
        dealId: existing.id,
        dealSourceId: incoming.sourceId,
        workspaceId,
        fromStage: existing.stage,
        fromStageNormalized: existing.stage_normalized,
        toStage: incoming.stage,
        toStageNormalized: incoming.stage_normalized,
        changedAt: now,
        durationMs,
      });
    }
  }

  return changes;
}

/**
 * Record stage changes to database
 * Uses ON CONFLICT DO NOTHING for idempotency
 */
export async function recordStageChanges(
  changes: StageChange[],
  source: 'sync_detection' | 'hubspot_history' | 'salesforce_history' | 'manual' = 'sync_detection'
): Promise<number> {
  if (changes.length === 0) return 0;

  // Build parameterized batch insert
  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIndex = 1;

  for (const change of changes) {
    placeholders.push(
      `(gen_random_uuid(), $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, ` +
      `$${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, ` +
      `$${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
    );

    values.push(
      change.workspaceId,
      change.dealId,
      change.dealSourceId,
      change.fromStage,
      change.fromStageNormalized,
      change.toStage,
      change.toStageNormalized,
      change.changedAt,
      change.durationMs,
      source
    );
  }

  const result = await query(
    `INSERT INTO deal_stage_history
      (id, workspace_id, deal_id, deal_source_id, from_stage,
       from_stage_normalized, to_stage, to_stage_normalized,
       changed_at, duration_in_previous_stage_ms, source)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (deal_id, to_stage, changed_at) DO NOTHING`,
    values
  );

  return result.rowCount ?? 0;
}

/**
 * Update cached stage columns on deals table after recording changes
 * This allows the next sync to detect changes without querying stage_history
 */
export async function updateDealStageCache(changes: StageChange[]): Promise<void> {
  if (changes.length === 0) return;

  // Build batch update using CASE statement
  const dealIds = changes.map(c => c.dealId);
  const caseStatements = {
    previousStage: changes.map((c, i) => `WHEN '${c.dealId}' THEN '${c.fromStage}'`).join(' '),
    stageChangedAt: changes.map((c, i) => `WHEN '${c.dealId}' THEN '${c.changedAt.toISOString()}'`).join(' '),
  };

  await query(
    `UPDATE deals
     SET previous_stage = CASE id ${caseStatements.previousStage} END,
         stage_changed_at = CASE id ${caseStatements.stageChangedAt} END
     WHERE id = ANY($1)`,
    [dealIds]
  );
}
