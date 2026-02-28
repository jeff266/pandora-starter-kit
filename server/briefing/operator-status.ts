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

const AGENT_META: Record<string, { icon: string; color: string }> = {
  'pipeline-state': { icon: '📊', color: '#22D3EE' },
  'forecast-call-prep': { icon: '🎯', color: '#7C6AE8' },
  'bowtie-review': { icon: '🔁', color: '#34D399' },
  'attainment-vs-goal': { icon: '🏆', color: '#FBBF24' },
  'friday-recap': { icon: '📋', color: '#A78BFA' },
  'strategy-insights': { icon: '🧭', color: '#F472B6' },
};

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
  enabled: boolean,
  lastRunAt: Date | null,
  runStatus: string | null
): 'green' | 'amber' | 'red' | 'paused' {
  if (!enabled) return 'paused';
  if (!lastRunAt) return 'red';
  const diffH = (Date.now() - lastRunAt.getTime()) / 3_600_000;
  if (runStatus === 'failed') return 'red';
  if (diffH < 6 && runStatus === 'completed') return 'green';
  if (diffH < 24) return 'amber';
  return 'red';
}

export async function getOperatorStatuses(workspaceId: string): Promise<OperatorStatus[]> {
  const result = await query<{
    id: string;
    agent_id: string;
    name: string;
    enabled: boolean;
    last_run_at: string | null;
    run_status: string | null;
  }>(
    `SELECT
       a.id,
       a.id as agent_id,
       a.name,
       COALESCE(a.enabled, true) as enabled,
       ar.started_at as last_run_at,
       ar.status as run_status
     FROM agents a
     LEFT JOIN LATERAL (
       SELECT started_at, status
       FROM agent_runs
       WHERE agent_id = a.id
       ORDER BY started_at DESC
       LIMIT 1
     ) ar ON true
     WHERE a.workspace_id = $1 OR a.workspace_id IS NULL
     ORDER BY a.name ASC
     LIMIT 10`,
    [workspaceId]
  );

  return result.rows.map(row => {
    const meta = AGENT_META[row.agent_id] ?? { icon: '◈', color: '#6488EA' };
    const lastRunAt = row.last_run_at ? new Date(row.last_run_at) : null;
    const status = deriveStatus(row.enabled, lastRunAt, row.run_status);

    return {
      id: row.id,
      name: row.name,
      icon: meta.icon,
      color: meta.color,
      status,
      last_run_at: row.last_run_at,
      last_run_relative: status === 'paused' ? 'Paused' : formatRelativeTime(lastRunAt),
    };
  });
}
