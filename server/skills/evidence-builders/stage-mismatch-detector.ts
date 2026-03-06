import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';
import { formatCurrency } from '../../utils/format-currency.js';

export async function buildStageMismatchEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  // Add parameter for confidence threshold
  eb.addParameter({
    name: 'confidence_threshold',
    display_name: 'Confidence Threshold',
    value: 60,
    description: 'Minimum confidence percentage to recommend stage updates',
    configurable: true,
  });

  // Add data sources (CRM + conversation platforms)
  const dataSources = await buildDataSources(workspaceId, [
    'hubspot',
    'salesforce',
    'gong',
    'fireflies',
  ]);
  for (const ds of dataSources) eb.addDataSource(ds);

  const mismatchData = stepResults.mismatch_data || {};
  const stageClassifications = stepResults.stage_classifications || [];
  const enrichedDeals = stepResults.enriched_deals || [];

  // Build map of enriched data by deal ID
  const enrichedMap = new Map<string, any>();
  if (Array.isArray(enrichedDeals)) {
    for (const deal of enrichedDeals) {
      enrichedMap.set(deal.id || deal.dealId || '', deal);
    }
  }

  // Process stage classifications
  const criticalMismatches: any[] = [];
  const warningMismatches: any[] = [];

  if (Array.isArray(stageClassifications)) {
    for (const classification of stageClassifications) {
      const dealId = classification.dealId || '';
      const enriched = enrichedMap.get(dealId) || {};
      const severity = classification.severity || 'info';

      if (severity === 'critical') criticalMismatches.push(classification);
      else if (severity === 'warning') warningMismatches.push(classification);

      // Add evaluated record
      eb.addRecord(
        dealToRecord(
          { id: dealId, name: classification.dealName || '', ...enriched },
          {
            deal_name: classification.dealName || '',
            current_stage: classification.current_stage || '',
            current_stage_normalized: classification.current_stage_normalized || '',
            recommended_stage: classification.recommended_stage_normalized || '',
            confidence: classification.confidence || 0,
            stage_age_days: enriched.stage_age_days || 0,
            conversation_count: enriched.conversation_count || 0,
            amount: enriched.amount || 0,
          },
          {
            severity: severity,
            primary_evidence: classification.primary_evidence_type || '',
            key_signals: (classification.key_signals || []).join(', '),
            reasoning: classification.reasoning || '',
            stakeholder_expansion: String(enriched.stakeholder_expansion || false),
            keywords_detected: (enriched.keywords_detected || []).join(', '),
          },
          severity as 'critical' | 'warning' | 'healthy'
        )
      );
    }
  }

  // Add claims
  if (criticalMismatches.length > 0) {
    eb.addClaim({
      claim_id: 'critical_stage_mismatches',
      claim_text: `${criticalMismatches.length} deals have critical stage mismatches (conversation signals indicate significant progression)`,
      entity_type: 'deal',
      entity_ids: criticalMismatches.map((c: any) => c.dealId || ''),
      metric_name: 'stage_mismatch_confidence',
      metric_values: criticalMismatches.map((c: any) => c.confidence || 0),
      threshold_applied: '≥60% confidence',
      severity: 'critical',
    });
  }

  if (warningMismatches.length > 0) {
    eb.addClaim({
      claim_id: 'warning_stage_mismatches',
      claim_text: `${warningMismatches.length} deals have moderate stage mismatches`,
      entity_type: 'deal',
      entity_ids: warningMismatches.map((c: any) => c.dealId || ''),
      metric_name: 'stage_mismatch_confidence',
      metric_values: warningMismatches.map((c: any) => c.confidence || 0),
      threshold_applied: '≥60% confidence',
      severity: 'warning',
    });
  }

  // Add summary claim if any mismatches found
  const totalMismatches = criticalMismatches.length + warningMismatches.length;
  if (totalMismatches > 0) {
    const totalValue = [...criticalMismatches, ...warningMismatches].reduce((sum, c) => {
      const enriched = enrichedMap.get(c.dealId || '');
      return sum + (enriched?.amount || 0);
    }, 0);

    eb.addClaim({
      claim_id: 'total_stage_mismatches',
      claim_text: `${totalMismatches} deals worth ${formatCurrency(totalValue)} have stage mismatches detected via conversation analysis`,
      entity_type: 'deal',
      entity_ids: stageClassifications.map((c: any) => c.dealId || ''),
      metric_name: 'total_mismatch_value',
      metric_values: [totalValue],
      threshold_applied: '≥60% confidence',
      severity: criticalMismatches.length > 0 ? 'critical' : 'warning',
    });
  }

  return eb.build();
}
