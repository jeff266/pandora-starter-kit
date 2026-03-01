import type { CRMScanResult, InferenceResult, Hypothesis } from '../types.js';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthName(m: number): string {
  return MONTH_NAMES[(m - 1 + 12) % 12] || String(m);
}

function inferQuarterEnds(fiscalStartMonth: number): number[] {
  const ends: number[] = [];
  for (let i = 0; i < 4; i++) {
    ends.push(((fiscalStartMonth - 1 + (i + 1) * 3 - 1) % 12) + 1);
  }
  return ends;
}

export function generateCalendarHypothesis(
  scan: CRMScanResult,
  inference: InferenceResult,
): Hypothesis {
  const fiscalStart = inference.fiscal_year_start_month ?? 1;
  const quarterEnds = inferQuarterEnds(fiscalStart);
  const clusters = scan.close_date_clusters ?? [];

  const clustersByMonth = new Map<number, { count: number; total: number }>();
  for (const cluster of clusters) {
    const d = new Date(cluster.month);
    const m = d.getUTCMonth() + 1;
    const existing = clustersByMonth.get(m) || { count: 0, total: 0 };
    clustersByMonth.set(m, { count: existing.count + cluster.count, total: existing.total + cluster.total_amount });
  }

  const quarterEndEvidence = quarterEnds.map(qe => {
    const c = clustersByMonth.get(qe) || { count: 0, total: 0 };
    return { month: monthName(qe), deals: c.count, total: c.total };
  });

  const hasQuarterBias = quarterEndEvidence.some(q => q.deals > 0);
  const quotaPeriod = inference.quota_period ?? 'quarterly';

  const fiscalYear = fiscalStart === 1 ? 'Calendar Year (Jan–Dec)' : `Fiscal Year starting ${monthName(fiscalStart)}`;

  const evidence = hasQuarterBias
    ? `Close date clustering around Q-end months (${quarterEnds.map(monthName).join(', ')})`
    : `No clear quarter-end clustering found — defaulting to calendar quarters`;

  return {
    summary: `Your fiscal year appears to be a ${fiscalYear}. Quota period: ${quotaPeriod}. Quarter-end months: ${quarterEnds.map(monthName).join(', ')}.`,
    table: hasQuarterBias ? quarterEndEvidence.map(q => ({
      'Q-End Month': q.month,
      'Close Volume': q.deals,
      'Total Amount': q.total >= 1_000_000 ? `$${(q.total / 1_000_000).toFixed(1)}M` : q.total >= 1_000 ? `$${(q.total / 1_000).toFixed(0)}K` : `$${q.total}`,
    })) : undefined,
    columns: hasQuarterBias ? ['Q-End Month', 'Close Volume', 'Total Amount'] : undefined,
    confidence: inference.fiscal_year_start_month != null ? 0.8 : 0.5,
    evidence,
    suggested_value: {
      fiscal_year_start_month: fiscalStart,
      quota_period: quotaPeriod,
      quarter_end_months: quarterEnds,
    },
    options: [
      { id: 'annual', label: 'Annual quota', description: 'One target for the whole year' },
      { id: 'quarterly', label: 'Quarterly quota', description: 'Separate Q targets' },
      { id: 'monthly', label: 'Monthly quota', description: 'Monthly attainment tracking' },
    ],
  };
}
