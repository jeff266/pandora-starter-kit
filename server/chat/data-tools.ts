/**
 * Data Tools for Ask Pandora
 *
 * Parameterized SQL query functions invoked by the agentic loop.
 * No LLM calls — pure database access with workspace scoping enforced everywhere.
 */

import { query } from '../db.js';

// ─── Tool result types ───────────────────────────────────────────────────────

export interface DealRecord {
  id: string;
  name: string;
  amount: number;
  stage: string;
  stage_normalized: string;
  close_date: string | null;
  owner_name: string;
  owner_email: string;
  account_name: string | null;
  account_id: string | null;
  probability: number | null;
  forecast_category: string | null;
  days_in_stage: number;
  created_date: string | null;
  pipeline_name: string | null;
  is_open: boolean;
}

export interface QueryDealsResult {
  deals: DealRecord[];
  total_count: number;
  total_amount: number;
  query_description: string;
}

export interface AccountRecord {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  owner_name: string | null;
  open_deal_count: number;
  total_pipeline: number;
  last_activity_date: string | null;
}

export interface QueryAccountsResult {
  accounts: AccountRecord[];
  total_count: number;
  query_description: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  date: string | null;
  duration_minutes: number | null;
  source: string;
  account_name: string | null;
  deal_name: string | null;
  rep_name: string | null;
  rep_email: string | null;
  external_participants: { name: string; email: string }[];
  summary: string | null;
  transcript_excerpt: string | null;
  talk_ratio: number | null;
  longest_monologue_seconds: number | null;
  interactivity: number | null;
  // Structured signal fields populated by Gong/Fireflies parsers
  objections: any[] | null;
  competitor_mentions: any[] | null;
  topics: any[] | null;
}

export interface QueryConversationsResult {
  conversations: ConversationRecord[];
  total_count: number;
  summary_coverage: number;
  transcript_coverage: number;
  query_description: string;
}

export interface SkillEvidenceResult {
  skill_id: string;
  last_run_at: string;
  is_stale: boolean;
  claims: {
    severity: string;
    category: string;
    message: string;
    entity_type: string | null;
    entity_id: string | null;
    entity_name: string | null;
    metric_value: any;
  }[];
  evaluated_records: any[];
  parameters: object;
  summary: string | null;
  record_count: number;
  claim_count: number;
}

export interface ComputeMetricResult {
  metric: string;
  value: number;
  formatted: string;
  formula: string;
  inputs: { numerator: number | null; denominator: number | null; description: string };
  underlying_records: { id: string; name: string; amount: number; included_because: string }[];
  exclusions: { reason: string; count: number }[];
  record_count: number;
  period: string;
  query_description: string;
}

export interface ContactRecord {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  account_name: string | null;
  role: string | null;
  last_activity_date: string | null;
  conversation_count: number;
}

export interface QueryContactsResult {
  contacts: ContactRecord[];
  total_count: number;
  query_description: string;
}

export interface ActivityEvent {
  date: string;
  type: string;
  description: string;
  actor: string | null;
  deal_name: string | null;
  metadata: object;
}

