import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources } from '../evidence-builder.js';

export async function buildBowtieAnalysisEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  eb.addParameter({
    name: 'analysis_period',
    display_name: 'Analysis Period',
    value: 'current_quarter',
    description: 'Time period for bowtie funnel analysis',
    configurable: false,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const bowtieData = stepResults.bowtie_data || {};
  const conversions = bowtieData.conversions?.conversions || [];
  const bottlenecks = bowtieData.bottlenecks || {};
  const leftFunnel = bowtieData.leftSideFunnel?.stages || [];

  for (const conv of conversions) {
    const isBottleneck = bottlenecks.weakestConversion?.stage === conv.from_stage;
    const severity: 'critical' | 'warning' | 'healthy' = isBottleneck ? 'critical' : conv.rate < 0.3 ? 'warning' : 'healthy';

    eb.addRecord({
      entity_id: `${conv.from_stage}_to_${conv.to_stage}`,
      entity_type: 'deal' as any,
      entity_name: `${conv.from_stage} → ${conv.to_stage}`,
      owner_email: null,
      owner_name: null,
      fields: {
        stage_transition: `${conv.from_stage} → ${conv.to_stage}`,
        conversion_rate: conv.rate || 0,
        prior_rate: conv.prior_rate || null,
        delta: conv.delta ? `${conv.delta > 0 ? '+' : ''}${(conv.delta * 100).toFixed(1)}%` : '',
        volume: conv.count || conv.volume || 0,
      },
      flags: {
        bottleneck_severity: severity,
        root_cause: isBottleneck ? 'lowest_conversion' : '',
        intervention: conv.intervention || '',
      },
      severity,
    });
  }

  // Stage volume records
  for (const stage of leftFunnel) {
    eb.addRecord({
      entity_id: stage.stage_id || stage.label,
      entity_type: 'deal' as any,
      entity_name: stage.label || stage.stage_id,
      owner_email: null,
      owner_name: null,
      fields: {
        stage_transition: stage.label,
        volume: stage.total || 0,
        total_value: stage.total_value || 0,
      },
      flags: {},
      severity: 'healthy',
    });
  }

  if (bottlenecks.weakestConversion) {
    eb.addClaim({
      claim_id: 'conversion_bottleneck',
      claim_text: `Conversion bottleneck at ${bottlenecks.weakestConversion.stage} (${(bottlenecks.weakestConversion.rate * 100).toFixed(0)}% conversion)`,
      entity_type: 'deal',
      entity_ids: [],
      metric_name: 'conversion_rate',
      metric_values: [bottlenecks.weakestConversion.rate],
      threshold_applied: 'lowest conversion stage',
      severity: 'critical',
    });
  }

  if (bottlenecks.biggestVolumeLoss) {
    eb.addClaim({
      claim_id: 'leakage_point',
      claim_text: `Highest drop-off at ${bottlenecks.biggestVolumeLoss.stage} (${bottlenecks.biggestVolumeLoss.loss} deals lost)`,
      entity_type: 'deal',
      entity_ids: [],
      metric_name: 'volume_loss',
      metric_values: [bottlenecks.biggestVolumeLoss.loss],
      threshold_applied: 'highest deal loss',
      severity: 'warning',
    });
  }

  return eb.build();
}
