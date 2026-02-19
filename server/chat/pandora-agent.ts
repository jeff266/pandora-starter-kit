/**
 * Pandora Agent — Native Tool Calling
 *
 * Single entry point for all Ask Pandora chat questions.
 * Uses Anthropic's native tool_use to let Claude decide what data it needs
 * and when it's done. No JSON planning prompts, no mode classifier, no scope
 * handlers. The model drives the loop; the loop runs until stop_reason: end_turn.
 */

import { callLLM, type ToolDef, type LLMCallOptions } from '../utils/llm-router.js';
import { executeDataTool } from './data-tools.js';
import type { ConversationMessage } from './conversation-state.js';
import { query } from '../db.js';

// ─── Tool definitions ──────────────────────────────────────────────────────────
// Using ToolDef format (parameters) — the router converts to input_schema for Anthropic.

const PANDORA_TOOLS: ToolDef[] = [
  {
    name: 'query_deals',
    description:
      'Query deal/opportunity records with flexible filters. Returns individual deal records with name, amount, stage, close_date, owner, account, days_in_stage, probability, forecast_category. Always returns total_count and total_amount across all matches. Use this when you need to see specific deals, break down pipeline numbers, or analyze deal-level data.',
    parameters: {
      type: 'object',
      properties: {
        scopeId: { type: 'string', description: 'Filter by analysis scope (e.g., "new-business", "renewals") — when set, only returns deals in that segment' },
        is_open: { type: 'boolean', description: 'true for open pipeline, false for closed deals' },
        stage: { type: 'string', description: 'Filter by stage name (partial match supported)' },
        owner_email: { type: 'string', description: 'Filter by deal owner email' },
        owner_name: { type: 'string', description: 'Filter by deal owner name (partial match)' },
        account_id: { type: 'string', description: 'Filter by account ID' },
        account_name: { type: 'string', description: 'Filter by account name (partial match)' },
        close_date_from: { type: 'string', description: 'ISO date — deals closing on or after this date' },
        close_date_to: { type: 'string', description: 'ISO date — deals closing on or before this date' },
        amount_min: { type: 'number', description: 'Minimum deal amount' },
        amount_max: { type: 'number', description: 'Maximum deal amount' },
        created_after: { type: 'string', description: 'ISO date — deals created after' },
        created_before: { type: 'string', description: 'ISO date — deals created before' },
        forecast_category: { type: 'string', description: 'Filter: commit, best_case, pipeline, omitted' },
        pipeline_name: { type: 'string', description: 'Filter by named pipeline (e.g., "Sales Pipeline", "Partnership Pipeline")' },
        has_findings: { type: 'boolean', description: 'Only deals with active AI skill findings' },
        limit: { type: 'number', description: 'Max records to return (default 50, max 200)' },
        order_by: { type: 'string', description: 'Sort by: amount, close_date, created_date, days_in_stage' },
        order_dir: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
      },
      required: [],
    },
  },
  {
    name: 'query_accounts',
    description:
      'Query account/company records. Returns name, domain, industry, employee_count, owner, open deal count, total pipeline value, last activity date. Use to look up companies, find accounts by name or domain, or get account-level views.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Partial match on account name' },
        domain: { type: 'string', description: 'Domain filter (exact or partial)' },
        industry: { type: 'string', description: 'Industry filter' },
        owner_email: { type: 'string', description: 'Account owner email' },
        has_open_deals: { type: 'boolean', description: 'Only accounts with open pipeline' },
        min_pipeline_value: { type: 'number', description: 'Minimum total open pipeline' },
        limit: { type: 'number', description: 'Max records (default 50)' },
        order_by: { type: 'string', description: 'Sort by: name, pipeline_value, deal_count, last_activity' },
      },
      required: [],
    },
  },
  {
    name: 'query_conversations',
    description:
      'Query call/meeting records from Gong or Fireflies. Returns title, date, duration, participants, account/deal linkage, summaries, and optionally transcript excerpts. For Gong calls also returns talk_ratio, longest_monologue, interactivity. Use for anything about what happened on calls — objections, competitive mentions, coaching, patterns.',
    parameters: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Conversations linked to this account' },
        account_name: { type: 'string', description: 'Partial match on linked account name' },
        deal_id: { type: 'string', description: 'Conversations linked to this deal' },
        rep_email: { type: 'string', description: 'Conversations involving this rep' },
        since: { type: 'string', description: 'ISO date — conversations after this date' },
        until: { type: 'string', description: 'ISO date — conversations before this date' },
        title_contains: { type: 'string', description: 'Search in conversation title' },
        transcript_search: { type: 'string', description: 'Full-text search in transcript content' },
        summary_search: { type: 'string', description: 'Search in AI-generated summaries' },
        is_internal: { type: 'boolean', description: 'Filter internal vs external calls (default false = external only)' },
        min_duration_minutes: { type: 'number', description: 'Minimum call length in minutes' },
        source: { type: 'string', enum: ['gong', 'fireflies'], description: 'Filter by source system' },
        include_transcript_excerpts: { type: 'boolean', description: 'Include relevant transcript segments (uses more tokens but enables content analysis)' },
        excerpt_keyword: { type: 'string', description: 'Keyword to center transcript excerpts around (use with include_transcript_excerpts)' },
        limit: { type: 'number', description: 'Max records (default 30)' },
        order_by: { type: 'string', description: 'Sort by: date, duration, account_name' },
      },
      required: [],
    },
  },
  {
    name: 'get_skill_evidence',
    description:
      'Retrieve the most recent output from a Pandora AI skill. Skills run on schedules and produce findings (claims with severity) plus evaluated records (the data they analyzed). ALWAYS check skill evidence before querying raw data for pipeline health, risk, forecasting, or rep performance — skills have richer analysis with risk flags and cross-record patterns. Available skills: pipeline-hygiene (stale deals, missing data, close date issues), single-thread-alert (deals with only 1 contact engaged), data-quality-audit (CRM data completeness), pipeline-coverage-by-rep (rep-level pipeline vs quota), weekly-forecast-rollup (forecast by category with changes), pipeline-waterfall (pipeline movement: created, advanced, slipped, lost), rep-scorecard (rep performance metrics), stage-velocity-benchmarks (deals exceeding time-in-stage thresholds, stalled/grinding/stuck patterns), conversation-intelligence (weekly call themes: top objections, competitive mentions, buying signals, coaching opportunities).',
    parameters: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          enum: ['pipeline-hygiene', 'single-thread-alert', 'data-quality-audit', 'pipeline-coverage-by-rep', 'weekly-forecast-rollup', 'pipeline-waterfall', 'rep-scorecard', 'stage-velocity-benchmarks', 'conversation-intelligence', 'forecast-model', 'pipeline-gen-forecast', 'competitive-intelligence', 'contact-role-resolution'],
          description: 'The skill to pull evidence from',
        },
        max_age_hours: { type: 'number', description: 'Only return if run within this many hours (default 24)' },
        filter_severity: { type: 'string', enum: ['critical', 'warning', 'info'], description: 'Only return findings of this severity' },
        filter_entity_id: { type: 'string', description: 'Only return findings about this specific deal/account/rep' },
      },
      required: ['skill_id'],
    },
  },
  {
    name: 'compute_metric',
    description:
      'Calculate a specific business metric with FULL show-your-work breakdown. Returns the value, the exact formula, every input, every record included, and every record excluded with reasons. Use when the user asks about a metric, wants to verify a number, or when you need to confirm your own math. ALWAYS use this instead of manual calculation.',
    parameters: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['total_pipeline', 'weighted_pipeline', 'win_rate', 'avg_deal_size', 'avg_sales_cycle', 'coverage_ratio', 'pipeline_created', 'pipeline_closed'],
          description: 'The metric to calculate',
        },
        scopeId: { type: 'string', description: 'Filter by analysis scope (e.g., "new-business", "renewals") — when set, only calculates from deals in that segment' },
        owner_email: { type: 'string', description: 'Scope to one rep' },
        date_from: { type: 'string', description: 'Start of period (ISO date)' },
        date_to: { type: 'string', description: 'End of period (ISO date)' },
        stage: { type: 'string', description: 'Scope to one stage' },
        pipeline_name: { type: 'string', description: 'Scope to one named pipeline' },
        quota_amount: { type: 'number', description: 'Explicit quota for coverage_ratio (if not set, pulls from workspace config)' },
        lookback_days: { type: 'number', description: 'For win_rate — number of days to look back (default 90)' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'query_contacts',
    description:
      'Query contact records associated with accounts and deals. Returns name, email, title, account, role (champion/economic_buyer/etc), last activity, conversation count. Use for stakeholder mapping, multi-threading analysis, or finding decision-makers.',
    parameters: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Contacts at this account' },
        deal_id: { type: 'string', description: 'Contacts associated with this deal' },
        name: { type: 'string', description: 'Partial match on contact name' },
        email: { type: 'string', description: 'Exact or partial email match' },
        title_contains: { type: 'string', description: 'Job title search' },
        role: { type: 'string', description: 'Filter by role: champion, economic_buyer, technical_evaluator, coach, blocker' },
        has_conversation: { type: 'boolean', description: 'Only contacts who appeared on calls' },
        limit: { type: 'number', description: 'Max records (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'query_activity_timeline',
    description:
      'Get a chronological timeline of activity for a deal or account. Includes stage changes, calls, emails, tasks, notes, meetings with dates and actors. Use to understand the STORY of what happened — when stages changed, when calls occurred, gaps in activity. Essential for investigating deal velocity and engagement patterns.',
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Timeline for this deal' },
        account_id: { type: 'string', description: 'Timeline across all deals at this account' },
        since: { type: 'string', description: 'ISO date — events after this date' },
        until: { type: 'string', description: 'ISO date — events before this date' },
        activity_types: {
          type: 'array',
          items: { type: 'string', enum: ['stage_change', 'call', 'email', 'task', 'note', 'meeting'] },
          description: 'Filter by activity type',
        },
        limit: { type: 'number', description: 'Max events (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'query_stage_history',
    description:
      'Get stage transition history for a deal or across the workspace. Returns each stage change with from/to stages, timestamps, days spent in previous stage, and direction (advance/regress/lateral/initial). Essential for understanding deal velocity, detecting stalled deals, and finding regression patterns.',
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Stage history for a specific deal' },
        account_id: { type: 'string', description: 'Stage history across all deals at this account' },
        since: { type: 'string', description: 'ISO date — transitions after this date' },
        until: { type: 'string', description: 'ISO date — transitions before this date' },
        direction: { type: 'string', enum: ['advance', 'regress', 'all'], description: 'Filter by transition direction. "regress" finds deals that moved backward.' },
        limit: { type: 'number', description: 'Max transitions to return (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'compute_stage_benchmarks',
    description:
      'Calculate historical time-in-stage benchmarks: median, p75, p90 days per stage, plus conversion rates and drop rates. Use to determine if a deal is fast or slow compared to historical patterns. Can segment by pipeline, deal size band, or individual rep.',
    parameters: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'Specific stage to benchmark, or omit for all stages' },
        pipeline: { type: 'string', description: 'Filter by pipeline name' },
        deal_size_band: { type: 'string', enum: ['small', 'mid', 'large', 'enterprise'], description: 'Segment by deal size' },
        owner_email: { type: 'string', description: 'Benchmarks for a specific rep (compare to team)' },
        lookback_months: { type: 'number', description: 'How many months of history (default 12)' },
        only_closed_won: { type: 'boolean', description: 'Only include deals that eventually closed-won (default false)' },
      },
      required: [],
    },
  },
  {
    name: 'query_field_history',
    description:
      "Get the change history for a deal's key fields: stage transitions, close date pushes, amount changes. Returns each change with old/new values and timestamps, plus a summary with stage regression count. Essential for assessing deal reliability and detecting deals that keep slipping.",
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'The deal to get history for (required)' },
        field_name: { type: 'string', enum: ['close_date', 'amount', 'stage', 'forecast_category', 'all'], description: 'Which field to track (default: all)' },
        since: { type: 'string', description: 'ISO date — only changes after this date' },
      },
      required: ['deal_id'],
    },
  },
  {
    name: 'compute_metric_segmented',
    description:
      "Calculate a metric broken down by segment. Example: win rate by rep, avg deal size by pipeline, sales cycle by deal size band. Returns each segment's value, sample size, and comparison to team average. Use when you need to compare performance across groups.",
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['win_rate', 'avg_deal_size', 'avg_sales_cycle', 'total_pipeline', 'pipeline_created'], description: 'The metric to calculate' },
        segment_by: { type: 'string', enum: ['owner', 'stage', 'pipeline', 'deal_size_band', 'source', 'forecast_category'], description: 'How to segment the results' },
        date_from: { type: 'string', description: 'Start of period (ISO date)' },
        date_to: { type: 'string', description: 'End of period (ISO date)' },
        lookback_days: { type: 'number', description: 'Alternative to date_from/to — look back N days' },
      },
      required: ['metric', 'segment_by'],
    },
  },
  {
    name: 'search_transcripts',
    description:
      "Full-text search across call and meeting transcripts. Returns matching excerpts with surrounding context, speaker attribution, and conversation metadata. Use for finding specific topics discussed (objections, competitors, pricing, technical requirements), patterns across calls, or investigating what happened on a specific deal's calls.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms — can be a word, phrase, or topic' },
        deal_id: { type: 'string', description: 'Only search conversations linked to this deal' },
        account_id: { type: 'string', description: 'Only search conversations linked to this account' },
        rep_email: { type: 'string', description: 'Only search conversations involving this rep' },
        since: { type: 'string', description: 'ISO date — conversations after this date' },
        until: { type: 'string', description: 'ISO date — conversations before this date' },
        max_results: { type: 'number', description: 'Max excerpts to return (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'compute_forecast_accuracy',
    description:
      'Calculate historical forecast accuracy per rep: what percentage of their committed pipeline actually closed? Identifies sandbagging (consistently under-commits) and over-committing patterns. Returns a haircut factor to adjust current forecast. Uses forecast snapshots if available, otherwise approximates from pipeline vs actuals.',
    parameters: {
      type: 'object',
      properties: {
        owner_email: { type: 'string', description: 'Specific rep, or omit for all reps' },
        lookback_quarters: { type: 'number', description: 'How many quarters to analyze (default 4)' },
      },
      required: [],
    },
  },
  {
    name: 'compute_close_probability',
    description:
      'Score each open deal on close probability (0-95) using 4 dimensions: Engagement (30% — contacts, champion/EB presence, call recency), Velocity (30% — days in stage vs benchmarks, close date proximity, regressions), Qualification (20% — stage advancement, amount vs median, forecast category), Execution (20% — rep win rate vs team avg). Returns scored_deals[] sorted by probability, probability_weighted_pipeline, and factor lists (positive signals, risk signals, data gaps) per deal. Use before presenting any forecast or pipeline summary to get probability-adjusted totals.',
    parameters: {
      type: 'object',
      properties: {
        owner_name: { type: 'string', description: 'Score only deals owned by this rep (partial name match)' },
        deal_ids: { type: 'array', items: { type: 'string' }, description: 'Score specific deals by ID' },
        limit: { type: 'number', description: 'Max deals to score (default 50, max 100)' },
      },
      required: [],
    },
  },
  {
    name: 'compute_pipeline_creation',
    description: 'Calculate historical pipeline creation rate: how many deals and how much pipeline value is created per month/quarter/week. Shows trends over time and can segment by source, owner, pipeline, or deal size. Essential for predicting how much new pipeline will be generated in the current period.',
    parameters: {
      type: 'object',
      properties: {
        group_by: { type: 'string', enum: ['month', 'quarter', 'week'], description: 'Time grouping (default: month)' },
        lookback_months: { type: 'number', description: 'How many months of history (default 12)' },
        segment_by: { type: 'string', enum: ['source', 'owner', 'pipeline', 'deal_size_band'], description: 'Optional segmentation' },
        include_current_period: { type: 'boolean', description: 'Include the current incomplete period (default true)' },
        pipeline_filter: { type: 'string', description: 'Filter to a specific pipeline by name (e.g. "Core Sales"). Use when user asks about a specific pipeline.' },
      },
      required: [],
    },
  },
  {
    name: 'compute_inqtr_close_rate',
    description: 'Calculate the rate at which pipeline created within a quarter closes in that same quarter. Answers: "If we create $500K of pipeline this month, how much of it will close before quarter end?" Includes projection for current quarter based on historical patterns.',
    parameters: {
      type: 'object',
      properties: {
        lookback_quarters: { type: 'number', description: 'How many quarters to analyze (default 4)' },
        segment_by: { type: 'string', enum: ['source', 'owner', 'pipeline', 'deal_size_band'], description: 'Optional segmentation' },
      },
      required: [],
    },
  },
  {
    name: 'compute_competitive_rates',
    description: 'Calculate win/loss rates when specific competitors are present vs absent. Shows which competitors hurt your win rate most, where they appear in the funnel, and recent deal outcomes. Sources competitor data from call recordings, deal insights, and CRM custom fields.',
    parameters: {
      type: 'object',
      properties: {
        competitor: { type: 'string', description: 'Specific competitor name, or omit for all detected competitors' },
        lookback_months: { type: 'number', description: 'How many months to analyze (default 12)' },
      },
      required: [],
    },
  },
  {
    name: 'compute_activity_trend',
    description: '30-day engagement trajectory for a deal. Returns weekly activity counts, linear regression slope, and trend classification (increasing/flat/declining). Use to answer: "Is this deal going dark?" or "Is engagement heating up?"',
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal to analyze' },
        lookback_days: { type: 'number', description: 'Days to look back (default 30)' },
      },
      required: ['deal_id'],
    },
  },
  {
    name: 'compute_shrink_rate',
    description: 'Calculates how much deal amounts shrink from initial value to closed-won amount. Returns avg_shrink_pct, median, confidence level, and optional segmentation by rep or deal size.',
    parameters: {
      type: 'object',
      properties: {
        lookback_quarters: { type: 'number', description: 'Quarters of history to analyze (default 4)' },
        segment_by: { type: 'string', enum: ['deal_size', 'rep'], description: 'Optional segmentation axis' },
      },
      required: [],
    },
  },
  {
    name: 'infer_contact_role',
    description: "Infers a contact's buying role (economic_buyer, champion, technical_evaluator, coach, blocker, unknown) using their job title and call participation history. Returns confidence score and signals.",
    parameters: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'UUID of the contact to classify' },
      },
      required: ['contact_id'],
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

