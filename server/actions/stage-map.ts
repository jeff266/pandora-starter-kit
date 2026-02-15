/**
 * Stage Name Mapping Resolver
 *
 * Resolves Pandora stage names to CRM-specific stage values.
 * Example: 'closed_lost' → 'closedlost' (HubSpot) or 'Closed Lost' (Salesforce)
 */

import type { Pool } from 'pg';

/**
 * Resolve Pandora stage name to CRM-specific stage value.
 * Uses workspace's existing stage mapping from connector sync or infers from deals table.
 *
 * @param db - Database pool
 * @param workspaceId - Workspace ID
 * @param pandoraStage - Pandora's normalized stage name (e.g., 'closed_lost')
 * @param crmSource - CRM source ('hubspot' or 'salesforce')
 * @returns CRM-specific stage value
 */
export async function resolveCRMStageName(
  db: Pool,
  workspaceId: string,
  pandoraStage: string,
  crmSource?: string
): Promise<string> {
  // First, check if there's a stage mapping in the workspace connector config
  // (this was likely built during connector setup)
  const mappingResult = await db.query(`
    SELECT stage_mapping FROM connections
    WHERE workspace_id = $1 AND status = 'connected' AND connector_name = $2
    LIMIT 1
  `, [workspaceId, crmSource || 'hubspot']);

  const mapping = mappingResult.rows[0]?.stage_mapping;

  if (mapping && typeof mapping === 'object') {
    // mapping is a JSONB like: { "closed_lost": "Closed Lost", "closed_won": "Closed Won", ... }
    const resolved = mapping[pandoraStage];
    if (resolved) return resolved;
  }

  // Fallback: check deals table for actual stage values used
  // Find a stage value where normalized version matches pandoraStage
  const stageResult = await db.query(`
    SELECT DISTINCT stage FROM deals
    WHERE workspace_id = $1
      AND (
        LOWER(REPLACE(REPLACE(stage, ' ', '_'), '-', '_')) = $2
        OR stage_normalized = $2
      )
    LIMIT 1
  `, [workspaceId, pandoraStage]);

  if (stageResult.rows.length > 0) {
    return stageResult.rows[0].stage;
  }

  // Last resort: apply common CRM patterns
  // HubSpot: lowercase, no spaces (e.g., closedlost)
  // Salesforce: Title Case with spaces (e.g., Closed Lost)
  if (crmSource === 'hubspot') {
    return pandoraStage.replace(/_/g, '');
  } else if (crmSource === 'salesforce') {
    return pandoraStage
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  console.warn(`[Stage Map] No mapping found for "${pandoraStage}" in workspace ${workspaceId}, returning as-is`);
  return pandoraStage;
}

/**
 * Batch resolve multiple stage names
 */
export async function resolveMultipleCRMStageNames(
  db: Pool,
  workspaceId: string,
  pandoraStages: string[],
  crmSource?: string
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};

  for (const stage of pandoraStages) {
    resolved[stage] = await resolveCRMStageName(db, workspaceId, stage, crmSource);
  }

  return resolved;
}
