/**
 * Pipeline Hygiene Evidence Builder
 *
 * Maps compute outputs (stale_deals_agg, closing_soon_agg, pipeline_summary)
 * and classify outputs (deal_classifications) into structured evidence.
 */

import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';
import { formatCurrency } from '../../utils/format-currency.js';

export async function buildPipelineHygieneEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  const goals = businessContext.goals_and_targets || {};
  const thresholds = (goals as any).thresholds || {};
  const staleThreshold = thresholds.stale_deal_days ?? 30;

  // Parameters
  eb.addParameter({
    name: 'stale_threshold_days',
    display_name: 'Stale Threshold (days)',
    value: staleThreshold,
    description: 'Days without activity before a deal is flagged as stale',
    configurable: true,
  });
  eb.addParameter({
    name: 'pipeline_coverage_target',
    display_name: 'Pipeline Coverage Target',
    value: (goals as any).pipeline_coverage_target ?? 3,
    description: 'Target pipeline-to-quota coverage ratio',
    configurable: true,
  });
  eb.addParameter({
    name: 'revenue_target',
    display_name: 'Revenue Target ($)',
    value: (goals as any).revenue_target ?? 0,
    description: 'Monthly or quarterly revenue target',
    configurable: true,
  });

  // Data sources
  const dataSources = await buildDataSources(workspaceId, [
    'hubspot', 'salesforce', 'gong', 'fireflies',
  ]);
  for (const ds of dataSources) {
    eb.addDataSource(ds);
  }

  // Build classification lookup from DeepSeek step
  const classifications = stepResults.deal_classifications;
  const classMap = new Map<string, any>();
  if (Array.isArray(classifications)) {
    for (const c of classifications) {
      const key = (c.dealName || '').toLowerCase();
      classMap.set(key, c);
    }
  }

  // Evaluated records from stale deals
  const staleAgg = stepResults.stale_deals_agg;
  const staleDeals = staleAgg?.topDeals || [];
  for (const deal of staleDeals) {
    const classification = classMap.get((deal.name || '').toLowerCase());
    const isPastDue = deal.closeDate ? new Date(deal.closeDate) < new Date() : false;
    const isCritical = deal.daysStale >= (staleThreshold * 1.5);

    eb.addRecord(dealToRecord(
      deal,
      {
        deal_name: deal.name,
        amount: deal.amount || 0,
        stage: deal.stage || '',
        owner: deal.owner || '',
        days_since_activity: deal.daysStale || 0,
        close_date: deal.closeDate || null,
      },
      {
        stale_flag: 'stale',
        close_date_flag: isPastDue ? 'past_due' : 'on_time',
        root_cause: classification?.root_cause || 'unknown',
        suggested_action: classification?.suggested_action || 'Review and re-engage',
        severity: isCritical ? 'critical' : 'warning',
      },
      isCritical ? 'critical' : 'warning'
    ));
  }

  // Evaluated records from closing soon deals
  const closingAgg = stepResults.closing_soon_agg;
  const closingDeals = closingAgg?.topDeals || [];
  for (const deal of closingDeals) {
    const classification = classMap.get((deal.name || '').toLowerCase());
    // Only add if not already in stale list
    const alreadyAdded = staleDeals.some(
      (s: any) => (s.name || '').toLowerCase() === (deal.name || '').toLowerCase()
    );
    if (alreadyAdded) continue;

    eb.addRecord(dealToRecord(
      deal,
      {
        deal_name: deal.name,
        amount: deal.amount || 0,
        stage: deal.stage || '',
        owner: deal.owner || '',
        days_since_activity: deal.daysStale || deal.daysSinceActivity || 0,
        close_date: deal.closeDate || deal.close_date || null,
      },
      {
        stale_flag: 'active',
        close_date_flag: 'closing_soon',
        root_cause: classification?.root_cause || 'none',
        suggested_action: classification?.suggested_action || 'Monitor closely',
        severity: 'healthy',
      },
      'healthy'
    ));
  }

  // Claims
  const staleSummary = staleAgg?.summary || {};
  if ((staleSummary.total || 0) > 0) {
    eb.addClaim({
      claim_id: 'stale_deals',
      claim_text: `${staleSummary.total} deals worth $${Math.round((staleSummary.totalValue || 0) / 1000)}K are stale (${staleThreshold}+ days, zero activity)`,
      entity_type: 'deal',
      entity_ids: staleDeals.map((d: any) => d.dealId || d.id || ''),
      metric_name: 'days_since_activity',
      metric_values: staleDeals.map((d: any) => d.daysStale || 0),
      threshold_applied: `${staleThreshold} days`,
      severity: staleDeals.some((d: any) => d.daysStale >= staleThreshold * 1.5) ? 'critical' : 'warning',
    });
  }

  const closingSummary = closingAgg?.summary || {};
  if ((closingSummary.total || 0) > 0) {
    eb.addClaim({
      claim_id: 'closing_soon',
      claim_text: `${closingSummary.total} deals worth $${Math.round((closingSummary.totalValue || 0) / 1000)}K closing within 30 days`,
      entity_type: 'deal',
      entity_ids: closingDeals.map((d: any) => d.dealId || d.id || ''),
      metric_name: 'days_to_close',
      metric_values: closingDeals.map((d: any) => d.daysToClose || 0),
      threshold_applied: '30 days',
      severity: 'info',
    });
  }

  // Pipeline coverage claim
  const coverageSummary = stepResults.pipeline_summary;
  if (coverageSummary?.coverageRatio != null) {
    const target = (goals as any).pipeline_coverage_target ?? 3;
    const ratio = coverageSummary.coverageRatio;
    if (ratio < target) {
      eb.addClaim({
        claim_id: 'coverage_gap',
        claim_text: `Pipeline coverage at ${ratio.toFixed(1)}x vs ${target}x target`,
        entity_type: 'deal',
        entity_ids: [],
        metric_name: 'coverage_ratio',
        metric_values: [ratio],
        threshold_applied: `${target}x target`,
        severity: ratio < target * 0.5 ? 'critical' : 'warning',
      });
    }
  }

  return eb.build();
}
