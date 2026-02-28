import { query } from '../db.js';

export interface OperatorStatus {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: 'green' | 'amber' | 'red' | 'paused';
  last_run_at: string | null;
  last_run_relative: string;
}

const AGENT_META: Record<string, { name: string; icon: string; color: string }> = {
  'pipeline-state': { name: 'Pipeline State', icon: '📊', color: '#22D3EE' },
  'forecast-call-prep': { name: 'Forecast Call Prep', icon: '🎯', color: '#7C6AE8' },
  'bowtie-review': { name: 'Bowtie Funnel Review', icon: '🔁', color: '#34D399' },
  'attainment-vs-goal': { name: 'Attainment vs Goal', icon: '🏆', color: '#FBBF24' },
  'friday-recap': { name: 'Friday Recap', icon: '📋', color: '#A78BFA' },
  'strategy-insights': { name: 'Strategy & Insights', icon: '🧭', color: '#F472B6' },
};

const AGENT_IDS = Object.keys(AGENT_META);

function formatRelativeTime(date: Date | null): string {
  if (!date) return 'Never';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 5) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD < 7) return `${diffD}d ago`;
  return `${Math.floor(diffD / 7)}w ago`;
}

function deriveStatus(
  lastRunAt: Date | null,
  runStatus: string | null
): 'green' | 'amber' | 'red' {
  if (!lastRunAt) return 'red';
  const diffH = (Date.now() - lastRunAt.getTime()) / 3_600_000;
  if (runStatus === 'failed') return 'red';
  if (diffH < 6 && runStatus === 'completed') return 'green';
  if (diffH < 24) return 'amber';
  return 'red';
}

export async function getOperatorStatuses(workspaceId: string): Promise<OperatorStatus[]> {
  const result = await query<{
    agent_id: string;
    started_at: string | null;
    status: string | null;
  }>(
    `SELECT DISTINCT ON (agent_id)
       agent_id,
       started_at,
       status
     FROM agent_runs
     WHERE workspace_id = $1
       AND agent_id = ANY($2::text[])
     ORDER BY agent_id, started_at DESC`,
    [workspaceId, AGENT_IDS]
  );

  const runsByAgent = new Map(result.rows.map(r => [r.agent_id, r]));

  return AGENT_IDS.map(agentId => {
    const meta = AGENT_META[agentId];
    const run = runsByAgent.get(agentId) ?? null;
    const lastRunAt = run?.started_at ? new Date(run.started_at) : null;
    const status = deriveStatus(lastRunAt, run?.status ?? null);

    return {
      id: agentId,
      name: meta.name,
      icon: meta.icon,
      color: meta.color,
      status,
      last_run_at: run?.started_at ?? null,
      last_run_relative: formatRelativeTime(lastRunAt),
    };
  });
}
