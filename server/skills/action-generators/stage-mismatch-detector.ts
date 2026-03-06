/**
 * Stage Mismatch Action Generator
 *
 * Generates update_stage actions from stage classification results.
 * Can be called programmatically or used to supplement <actions> block parsing.
 */

import type { Pool } from 'pg';
import type { ExtractedAction } from '../../actions/extractor.js';

export async function generateStageMismatchActions(
  stepResults: Record<string, any>,
  workspaceId: string,
  businessContext: Record<string, any>
): Promise<ExtractedAction[]> {
  const stageClassifications = stepResults.stage_classifications || [];
  const enrichedDeals = stepResults.enriched_deals || [];
  const mismatchData = stepResults.mismatch_data || {};

  if (!Array.isArray(stageClassifications) || stageClassifications.length === 0) {
    return [];
  }

  // Build enriched data map
  const enrichedMap = new Map<string, any>();
  if (Array.isArray(enrichedDeals)) {
    for (const deal of enrichedDeals) {
      enrichedMap.set(deal.id || deal.dealId || '', deal);
    }
  }

  const actions: ExtractedAction[] = [];

  for (const classification of stageClassifications) {
    const dealId = classification.dealId || '';
    const enriched = enrichedMap.get(dealId) || {};
    const confidence = classification.confidence || 0;
    const severity = classification.severity || 'info';

    // Only create actions for deals with sufficient confidence
    if (confidence < 60) continue;

    // Build action title
    const title = `Update stage: ${classification.dealName || 'Unknown Deal'}`;

    // Build summary with reasoning
    const summary = classification.reasoning ||
      `Conversation signals indicate this deal should move from ${classification.current_stage_normalized} to ${classification.recommended_stage_normalized}.`;

    // Build recommended steps
    const recommendedSteps = [
      `Review recent conversations for ${classification.dealName}`,
      `Verify with deal owner (${enriched.owner || 'unknown'})`,
      `Update CRM stage to ${classification.recommended_stage_normalized}`,
    ];

    // Build execution payload with stage update information
    const executionPayload = {
      crm_updates: [
        {
          field: 'stage',
          proposed_value: classification.recommended_stage_normalized,
          current_value: classification.current_stage_normalized,
          confidence: confidence,
        },
      ],
      evidence: {
        confidence: confidence,
        primary_evidence_type: classification.primary_evidence_type || 'conversation_keywords',
        key_signals: classification.key_signals || [],
        conversation_count: enriched.conversation_count || 0,
        keywords_detected: enriched.keywords_detected || [],
        stakeholder_expansion: enriched.stakeholder_expansion || false,
        from_stage: classification.current_stage,
        to_stage: classification.recommended_stage_normalized,
      },
      note_text: `Pandora detected conversation signals suggesting stage advancement. Key signals: ${(classification.key_signals || []).join(', ')}`,
    };

    actions.push({
      action_type: 'update_stage',
      severity: severity as 'critical' | 'warning' | 'info',
      title,
      summary,
      recommended_steps: recommendedSteps,
      target_deal_id: dealId,
      target_deal_name: classification.dealName || 'Unknown Deal',
      owner_email: enriched.owner || null,
      impact_amount: enriched.amount || null,
      urgency_label: severity === 'critical' ? 'High' : severity === 'warning' ? 'Medium' : 'Low',
      urgency_days_stale: enriched.stage_age_days || null,
      execution_payload: executionPayload as any,
    });
  }

  return actions;
}

/**
 * Insert stage mismatch actions into the actions table
 */
export async function insertStageMismatchActions(
  db: Pool,
  workspaceId: string,
  skillRunId: string,
  stepResults: Record<string, any>,
  businessContext: Record<string, any>
): Promise<number> {
  const actions = await generateStageMismatchActions(stepResults, workspaceId, businessContext);

  if (actions.length === 0) {
    return 0;
  }

  const { insertExtractedActions } = await import('../../actions/extractor.js');

  return insertExtractedActions(
    db,
    workspaceId,
    'stage-mismatch-detector',
    skillRunId,
    null,
    actions
  );
}