const PANDORA_SYSTEM_PROMPT = `You are Pandora, a Revenue Operations analyst. You work for this company's revenue team. You have direct access to their CRM data, conversation recordings, and AI-generated pipeline analysis.

## How You Work

You have tools that query the company's live data. When someone asks a question, you pull the actual data, verify the numbers, and give a specific answer with evidence.

## Rules

1. NEVER GUESS. Every number you cite must come from a tool call. If you're unsure, call a tool.

2. NEVER SAY "I WOULD NEED." If a tool exists that could get the data, call it. You have 7 tools covering deals, accounts, conversations, contacts, activity timelines, skill evidence, and metric calculations. Use them.

3. SHOW YOUR WORK. When citing totals or metrics, list the underlying records. "19 deals totaling $303K" is better than "$303K." Name the top deals.

4. CHECK SKILL EVIDENCE FIRST. Before querying raw data for pipeline health, risk, forecasting, or rep performance questions, check get_skill_evidence. Skills have already analyzed the data with richer context than a raw query provides.
   Available skills: pipeline-hygiene, single-thread-alert, data-quality-audit, pipeline-coverage-by-rep, weekly-forecast-rollup, pipeline-waterfall, rep-scorecard, stage-velocity-benchmarks, conversation-intelligence, forecast-model, pipeline-gen-forecast, competitive-intelligence, contact-role-resolution.

5. CROSS-REFERENCE. When a question spans entities (deals + calls, reps + accounts), query both sides. Don't answer with half the picture.

6. BE DIRECT. Lead with the answer. Put context and caveats after the main point, not before.

7. WHEN LISTING DEALS: always include name, amount, stage, close date, and owner.
   WHEN LISTING CONVERSATIONS: always include title, date, account, rep, and duration.
   WHEN CITING METRICS: always include the formula and record count.

8. PRIOR TOOL RESULTS IN CONTEXT ARE FROM PREVIOUS QUESTIONS — NOT YOUR CURRENT DATA. Each new question starts fresh. All 17 tools are always available. Never say "I don't have access to X in the data provided" or "the data shows only Y" — that refers to a past question. Call a tool.

9. FORECASTS AND QUARTERLY NUMBERS: For any question about Q1/Q2/Q3/Q4 forecast, quarterly pipeline, quarterly revenue, or forecast categories (commit/best case):
   - ALWAYS call get_skill_evidence with skill_id="weekly-forecast-rollup" first.
   - THEN call query_deals with close_date_from and close_date_to set to the quarter's date range.
   - Q1 = Jan 1 – Mar 31. Q2 = Apr 1 – Jun 30. Q3 = Jul 1 – Sep 30. Q4 = Oct 1 – Dec 31.
   - Use the current year unless the user specifies otherwise.
   - Never say "I don't have Q1 data" — you have deal close dates and the forecast rollup skill.

10. VELOCITY QUESTIONS: Check get_skill_evidence('stage-velocity-benchmarks') first. If stale or unavailable, call compute_stage_benchmarks directly. Always compare a specific deal's time-in-stage to the benchmark — never say a deal is "slow" without the data to prove it.

11. DEAL INVESTIGATION: When investigating why a deal is at risk, call MULTIPLE tools: query_field_history (stage regressions), query_stage_history (full stage log), query_conversations (recent call activity), query_contacts (stakeholder coverage). Build the full picture before diagnosing.

12. FORECAST QUESTIONS REQUIRE PROBABILITY WEIGHTING: For any forecast question, call compute_close_probability to score deals, then reference get_skill_evidence('forecast-model') for the full probability-weighted forecast with rep haircuts and in-quarter creation projections. Never present unweighted pipeline totals as a "forecast." Raw pipeline ≠ forecast.

13. COMPETITIVE QUESTIONS: Check get_skill_evidence('competitive-intelligence') first. For specific competitor deep-dives, also use search_transcripts and compute_competitive_rates to find recent mentions and win/loss patterns.

Today's date is ${new Date().toISOString().split('T')[0]}.`;