export interface QueryActivityTimelineResult {
  events: ActivityEvent[];
  total_count: number;
  span_days: number;
  query_description: string;
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function executeDataTool(
  workspaceId: string,
  toolName: string,
  params: Record<string, any>
): Promise<any> {
  switch (toolName) {
    case 'query_deals':
      return queryDeals(workspaceId, params);
    case 'query_accounts':
      return queryAccounts(workspaceId, params);
    case 'query_conversations':
      return queryConversations(workspaceId, params);
    case 'get_skill_evidence':
      return getSkillEvidence(workspaceId, params);
    case 'compute_metric':
      return computeMetric(workspaceId, params);
    case 'query_contacts':
      return queryContacts(workspaceId, params);
    case 'query_activity_timeline':
      return queryActivityTimeline(workspaceId, params);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ─── Tool 1: query_deals ─────────────────────────────────────────────────────

async function queryDeals(workspaceId: string, params: Record<string, any>): Promise<QueryDealsResult> {
  const conditions: string[] = ['d.workspace_id = $1'];
  const values: any[] = [workspaceId];
  const descParts: string[] = [];

  function addParam(val: any): string {
    values.push(val);
    return `$${values.length}`;
  }

  if (params.is_open === true) {
    conditions.push(`d.stage_normalized NOT IN ('closed_won', 'closed_lost')`);
    descParts.push('open');
  } else if (params.is_open === false) {
    conditions.push(`d.stage_normalized IN ('closed_won', 'closed_lost')`);
    descParts.push('closed');
  }

  if (params.stage) {
    conditions.push(`(d.stage ILIKE ${addParam(`%${params.stage}%`)} OR d.stage_normalized ILIKE ${values[values.length - 1]})`);
    descParts.push(`stage~"${params.stage}"`);
  }

  if (params.owner_email) {
    conditions.push(`LOWER(d.owner) = ${addParam(params.owner_email.toLowerCase())}`);
    descParts.push(`owner=${params.owner_email}`);
  } else if (params.owner_name) {
    conditions.push(`d.owner ILIKE ${addParam(`%${params.owner_name}%`)}`);
    descParts.push(`owner~"${params.owner_name}"`);
  }

  if (params.account_id) {
    conditions.push(`d.account_id = ${addParam(params.account_id)}`);
  }

  if (params.account_name) {
    conditions.push(`a.name ILIKE ${addParam(`%${params.account_name}%`)}`);
    descParts.push(`account~"${params.account_name}"`);
  }

  if (params.close_date_from) {
    conditions.push(`d.close_date >= ${addParam(params.close_date_from)}`);
    descParts.push(`close>=${params.close_date_from}`);
  }

  if (params.close_date_to) {
    conditions.push(`d.close_date <= ${addParam(params.close_date_to)}`);
    descParts.push(`close<=${params.close_date_to}`);
  }

  if (params.amount_min != null) {
    conditions.push(`d.amount >= ${addParam(params.amount_min)}`);
  }

  if (params.amount_max != null) {
    conditions.push(`d.amount <= ${addParam(params.amount_max)}`);
  }

  if (params.created_after) {
    conditions.push(`d.created_at >= ${addParam(params.created_after)}`);
  }

  if (params.created_before) {
    conditions.push(`d.created_at <= ${addParam(params.created_before)}`);
  }

  if (params.forecast_category) {
    conditions.push(`LOWER(d.forecast_category) = ${addParam(params.forecast_category.toLowerCase())}`);
    descParts.push(`forecast=${params.forecast_category}`);
  }

  if (params.has_findings === true) {
    conditions.push(`EXISTS (SELECT 1 FROM findings f WHERE f.deal_id = d.id AND f.resolved_at IS NULL)`);
  }

  const allowedOrderBy: Record<string, string> = {
    amount: 'd.amount',
    close_date: 'd.close_date',
    created_date: 'd.created_at',
    days_in_stage: 'days_in_stage',
  };
  const orderField = allowedOrderBy[params.order_by] || 'd.amount';
  const orderDir = params.order_dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(params.limit || 50, 200);

  const where = conditions.join(' AND ');

  const countResult = await query<{ cnt: string; total_amt: string }>(
    `SELECT COUNT(*)::text as cnt, COALESCE(SUM(d.amount), 0)::text as total_amt
     FROM deals d
     LEFT JOIN accounts a ON a.id = d.account_id AND a.workspace_id = d.workspace_id
     WHERE ${where}`,
    values
  );
  const totalCount = parseInt(countResult.rows[0]?.cnt || '0');
  const totalAmount = parseFloat(countResult.rows[0]?.total_amt || '0');

  const rows = await query<any>(
    `SELECT d.id, d.name, d.amount, COALESCE(d.stage, d.stage_normalized) as stage, d.stage_normalized,
            d.close_date, d.owner as owner_name, d.owner as owner_email,
            a.name as account_name, d.account_id,
            d.probability, d.forecast_category,
            EXTRACT(DAY FROM NOW() - d.created_at)::int as days_in_stage,
            d.created_at as created_date,
            d.pipeline as pipeline_name,
            (d.stage_normalized NOT IN ('closed_won', 'closed_lost')) as is_open
     FROM deals d
     LEFT JOIN accounts a ON a.id = d.account_id AND a.workspace_id = d.workspace_id
     WHERE ${where}
     ORDER BY ${orderField} ${orderDir} NULLS LAST
     LIMIT ${addParam(limit)}`,
    values
  );

  const description = descParts.length > 0
    ? `Deals matching: ${descParts.join(', ')}`
    : 'All deals';

  return {
    deals: rows.rows,
    total_count: totalCount,
    total_amount: totalAmount,
    query_description: `${description} — ${totalCount} records, $${(totalAmount / 1000).toFixed(0)}K total`,
  };
}

// ─── Tool 2: query_accounts ──────────────────────────────────────────────────

async function queryAccounts(workspaceId: string, params: Record<string, any>): Promise<QueryAccountsResult> {
  const conditions: string[] = ['a.workspace_id = $1'];
  const values: any[] = [workspaceId];
  const descParts: string[] = [];

  function addParam(val: any): string {
    values.push(val);
    return `$${values.length}`;
  }

  if (params.name) {
    conditions.push(`a.name ILIKE ${addParam(`%${params.name}%`)}`);
    descParts.push(`name~"${params.name}"`);
  }

  if (params.domain) {
    conditions.push(`a.domain ILIKE ${addParam(`%${params.domain}%`)}`);
    descParts.push(`domain~"${params.domain}"`);
  }

  if (params.industry) {
    conditions.push(`a.industry ILIKE ${addParam(`%${params.industry}%`)}`);
    descParts.push(`industry~"${params.industry}"`);
  }

  if (params.owner_email) {
    conditions.push(`LOWER(a.owner) = ${addParam(params.owner_email.toLowerCase())}`);
    descParts.push(`owner=${params.owner_email}`);
  }

  if (params.has_open_deals === true) {
    conditions.push(`EXISTS (SELECT 1 FROM deals d WHERE d.account_id = a.id AND d.stage_normalized NOT IN ('closed_won', 'closed_lost'))`);
    descParts.push('with open deals');
  }

  const allowedOrderBy: Record<string, string> = {
    name: 'a.name',
    pipeline_value: 'total_pipeline',
    deal_count: 'open_deal_count',
    last_activity: 'a.created_at',
  };
  const orderField = allowedOrderBy[params.order_by] || 'a.name';
  const limit = Math.min(params.limit || 50, 200);
  const where = conditions.join(' AND ');

  const countResult = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt FROM accounts a WHERE ${where}`,
    values
  );
  const totalCount = parseInt(countResult.rows[0]?.cnt || '0');

  let havingClause = '';
  if (params.min_pipeline_value != null) {
    havingClause = `HAVING COALESCE(SUM(d.amount) FILTER (WHERE d.stage_normalized NOT IN ('closed_won','closed_lost')), 0) >= ${addParam(params.min_pipeline_value)}`;
  }

  const rows = await query<any>(
    `SELECT a.id, a.name, a.domain, a.industry, a.employee_count,
            a.owner as owner_name,
            COUNT(d.id) FILTER (WHERE d.stage_normalized NOT IN ('closed_won','closed_lost'))::int as open_deal_count,
            COALESCE(SUM(d.amount) FILTER (WHERE d.stage_normalized NOT IN ('closed_won','closed_lost')), 0) as total_pipeline,
            a.created_at as last_activity_date
     FROM accounts a
     LEFT JOIN deals d ON d.account_id = a.id AND d.workspace_id = a.workspace_id
     WHERE ${where}
     GROUP BY a.id, a.name, a.domain, a.industry, a.employee_count, a.owner, a.created_at
     ${havingClause}
     ORDER BY ${orderField} ASC NULLS LAST
     LIMIT ${addParam(limit)}`,
    values
  );

  return {
    accounts: rows.rows,
    total_count: totalCount,
    query_description: `Accounts matching: ${descParts.length > 0 ? descParts.join(', ') : 'all'} — ${totalCount} total`,
  };
}

// ─── Tool 3: query_conversations ────────────────────────────────────────────

async function queryConversations(workspaceId: string, params: Record<string, any>): Promise<QueryConversationsResult> {
  const conditions: string[] = ['cv.workspace_id = $1'];
  const values: any[] = [workspaceId];
  const descParts: string[] = [];

  function addParam(val: any): string {
    values.push(val);
    return `$${values.length}`;
  }

  // Default: exclude internal calls
  const isInternal = params.is_internal === true ? true : false;
  conditions.push(`cv.is_internal = ${addParam(isInternal)}`);

  if (params.account_id) {
    conditions.push(`cv.account_id = ${addParam(params.account_id)}`);
  }

  if (params.account_name) {
    conditions.push(`a.name ILIKE ${addParam(`%${params.account_name}%`)}`);
    descParts.push(`account~"${params.account_name}"`);
  }

  if (params.deal_id) {
    conditions.push(`cv.deal_id = ${addParam(params.deal_id)}`);
  }

  if (params.rep_email) {
    conditions.push(`cv.participants::text ILIKE ${addParam(`%${params.rep_email}%`)}`);
    descParts.push(`rep=${params.rep_email}`);
  }

  if (params.since) {
    conditions.push(`cv.call_date >= ${addParam(params.since)}`);
    descParts.push(`since ${params.since}`);
  }

  if (params.until) {
    conditions.push(`cv.call_date <= ${addParam(params.until)}`);
    descParts.push(`until ${params.until}`);
  }

  if (params.title_contains) {
    conditions.push(`cv.title ILIKE ${addParam(`%${params.title_contains}%`)}`);
    descParts.push(`title~"${params.title_contains}"`);
  }

  if (params.transcript_search) {
    conditions.push(`cv.transcript_text ILIKE ${addParam(`%${params.transcript_search}%`)}`);
    descParts.push(`transcript~"${params.transcript_search}"`);
  }

  if (params.summary_search) {
    conditions.push(`cv.summary ILIKE ${addParam(`%${params.summary_search}%`)}`);
    descParts.push(`summary~"${params.summary_search}"`);
  }

  if (params.min_duration_minutes != null) {
    conditions.push(`cv.duration_seconds >= ${addParam(params.min_duration_minutes * 60)}`);
  }

  if (params.source) {
    conditions.push(`cv.source = ${addParam(params.source)}`);
    descParts.push(`source=${params.source}`);
  }

  const allowedOrderBy: Record<string, string> = {
    date: 'cv.call_date',
    duration: 'cv.duration_seconds',
    account_name: 'a.name',
  };
  const orderField = allowedOrderBy[params.order_by] || 'cv.call_date';
  const limit = Math.min(params.limit || 30, 100);
  const where = conditions.join(' AND ');

  const countResult = await query<{ cnt: string; summ: string; trans: string }>(
    `SELECT COUNT(*)::text as cnt,
            COUNT(*) FILTER (WHERE cv.summary IS NOT NULL)::text as summ,
            COUNT(*) FILTER (WHERE cv.transcript_text IS NOT NULL)::text as trans
     FROM conversations cv
     LEFT JOIN accounts a ON a.id = cv.account_id AND a.workspace_id = cv.workspace_id
     WHERE ${where}`,
    values
  );
  const totalCount = parseInt(countResult.rows[0]?.cnt || '0');
  const summCnt = parseInt(countResult.rows[0]?.summ || '0');
  const transCnt = parseInt(countResult.rows[0]?.trans || '0');
  const summaryCoverage = totalCount > 0 ? Math.round((summCnt / totalCount) * 100) : 0;
  const transcriptCoverage = totalCount > 0 ? Math.round((transCnt / totalCount) * 100) : 0;

  const rows = await query<any>(
    `SELECT cv.id, cv.title, cv.call_date as date,
            ROUND(cv.duration_seconds::numeric / 60, 1) as duration_minutes,
            cv.source,
            a.name as account_name,
            d.name as deal_name,
            cv.participants,
            cv.summary,
            cv.source_data,
            cv.objections,
            cv.competitor_mentions,
            cv.topics
     FROM conversations cv
     LEFT JOIN accounts a ON a.id = cv.account_id AND a.workspace_id = cv.workspace_id
     LEFT JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = cv.workspace_id
     WHERE ${where}
     ORDER BY ${orderField} DESC NULLS LAST
     LIMIT ${addParam(limit)}`,
    values
  );

  const includeExcerpts = params.include_transcript_excerpts === true;
  const excerptKeyword: string | null = params.excerpt_keyword || null;

  let conversations: ConversationRecord[] = [];
  if (includeExcerpts && excerptKeyword) {
    // Fetch transcript excerpts for rows that match
    const excRows = await query<{ id: string; transcript_text: string }>(
      `SELECT cv.id, cv.transcript_text
       FROM conversations cv
       LEFT JOIN accounts a ON a.id = cv.account_id AND a.workspace_id = cv.workspace_id
       WHERE ${where} AND cv.transcript_text ILIKE ${addParam(`%${excerptKeyword}%`)}
       LIMIT ${addParam(limit)}`,
      values
    );
    const excerptMap = new Map<string, string>();
    for (const r of excRows.rows) {
      const idx = r.transcript_text?.toLowerCase().indexOf(excerptKeyword.toLowerCase());
      if (idx !== undefined && idx >= 0) {
        const start = Math.max(0, idx - 150);
        const end = Math.min(r.transcript_text.length, idx + 300);
        excerptMap.set(r.id, `...${r.transcript_text.slice(start, end)}...`);
      }
    }
    conversations = rows.rows.map(r => mapConversationRow(r, excerptMap.get(r.id) || null));
  } else {
    conversations = rows.rows.map(r => mapConversationRow(r, null));
  }

  return {
    conversations,
    total_count: totalCount,
    summary_coverage: summaryCoverage,
    transcript_coverage: transcriptCoverage,
    query_description: `Conversations (${descParts.length > 0 ? descParts.join(', ') : 'all'}) — ${totalCount} total, ${summaryCoverage}% have summaries`,
  };
}

function mapConversationRow(r: any, excerpt: string | null): ConversationRecord {
  // Parse participants from JSONB — format varies by connector
  let repName: string | null = null;
  let repEmail: string | null = null;
  let externalParticipants: { name: string; email: string }[] = [];

  try {
    const parts = r.participants;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (p.affiliation === 'Internal' || p.type === 'host') {
          if (!repName) {
            repName = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || null;
            repEmail = p.emailAddress || p.email || null;
          }
        } else {
          externalParticipants.push({
            name: p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Unknown',
            email: p.emailAddress || p.email || '',
          });
        }
      }
    }
  } catch {}

  // Gong-specific signals from source_data
  let talkRatio: number | null = null;
  let longestMonologue: number | null = null;
  let interactivity: number | null = null;
  try {
    const sd = r.source_data;
    if (sd?.metaData) {
      talkRatio = sd.metaData.speakerTalkRatio ?? null;
      longestMonologue = sd.metaData.longestMonologueDuration ?? null;
      interactivity = sd.metaData.interactivity ?? null;
    }
  } catch {}

  return {
    id: r.id,
    title: r.title,
    date: r.date,
    duration_minutes: r.duration_minutes ? parseFloat(r.duration_minutes) : null,
    source: r.source,
    account_name: r.account_name || null,
    deal_name: r.deal_name || null,
    rep_name: repName,
    rep_email: repEmail,
    external_participants: externalParticipants,
    summary: r.summary || null,
    transcript_excerpt: excerpt,
    talk_ratio: talkRatio,
    longest_monologue_seconds: longestMonologue,
    interactivity,
    objections: Array.isArray(r.objections) && r.objections.length > 0 ? r.objections : null,
    competitor_mentions: Array.isArray(r.competitor_mentions) && r.competitor_mentions.length > 0 ? r.competitor_mentions : null,
    topics: Array.isArray(r.topics) && r.topics.length > 0 ? r.topics : null,
  };
}

// ─── Tool 4: get_skill_evidence ──────────────────────────────────────────────

async function getSkillEvidence(workspaceId: string, params: Record<string, any>): Promise<SkillEvidenceResult | null> {
  const { skill_id, max_age_hours = 24, filter_severity, filter_entity_id } = params;

  if (!skill_id) throw new Error('skill_id is required for get_skill_evidence');

  // Find the most recent completed skill run
  const runResult = await query<any>(
    `SELECT id, started_at, completed_at, result, output_text, output
     FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
       AND completed_at >= NOW() - ($3 || ' hours')::interval
     ORDER BY completed_at DESC
     LIMIT 1`,
    [workspaceId, skill_id, max_age_hours]
  );

  if (runResult.rows.length === 0) return null;

  const run = runResult.rows[0];
  const isStale = false; // if we got here it's within max_age_hours

  // Pull findings from the findings table for this skill run
  const findingsConditions: string[] = [
    'f.workspace_id = $1',
    'f.skill_id = $2',
    'f.resolved_at IS NULL',
  ];
  const findingsValues: any[] = [workspaceId, skill_id];

  if (filter_severity) {
    findingsValues.push(filter_severity);
    findingsConditions.push(`f.severity = $${findingsValues.length}`);
  }

  if (filter_entity_id) {
    findingsValues.push(filter_entity_id);
    findingsConditions.push(`(f.deal_id = $${findingsValues.length} OR f.account_id = $${findingsValues.length})`);
  }

  const findingsResult = await query<any>(
    `SELECT f.severity, f.category, f.message, f.entity_type, f.deal_id as entity_id,
            COALESCE(f.entity_name, d.name) as entity_name, f.metric_value
     FROM findings f
     LEFT JOIN deals d ON d.id = f.deal_id AND d.workspace_id = f.workspace_id
     WHERE ${findingsConditions.join(' AND ')}
     ORDER BY CASE f.severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 WHEN 'notable' THEN 3 ELSE 4 END, f.found_at DESC
     LIMIT 100`,
    findingsValues
  );

  const claims = findingsResult.rows.map((f: any) => ({
    severity: f.severity,
    category: f.category,
    message: f.message,
    entity_type: f.entity_type || 'deal',
    entity_id: f.entity_id,
    entity_name: f.entity_name,
    metric_value: f.metric_value,
  }));

  // Extract evaluated records from skill run output
  let evaluatedRecords: any[] = [];
  let parameters: object = {};
  try {
    const output = run.output || run.result || {};
    evaluatedRecords = output.evidence?.evaluated_records || output.evaluated_records || [];
    parameters = output.evidence?.parameters || output.parameters || {};
  } catch {}

  const summary = run.output_text || run.result?.narrative || run.result?.summary || null;

  return {
    skill_id,
    last_run_at: run.completed_at,
    is_stale: isStale,
    claims,
    evaluated_records: evaluatedRecords.slice(0, 50),
    parameters,
    summary: typeof summary === 'string' ? summary.slice(0, 2000) : null,
    record_count: evaluatedRecords.length,
    claim_count: claims.length,
  };
}

// ─── Tool 5: compute_metric ──────────────────────────────────────────────────

async function computeMetric(workspaceId: string, params: Record<string, any>): Promise<ComputeMetricResult> {
  const { metric } = params;
  if (!metric) throw new Error('metric is required for compute_metric');

  switch (metric) {
    case 'total_pipeline':
      return computeTotalPipeline(workspaceId, params);
    case 'weighted_pipeline':
      return computeWeightedPipeline(workspaceId, params);
    case 'win_rate':
      return computeWinRate(workspaceId, params);
    case 'avg_deal_size':
      return computeAvgDealSize(workspaceId, params);
    case 'avg_sales_cycle':
      return computeAvgSalesCycle(workspaceId, params);
    case 'coverage_ratio':
      return computeCoverageRatio(workspaceId, params);
    case 'pipeline_created':
      return computePipelineCreated(workspaceId, params);
    case 'pipeline_closed':
      return computePipelineClosed(workspaceId, params);
    default:
      throw new Error(`Unknown metric: ${metric}. Available: total_pipeline, weighted_pipeline, win_rate, avg_deal_size, avg_sales_cycle, coverage_ratio, pipeline_created, pipeline_closed`);
  }
}

async function computeTotalPipeline(workspaceId: string, params: Record<string, any>): Promise<ComputeMetricResult> {
  const conditions: string[] = [
    `workspace_id = $1`,
    `stage_normalized NOT IN ('closed_won', 'closed_lost')`,
  ];
  const values: any[] = [workspaceId];

  if (params.owner_email) {
    values.push(params.owner_email);
    conditions.push(`LOWER(owner) = $${values.length}`);
  }
  if (params.pipeline_name) {
    values.push(`%${params.pipeline_name}%`);
    conditions.push(`pipeline ILIKE $${values.length}`);
  }
  if (params.stage) {
    values.push(`%${params.stage}%`);
    conditions.push(`stage ILIKE $${values.length}`);
  }

  const result = await query<any>(
    `SELECT id, name, amount, stage, close_date, owner
     FROM deals
     WHERE ${conditions.join(' AND ')}
     ORDER BY amount DESC NULLS LAST`,
    values
  );

  const rows = result.rows;
  const total = rows.reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const formatted = total >= 1_000_000
    ? `$${(total / 1_000_000).toFixed(2)}M`
    : `$${(total / 1_000).toFixed(0)}K`;

  return {
    metric: 'total_pipeline',
    value: total,
    formatted,
    formula: `SUM(amount) of ${rows.length} open deals = ${formatted}`,
    inputs: { numerator: total, denominator: null, description: `${rows.length} open deals` },
    underlying_records: rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      amount: r.amount || 0,
      included_because: `Open deal (${r.stage || 'unknown stage'})`,
    })),
    exclusions: [{ reason: 'Closed-won and closed-lost deals excluded', count: 0 }],
    record_count: rows.length,
    period: 'Current open pipeline',
    query_description: `Total open pipeline${params.owner_email ? ` for ${params.owner_email}` : ''} = ${formatted} across ${rows.length} deals`,
  };
}

async function computeWeightedPipeline(workspaceId: string, params: Record<string, any>): Promise<ComputeMetricResult> {
  const result = await query<any>(
    `SELECT id, name, amount, probability, stage, owner
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       AND probability IS NOT NULL
     ORDER BY amount DESC NULLS LAST`,
    [workspaceId]
  );

  const rows = result.rows;
  const weighted = rows.reduce((s: number, r: any) => s + (r.amount || 0) * (r.probability || 0), 0);
  const formatted = weighted >= 1_000_000
    ? `$${(weighted / 1_000_000).toFixed(2)}M`
    : `$${(weighted / 1_000).toFixed(0)}K`;

  return {
    metric: 'weighted_pipeline',
    value: weighted,
    formatted,
    formula: `SUM(amount × probability) across ${rows.length} deals with probability set`,
    inputs: { numerator: weighted, denominator: null, description: 'probability-weighted deal amounts' },
    underlying_records: rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      amount: (r.amount || 0) * (r.probability || 0),
      included_because: `${r.stage} at ${Math.round((r.probability || 0) * 100)}% probability`,
    })),
    exclusions: [{ reason: 'Deals without probability set excluded', count: 0 }],
    record_count: rows.length,
    period: 'Current open pipeline',
    query_description: `Weighted pipeline = ${formatted}`,
  };
}

async function computeWinRate(workspaceId: string, params: Record<string, any>): Promise<ComputeMetricResult> {
  const lookbackDays = params.lookback_days || 90;
  const conditions: string[] = [
    `workspace_id = $1`,
    `stage_normalized IN ('closed_won', 'closed_lost')`,
    `updated_at >= NOW() - ($2 || ' days')::interval`,
  ];
  const values: any[] = [workspaceId, lookbackDays];

  if (params.owner_email) {
    values.push(params.owner_email);
    conditions.push(`LOWER(owner) = $${values.length}`);
  }

  const result = await query<any>(
    `SELECT id, name, amount, stage_normalized, owner, close_date
     FROM deals
     WHERE ${conditions.join(' AND ')}
     ORDER BY close_date DESC NULLS LAST`,
    values
  );

  const rows = result.rows;
  const won = rows.filter((r: any) => r.stage_normalized === 'closed_won');
  const lost = rows.filter((r: any) => r.stage_normalized === 'closed_lost');
  const winRate = rows.length > 0 ? won.length / rows.length : 0;
  const formatted = `${(winRate * 100).toFixed(1)}%`;

  return {
    metric: 'win_rate',
    value: winRate,
    formatted,
    formula: `${won.length} won / ${rows.length} total closed = ${formatted}`,
    inputs: { numerator: won.length, denominator: rows.length, description: `${won.length} won, ${lost.length} lost in last ${lookbackDays} days` },
    underlying_records: rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      amount: r.amount || 0,
      included_because: r.stage_normalized === 'closed_won' ? 'Closed won' : 'Closed lost',
    })),
    exclusions: [{ reason: `Deals closed more than ${lookbackDays} days ago excluded`, count: 0 }],
    record_count: rows.length,
    period: `Last ${lookbackDays} days`,
    query_description: `Win rate over last ${lookbackDays} days: ${formatted} (${won.length}/${rows.length})`,
  };
}

async function computeAvgDealSize(workspaceId: string, params: Record<string, any>): Promise<ComputeMetricResult> {
  const result = await query<any>(
    `SELECT id, name, amount, stage, owner
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND amount > 0
     ORDER BY close_date DESC NULLS LAST
     LIMIT 100`,
    [workspaceId]
  );

  const rows = result.rows;
  const avg = rows.length > 0 ? rows.reduce((s: number, r: any) => s + (r.amount || 0), 0) / rows.length : 0;
  const formatted = avg >= 1_000_000 ? `$${(avg / 1_000_000).toFixed(2)}M` : `$${(avg / 1_000).toFixed(0)}K`;

  return {
    metric: 'avg_deal_size',
    value: avg,
    formatted,
    formula: `AVG(amount) of ${rows.length} closed-won deals = ${formatted}`,
    inputs: { numerator: rows.reduce((s: number, r: any) => s + (r.amount || 0), 0), denominator: rows.length, description: 'closed-won deal amounts' },
    underlying_records: rows.slice(0, 20).map((r: any) => ({
      id: r.id,
      name: r.name,
      amount: r.amount || 0,
      included_because: 'Closed won',
    })),
    exclusions: [],
    record_count: rows.length,
    period: 'All time closed-won (last 100)',
    query_description: `Average closed-won deal size = ${formatted}`,
  };
}

async function computeAvgSalesCycle(workspaceId: string, params: Record<string, any>): Promise<ComputeMetricResult> {
  const result = await query<any>(
    `SELECT id, name, amount,
            EXTRACT(DAY FROM (close_date::date - created_at::date))::int as cycle_days
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND close_date IS NOT NULL
       AND created_at IS NOT NULL
     ORDER BY close_date DESC NULLS LAST
     LIMIT 100`,
    [workspaceId]
  );

  const rows = result.rows.filter((r: any) => r.cycle_days != null && r.cycle_days > 0);
  const avg = rows.length > 0 ? rows.reduce((s: number, r: any) => s + r.cycle_days, 0) / rows.length : 0;
  const formatted = `${Math.round(avg)} days`;

  return {
    metric: 'avg_sales_cycle',
    value: avg,
    formatted,
    formula: `AVG(close_date - created_at) of ${rows.length} closed-won deals = ${formatted}`,
    inputs: { numerator: rows.reduce((s: number, r: any) => s + r.cycle_days, 0), denominator: rows.length, description: 'days from created to closed' },
    underlying_records: rows.slice(0, 20).map((r: any) => ({
      id: r.id,
      name: r.name,
      amount: r.amount || 0,
      included_because: `${r.cycle_days} day cycle`,
    })),
    exclusions: [],
    record_count: rows.length,
    period: 'Last 100 closed-won deals',
    query_description: `Average sales cycle = ${formatted}`,
  };
}

async function computeCoverageRatio(workspaceId: string, params: Record<string, any>): Promise<ComputeMetricResult> {
  // Try to get quota from workspace config or use explicit param
  let quota = params.quota_amount;

  if (!quota) {
    try {
      const configResult = await query<{ config: any }>(
        `SELECT config FROM workspace_config WHERE workspace_id = $1`,
        [workspaceId]
      );
      quota = configResult.rows[0]?.config?.quarterly_quota ||
              configResult.rows[0]?.config?.annual_quota ||
              null;
    } catch {}
  }

  const pipelineResult = await query<{ total: string; cnt: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text as total, COUNT(*)::text as cnt
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId]
  );

  const pipeline = parseFloat(pipelineResult.rows[0]?.total || '0');
  const dealCount = parseInt(pipelineResult.rows[0]?.cnt || '0');
  const ratio = quota ? pipeline / quota : 0;
  const formatted = quota ? `${ratio.toFixed(2)}x` : `${(pipeline / 1000).toFixed(0)}K (no quota set)`;

  return {
    metric: 'coverage_ratio',
    value: ratio,
    formatted,
    formula: quota ? `pipeline ($${(pipeline / 1000).toFixed(0)}K) / quota ($${(quota / 1000).toFixed(0)}K) = ${formatted}` : `Pipeline = $${(pipeline / 1000).toFixed(0)}K, quota not configured`,
    inputs: { numerator: pipeline, denominator: quota || null, description: `${dealCount} open deals` },
    underlying_records: [],
    exclusions: [],
    record_count: dealCount,
    period: 'Current',
    query_description: `Pipeline coverage = ${formatted}`,
  };
}

async function computePipelineCreated(workspaceId: string, params: Record<string, any>): Promise<ComputeMetricResult> {
  const from = params.date_from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const to = params.date_to || new Date().toISOString().split('T')[0];

  const result = await query<any>(
    `SELECT id, name, amount, stage, owner, created_at
     FROM deals
     WHERE workspace_id = $1
       AND created_at >= $2
       AND created_at <= $3
     ORDER BY created_at DESC`,
    [workspaceId, from, to]
  );

  const rows = result.rows;
  const total = rows.reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const formatted = total >= 1_000_000 ? `$${(total / 1_000_000).toFixed(2)}M` : `$${(total / 1_000).toFixed(0)}K`;

  return {
    metric: 'pipeline_created',
    value: total,
    formatted,
    formula: `${rows.length} deals created ${from} to ${to} = ${formatted}`,
    inputs: { numerator: total, denominator: null, description: `${rows.length} new deals` },
    underlying_records: rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      amount: r.amount || 0,
      included_because: `Created ${r.created_at?.toString().slice(0, 10)}`,
    })),
    exclusions: [],
    record_count: rows.length,
    period: `${from} to ${to}`,
    query_description: `Pipeline created ${from}–${to}: ${formatted} across ${rows.length} deals`,
  };
}

async function computePipelineClosed(workspaceId: string, params: Record<string, any>): Promise<ComputeMetricResult> {
  const from = params.date_from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const to = params.date_to || new Date().toISOString().split('T')[0];

  const result = await query<any>(
    `SELECT id, name, amount, stage_normalized, owner, close_date
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IN ('closed_won', 'closed_lost')
       AND close_date >= $2
       AND close_date <= $3
     ORDER BY close_date DESC`,
    [workspaceId, from, to]
  );

  const rows = result.rows;
  const won = rows.filter((r: any) => r.stage_normalized === 'closed_won');
  const totalWon = won.reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const formatted = totalWon >= 1_000_000 ? `$${(totalWon / 1_000_000).toFixed(2)}M` : `$${(totalWon / 1_000).toFixed(0)}K`;

  return {
    metric: 'pipeline_closed',
    value: totalWon,
    formatted,
    formula: `${won.length} won deals ${from} to ${to} = ${formatted} (${rows.length - won.length} lost)`,
    inputs: { numerator: totalWon, denominator: null, description: `${won.length} won, ${rows.length - won.length} lost` },
    underlying_records: rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      amount: r.amount || 0,
      included_because: r.stage_normalized === 'closed_won' ? 'Closed won' : 'Closed lost',
    })),
    exclusions: [],
    record_count: rows.length,
    period: `${from} to ${to}`,
    query_description: `Closed ${from}–${to}: ${formatted} won across ${won.length} deals (${rows.length - won.length} lost)`,
  };
}

// ─── Tool 6: query_contacts ──────────────────────────────────────────────────

async function queryContacts(workspaceId: string, params: Record<string, any>): Promise<QueryContactsResult> {
  const conditions: string[] = ['c.workspace_id = $1'];
  const values: any[] = [workspaceId];
  const descParts: string[] = [];

  function addParam(val: any): string {
    values.push(val);
    return `$${values.length}`;
  }

  if (params.account_id) {
    conditions.push(`c.account_id = ${addParam(params.account_id)}`);
  }

  if (params.deal_id) {
    conditions.push(`EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.contact_id = c.id AND dc.deal_id = ${addParam(params.deal_id)})`);
  }

  if (params.name) {
    conditions.push(`(c.first_name || ' ' || c.last_name) ILIKE ${addParam(`%${params.name}%`)}`);
    descParts.push(`name~"${params.name}"`);
  }

  if (params.email) {
    conditions.push(`c.email ILIKE ${addParam(`%${params.email}%`)}`);
    descParts.push(`email~"${params.email}"`);
  }

  if (params.title_contains) {
    conditions.push(`c.title ILIKE ${addParam(`%${params.title_contains}%`)}`);
    descParts.push(`title~"${params.title_contains}"`);
  }

  if (params.role) {
    conditions.push(`dc.role ILIKE ${addParam(`%${params.role}%`)}`);
    descParts.push(`role~"${params.role}"`);
  }

  if (params.has_conversation === true) {
    conditions.push(`EXISTS (SELECT 1 FROM conversations cv WHERE cv.participants::text ILIKE '%' || c.email || '%' AND cv.workspace_id = $1)`);
    descParts.push('with conversations');
  }

  const limit = Math.min(params.limit || 50, 200);
  const where = conditions.join(' AND ');

  const countResult = await query<{ cnt: string }>(
    `SELECT COUNT(DISTINCT c.id)::text as cnt
     FROM contacts c
     LEFT JOIN deal_contacts dc ON dc.contact_id = c.id AND dc.workspace_id = $1
     WHERE ${where}`,
    values
  );
  const totalCount = parseInt(countResult.rows[0]?.cnt || '0');

  const rows = await query<any>(
    `SELECT DISTINCT ON (c.id)
            c.id,
            COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '') as name,
            c.email, c.title,
            a.name as account_name,
            dc.role,
            c.last_activity_date,
            (SELECT COUNT(*)::int FROM conversations cv
             WHERE cv.workspace_id = $1 AND cv.participants::text ILIKE '%' || c.email || '%') as conversation_count
     FROM contacts c
     LEFT JOIN accounts a ON a.id = c.account_id AND a.workspace_id = $1
     LEFT JOIN deal_contacts dc ON dc.contact_id = c.id AND dc.workspace_id = $1
     WHERE ${where}
     ORDER BY c.id, dc.is_primary DESC NULLS LAST
     LIMIT ${addParam(limit)}`,
    values
  );

  return {
    contacts: rows.rows.map((r: any) => ({
      id: r.id,
      name: r.name?.trim() || 'Unknown',
      email: r.email,
      title: r.title,
      account_name: r.account_name,
      role: r.role,
      last_activity_date: r.last_activity_date,
      conversation_count: r.conversation_count || 0,
    })),
    total_count: totalCount,
    query_description: `Contacts (${descParts.length > 0 ? descParts.join(', ') : 'all'}) — ${totalCount} total`,
  };
}

// ─── Tool 7: query_activity_timeline ────────────────────────────────────────

async function queryActivityTimeline(workspaceId: string, params: Record<string, any>): Promise<QueryActivityTimelineResult> {
  if (!params.deal_id && !params.account_id) {
    throw new Error('Either deal_id or account_id is required for query_activity_timeline');
  }

  const events: ActivityEvent[] = [];
  const limit = Math.min(params.limit || 50, 200);
  const activityTypes = params.activity_types as string[] | undefined;

  const includeType = (type: string) => !activityTypes || activityTypes.includes(type);

  // Stage changes from deal_stage_history
  if (includeType('stage_change')) {
    const stageConditions: string[] = ['dsh.workspace_id = $1'];
    const stageValues: any[] = [workspaceId];

    if (params.deal_id) {
      stageValues.push(params.deal_id);
      stageConditions.push(`dsh.deal_id = $${stageValues.length}`);
    } else if (params.account_id) {
      stageConditions.push(`d.account_id = $${stageValues.push(params.account_id)}`);
    }

    if (params.since) { stageValues.push(params.since); stageConditions.push(`dsh.changed_at >= $${stageValues.length}`); }
    if (params.until) { stageValues.push(params.until); stageConditions.push(`dsh.changed_at <= $${stageValues.length}`); }

    try {
      const stageResult = await query<any>(
        `SELECT dsh.changed_at as date, dsh.from_stage, dsh.to_stage,
                d.name as deal_name, d.owner as actor
         FROM deal_stage_history dsh
         JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
         WHERE ${stageConditions.join(' AND ')}
         ORDER BY dsh.changed_at DESC
         LIMIT $${stageValues.push(limit)}`,
        stageValues
      );
      for (const r of stageResult.rows) {
        events.push({
          date: r.date,
          type: 'stage_change',
          description: `Stage changed: ${r.from_stage || 'unknown'} → ${r.to_stage}`,
          actor: r.actor,
          deal_name: r.deal_name,
          metadata: { from_stage: r.from_stage, to_stage: r.to_stage },
        });
      }
    } catch { /* deal_stage_history may not exist */ }
  }

  // Calls/meetings from conversations
  if (includeType('call') || includeType('meeting')) {
    const convConditions: string[] = ['cv.workspace_id = $1', 'cv.is_internal = false'];
    const convValues: any[] = [workspaceId];

    if (params.deal_id) { convValues.push(params.deal_id); convConditions.push(`cv.deal_id = $${convValues.length}`); }
    else if (params.account_id) { convValues.push(params.account_id); convConditions.push(`cv.account_id = $${convValues.length}`); }

    if (params.since) { convValues.push(params.since); convConditions.push(`cv.call_date >= $${convValues.length}`); }
    if (params.until) { convValues.push(params.until); convConditions.push(`cv.call_date <= $${convValues.length}`); }

    const convResult = await query<any>(
      `SELECT cv.call_date as date, cv.title, cv.duration_seconds,
              cv.source, cv.participants,
              d.name as deal_name
       FROM conversations cv
       LEFT JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = cv.workspace_id
       WHERE ${convConditions.join(' AND ')}
       ORDER BY cv.call_date DESC
       LIMIT $${convValues.push(limit)}`,
      convValues
    );

    for (const r of convResult.rows) {
      const mins = r.duration_seconds ? Math.round(r.duration_seconds / 60) : null;
      events.push({
        date: r.date,
        type: 'call',
        description: `${r.title || 'Call'}${mins ? ` (${mins} min)` : ''}`,
        actor: null,
        deal_name: r.deal_name,
        metadata: { source: r.source, duration_minutes: mins },
      });
    }
  }

  // Sort all events by date descending
  events.sort((a, b) => {
    const da = new Date(a.date || 0).getTime();
    const db = new Date(b.date || 0).getTime();
    return db - da;
  });

  const trimmed = events.slice(0, limit);
  const dates = trimmed.map(e => new Date(e.date || 0).getTime()).filter(t => t > 0);
  const spanDays = dates.length >= 2
    ? Math.round((Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24))
    : 0;

  return {
    events: trimmed,
    total_count: trimmed.length,
    span_days: spanDays,
    query_description: `Activity timeline for ${params.deal_id ? 'deal' : 'account'} — ${trimmed.length} events over ${spanDays} days`,
  };
}
