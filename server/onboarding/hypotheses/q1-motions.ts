import type { CRMScanResult, CompanyResearch, InferenceResult, Hypothesis, SegmentAnalysisSegment } from '../types.js';

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function fmtCycle(days: number | null): string {
  if (days == null) return '—';
  if (days < 7) return `${Math.round(days)}d`;
  if (days < 60) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}

function fmtRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'all amounts';
  if (min == null) return `< ${fmtMoney(max!)}`;
  if (max == null) return `≥ ${fmtMoney(min)}`;
  return `${fmtMoney(min)} – ${fmtMoney(max)}`;
}

export function generateMotionsHypothesis(
  scan: CRMScanResult,
  _research: CompanyResearch,
  _inference: InferenceResult,
): Hypothesis {
  const pipelines = scan.pipelines ?? [];
  const dealTypes = scan.deal_types ?? [];
  const amtDist = scan.amount_distribution;
  const segAnalysis = scan.segment_analysis;

  if (pipelines.length === 0) {
    return {
      summary: 'No deal data found yet. I\'ll treat all deals as one motion by default.',
      confidence: 0.1,
      evidence: 'No deals found in CRM',
      suggested_value: { motions: [{ name: 'All Deals', filter_field: null, filter_values: [], deal_count: 0, avg_size: 0, avg_cycle: null }] },
    };
  }

  if (pipelines.length > 1) {
    const realPipelines = pipelines.filter(p => p.pipeline !== 'Default');
    const displayPipelines = realPipelines.length > 0 ? realPipelines : pipelines;
    return {
      summary: `I found ${displayPipelines.length} pipelines in your CRM. Each looks like a distinct selling motion based on deal size and cycle time. Do these map to how your team thinks about revenue?`,
      table: displayPipelines.map(p => ({
        Motion: p.pipeline,
        Filter: `pipeline = "${p.pipeline}"`,
        Deals: p.count,
        'Avg Size': fmtMoney(p.avg_amount),
        'Median Cycle': p.median_cycle_days != null ? `${Math.round(p.median_cycle_days)}d` : '—',
        'Avg Cycle': p.avg_cycle_days != null ? `${Math.round(p.avg_cycle_days)}d` : '—',
      })),
      columns: ['Motion', 'Filter', 'Deals', 'Avg Size', 'Median Cycle', 'Avg Cycle'],
      confidence: 0.85,
      evidence: `${displayPipelines.length} distinct pipelines with different deal profiles`,
      suggested_value: {
        motions: displayPipelines.map(p => ({
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

  if (segAnalysis) {
    if (segAnalysis.single_motion) {
      return {
        summary: `Your deals appear to follow one selling motion — the cycle times and win rates are relatively consistent regardless of deal size. I'll treat everything as one pipeline unless you see distinct segments I'm missing.`,
        confidence: segAnalysis.confidence,
        evidence: segAnalysis.notes || `${pipelines[0]?.count ?? 0} deals analyzed across size brackets`,
        suggested_value: {
          motions: [{ name: pipelines[0]?.pipeline ?? 'All Deals', filter_field: null, filter_values: [], deal_count: pipelines[0]?.count ?? 0 }],
        },
      };
    }

    const anomalousSegments = segAnalysis.segments.filter(s => s.anomalous);
    const anomalyQuestions = anomalousSegments
      .map(s => s.anomaly_question)
      .filter(Boolean)
      .join(' ');

    const summaryParts = [
      `I see ${segAnalysis.segments.length} patterns in your deal data based on how cycle time and win rate change across deal sizes.`,
    ];
    if (anomalousSegments.length > 0) {
      summaryParts.push(anomalyQuestions);
    }
    summaryParts.push(`Do these reflect genuinely different selling motions, or is some of this data an artifact of how deals are recorded?`);

    return {
      summary: summaryParts.join(' '),
      table: segAnalysis.segments.map(s => ({
        '': s.anomalous ? '⚠️' : '',
        Segment: s.name,
        'Amount Range': fmtRange(s.min_amount, s.max_amount),
        Deals: s.deals,
        'Median Size': fmtMoney(s.median_amount),
        'Median Cycle': fmtCycle(s.median_cycle_days),
        'Win Rate': s.win_rate_pct != null ? `${Math.round(s.win_rate_pct)}%` : '—',
        'Why?': s.rationale,
      })),
      columns: ['', 'Segment', 'Amount Range', 'Deals', 'Median Size', 'Median Cycle', 'Win Rate', 'Why?'],
      confidence: segAnalysis.confidence,
      evidence: segAnalysis.notes || `Analyzed ${scan.amount_cycle_buckets.length} deal size brackets`,
      suggested_value: {
        motions: segAnalysis.segments.map(s => ({
          name: s.name,
          filter_field: 'amount',
          amount_threshold_min: s.min_amount,
          amount_threshold_max: s.max_amount,
          deal_count: s.deals,
          avg_size: s.median_amount,
          anomalous: s.anomalous,
        })),
      },
    };
  }

  if (dealTypes.length > 1) {
    return {
      summary: `You have one pipeline but ${dealTypes.length} deal types — I'll segment by deal type since that's how your team categorizes work. Do these match your revenue motions?`,
      table: dealTypes.map(dt => ({
        Motion: dt.value,
        Filter: `deal_type = "${dt.value}"`,
        Deals: dt.count,
        'Avg Size': fmtMoney(dt.avg_amount),
      })),
      columns: ['Motion', 'Filter', 'Deals', 'Avg Size'],
      confidence: 0.6,
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

  if (amtDist && amtDist.p75 > 0) {
    const buckets = scan.amount_cycle_buckets ?? [];
    const totalPositive = buckets.reduce((sum, b) => sum + b.deals, 0);
    const largeCount = Math.round(totalPositive * 0.25);
    const midCount = Math.round(totalPositive * 0.25);
    const smallCount = totalPositive - largeCount - midCount;

    const steps = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
    const step = steps.find(s => amtDist.p75 / s >= 2) ?? steps[steps.length - 1];
    const highThreshold = Math.round(amtDist.p75 / step) * step || step;
    const midThreshold = Math.round(amtDist.p50 / step) * step || Math.round(step / 2);

    const useEnterpriseLabels = amtDist.p90 > 100_000;
    const [largeLabel, midLabel, smallLabel] = useEnterpriseLabels
      ? ['Enterprise', 'Mid-Market', 'SMB']
      : ['Large', 'Mid', 'Small'];

    return {
      summary: `You have one pipeline with ${pipelines[0]?.count ?? 0} deals. I don't have enough cycle-time data to identify distinct segments automatically — here's a rough size-based split as a starting point. Let me know if these names and thresholds fit how you actually think about your business.`,
      table: [
        { Motion: largeLabel, Filter: `amount ≥ ${fmtMoney(highThreshold)}`, Deals: `~${largeCount}`, 'Median Size': fmtMoney(amtDist.p90) },
        { Motion: midLabel, Filter: `${fmtMoney(midThreshold)} – ${fmtMoney(highThreshold)}`, Deals: `~${midCount}`, 'Median Size': fmtMoney(amtDist.p50) },
        { Motion: smallLabel, Filter: `amount < ${fmtMoney(midThreshold)}`, Deals: `~${smallCount}`, 'Median Size': fmtMoney(amtDist.p10) },
      ],
      columns: ['Motion', 'Filter', 'Deals', 'Median Size'],
      confidence: 0.4,
      evidence: `Amount distribution: p50=${fmtMoney(amtDist.p50)}, p75=${fmtMoney(amtDist.p75)}, p90=${fmtMoney(amtDist.p90)}`,
      suggested_value: {
        motions: [
          { name: largeLabel, filter_field: 'amount', amount_threshold_min: highThreshold, avg_size: Math.round(amtDist.p90) },
          { name: midLabel, filter_field: 'amount', amount_threshold_min: midThreshold, amount_threshold_max: highThreshold - 1, avg_size: Math.round(amtDist.p50) },
          { name: smallLabel, filter_field: 'amount', amount_threshold_max: midThreshold - 1, avg_size: Math.round(amtDist.p10) },
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

export function buildBucketMarkdownTable(buckets: CRMScanResult['amount_cycle_buckets']): string {
  const header = '| Deal Size | Deals | Median Amount | Median Cycle (days) | Win Rate |';
  const divider = '|-----------|-------|---------------|---------------------|----------|';
  const rows = buckets.map(b =>
    `| ${b.bucket} | ${b.deals} | ${fmtMoney(b.median_amount)} | ${b.median_cycle_days ?? '—'} | ${b.win_rate_pct != null ? `${Math.round(b.win_rate_pct)}%` : '—'} |`
  );
  return [header, divider, ...rows].join('\n');
}

export function detectAnomalousSegments(segments: SegmentAnalysisSegment[]): SegmentAnalysisSegment[] {
  if (segments.length < 2) return segments;
  const avgCycle = segments.reduce((sum, s) => sum + (s.median_cycle_days ?? 0), 0) / segments.filter(s => s.median_cycle_days != null).length;
  const avgWinRate = segments.reduce((sum, s) => sum + (s.win_rate_pct ?? 0), 0) / segments.filter(s => s.win_rate_pct != null).length;

  return segments.map(s => {
    const cycleDeviation = s.median_cycle_days != null && avgCycle > 0
      ? Math.abs(s.median_cycle_days - avgCycle) / avgCycle
      : 0;
    const winDeviation = s.win_rate_pct != null && avgWinRate > 0
      ? Math.abs(s.win_rate_pct - avgWinRate) / avgWinRate
      : 0;
    const isAnomalous = s.anomalous || cycleDeviation > 0.5 || winDeviation > 0.5;
    return {
      ...s,
      anomalous: isAnomalous,
      anomaly_question: isAnomalous && !s.anomaly_question
        ? `I notice "${s.name}" has a ${s.median_cycle_days != null ? `${Math.round(s.median_cycle_days)}-day cycle` : 'unusual pattern'} and ${s.win_rate_pct != null ? `${Math.round(s.win_rate_pct)}% win rate` : 'unknown win rate'} — quite different from the other groups. Is this a genuinely separate selling motion, or could it represent a different deal type (e.g. a grant, renewal, or fixed-price contract)?`
        : s.anomaly_question,
    };
  });
}
