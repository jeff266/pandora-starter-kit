import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';

export async function buildIcpDiscoveryEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  eb.addParameter({
    name: 'scoring_mode',
    display_name: 'Scoring Mode',
    value: stepResults.discovery_result?.mode || 'descriptive',
    description: 'ICP scoring methodology used',
    configurable: false,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce', 'gong', 'fireflies']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const discoveryResult = stepResults.discovery_result || {};
  const companyProfile = discoveryResult.companyProfile || {};
  const personas = discoveryResult.personas || [];

  // Build records from company profile segments (deals analyzed)
  const industryWinRates = companyProfile.industryWinRates || {};
  const dealBreakdown = companyProfile.dealBreakdown || [];

  for (const deal of dealBreakdown) {
    const icpGrade = deal.icp_grade || deal.grade || '';
    const severity: 'critical' | 'warning' | 'healthy' = icpGrade === 'A' || icpGrade === 'B' ? 'healthy' : icpGrade === 'D' || icpGrade === 'F' ? 'warning' : 'healthy';

    eb.addRecord(dealToRecord(deal, {
      deal_name: deal.name || deal.dealName || '',
      amount: deal.amount || 0,
      outcome: deal.outcome || deal.stage || '',
      industry: deal.industry || '',
      company_size: deal.company_size || deal.companySize || '',
      personas_involved: (deal.personas || []).join(', '),
      icp_grade: icpGrade,
      win_rate_segment: deal.segmentWinRate || null,
      lead_source: deal.lead_source || deal.leadSource || '',
    }, {}, severity));
  }

  // Persona pattern claims
  if (personas.length > 0) {
    const topPersona = personas[0];
    eb.addClaim({
      claim_id: 'top_persona',
      claim_text: `Top ICP persona: ${topPersona.name} (${(topPersona.lift * 100).toFixed(0)}% lift in win rate)`,
      entity_type: 'deal',
      entity_ids: [],
      metric_name: 'persona_lift',
      metric_values: personas.slice(0, 5).map((p: any) => p.lift),
      threshold_applied: 'highest lift',
      severity: 'info',
    });
  }

  // Industry sweet spots
  const sweetSpots = companyProfile.sweetSpots || [];
  if (sweetSpots.length > 0) {
    eb.addClaim({
      claim_id: 'sweet_spots',
      claim_text: `${sweetSpots.length} high-win-rate segments identified`,
      entity_type: 'deal',
      entity_ids: [],
      metric_name: 'segment_win_rate',
      metric_values: sweetSpots.map((s: any) => s.winRate || s.win_rate || 0),
      threshold_applied: 'above average win rate',
      severity: 'info',
    });
  }

  return eb.build();
}
