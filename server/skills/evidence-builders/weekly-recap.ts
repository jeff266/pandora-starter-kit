import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';

export async function buildWeeklyRecapEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  eb.addParameter({
    name: 'recap_window_days',
    display_name: 'Recap Window (days)',
    value: 7,
    description: 'Number of days to look back for the weekly recap',
    configurable: false,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const recapData = stepResults.recap_data || stepResults.pipeline_summary || {};
  const dealsChanged = recapData.dealsChanged || recapData.movements || recapData.deals || [];
  const dealsWon = recapData.dealsWon || recapData.won || [];
  const dealsLost = recapData.dealsLost || recapData.lost || [];
  const dealsCreated = recapData.dealsCreated || recapData.created || [];

  const allDeals = [...dealsChanged, ...dealsWon, ...dealsLost, ...dealsCreated];
  const seen = new Set<string>();

  for (const deal of allDeals) {
    const key = (deal.name || deal.dealName || '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const outcome = deal.outcome || (dealsWon.includes(deal) ? 'won' : dealsLost.includes(deal) ? 'lost' : dealsCreated.includes(deal) ? 'created' : 'advanced');
    const severity: 'critical' | 'warning' | 'healthy' = outcome === 'lost' ? 'warning' : 'healthy';

    eb.addRecord(dealToRecord(deal, {
      deal_name: deal.name || deal.dealName || '',
      amount: deal.amount || 0,
      stage: deal.stage || deal.current_stage || deal.stage_normalized || '',
      owner: deal.owner || '',
      outcome: outcome,
      close_date: deal.close_date || deal.closeDate || null,
      created_at: deal.created_at || deal.createdAt || null,
      stage_change: deal.stage_change || deal.movement || '',
    }, {
      movement_quality: deal.movement_quality || outcome,
    }, severity));
  }

  if (dealsWon.length > 0) {
    const wonValue = dealsWon.reduce((s: number, d: any) => s + (d.amount || 0), 0);
    eb.addClaim({
      claim_id: 'deals_won',
      claim_text: `${dealsWon.length} deals won worth $${Math.round(wonValue / 1000)}K this week`,
      entity_type: 'deal',
      entity_ids: dealsWon.map((d: any) => d.id || d.dealId || ''),
      metric_name: 'outcome',
      metric_values: dealsWon.map((d: any) => d.amount || 0),
      threshold_applied: 'status = won',
      severity: 'info',
    });
  }

  if (dealsLost.length > 0) {
    const lostValue = dealsLost.reduce((s: number, d: any) => s + (d.amount || 0), 0);
    eb.addClaim({
      claim_id: 'deals_lost',
      claim_text: `${dealsLost.length} deals lost worth $${Math.round(lostValue / 1000)}K this week`,
      entity_type: 'deal',
      entity_ids: dealsLost.map((d: any) => d.id || d.dealId || ''),
      metric_name: 'outcome',
      metric_values: dealsLost.map((d: any) => d.amount || 0),
      threshold_applied: 'status = lost',
      severity: 'warning',
    });
  }

  return eb.build();
}
