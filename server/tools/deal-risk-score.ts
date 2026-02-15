import { query } from '../db.js';

interface DealRiskSignal {
  skill_id: string;
  severity: 'act' | 'watch' | 'notable' | 'info';
  category: string;
  message: string;
  found_at: string;
}

export interface DealRiskResult {
  deal_id: string;
  deal_name: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  signals: DealRiskSignal[];
  signal_counts: { act: number; watch: number; notable: number; info: number };
  skills_evaluated: string[];
  skills_missing: string[];
  data_freshness: string | null;
  scored_at: string;
}

const EXPECTED_SKILLS = ['pipeline-hygiene', 'single-thread-alert', 'data-quality-audit', 'pipeline-coverage'];

const SEVERITY_PENALTIES: Record<string, number> = {
  act: 25,
  watch: 10,
  notable: 3,
  info: 1,
};

function computeGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 50) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

function computeScoreFromSignals(signals: DealRiskSignal[]): {
  score: number;
  signal_counts: { act: number; watch: number; notable: number; info: number };
} {
  const signal_counts = { act: 0, watch: 0, notable: 0, info: 0 };
  let score = 100;
  for (const s of signals) {
    const sev = s.severity as keyof typeof signal_counts;
    if (sev in signal_counts) signal_counts[sev]++;
    score -= SEVERITY_PENALTIES[s.severity] ?? 0;
  }
  return { score: Math.max(0, score), signal_counts };
}

export async function getDealRiskScore(workspaceId: string, dealId: string): Promise<DealRiskResult> {
  const [dealResult, findingsResult, skillRunsResult] = await Promise.all([
    query('SELECT id, name FROM deals WHERE id = $1 AND workspace_id = $2', [dealId, workspaceId]),
    query(
      `SELECT skill_id, severity, category, message, found_at
       FROM findings
       WHERE workspace_id = $1 AND deal_id = $2 AND resolved_at IS NULL
       ORDER BY CASE severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 ELSE 4 END`,
      [workspaceId, dealId]
    ),
    query(
      `SELECT DISTINCT ON (skill_id) skill_id, completed_at
       FROM skill_runs
       WHERE workspace_id = $1 AND status = 'completed'
       ORDER BY skill_id, completed_at DESC`,
      [workspaceId]
    ),
  ]);

  const deal = dealResult.rows[0];
  if (!deal) throw new Error(`Deal ${dealId} not found in workspace ${workspaceId}`);

  const signals: DealRiskSignal[] = findingsResult.rows.map((r: any) => ({
    skill_id: r.skill_id,
    severity: r.severity,
    category: r.category,
    message: r.message,
    found_at: r.found_at ? new Date(r.found_at).toISOString() : '',
  }));

  const { score, signal_counts } = computeScoreFromSignals(signals);

  const evaluatedSkills = new Set(skillRunsResult.rows.map((r: any) => r.skill_id));
  const skills_evaluated = Array.from(evaluatedSkills);
  const skills_missing = EXPECTED_SKILLS.filter(s => !evaluatedSkills.has(s));

  let data_freshness: string | null = null;
  if (skillRunsResult.rows.length > 0) {
    const oldest = skillRunsResult.rows.reduce((min: any, r: any) => {
      const t = new Date(r.completed_at).getTime();
      return t < min.time ? { time: t, date: r.completed_at } : min;
    }, { time: Infinity, date: null });
    data_freshness = oldest.date ? new Date(oldest.date).toISOString() : null;
  }

  return {
    deal_id: deal.id,
    deal_name: deal.name || '',
    score,
    grade: computeGrade(score),
    signals,
    signal_counts,
    skills_evaluated,
    skills_missing,
    data_freshness,
    scored_at: new Date().toISOString(),
  };
}

export async function getBatchDealRiskScores(workspaceId: string, dealIds?: string[]): Promise<DealRiskResult[]> {
  let deals: Array<{ id: string; name: string }>;

  if (dealIds && dealIds.length > 0) {
    const result = await query(
      'SELECT id, name FROM deals WHERE workspace_id = $1 AND id = ANY($2)',
      [workspaceId, dealIds]
    );
    deals = result.rows;
  } else {
    const result = await query(
      `SELECT id, name FROM deals WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
      [workspaceId]
    );
    deals = result.rows;
  }

  if (deals.length === 0) return [];

  const ids = deals.map(d => d.id);

  const [findingsResult, skillRunsResult] = await Promise.all([
    query(
      `SELECT deal_id, skill_id, severity, category, message, found_at
       FROM findings
       WHERE workspace_id = $1 AND deal_id = ANY($2) AND resolved_at IS NULL`,
      [workspaceId, ids]
    ),
    query(
      `SELECT DISTINCT ON (skill_id) skill_id, completed_at
       FROM skill_runs
       WHERE workspace_id = $1 AND status = 'completed'
       ORDER BY skill_id, completed_at DESC`,
      [workspaceId]
    ),
  ]);

  const findingsByDeal = new Map<string, DealRiskSignal[]>();
  for (const r of findingsResult.rows as any[]) {
    const list = findingsByDeal.get(r.deal_id) || [];
    list.push({
      skill_id: r.skill_id,
      severity: r.severity,
      category: r.category,
      message: r.message,
      found_at: r.found_at ? new Date(r.found_at).toISOString() : '',
    });
    findingsByDeal.set(r.deal_id, list);
  }

  const evaluatedSkills = new Set(skillRunsResult.rows.map((r: any) => r.skill_id));
  const skills_evaluated = Array.from(evaluatedSkills);
  const skills_missing = EXPECTED_SKILLS.filter(s => !evaluatedSkills.has(s));

  let data_freshness: string | null = null;
  if (skillRunsResult.rows.length > 0) {
    const oldest = skillRunsResult.rows.reduce((min: any, r: any) => {
      const t = new Date(r.completed_at).getTime();
      return t < min.time ? { time: t, date: r.completed_at } : min;
    }, { time: Infinity, date: null });
    data_freshness = oldest.date ? new Date(oldest.date).toISOString() : null;
  }

  const scored_at = new Date().toISOString();

  return deals.map(deal => {
    const signals = findingsByDeal.get(deal.id) || [];
    signals.sort((a, b) => {
      const order: Record<string, number> = { act: 1, watch: 2, notable: 3, info: 4 };
      return (order[a.severity] ?? 5) - (order[b.severity] ?? 5);
    });
    const { score, signal_counts } = computeScoreFromSignals(signals);

    return {
      deal_id: deal.id,
      deal_name: deal.name || '',
      score,
      grade: computeGrade(score),
      signals,
      signal_counts,
      skills_evaluated,
      skills_missing,
      data_freshness,
      scored_at,
    };
  });
}
