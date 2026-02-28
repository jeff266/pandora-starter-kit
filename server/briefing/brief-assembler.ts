import { query } from '../db.js';

export interface BriefItem {
  id: string;
  operator_name: string;
  operator_icon: string;
  operator_color: string;
  severity: 'critical' | 'warning' | 'info';
  headline: string;
  body: string;
  evidence_snapshot?: any;
  skill_run_id: string | null;
  skill_id: string | null;
  created_at: string;
}

const OPERATOR_META: Record<string, { name: string; icon: string; color: string }> = {
  'pipeline-state': { name: 'Pipeline Analyst', icon: '📊', color: '#22D3EE' },
  'forecast-call-prep': { name: 'Forecast Analyst', icon: '🎯', color: '#7C6AE8' },
  'deal-risk-review': { name: 'Deal Analyst', icon: '🔍', color: '#FB923C' },
  'bowtie-review': { name: 'Funnel Analyst', icon: '🔁', color: '#34D399' },
  'attainment-vs-goal': { name: 'Attainment Analyst', icon: '🏆', color: '#FBBF24' },
  'friday-recap': { name: 'Recap Analyst', icon: '📋', color: '#A78BFA' },
  'strategy-insights': { name: 'Strategy Analyst', icon: '🧭', color: '#F472B6' },
  'pipeline-hygiene': { name: 'Data Steward', icon: '🧹', color: '#FBBF24' },
  'deal-scoring-model': { name: 'Deal Analyst', icon: '🔍', color: '#FB923C' },
  'pipeline-coverage': { name: 'Pipeline Analyst', icon: '📊', color: '#22D3EE' },
  'forecast-rollup': { name: 'Forecast Analyst', icon: '🎯', color: '#7C6AE8' },
  'monte-carlo-forecast': { name: 'Forecast Analyst', icon: '🎯', color: '#7C6AE8' },
  'rep-scorecard': { name: 'Coaching Analyst', icon: '🏋️', color: '#34D399' },
  'conversation-intelligence': { name: 'Coaching Analyst', icon: '🏋️', color: '#34D399' },
  'single-thread-alert': { name: 'Deal Analyst', icon: '🔍', color: '#FB923C' },
  'data-quality-audit': { name: 'Data Steward', icon: '🧹', color: '#FBBF24' },
};

function getOperatorMeta(agentId?: string | null, skillId?: string | null): { name: string; icon: string; color: string } {
  if (agentId && OPERATOR_META[agentId]) return OPERATOR_META[agentId];
  if (skillId && OPERATOR_META[skillId]) return OPERATOR_META[skillId];
  return { name: 'Pandora', icon: '✦', color: '#6488EA' };
}

function mapSeverity(sev: string): 'critical' | 'warning' | 'info' {
  if (sev === 'act') return 'critical';
  if (sev === 'watch') return 'warning';
  return 'info';
}

export async function assembleBrief(
  workspaceId: string,
  options: { maxItems?: number; since?: Date } = {}
): Promise<BriefItem[]> {
  const maxItems = options.maxItems ?? 6;
  const since = options.since ?? new Date(Date.now() - 72 * 60 * 60 * 1000);

  const result = await query<{
    id: string;
    severity: string;
    message: string;
    category: string | null;
    skill_id: string | null;
    skill_run_id: string | null;
    found_at: string;
    agent_id: string | null;
    agent_name: string | null;
  }>(
    `SELECT
       f.id,
       f.severity,
       f.message,
       f.category,
       f.skill_id,
       f.skill_run_id,
       f.found_at,
       sr.agent_id,
       a.name as agent_name
     FROM findings f
     LEFT JOIN skill_runs sr ON sr.run_id = f.skill_run_id
     LEFT JOIN agents a ON a.id = sr.agent_id
     WHERE f.workspace_id = $1
       AND f.resolved_at IS NULL
       AND f.found_at > $2
     ORDER BY
       CASE f.severity WHEN 'act' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END ASC,
       f.found_at DESC
     LIMIT $3`,
    [workspaceId, since.toISOString(), maxItems]
  );

  return result.rows.map(row => {
    const meta = getOperatorMeta(row.agent_id, row.skill_id);
    const severity = mapSeverity(row.severity);

    const headline = row.message.length > 80
      ? row.message.substring(0, 77) + '...'
      : row.message;
    const body = row.category ? `Category: ${row.category}` : row.message;

    return {
      id: row.id,
      operator_name: row.agent_name || meta.name,
      operator_icon: meta.icon,
      operator_color: meta.color,
      severity,
      headline,
      body,
      skill_run_id: row.skill_run_id,
      skill_id: row.skill_id,
      created_at: row.found_at,
    };
  });
}
