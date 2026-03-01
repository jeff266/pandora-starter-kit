import { query } from '../db.js';

export interface GreetingPayload {
  headline: string;
  subline: string;
  state_summary: string;
  recency_label: string;
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

function getRecencyLabel(hour: number): string {
  if (hour < 12) return 'THIS MORNING';
  if (hour < 17) return 'THIS AFTERNOON';
  return 'TODAY';
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
  const hour = localHour ?? new Date().getUTCHours();
  const timeOfDay = getTimeOfDay(hour);
  const recency_label = getRecencyLabel(hour);

  const [findingsResult, pipelineByNameResult, dealsMovedResult, lastRunResult] = await Promise.allSettled([
    query<{ severity: string; category: string | null; message: string; deal_amount: number | null }>(
      `SELECT severity, category, message, NULL::numeric as deal_amount
       FROM findings
       WHERE workspace_id = $1 AND resolved_at IS NULL AND severity = 'act'
       ORDER BY found_at DESC`,
      [workspaceId]
    ),
    query<{ pipeline: string; deal_count: string; total: string }>(
      `SELECT COALESCE(pipeline, 'Default') as pipeline,
              COUNT(*) as deal_count,
              COALESCE(SUM(amount), 0)::text as total
       FROM deals
       WHERE workspace_id = $1
         AND stage NOT IN (
           SELECT stage_name FROM stage_configs
           WHERE workspace_id = $1 AND (is_won = true OR is_lost = true)
         )
       GROUP BY pipeline
       ORDER BY SUM(amount) DESC`,
      [workspaceId]
    ),
    query<{ count: string }>(
      `SELECT count(*)::text as count
       FROM deals
       WHERE workspace_id = $1 AND updated_at > now() - interval '24 hours'`,
      [workspaceId]
    ),
    query<{ max_started: string | null }>(
      `SELECT MAX(started_at)::text as max_started
       FROM skill_runs
       WHERE workspace_id = $1 AND status = 'completed'`,
      [workspaceId]
    ),
  ]);

  let critical_count = 0;
  let warning_count = 0;
  const greetingFindings: Array<{ category: string | null; message: string; count: number; total_amount: number }> = [];

  if (findingsResult.status === 'fulfilled') {
    const actRows = findingsResult.value.rows;
    critical_count = actRows.length;

    for (const row of actRows) {
      const existing = greetingFindings.find(f => f.category === row.category);
      if (existing) {
        existing.count += 1;
        existing.total_amount += row.deal_amount || 0;
      } else {
        greetingFindings.push({ category: row.category, message: row.message, count: 1, total_amount: row.deal_amount || 0 });
      }
    }
    greetingFindings.sort((a, b) => (b.total_amount || 0) - (a.total_amount || 0));
    greetingFindings.splice(5);
  }

  let pipeline_value = 0;
  let deal_count = 0;
  const pipelineParts: string[] = [];

  if (pipelineByNameResult.status === 'fulfilled' && pipelineByNameResult.value.rows.length > 0) {
    for (const row of pipelineByNameResult.value.rows) {
      const total = parseFloat(row.total) || 0;
      const deals = parseInt(row.deal_count, 10) || 0;
      pipeline_value += total;
      deal_count += deals;
      pipelineParts.push(`${row.pipeline} ${formatCurrencyShort(total)} (${deals})`);
    }
  }

  let deals_moved = 0;
  if (dealsMovedResult.status === 'fulfilled' && dealsMovedResult.value.rows[0]) {
    deals_moved = parseInt(dealsMovedResult.value.rows[0].count, 10) || 0;
  }

  let lastRunAgo = '';
  if (lastRunResult.status === 'fulfilled' && lastRunResult.value.rows[0]?.max_started) {
    const lastRun = new Date(lastRunResult.value.rows[0].max_started);
    const diffHours = Math.round((Date.now() - lastRun.getTime()) / (1000 * 60 * 60));
    if (diffHours < 1) lastRunAgo = 'less than an hour ago';
    else if (diffHours === 1) lastRunAgo = '1 hour ago';
    else lastRunAgo = `${diffHours} hours ago`;
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

  let state_summary: string;
  if (pipeline_value > 0 && pipelineParts.length > 0) {
    const pipelineStr = `Pipeline at ${formatCurrencyShort(pipeline_value)} — ${pipelineParts.join(', ')}`;
    const actCount = greetingFindings.length;
    const findingsSuffix = actCount > 0
      ? `. ${actCount} item${actCount > 1 ? 's' : ''} need${actCount === 1 ? 's' : ''} attention.`
      : '.';
    state_summary = `${pipelineStr}${findingsSuffix}`;
  } else if (greetingFindings.length === 0) {
    const runNote = lastRunAgo ? ` Your operators last ran ${lastRunAgo}.` : '';
    state_summary = `No urgent items.${runNote}`;
  } else {
    const actCount = greetingFindings.length;
    state_summary = `${actCount} item${actCount > 1 ? 's' : ''} need${actCount === 1 ? 's' : ''} attention.`;
  }

  return {
    headline,
    subline,
    recency_label,
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
