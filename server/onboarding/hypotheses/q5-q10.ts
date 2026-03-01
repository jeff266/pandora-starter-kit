import type { CRMScanResult, InferenceResult, Hypothesis } from '../types.js';

export function generateStaleHypothesis(scan: CRMScanResult): Hypothesis {
  const stages = scan.stages ?? [];
  const activeStages = stages.filter(s =>
    !['closed_won', 'closed_lost'].some(x => s.stage?.toLowerCase().includes(x.replace('_', ' ')))
    && s.avg_days != null && s.avg_days > 0
  );

  if (activeStages.length === 0) {
    return {
      summary: 'Using default stale thresholds: 14 days warning, 30 days critical.',
      confidence: 0.4,
      evidence: 'No stage velocity data available',
      suggested_value: { thresholds: { stale_days: 14, critical_days: 30 } },
    };
  }

  const avgCycle = activeStages.reduce((s, st) => s + (st.avg_days ?? 0), 0) / activeStages.length;
  const staleDays = Math.round(Math.max(7, avgCycle * 0.5));
  const criticalDays = Math.round(Math.max(14, avgCycle * 1.0));

  const table = activeStages.slice(0, 8).map(s => ({
    Stage: s.stage,
    'Avg Days': `${Math.round(s.avg_days ?? 0)}d`,
    'Stale After': `${Math.round((s.avg_days ?? avgCycle) * 0.75)}d`,
  }));

  return {
    summary: `Based on your average stage duration of ${Math.round(avgCycle)} days, I'd flag deals stale at ${staleDays} days and critical at ${criticalDays} days.`,
    table,
    columns: ['Stage', 'Avg Days', 'Stale After'],
    confidence: 0.7,
    evidence: `Computed from ${activeStages.length} active stages; avg cycle = ${Math.round(avgCycle)} days`,
    suggested_value: { thresholds: { stale_days: staleDays, critical_days: criticalDays } },
  };
}

export function generateForecastHypothesis(scan: CRMScanResult): Hypothesis {
  const fillRates = scan.custom_field_fill_rates ?? [];
  const FORECAST_KEYS = ['forecast', 'forecast_category', 'deal_category', 'close_category', 'commit_category', 'sales_stage'];
  const found = fillRates.filter(f => FORECAST_KEYS.some(k => f.key.toLowerCase().includes(k)));

  if (found.length > 0 && found[0].fill_pct > 40) {
    const best = found[0];
    return {
      summary: `Your team fills in "${best.key}" on ${Math.round(best.fill_pct)}% of deals. I can use rep-set forecast categories instead of stage-based probability.`,
      confidence: 0.8,
      evidence: `Field "${best.key}" has ${Math.round(best.fill_pct)}% fill rate`,
      suggested_value: { forecast_method: 'rep_categories', category_field: best.key },
      options: [
        { id: 'rep_categories', label: `Rep categories (${best.key})`, description: 'Commit / Best Case / Pipeline as set by reps' },
        { id: 'stage_probability', label: 'Stage-based probability', description: 'Weighted by deal stage progression' },
      ],
    };
  }

  return {
    summary: 'I don\'t see a forecast category field being used. I\'ll calculate probability from stage progression.',
    confidence: 0.65,
    evidence: found.length > 0 ? `"${found[0].key}" only ${Math.round(found[0].fill_pct)}% filled — too sparse to rely on` : 'No forecast category fields found',
    suggested_value: { forecast_method: 'stage_probability' },
    options: [
      { id: 'stage_probability', label: 'Stage-based probability', description: 'Weighted by deal stage' },
      { id: 'rep_categories', label: 'Rep forecast categories', description: 'Reps set Commit / Best Case / Pipeline' },
    ],
  };
}

const SAO_KEYWORDS = ['sao', 'sqo', 'qualified', 'qualification', 'accepted', 'mql', 'sql', 'opportunity'];

function guessSAOStage(scan: CRMScanResult, stage0: string[]): string | null {
  const wonLostNames = new Set([
    ...(scan.won_lost ?? []).map(s => s.stage?.toLowerCase() ?? ''),
  ]);
  const stage0Lower = new Set(stage0.map(s => s.toLowerCase()));

  const active = (scan.stages ?? []).filter(s => {
    const lower = s.stage?.toLowerCase() ?? '';
    return s.stage && !wonLostNames.has(lower) && !stage0Lower.has(lower);
  });

  const byKeyword = active.find(s =>
    SAO_KEYWORDS.some(kw => s.stage?.toLowerCase().includes(kw))
  );
  if (byKeyword) return byKeyword.stage;

  return active[0]?.stage ?? null;
}

