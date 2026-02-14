import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';

export async function buildLeadScoringEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  eb.addParameter({
    name: 'scoring_method',
    display_name: 'Scoring Method',
    value: 'point_based',
    description: 'Lead scoring methodology used',
    configurable: false,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const scoringResult = stepResults.scoring_result || stepResults.lead_scores || {};
  const dealScores = scoringResult.dealScores || [];
  const summaryStats = scoringResult.summaryStats || {};

  for (const scored of dealScores) {
    const score = scored.totalScore || scored.total_score || 0;
    const grade = scored.scoreGrade || scored.score_grade || 'C';
    const severity: 'critical' | 'warning' | 'healthy' = grade === 'D' || grade === 'F' ? 'warning' : grade === 'A' ? 'healthy' : 'healthy';

    // Find primary strength and risk from breakdown
    const breakdown = scored.scoreBreakdown || scored.score_breakdown || {};
    const sorted = Object.entries(breakdown).sort(([, a]: [string, any], [, b]: [string, any]) => (b.points || 0) - (a.points || 0));
    const primaryStrength = sorted[0]?.[0] || '';
    const weakest = [...sorted].reverse();
    const primaryRisk = weakest[0]?.[0] || '';

    eb.addRecord(dealToRecord({
      id: scored.entityId || scored.entity_id,
      name: scored.dealName || scored.entity_name || '',
      owner: scored.owner || '',
    }, {
      deal_name: scored.dealName || scored.entity_name || '',
      amount: scored.amount || 0,
      stage: scored.stage || '',
      owner: scored.owner || '',
      score: score,
      grade: grade,
    }, {
      primary_strength: primaryStrength,
      primary_risk: primaryRisk,
      recommended_action: grade === 'A' ? 'Prioritize — high-fit lead' : grade === 'D' || grade === 'F' ? 'Evaluate for deprioritization' : 'Standard follow-up',
    }, severity));
  }

  // Grade distribution claims
  const gradeDistribution = summaryStats.gradeDistribution || {};
  const lowGradeCount = (gradeDistribution.D || 0) + (gradeDistribution.F || 0);
  if (lowGradeCount > 0) {
    eb.addClaim({
      claim_id: 'low_grade_deals',
      claim_text: `${lowGradeCount} deals scored D/F — deprioritization candidates`,
      entity_type: 'deal',
      entity_ids: dealScores.filter((d: any) => (d.scoreGrade || d.score_grade) === 'D' || (d.scoreGrade || d.score_grade) === 'F').map((d: any) => d.entityId || d.entity_id || ''),
      metric_name: 'score_grade',
      metric_values: dealScores.filter((d: any) => (d.scoreGrade || d.score_grade) === 'D' || (d.scoreGrade || d.score_grade) === 'F').map((d: any) => d.totalScore || d.total_score || 0),
      threshold_applied: 'grade D or F',
      severity: 'warning',
    });
  }

  return eb.build();
}
