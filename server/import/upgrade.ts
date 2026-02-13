/**
 * File Import → Salesforce Upgrade Path
 *
 * Handles seamless transition when a workspace connects Salesforce
 * after initially using CSV/Excel file imports.
 *
 * Strategy:
 * 1. Match file-imported deals with Salesforce opportunities by external_id
 * 2. Update matched deals to source='salesforce', preserve historical data
 * 3. Keep unmatched deals as source='csv_import' (orphans)
 * 4. Transfer stage history from file import snapshots to Salesforce
 * 5. Track transition in workspace settings for audit trail
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { normalizeSalesforceId } from '../connectors/salesforce/transform.js';

const logger = createLogger('ImportUpgrade');

export interface UpgradeResult {
  fileImportedDeals: number;
  salesforceDeals: number;
  matchedByExternalId: number;
  unmatchedDeals: number;
  stageHistoryTransferred: number;
  transitionRecorded: boolean;
}

interface FileImportedDeal {
  id: string;
  source_id: string;
  name: string;
  stage: string | null;
  stage_normalized: string | null;
  created_at: Date;
}

interface SalesforceDeal {
  id: string;
  source_id: string;
  name: string;
}

/**
 * Main upgrade function: Transition file-imported deals to Salesforce source
 * Called automatically on first Salesforce sync
 */
export async function transitionToApiSync(workspaceId: string): Promise<UpgradeResult> {
  logger.info('[Upgrade] Starting file import → Salesforce transition', { workspaceId });

  // Check if workspace has file-imported deals
  const fileDeals = await detectFileImportedDeals(workspaceId);

  if (fileDeals.length === 0) {
    logger.info('[Upgrade] No file-imported deals found, skipping transition', { workspaceId });
    return {
      fileImportedDeals: 0,
      salesforceDeals: 0,
      matchedByExternalId: 0,
      unmatchedDeals: 0,
      stageHistoryTransferred: 0,
      transitionRecorded: false,
    };
  }

  // Get newly synced Salesforce deals
  const salesforceDeals = await getSalesforceDeals(workspaceId);

  logger.info('[Upgrade] Found deals to process', {
    fileImportedDeals: fileDeals.length,
    salesforceDeals: salesforceDeals.length,
  });

  // Match by external_id (source_id)
  const matches = matchDealsByExternalId(fileDeals, salesforceDeals);

  logger.info('[Upgrade] Matching complete', {
    matched: matches.length,
    unmatched: fileDeals.length - matches.length,
  });

  // Update matched deals to Salesforce source
  let updatedCount = 0;
  for (const match of matches) {
    await updateDealSource(
      match.fileImportedDeal.id,
      match.salesforceDeal.id,
      match.salesforceDeal.source_id
    );
    updatedCount++;
  }

  // Transfer stage history from file import snapshots
  const stageHistoryTransferred = await transferStageHistory(workspaceId, matches);

  // Record transition in workspace settings
  await recordTransition(workspaceId, {
    transitionedAt: new Date().toISOString(),
    fileImportedDeals: fileDeals.length,
    matchedDeals: matches.length,
    unmatchedDeals: fileDeals.length - matches.length,
  });

  const result: UpgradeResult = {
    fileImportedDeals: fileDeals.length,
    salesforceDeals: salesforceDeals.length,
    matchedByExternalId: matches.length,
    unmatchedDeals: fileDeals.length - matches.length,
    stageHistoryTransferred,
    transitionRecorded: true,
  };

  logger.info('[Upgrade] Transition complete', result);

  return result;
}

/**
 * Detect if workspace has file-imported deals
 */
async function detectFileImportedDeals(workspaceId: string): Promise<FileImportedDeal[]> {
  const result = await query<FileImportedDeal>(
    `SELECT id, source_id, name, stage, stage_normalized, created_at
     FROM deals
     WHERE workspace_id = $1 AND source = 'csv_import'
     ORDER BY created_at ASC`,
    [workspaceId]
  );

  return result.rows;
}

/**
 * Get newly synced Salesforce deals
 */
async function getSalesforceDeals(workspaceId: string): Promise<SalesforceDeal[]> {
  const result = await query<SalesforceDeal>(
    `SELECT id, source_id, name
     FROM deals
     WHERE workspace_id = $1 AND source = 'salesforce'
     ORDER BY created_at ASC`,
    [workspaceId]
  );

  return result.rows;
}

