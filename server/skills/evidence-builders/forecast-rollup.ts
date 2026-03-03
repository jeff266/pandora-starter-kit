import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';
import { formatCurrency } from '../../utils/format-currency.js';

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
  const closedWonDeals: any[] = forecastData.closedWonDeals || [];
  const closedWonByPipeline: Record<string, number> = forecastData.closedWonByPipeline || {};
  const queriesRun: Array<{ label: string; description: string; rowCount: number; total: number }> =
    forecastData.queriesRun || [];

  // ─── Closed-won deal records (T003) ──────────────────────────────────────────
  for (const deal of closedWonDeals) {
    eb.addRecord(dealToRecord(deal, {
      deal_name: deal.name || '',
      amount: deal.amount || 0,
      stage: 'Closed Won',
      owner: deal.owner || '',
      forecast_category: deal.forecast_category || 'closed',
      close_date: deal.close_date || null,
      probability: 100,
      weighted_amount: deal.amount || 0,
    }, {
      risk_type: 'none',
      risk_severity: 'healthy',
    }, 'healthy'));
  }

  // ─── Per-pipeline summary claims (T003) ──────────────────────────────────────
  if (Object.keys(closedWonByPipeline).length > 0) {
    for (const [pipeline, total] of Object.entries(closedWonByPipeline)) {
      if (!total || total <= 0) continue;
      const pipelineDeals = closedWonDeals.filter((d: any) => d.scope_id === pipeline);
      eb.addClaim({
        claim_id: `closed_won_${pipeline.replace(/\s+/g, '_').toLowerCase()}`,
        claim_text: `${pipeline}: ${pipelineDeals.length} deal${pipelineDeals.length !== 1 ? 's' : ''} closed won — ${formatCurrency(total)}`,
        entity_type: 'deal',
        entity_ids: pipelineDeals.map((d: any) => d.id || d.name || ''),
        metric_name: 'closed_won_amount',
        metric_values: pipelineDeals.map((d: any) => d.amount || 0),
        threshold_applied: 'stage = Closed Won within quarter',
        severity: 'healthy',
      });
    }
  }

  // ─── Data quality: sync gap warning (T004) ───────────────────────────────────
  const coreSalesPipeline = 'Core Sales Pipeline';
  const dbCoreSales = closedWonByPipeline[coreSalesPipeline] || 0;
  if (dbCoreSales > 0) {
    eb.addClaim({
      claim_id: 'crm_sync_gap_warning',
      claim_text: `DB shows ${formatCurrency(dbCoreSales)} closed for ${coreSalesPipeline}. If your CRM shows a higher total, a sync may be pending — verify against CRM before finalizing attainment figures.`,
      entity_type: 'deal',
      entity_ids: [],
      metric_name: 'closed_won_amount',
      metric_values: [dbCoreSales],
      threshold_applied: 'DB vs CRM sync check',
      severity: 'warning',
    });
  }

  // ─── SQL transparency: "How we counted" claims (T005) ────────────────────────
  for (const q of queriesRun) {
    eb.addClaim({
      claim_id: `query_${q.label.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40)}`,
      claim_text: `How we counted — ${q.label}: ${q.description}. Result: ${q.rowCount} deal${q.rowCount !== 1 ? 's' : ''}, ${formatCurrency(q.total)}.`,
      entity_type: 'deal',
      entity_ids: [],
      metric_name: 'query_row_count',
      metric_values: [q.rowCount, q.total],
      threshold_applied: q.label,
      severity: 'healthy',
    });
  }

  // ─── Open-pipeline risk claims (legacy — commit deals only) ──────────────────
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

  // Stalled commits risk claim
  const commitDeals = deals.filter((d: any) => (d.forecast_category || d.forecastCategory || '').toLowerCase() === 'commit');
  if (commitDeals.length > 0) {
    const commitTotal = commitDeals.reduce((s: number, d: any) => s + (d.amount || 0), 0);
    const stalledCommits = commitDeals.filter((d: any) => d.daysStale > 14 || d.risk_type);

    if (stalledCommits.length > 0) {
      eb.addClaim({
        claim_id: 'stalled_commits',
        claim_text: `${stalledCommits.length} commit deals worth ${formatCurrency(stalledCommits.reduce((s: number, d: any) => s + (d.amount || 0), 0))} show risk signals`,
        entity_type: 'deal',
        entity_ids: stalledCommits.map((d: any) => d.id || d.dealId || ''),
        metric_name: 'forecast_category',
        metric_values: stalledCommits.map((d: any) => d.amount || 0),
        threshold_applied: 'commit with risk signals',
        severity: 'warning',
      });
    }

    // Concentration risk
    const topThree = [...commitDeals].sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0)).slice(0, 3);
    const topThreeValue = topThree.reduce((s: number, d: any) => s + (d.amount || 0), 0);
    if (commitTotal > 0 && topThreeValue / commitTotal > 0.6) {
      eb.addClaim({
        claim_id: 'concentrated_commit',
        claim_text: `Top 3 deals represent ${Math.round(topThreeValue / commitTotal * 100)}% of commit (${formatCurrency(topThreeValue)} of ${formatCurrency(commitTotal)})`,
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