// ─── Response types ───────────────────────────────────────────────────────────

export interface PandoraToolCall {
  tool: string;
  params: Record<string, any>;
  result: any;
  description: string;
}

export interface PandoraCitedRecord {
  type: 'deal' | 'account' | 'conversation' | 'contact';
  id: string;
  name: string;
  key_fields: Record<string, any>;
}

export interface PandoraResponse {
  answer: string;
  evidence: {
    tool_calls: PandoraToolCall[];
    cited_records: PandoraCitedRecord[];
  };
  tokens_used: number;
  tool_call_count: number;
  latency_ms: number;
}

// ─── Pre-flight question classifier ───────────────────────────────────────────

interface QuestionClassification {
  question_type: 'discrete' | 'analytical' | 'strategic';
  tools_likely_needed: string[];
  estimated_complexity: 'low' | 'medium' | 'high';
  token_budget: number;
}

const CLASSIFIER_PROMPT = `You are a question classifier for a Revenue Operations data platform. Given a user question, classify it and return a JSON object.

Rules:
- "discrete": simple lookups, single metric, one entity (e.g. "what's the Q1 forecast?", "show me deal X")
- "analytical": multi-step analysis within one domain (e.g. "which reps have the best win rate?", "why is deal X stuck?")
- "strategic": cross-domain, open-ended, advisory (e.g. "create a messaging framework", "what should we focus on this quarter?", "build an ABM playbook")

Available tools: query_deals, query_accounts, query_conversations, get_skill_evidence, compute_metric, query_contacts, query_activity_timeline, query_stage_history, compute_stage_benchmarks, query_field_history, compute_metric_segmented, search_transcripts, compute_forecast_accuracy, compute_close_probability, compute_pipeline_creation, compute_inqtr_close_rate, compute_competitive_rates, compute_activity_trend, compute_shrink_rate, infer_contact_role

Return ONLY valid JSON, no markdown:
{"question_type":"discrete|analytical|strategic","tools_likely_needed":["tool1","tool2"],"estimated_complexity":"low|medium|high"}`;

