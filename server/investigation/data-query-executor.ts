import { query } from '../db.js';

export interface DataQueryResult {
  type: 'single_value' | 'table' | 'list';
  title: string;
  value?: string;
  subtitle?: string;
  columns?: string[];
  rows?: Record<string, any>[];
  items?: { label: string; value: string; detail?: string }[];
  footnote?: string;
  query_ms: number;
}

function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (!isFinite(num)) return '$0';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

function detectDimension(lower: string): string {
  if (/\b(record\s*type|deal\s*type|record type)\b/i.test(lower)) return 'record_type';
  if (/\b(stage)\b/i.test(lower)) return 'stage';
  if (/\b(owner|rep|sales\s*rep|assigned)\b/i.test(lower)) return 'owner';
  if (/\b(month|quarter|close\s*date)\b/i.test(lower)) return 'close_month';
  if (/\b(pipeline)\b/i.test(lower)) return 'pipeline';
  return 'pipeline';
}

export async function executeDataQuery(
  workspaceId: string,
  message: string,
): Promise<DataQueryResult | null> {
  const startTime = Date.now();
  const lower = message.toLowerCase();

  const [pipelinesRes, wonLostRes] = await Promise.allSettled([
    query<{ pipeline: string }>(
      `SELECT DISTINCT pipeline FROM deals WHERE workspace_id = $1 AND pipeline IS NOT NULL ORDER BY pipeline`,
      [workspaceId],
    ),
    query<{ stage_name: string }>(
      `SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND (is_won = true OR is_lost = true)`,
      [workspaceId],
    ),
  ]);

  const pipelineNames: string[] =
    pipelinesRes.status === 'fulfilled' ? pipelinesRes.value.rows.map((r) => r.pipeline) : [];
  const excludeStages: string[] =
    wonLostRes.status === 'fulfilled' ? wonLostRes.value.rows.map((r) => r.stage_name) : [];

  function detectPipelineFilter(lower: string): { clause: string; params: any[]; label: string | null } {
    for (const name of pipelineNames) {
      if (lower.includes(name.toLowerCase())) {
        return { clause: 'AND pipeline = $PIPE', params: [name], label: name };
      }
    }
    for (const name of pipelineNames) {
      const words = name.toLowerCase().split(/\s+/);
      const matchCount = words.filter((w) => w.length > 3 && lower.includes(w)).length;
      if (matchCount >= 2 || (words.length === 1 && lower.includes(name.toLowerCase()))) {
        return { clause: 'AND pipeline = $PIPE', params: [name], label: name };
      }
    }
    return { clause: '', params: [], label: null };
  }

  function detectStageFilter(lower: string): { clause: string; params: any[] } {
    const stagePatterns: { pattern: RegExp; stage: string }[] = [
      { pattern: /\b(proposal|proposing)\b/i, stage: 'Proposal' },
      { pattern: /\b(discovery|disco)\b/i, stage: 'Discovery' },
      { pattern: /\b(negotiat)/i, stage: 'Negotiation' },
      { pattern: /\b(qualification|qualified)\b/i, stage: 'Qualification' },
      { pattern: /\b(demo)\b/i, stage: 'Demo' },
      { pattern: /\b(evaluation)\b/i, stage: 'Evaluation' },
      { pattern: /\b(verbal|commit)\b/i, stage: 'Verbal' },
    ];
    for (const { pattern, stage } of stagePatterns) {
      if (pattern.test(lower)) {
        return { clause: 'AND stage ILIKE $STAGE', params: [`%${stage}%`] };
      }
    }
    return { clause: '', params: [] };
  }

  function detectAmountFilter(lower: string): { clause: string; params: any[] } {
    const over = lower.match(/\b(over|above|more than|greater than)\s*\$?([\d,.]+)\s*(k|m|million|thousand)?/i);
    if (over) {
      let amount = parseFloat(over[2].replace(/,/g, ''));
      const unit = (over[3] || '').toLowerCase();
      if (unit === 'k' || unit === 'thousand') amount *= 1000;
      if (unit === 'm' || unit === 'million') amount *= 1_000_000;
      return { clause: 'AND amount >= $AMT', params: [amount] };
    }
    const under = lower.match(/\b(under|below|less than)\s*\$?([\d,.]+)\s*(k|m|million|thousand)?/i);
    if (under) {
      let amount = parseFloat(under[2].replace(/,/g, ''));
      const unit = (under[3] || '').toLowerCase();
      if (unit === 'k' || unit === 'thousand') amount *= 1000;
      if (unit === 'm' || unit === 'million') amount *= 1_000_000;
      return { clause: 'AND amount <= $AMT', params: [amount] };
    }
    return { clause: '', params: [] };
  }

  function buildQuery(
    base: string,
    staticParams: any[],
    dynamicFilters: { clause: string; params: any[] }[],
  ): { sql: string; params: any[] } {
    let sql = base;
    const params = [...staticParams];
    let paramIndex = staticParams.length + 1;

    for (const { clause, params: filterParams } of dynamicFilters) {
      if (!clause) continue;
      let resolvedClause = clause;
      for (const p of filterParams) {
        resolvedClause = resolvedClause.replace(/\$(PIPE|STAGE|AMT)/, `$${paramIndex}`);
        params.push(p);
        paramIndex++;
      }
      sql += ` ${resolvedClause}`;
    }

    return { sql, params };
  }

  // ── Pattern 1: "How much pipeline [in X]?" ──────────────────────────────────
  if (/how much\s+(pipeline|revenue)/i.test(lower)) {
    const pipelineFilter = detectPipelineFilter(lower);
    const stageFilter = detectStageFilter(lower);

    const baseSQL = `
      SELECT
        COALESCE(SUM(amount), 0)::numeric as total,
        COUNT(*) as deal_count,
        COALESCE(AVG(amount), 0)::numeric as avg_deal
      FROM deals
      WHERE workspace_id = $1
        AND (stage IS NULL OR stage NOT IN (SELECT unnest($2::text[])))`;

    const { sql, params } = buildQuery(baseSQL, [workspaceId, excludeStages], [pipelineFilter, stageFilter]);

    const result = await query<{ total: string; deal_count: string; avg_deal: string }>(sql, params);
    const row = result.rows[0];
    const filterLabel = pipelineFilter.label ?? 'all pipelines';

    return {
      type: 'single_value',
      title: `Pipeline — ${filterLabel}`,
      value: formatCurrency(parseFloat(row.total)),
      subtitle: `across ${row.deal_count} deals (avg ${formatCurrency(parseFloat(row.avg_deal))})`,
      query_ms: Date.now() - startTime,
    };
  }

  // ── Pattern 2: "Break down by [dimension]" ───────────────────────────────────
  if (/\b(break\s*down|breakdown|split|segment)\b/i.test(lower) || /^pipeline\s+(by|per|across)\s+/i.test(lower)) {
    const dimension = detectDimension(lower);

    let groupByColumn: string;
    let groupByLabel: string;

    switch (dimension) {
      case 'record_type':
        groupByColumn = `COALESCE(custom_fields->>'record_type_name', custom_fields->>'dealtype', 'Unspecified')`;
        groupByLabel = 'Record Type';
        break;
      case 'stage':
        groupByColumn = 'stage';
        groupByLabel = 'Stage';
        break;
      case 'owner':
        groupByColumn = `COALESCE(owner_name, owner_email, 'Unassigned')`;
        groupByLabel = 'Owner';
        break;
      case 'close_month':
        groupByColumn = `TO_CHAR(close_date, 'YYYY-MM')`;
        groupByLabel = 'Close Month';
        break;
      default:
        groupByColumn = `COALESCE(pipeline, 'Default')`;
        groupByLabel = 'Pipeline';
    }

    const result = await query<{ dimension: string; deals: string; total: string; avg_deal: string }>(
      `SELECT
        ${groupByColumn} as dimension,
        COUNT(*) as deals,
        COALESCE(SUM(amount), 0)::numeric as total,
        COALESCE(AVG(amount), 0)::numeric as avg_deal
       FROM deals
       WHERE workspace_id = $1
         AND (stage IS NULL OR stage NOT IN (SELECT unnest($2::text[])))
       GROUP BY ${groupByColumn}
       ORDER BY SUM(amount) DESC NULLS LAST`,
      [workspaceId, excludeStages],
    );

    const grandTotal = result.rows.reduce((sum, r) => sum + parseFloat(r.total), 0);

    return {
      type: 'table',
      title: `Pipeline by ${groupByLabel}`,
      columns: [groupByLabel, 'Deals', 'Amount', 'Avg Deal', '% of Total'],
      rows: result.rows.map((r) => ({
        [groupByLabel]: r.dimension ?? '—',
        Deals: r.deals,
        Amount: formatCurrency(parseFloat(r.total)),
        'Avg Deal': formatCurrency(parseFloat(r.avg_deal)),
        '% of Total': grandTotal > 0 ? `${((parseFloat(r.total) / grandTotal) * 100).toFixed(1)}%` : '—',
      })),
      query_ms: Date.now() - startTime,
    };
  }

  // ── Pattern 3: "How many deals [in stage/pipeline]?" ────────────────────────
  if (/how many\s+(deals?|opportunities?|opps?)/i.test(lower)) {
    const pipelineFilter = detectPipelineFilter(lower);
    const stageFilter = detectStageFilter(lower);

    const baseSQL = `
      SELECT COUNT(*) as count, COALESCE(SUM(amount), 0)::numeric as total
      FROM deals
      WHERE workspace_id = $1
        AND (stage IS NULL OR stage NOT IN (SELECT unnest($2::text[])))`;

    const { sql, params } = buildQuery(baseSQL, [workspaceId, excludeStages], [pipelineFilter, stageFilter]);

    const result = await query<{ count: string; total: string }>(sql, params);
    const row = result.rows[0];

    return {
      type: 'single_value',
      title: 'Deal Count',
      value: row.count.toString(),
      subtitle: `totaling ${formatCurrency(parseFloat(row.total))}`,
      query_ms: Date.now() - startTime,
    };
  }

  // ── Pattern 4: "Average deal size" ──────────────────────────────────────────
  if (/\b(average|avg)\s+(deal|opportunity)\s*(size|value|amount)?/i.test(lower)) {
    const pipelineFilter = detectPipelineFilter(lower);

    const baseSQL = `
      SELECT
        COALESCE(AVG(amount), 0)::numeric as avg_amount,
        COUNT(*) as deal_count,
        COALESCE(MIN(amount), 0)::numeric as min_amount,
        COALESCE(MAX(amount), 0)::numeric as max_amount
      FROM deals
      WHERE workspace_id = $1
        AND (stage IS NULL OR stage NOT IN (SELECT unnest($2::text[])))
        AND amount > 0`;

    const { sql, params } = buildQuery(baseSQL, [workspaceId, excludeStages], [pipelineFilter]);

    const result = await query<{ avg_amount: string; deal_count: string; min_amount: string; max_amount: string }>(
      sql,
      params,
    );
    const row = result.rows[0];

    return {
      type: 'single_value',
      title: 'Average Deal Size',
      value: formatCurrency(parseFloat(row.avg_amount)),
      subtitle: `across ${row.deal_count} deals (range: ${formatCurrency(parseFloat(row.min_amount))} — ${formatCurrency(parseFloat(row.max_amount))})`,
      query_ms: Date.now() - startTime,
    };
  }

  // ── Pattern 5: "List deals [filter]" ────────────────────────────────────────
  if (/^(list|show|give me|pull)\s+(all\s+)?(the\s+)?(open\s+)?(deals?|opportunities?)/i.test(lower)) {
    const pipelineFilter = detectPipelineFilter(lower);
    const stageFilter = detectStageFilter(lower);
    const amountFilter = detectAmountFilter(lower);

    const baseSQL = `
      SELECT
        name as deal_name,
        COALESCE(owner_name, owner_email) as owner,
        stage,
        amount,
        close_date,
        pipeline
      FROM deals
      WHERE workspace_id = $1
        AND (stage IS NULL OR stage NOT IN (SELECT unnest($2::text[])))`;

    const { sql, params } = buildQuery(baseSQL, [workspaceId, excludeStages], [
      pipelineFilter,
      stageFilter,
      amountFilter,
    ]);

    const result = await query<{
      deal_name: string;
      owner: string;
      stage: string;
      amount: string;
      close_date: string;
      pipeline: string;
    }>(sql + ' ORDER BY amount DESC NULLS LAST LIMIT 25', params);

    return {
      type: 'table',
      title: 'Open Deals',
      columns: ['Deal', 'Owner', 'Stage', 'Amount', 'Close Date', 'Pipeline'],
      rows: result.rows.map((r) => ({
        Deal: r.deal_name ?? '—',
        Owner: r.owner ?? '—',
        Stage: r.stage ?? '—',
        Amount: formatCurrency(parseFloat(r.amount) || 0),
        'Close Date': r.close_date ? new Date(r.close_date).toLocaleDateString() : '—',
        Pipeline: r.pipeline ?? '—',
      })),
      footnote: result.rows.length === 25 ? 'Showing top 25 by amount' : undefined,
      query_ms: Date.now() - startTime,
    };
  }

  return null;
}
