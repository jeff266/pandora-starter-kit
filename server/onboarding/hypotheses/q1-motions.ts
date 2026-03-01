import type { CRMScanResult, CompanyResearch, InferenceResult, Hypothesis } from '../types.js';

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

export function generateMotionsHypothesis(
  scan: CRMScanResult,
  _research: CompanyResearch,
  _inference: InferenceResult,
): Hypothesis {
  const pipelines = scan.pipelines ?? [];
  const dealTypes = scan.deal_types ?? [];
  const recordTypes = scan.record_types ?? [];
  const amtDist = scan.amount_distribution;

  if (pipelines.length === 0) {
    return {
      summary: 'No deal data found yet. I\'ll treat all deals as one motion by default.',
      confidence: 0.1,
      evidence: 'No deals found in CRM',
      suggested_value: { motions: [{ name: 'All Deals', filter_field: null, filter_values: [], deal_count: 0, avg_size: 0, avg_cycle: null }] },
    };
  }

  if (pipelines.length > 1) {
    return {
      summary: `I found ${pipelines.length} pipelines in your CRM. Each looks like a distinct selling motion based on deal size and cycle time.`,
      table: pipelines.map(p => ({
        Motion: p.pipeline,
        'Filter': `pipeline = "${p.pipeline}"`,
        Deals: p.count,
        'Avg Size': fmtMoney(p.avg_amount),
        'Avg Cycle': p.avg_cycle_days != null ? `${Math.round(p.avg_cycle_days)}d` : '—',
      })),
      columns: ['Motion', 'Filter', 'Deals', 'Avg Size', 'Avg Cycle'],
      confidence: 0.85,
      evidence: `${pipelines.length} distinct pipelines with different deal profiles`,
      suggested_value: {
        motions: pipelines.map(p => ({
          name: p.pipeline,
          filter_field: 'pipeline',
          filter_values: [p.pipeline],
          deal_count: p.count,
          avg_size: Math.round(p.avg_amount),
          avg_cycle: p.avg_cycle_days != null ? Math.round(p.avg_cycle_days) : null,
        })),
      },
    };
  }

  if (amtDist && amtDist.p75 > 0) {
    const midThreshold = Math.round(amtDist.p50 / 10000) * 10000;
    const entThreshold = Math.round(amtDist.p75 / 10000) * 10000;

    const allDeals = pipelines[0]?.count ?? 0;

    if (dealTypes.length > 1) {
      return {
        summary: `You have one pipeline but ${dealTypes.length} deal types — I'll segment by deal type since that's how your team categorizes work.`,
        table: dealTypes.map(dt => ({
          Motion: dt.value,
          'Filter': `deal_type = "${dt.value}"`,
          Deals: dt.count,
          'Avg Size': fmtMoney(dt.avg_amount),
        })),
        columns: ['Motion', 'Filter', 'Deals', 'Avg Size'],
        confidence: 0.75,
        evidence: `${dealTypes.length} distinct deal types with different size profiles`,
        suggested_value: {
          motions: dealTypes.map(dt => ({
            name: dt.value,
            filter_field: 'deal_type',
            filter_values: [dt.value],
            deal_count: dt.count,
            avg_size: Math.round(dt.avg_amount),
          })),
        },
      };
    }

    return {
      summary: `You have one pipeline with ${allDeals.toLocaleString()} deals. Based on your deal size distribution, I'd segment into 3 motions by amount:`,
      table: [
        { Motion: 'Enterprise', 'Filter': `amount ≥ ${fmtMoney(entThreshold)}`, Deals: '~25% of deals', 'Median Size': fmtMoney(amtDist.p90) },
        { Motion: 'Mid-Market', 'Filter': `${fmtMoney(midThreshold)} – ${fmtMoney(entThreshold)}`, Deals: '~25% of deals', 'Median Size': fmtMoney(amtDist.p50) },
        { Motion: 'SMB', 'Filter': `amount < ${fmtMoney(midThreshold)}`, Deals: '~50% of deals', 'Median Size': fmtMoney(amtDist.p10) },
      ],
      columns: ['Motion', 'Filter', 'Deals', 'Median Size'],
      confidence: 0.6,
      evidence: `Amount distribution: p50=${fmtMoney(amtDist.p50)}, p75=${fmtMoney(amtDist.p75)}, p90=${fmtMoney(amtDist.p90)}`,
      suggested_value: {
        motions: [
          { name: 'Enterprise', filter_field: 'amount', amount_threshold_min: entThreshold, avg_size: Math.round(amtDist.p90) },
          { name: 'Mid-Market', filter_field: 'amount', amount_threshold_min: midThreshold, amount_threshold_max: entThreshold - 1, avg_size: Math.round(amtDist.p50) },
          { name: 'SMB', filter_field: 'amount', amount_threshold_max: midThreshold - 1, avg_size: Math.round(amtDist.p10) },
        ],
      },
    };
  }

  return {
    summary: 'I see one pipeline in your CRM. I\'ll treat all deals as a single motion unless you tell me otherwise.',
    confidence: 0.5,
    evidence: `${pipelines[0]?.count ?? 0} total deals in one pipeline`,
    suggested_value: {
      motions: [{ name: 'All Deals', filter_field: null, filter_values: [], deal_count: pipelines[0]?.count ?? 0 }],
    },
  };
}
