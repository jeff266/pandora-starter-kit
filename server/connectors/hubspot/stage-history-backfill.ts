/**
 * HubSpot Stage History Backfill
 *
 * Pulls historical stage changes from HubSpot Property History API
 * for deals that haven't been backfilled yet.
 */

import { query } from '../../db.js';
import { hubspotFetch } from '../../utils/throttle.js';
import { recordStageChanges, type StageChange } from './stage-tracker.js';

interface DealToBackfill {
  id: string;
  source_id: string;
  workspace_id: string;
}

interface HubSpotPropertyHistoryEntry {
  value: string;
  timestamp: string;
  sourceType?: string;
  sourceId?: string;
}

interface BackfillResult {
  dealsProcessed: number;
  transitionsRecorded: number;
  errors: string[];
}

/**
 * Find the stage normalization function from transform.ts
 * This should be imported/reused from the transform logic
 */
function normalizeStage(stageValue: string): string {
  const normalized = stageValue.toLowerCase().trim();

  // Map common HubSpot stages to normalized categories
  if (normalized.includes('closed') && normalized.includes('won')) return 'closed_won';
  if (normalized.includes('closed') && normalized.includes('lost')) return 'closed_lost';
  if (normalized.includes('contract') || normalized.includes('negotiation')) return 'negotiation';
  if (normalized.includes('proposal') || normalized.includes('quote')) return 'proposal';
  if (normalized.includes('demo') || normalized.includes('presentation')) return 'demo';
  if (normalized.includes('qualified') || normalized.includes('discovery')) return 'qualification';
  if (normalized.includes('appointment') || normalized.includes('meeting')) return 'qualification';

  // Default fallback
  return 'pipeline';
}

/**
 * Backfill stage history for all deals in a workspace that haven't been backfilled
 */
export async function backfillStageHistory(
  workspaceId: string,
  accessToken: string
): Promise<BackfillResult> {
  // Find deals that haven't been backfilled yet
  // A deal is "not backfilled" if it has zero rows with source = 'hubspot_history'
  const unbackfilled = await query<DealToBackfill>(
    `SELECT d.id, d.source_id, d.workspace_id
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.source = 'hubspot'
       AND NOT EXISTS (
         SELECT 1 FROM deal_stage_history dsh
         WHERE dsh.deal_id = d.id AND dsh.source = 'hubspot_history'
       )
     ORDER BY d.created_at DESC`,
    [workspaceId]
  );

  if (unbackfilled.rows.length === 0) {
    console.log(`[Stage Backfill] No deals to backfill for workspace ${workspaceId}`);
    return { dealsProcessed: 0, transitionsRecorded: 0, errors: [] };
  }

  console.log(`[Stage Backfill] Processing ${unbackfilled.rows.length} deals for workspace ${workspaceId}`);

  let totalTransitions = 0;
  const errors: string[] = [];

  // Process in batches to stay within rate limits
  const batchSize = 10;
  for (let i = 0; i < unbackfilled.rows.length; i += batchSize) {
    const batch = unbackfilled.rows.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(deal => fetchAndRecordDealStageHistory(deal, accessToken))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        totalTransitions += result.value;
      } else {
        errors.push(result.reason?.message || 'Unknown error');
      }
    }

    // Progress logging every 50 deals
    if ((i + batchSize) % 50 === 0 || i + batchSize >= unbackfilled.rows.length) {
      const processed = Math.min(i + batchSize, unbackfilled.rows.length);
      console.log(`[Stage Backfill] Progress: ${processed}/${unbackfilled.rows.length} deals`);
    }
  }

  console.log(`[Stage Backfill] Complete: ${unbackfilled.rows.length} deals, ${totalTransitions} transitions, ${errors.length} errors`);

  return {
    dealsProcessed: unbackfilled.rows.length,
    transitionsRecorded: totalTransitions,
    errors: errors.slice(0, 10), // Limit error array size
  };
}

/**
 * Fetch stage history for a single deal from HubSpot and record it
 */
async function fetchAndRecordDealStageHistory(
  deal: DealToBackfill,
  accessToken: string
): Promise<number> {
  try {
    // Fetch property history from HubSpot
    const response = await hubspotFetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${deal.source_id}?propertiesWithHistory=dealstage`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HubSpot API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const history: HubSpotPropertyHistoryEntry[] = data.propertiesWithHistory?.dealstage;

    if (!history || history.length === 0) {
      return 0; // No history available
    }

    // Sort chronologically (API returns reverse-chronological)
    const sorted = [...history].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Build transitions
    const transitions: StageChange[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      const prevEntry = i > 0 ? sorted[i - 1] : null;

      // Skip if stage didn't actually change (HubSpot records property updates even if value is same)
      if (prevEntry && prevEntry.value === entry.value) continue;

      const durationMs = prevEntry
        ? new Date(entry.timestamp).getTime() - new Date(prevEntry.timestamp).getTime()
        : null;

      transitions.push({
        dealId: deal.id,
        dealSourceId: deal.source_id,
        workspaceId: deal.workspace_id,
        fromStage: prevEntry?.value ?? null,
        fromStageNormalized: prevEntry ? normalizeStage(prevEntry.value) : null,
        toStage: entry.value,
        toStageNormalized: normalizeStage(entry.value),
        changedAt: new Date(entry.timestamp),
        durationMs,
      });
    }

    // Record to database with source = 'hubspot_history'
    if (transitions.length > 0) {
      await recordStageChanges(transitions, 'hubspot_history');
    }

    return transitions.length;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Stage Backfill] Failed to backfill deal ${deal.source_id}:`, errorMsg);
    throw new Error(`Deal ${deal.source_id}: ${errorMsg}`);
  }
}

/**
 * Get backfill statistics for a workspace
 */
export async function getBackfillStats(workspaceId: string): Promise<{
  totalTransitions: number;
  dealsWithHistory: number;
  dealsWithoutHistory: number;
  oldestTransition: string | null;
  newestTransition: string | null;
  sourceBreakdown: Record<string, number>;
}> {
  const stats = await query(
    `SELECT
      COUNT(*) as total_transitions,
      COUNT(DISTINCT deal_id) as deals_with_history,
      MIN(changed_at) as oldest_transition,
      MAX(changed_at) as newest_transition
     FROM deal_stage_history
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const sourceStats = await query(
    `SELECT source, COUNT(*) as count
     FROM deal_stage_history
     WHERE workspace_id = $1
     GROUP BY source`,
    [workspaceId]
  );

  const totalDeals = await query(
    `SELECT COUNT(*) as total
     FROM deals
     WHERE workspace_id = $1 AND source = 'hubspot'`,
    [workspaceId]
  );

  const sourceBreakdown: Record<string, number> = {};
  for (const row of sourceStats.rows) {
    sourceBreakdown[row.source] = Number(row.count);
  }

  return {
    totalTransitions: Number(stats.rows[0]?.total_transitions || 0),
    dealsWithHistory: Number(stats.rows[0]?.deals_with_history || 0),
    dealsWithoutHistory: Number(totalDeals.rows[0]?.total || 0) - Number(stats.rows[0]?.deals_with_history || 0),
    oldestTransition: stats.rows[0]?.oldest_transition || null,
    newestTransition: stats.rows[0]?.newest_transition || null,
    sourceBreakdown,
  };
}
