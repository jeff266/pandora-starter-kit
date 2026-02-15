import { query } from '../db.js';
import { getBatchDealRiskScores } from './deal-risk-score.js';

interface PipelineRiskSummary {
  summary: {
    total_deals: number;
    total_value: number;
    avg_health_score: number;
    grade_distribution: { A: number; B: number; C: number; D: number; F: number };
    critical_signal_count: number;
    deals_with_no_signals: number;
  };
  by_stage: Array<{
    stage: string;
    deal_count: number;
    total_value: number;
    avg_health_score: number;
    critical_count: number;
  }>;
  deals: Array<{
    deal_id: string;
    deal_name: string;
    amount: number | null;
    stage: string;
    owner: string;
    close_date: string | null;
    days_in_stage: number | null;
    score: number;
    grade: string;
    signal_counts: { act: number; watch: number; notable: number; info: number };
    top_signal: string | null;
  }>;
  filter: {
    rep_email: string | null;
    stages_included: string[];
  };
  computed_at: string;
}

interface PipelineRiskOptions {
  repEmail?: string;
  sortBy?: 'score' | 'amount' | 'close_date';
  limit?: number;
}

export async function getPipelineRiskSummary(
  workspaceId: string,
  options?: PipelineRiskOptions
): Promise<PipelineRiskSummary> {
  const repEmail = options?.repEmail;
  const sortBy = options?.sortBy || 'score';
  const limit = options?.limit;

  const params: unknown[] = [workspaceId];
  let whereExtra = '';
  if (repEmail) {
    whereExtra = ' AND owner = $2';
    params.push(repEmail);
  }

  const dealsResult = await query(
    `SELECT id, name, amount, stage, stage_normalized, owner, close_date, days_in_stage
     FROM deals
     WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')${whereExtra}
     ORDER BY amount DESC NULLS LAST`,
    params
  );

  const rawDeals = dealsResult.rows as any[];
  if (rawDeals.length === 0) {
    return {
      summary: {
        total_deals: 0,
        total_value: 0,
        avg_health_score: 0,
        grade_distribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
        critical_signal_count: 0,
        deals_with_no_signals: 0,
      },
      by_stage: [],
      deals: [],
      filter: { rep_email: repEmail || null, stages_included: [] },
      computed_at: new Date().toISOString(),
    };
  }

  const dealIds = rawDeals.map(d => d.id);
  const riskScores = await getBatchDealRiskScores(workspaceId, dealIds);

  const scoreMap = new Map(riskScores.map(r => [r.deal_id, r]));

  const mergedDeals = rawDeals.map(d => {
    const risk = scoreMap.get(d.id);
    return {
      deal_id: d.id,
      deal_name: d.name || '',
      amount: d.amount != null ? Number(d.amount) : null,
      stage: d.stage_normalized || d.stage || '',
      owner: d.owner || '',
      close_date: d.close_date ? new Date(d.close_date).toISOString() : null,
      days_in_stage: d.days_in_stage != null ? Number(d.days_in_stage) : null,
      score: risk?.score ?? 100,
      grade: risk?.grade ?? 'A',
      signal_counts: risk?.signal_counts ?? { act: 0, watch: 0, notable: 0, info: 0 },
      top_signal: risk?.signals?.[0]?.message ?? null,
    };
  });

  if (sortBy === 'score') {
    mergedDeals.sort((a, b) => a.score - b.score);
  } else if (sortBy === 'amount') {
    mergedDeals.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  } else if (sortBy === 'close_date') {
    mergedDeals.sort((a, b) => {
      if (!a.close_date && !b.close_date) return 0;
      if (!a.close_date) return 1;
      if (!b.close_date) return -1;
      return new Date(a.close_date).getTime() - new Date(b.close_date).getTime();
    });
  }

  const total_deals = mergedDeals.length;
  const total_value = mergedDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const avg_health_score = total_deals > 0
    ? Math.round(mergedDeals.reduce((sum, d) => sum + d.score, 0) / total_deals)
    : 0;

  const grade_distribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  let critical_signal_count = 0;
  let deals_with_no_signals = 0;
  for (const d of mergedDeals) {
    grade_distribution[d.grade as keyof typeof grade_distribution]++;
    critical_signal_count += d.signal_counts.act;
    const totalSignals = d.signal_counts.act + d.signal_counts.watch + d.signal_counts.notable + d.signal_counts.info;
    if (totalSignals === 0) deals_with_no_signals++;
  }

  const stageMap = new Map<string, {
    deal_count: number;
    total_value: number;
    score_sum: number;
    critical_count: number;
  }>();

  for (const d of mergedDeals) {
    const stage = d.stage;
    const existing = stageMap.get(stage) || { deal_count: 0, total_value: 0, score_sum: 0, critical_count: 0 };
    existing.deal_count++;
    existing.total_value += d.amount ?? 0;
    existing.score_sum += d.score;
    existing.critical_count += d.signal_counts.act;
    stageMap.set(stage, existing);
  }

  const by_stage = Array.from(stageMap.entries()).map(([stage, data]) => ({
    stage,
    deal_count: data.deal_count,
    total_value: data.total_value,
    avg_health_score: data.deal_count > 0 ? Math.round(data.score_sum / data.deal_count) : 0,
    critical_count: data.critical_count,
  }));

  const stages_included = Array.from(new Set(mergedDeals.map(d => d.stage)));

  const finalDeals = limit ? mergedDeals.slice(0, limit) : mergedDeals;

  return {
    summary: {
      total_deals,
      total_value,
      avg_health_score,
      grade_distribution,
      critical_signal_count,
      deals_with_no_signals,
    },
    by_stage,
    deals: finalDeals,
    filter: {
      rep_email: repEmail || null,
      stages_included,
    },
    computed_at: new Date().toISOString(),
  };
}
