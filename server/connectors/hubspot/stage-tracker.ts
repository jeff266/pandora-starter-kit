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
 * New schema: records stage residency (stage, entered_at, exited_at, duration_days)
 * For each change: close previous stage entry + insert new stage entry
 */
export async function recordStageChanges(
  changes: StageChange[],
  source: 'sync_detection' | 'hubspot_history' | 'salesforce_history' | 'manual' = 'sync_detection'
): Promise<number> {
  if (changes.length === 0) return 0;

  let recorded = 0;

  for (const change of changes) {
    const durationDays = change.durationMs != null
      ? Math.round((change.durationMs / (1000 * 60 * 60 * 24)) * 100) / 100
      : null;

    // Close the previous stage entry (set exited_at and duration)
    if (change.fromStage) {
      await query(
        `UPDATE deal_stage_history
         SET exited_at = $1, duration_days = $2
         WHERE workspace_id = $3 AND deal_id = $4
           AND stage = $5 AND exited_at IS NULL`,
        [change.changedAt.toISOString(), durationDays, change.workspaceId, change.dealId, change.fromStage]
      );
    }

    // Insert new stage entry
    const insertResult = await query(
      `INSERT INTO deal_stage_history
        (id, workspace_id, deal_id, stage, stage_normalized, entered_at, source, source_user)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [change.workspaceId, change.dealId, change.toStage, change.toStageNormalized,
       change.changedAt.toISOString(), source, null]
    );

    recorded += insertResult.rowCount ?? 0;
  }

  return recorded;
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
    stageChangedAt: changes.map((c, i) => `WHEN '${c.dealId}' THEN '${c.changedAt.toISOString()}'::timestamptz`).join(' '),
  };

  await query(
    `UPDATE deals
     SET previous_stage = CASE id ${caseStatements.previousStage} END,
         stage_changed_at = CASE id ${caseStatements.stageChangedAt} END
     WHERE id = ANY($1)`,
    [dealIds]
  );
}