async function classifyQuestion(workspaceId: string, question: string): Promise<QuestionClassification> {
  const COMPLEXITY_TO_BUDGET: Record<string, number> = { low: 2048, medium: 4096, high: 8192 };

  try {
    const response = await callLLM(workspaceId, 'classify', {
      systemPrompt: CLASSIFIER_PROMPT,
      messages: [{ role: 'user', content: question }],
      maxTokens: 256,
      temperature: 0,
      _tracking: { workspaceId, phase: 'chat', stepName: 'question-classifier' },
    });

    const text = (response.content || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const complexity = parsed.estimated_complexity || 'medium';
      return {
        question_type: parsed.question_type || 'analytical',
        tools_likely_needed: Array.isArray(parsed.tools_likely_needed) ? parsed.tools_likely_needed : [],
        estimated_complexity: complexity,
        token_budget: COMPLEXITY_TO_BUDGET[complexity] || 4096,
      };
    }
  } catch (err) {
    console.log(`[PandoraAgent] Classifier failed, defaulting to medium:`, err);
  }

  return { question_type: 'analytical', tools_likely_needed: [], estimated_complexity: 'medium', token_budget: 4096 };
}

// ─── Main agent loop ──────────────────────────────────────────────────────────

export async function runPandoraAgent(
  workspaceId: string,
  message: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: any }>,
  scopeId?: string
): Promise<PandoraResponse> {
  const startTime = Date.now();
  const toolTrace: PandoraToolCall[] = [];
  let totalTokens = 0;
  const MAX_ITERATIONS = 8;

  // Look up scope name if scopeId is provided (for response labeling)
  let scopeName: string | null = null;
  if (scopeId && scopeId !== 'default') {
    try {
      const scopeResult = await query<{ name: string }>(
        `SELECT name FROM analysis_scopes WHERE workspace_id = $1 AND scope_id = $2`,
        [workspaceId, scopeId]
      );
      if (scopeResult.rows.length > 0) {
        scopeName = scopeResult.rows[0].name;
      }
    } catch (err) {
      console.error('[PandoraAgent] Failed to lookup scope name:', err);
    }
  }

  const classification = await classifyQuestion(workspaceId, message);
  console.log(`[PandoraAgent] classification:`, JSON.stringify(classification));
  const dynamicMaxTokens = classification.token_budget;

  const toolHint = classification.tools_likely_needed.length > 0
    ? `\n\n[Routing hint: This question likely needs these tools first: ${classification.tools_likely_needed.join(', ')}. Start by calling them.]`
    : '';

  const messages: LLMCallOptions['messages'] = [
    ...conversationHistory.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: message + toolHint },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[PandoraAgent] iter=${i} calling LLM with ${PANDORA_TOOLS.length} tools, history=${messages.length} msgs, maxTokens=${dynamicMaxTokens}`);
    console.log(`[PandoraAgent] tools:`, PANDORA_TOOLS.map(t => t.name).join(', '));

    const response = await callLLM(workspaceId, 'reason', {
      systemPrompt: PANDORA_SYSTEM_PROMPT,
      messages,
      tools: PANDORA_TOOLS,
      maxTokens: dynamicMaxTokens,
      temperature: 0.2,
      _tracking: {
        workspaceId,
        phase: 'chat',
        stepName: `pandora-agent-iter-${i}`,
      },
    });

    totalTokens += (response.usage?.input || 0) + (response.usage?.output || 0);

    console.log(`[PandoraAgent] iter=${i} stopReason=${response.stopReason} toolCalls=${response.toolCalls?.length ?? 0}`);
    if (response.toolCalls?.length) {
      console.log(`[PandoraAgent] tools called:`, response.toolCalls.map((tc: any) => tc.name).join(', '));
    }

    if (response.stopReason === 'max_tokens' && !response.toolCalls?.length) {
      console.log(`[PandoraAgent] MAX_TOKENS GUARD at iter=${i} — discarding truncated output, injecting nudge`);
      let nudge = '[Your previous response was truncated because it exceeded the token limit. Do NOT try to write a long answer from memory. Instead, call the appropriate tools to gather data, then give a concise answer based on the results.';
      if (/\bQ[1-4]\b|quarter|forecast|commit|best.?case/i.test(message)) {
        nudge += ' For forecast questions: call get_skill_evidence with skill_id="weekly-forecast-rollup", then call query_deals with close_date_from and close_date_to for the relevant quarter.';
      } else if (/\bcall|meeting|conversation|objection|competi/i.test(message)) {
        nudge += ' Call search_transcripts or query_conversations to get live call data.';
      } else {
        nudge += ' Call the appropriate tools from the available set, gather data, then synthesize a focused answer.';
      }
      nudge += ']';
      messages.push({ role: 'user', content: nudge });
      continue;
    }

    if (response.stopReason === 'end_turn' || !response.toolCalls?.length) {
      if (toolTrace.length === 0 && i < 2) {
        console.log(`[PandoraAgent] GUARD FIRED at iter=${i} — no tools called, injecting nudge`);
        messages.push({
          role: 'assistant',
          content: response.content || '',
        });

        let nudge = '[You answered without calling any tools. You must query live data before responding.';
        if (/\bQ[1-4]\b|quarter|forecast|commit|best.?case/i.test(message)) {
          nudge += ' For forecast questions: call get_skill_evidence with skill_id="weekly-forecast-rollup", then call query_deals with close_date_from and close_date_to for the relevant quarter.';
        } else if (/\bdeal|pipeline|stage|close|won|lost/i.test(message)) {
          nudge += ' Call query_deals to retrieve live pipeline data.';
        } else if (/\bcall|meeting|conversation|objection|competi/i.test(message)) {
          nudge += ' Call query_conversations to get live call data.';
        } else if (/\brep|account.exec|AE|quota|attainment/i.test(message)) {
          nudge += ' Call get_skill_evidence with skill_id="rep-scorecard" or query_deals filtered by owner.';
        } else {
          nudge += ' Call the appropriate tool from the 17 available tools.';
        }
        nudge += ']';

        messages.push({ role: 'user', content: nudge });
        continue;
      }

      const answer = scopeName
        ? `Analyzing ${scopeName} pipeline —\n\n${response.content}`
        : response.content;

      return {
        answer,
        evidence: {
          tool_calls: toolTrace,
          cited_records: extractCitedRecords(toolTrace),
        },
        tokens_used: totalTokens,
        tool_call_count: toolTrace.length,
        latency_ms: Date.now() - startTime,
      };
    }

    // Model wants to call tools — execute them all
    // First, append the assistant's response (with tool_use blocks) to history
    // The router stores the raw content blocks on the response for this purpose
    const assistantContent = buildAssistantContent(response.content, response.toolCalls);
    messages.push({ role: 'assistant', content: assistantContent });

    // Execute each tool and collect results
    for (const toolCall of response.toolCalls) {
      let result: any;
      let isError = false;

      try {
        // Auto-inject scopeId into tool calls that support it (if not already set by Claude)
        const toolInput = { ...toolCall.input };
        if (scopeId && !toolInput.scopeId && ['query_deals', 'compute_metric'].includes(toolCall.name)) {
          toolInput.scopeId = scopeId;
        }

        result = await executeDataTool(workspaceId, toolCall.name, toolInput);
        toolTrace.push({
          tool: toolCall.name,
          params: toolInput,
          result,
          description: result?.query_description || result?.formatted || `${toolCall.name} call`,
        });
      } catch (err: any) {
        result = { error: err.message || String(err) };
        isError = true;
        toolTrace.push({
          tool: toolCall.name,
          params: toolCall.input,
          result,
          description: `${toolCall.name} failed: ${err.message}`,
        });
      }

      messages.push({
        role: 'tool',
        content: isError ? JSON.stringify(result) : JSON.stringify(compressToolResult(toolCall.name, result)),
        toolCallId: toolCall.id,
      });
    }
  }

  // Hit max iterations — force a final synthesis with no tools
  const finalResponse = await callLLM(workspaceId, 'reason', {
    systemPrompt: PANDORA_SYSTEM_PROMPT,
    messages: [
      ...messages,
      { role: 'user', content: 'You have reached the maximum number of tool calls. Synthesize your best answer from the data gathered so far.' },
    ],
    maxTokens: 8192,
    temperature: 0.2,
    _tracking: {
      workspaceId,
      phase: 'chat',
      stepName: 'pandora-agent-final-synthesis',
    },
  });

  totalTokens += (finalResponse.usage?.input || 0) + (finalResponse.usage?.output || 0);

  const finalAnswer = scopeName
    ? `Analyzing ${scopeName} pipeline —\n\n${finalResponse.content}`
    : finalResponse.content;

  return {
    answer: finalAnswer,
    evidence: {
      tool_calls: toolTrace,
      cited_records: extractCitedRecords(toolTrace),
    },
    tokens_used: totalTokens,
    tool_call_count: toolTrace.length,
    latency_ms: Date.now() - startTime,
  };
}

// ─── Tool result compressor ───────────────────────────────────────────────────

function compressToolResult(toolName: string, result: any): any {
  if (!result || typeof result !== 'object') return result;

  switch (toolName) {
    case 'search_transcripts': {
      const compressed: any = {
        total_matches: result.total_matches,
        total_results_available: result.total_results_available,
        query_description: result.query_description,
      };
      if (Array.isArray(result.excerpts)) {
        compressed.excerpts = result.excerpts.map((e: any) => ({
          conversation_title: e.conversation_title,
          conversation_date: e.conversation_date,
          speaker: e.speaker,
          excerpt: typeof e.excerpt === 'string' ? e.excerpt.slice(0, 150) : e.excerpt,
        }));
      }
      return compressed;
    }

    case 'query_conversations': {
      const compressed: any = {
        total_count: result.total_count,
        query_description: result.query_description,
      };
      if (Array.isArray(result.conversations)) {
        compressed.conversations = result.conversations.map((c: any) => ({
          id: c.id,
          title: c.title,
          date: c.date || c.call_date,
          participants: c.participants,
        }));
      }
      return compressed;
    }

    case 'query_deals': {
      const compressed: any = {
        total_count: result.total_count,
        total_amount: result.total_amount,
        query_description: result.query_description,
      };
      if (Array.isArray(result.deals)) {
        compressed.deals = result.deals.map((d: any) => ({
          id: d.id,
          name: d.name,
          amount: d.amount,
          stage: d.stage,
          close_date: d.close_date,
          owner_name: d.owner_name,
          account_name: d.account_name,
          forecast_category: d.forecast_category,
        }));
      }
      return compressed;
    }

    case 'query_accounts': {
      const compressed: any = {
        total_count: result.total_count,
        query_description: result.query_description,
      };
      if (Array.isArray(result.accounts)) {
        compressed.accounts = result.accounts.map((a: any) => ({
          id: a.id,
          name: a.name,
          total_pipeline: a.total_pipeline,
          open_deal_count: a.open_deal_count,
          industry: a.industry,
        }));
      }
      return compressed;
    }

    case 'get_skill_evidence':
      return result;

    default: {
      const serialized = JSON.stringify(result);
      if (serialized.length > 2000) {
        return { _truncated: true, _original_size: serialized.length, preview: serialized.slice(0, 1500) };
      }
      return result;
    }
  }
}

// ─── Build assistant content array with tool_use blocks ───────────────────────

function buildAssistantContent(textContent: string, toolCalls: { id: string; name: string; input: Record<string, any> }[]): any[] {
  const blocks: any[] = [];
  if (textContent) {
    blocks.push({ type: 'text', text: textContent });
  }
  for (const tc of toolCalls) {
    blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
  }
  return blocks;
}

// ─── Extract cited records from tool results ──────────────────────────────────

function extractCitedRecords(toolTrace: PandoraToolCall[]): PandoraCitedRecord[] {
  const records: PandoraCitedRecord[] = [];
  const seen = new Set<string>();

  for (const call of toolTrace) {
    const result = call.result;
    if (!result) continue;

    if (Array.isArray(result.deals)) {
      for (const d of result.deals) {
        if (d.id && !seen.has(d.id)) {
          seen.add(d.id);
          records.push({
            type: 'deal', id: d.id, name: d.name,
            key_fields: { amount: d.amount, stage: d.stage, close_date: d.close_date, owner_name: d.owner_name, account_name: d.account_name },
          });
        }
      }
    }

    if (Array.isArray(result.accounts)) {
      for (const a of result.accounts) {
        if (a.id && !seen.has(a.id)) {
          seen.add(a.id);
          records.push({
            type: 'account', id: a.id, name: a.name,
            key_fields: { domain: a.domain, open_deal_count: a.open_deal_count, total_pipeline: a.total_pipeline },
          });
        }
      }
    }

    if (Array.isArray(result.conversations)) {
      for (const c of result.conversations) {
        if (c.id && !seen.has(c.id)) {
          seen.add(c.id);
          records.push({
            type: 'conversation', id: c.id, name: c.title,
            key_fields: { date: c.date, account_name: c.account_name, rep_name: c.rep_name, duration_minutes: c.duration_minutes },
          });
        }
      }
    }

    if (Array.isArray(result.contacts)) {
      for (const ct of result.contacts) {
        if (ct.id && !seen.has(ct.id)) {
          seen.add(ct.id);
          records.push({
            type: 'contact', id: ct.id, name: ct.name,
            key_fields: { email: ct.email, title: ct.title, account_name: ct.account_name },
          });
        }
      }
    }

    // compute_metric underlying records
    if (Array.isArray(result.underlying_records)) {
      for (const r of result.underlying_records) {
        if (r.id && !seen.has(r.id)) {
          seen.add(r.id);
          records.push({
            type: 'deal', id: r.id, name: r.name,
            key_fields: { amount: r.amount, included_because: r.included_because },
          });
        }
      }
    }
  }

  return records;
}

// ─── Conversation history builder (for follow-ups) ────────────────────────────

/**
 * Converts stored conversation_state messages into the history format
 * runPandoraAgent() expects. Prior tool calls are summarized as text
 * so the model has context of what was already queried.
 */
export function buildConversationHistory(
  messages: (ConversationMessage & { tool_trace?: any[]; cited_records?: any[] })[]
): Array<{ role: 'user' | 'assistant'; content: any }> {
  if (!messages?.length) return [];

  const history: Array<{ role: 'user' | 'assistant'; content: any }> = [];
  // Keep last ~10 messages (5 exchanges) to manage context
  const recent = messages.slice(-10);

  for (const msg of recent) {
    if (msg.role === 'user') {
      history.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      // Pass the answer text and which tools were called, but NOT the result data.
      // Injecting full prior tool results causes the model to anchor on
      // "data I retrieved before" and refuse to call tools for a new question
      // (e.g. seeing 50 calls from an objections question, then saying
      // "I don't have pipeline data" when asked about Q1 forecast).
      if (msg.tool_trace && msg.tool_trace.length > 0) {
        const toolsNote = `[Tools used for this answer: ${
          msg.tool_trace.map((t: any) => t.tool).join(', ')
        }]`;
        const content = (msg.content ? msg.content + '\n\n' : '') + toolsNote;
        history.push({ role: 'assistant', content });
      } else {
        history.push({ role: 'assistant', content: msg.content });
      }
    }
  }

  return history;
}

