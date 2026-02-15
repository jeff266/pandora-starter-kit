import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, repToRecord } from '../evidence-builder.js';
import { formatCurrency } from '../../utils/format-currency.js';

export async function buildPipelineGoalsEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  const goals = businessContext.goals_and_targets || {};

  eb.addParameter({
    name: 'revenue_target',
    display_name: 'Revenue Target ($)',
    value: (goals as any).revenue_target ?? 0,
    description: 'Period revenue target',
    configurable: true,
  });
  eb.addParameter({
    name: 'pipeline_coverage_target',
    display_name: 'Coverage Target (x)',
    value: (goals as any).pipeline_coverage_target ?? 3,
    description: 'Target pipeline-to-quota coverage ratio',
    configurable: true,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const goalsData = stepResults.goals_data || {};
  const repBreakdown = goalsData.repBreakdown || [];

  for (const rep of repBreakdown) {
    const gap = rep.gap || ((rep.quota || 0) - (rep.wonValue || 0));
    const isOnTrack = gap <= 0 || (rep.pipelineValue || 0) > gap * 3;
    const severity: 'critical' | 'warning' | 'healthy' = gap > (rep.quota || 1) * 0.5 ? 'critical' : gap > 0 ? 'warning' : 'healthy';

    eb.addRecord(repToRecord(rep, {
      rep_name: rep.rep || rep.name || rep.owner || '',
      quota: rep.quota || 0,
      won_this_month: rep.wonValue || rep.won_this_month || 0,
      open_pipeline: rep.pipelineValue || rep.open_pipeline || 0,
      gap_to_quota: gap,
      meetings_this_month: rep.meetings || rep.meetings_this_month || 0,
      calls_this_month: rep.calls || rep.calls_this_month || 0,
    }, {
      status: isOnTrack ? 'on_track' : gap > (rep.quota || 1) * 0.5 ? 'behind' : 'at_risk',
      primary_gap: rep.primaryGap || (gap > 0 ? 'revenue_gap' : 'none'),
      weekly_prescription: rep.prescription || '',
    }, severity));
  }

  // Reverse math claims
  const reverseMath = goalsData.reverseMath || {};
  if (reverseMath.pipelineGap > 0) {
    eb.addClaim({
      claim_id: 'pipeline_gap',
      claim_text: `${formatCurrency(reverseMath.pipelineGap)} more pipeline needed to hit target at current win rate`,
      entity_type: 'deal',
      entity_ids: [],
      metric_name: 'pipeline_gap',
      metric_values: [reverseMath.pipelineGap],
      threshold_applied: `win rate adjusted coverage`,
      severity: reverseMath.pipelineGap > (goals as any).revenue_target * 0.5 ? 'critical' : 'warning',
    });
  }

  return eb.build();
}