/**
 * Match file-imported deals with Salesforce deals by external_id (source_id)
 *
 * CRITICAL: Salesforce IDs come in 15-char (CSV exports) and 18-char (API) formats.
 * The first 15 characters are identical. We normalize to 15 chars for comparison
 * to avoid false negatives where CSV IDs don't match API IDs.
 */
function matchDealsByExternalId(
  fileDeals: FileImportedDeal[],
  salesforceDeals: SalesforceDeal[]
): Array<{
  fileImportedDeal: FileImportedDeal;
  salesforceDeal: SalesforceDeal;
}> {
  const matches: Array<{
    fileImportedDeal: FileImportedDeal;
    salesforceDeal: SalesforceDeal;
  }> = [];

  // Build map of Salesforce deals by NORMALIZED source_id for fast lookup
  // Key = normalized 15-char ID, Value = deal with full 18-char ID
  const salesforceMap = new Map<string, SalesforceDeal>();
  for (const sfDeal of salesforceDeals) {
    const normalizedId = normalizeSalesforceId(sfDeal.source_id);
    if (normalizedId) {
      salesforceMap.set(normalizedId, sfDeal);
    }
  }

  // Match file deals to Salesforce deals using normalized IDs
  for (const fileDeal of fileDeals) {
    if (!fileDeal.source_id) {
      // File deal has no external_id, cannot match
      continue;
    }

    // Normalize the file deal's source_id (could be 15 or 18 chars from CSV)
    const normalizedFileId = normalizeSalesforceId(fileDeal.source_id);
    if (!normalizedFileId) continue;

    const sfDeal = salesforceMap.get(normalizedFileId);
    if (sfDeal) {
      matches.push({
        fileImportedDeal: fileDeal,
        salesforceDeal: sfDeal,
      });

      logger.debug('[Upgrade] Matched deal by normalized ID', {
        fileDealId: fileDeal.source_id,
        salesforceId: sfDeal.source_id,
        normalizedId: normalizedFileId,
        dealName: fileDeal.name,
      });
    }
  }

  return matches;
}

/**
 * Update deal to use Salesforce as source
 * Merges the Salesforce deal into the file-imported deal to preserve historical data
 */
async function updateDealSource(
  fileImportedDealId: string,
  salesforceDealId: string,
  salesforceSourceId: string
): Promise<void> {
  // Strategy: Merge Salesforce deal into file-imported deal, then delete Salesforce deal
  // This preserves all historical data (stage history, activities, contacts) from file import
  // while updating to use Salesforce as the authoritative source

  // Step 1: Re-link any activities from Salesforce deal to file-imported deal
  await query(
    `UPDATE activities
     SET deal_id = $1, updated_at = NOW()
     WHERE deal_id = $2`,
    [fileImportedDealId, salesforceDealId]
  );

  // Step 2: Re-link any deal_contacts from Salesforce deal to file-imported deal
  // Use ON CONFLICT DO NOTHING to avoid duplicates if same contact linked to both deals
  await query(
    `INSERT INTO deal_contacts (deal_id, contact_id, role, is_primary, created_at, updated_at)
     SELECT $1, contact_id, role, is_primary, created_at, NOW()
     FROM deal_contacts
     WHERE deal_id = $2
     ON CONFLICT (deal_id, contact_id) DO NOTHING`,
    [fileImportedDealId, salesforceDealId]
  );

  // Step 3: Delete old deal_contacts for Salesforce deal
  await query(
    `DELETE FROM deal_contacts WHERE deal_id = $1`,
    [salesforceDealId]
  );

  // Step 4: Merge Salesforce deal data into file-imported deal
  // Use Salesforce source_data and source_id, but keep file import's historical timestamps
  // IMPORTANT: Store the full 18-character Salesforce ID as canonical source_id
  // (The API returns 18-char, CSV exports may have had 15-char, we want the canonical version)
  await query(
    `UPDATE deals
     SET source = 'salesforce',
         source_id = $2,
         source_data = COALESCE(
           (SELECT source_data FROM deals WHERE id = $3),
           source_data
         ),
         updated_at = NOW()
     WHERE id = $1`,
    [fileImportedDealId, salesforceSourceId, salesforceDealId]
  );

  // Step 5: Delete the duplicate Salesforce deal
  await query(
    `DELETE FROM deals WHERE id = $1`,
    [salesforceDealId]
  );

  logger.debug('[Upgrade] Merged Salesforce deal into file-imported deal', {
    fileImportedDealId,
    salesforceDealId,
    salesforceSourceId,
  });
}