export function generateWinRateHypothesis(scan: CRMScanResult, inference: InferenceResult): Hypothesis {
  const wonLost = scan.won_lost ?? [];
  const stage0 = inference.stage_0_stages ?? [];

  const won = wonLost.filter(s => s.stage?.toLowerCase().includes('won'));
  const lost = wonLost.filter(s => s.stage?.toLowerCase().includes('lost'));
  const wonCount = won.reduce((s, r) => s + r.count, 0);
  const lostCount = lost.reduce((s, r) => s + r.count, 0);
  const total = wonCount + lostCount;

  const guessedSAO = guessSAOStage(scan, stage0);

  if (total === 0) {
    return {
      summary: 'No closed deal data yet. Win rate tracking will begin once deals close.',
      confidence: 0.1,
      evidence: 'No closed deals found',
      suggested_value: { win_rate: { minimum_stage: null, lookback_days: 180 }, sao_stage: guessedSAO },
    };
  }

  const overallRate = total > 0 ? Math.round((wonCount / total) * 100) : 0;

  const summaryParts: string[] = [
    `Overall win rate: ${overallRate}% (${wonCount} won, ${lostCount} lost).`,
  ];
  if (stage0.length > 0) {
    summaryParts.push(`Excluding pre-qual losses (${stage0.join(', ')}) gives you a higher qualified win rate.`);
  }
  if (guessedSAO) {
    summaryParts.push(`I'll also measure sales cycle from when deals first enter **${guessedSAO}** — is that your qualification gate (SAO/SQO), or should it be a different stage?`);
  }

  return {
    summary: summaryParts.join(' '),
    confidence: 0.75,
    evidence: `${total} closed deals analyzed`,
    suggested_value: {
      exclude_stage_0: stage0.length > 0,
      lookback_days: 180,
      segment_by_motion: false,
      sao_stage: guessedSAO,
    },
    options: [
      { id: 'all_deals', label: 'All closed deals', description: `${overallRate}% win rate` },
      { id: 'qualified_only', label: 'Qualified deals only', description: stage0.length > 0 ? `Excludes losses from ${stage0.slice(0, 2).join(', ')}${stage0.length > 2 ? '…' : ''} stages` : 'Excludes pre-qualification stage losses' },
    ],
  };
}

export function generateCoverageHypothesis(scan: CRMScanResult): Hypothesis {
  const pipelines = scan.pipelines ?? [];
  const totalPipeline = pipelines.reduce((s, p) => s + p.total_amount, 0);

  return {
    summary: `Your current open pipeline totals ${totalPipeline >= 1_000_000 ? `$${(totalPipeline / 1_000_000).toFixed(1)}M` : `$${(totalPipeline / 1000).toFixed(0)}K`}. What coverage multiple should I target?`,
    table: [
      { Motion: 'Enterprise', 'Industry Norm': '3–4×', Typical: 'Longer cycles, big deals' },
      { Motion: 'Mid-Market', 'Industry Norm': '2.5–3×', Typical: 'Balanced velocity' },
      { Motion: 'SMB/Renewal', 'Industry Norm': '1.2–1.5×', Typical: 'High velocity, predictable' },
    ],
    columns: ['Motion', 'Industry Norm', 'Typical'],
    confidence: 0.6,
    evidence: 'Industry benchmarks; actual target depends on your win rate and cycle time',
    suggested_value: { coverage_target: 3.0 },
  };
}

export function generateRequiredFieldsHypothesis(scan: CRMScanResult): Hypothesis {
  const fillRates = (scan.custom_field_fill_rates ?? []).sort((a, b) => b.fill_pct - a.fill_pct);

  const alwaysFilled = fillRates.filter(f => f.fill_pct >= 80);
  const rarelyFilled = fillRates.filter(f => f.fill_pct < 20);

  const table = fillRates.slice(0, 12).map(f => ({
    Field: f.key,
    'Fill Rate': `${Math.round(f.fill_pct)}%`,
    Status: f.fill_pct >= 80 ? '✓ High fill' : f.fill_pct >= 50 ? '~ Partial' : '✗ Sparse',
  }));

  return {
    summary: `${alwaysFilled.length} fields are consistently filled; ${rarelyFilled.length} are rarely used. I'd require only the high-fill ones.`,
    table,
    columns: ['Field', 'Fill Rate', 'Status'],
    confidence: 0.7,
    evidence: `Fill rates from ${fillRates.length} custom fields across all deals`,
    suggested_value: {
      required_fields: ['amount', 'close_date', ...alwaysFilled.slice(0, 3).map(f => f.key)],
      ignored_fields: rarelyFilled.map(f => f.key),
    },
  };
}

export function generateDeliveryHypothesis(): Hypothesis {
  return {
    summary: 'A few quick questions about delivery — no CRM data needed here.',
    confidence: 1.0,
    evidence: 'Setup preferences',
    suggested_value: { cadence: { timezone: 'America/New_York', brief_time: '07:00' } },
    options: [
      { id: 'tz_et', label: 'Eastern Time', description: 'ET (UTC-5/4)' },
      { id: 'tz_ct', label: 'Central Time', description: 'CT (UTC-6/5)' },
      { id: 'tz_mt', label: 'Mountain Time', description: 'MT (UTC-7/6)' },
      { id: 'tz_pt', label: 'Pacific Time', description: 'PT (UTC-8/7)' },
      { id: 'tz_gmt', label: 'GMT / London', description: 'GMT/BST' },
      { id: 'tz_cet', label: 'Central Europe', description: 'CET/CEST' },
    ],
  };
}
