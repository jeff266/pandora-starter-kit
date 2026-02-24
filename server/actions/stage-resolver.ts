/**
 * Stage Value Resolution
 *
 * CRM stage values are workspace-specific. Pandora uses normalized stages internally,
 * but CRM APIs need exact CRM stage values.
 *
 * Resolution chain (checked in order):
 * 1. connector_configs.metadata — pipeline stages captured during schema discovery
 * 2. deals table — find existing deals with this normalized stage, use their CRM stage
 * 3. Hardcoded fallbacks — common CRM stage values
 */

import { query } from '../db.js';

export async function resolveStageToCRM(
  workspaceId: string,
  connectorType: 'hubspot' | 'salesforce',
  normalizedStage: string
): Promise<{ crmValue: string; confidence: 'exact' | 'inferred' | 'fallback' }> {

  // Method 1: Schema discovery metadata
  // During initial sync, schema discovery captured pipeline stages
  // Check: connector_configs.metadata for pipeline_stages or stage_mapping
  const config = await query(
    `SELECT metadata FROM connector_configs
     WHERE workspace_id = $1 AND connector_type = $2 AND status = 'connected'`,
    [workspaceId, connectorType]
  );

  if (config.rows[0]?.metadata?.pipeline_stages) {
    // Look for a stage whose normalized form matches
    const stages = config.rows[0].metadata.pipeline_stages;
    const match = stages.find((s: any) =>
      normalize(s.label) === normalizedStage ||
      normalize(s.stageId || s.apiName || s.value) === normalizedStage
    );
    if (match) {
      return {
        crmValue: connectorType === 'hubspot' ? (match.stageId || match.value) : (match.apiName || match.label),
        confidence: 'exact'
      };
    }
  }

  // Method 2: Infer from existing deals
  const dealStages = await query(
    `SELECT stage, COUNT(*) as cnt FROM deals
     WHERE workspace_id = $1 AND source = $2 AND stage_normalized = $3
     GROUP BY stage ORDER BY cnt DESC LIMIT 1`,
    [workspaceId, connectorType, normalizedStage]
  );

  if (dealStages.rows[0]) {
    return { crmValue: dealStages.rows[0].stage, confidence: 'inferred' };
  }

  // Method 3: Hardcoded fallbacks
  const fallback = connectorType === 'hubspot'
    ? HUBSPOT_STAGE_FALLBACKS[normalizedStage]
    : SALESFORCE_STAGE_FALLBACKS[normalizedStage];

  if (fallback) {
    return { crmValue: fallback, confidence: 'fallback' };
  }

  // Last resort: return as-is
  return { crmValue: normalizedStage, confidence: 'fallback' };
}

function normalize(s: string): string {
  return s?.toLowerCase().replace(/[\s_-]+/g, '_').replace(/[^a-z0-9_]/g, '') || '';
}

const HUBSPOT_STAGE_FALLBACKS: Record<string, string> = {
  'closed_lost': 'closedlost',
  'closed_won': 'closedwon',
  'qualification': 'qualifiedtobuy',
  'discovery': 'appointmentscheduled',
  'proposal': 'presentationscheduled',
  'negotiation': 'contractsent',
  'decision': 'decisionmakerboughtin',
};

const SALESFORCE_STAGE_FALLBACKS: Record<string, string> = {
  'closed_lost': 'Closed Lost',
  'closed_won': 'Closed Won',
  'qualification': 'Qualification',
  'discovery': 'Discovery',
  'proposal': 'Proposal/Price Quote',
  'negotiation': 'Negotiation/Review',
  'decision': 'Perception Analysis',
};
