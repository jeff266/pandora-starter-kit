import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources } from '../evidence-builder.js';

export async function buildCustomFieldDiscoveryEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const discoveryResult = stepResults.discovery_result || {};
  const topFields = discoveryResult.topFields || [];
  const allFields = discoveryResult.discoveredFields || [];

  for (const field of allFields) {
    const isTop = topFields.some((t: any) => t.fieldKey === field.fieldKey);
    const severity: 'critical' | 'warning' | 'healthy' = isTop ? 'healthy' : 'healthy';

    eb.addRecord({
      entity_id: field.fieldKey || '',
      entity_type: 'deal' as any,
      entity_name: field.fieldKey || '',
      owner_email: null,
      owner_name: null,
      fields: {
        field_key: field.fieldKey || '',
        field_label: field.classification?.label || field.fieldKey || '',
        entity_type: field.entityType || 'deal',
        fill_rate: field.fillRate || field.overallFillRate || 0,
        unique_values: field.cardinality || 0,
        icp_relevant: isTop,
        scoring_weight: field.icpRelevanceScore || 0,
      },
      flags: {},
      severity,
    });
  }

  if (topFields.length > 0) {
    eb.addClaim({
      claim_id: 'icp_relevant_fields',
      claim_text: `${topFields.length} custom fields identified as ICP-relevant (score ≥50)`,
      entity_type: 'deal',
      entity_ids: topFields.map((f: any) => f.fieldKey || ''),
      metric_name: 'icp_relevance_score',
      metric_values: topFields.map((f: any) => f.icpRelevanceScore || 0),
      threshold_applied: 'score ≥ 50',
      severity: 'info',
    });
  }

  return eb.build();
}
