import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, repToRecord } from '../evidence-builder.js';

export async function buildRepScorecardEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  eb.addParameter({
    name: 'scorecard_period',
    display_name: 'Scorecard Period',
    value: 'current_quarter',
    description: 'Time period for scorecard evaluation',
    configurable: false,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const scorecardData = stepResults.scorecard_data || stepResults.owner_performance || {};
  const repScores = scorecardData.repScores || scorecardData.reps || scorecardData.owners || [];

  const needsCoaching: any[] = [];
  const topPerformers: any[] = [];

  const reps = Array.isArray(repScores) ? repScores : Object.entries(repScores).map(([k, v]: [string, any]) => ({ ...v, owner: k }));
  for (const rep of reps) {
    const score = rep.overallScore || rep.overall_score || rep.score || 0;
    const severity: 'critical' | 'warning' | 'healthy' = score < 40 ? 'critical' : score < 60 ? 'warning' : 'healthy';

    if (score < 50) needsCoaching.push(rep);
    if (score >= 80) topPerformers.push(rep);

    eb.addRecord(repToRecord(rep, {
      rep_name: rep.name || rep.owner || rep.rep_name || '',
      overall_score: score,
      closed_won: rep.closedWon || rep.wonValue || rep.closed_won || 0,
      closed_won_count: rep.dealsWon || rep.closed_won_count || 0,
      open_pipeline: rep.pipelineValue || rep.openPipeline || rep.open_pipeline || 0,
      open_deal_count: rep.openDeals || rep.open_deal_count || 0,
      quota_attainment: rep.attainment || rep.quota_attainment || 0,
      coverage_ratio: rep.coverageRatio || rep.coverage_ratio || 0,
      total_activities: rep.activities || rep.total_activities || 0,
    }, {
      primary_gap: rep.primaryGap || rep.primary_gap || '',
      coaching_recommendation: rep.coaching || rep.recommendation || '',
      trend: rep.trend || 'stable',
      performance_tier: score >= 80 ? 'top' : score >= 50 ? 'middle' : 'bottom',
    }, severity));
  }

  if (needsCoaching.length > 0) {
    eb.addClaim({
      claim_id: 'needs_coaching',
      claim_text: `${needsCoaching.length} reps scoring below 50 — coaching recommended`,
      entity_type: 'deal',
      entity_ids: needsCoaching.map((r: any) => r.email || r.owner || ''),
      metric_name: 'overall_score',
      metric_values: needsCoaching.map((r: any) => r.overallScore || r.overall_score || r.score || 0),
      threshold_applied: 'score < 50',
      severity: 'warning',
    });
  }

  if (topPerformers.length > 0) {
    eb.addClaim({
      claim_id: 'top_performers',
      claim_text: `${topPerformers.length} reps scoring 80+ — top performers`,
      entity_type: 'deal',
      entity_ids: topPerformers.map((r: any) => r.email || r.owner || ''),
      metric_name: 'overall_score',
      metric_values: topPerformers.map((r: any) => r.overallScore || r.overall_score || r.score || 0),
      threshold_applied: 'score >= 80',
      severity: 'info',
    });
  }

  return eb.build();
}
