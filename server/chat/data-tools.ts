/**
 * Data Tools for Ask Pandora
 *
 * Parameterized SQL query functions invoked by the agentic loop.
 * No LLM calls — pure database access with workspace scoping enforced everywhere.
 */

import { query } from '../db.js';
import { getToolFilters } from '../config/tool-filter-injector.js';
import { callLLM } from '../utils/llm-router.js';

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
  params: Record<string, any>,
  calledBy: 'ask_pandora' | 'skill_run' | 'playground' = 'ask_pandora',
  skillId?: string
): Promise<any> {
  const { logToolCall, extractResultRowCount } = await import('./tool-logger.js');
  const start = Date.now();
  let result: any;
  let errorMsg: string | undefined;

  try {
    switch (toolName) {
      case 'query_deals':
        result = await queryDeals(workspaceId, params); break;
      case 'query_accounts':
        result = await queryAccounts(workspaceId, params); break;
      case 'query_conversations':
        result = await queryConversations(workspaceId, params); break;
      case 'get_skill_evidence':
        result = await getSkillEvidence(workspaceId, params); break;
      case 'compute_metric':
        result = await computeMetric(workspaceId, params); break;
      case 'query_contacts':
        result = await queryContacts(workspaceId, params); break;
      case 'query_activity_timeline':
        result = await queryActivityTimeline(workspaceId, params); break;
      case 'query_stage_history':
        result = await queryStageHistory(workspaceId, params); break;
      case 'compute_stage_benchmarks':
        result = await computeStageBenchmarks(workspaceId, params); break;
      case 'query_field_history':
        result = await queryFieldHistory(workspaceId, params); break;
      case 'compute_metric_segmented':
        result = await computeMetricSegmented(workspaceId, params); break;
      case 'search_transcripts':
        result = await searchTranscripts(workspaceId, params); break;
      case 'compute_forecast_accuracy':
        result = await computeForecastAccuracy(workspaceId, params); break;
      case 'compute_close_probability':
        result = await computeCloseProbability(workspaceId, params); break;
      case 'compute_pipeline_creation':
        result = await computePipelineCreation(workspaceId, params); break;
      case 'compute_inqtr_close_rate':
        result = await computeInqtrCloseRate(workspaceId, params); break;
      case 'compute_competitive_rates':
        result = await computeCompetitiveRates(workspaceId, params); break;
      case 'compute_activity_trend':
        result = await computeActivityTrend(workspaceId, params); break;
      case 'compute_shrink_rate':
        result = await computeShrinkRate(workspaceId, params); break;
      case 'infer_contact_role':
        result = await inferContactRole(workspaceId, params); break;
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
    return result;
  } catch (err: any) {
    errorMsg = err.message || String(err);
    throw err;
  } finally {
    const rowCount = extractResultRowCount(result);
    logToolCall({
      workspace_id: workspaceId,
      tool_name: toolName,
      called_by: calledBy,
      skill_id: skillId,
      duration_ms: Date.now() - start,
      result_row_count: rowCount ?? undefined,
      result_empty: result == null || rowCount === 0,
      error: errorMsg,
    });
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

  // Inject tool filters for general context
  const toolFilters = await getToolFilters(workspaceId, 'general', values.length + 1, 'd').catch(() => ({ whereClause: '', params: [], paramOffset: values.length + 1, appliedRules: [] }));
  if (toolFilters.whereClause) {
    conditions.push(toolFilters.whereClause.replace(/^\s*AND\s+/, ''));
    values.push(...toolFilters.params);
  }

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

function metricToContext(metric: string): 'win_rate' | 'pipeline_value' | 'general' {
  if (metric === 'win_rate') return 'win_rate';
  if (metric === 'total_pipeline' || metric === 'pipeline_created') return 'pipeline_value';
  return 'general';
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

  // Inject tool filters for pipeline_value context
  const toolFilters = await getToolFilters(workspaceId, 'pipeline_value', values.length + 1, 'deals').catch(() => ({ whereClause: '', params: [], paramOffset: values.length + 1, appliedRules: [] }));
  if (toolFilters.whereClause) {
    // whereClause starts with ' AND ', strip it and add as a condition
    conditions.push(toolFilters.whereClause.replace(/^\s*AND\s+/, ''));
    values.push(...toolFilters.params);
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

  // Inject tool filters for win_rate context
  const toolFilters = await getToolFilters(workspaceId, 'win_rate', values.length + 1, 'deals').catch(() => ({ whereClause: '', params: [], paramOffset: values.length + 1, appliedRules: [] }));
  if (toolFilters.whereClause) {
    conditions.push(toolFilters.whereClause.replace(/^\s*AND\s+/, ''));
    values.push(...toolFilters.params);
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
  const conditions = ['workspace_id = $1', "stage_normalized = 'closed_won'", 'amount > 0'];
  const values: any[] = [workspaceId];
  const toolFilters = await getToolFilters(workspaceId, 'win_rate', values.length + 1, 'deals').catch(()=>({whereClause: '', params: [], paramOffset: values.length + 1, appliedRules: []}));
  if (toolFilters.whereClause) {
    conditions.push(toolFilters.whereClause.replace(/^\s*AND\s+/, ''));
    values.push(...toolFilters.params);
  }
  const result = await query<any>(
    `SELECT id, name, amount, stage, owner
     FROM deals
     WHERE ${conditions.join(' AND ')}
     ORDER BY close_date DESC NULLS LAST
     LIMIT 100`,
    values
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
  const conditions = ['workspace_id = $1', "stage_normalized = 'closed_won'", 'close_date IS NOT NULL', 'created_at IS NOT NULL'];
  const values: any[] = [workspaceId];
  const toolFilters = await getToolFilters(workspaceId, 'win_rate', values.length + 1, 'deals').catch(()=>({whereClause: '', params: [], paramOffset: values.length + 1, appliedRules: []}));
  if (toolFilters.whereClause) {
    conditions.push(toolFilters.whereClause.replace(/^\s*AND\s+/, ''));
    values.push(...toolFilters.params);
  }
  const result = await query<any>(
    `SELECT id, name, amount,
            EXTRACT(DAY FROM (close_date::date - created_at::date))::int as cycle_days
     FROM deals
     WHERE ${conditions.join(' AND ')}
     ORDER BY close_date DESC NULLS LAST
     LIMIT 100`,
    values
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

  const covConditions = ['workspace_id = $1', "stage_normalized NOT IN ('closed_won', 'closed_lost')"];
  const covValues: any[] = [workspaceId];
  const toolFilters = await getToolFilters(workspaceId, 'pipeline_value', covValues.length + 1, 'deals').catch(()=>({whereClause: '', params: [], paramOffset: covValues.length + 1, appliedRules: []}));
  if (toolFilters.whereClause) {
    covConditions.push(toolFilters.whereClause.replace(/^\s*AND\s+/, ''));
    covValues.push(...toolFilters.params);
  }
const pipelineResult = await query<{ total: string; cnt: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text as total, COUNT(*)::text as cnt
     FROM deals
     WHERE ${covConditions.join(' AND ')}`,
    covValues
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

  const conditions = ['workspace_id = $1', 'created_at >= $2', 'created_at <= $3'];
  const values: any[] = [workspaceId, from, to];
  const toolFilters = await getToolFilters(workspaceId, 'pipeline_value', values.length + 1, 'deals').catch(()=>({whereClause: '', params: [], paramOffset: values.length + 1, appliedRules: []}));
  if (toolFilters.whereClause) {
    conditions.push(toolFilters.whereClause.replace(/^\s*AND\s+/, ''));
    values.push(...toolFilters.params);
  }
  const result = await query<any>(
    `SELECT id, name, amount, stage, owner, created_at
     FROM deals
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    values
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

  const closedConditions = ['workspace_id = $1', "stage_normalized IN ('closed_won', 'closed_lost')", 'close_date >= $2', 'close_date <= $3'];
  const closedValues: any[] = [workspaceId, from, to];
  const toolFilters = await getToolFilters(workspaceId, 'general', closedValues.length + 1, 'deals').catch(()=>({whereClause: '', params: [], paramOffset: closedValues.length + 1, appliedRules: []}));
  if (toolFilters.whereClause) {
    closedConditions.push(toolFilters.whereClause.replace(/^\s*AND\s+/, ''));
    closedValues.push(...toolFilters.params);
  }
  const result = await query<any>(
    `SELECT id, name, amount, stage_normalized, owner, close_date
     FROM deals
     WHERE ${closedConditions.join(' AND ')}
     ORDER BY close_date DESC`,
    closedValues
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

// ─── Tool 8: query_stage_history ─────────────────────────────────────────────

async function queryStageHistory(workspaceId: string, params: Record<string, any>) {
  const limit = Math.min(params.limit || 50, 200);
  const values: any[] = [workspaceId];

  // Build deal_id / account_id filter
  const dealFilter = params.deal_id
    ? `AND dsh.deal_id = $${values.push(params.deal_id)}`
    : params.account_id
      ? `AND d.account_id = $${values.push(params.account_id)}`
      : '';

  const sinceFilter = params.since ? `AND dsh.entered_at >= $${values.push(params.since)}` : '';
  const untilFilter = params.until ? `AND dsh.entered_at <= $${values.push(params.until)}` : '';

  // Inject tool filters for general context
  let dealFilterWithToolFilters = dealFilter;
  const stageHistToolFilters = await getToolFilters(workspaceId, 'general', values.length + 1, 'd').catch(()=>({whereClause: '', params: [], paramOffset: values.length + 1, appliedRules: []}));
  if (stageHistToolFilters.whereClause) {
    dealFilterWithToolFilters += " " + stageHistToolFilters.whereClause;
    values.push(...stageHistToolFilters.params);
  }
  // Use LEAD to compute from→to transitions from the single-row-per-stage-entry schema.
  // direction is determined by comparing display_order from stage_mappings.
  const sql = `
    WITH ordered AS (
      SELECT
        dsh.deal_id,
        dsh.stage            AS to_stage,
        dsh.stage_normalized AS to_stage_normalized,
        dsh.entered_at       AS changed_at,
        LAG(dsh.stage)            OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS from_stage,
        LAG(dsh.stage_normalized) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS from_stage_normalized,
        LAG(dsh.entered_at)       OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS prev_entered_at,
        d.name   AS deal_name,
        d.amount AS deal_amount,
        d.owner  AS owner_name,
        sm_to.display_order AS to_order
      FROM deal_stage_history dsh
      JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
      LEFT JOIN stage_mappings sm_to
        ON sm_to.workspace_id = dsh.workspace_id AND sm_to.normalized_stage = dsh.stage_normalized
      WHERE dsh.workspace_id = $1
        ${dealFilterWithToolFilters}
        ${sinceFilter}
        ${untilFilter}
    )
    SELECT
      o.deal_id, o.deal_name, o.deal_amount,
      o.from_stage, o.from_stage_normalized,
      o.to_stage,  o.to_stage_normalized,
      o.changed_at,
      CASE
        WHEN o.prev_entered_at IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (o.changed_at - o.prev_entered_at)) / 86400.0, 1)
      END AS days_in_previous_stage,
      sm_from.display_order AS from_order,
      o.to_order,
      o.owner_name
    FROM ordered o
    LEFT JOIN stage_mappings sm_from
      ON sm_from.workspace_id = $1 AND sm_from.normalized_stage = o.from_stage_normalized
    ORDER BY o.changed_at DESC
    LIMIT $${values.push(limit)}
  `;

  const result = await query<any>(sql, values);

  const transitions = result.rows.map((r: any) => {
    let direction: 'advance' | 'regress' | 'lateral' | 'initial' = 'initial';
    if (r.from_stage === null) {
      direction = 'initial';
    } else if (r.from_order != null && r.to_order != null) {
      if (r.to_order > r.from_order) direction = 'advance';
      else if (r.to_order < r.from_order) direction = 'regress';
      else direction = 'lateral';
    }

    return {
      deal_id: r.deal_id,
      deal_name: r.deal_name,
      deal_amount: parseFloat(r.deal_amount) || 0,
      from_stage: r.from_stage || null,
      to_stage: r.to_stage,
      from_stage_normalized: r.from_stage_normalized || null,
      to_stage_normalized: r.to_stage_normalized,
      changed_at: r.changed_at,
      days_in_previous_stage: r.days_in_previous_stage != null ? parseFloat(r.days_in_previous_stage) : null,
      direction,
      owner_name: r.owner_name,
    };
  });

  // Apply direction filter in app-code (simpler than complex SQL CASE in WHERE)
  const filtered = params.direction && params.direction !== 'all'
    ? transitions.filter(t => t.direction === params.direction)
    : transitions;

  return {
    transitions: filtered,
    total_count: filtered.length,
    query_description: `Stage history ${params.deal_id ? `for deal ${params.deal_id}` : params.account_id ? `for account ${params.account_id}` : '(workspace-wide)'} — ${filtered.length} transitions`,
  };
}

// ─── Tool 9: compute_stage_benchmarks ────────────────────────────────────────

async function computeStageBenchmarks(workspaceId: string, params: Record<string, any>) {
  const lookbackMonths = params.lookback_months || 12;
  const values: any[] = [workspaceId, lookbackMonths];

  let dealFilter = '';
  if (params.pipeline) {
    dealFilter += ` AND d.pipeline ILIKE $${values.push(`%${params.pipeline}%`)}`;
  }
  if (params.owner_email) {
    dealFilter += ` AND LOWER(d.owner) = $${values.push(params.owner_email.toLowerCase())}`;
  }
  if (params.stage) {
    dealFilter += ` AND (dsh.stage_normalized = $${values.push(params.stage.toLowerCase())} OR dsh.stage ILIKE $${values.push(`%${params.stage}%`)})`;
  }
  if (params.only_closed_won === true) {
    dealFilter += ` AND d.stage_normalized = 'closed_won'`;
  }

  // Size band filter
  if (params.deal_size_band) {
    const bandConditions: Record<string, string> = {
      small: 'd.amount < 25000',
      mid: 'd.amount >= 25000 AND d.amount < 100000',
      large: 'd.amount >= 100000 AND d.amount < 500000',
      enterprise: 'd.amount >= 500000',
    };
    const bc = bandConditions[params.deal_size_band];
    if (bc) dealFilter += ` AND (${bc})`;
  }

  // Inject tool filters for general context
  const stageBenchToolFilters = await getToolFilters(workspaceId, 'general', values.length + 1, 'd').catch(()=>({whereClause: '', params: [], paramOffset: values.length + 1, appliedRules: []}));
  if (stageBenchToolFilters.whereClause) {
    dealFilter += " " + stageBenchToolFilters.whereClause;
    values.push(...stageBenchToolFilters.params);
  }

  // Compute duration per stage using LEAD(entered_at) to find when deal left that stage
  const sql = `
    WITH stage_windows AS (
      SELECT
        dsh.deal_id,
        dsh.stage_normalized,
        dsh.stage,
        dsh.entered_at,
        LEAD(dsh.entered_at) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS next_entered_at
      FROM deal_stage_history dsh
      JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
      WHERE dsh.workspace_id = $1
        AND dsh.entered_at >= NOW() - ($2 || ' months')::interval
        AND dsh.stage_normalized NOT IN ('closed_won', 'closed_lost')
        ${dealFilter}
    ),
    durations AS (
      SELECT
        stage_normalized,
        stage,
        EXTRACT(EPOCH FROM (next_entered_at - entered_at)) / 86400.0 AS days_in_stage
      FROM stage_windows
      WHERE next_entered_at IS NOT NULL  -- only completed stage stays
        AND next_entered_at > entered_at  -- sanity check
    )
    SELECT
      stage_normalized,
      stage,
      PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY days_in_stage)::numeric(10,1) AS median_days,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY days_in_stage)::numeric(10,1) AS p75_days,
      PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY days_in_stage)::numeric(10,1) AS p90_days,
      AVG(days_in_stage)::numeric(10,1)                                           AS mean_days,
      COUNT(*)::int                                                                AS sample_size
    FROM durations
    WHERE days_in_stage > 0
    GROUP BY stage_normalized, stage
    HAVING COUNT(*) >= 2
    ORDER BY MIN(days_in_stage)
  `;

  const result = await query<any>(sql, values);

  // Conversion rates: for each stage, what fraction advanced vs dropped out?
  // Use a separate pass over deal_stage_history
  const convSql = `
    SELECT
      from_norm,
      to_norm,
      COUNT(*)::int AS cnt
    FROM (
      SELECT
        dsh.stage_normalized AS from_norm,
        LEAD(dsh.stage_normalized) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS to_norm
      FROM deal_stage_history dsh
      WHERE dsh.workspace_id = $1
        AND dsh.entered_at >= NOW() - ($2 || ' months')::interval
    ) sub
    WHERE to_norm IS NOT NULL
    GROUP BY from_norm, to_norm
  `;
  const convResult = await query<any>(convSql, [workspaceId, lookbackMonths]);

  // Build conversion map
  const convMap: Record<string, { advance: number; drop: number; total: number }> = {};
  for (const r of convResult.rows) {
    if (!convMap[r.from_norm]) convMap[r.from_norm] = { advance: 0, drop: 0, total: 0 };
    convMap[r.from_norm].total += r.cnt;
    if (r.to_norm === 'closed_lost') convMap[r.from_norm].drop += r.cnt;
    else if (r.to_norm !== r.from_norm) convMap[r.from_norm].advance += r.cnt;
  }

  const benchmarks = result.rows.map((r: any) => {
    const conv = convMap[r.stage_normalized] || { advance: 0, drop: 0, total: 0 };
    const convRate = conv.total > 0 ? Math.round((conv.advance / conv.total) * 100) : 0;
    const dropRate = conv.total > 0 ? Math.round((conv.drop / conv.total) * 100) : 0;
    return {
      stage: r.stage,
      stage_normalized: r.stage_normalized,
      median_days: parseFloat(r.median_days) || 0,
      p75_days: parseFloat(r.p75_days) || 0,
      p90_days: parseFloat(r.p90_days) || 0,
      mean_days: parseFloat(r.mean_days) || 0,
      sample_size: r.sample_size,
      conversion_rate_to_next: convRate,
      drop_rate: dropRate,
    };
  });

  const totalTransitions = benchmarks.reduce((s, b) => s + b.sample_size, 0);

  return {
    benchmarks,
    segmented_by: params.deal_size_band || params.owner_email || null,
    lookback_months: lookbackMonths,
    total_transitions_analyzed: totalTransitions,
    query_description: `Stage benchmarks (${lookbackMonths}m lookback, ${totalTransitions} transitions): ${benchmarks.length} stages analyzed`,
  };
}

// ─── Tool 10: query_field_history ─────────────────────────────────────────────

async function queryFieldHistory(workspaceId: string, params: Record<string, any>) {
  if (!params.deal_id) throw new Error('deal_id is required for query_field_history');

  const fieldName = params.field_name || 'all';

  // Stage history — always available from deal_stage_history
  const stageChanges: any[] = [];
  if (fieldName === 'all' || fieldName === 'stage') {
    const result = await query<any>(
      `WITH ordered AS (
         SELECT
           dsh.stage_normalized AS to_stage_normalized,
           dsh.stage AS new_value,
           dsh.entered_at AS changed_at,
           dsh.source,
           LAG(dsh.stage) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS old_value,
           LAG(dsh.stage_normalized) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS from_stage_normalized
         FROM deal_stage_history dsh
         WHERE dsh.workspace_id = $1 AND dsh.deal_id = $2
           ${params.since ? `AND dsh.entered_at >= $3` : ''}
         ORDER BY dsh.entered_at
       )
       SELECT * FROM ordered WHERE old_value IS NOT NULL`,
      params.since
        ? [workspaceId, params.deal_id, params.since]
        : [workspaceId, params.deal_id]
    );

    for (const r of result.rows) {
      stageChanges.push({
        field: 'stage',
        old_value: r.old_value,
        new_value: r.new_value,
        changed_at: r.changed_at,
        source: r.source || 'deal_stage_history',
      });
    }
  }

  // Count stage regressions using stage_mappings display_order
  let stageRegressions = 0;
  if (stageChanges.length > 0) {
    const orderResult = await query<any>(
      `SELECT normalized_stage, display_order FROM stage_mappings WHERE workspace_id = $1`,
      [workspaceId]
    );
    const orderMap: Record<string, number> = {};
    for (const r of orderResult.rows) orderMap[r.normalized_stage] = r.display_order;

    // Need to recompute with normalized values from stageChanges
    const fullStageResult = await query<any>(
      `WITH ordered AS (
         SELECT
           dsh.stage_normalized AS to_norm,
           dsh.entered_at,
           LAG(dsh.stage_normalized) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS from_norm
         FROM deal_stage_history dsh
         WHERE dsh.workspace_id = $1 AND dsh.deal_id = $2
       )
       SELECT from_norm, to_norm FROM ordered WHERE from_norm IS NOT NULL`,
      [workspaceId, params.deal_id]
    );
    for (const r of fullStageResult.rows) {
      const fo = orderMap[r.from_norm] ?? 0;
      const to = orderMap[r.to_norm] ?? 0;
      if (to < fo) stageRegressions++;
    }
  }

  // close_date and amount history: not available without field_change_log table
  const noHistoryNote = 'Close date and amount change history not available — requires CRM property history sync (not yet enabled)';

  const summary = {
    close_date_pushes: 0,
    close_date_pulls: 0,
    total_slip_days: 0,
    amount_changes: 0,
    amount_net_change: 0,
    stage_regressions: stageRegressions,
  };

  const allChanges = [...stageChanges];
  if (fieldName !== 'stage') {
    allChanges.push({
      field: 'note',
      old_value: null,
      new_value: noHistoryNote,
      changed_at: new Date().toISOString(),
      source: 'system',
    });
  }

  return {
    changes: allChanges,
    summary,
    query_description: `Field history for deal ${params.deal_id} — ${stageChanges.length} stage changes, ${stageRegressions} regressions${fieldName !== 'stage' ? '; close_date/amount history not available' : ''}`,
  };
}

// ─── Tool 11: compute_metric_segmented ───────────────────────────────────────

async function computeMetricSegmented(workspaceId: string, params: Record<string, any>) {
  const { metric, segment_by } = params;
  if (!metric || !segment_by) throw new Error('metric and segment_by are required');

  const lookbackDays = params.lookback_days || 90;
  const dateFrom = params.date_from
    ? params.date_from
    : new Date(Date.now() - lookbackDays * 86400000).toISOString().split('T')[0];
  const dateTo = params.date_to || new Date().toISOString().split('T')[0];

  // Build segment expression
  const segmentExpr: Record<string, string> = {
    owner: 'd.owner',
    stage: 'd.stage',
    pipeline: 'COALESCE(d.pipeline, \'(none)\')',
    forecast_category: 'COALESCE(d.forecast_category, \'(none)\')',
    source: '\'unknown\'',  // no source column on deals; graceful fallback
    deal_size_band: `CASE
      WHEN d.amount < 25000    THEN 'small (<$25K)'
      WHEN d.amount < 100000   THEN 'mid ($25K–$100K)'
      WHEN d.amount < 500000   THEN 'large ($100K–$500K)'
      ELSE                         'enterprise ($500K+)'
    END`,
  };

  const seg = segmentExpr[segment_by] || 'd.owner';

  let sql: string;
  let values: any[];

  if (metric === 'win_rate') {
    sql = `
      SELECT
        ${seg} AS segment_value,
        COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')::int  AS wins,
        COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost'))::int AS decisions,
        CASE
          WHEN COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost')) > 0
          THEN ROUND(
            COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')::numeric /
            COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost')), 4)
          ELSE 0
        END AS value,
        COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost'))::int AS sample_size
      FROM deals d
      WHERE d.workspace_id = $1
        AND d.stage_normalized IN ('closed_won','closed_lost')
        AND d.updated_at >= $2
        AND d.updated_at <= $3
      GROUP BY ${seg}
      HAVING COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost')) >= 2
      ORDER BY value DESC
    `;
    values = [workspaceId, dateFrom, dateTo];
  } else if (metric === 'avg_deal_size') {
    sql = `
      SELECT
        ${seg} AS segment_value,
        AVG(d.amount)::numeric(14,2) AS value,
        COUNT(*)::int AS sample_size
      FROM deals d
      WHERE d.workspace_id = $1
        AND d.stage_normalized = 'closed_won'
        AND d.amount > 0
        AND d.updated_at >= $2
        AND d.updated_at <= $3
      GROUP BY ${seg}
      ORDER BY value DESC
    `;
    values = [workspaceId, dateFrom, dateTo];
  } else if (metric === 'avg_sales_cycle') {
    sql = `
      SELECT
        ${seg} AS segment_value,
        AVG(EXTRACT(DAY FROM (d.close_date::date - d.created_at::date)))::numeric(10,1) AS value,
        COUNT(*)::int AS sample_size
      FROM deals d
      WHERE d.workspace_id = $1
        AND d.stage_normalized = 'closed_won'
        AND d.close_date IS NOT NULL
        AND d.updated_at >= $2
        AND d.updated_at <= $3
      GROUP BY ${seg}
      HAVING COUNT(*) >= 2
      ORDER BY value ASC
    `;
    values = [workspaceId, dateFrom, dateTo];
  } else if (metric === 'total_pipeline') {
    sql = `
      SELECT
        ${seg} AS segment_value,
        SUM(d.amount)::numeric(14,2) AS value,
        COUNT(*)::int AS sample_size
      FROM deals d
      WHERE d.workspace_id = $1
        AND d.stage_normalized NOT IN ('closed_won','closed_lost')
      GROUP BY ${seg}
      ORDER BY value DESC
    `;
    values = [workspaceId];
  } else if (metric === 'pipeline_created') {
    sql = `
      SELECT
        ${seg} AS segment_value,
        SUM(d.amount)::numeric(14,2) AS value,
        COUNT(*)::int AS sample_size
      FROM deals d
      WHERE d.workspace_id = $1
        AND d.created_at >= $2
        AND d.created_at <= $3
      GROUP BY ${seg}
      ORDER BY value DESC
    `;
    values = [workspaceId, dateFrom, dateTo];
  } else {
    throw new Error(`Unknown metric for segmented compute: ${metric}. Use: win_rate, avg_deal_size, avg_sales_cycle, total_pipeline, pipeline_created`);
  }

  // Inject metric-contextual tool filters
  const segToolFilters = await getToolFilters(workspaceId, metricToContext(metric), values.length + 1, 'd').catch(()=>({whereClause: '', params: [], paramOffset: values.length + 1, appliedRules: []}));
  if (segToolFilters.whereClause) {
    sql = sql.replace(/\n      GROUP BY/, segToolFilters.whereClause + '\n      GROUP BY');
    values.push(...segToolFilters.params);
  }

  const result = await query<any>(sql, values);
  const rows = result.rows;

  if (rows.length === 0) {
    return {
      metric,
      segment_by,
      segments: [],
      team_average: 0,
      team_average_formatted: 'N/A',
      total_sample_size: 0,
      formula: `${metric} segmented by ${segment_by}`,
      query_description: `No data found for ${metric} by ${segment_by} in the requested period`,
    };
  }

  // Team average (weighted by sample_size for rates, straight avg otherwise)
  const totalSample = rows.reduce((s: number, r: any) => s + (r.sample_size || 0), 0);
  const teamAvg = rows.reduce((s: number, r: any) => s + (parseFloat(r.value) || 0), 0) / rows.length;

  const segments = rows.map((r: any, idx: number) => {
    const val = parseFloat(r.value) || 0;
    const delta = teamAvg > 0 ? Math.round(((val - teamAvg) / teamAvg) * 100) : 0;
    return {
      segment_value: String(r.segment_value || '(unknown)'),
      value: val,
      formatted: formatMetricValue(metric, val),
      sample_size: r.sample_size || 0,
      vs_team_average: delta,
      rank: idx + 1,
    };
  });

  return {
    metric,
    segment_by,
    segments,
    team_average: teamAvg,
    team_average_formatted: formatMetricValue(metric, teamAvg),
    total_sample_size: totalSample,
    formula: `${metric} grouped by ${segment_by}`,
    query_description: `${metric} by ${segment_by} — ${segments.length} segments, team avg ${formatMetricValue(metric, teamAvg)}`,
  };
}

function formatMetricValue(metric: string, val: number): string {
  if (metric === 'win_rate') return `${(val * 100).toFixed(1)}%`;
  if (metric === 'avg_sales_cycle') return `${Math.round(val)} days`;
  if (metric === 'avg_deal_size' || metric === 'total_pipeline' || metric === 'pipeline_created') {
    return val >= 1_000_000 ? `$${(val / 1_000_000).toFixed(2)}M` : `$${(val / 1_000).toFixed(0)}K`;
  }
  return String(val);
}

// ─── Tool 12: search_transcripts ─────────────────────────────────────────────

async function searchTranscripts(workspaceId: string, params: Record<string, any>) {
  if (!params.query) throw new Error('query is required for search_transcripts');

  const maxResults = Math.min(params.max_results || 5, 10);
  const searchQuery = params.query as string;
  const values: any[] = [workspaceId];

  const conditions: string[] = ['cv.workspace_id = $1', 'cv.is_internal = false'];

  if (params.deal_id) conditions.push(`cv.deal_id = $${values.push(params.deal_id)}`);
  if (params.account_id) conditions.push(`cv.account_id = $${values.push(params.account_id)}`);
  if (params.rep_email) conditions.push(`cv.participants::text ILIKE $${values.push(`%${params.rep_email}%`)}`);
  if (params.since) conditions.push(`cv.call_date >= $${values.push(params.since)}`);
  if (params.until) conditions.push(`cv.call_date <= $${values.push(params.until)}`);

  const where = conditions.join(' AND ');

  // Check if tsvector index exists — prefer it, fall back to ILIKE
  let useFullText = false;
  try {
    const tsCheck = await query<{ cnt: string }>(
      `SELECT COUNT(*)::text as cnt FROM information_schema.columns
       WHERE table_name = 'conversations' AND column_name = 'transcript_tsv'`,
      []
    );
    useFullText = parseInt(tsCheck.rows[0]?.cnt || '0') > 0;
  } catch {}

  let searchRows: any[];

  if (useFullText) {
    const tsq = `$${values.push(searchQuery)}`;
    const excerptSql = `
      SELECT cv.id, cv.title, cv.call_date, cv.duration_seconds, cv.participants,
             a.name as account_name, d.name as deal_name,
             ts_headline('english', COALESCE(cv.transcript_text, ''), plainto_tsquery(${tsq}),
               'MaxWords=30, MinWords=10, StartSel=[MATCH], StopSel=[/MATCH]') as excerpt
      FROM conversations cv
      LEFT JOIN accounts a ON a.id = cv.account_id AND a.workspace_id = cv.workspace_id
      LEFT JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = cv.workspace_id
      WHERE ${where}
        AND cv.transcript_tsv @@ plainto_tsquery(${tsq})
      ORDER BY ts_rank(cv.transcript_tsv, plainto_tsquery(${tsq})) DESC
      LIMIT $${values.push(maxResults)}
    `;
    const r = await query<any>(excerptSql, values);
    searchRows = r.rows;
  } else {
    // ILIKE fallback — also search summaries if transcript is sparse
    const ilikePat = `$${values.push(`%${searchQuery}%`)}`;
    const excerptSql = `
      SELECT cv.id, cv.title, cv.call_date, cv.duration_seconds, cv.participants,
             a.name as account_name, d.name as deal_name,
             cv.transcript_text, cv.summary
      FROM conversations cv
      LEFT JOIN accounts a ON a.id = cv.account_id AND a.workspace_id = cv.workspace_id
      LEFT JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = cv.workspace_id
      WHERE ${where}
        AND (cv.transcript_text ILIKE ${ilikePat} OR cv.summary ILIKE ${ilikePat})
      ORDER BY cv.call_date DESC
      LIMIT $${values.push(maxResults)}
    `;
    const r = await query<any>(excerptSql, values);
    searchRows = r.rows;
  }

  const excerpts = searchRows.map((r: any) => {
    let excerpt = '';
    let usedSource = 'transcript';

    if (useFullText && r.excerpt) {
      excerpt = r.excerpt;
    } else if (r.transcript_text) {
      const idx = r.transcript_text.toLowerCase().indexOf(searchQuery.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 80);
        const end = Math.min(r.transcript_text.length, idx + 120);
        excerpt = `...${r.transcript_text.slice(start, end)}...`;
      }
    } else if (r.summary) {
      const idx = r.summary.toLowerCase().indexOf(searchQuery.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 100);
        const end = Math.min(r.summary.length, idx + 200);
        excerpt = `[From summary] ...${r.summary.slice(start, end)}...`;
        usedSource = 'summary';
      }
    }

    // Try to extract speaker from transcript line containing match
    let speaker: string | null = null;
    if (r.transcript_text && excerpt && usedSource === 'transcript') {
      const matchIdx = r.transcript_text.toLowerCase().indexOf(searchQuery.toLowerCase());
      if (matchIdx >= 0) {
        const lineStart = r.transcript_text.lastIndexOf('\n', matchIdx);
        const lineText = r.transcript_text.slice(lineStart + 1, matchIdx);
        const colonIdx = lineText.indexOf(':');
        if (colonIdx > 0 && colonIdx < 40) speaker = lineText.slice(0, colonIdx).trim();
      }
    }

    let repName: string | null = null;
    try {
      const parts = r.participants;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (p.affiliation === 'Internal' || p.type === 'host') {
            repName = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || null;
            break;
          }
        }
      }
    } catch {}

    return {
      conversation_id: r.id,
      conversation_title: r.title,
      conversation_date: r.call_date,
      account_name: r.account_name || null,
      rep_name: repName,
      duration_minutes: r.duration_seconds ? Math.round(r.duration_seconds / 60) : null,
      excerpt: excerpt || '[excerpt extraction failed]',
      speaker,
      timestamp_in_call: null,  // not stored in current schema
    };
  });

  let totalAvailable = excerpts.length;
  try {
    const countValues: any[] = [workspaceId, `%${searchQuery}%`];
    const countConditions = ['cv.workspace_id = $1', 'cv.is_internal = false', '(cv.transcript_text ILIKE $2 OR cv.summary ILIKE $2)'];
    if (params.deal_id) countConditions.push(`cv.deal_id = $${countValues.push(params.deal_id)}`);
    if (params.account_id) countConditions.push(`cv.account_id = $${countValues.push(params.account_id)}`);
    if (params.since) countConditions.push(`cv.call_date >= $${countValues.push(params.since)}`);
    if (params.until) countConditions.push(`cv.call_date <= $${countValues.push(params.until)}`);
    const countResult = await query<any>(
      `SELECT COUNT(*)::int as cnt FROM conversations cv WHERE ${countConditions.join(' AND ')}`,
      countValues
    );
    totalAvailable = countResult.rows[0]?.cnt || excerpts.length;
  } catch {}

  return {
    excerpts,
    total_matches: excerpts.length,
    total_results_available: totalAvailable,
    query_description: `Transcript search for "${searchQuery}" — ${excerpts.length} of ${totalAvailable} matches returned`,
  };
}

// ─── Tool 13: compute_forecast_accuracy ───────────────────────────────────────

async function computeForecastAccuracy(workspaceId: string, params: Record<string, any>) {
  const lookbackQuarters = Math.min(params.lookback_quarters || 4, 8);

  // Build quarter date ranges going back from current quarter
  const now = new Date();
  const quarters: { label: string; start: string; end: string }[] = [];
  for (let q = 0; q < lookbackQuarters; q++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - q * 3);
    const year = d.getFullYear();
    const qIdx = Math.floor(d.getMonth() / 3);
    const qStart = new Date(year, qIdx * 3, 1);
    const qEnd = new Date(year, qIdx * 3 + 3, 0);
    // Skip current (partial) quarter
    if (q === 0) continue;
    quarters.push({
      label: `Q${qIdx + 1} ${year}`,
      start: qStart.toISOString().split('T')[0],
      end: qEnd.toISOString().split('T')[0],
    });
  }

  // Attempt to pull forecast snapshots from skill_runs
  const snapshotResult = await query<any>(
    `SELECT result, completed_at
     FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = 'weekly-forecast-rollup' AND status = 'completed'
     ORDER BY completed_at DESC
     LIMIT 50`,
    [workspaceId]
  );

  const hasSnapshots = snapshotResult.rows.length >= 3;

  // Gather all reps from closed deals
  const repConds = ['workspace_id = $1', "stage_normalized IN ('closed_won','closed_lost')", 'owner IS NOT NULL'];
  const repVals: any[] = [workspaceId];
  const toolFilters = await getToolFilters(workspaceId, 'general', repVals.length + 1, 'deals').catch(()=>({whereClause: '', params: [], paramOffset: repVals.length + 1, appliedRules: []}));
  if (toolFilters.whereClause) {
    repConds.push(toolFilters.whereClause.replace(/^\s*AND\s+/, ''));
    repVals.push(...toolFilters.params);
  }
const repResult = await query<any>(
    `SELECT DISTINCT owner as name, owner as email
     FROM deals
     WHERE ${repConds.join(' AND ')}`,
    repVals
  );

  const ownerFilter = params.owner_email
    ? `AND LOWER(d.owner) = '${params.owner_email.toLowerCase()}'`
    : '';

  const reps: any[] = [];

  for (const rep of repResult.rows) {
    if (params.owner_email && rep.email?.toLowerCase() !== params.owner_email.toLowerCase()) continue;

    let commitAccuracy = 0;
    let bestCaseAccuracy = 0;
    let quartersAnalyzed = 0;

    if (hasSnapshots) {
      // Use snapshot data to compute accuracy
      let totalCommitForecast = 0;
      let totalCommitActual = 0;
      let totalBestForecast = 0;
      let totalBestActual = 0;

      for (const snapshot of snapshotResult.rows) {
        const result = snapshot.result || {};
        const repData = (result.reps || result.by_rep || []).find((r: any) =>
          r.owner_email === rep.email || r.owner === rep.email || r.name === rep.name
        );
        if (!repData) continue;

        const snapDate = new Date(snapshot.completed_at);
        const snapQ = quarters.find(q => new Date(q.start) <= snapDate && snapDate <= new Date(q.end));
        if (!snapQ) continue;

        const actualResult = await query<{ actual: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text as actual
           FROM deals
           WHERE workspace_id = $1
             AND LOWER(owner) = $2
             AND stage_normalized = 'closed_won'
             AND close_date >= $3 AND close_date <= $4`,
          [workspaceId, rep.email?.toLowerCase(), snapQ.start, snapQ.end]
        );
        const actual = parseFloat(actualResult.rows[0]?.actual || '0');

        const commit = parseFloat(repData.commit_amount || repData.commit || 0);
        const bestCase = parseFloat(repData.best_case_amount || repData.best_case || 0);

        if (commit > 0) { totalCommitForecast += commit; totalCommitActual += actual; quartersAnalyzed++; }
        if (bestCase > 0) { totalBestForecast += bestCase; totalBestActual += actual; }
      }

      commitAccuracy = totalCommitForecast > 0 ? totalCommitActual / totalCommitForecast : 0;
      bestCaseAccuracy = totalBestForecast > 0 ? totalBestActual / totalBestForecast : 0;
    } else {
      // Degraded: use pipeline-at-quarter-start vs closed-won approach
      for (const qtr of quarters) {
        // Deals that were open at start of quarter
        const openAtStart = await query<{ total: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text as total
           FROM deals
           WHERE workspace_id = $1
             AND LOWER(owner) = $2
             AND created_at <= $3
             AND (close_date >= $3 OR stage_normalized NOT IN ('closed_won','closed_lost'))
             ${ownerFilter}`,
          [workspaceId, rep.email?.toLowerCase(), qtr.start]
        );
        const openPipeline = parseFloat(openAtStart.rows[0]?.total || '0');

        const closedWon = await query<{ total: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text as total
           FROM deals
           WHERE workspace_id = $1
             AND LOWER(owner) = $2
             AND stage_normalized = 'closed_won'
             AND close_date >= $3 AND close_date <= $4`,
          [workspaceId, rep.email?.toLowerCase(), qtr.start, qtr.end]
        );
        const wonAmount = parseFloat(closedWon.rows[0]?.total || '0');

        if (openPipeline > 0) {
          commitAccuracy += wonAmount / openPipeline;
          quartersAnalyzed++;
        }
      }
      if (quartersAnalyzed > 0) commitAccuracy /= quartersAnalyzed;
      bestCaseAccuracy = commitAccuracy;  // No distinction without snapshot data
    }

    // Avg slip days — how many days do committed deals close late?
    const slipResult = await query<{ avg_slip: string }>(
      `SELECT AVG(
         GREATEST(0, EXTRACT(DAY FROM (updated_at::date - close_date::date)))
       )::text as avg_slip
       FROM deals
       WHERE workspace_id = $1
         AND LOWER(owner) = $2
         AND stage_normalized = 'closed_won'
         AND close_date IS NOT NULL`,
      [workspaceId, rep.email?.toLowerCase()]
    );
    const avgSlip = parseFloat(slipResult.rows[0]?.avg_slip || '0');

    const haircut = commitAccuracy > 0 ? Math.min(commitAccuracy, 1.3) : 1.0;
    let direction: 'sandbag' | 'over_commit' | 'balanced' = 'balanced';
    if (commitAccuracy > 1.1) direction = 'sandbag';
    else if (commitAccuracy < 0.8) direction = 'over_commit';

    reps.push({
      name: rep.name,
      email: rep.email,
      quarters_analyzed: quartersAnalyzed || quarters.length,
      commit_accuracy: Math.round(commitAccuracy * 100) / 100,
      best_case_accuracy: Math.round(bestCaseAccuracy * 100) / 100,
      direction,
      haircut_factor: Math.round(haircut * 100) / 100,
      avg_slip_days: Math.round(avgSlip),
    });
  }

  const teamAvg = reps.length > 0
    ? reps.reduce((s, r) => s + r.commit_accuracy, 0) / reps.length
    : 0;

  return {
    reps,
    team_average_accuracy: Math.round(teamAvg * 100) / 100,
    data_source: hasSnapshots ? 'forecast_snapshots' : 'pipeline_vs_actuals_approximation',
    query_description: `Forecast accuracy (${lookbackQuarters - 1} completed quarters): ${reps.length} reps analyzed, team avg ${Math.round(teamAvg * 100)}%${hasSnapshots ? '' : ' (approximated — no forecast snapshots available)'}`,
  };
}

// ─── Tool 14: compute_close_probability ──────────────────────────────────────

// Hardcoded normalized stage order for advancement scoring (no stage_mappings table in DB)
const STAGE_ORDER: Record<string, number> = {
  awareness: 1, qualification: 2, evaluation: 3, decision: 4, negotiation: 5,
};
const STAGE_ORDER_MAX = 5; // negotiation = highest open stage

async function computeCloseProbability(workspaceId: string, params: Record<string, any>): Promise<any> {
  try {
  const ownerName: string | null = params.owner_name || params.owner_email || null;
  const dealIds: string[] | null = params.deal_ids || null;
  const limit = Math.min(params.limit || 50, 100);
  const queryErrors: string[] = [];

  // 1. Open deals (no stage_mappings JOIN — use inline CASE for stage order)
  const dealConds = [
    'd.workspace_id = $1',
    "d.stage_normalized NOT IN ('closed_won', 'closed_lost')",
    'd.amount IS NOT NULL',
    'd.amount > 0',
  ];
  const dealVals: any[] = [workspaceId];

  if (ownerName) {
    dealVals.push(`%${ownerName}%`);
    dealConds.push(`d.owner ILIKE $${dealVals.length}`);
  }
  if (dealIds?.length) {
    dealVals.push(dealIds);
    dealConds.push(`d.id = ANY($${dealVals.length})`);
  }

    // Inject tool filters for general context
  const dealToolFilters = await getToolFilters(workspaceId, 'general', dealVals.length + 1, 'd').catch(()=>({whereClause: '', params: [], paramOffset: dealVals.length + 1, appliedRules: []}));
  if (dealToolFilters.whereClause) {
    dealConds.push(dealToolFilters.whereClause.replace(/^\s*AND\s+/, ''));
    dealVals.push(...dealToolFilters.params);
  }

  const dealRows = await query<any>(
    `SELECT d.id, d.name, d.amount, d.stage, d.stage_normalized, d.close_date,
            d.owner as owner_name, d.account_id, d.forecast_category,
            d.probability as crm_probability,
            d.days_in_stage,
            CASE WHEN d.close_date IS NOT NULL
                 THEN EXTRACT(DAY FROM (d.close_date::date - CURRENT_DATE))
                 ELSE NULL END as days_to_close
     FROM deals d
     WHERE ${dealConds.join(' AND ')}
     ORDER BY d.amount DESC NULLS LAST
     LIMIT $${dealVals.length + 1}`,
    [...dealVals, limit]
  ).catch((err: any) => {
    console.error('[compute_close_probability] deals query failed:', err?.message);
    queryErrors.push(`deals: ${err?.message}`);
    return { rows: [] as any[] };
  });

  if (dealRows.rows.length === 0) {
    return {
      scored_deals: [],
      total_scored: 0,
      total_pipeline: 0,
      probability_weighted_pipeline: 0,
      average_probability: 0,
      scoring_model: 'engagement(30%) + velocity(30%) + qualification(20%) + execution(20%)',
      query_description: 'No open deals with amounts found',
    };
  }

  const dealIdList = dealRows.rows.map((r: any) => r.id);

  // 2. Conversation counts per deal (direct deal_id on conversations)
  const convRows = await query<{ deal_id: string; call_count: string; last_call_date: string }>(
    `SELECT cv.deal_id, COUNT(*)::text as call_count, MAX(cv.call_date)::text as last_call_date
     FROM conversations cv
     WHERE cv.workspace_id = $1 AND cv.deal_id = ANY($2) AND cv.is_internal = false
     GROUP BY cv.deal_id`,
    [workspaceId, dealIdList]
  ).catch((err: any) => {
    console.error('[compute_close_probability] conversations query failed:', err?.message);
    queryErrors.push(`conversations: ${err?.message}`);
    return { rows: [] as any[] };
  });
  const convMap = new Map<string, { call_count: number; last_call_date: string | null }>();
  for (const r of convRows.rows) {
    convMap.set(r.deal_id, { call_count: parseInt(r.call_count), last_call_date: r.last_call_date });
  }

  // 3. Contact counts per deal
  const contactRows = await query<{ deal_id: string; total: string; key_contacts: string }>(
    `SELECT dc.deal_id,
            COUNT(*)::text as total,
            COUNT(CASE WHEN dc.role IN ('champion', 'economic_buyer') THEN 1 END)::text as key_contacts
     FROM deal_contacts dc
     WHERE dc.workspace_id = $1 AND dc.deal_id = ANY($2)
     GROUP BY dc.deal_id`,
    [workspaceId, dealIdList]
  ).catch((err: any) => {
    console.error('[compute_close_probability] contacts query failed:', err?.message);
    queryErrors.push(`contacts: ${err?.message}`);
    return { rows: [] as any[] };
  });
  const contactMap = new Map<string, { total: number; key_contacts: number }>();
  for (const r of contactRows.rows) {
    contactMap.set(r.deal_id, { total: parseInt(r.total), key_contacts: parseInt(r.key_contacts) });
  }

  // 4. Regression counts from deal_stage_history
  // A regression is any transition where to_stage_normalized is earlier in STAGE_ORDER than from_stage_normalized
  const regressionRows = await query<{ deal_id: string; regressions: string }>(
    `WITH stage_ord(stage_name, ord) AS (
       VALUES ('awareness',1),('qualification',2),('evaluation',3),('decision',4),('negotiation',5)
     )
     SELECT dsh.deal_id, COUNT(*)::text as regressions
     FROM deal_stage_history dsh
     JOIN stage_ord so_to ON so_to.stage_name = dsh.to_stage_normalized
     JOIN stage_ord so_from ON so_from.stage_name = dsh.from_stage_normalized
     WHERE dsh.workspace_id = $1 AND dsh.deal_id = ANY($2)
       AND so_from.ord > so_to.ord
     GROUP BY dsh.deal_id`,
    [workspaceId, dealIdList]
  ).catch((err: any) => {
    console.error('[compute_close_probability] regressions query failed:', err?.message);
    queryErrors.push(`regressions: ${err?.message}`);
    return { rows: [] as any[] };
  });
  const regressionMap = new Map<string, number>();
  for (const r of regressionRows.rows) {
    regressionMap.set(r.deal_id, parseInt(r.regressions));
  }

  // 5. Rep win rates (last 12 months) — keyed by owner name (no owner_email on deals)
  const winRateRows = await query<{ owner_name: string; win_rate: string }>(
    `SELECT d.owner as owner_name,
            (COUNT(CASE WHEN d.stage_normalized = 'closed_won' THEN 1 END)::float /
             NULLIF(COUNT(CASE WHEN d.stage_normalized IN ('closed_won', 'closed_lost') THEN 1 END), 0))::text as win_rate
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.close_date >= CURRENT_DATE - INTERVAL '365 days'
       AND d.owner IS NOT NULL
     GROUP BY d.owner`,
    [workspaceId]
  ).catch((err: any) => {
    console.error('[compute_close_probability] win_rates query failed:', err?.message);
    queryErrors.push(`win_rates: ${err?.message}`);
    return { rows: [] as any[] };
  });
  const repWinRates = new Map<string, number>();
  let teamWinRateSum = 0;
  let teamWinRateCount = 0;
  for (const r of winRateRows.rows) {
    const wr = parseFloat(r.win_rate || '0');
    if (!isNaN(wr) && wr > 0) {
      repWinRates.set(r.owner_name, wr);
      teamWinRateSum += wr;
      teamWinRateCount++;
    }
  }
  const teamAvgWinRate = teamWinRateCount > 0 ? teamWinRateSum / teamWinRateCount : 0.25;

  // 6. Median open deal size
  const medianRow = await query<{ median_amount: string }>(
    `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::text as median_amount
     FROM deals WHERE workspace_id = $1 AND amount > 0
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId]
  ).catch((err: any) => {
    console.error('[compute_close_probability] median query failed:', err?.message);
    queryErrors.push(`median: ${err?.message}`);
    return { rows: [{ median_amount: '0' }] as any[] };
  });
  const medianAmount = parseFloat(medianRow.rows[0]?.median_amount || '0');

  // 7. Stage velocity benchmarks — use from_stage_normalized + duration_in_previous_stage_ms
  const benchmarkRows = await query<{
    stage_normalized: string;
    median_days: string;
    p75_days: string;
    p90_days: string;
  }>(
    `SELECT dsh.from_stage_normalized as stage_normalized,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dsh.duration_in_previous_stage_ms / 86400000.0)::text as median_days,
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY dsh.duration_in_previous_stage_ms / 86400000.0)::text as p75_days,
            PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY dsh.duration_in_previous_stage_ms / 86400000.0)::text as p90_days
     FROM deal_stage_history dsh
     WHERE dsh.workspace_id = $1
       AND dsh.duration_in_previous_stage_ms IS NOT NULL
       AND dsh.duration_in_previous_stage_ms > 0
       AND dsh.from_stage_normalized IS NOT NULL
     GROUP BY dsh.from_stage_normalized`,
    [workspaceId]
  ).catch((err: any) => {
    console.error('[compute_close_probability] benchmarks query failed:', err?.message);
    queryErrors.push(`benchmarks: ${err?.message}`);
    return { rows: [] as any[] };
  });
  const benchmarkMap = new Map<string, { median: number; p75: number; p90: number }>();
  for (const r of benchmarkRows.rows) {
    benchmarkMap.set(r.stage_normalized, {
      median: parseFloat(r.median_days),
      p75: parseFloat(r.p75_days),
      p90: parseFloat(r.p90_days),
    });
  }

  // Score each deal
  const scoredDeals = dealRows.rows.map((deal: any) => {
    const convData = convMap.get(deal.id) || { call_count: 0, last_call_date: null };
    const contactData = contactMap.get(deal.id) || { total: 0, key_contacts: 0 };
    const regressions = regressionMap.get(deal.id) || 0;
    const repWinRate = repWinRates.get(deal.owner_name || '');
    const benchmark = benchmarkMap.get(deal.stage_normalized);
    const daysInStage = parseFloat(deal.days_in_stage) || 0;
    const daysToClose = deal.days_to_close !== null ? parseFloat(deal.days_to_close) : null;
    const amount = parseFloat(deal.amount) || 0;

    // === Qualification (weight: 0.20) ===
    const stageOrder = STAGE_ORDER[deal.stage_normalized] ?? 1;
    const stageAdvancement = Math.min(stageOrder / (STAGE_ORDER_MAX * 0.7), 1);
    const amountScore = medianAmount > 0 ? Math.min(amount / medianAmount / 1.5, 1) : 0.5;
    const fcScores: Record<string, number> = { commit: 1.0, best_case: 0.7, pipeline: 0.4 };
    const forecastScore = fcScores[deal.forecast_category] ?? 0.3;
    const qualificationScore = stageAdvancement * 0.4 + amountScore * 0.2 + forecastScore * 0.4;

    // === Engagement (weight: 0.30) ===
    const contactScore = contactData.total >= 3 ? 1.0 : contactData.total === 2 ? 0.7 : contactData.total === 1 ? 0.4 : 0;
    const keyContactScore = contactData.key_contacts > 0 ? 1.0 : 0;
    let callRecencyScore = 0;
    if (convData.last_call_date) {
      const daysSinceCall = Math.round((Date.now() - new Date(convData.last_call_date).getTime()) / 86400000);
      callRecencyScore = daysSinceCall <= 14 ? 1.0 : daysSinceCall <= 30 ? 0.6 : daysSinceCall <= 60 ? 0.3 : 0;
    }
    const engagementScore = contactScore * 0.3 + keyContactScore * 0.3 + callRecencyScore * 0.4;

    // === Velocity (weight: 0.30) ===
    let velocityStageScore = 0.7; // default if no benchmark
    if (benchmark) {
      if (daysInStage <= benchmark.median) velocityStageScore = 1.0;
      else if (daysInStage <= benchmark.p75) velocityStageScore = 0.7;
      else if (daysInStage <= benchmark.p90) velocityStageScore = 0.4;
      else velocityStageScore = 0.1;
    }
    let closeDateScore = 0.5;
    if (daysToClose !== null) {
      if (daysToClose >= 30) closeDateScore = 1.0;
      else if (daysToClose >= 14) closeDateScore = 0.8;
      else if (daysToClose >= 7) closeDateScore = 0.5;
      else if (daysToClose >= 0) closeDateScore = 0.2;
      else closeDateScore = 0; // past due
    }
    const regressionScore = regressions === 0 ? 1.0 : regressions === 1 ? 0.5 : 0.2;
    const velocityScore = velocityStageScore * 0.4 + closeDateScore * 0.3 + regressionScore * 0.3;

    // === Execution (weight: 0.20) ===
    let executionScore = 0.5;
    if (repWinRate !== undefined && teamAvgWinRate > 0) {
      executionScore = Math.min((repWinRate / teamAvgWinRate) / 2, 1);
    }

    // === Final probability ===
    const rawScore = qualificationScore * 0.20
      + engagementScore * 0.30
      + velocityScore * 0.30
      + executionScore * 0.20;
    const probability = Math.min(Math.round(rawScore * 100), 95);

    // Build factor lists
    const positiveFactors: string[] = [];
    const riskFactors: string[] = [];
    const dataGaps: string[] = [];

    if (stageAdvancement >= 0.7) positiveFactors.push('Advanced stage');
    if (deal.forecast_category === 'commit') positiveFactors.push('Commit category');
    if (contactData.key_contacts > 0) positiveFactors.push('Champion or economic buyer identified');
    if (convData.call_count >= 3) positiveFactors.push(`Active deal — ${convData.call_count} calls recorded`);
    if (callRecencyScore >= 0.6) positiveFactors.push('Recent call activity (last 30 days)');
    if (benchmark && daysInStage <= benchmark.median) positiveFactors.push('Progressing faster than median');
    if (repWinRate !== undefined && repWinRate > teamAvgWinRate * 1.1)
      positiveFactors.push(`Rep win rate ${Math.round(repWinRate * 100)}% (above ${Math.round(teamAvgWinRate * 100)}% team avg)`);

    if (regressions > 0) riskFactors.push(`${regressions} stage regression${regressions > 1 ? 's' : ''}`);
    if (daysToClose !== null && daysToClose < 7)
      riskFactors.push(daysToClose < 0 ? 'Close date is past due' : `Close date in ${Math.round(daysToClose)} days`);
    if (benchmark && daysInStage > benchmark.p90)
      riskFactors.push(`${Math.round(daysInStage)} days in stage — exceeds p90 (${Math.round(benchmark.p90)} days)`);
    if (contactData.total === 0) riskFactors.push('No contacts linked (single-threaded risk)');
    if (convData.call_count === 0) riskFactors.push('No call recordings');
    if (repWinRate !== undefined && repWinRate < teamAvgWinRate * 0.8)
      riskFactors.push(`Rep win rate ${Math.round(repWinRate * 100)}% below team avg ${Math.round(teamAvgWinRate * 100)}%`);

    if (contactData.total === 0) dataGaps.push('No contacts in CRM');
    if (convData.call_count === 0) dataGaps.push('No call recordings');
    if (!benchmark) dataGaps.push('No stage benchmark (insufficient history)');
    if (daysToClose === null) dataGaps.push('No close date set');

    return {
      deal_id: deal.id,
      deal_name: deal.name,
      amount,
      stage: deal.stage,
      close_date: deal.close_date,
      owner: deal.owner_name,
      probability,
      crm_probability: deal.crm_probability,
      weighted_amount: Math.round(amount * probability / 100),
      dimension_scores: {
        qualification: Math.round(qualificationScore * 100),
        engagement: Math.round(engagementScore * 100),
        velocity: Math.round(velocityScore * 100),
        execution: Math.round(executionScore * 100),
      },
      signals: {
        days_in_stage: Math.round(daysInStage),
        benchmark_p75: benchmark ? Math.round(benchmark.p75) : null,
        days_to_close: daysToClose !== null ? Math.round(daysToClose) : null,
        contacts: contactData.total,
        key_contacts: contactData.key_contacts,
        call_count: convData.call_count,
        last_call_date: convData.last_call_date,
        regressions,
        rep_win_rate: repWinRate !== undefined ? Math.round(repWinRate * 100) : null,
        forecast_category: deal.forecast_category,
      },
      top_positive_factors: positiveFactors.slice(0, 3),
      top_risk_factors: riskFactors.slice(0, 3),
      data_gaps: dataGaps,
    };
  });

  scoredDeals.sort((a: any, b: any) => b.probability - a.probability);

  const totalRaw = scoredDeals.reduce((s: number, d: any) => s + d.amount, 0);
  const totalWeighted = scoredDeals.reduce((s: number, d: any) => s + d.weighted_amount, 0);
  const avgProbability = scoredDeals.length > 0
    ? Math.round(scoredDeals.reduce((s: number, d: any) => s + d.probability, 0) / scoredDeals.length)
    : 0;

  return {
    scored_deals: scoredDeals,
    total_scored: scoredDeals.length,
    total_pipeline: Math.round(totalRaw),
    probability_weighted_pipeline: Math.round(totalWeighted),
    average_probability: avgProbability,
    team_avg_win_rate: Math.round(teamAvgWinRate * 100),
    scoring_model: 'engagement(30%) + velocity(30%) + qualification(20%) + execution(20%)',
    query_description: `Probability-scored ${scoredDeals.length} open deals. Weighted pipeline: $${Math.round(totalWeighted).toLocaleString()} (raw: $${Math.round(totalRaw).toLocaleString()})`,
    ...(queryErrors.length > 0 ? { partial_data_warnings: queryErrors } : {}),
  };
  } catch (err: any) {
    console.error('[compute_close_probability] unexpected error:', err?.message, err?.stack);
    return {
      scored_deals: [],
      total_scored: 0,
      total_pipeline: 0,
      probability_weighted_pipeline: 0,
      average_probability: 0,
      scoring_model: 'engagement(30%) + velocity(30%) + qualification(20%) + execution(20%)',
      query_description: `compute_close_probability failed: ${err?.message}`,
      error: err?.message,
    };
  }
}

// ─── Tool 15: compute_pipeline_creation ──────────────────────────────────────

async function computePipelineCreation(workspaceId: string, params: Record<string, any>): Promise<any> {
  try {
    const groupBy = params.group_by || 'month';
    const lookbackMonths = params.lookback_months || 12;
    const segmentBy: string | null = params.segment_by || null;
    // Map group_by to date_trunc argument
    const truncUnit = groupBy === 'quarter' ? 'quarter' : groupBy === 'week' ? 'week' : 'month';

    // Base query for pipeline creation by period
    let baseQuery: string;
    const vals: any[] = [workspaceId];
    vals.push(`${lookbackMonths} months`);

    if (segmentBy && ['source', 'owner', 'pipeline'].includes(segmentBy)) {
      const segCol = segmentBy === 'owner' ? 'd.owner' : segmentBy === 'pipeline' ? 'd.pipeline' : 'd.source';
      baseQuery = `
        SELECT DATE_TRUNC('${truncUnit}', d.created_at)::text as period,
               ${segCol} as segment_value,
               COUNT(*)::int as deals_created,
               COALESCE(SUM(d.amount), 0)::numeric as amount_created,
               COALESCE(AVG(d.amount), 0)::numeric as avg_deal_size
        FROM deals d
        WHERE d.workspace_id = $1
          AND d.created_at >= NOW() - ($2::interval)
          AND d.created_at IS NOT NULL
          AND d.amount > 0
        GROUP BY period, segment_value
        ORDER BY period, segment_value`;
    } else if (segmentBy === 'deal_size_band') {
      baseQuery = `
        SELECT DATE_TRUNC('${truncUnit}', d.created_at)::text as period,
               CASE WHEN d.amount < 10000 THEN 'small'
                    WHEN d.amount < 50000 THEN 'mid'
                    WHEN d.amount < 150000 THEN 'large'
                    ELSE 'enterprise' END as segment_value,
               COUNT(*)::int as deals_created,
               COALESCE(SUM(d.amount), 0)::numeric as amount_created,
               COALESCE(AVG(d.amount), 0)::numeric as avg_deal_size
        FROM deals d
        WHERE d.workspace_id = $1
          AND d.created_at >= NOW() - ($2::interval)
          AND d.created_at IS NOT NULL
          AND d.amount > 0
        GROUP BY period, segment_value
        ORDER BY period, segment_value`;
    } else {
      baseQuery = `
        SELECT DATE_TRUNC('${truncUnit}', d.created_at)::text as period,
               COUNT(*)::int as deals_created,
               COALESCE(SUM(d.amount), 0)::numeric as amount_created,
               COALESCE(AVG(d.amount), 0)::numeric as avg_deal_size
        FROM deals d
        WHERE d.workspace_id = $1
          AND d.created_at >= NOW() - ($2::interval)
          AND d.created_at IS NOT NULL
          AND d.amount > 0
        GROUP BY period
        ORDER BY period`;
    }

        // Inject pipeline_value tool filters
    const pipeCreationTF = await getToolFilters(workspaceId, 'pipeline_value', vals.length + 1, 'd').catch(()=>({whereClause: '', params: [], paramOffset: vals.length + 1, appliedRules: []}));
    if (pipeCreationTF.whereClause) {
      baseQuery = baseQuery.replace(/GROUP/, pipeCreationTF.whereClause + ' GROUP');
      vals.push(...pipeCreationTF.params);
    }

    const rows = await query<any>(baseQuery, vals);  // Aggregate by period (merge segments into periods array)
    const periodMap = new Map<string, any>();
    for (const r of rows.rows) {
      const p = r.period;
      if (!periodMap.has(p)) {
        periodMap.set(p, {
          period: p,
          deals_created: 0,
          amount_created: 0,
          avg_deal_size: 0,
          ...(segmentBy ? { segments: [] } : {}),
        });
      }
      const entry = periodMap.get(p)!;
      if (segmentBy) {
        entry.segments.push({
          segment_value: r.segment_value,
          deals_created: r.deals_created,
          amount_created: parseFloat(r.amount_created),
        });
        entry.deals_created += r.deals_created;
        entry.amount_created += parseFloat(r.amount_created);
      } else {
        entry.deals_created = r.deals_created;
        entry.amount_created = parseFloat(r.amount_created);
        entry.avg_deal_size = parseFloat(r.avg_deal_size);
      }
    }
    if (segmentBy) {
      for (const entry of periodMap.values()) {
        entry.avg_deal_size = entry.deals_created > 0 ? entry.amount_created / entry.deals_created : 0;
      }
    }

    const periods = Array.from(periodMap.values());

    // Trend: last 3 complete periods vs prior 3
    const completePeriods = periods.filter(p => {
      if (params.include_current_period === false) {
        // exclude the last period (likely current, incomplete)
        return p !== periods[periods.length - 1];
      }
      return true;
    });

    const last3 = completePeriods.slice(-3);
    const prior3 = completePeriods.slice(-6, -3);
    const last3Avg = last3.length > 0 ? last3.reduce((s, p) => s + p.amount_created, 0) / last3.length : 0;
    const prior3Avg = prior3.length > 0 ? prior3.reduce((s, p) => s + p.amount_created, 0) / prior3.length : last3Avg;
    const changePct = prior3Avg > 0 ? Math.round((last3Avg - prior3Avg) / prior3Avg * 100) : 0;
    const direction = changePct > 10 ? 'increasing' : changePct < -10 ? 'declining' : 'stable';

    const allAmounts = periods.map(p => p.amount_created);
    const avgMonthlyAmount = allAmounts.length > 0 ? allAmounts.reduce((s, a) => s + a, 0) / allAmounts.length : 0;
    const allDeals = periods.map(p => p.deals_created);
    const avgMonthlyDeals = allDeals.length > 0 ? allDeals.reduce((s, d) => s + d, 0) / allDeals.length : 0;

    return {
      periods,
      trend: {
        direction,
        avg_monthly_creation: Math.round(avgMonthlyDeals),
        avg_monthly_amount: Math.round(avgMonthlyAmount),
        last_3m_avg_amount: Math.round(last3Avg),
        prior_3m_avg_amount: Math.round(prior3Avg),
        change_pct: changePct,
      },
      total_periods_analyzed: periods.length,
      query_description: `Pipeline creation ${groupBy}ly over ${lookbackMonths} months: ${periods.length} periods, avg $${Math.round(avgMonthlyAmount).toLocaleString()}/${groupBy}${segmentBy ? `, segmented by ${segmentBy}` : ''}. Trend: ${direction} (${changePct > 0 ? '+' : ''}${changePct}%)`,
    };
  } catch (err: any) {
    console.error('[compute_pipeline_creation] error:', err?.message);
    return { periods: [], trend: { direction: 'stable', avg_monthly_creation: 0, avg_monthly_amount: 0, last_3m_avg_amount: 0, prior_3m_avg_amount: 0, change_pct: 0 }, total_periods_analyzed: 0, query_description: `compute_pipeline_creation failed: ${err?.message}`, error: err?.message };
  }
}

// ─── Tool 16: compute_inqtr_close_rate ───────────────────────────────────────

async function computeInqtrCloseRate(workspaceId: string, params: Record<string, any>): Promise<any> {
  try {
    const lookbackQuarters = params.lookback_quarters || 4;

    // Build quarter date ranges for historical analysis
    const now = new Date();
    const currentQStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

    const quarterData: any[] = [];
    for (let q = lookbackQuarters; q >= 0; q--) {
      const qStart = new Date(currentQStart);
      qStart.setMonth(qStart.getMonth() - q * 3);
      const qEnd = new Date(qStart);
      qEnd.setMonth(qEnd.getMonth() + 3);

      const label = `${qStart.getFullYear()}-Q${Math.floor(qStart.getMonth() / 3) + 1}`;
      const isCurrent = q === 0;

            const inqtrTF = await getToolFilters(workspaceId, 'general', 4, 'd').catch(()=>({whereClause: '', params: [], paramOffset: 4, appliedRules: []}));
      const inqtrExtraWhere = inqtrTF.whereClause || '';
      const inqtrParams = [...inqtrTF.params];
const r = await query<any>(
        `SELECT
           COUNT(*)::int as deals_created,
           COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won'
             AND d.close_date >= $2 AND d.close_date < $3)::int as deals_closed_in_qtr,
           COALESCE(SUM(d.amount), 0)::numeric as amount_created,
           COALESCE(SUM(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won'
             AND d.close_date >= $2 AND d.close_date < $3), 0)::numeric as amount_closed_in_qtr,
           COALESCE(AVG(EXTRACT(DAY FROM (d.close_date - d.created_at::date))) FILTER (WHERE d.stage_normalized = 'closed_won'
             AND d.close_date >= $2 AND d.close_date < $3), 0)::numeric as avg_cycle_days
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.created_at >= $2 AND d.created_at < $3
           AND d.amount > 0${inqtrExtraWhere}`,
        [workspaceId, qStart.toISOString(), qEnd.toISOString(), ...inqtrParams]
      );

      const row = r.rows[0];
      const dealsCreated = row?.deals_created || 0;
      const dealsClosed = row?.deals_closed_in_qtr || 0;
      const amtCreated = parseFloat(row?.amount_created || '0');
      const amtClosed = parseFloat(row?.amount_closed_in_qtr || '0');
      const closeRate = dealsCreated > 0 ? dealsClosed / dealsCreated : 0;
      const amtCloseRate = amtCreated > 0 ? amtClosed / amtCreated : 0;

      quarterData.push({
        quarter: label,
        is_current: isCurrent,
        deals_created_in_quarter: dealsCreated,
        deals_closed_won_in_quarter: dealsClosed,
        close_rate: Math.round(closeRate * 1000) / 1000,
        amount_created: Math.round(amtCreated),
        amount_closed_in_quarter: Math.round(amtClosed),
        amount_close_rate: Math.round(amtCloseRate * 1000) / 1000,
        avg_cycle_days: Math.round(parseFloat(row?.avg_cycle_days || '0')),
      });
    }

    // Separate current quarter from historical
    const historical = quarterData.filter(q => !q.is_current);
    const current = quarterData.find(q => q.is_current)!;

    const avgCloseRate = historical.length > 0
      ? historical.reduce((s, q) => s + q.close_rate, 0) / historical.length : 0;
    const avgAmtCloseRate = historical.length > 0
      ? historical.reduce((s, q) => s + q.amount_close_rate, 0) / historical.length : 0;
    const avgCycleDays = historical.filter(q => q.avg_cycle_days > 0).length > 0
      ? historical.filter(q => q.avg_cycle_days > 0).reduce((s, q) => s + q.avg_cycle_days, 0) / historical.filter(q => q.avg_cycle_days > 0).length : 0;

    // Projection for current quarter
    const projectedInQtrCloses = Math.round((current?.deals_created_in_quarter || 0) * avgCloseRate);
    const projectedInQtrAmount = Math.round((current?.amount_created || 0) * avgAmtCloseRate);

    // Estimate remaining creation (use 1/3 of quarter monthly avg if early in quarter)
    const daysInQtr = 91;
    const now2 = new Date();
    const currentQStartMs = new Date(currentQStart).getTime();
    const daysElapsed = Math.round((now2.getTime() - currentQStartMs) / 86400000);
    const fractionRemaining = Math.max(0, (daysInQtr - daysElapsed) / daysInQtr);
    const estimatedRemainingCreation = Math.round((current?.amount_created || 0) * fractionRemaining);
    const estimatedAdditionalCloses = Math.round(estimatedRemainingCreation * avgAmtCloseRate);

    const currentQLabel = `${currentQStart.getFullYear()}-Q${Math.floor(currentQStart.getMonth() / 3) + 1}`;

    return {
      quarters: historical,
      overall: {
        avg_close_rate: Math.round(avgCloseRate * 1000) / 1000,
        avg_amount_close_rate: Math.round(avgAmtCloseRate * 1000) / 1000,
        avg_cycle_days: Math.round(avgCycleDays),
      },
      projection: {
        current_quarter: currentQLabel,
        deals_created_so_far: current?.deals_created_in_quarter || 0,
        amount_created_so_far: current?.amount_created || 0,
        projected_in_qtr_closes: projectedInQtrCloses,
        projected_in_qtr_amount: projectedInQtrAmount,
        estimated_remaining_creation: estimatedRemainingCreation,
        estimated_additional_closes: estimatedAdditionalCloses,
      },
      query_description: `In-quarter close rates (${lookbackQuarters} quarters): avg ${Math.round(avgCloseRate * 100)}% of pipeline created in a quarter closes that quarter. Current quarter: $${(current?.amount_created || 0).toLocaleString()} created so far, projecting $${projectedInQtrAmount.toLocaleString()} in-quarter bookings`,
    };
  } catch (err: any) {
    console.error('[compute_inqtr_close_rate] error:', err?.message);
    return { quarters: [], overall: { avg_close_rate: 0, avg_amount_close_rate: 0, avg_cycle_days: 0 }, projection: null, query_description: `compute_inqtr_close_rate failed: ${err?.message}`, error: err?.message };
  }
}

// ─── Tool 17: compute_competitive_rates ──────────────────────────────────────

async function computeCompetitiveRates(workspaceId: string, params: Record<string, any>): Promise<any> {
  try {
    const lookbackMonths = params.lookback_months || 12;
    const filterCompetitor: string | null = params.competitor || null;

    // Get deals with competitor mentions from conversations
    // conversations.competitor_mentions is JSONB array of competitor name strings
    const compRows = await query<any>(
      `SELECT DISTINCT ON (cv.deal_id, comp_name)
              cv.deal_id,
              cv.call_date,
              d.name as deal_name, d.amount, d.stage, d.stage_normalized,
              d.owner,
              comp_name
       FROM conversations cv
       CROSS JOIN LATERAL jsonb_array_elements_text(cv.competitor_mentions) AS comp_name
       LEFT JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = $1
       WHERE cv.workspace_id = $1
         AND cv.call_date >= NOW() - ($2 || ' months')::interval
         AND cv.competitor_mentions IS NOT NULL
         AND jsonb_array_length(cv.competitor_mentions) > 0
         ${filterCompetitor ? `AND comp_name ILIKE $3` : ''}
       ORDER BY cv.deal_id, comp_name, cv.call_date DESC`,
      filterCompetitor
        ? [workspaceId, String(lookbackMonths), `%${filterCompetitor}%`]
        : [workspaceId, String(lookbackMonths)]
    ).catch(() => ({ rows: [] as any[] }));

    // Also check deal_insights for competition type
    const insightRows = await query<any>(
      `SELECT di.deal_id, di.insight_value,
              d.name as deal_name, d.amount, d.stage, d.stage_normalized, d.owner
       FROM deal_insights di
       JOIN deals d ON d.id = di.deal_id AND d.workspace_id = $1
       WHERE di.workspace_id = $1
         AND di.insight_type = 'competition'
         AND di.is_current = true
         AND d.created_at >= NOW() - ($2 || ' months')::interval`,
      [workspaceId, String(lookbackMonths)]
    ).catch(() => ({ rows: [] as any[] }));

    // Also check deals.custom_fields for competitor data
    const customRows = await query<any>(
      `SELECT d.id as deal_id, d.name as deal_name, d.amount, d.stage, d.stage_normalized, d.owner,
              d.custom_fields->>'competitor' as competitor_custom,
              d.custom_fields->>'loss_reason' as loss_reason
       FROM deals d
       WHERE d.workspace_id = $1
         AND d.created_at >= NOW() - ($2 || ' months')::interval
         AND (d.custom_fields->>'competitor' IS NOT NULL OR d.custom_fields->>'loss_reason' IS NOT NULL)`,
      [workspaceId, String(lookbackMonths)]
    ).catch(() => ({ rows: [] as any[] }));

    // Aggregate competitor data
    const competitorMap = new Map<string, {
      deal_ids: Set<string>;
      wins: number; losses: number; open: number;
      amounts: number[]; cycle_days: number[];
      recent_deals: any[];
    }>();

    const addCompetitorDeal = (compName: string, deal: any) => {
      const key = compName.toLowerCase().trim();
      if (!competitorMap.has(key)) {
        competitorMap.set(key, { deal_ids: new Set(), wins: 0, losses: 0, open: 0, amounts: [], cycle_days: [], recent_deals: [] });
      }
      const entry = competitorMap.get(key)!;
      if (entry.deal_ids.has(deal.deal_id || deal.id)) return;
      entry.deal_ids.add(deal.deal_id || deal.id);
      const outcome = deal.stage_normalized === 'closed_won' ? 'won' : deal.stage_normalized === 'closed_lost' ? 'lost' : 'open';
      if (outcome === 'won') entry.wins++;
      else if (outcome === 'lost') entry.losses++;
      else entry.open++;
      if (deal.amount) entry.amounts.push(parseFloat(deal.amount));
      if (entry.recent_deals.length < 5) {
        entry.recent_deals.push({ deal_name: deal.deal_name || deal.name, amount: parseFloat(deal.amount || '0'), outcome, stage: deal.stage });
      }
    };

    for (const r of compRows.rows) {
      if (r.comp_name) addCompetitorDeal(r.comp_name, r);
    }
    for (const r of insightRows.rows) {
      const val = typeof r.insight_value === 'string' ? r.insight_value : JSON.stringify(r.insight_value);
      if (val) addCompetitorDeal(val, r);
    }
    for (const r of customRows.rows) {
      if (r.competitor_custom) addCompetitorDeal(r.competitor_custom, r);
    }

    // Overall win rate without any competitor
    const noCompResult = await query<any>(
      `SELECT
         COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')::int as wins,
         COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won','closed_lost'))::int as total_closed
       FROM deals d
       WHERE d.workspace_id = $1
         AND d.created_at >= NOW() - ($2 || ' months')::interval
         AND NOT EXISTS (
           SELECT 1 FROM conversations cv
           WHERE cv.deal_id = d.id AND cv.workspace_id = $1
             AND jsonb_array_length(COALESCE(cv.competitor_mentions,'[]'::jsonb)) > 0
         )`,
      [workspaceId, String(lookbackMonths)]
    ).catch(() => ({ rows: [{ wins: 0, total_closed: 0 }] as any[] }));

    const noCompWins = noCompResult.rows[0]?.wins || 0;
    const noCompTotal = noCompResult.rows[0]?.total_closed || 0;
    const winRateWithout = noCompTotal > 0 ? noCompWins / noCompTotal : 0;

    const competitors = Array.from(competitorMap.entries())
      .filter(([, v]) => v.wins + v.losses + v.open > 0)
      .map(([name, v]) => {
        const totalClosed = v.wins + v.losses;
        const winRate = totalClosed > 0 ? v.wins / totalClosed : 0;
        return {
          competitor_name: name,
          deals_mentioned: v.deal_ids.size,
          wins: v.wins,
          losses: v.losses,
          win_rate: Math.round(winRate * 1000) / 1000,
          win_rate_without: Math.round(winRateWithout * 1000) / 1000,
          win_rate_delta: Math.round((winRate - winRateWithout) * 1000) / 1000,
          avg_cycle_days: v.cycle_days.length > 0 ? Math.round(v.cycle_days.reduce((s, d) => s + d, 0) / v.cycle_days.length) : null,
          recent_deals: v.recent_deals,
        };
      })
      .sort((a, b) => b.deals_mentioned - a.deals_mentioned);

    const allDealsWithComp = await query<{ cnt: string }>(
      `SELECT COUNT(DISTINCT cv.deal_id)::text as cnt
       FROM conversations cv
       WHERE cv.workspace_id = $1
         AND cv.call_date >= NOW() - ($2 || ' months')::interval
         AND jsonb_array_length(COALESCE(cv.competitor_mentions,'[]'::jsonb)) > 0`,
      [workspaceId, String(lookbackMonths)]
    ).catch(() => ({ rows: [{ cnt: '0' }] as any[] }));

    const allDeals = await query<{ cnt: string; wins: string }>(
      `SELECT COUNT(*)::text as cnt,
              COUNT(*) FILTER (WHERE stage_normalized = 'closed_won')::text as wins
       FROM deals WHERE workspace_id = $1
         AND created_at >= NOW() - ($2 || ' months')::interval`,
      [workspaceId, String(lookbackMonths)]
    ).catch(() => ({ rows: [{ cnt: '0', wins: '0' }] as any[] }));

    const totalDeals = parseInt(allDeals.rows[0]?.cnt || '0');
    const totalDealsWithComp = parseInt(allDealsWithComp.rows[0]?.cnt || '0');
    const compWins = competitors.reduce((s, c) => s + c.wins, 0);
    const compLosses = competitors.reduce((s, c) => s + c.losses, 0);
    const winRateComp = (compWins + compLosses) > 0 ? compWins / (compWins + compLosses) : 0;

    const dataSource = compRows.rows.length > 0 ? 'conversation_mentions'
      : insightRows.rows.length > 0 ? 'deal_insights'
      : customRows.rows.length > 0 ? 'custom_fields' : 'none';

    return {
      competitors,
      overall: {
        deals_with_any_competitor: totalDealsWithComp,
        deals_without_competitor: totalDeals - totalDealsWithComp,
        win_rate_competitive: Math.round(winRateComp * 1000) / 1000,
        win_rate_non_competitive: Math.round(winRateWithout * 1000) / 1000,
      },
      data_source: dataSource,
      query_description: `Competitive win rates (${lookbackMonths} months): ${competitors.length} competitors detected across ${totalDealsWithComp} deals. Win rate with competitor: ${Math.round(winRateComp * 100)}% vs ${Math.round(winRateWithout * 100)}% without. Data from: ${dataSource}`,
      ...(dataSource === 'none' ? { note: 'No competitor data found. Connect Gong/Fireflies to enable conversation-based competitor detection, or add a "competitor" field to deals in your CRM.' } : {}),
    };
  } catch (err: any) {
    console.error('[compute_competitive_rates] error:', err?.message);
    return { competitors: [], overall: { deals_with_any_competitor: 0, deals_without_competitor: 0, win_rate_competitive: 0, win_rate_non_competitive: 0 }, query_description: `compute_competitive_rates failed: ${err?.message}`, error: err?.message };
  }
}

// ─── Tool 18: compute_activity_trend ─────────────────────────────────────────

export async function computeActivityTrend(workspaceId: string, params: Record<string, any>): Promise<any> {
  try {
    const dealId: string = params.deal_id;
    if (!dealId) return { error: 'deal_id is required' };
    const lookbackDays: number = params.lookback_days ?? 30;

    // Build 4 complete ISO week buckets going backwards from today
    const now = new Date();
    // Monday of current week
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() + mondayOffset);
    thisMonday.setHours(0, 0, 0, 0);

    const weeks: { label: string; from: Date; to: Date }[] = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(thisMonday);
      weekStart.setDate(thisMonday.getDate() - i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const isoWeek = weekStart.toISOString().split('T')[0];
      weeks.push({ label: isoWeek, from: weekStart, to: weekEnd });
    }

    const windowStart = new Date(now);
    windowStart.setDate(now.getDate() - lookbackDays);

    const actResult = await query<any>(
      `SELECT timestamp, activity_type
       FROM activities
       WHERE workspace_id = $1
         AND deal_id = $2
         AND timestamp >= $3
       ORDER BY timestamp DESC`,
      [workspaceId, dealId, windowStart.toISOString()]
    ).catch(() => ({ rows: [] as any[] }));

    const rows = actResult.rows;

    // Count per week
    const weekly_counts = weeks.map(w => ({
      week: w.label,
      count: rows.filter(r => {
        const t = new Date(r.timestamp);
        return t >= w.from && t < w.to;
      }).length,
    }));

    // Linear regression: x = week index 0..3, y = count
    const n = weekly_counts.length;
    const xs = weekly_counts.map((_, i) => i);
    const ys = weekly_counts.map(w => w.count);
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
    const sumX2 = xs.reduce((a, x) => a + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;

    let trend: 'increasing' | 'flat' | 'declining';
    const nonZeroWeeks = weekly_counts.filter(w => w.count > 0).length;
    if (nonZeroWeeks <= 1) {
      trend = rows.length === 0 ? 'declining' : 'flat';
    } else if (slope > 0.3) {
      trend = 'increasing';
    } else if (slope < -0.3) {
      trend = 'declining';
    } else {
      trend = 'flat';
    }

    const totalActivities = rows.length;
    const lastActivityDate = rows.length > 0 ? new Date(rows[0].timestamp).toISOString().split('T')[0] : null;
    const daysSinceLast = lastActivityDate
      ? Math.floor((now.getTime() - new Date(lastActivityDate).getTime()) / 86400000)
      : null;

    return {
      deal_id: dealId,
      lookback_days: lookbackDays,
      trend,
      slope: Math.round(slope * 100) / 100,
      weekly_counts,
      total_activities: totalActivities,
      last_activity_date: lastActivityDate,
      days_since_last_activity: daysSinceLast,
      query_description: `Activity trend for deal ${dealId} over ${lookbackDays} days: ${totalActivities} activities, trend=${trend} (slope=${Math.round(slope * 100) / 100})`,
    };
  } catch (err: any) {
    console.error('[compute_activity_trend] error:', err?.message);
    return { error: err?.message, deal_id: params.deal_id, trend: 'flat', slope: 0, weekly_counts: [], total_activities: 0, last_activity_date: null, days_since_last_activity: null };
  }
}

// ─── Tool 19: compute_shrink_rate ────────────────────────────────────────────

export async function computeShrinkRate(workspaceId: string, params: Record<string, any>): Promise<any> {
  try {
    const lookbackQuarters: number = params.lookback_quarters ?? 4;
    const segmentBy: string | null = params.segment_by ?? null;
    const since = new Date();
    since.setMonth(since.getMonth() - lookbackQuarters * 3);

    // Check if field_change_log exists
    const tableExists = await query<any>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'field_change_log'
       ) AS exists`,
      []
    ).catch(() => ({ rows: [{ exists: false }] }));

    if (!tableExists.rows[0]?.exists) {
      return {
        avg_shrink_pct: 10,
        median_shrink_pct: 10,
        pct_deals_shrunk: null,
        pct_deals_grew: null,
        n_deals: 0,
        confidence: 'low',
        by_segment: null,
        note: 'Insufficient history — using 10% estimate (field_change_log not yet populated)',
      };
    }

    // Find closed-won deals with amount history
    const dealHistory = await query<any>(
      `SELECT d.id as deal_id,
              d.amount::numeric as final_amount,
              d.owner,
              d.amount::numeric as amount,
              fcl.first_amount
       FROM deals d
       JOIN (
         SELECT deal_id,
                first_value(new_value::numeric) OVER (PARTITION BY deal_id ORDER BY changed_at ASC) AS first_amount
         FROM field_change_log
         WHERE workspace_id = $1
           AND field_name = 'amount'
           AND new_value IS NOT NULL
           AND new_value ~ '^[0-9]+(\.[0-9]+)?$'
       ) fcl ON fcl.deal_id = d.id
       WHERE d.workspace_id = $1
         AND d.stage_normalized = 'closed_won'
         AND d.close_date >= $2
         AND d.amount IS NOT NULL AND d.amount > 0
       GROUP BY d.id, d.amount, d.owner, fcl.first_amount`,
      [workspaceId, since.toISOString()]
    ).catch(() => ({ rows: [] as any[] }));

    const rows = dealHistory.rows;

    if (rows.length === 0) {
      return {
        avg_shrink_pct: 10,
        median_shrink_pct: 10,
        pct_deals_shrunk: null,
        pct_deals_grew: null,
        n_deals: 0,
        confidence: 'low',
        by_segment: null,
        note: 'Insufficient history — using 10% estimate (no closed-won deals with amount change history found)',
      };
    }

    const shrinkPcts = rows.map((r: any) => {
      const first = parseFloat(r.first_amount);
      const final = parseFloat(r.final_amount);
      return first > 0 ? ((first - final) / first) * 100 : 0;
    });

    shrinkPcts.sort((a, b) => a - b);
    const avg = shrinkPcts.reduce((s, v) => s + v, 0) / shrinkPcts.length;
    const mid = Math.floor(shrinkPcts.length / 2);
    const median = shrinkPcts.length % 2 === 0
      ? (shrinkPcts[mid - 1] + shrinkPcts[mid]) / 2
      : shrinkPcts[mid];
    const shrunk = shrinkPcts.filter(v => v > 0).length;
    const grew = shrinkPcts.filter(v => v < 0).length;
    const n = shrinkPcts.length;
    const confidence: 'high' | 'medium' | 'low' = n >= 20 ? 'high' : n >= 5 ? 'medium' : 'low';

    let by_segment: any[] | null = null;
    if (segmentBy === 'rep') {
      const repMap = new Map<string, number[]>();
      rows.forEach((r: any, i: number) => {
        const rep = r.owner || 'unknown';
        if (!repMap.has(rep)) repMap.set(rep, []);
        repMap.get(rep)!.push(shrinkPcts[i]);
      });
      by_segment = Array.from(repMap.entries()).map(([rep, vals]) => ({
        segment: rep,
        shrink_pct: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10,
        n: vals.length,
      }));
    } else if (segmentBy === 'deal_size') {
      const bands = [
        { label: 'small', min: 0, max: 25000 },
        { label: 'mid', min: 25000, max: 100000 },
        { label: 'large', min: 100000, max: 500000 },
        { label: 'enterprise', min: 500000, max: Infinity },
      ];
      by_segment = bands.map(band => {
        const bandRows = rows.filter((r: any) => {
          const amt = parseFloat(r.final_amount);
          return amt >= band.min && amt < band.max;
        });
        if (!bandRows.length) return null;
        const vals = bandRows.map((r: any, idx: number) => shrinkPcts[rows.indexOf(r)]);
        return {
          segment: band.label,
          shrink_pct: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10,
          n: vals.length,
        };
      }).filter(Boolean);
    }

    return {
      avg_shrink_pct: Math.round(avg * 10) / 10,
      median_shrink_pct: Math.round(median * 10) / 10,
      pct_deals_shrunk: Math.round((shrunk / n) * 100),
      pct_deals_grew: Math.round((grew / n) * 100),
      n_deals: n,
      confidence,
      by_segment,
      note: `Based on ${n} closed-won deals with amount change history (last ${lookbackQuarters} quarters)`,
      query_description: `Shrink rate: avg=${Math.round(avg * 10) / 10}%, median=${Math.round(median * 10) / 10}%, n=${n}, confidence=${confidence}`,
    };
  } catch (err: any) {
    console.error('[compute_shrink_rate] error:', err?.message);
    return { avg_shrink_pct: 10, median_shrink_pct: 10, pct_deals_shrunk: null, pct_deals_grew: null, n_deals: 0, confidence: 'low', by_segment: null, note: 'Insufficient history — using 10% estimate', error: err?.message };
  }
}

// ─── Tool 20: infer_contact_role ─────────────────────────────────────────────

export async function inferContactRole(workspaceId: string, params: Record<string, any>): Promise<any> {
  const contactId: string = params.contact_id;
  if (!contactId) return { error: 'contact_id is required', inferred_role: 'unknown', confidence: 0 };

  try {
    // 1. Fetch contact
    const contactRes = await query<any>(
      `SELECT id, first_name, last_name, title, seniority, email
       FROM contacts
       WHERE workspace_id = $1 AND id = $2
       LIMIT 1`,
      [workspaceId, contactId]
    ).catch(() => ({ rows: [] as any[] }));

    const contact = contactRes.rows[0];
    if (!contact) return { contact_id: contactId, inferred_role: 'unknown', confidence: 0, title_signal: 'Contact not found', participation_signal: 'No data', calls_analyzed: 0 };

    // 2. Fetch conversation participation (last 180 days)
    const convRes = await query<any>(
      `SELECT cv.title, cv.summary, cv.call_date,
              d.stage as deal_stage
       FROM conversations cv
       LEFT JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = $1
       WHERE cv.workspace_id = $1
         AND cv.call_date >= NOW() - INTERVAL '180 days'
         AND (
           cv.participants::text ILIKE $2
           OR cv.external_participants::text ILIKE $2
         )
       ORDER BY cv.call_date DESC
       LIMIT 5`,
      [workspaceId, `%${contact.email || contact.first_name || ''}%`]
    ).catch(() => ({ rows: [] as any[] }));

    const convs = convRes.rows;
    const callsAnalyzed = convs.length;
    const topics = convs.map(c => (c.title || c.summary || '').substring(0, 100)).filter(Boolean).join('; ');
    const stages = [...new Set(convs.map(c => c.deal_stage).filter(Boolean))].join(', ');

    const hasTitle = !!(contact.title && contact.title.trim());

    // 3. Build DeepSeek prompt
    const promptText = `Infer the buying role of this B2B contact.

Contact: title="${contact.title || 'unknown'}", seniority="${contact.seniority || 'unknown'}"
Appeared in ${callsAnalyzed} calls in the last 180 days.${topics ? ` Recent call topics: ${topics}.` : ''}${stages ? ` Calls during deal stages: ${stages}.` : ''}

Classify their most likely role as exactly one of:
economic_buyer | champion | technical_evaluator | coach | blocker | unknown

Respond ONLY with JSON:
{"role":"...","confidence":0.0,"title_signal":"one sentence","participation_signal":"one sentence"}`;

    // 4. Call DeepSeek via classify capability
    const llmRes = await callLLM(workspaceId, 'classify', {
      messages: [{ role: 'user', content: promptText }],
      maxTokens: 200,
      temperature: 0,
    });

    let parsed: any = null;
    try {
      const jsonMatch = llmRes.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // fall through to default
    }

    const validRoles = ['economic_buyer', 'champion', 'technical_evaluator', 'coach', 'blocker', 'unknown'];
    const rawRole = parsed?.role || 'unknown';
    const inferredRole = validRoles.includes(rawRole) ? rawRole : 'unknown';
    let confidence = typeof parsed?.confidence === 'number' ? parsed.confidence : 0.5;

    // Cap confidence if no title available
    if (!hasTitle) confidence = Math.min(confidence, 0.4);
    if (callsAnalyzed === 0) confidence = Math.min(confidence, 0.5);

    return {
      contact_id: contactId,
      inferred_role: inferredRole,
      confidence: Math.round(confidence * 100) / 100,
      title_signal: parsed?.title_signal || `Title: ${contact.title || 'not provided'}`,
      participation_signal: parsed?.participation_signal || `Participated in ${callsAnalyzed} calls`,
      calls_analyzed: callsAnalyzed,
    };
  } catch (err: any) {
    console.error('[infer_contact_role] error:', err?.message);
    return { contact_id: contactId, inferred_role: 'unknown', confidence: 0, title_signal: 'Inference failed', participation_signal: err?.message, calls_analyzed: 0, error: true };
  }
}
