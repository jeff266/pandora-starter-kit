import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, repToRecord } from '../evidence-builder.js';

export async function buildPipelineCoverageEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  const goals = businessContext.goals_and_targets || {};
  const coverageTarget = (goals as any).pipeline_coverage_target ?? 3;

  eb.addParameter({
    name: 'coverage_target',
    display_name: 'Coverage Target (x)',
    value: coverageTarget,
    description: 'Target pipeline-to-quota coverage ratio',
    configurable: true,
  });
  eb.addParameter({
    name: 'revenue_target',
    display_name: 'Revenue Target ($)',
    value: (goals as any).revenue_target ?? 0,
    description: 'Period revenue target',
    configurable: true,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const coverageData = stepResults.coverage_data || {};
  const reps = coverageData.reps || [];
  const team = coverageData.team || {};

  const repsBelowTarget: any[] = [];

  for (const rep of reps) {
    const ratio = rep.coverageRatio ?? 0;
    const isBelow = ratio !== null && ratio < coverageTarget;
    const severity: 'critical' | 'warning' | 'healthy' = 
      ratio !== null && ratio < coverageTarget * 0.5 ? 'critical' : 
      isBelow ? 'warning' : 'healthy';

    if (isBelow) repsBelowTarget.push(rep);

    eb.addRecord(repToRecord(rep, {
      rep_name: rep.name || rep.owner || '',
      rep_email: rep.email || '',
      quota: rep.quota || 0,
      open_pipeline: rep.pipeline || 0,
      coverage_ratio: ratio,
      gap_to_quota: rep.gap || 0,
      closed_won: rep.closedWon || 0,
      deal_count: rep.dealCount || 0,
    }, {
      risk_level: severity,
      coverage_health: isBelow ? 'below_target' : 'above_target',
      root_cause: rep.status === 'behind' ? 'insufficient_pipeline' : 
                  rep.status === 'at_risk' ? 'marginal_coverage' : 'on_track',
      recommended_intervention: isBelow ? 'Accelerate pipeline generation' : 'Maintain pace',
    }, severity));
  }

  if (repsBelowTarget.length > 0) {
    eb.addClaim({
      claim_id: 'reps_below_coverage',
      claim_text: `${repsBelowTarget.length} reps below ${coverageTarget}x coverage target`,
      entity_type: 'deal',
      entity_ids: repsBelowTarget.map((r: any) => r.email || r.name || ''),
      metric_name: 'coverage_ratio',
      metric_values: repsBelowTarget.map((r: any) => r.coverageRatio ?? 0),
      threshold_applied: `${coverageTarget}x`,
      severity: repsBelowTarget.some((r: any) => (r.coverageRatio ?? 0) < coverageTarget * 0.5) ? 'critical' : 'warning',
    });
  }

  const teamCoverage = team.coverageRatio;
  if (teamCoverage != null && teamCoverage < coverageTarget) {
    eb.addClaim({
      claim_id: 'team_coverage_gap',
      claim_text: `Team coverage at ${Number(teamCoverage).toFixed(1)}x vs ${coverageTarget}x target`,
      entity_type: 'deal',
      entity_ids: [],
      metric_name: 'team_coverage_ratio',
      metric_values: [teamCoverage],
      threshold_applied: `${coverageTarget}x`,
      severity: teamCoverage < coverageTarget * 0.5 ? 'critical' : 'warning',
    });
  }

  return eb.build();
}
