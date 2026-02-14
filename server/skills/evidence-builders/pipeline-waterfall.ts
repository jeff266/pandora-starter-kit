import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';

export async function buildPipelineWaterfallEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  eb.addParameter({
    name: 'analysis_window',
    display_name: 'Analysis Window',
    value: 'current_quarter',
    description: 'Time period for waterfall analysis',
    configurable: false,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const waterfallData = stepResults.waterfall_data || stepResults.stage_movements || {};
  const movements = waterfallData.movements || waterfallData.deals || [];

  const stalled: any[] = [];
  const premature: any[] = [];

  for (const deal of movements) {
    const movementType = deal.movement_type || deal.movementType || 'advance';
    const isStalled = movementType === 'stalled' || (deal.days_in_stage || deal.daysInStage || 0) > 30;
    const isPremature = movementType === 'premature' || movementType === 'premature_advance';
    const severity: 'critical' | 'warning' | 'healthy' = isStalled ? 'warning' : isPremature ? 'warning' : 'healthy';

    if (isStalled) stalled.push(deal);
    if (isPremature) premature.push(deal);

    eb.addRecord(dealToRecord(deal, {
      deal_name: deal.name || deal.dealName || '',
      amount: deal.amount || 0,
      owner: deal.owner || '',
      from_stage: deal.from_stage || deal.fromStage || deal.previousStage || '',
      to_stage: deal.to_stage || deal.toStage || deal.currentStage || '',
      days_in_stage: deal.days_in_stage || deal.daysInStage || 0,
    }, {
      movement_type: movementType,
      velocity_vs_benchmark: deal.velocity_flag || deal.velocityFlag || 'normal',
      severity: severity,
    }, severity));
  }

  if (stalled.length > 0) {
    eb.addClaim({
      claim_id: 'stage_bottleneck',
      claim_text: `${stalled.length} deals stalled in stage (30+ days)`,
      entity_type: 'deal',
      entity_ids: stalled.map((d: any) => d.id || d.dealId || ''),
      metric_name: 'days_in_stage',
      metric_values: stalled.map((d: any) => d.days_in_stage || d.daysInStage || 0),
      threshold_applied: '30 days in stage',
      severity: 'warning',
    });
  }

  if (premature.length > 0) {
    eb.addClaim({
      claim_id: 'premature_advances',
      claim_text: `${premature.length} deals advanced prematurely (below average stage time)`,
      entity_type: 'deal',
      entity_ids: premature.map((d: any) => d.id || d.dealId || ''),
      metric_name: 'days_in_stage',
      metric_values: premature.map((d: any) => d.days_in_stage || d.daysInStage || 0),
      threshold_applied: 'below average stage time',
      severity: 'warning',
    });
  }

  return eb.build();
}
