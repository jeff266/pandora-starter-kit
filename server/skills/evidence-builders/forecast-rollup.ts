import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';

export async function buildForecastRollupEvidence(
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
    description: 'Period revenue target for forecast comparison',
    configurable: true,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const forecastData = stepResults.forecast_data || stepResults.pipeline_summary || {};
  const deals = forecastData.deals || forecastData.topDeals || [];
  const categories = forecastData.byCategory || forecastData.categories || {};

  for (const deal of deals) {
    const probability = deal.probability || 0;
    const weighted = (deal.amount || 0) * (probability / 100);
    const hasRisk = deal.risk_type || deal.riskType || deal.hasRisk;
    const severity: 'critical' | 'warning' | 'healthy' = hasRisk ? 'warning' : probability >= 70 ? 'healthy' : 'warning';

    eb.addRecord(dealToRecord(deal, {
      deal_name: deal.name || deal.dealName || '',
      amount: deal.amount || 0,
      stage: deal.stage || deal.stage_normalized || '',
      owner: deal.owner || '',
      forecast_category: deal.forecast_category || deal.forecastCategory || '',
      close_date: deal.close_date || deal.closeDate || null,
      probability: probability,
      weighted_amount: weighted,
    }, {
      risk_type: deal.risk_type || deal.riskType || 'none',
      risk_severity: hasRisk ? 'warning' : 'healthy',
    }, severity));
  }

  // Claims based on forecast categories
  const commitDeals = deals.filter((d: any) => (d.forecast_category || d.forecastCategory || '').toLowerCase() === 'commit');
  if (commitDeals.length > 0) {
    const commitTotal = commitDeals.reduce((s: number, d: any) => s + (d.amount || 0), 0);
    const stalledCommits = commitDeals.filter((d: any) => d.daysStale > 14 || d.risk_type);

    if (stalledCommits.length > 0) {
      eb.addClaim({
        claim_id: 'stalled_commits',
        claim_text: `${stalledCommits.length} commit deals worth $${Math.round(stalledCommits.reduce((s: number, d: any) => s + (d.amount || 0), 0) / 1000)}K show risk signals`,
        entity_type: 'deal',
        entity_ids: stalledCommits.map((d: any) => d.id || d.dealId || ''),
        metric_name: 'forecast_category',
        metric_values: stalledCommits.map((d: any) => d.amount || 0),
        threshold_applied: 'commit with risk signals',
        severity: 'warning',
      });
    }

    // Check for concentration risk
    const topThree = [...commitDeals].sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0)).slice(0, 3);
    const topThreeValue = topThree.reduce((s: number, d: any) => s + (d.amount || 0), 0);
    if (commitTotal > 0 && topThreeValue / commitTotal > 0.6) {
      eb.addClaim({
        claim_id: 'concentrated_commit',
        claim_text: `Top 3 deals represent ${Math.round(topThreeValue / commitTotal * 100)}% of commit ($${Math.round(topThreeValue / 1000)}K of $${Math.round(commitTotal / 1000)}K)`,
        entity_type: 'deal',
        entity_ids: topThree.map((d: any) => d.id || d.dealId || ''),
        metric_name: 'amount',
        metric_values: topThree.map((d: any) => d.amount || 0),
        threshold_applied: '>60% concentration',
        severity: 'warning',
      });
    }
  }

  return eb.build();
}
