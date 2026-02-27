import { query, getClient } from '../../db.js';
import { HubSpotClient } from './client.js';
import type { PropertyHistoryEntry } from './client.js';
import { normalizeStage } from './transform.js';

export interface BackfillResult {
  total: number;
  updated: number;
  errors: number;
  skipped: number;
  historyEntriesCreated: number;
}

/**
 * Backfill accurate stage_changed_at timestamps using HubSpot Property History API
 *
 * For each deal, fetches the dealstage property history and:
 * 1. Updates stage_changed_at to when the deal entered its current stage
 * 2. Stores complete stage progression in deal_stage_history table
 */
export async function backfillStageHistory(
  workspaceId: string,
  accessToken: string
): Promise<BackfillResult> {
  const hubspotClient = new HubSpotClient(accessToken, workspaceId);
  console.log(`[Stage History Backfill] Starting for workspace ${workspaceId}`);

  // Build a stageId → displayName map from stage_configs for this workspace
  // so numeric HubSpot stage IDs can be resolved to names before normalization
  const stageConfigsResult = await query<{ stage_id: string; stage_name: string }>(
    `SELECT stage_id, stage_name FROM stage_configs WHERE workspace_id = $1 AND stage_id IS NOT NULL`,
    [workspaceId]
  );
  const stageIdToName: Record<string, string> = {};
  for (const row of stageConfigsResult.rows) {
    stageIdToName[row.stage_id] = row.stage_name;
  }

  // Get all deals that need backfill
  const dealsResult = await query<{
    id: string;
    source_id: string;
    stage: string | null;
    stage_normalized: string | null;
    stage_changed_at: string | null;
    created_at: string | null;
  }>(
    `SELECT id, source_id, stage, stage_normalized, stage_changed_at, created_at
     FROM deals
     WHERE workspace_id = $1
       AND source = 'hubspot'
       AND (
         stage_changed_at IS NULL
         OR stage_changed_at = created_at
         OR stage_changed_at >= NOW() - INTERVAL '7 days'
       )`,
    [workspaceId]
  );

  const deals = dealsResult.rows;
  console.log(`[Stage History Backfill] Found ${deals.length} deals to backfill`);

  if (deals.length === 0) {
    return { total: 0, updated: 0, errors: 0, skipped: 0, historyEntriesCreated: 0 };
  }

  // Process in batches to respect HubSpot rate limits (100 calls/10 seconds)
  const BATCH_SIZE = 50;
  const BATCH_DELAY_MS = 1000; // 1 second between batches

  let updated = 0;
  let errors = 0;
  let skipped = 0;
  let historyEntriesCreated = 0;

  for (let i = 0; i < deals.length; i += BATCH_SIZE) {
    const batch = deals.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(deal => hubspotClient.getPropertyHistory('deals', deal.source_id, 'dealstage'))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const deal = batch[j];

      if (result.status === 'rejected') {
        console.error(`[Stage History Backfill] Failed to fetch history for deal ${deal.source_id}:`, result.reason);
        errors++;
        continue;
      }

      const history = result.value;

      if (history.length === 0) {
        // No history available
        skipped++;
        continue;
      }

      if (history.length === 1) {
        // Deal has been in same stage since creation
        // stage_changed_at = created_date is correct
        skipped++;
        continue;
      }

      // Most recent entry = current stage
      // Its timestamp = when the deal entered this stage
      const currentStageEntry = history[0];
      const enteredCurrentStage = new Date(currentStageEntry.timestamp);

      try {
        // Update the deal's stage_changed_at
        await query(
          `UPDATE deals SET
            stage_changed_at = $1,
            updated_at = NOW()
           WHERE id = $2`,
          [enteredCurrentStage, deal.id]
        );

        updated++;

        // Store complete stage history
        const entriesCreated = await storeStageHistory(workspaceId, deal.id, history, deal.stage_normalized, stageIdToName);
        historyEntriesCreated += entriesCreated;

      } catch (err) {
        console.error(`[Stage History Backfill] Failed to update deal ${deal.id}:`, err);
        errors++;
      }
    }

    // Rate limit pause between batches
    if (i + BATCH_SIZE < deals.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }

    console.log(`[Stage History Backfill] Processed ${Math.min(i + BATCH_SIZE, deals.length)}/${deals.length} deals`);
  }

  const result = {
    total: deals.length,
    updated,
    errors,
    skipped: deals.length - updated - errors,
    historyEntriesCreated,
  };

  console.log(`[Stage History Backfill] Complete:`, result);
  return result;
}

