import { query } from '../db.js';

export interface HeuristicResult {
  matched: boolean;
  answer?: string;
  data_strategy?: string;
  scope_hint?: { type: string; entity_id?: string; rep_email?: string };
}

const PATTERNS: Array<{
  regex: RegExp;
  handler: (workspaceId: string, match: RegExpMatchArray) => Promise<HeuristicResult>;
  strategy: string;
}> = [
  {
    regex: /^how many deals/i,
    handler: handleDealCount,
    strategy: 'deal_count',
  },
  {
    regex: /^how many (open|active|closed|won|lost) deals/i,
    handler: handleDealCount,
    strategy: 'deal_count',
  },
  {
    regex: /^how many (stale|at[- ]risk|flagged) deals/i,
    handler: handleStaleDealCount,
    strategy: 'findings_count',
  },
  {
    regex: /^how many (findings|issues|alerts|flags)/i,
    handler: handleFindingsCount,
    strategy: 'findings_summary',
  },
  {
    regex: /^(show|list|what are)\s+(\w+(?:\s+\w+)?)'?s?\s+deals/i,
    handler: handleRepDeals,
    strategy: 'rep_deal_list',
  },
  {
    regex: /^(what'?s|how'?s|show)\s+(my|our|the)\s+pipeline/i,
    handler: handlePipelineSummary,
    strategy: 'pipeline_snapshot',
  },
  {
    regex: /^(what'?s|how'?s)\s+(my|our)\s+win rate/i,
    handler: handleWinRate,
    strategy: 'win_rate_calc',
  },
  {
    regex: /^(thanks|thank you|that makes sense|got it|ok|okay|cool|great)\b/i,
    handler: handleAcknowledgment,
    strategy: 'acknowledgment',
  },
  {
    regex: /^(hi|hello|hey|help)\s*$/i,
    handler: handleGreeting,
    strategy: 'greeting',
  },
];

export async function tryHeuristic(
  workspaceId: string,
  message: string
): Promise<HeuristicResult> {
  const trimmed = message.trim();

  for (const pattern of PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      try {
        const result = await pattern.handler(workspaceId, match);
        if (result.matched) {
          result.data_strategy = pattern.strategy;
          return result;
        }
      } catch (err) {
        console.warn(`[heuristic-router] Pattern ${pattern.strategy} failed:`, err);
      }
    }
  }

  return { matched: false };
}

async function handleDealCount(workspaceId: string, match: RegExpMatchArray): Promise<HeuristicResult> {
  const statusFilter = match[1]?.toLowerCase();
  let whereClause = 'workspace_id = $1';
  if (statusFilter === 'open' || statusFilter === 'active') {
    whereClause += ` AND stage_normalized NOT IN ('closed_won', 'closed_lost')`;
  } else if (statusFilter === 'closed' || statusFilter === 'won') {
    whereClause += ` AND stage_normalized = 'closed_won'`;
  } else if (statusFilter === 'lost') {
    whereClause += ` AND stage_normalized = 'closed_lost'`;
  }

  const result = await query<any>(
    `SELECT count(*)::int as total,
       count(*) FILTER (WHERE stage_normalized NOT IN ('closed_won', 'closed_lost'))::int as open,
       count(*) FILTER (WHERE stage_normalized = 'closed_won')::int as won,
       count(*) FILTER (WHERE stage_normalized = 'closed_lost')::int as lost
     FROM deals WHERE ${whereClause}`,
    [workspaceId]
  );

  const row = result.rows[0];
  if (!row) return { matched: true, answer: 'No deals found in your workspace.' };

  if (statusFilter) {
    return {
      matched: true,
      answer: `You have **${row.total}** ${statusFilter} deals.`,
    };
  }

  return {
    matched: true,
    answer: `You have **${row.total}** deals total: **${row.open}** open, **${row.won}** won, **${row.lost}** lost.`,
  };
}

async function handleStaleDealCount(workspaceId: string, _match: RegExpMatchArray): Promise<HeuristicResult> {
  const result = await query<any>(
    `SELECT
       severity,
       count(*)::int as count
     FROM findings
     WHERE workspace_id = $1 AND resolved_at IS NULL
       AND (category ILIKE '%stale%' OR category ILIKE '%risk%' OR category ILIKE '%flag%')
     GROUP BY severity
     ORDER BY CASE severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 ELSE 4 END`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    return { matched: true, answer: 'No stale or at-risk deals found in your current findings.' };
  }

  const total = result.rows.reduce((sum: number, r: any) => sum + r.count, 0);
  const breakdown = result.rows.map((r: any) => `${r.count} ${r.severity}`).join(', ');
  return {
    matched: true,
    answer: `You have **${total}** flagged deal findings: ${breakdown}.`,
  };
}

