import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';

export async function buildDealRiskReviewEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  const goals = businessContext.goals_and_targets || {};
  const thresholds = (goals as any).thresholds || {};

  eb.addParameter({
    name: 'stale_threshold_days',
    display_name: 'Stale Threshold (days)',
    value: thresholds.stale_deal_days ?? 30,
    description: 'Days without activity before a deal is flagged',
    configurable: true,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce', 'gong', 'fireflies']);
  for (const ds of dataSources) eb.addDataSource(ds);

  // The deal risk review skill uses a classify step that produces risk assessments
  const riskData = stepResults.risk_assessments || stepResults.deal_classifications || [];
  const allDeals = stepResults.all_deals || stepResults.pipeline_deals || [];

  const riskMap = new Map<string, any>();
  if (Array.isArray(riskData)) {
    for (const r of riskData) {
      riskMap.set((r.dealName || r.name || '').toLowerCase(), r);
    }
  }

  const highRiskDeals: any[] = [];

  const dealList = Array.isArray(allDeals) ? allDeals : (allDeals?.topDeals || []);
  for (const deal of dealList) {
    const name = (deal.name || deal.dealName || '').toLowerCase();
    const risk = riskMap.get(name);
    const riskLevel = risk?.risk_level || risk?.riskLevel || (deal.riskScore > 70 ? 'high' : deal.riskScore > 40 ? 'medium' : 'low');
    const severity: 'critical' | 'warning' | 'healthy' = riskLevel === 'high' ? 'critical' : riskLevel === 'medium' ? 'warning' : 'healthy';

    if (severity === 'critical') highRiskDeals.push(deal);

    eb.addRecord(dealToRecord(deal, {
      deal_name: deal.name || deal.dealName || '',
      amount: deal.amount || 0,
      stage: deal.stage || deal.stage_normalized || '',
      owner: deal.owner || '',
      close_date: deal.close_date || deal.closeDate || null,
      risk_score: deal.riskScore || risk?.score || 0,
      days_since_activity: deal.daysStale || deal.days_since_activity || 0,
      contact_count: deal.contactCount || deal.contact_count || 0,
    }, {
      risk_level: riskLevel,
      risk_factors: risk?.signals?.join(', ') || risk?.risk_factors || '',
      recommended_action: risk?.suggested_action || risk?.recommendation || '',
    }, severity));
  }

  if (highRiskDeals.length > 0) {
    eb.addClaim({
      claim_id: 'high_risk_deals',
      claim_text: `${highRiskDeals.length} deals flagged as high risk`,
      entity_type: 'deal',
      entity_ids: highRiskDeals.map((d: any) => d.id || d.dealId || ''),
      metric_name: 'risk_score',
      metric_values: highRiskDeals.map((d: any) => d.riskScore || 0),
      threshold_applied: 'risk_level = high',
      severity: 'critical',
    });
  }

  return eb.build();
}
