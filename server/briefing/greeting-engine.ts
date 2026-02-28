import { query } from '../db.js';

export interface GreetingPayload {
  headline: string;
  subline: string;
  state_summary: string;
  severity: 'calm' | 'attention' | 'urgent';
  metrics: {
    pipeline_value: number;
    coverage_ratio: number;
    critical_count: number;
    warning_count: number;
    deals_moved: number;
  };
}

function getTimeOfDay(localHour?: number): 'morning' | 'afternoon' | 'evening' {
  const hour = localHour ?? new Date().getUTCHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function getSubline(): string {
  const dow = new Date().getUTCDay();
  if (dow === 1) return 'A few things before your week starts.';
  if (dow === 5) return "Here's where the week landed.";
  return "Here's where things stand.";
}

function formatCurrencyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export async function generateGreeting(workspaceId: string, userName?: string, localHour?: number): Promise<GreetingPayload> {
  const timeOfDay = getTimeOfDay(localHour);

  const [findingsResult, pipelineResult, dealsMovedResult] = await Promise.allSettled([
    query<{ severity: string; count: string }>(
      `SELECT severity, count(*)::text as count
       FROM findings
       WHERE workspace_id = $1 AND resolved_at IS NULL
       GROUP BY severity`,
      [workspaceId]
    ),
    query<{ pipeline: string; deals: string }>(
      `SELECT COALESCE(sum(amount), 0)::text as pipeline, count(*)::text as deals
       FROM deals
       WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
      [workspaceId]
    ),
    query<{ count: string }>(
      `SELECT count(*)::text as count
       FROM deals
       WHERE workspace_id = $1 AND updated_at > now() - interval '24 hours'`,
      [workspaceId]
    ),
  ]);

  let critical_count = 0;
  let warning_count = 0;
  if (findingsResult.status === 'fulfilled') {
    for (const row of findingsResult.value.rows) {
      if (row.severity === 'act') critical_count = parseInt(row.count, 10);
      if (row.severity === 'watch') warning_count = parseInt(row.count, 10);
    }
  }

  let pipeline_value = 0;
  let deal_count = 0;
  if (pipelineResult.status === 'fulfilled' && pipelineResult.value.rows[0]) {
    pipeline_value = parseFloat(pipelineResult.value.rows[0].pipeline) || 0;
    deal_count = parseInt(pipelineResult.value.rows[0].deals, 10) || 0;
  }

  let deals_moved = 0;
  if (dealsMovedResult.status === 'fulfilled' && dealsMovedResult.value.rows[0]) {
    deals_moved = parseInt(dealsMovedResult.value.rows[0].count, 10) || 0;
  }

  let severity: 'calm' | 'attention' | 'urgent' = 'calm';
  if (critical_count >= 3) {
    severity = 'urgent';
  } else if (critical_count >= 1 || warning_count >= 3) {
    severity = 'attention';
  }

  const name = userName ? `, ${userName.split(' ')[0]}` : '';
  const headline = `Good ${timeOfDay}${name}.`;
  const subline = getSubline();

  const parts: string[] = [];
  if (pipeline_value > 0) parts.push(`Pipeline at ${formatCurrencyShort(pipeline_value)} across ${deal_count} deals`);
  if (critical_count > 0) parts.push(`${critical_count} critical finding${critical_count !== 1 ? 's' : ''}`);
  if (warning_count > 0) parts.push(`${warning_count} warning${warning_count !== 1 ? 's' : ''}`);
  if (deals_moved > 0) parts.push(`${deals_moved} deal${deals_moved !== 1 ? 's' : ''} updated today`);
  if (parts.length === 0) parts.push('No active findings');
  const state_summary = parts.join('. ') + '.';

  return {
    headline,
    subline,
    state_summary,
    severity,
    metrics: {
      pipeline_value,
      coverage_ratio: 0,
      critical_count,
      warning_count,
      deals_moved,
    },
  };
}