async function handleFindingsCount(workspaceId: string, _match: RegExpMatchArray): Promise<HeuristicResult> {
  const result = await query<any>(
    `SELECT severity, count(*)::int as count
     FROM findings
     WHERE workspace_id = $1 AND resolved_at IS NULL
     GROUP BY severity
     ORDER BY CASE severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 ELSE 4 END`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    return { matched: true, answer: 'No active findings at the moment.' };
  }

  const total = result.rows.reduce((sum: number, r: any) => sum + r.count, 0);
  const parts = result.rows.map((r: any) => `**${r.count}** ${r.severity}`);
  return {
    matched: true,
    answer: `You have **${total}** active findings: ${parts.join(', ')}.`,
  };
}

async function handleRepDeals(workspaceId: string, match: RegExpMatchArray): Promise<HeuristicResult> {
  const repName = match[2];
  if (!repName || repName.length < 2) return { matched: false };

  const repResult = await query<any>(
    `SELECT DISTINCT owner FROM deals
     WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')
     AND LOWER(owner) LIKE $2
     LIMIT 1`,
    [workspaceId, `%${repName.toLowerCase()}%`]
  );

  if (repResult.rows.length === 0) return { matched: false };

  const repEmail = repResult.rows[0].owner;
  const dealsResult = await query<any>(
    `SELECT name, stage, amount, close_date
     FROM deals
     WHERE workspace_id = $1 AND owner = $2 AND stage_normalized NOT IN ('closed_won', 'closed_lost')
     ORDER BY amount DESC NULLS LAST
     LIMIT 15`,
    [workspaceId, repEmail]
  );

  if (dealsResult.rows.length === 0) {
    return { matched: true, answer: `${repEmail} has no open deals.` };
  }

  const lines = dealsResult.rows.map((d: any) => {
    const amt = d.amount ? `$${(d.amount / 1000).toFixed(0)}K` : 'N/A';
    return `- **${d.name}** — ${d.stage || 'Unknown'} — ${amt}`;
  });

  return {
    matched: true,
    answer: `**${repEmail}** — ${dealsResult.rows.length} open deals:\n\n${lines.join('\n')}`,
    scope_hint: { type: 'rep', rep_email: repEmail },
  };
}

async function handlePipelineSummary(workspaceId: string, _match: RegExpMatchArray): Promise<HeuristicResult> {
  const result = await query<any>(
    `SELECT
       stage_normalized as stage,
       count(*)::int as deal_count,
       COALESCE(sum(amount), 0)::float as total_value
     FROM deals
     WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')
     GROUP BY stage_normalized
     ORDER BY stage_normalized`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    return { matched: true, answer: 'No open pipeline data found.' };
  }

  const totalDeals = result.rows.reduce((s: number, r: any) => s + r.deal_count, 0);
  const totalValue = result.rows.reduce((s: number, r: any) => s + r.total_value, 0);
  const lines = result.rows.map((r: any) =>
    `- **${r.stage || 'Unknown'}**: ${r.deal_count} deals — $${(r.total_value / 1000).toFixed(0)}K`
  );

  return {
    matched: true,
    answer: `**Pipeline Summary** — ${totalDeals} deals, $${(totalValue / 1000).toFixed(0)}K total\n\n${lines.join('\n')}`,
    scope_hint: { type: 'pipeline' },
  };
}

async function handleWinRate(workspaceId: string, _match: RegExpMatchArray): Promise<HeuristicResult> {
  const result = await query<any>(
    `SELECT
       count(*) FILTER (WHERE stage_normalized = 'closed_won')::int as won,
       count(*) FILTER (WHERE stage_normalized IN ('closed_won', 'closed_lost'))::int as closed
     FROM deals
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const row = result.rows[0];
  if (!row || row.closed === 0) {
    return { matched: true, answer: 'Not enough closed deals to calculate a win rate yet.' };
  }

  const winRate = ((row.won / row.closed) * 100).toFixed(1);
  return {
    matched: true,
    answer: `Your overall win rate is **${winRate}%** (${row.won} won out of ${row.closed} closed deals).`,
  };
}

async function handleAcknowledgment(_workspaceId: string, _match: RegExpMatchArray): Promise<HeuristicResult> {
  return {
    matched: true,
    answer: `Got it. Let me know if you have any other questions about your pipeline or data.`,
  };
}

async function handleGreeting(_workspaceId: string, _match: RegExpMatchArray): Promise<HeuristicResult> {
  return {
    matched: true,
    answer: `Hi! I can help with your pipeline, deals, reps, and forecast. Try asking:\n\n- "What's our pipeline looking like?"\n- "Which deals are at risk?"\n- "Show me Sara's deals"\n- "What's our win rate?"`,
  };
}