/**
 * Store complete stage progression in deal_stage_history table
 * History entries are in reverse chronological order (most recent first)
 */
async function storeStageHistory(
  workspaceId: string,
  dealId: string,
  history: PropertyHistoryEntry[],
  currentStageNormalized: string | null,
  stageIdToName: Record<string, string> = {}
): Promise<number> {
  if (history.length === 0) return 0;

  const client = await getClient();

  try {
    await client.query('BEGIN');

    let entriesCreated = 0;

    // Reverse the history to process chronologically (oldest first)
    const chronologicalHistory = [...history].reverse();

    for (let i = 0; i < chronologicalHistory.length; i++) {
      const entry = chronologicalHistory[i];
      const enteredAt = new Date(entry.timestamp);

      // Exit time is when the next stage started (or NULL if current stage)
      const isCurrentStage = i === chronologicalHistory.length - 1;
      const exitedAt = isCurrentStage ? null : new Date(chronologicalHistory[i + 1].timestamp);

      // Calculate duration in days
      let durationDays: number | null = null;
      if (exitedAt) {
        durationDays = (exitedAt.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24);
      }

      // Use current stage normalized for the latest entry, otherwise resolve via stageIdToName
      // then use the full normalizeStage from transform.ts so custom pipeline stages
      // (e.g. Fellowship "Closed-Won/Lost" variants) are classified correctly.
      let stageNormalized: string | null;
      if (isCurrentStage && currentStageNormalized) {
        stageNormalized = currentStageNormalized;
      } else {
        const displayName = stageIdToName[entry.value] || entry.value;
        stageNormalized = normalizeStage(displayName);
      }

      await client.query(
        `INSERT INTO deal_stage_history (
          workspace_id, deal_id, stage, stage_normalized,
          entered_at, exited_at, duration_days,
          source, source_user
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (deal_id, stage, entered_at) DO NOTHING`,
        [
          workspaceId,
          dealId,
          entry.value,
          stageNormalized,
          enteredAt,
          exitedAt,
          durationDays,
          'hubspot',
          entry.updatedByUserId || null,
        ]
      );

      entriesCreated++;
    }

    await client.query('COMMIT');
    return entriesCreated;

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[Stage History] Failed to store history for deal ${dealId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}


/**
 * Get backfill statistics for a workspace
 * Shows how many deals have accurate stage history
 */
export async function getBackfillStats(workspaceId: string): Promise<{
  totalDeals: number;
  dealsWithHistory: number;
  dealsNeedingBackfill: number;
  totalHistoryEntries: number;
  avgHistoryEntriesPerDeal: number;
}> {
  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1 AND source = 'hubspot'`,
    [workspaceId]
  );

  const withHistoryResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT deal_id) as count
     FROM deal_stage_history
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const needingBackfillResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM deals
     WHERE workspace_id = $1
       AND source = 'hubspot'
       AND (
         stage_changed_at IS NULL
         OR stage_changed_at = created_at
         OR stage_changed_at >= NOW() - INTERVAL '7 days'
       )`,
    [workspaceId]
  );

  const historyCountResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM deal_stage_history
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const totalDeals = parseInt(totalResult.rows[0]?.count || '0', 10);
  const dealsWithHistory = parseInt(withHistoryResult.rows[0]?.count || '0', 10);
  const dealsNeedingBackfill = parseInt(needingBackfillResult.rows[0]?.count || '0', 10);
  const totalHistoryEntries = parseInt(historyCountResult.rows[0]?.count || '0', 10);

  return {
    totalDeals,
    dealsWithHistory,
    dealsNeedingBackfill,
    totalHistoryEntries,
    avgHistoryEntriesPerDeal: dealsWithHistory > 0 ? totalHistoryEntries / dealsWithHistory : 0,
  };
}
