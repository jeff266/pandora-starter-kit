import { query, getClient } from '../../db.js';
import { HubSpotClient } from './client.js';
import type { PropertyHistoryEntry } from './client.js';

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
  hubspotClient: HubSpotClient,
  workspaceId: string
): Promise<BackfillResult> {
  console.log(\`[Stage History Backfill] Starting for workspace \${workspaceId}\`);

  // Get all deals that need backfill
  const dealsResult = await query<{
    id: string;
    source_id: string;
    stage: string | null;
    stage_normalized: string | null;
    stage_changed_at: string | null;
    created_date: string | null;
  }>(
    \`SELECT id, source_id, stage, stage_normalized, stage_changed_at, created_date
     FROM deals
     WHERE workspace_id = $1
       AND source = 'hubspot'
       AND (
         stage_changed_at IS NULL
         OR stage_changed_at = created_date
         OR stage_changed_at >= NOW() - INTERVAL '7 days'
       )\`,
    [workspaceId]
  );

  const deals = dealsResult.rows;
  console.log(\`[Stage History Backfill] Found \${deals.length} deals to backfill\`);

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
        console.error(\`[Stage History Backfill] Failed to fetch history for deal \${deal.source_id}:\`, result.reason);
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
          \`UPDATE deals SET
            stage_changed_at = $1,
            updated_at = NOW()
           WHERE id = $2\`,
          [enteredCurrentStage, deal.id]
        );

        updated++;

        // Store complete stage history
        const entriesCreated = await storeStageHistory(workspaceId, deal.id, history, deal.stage_normalized);
        historyEntriesCreated += entriesCreated;

      } catch (err) {
        console.error(\`[Stage History Backfill] Failed to update deal \${deal.id}:\`, err);
        errors++;
      }
    }

    // Rate limit pause between batches
    if (i + BATCH_SIZE < deals.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }

    console.log(\`[Stage History Backfill] Processed \${Math.min(i + BATCH_SIZE, deals.length)}/\${deals.length} deals\`);
  }

  const result = {
    total: deals.length,
    updated,
    errors,
    skipped: deals.length - updated - errors,
    historyEntriesCreated,
  };

  console.log(\`[Stage History Backfill] Complete:\`, result);
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
  currentStageNormalized: string | null
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

      // Use current stage normalized for the latest entry, otherwise try to normalize the stage value
      const stageNormalized = isCurrentStage && currentStageNormalized
        ? currentStageNormalized
        : normalizeStageValue(entry.value);

      await client.query(
        \`INSERT INTO deal_stage_history (
          workspace_id, deal_id, stage, stage_normalized,
          entered_at, exited_at, duration_days,
          source, source_user
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (deal_id, stage, entered_at) DO NOTHING\`,
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
    console.error(\`[Stage History] Failed to store history for deal \${dealId}:\`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Normalize HubSpot stage value to standard stage names
 * This is a simplified version - the full normalization is in transform.ts
 */
function normalizeStageValue(stage: string): string | null {
  if (!stage) return null;

  const normalized = stage.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Map common HubSpot stages to normalized values
  const stageMap: Record<string, string> = {
    'appointmentscheduled': 'qualification',
    'qualifiedtobuy': 'qualification',
    'presentationscheduled': 'evaluation',
    'decisionmakerboughtin': 'decision',
    'contractsent': 'negotiation',
    'closedwon': 'closed_won',
    'closedlost': 'closed_lost',
  };

  return stageMap[normalized] || 'qualification';
}