/**
 * Transfer stage history from file import snapshots to deal_stage_history
 * This ensures historical stage transitions are preserved after upgrade
 */
async function transferStageHistory(
  workspaceId: string,
  matches: Array<{
    fileImportedDeal: FileImportedDeal;
    salesforceDeal: SalesforceDeal;
  }>
): Promise<number> {
  if (matches.length === 0) {
    return 0;
  }

  // For each matched deal, check if it has stage history from file imports
  // File import stage history has source = 'file_import_diff' or 'file_import_new'
  let transferred = 0;

  for (const match of matches) {
    // Check if this deal has file import stage history
    const historyResult = await query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM deal_stage_history
       WHERE deal_id = $1 AND source IN ('file_import_diff', 'file_import_new')`,
      [match.fileImportedDeal.id]
    );

    const historyCount = Number(historyResult.rows[0]?.count || 0);
    if (historyCount > 0) {
      // Update the source to indicate it came from file import, now migrated to Salesforce
      // This preserves the history but marks it as pre-Salesforce data
      await query(
        `UPDATE deal_stage_history
         SET source = 'file_import_migrated'
         WHERE deal_id = $1 AND source IN ('file_import_diff', 'file_import_new')`,
        [match.fileImportedDeal.id]
      );

      transferred += historyCount;

      logger.debug('[Upgrade] Transferred stage history', {
        dealId: match.fileImportedDeal.id,
        dealName: match.fileImportedDeal.name,
        historyCount,
      });
    }
  }

  logger.info('[Upgrade] Stage history transfer complete', { transferred });

  return transferred;
}

/**
 * Record the transition in workspace settings for audit trail
 */
async function recordTransition(
  workspaceId: string,
  transitionInfo: {
    transitionedAt: string;
    fileImportedDeals: number;
    matchedDeals: number;
    unmatchedDeals: number;
  }
): Promise<void> {
  await query(
    `UPDATE workspaces
     SET settings = jsonb_set(
       COALESCE(settings, '{}'::jsonb),
       '{data_source_history}',
       $2::jsonb,
       true
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [
      workspaceId,
      JSON.stringify({
        csv_to_salesforce_transition: transitionInfo,
      }),
    ]
  );

  logger.info('[Upgrade] Recorded transition in workspace settings', {
    workspaceId,
    transitionInfo,
  });
}

/**
 * Check if workspace has already undergone transition
 */
export async function hasTransitioned(workspaceId: string): Promise<boolean> {
  const result = await query<{ settings: any }>(
    `SELECT settings FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const settings = result.rows[0].settings || {};
  return !!settings.data_source_history?.csv_to_salesforce_transition;
}

/**
 * Get transition status for a workspace
 * Returns null if workspace has not transitioned
 */
export async function getTransitionStatus(workspaceId: string): Promise<{
  transitionedAt: string;
  fileImportedDeals: number;
  matchedDeals: number;
  unmatchedDeals: number;
} | null> {
  const result = await query<{ settings: any }>(
    `SELECT settings FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const settings = result.rows[0].settings || {};
  return settings.data_source_history?.csv_to_salesforce_transition || null;
}

/**
 * Get orphaned deals (file-imported deals that didn't match any Salesforce opportunity)
 * These deals remain as source='csv_import' after upgrade
 */
export async function getOrphanedDeals(workspaceId: string): Promise<Array<{
  id: string;
  source_id: string;
  name: string;
  stage: string | null;
  amount: number | null;
  owner: string | null;
}>> {
  const result = await query<{
    id: string;
    source_id: string;
    name: string;
    stage: string | null;
    amount: number | null;
    owner: string | null;
  }>(
    `SELECT id, source_id, name, stage, amount, owner
     FROM deals
     WHERE workspace_id = $1 AND source = 'csv_import'
     ORDER BY created_at DESC`,
    [workspaceId]
  );

  return result.rows;
}
