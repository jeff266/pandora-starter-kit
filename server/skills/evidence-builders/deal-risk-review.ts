import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';
import { formatCurrency } from '../../utils/format-currency.js';

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

  const openDeals = stepResults.open_deals || [];
  const riskAssessment = stepResults.risk_assessment || {};
  const dealContext = stepResults.deal_context || {};

  const riskMap = new Map<string, any>();
  if (riskAssessment.assessments && Array.isArray(riskAssessment.assessments)) {
    for (const r of riskAssessment.assessments) {
      const key = (r.dealName || r.deal_name || r.name || '').toLowerCase();
      riskMap.set(key, r);
    }
  } else if (Array.isArray(riskAssessment)) {
    for (const r of riskAssessment) {
      const key = (r.dealName || r.deal_name || r.name || '').toLowerCase();
      riskMap.set(key, r);
    }
  }

  const highRiskDeals: any[] = [];
  const dealList = Array.isArray(openDeals) ? openDeals : (openDeals?.deals || []);

  for (const deal of dealList) {
    const name = (deal.name || deal.deal_name || deal.dealName || '').toLowerCase();
    const risk = riskMap.get(name);
    const riskLevel = risk?.risk_level || risk?.riskLevel || 
      (deal.deal_risk > 70 ? 'high' : deal.deal_risk > 40 ? 'medium' : 'low');
    const severity: 'critical' | 'warning' | 'healthy' = 
      riskLevel === 'high' || riskLevel === 'critical' ? 'critical' : 
      riskLevel === 'medium' ? 'warning' : 'healthy';

    if (severity === 'critical') highRiskDeals.push(deal);

    eb.addRecord(dealToRecord(deal, {
      deal_name: deal.name || deal.deal_name || deal.dealName || '',
      amount: deal.amount || 0,
      stage: deal.stage || deal.stage_normalized || '',
      owner: deal.owner || '',
      close_date: deal.close_date || deal.closeDate || null,
      risk_score: deal.deal_risk || risk?.score || 0,
      days_since_activity: deal.days_stale || deal.daysStale || deal.days_since_activity || 0,
      contact_count: deal.contact_count || deal.contactCount || 0,
    }, {
      risk_level: riskLevel,
      risk_factors: risk?.signals?.join(', ') || risk?.risk_factors || '',
      recommended_action: risk?.suggested_action || risk?.recommendation || '',
    }, severity));
  }

  if (highRiskDeals.length > 0) {
    const totalValue = highRiskDeals.reduce((s, d) => s + (d.amount || 0), 0);
    eb.addClaim({
      claim_id: 'high_risk_deals',
      claim_text: `${highRiskDeals.length} deals worth ${formatCurrency(totalValue)} flagged as high risk`,
      entity_type: 'deal',
      entity_ids: highRiskDeals.map((d: any) => d.id || d.deal_id || d.dealId || ''),
      metric_name: 'risk_score',
      metric_values: highRiskDeals.map((d: any) => d.deal_risk || 0),
      threshold_applied: 'risk_level = high',
      severity: 'critical',
    });
  }

  return eb.build();
}
