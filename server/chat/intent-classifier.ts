import { callLLM } from '../utils/llm-router.js';
import { estimateTokens, TOKEN_THRESHOLDS, type TokenEstimate } from './token-estimator.js';
import { query } from '../db.js';
import type { WorkspaceContext } from './workspace-context.js';

export interface ThreadReplyIntent {
  type: 'drill_down' | 'scope_filter' | 'add_context' | 'question' | 'action' | 'unknown';
  entity_type?: 'deal' | 'account' | 'rep';
  entity_name?: string;
  filter_type?: 'rep' | 'stage' | 'pipeline' | 'segment';
  filter_value?: string;
  context_text?: string;
  deal_name?: string;
  action_type?: 'snooze' | 'dismiss' | 'reviewed';
  target?: string;
}

export interface DirectQuestionRoute {
  type: 'data_query' | 'skill_trigger' | 'comparison' | 'explanation' | 'action_request' | 'unknown';
  entities?: string[];
  metrics?: string[];
  filters?: Record<string, string>;
  skill_id?: string;
  compare_a?: string;
  compare_b?: string;
  metric?: string;
  topic?: string;
  entity_name?: string;
  action_type?: string;
  target?: string;
}

export async function classifyThreadReply(
  workspaceId: string,
  message: string,
  skillId: string
): Promise<ThreadReplyIntent> {
  try {
    const response = await callLLM(workspaceId, 'classify', {
      systemPrompt: `You classify user replies to RevOps skill reports. Respond with ONLY valid JSON.`,
      messages: [{
        role: 'user',
        content: `The reply was made in a thread under a "${skillId}" report.

Classify the intent:
1. drill_down — user wants more detail on a specific deal, account, or rep
   Extract: entity_type (deal/account/rep), entity_name
2. scope_filter — user wants the analysis re-run with a filter
   Extract: filter_type (rep/stage/pipeline/segment), filter_value
3. add_context — user is adding information/context about a deal or situation
   Extract: deal_name (if mentioned), context_text
4. question — user is asking a question about the data or findings
5. action — user wants to take an action (snooze, dismiss, mark reviewed)
   Extract: action_type, target
6. unknown — cannot determine intent

User message: "${message}"

Respond with ONLY JSON: { "type": "...", ... }`,
      }],
      maxTokens: 200,
      temperature: 0,
      _tracking: {
        workspaceId,
        phase: 'chat',
        stepName: 'classify-thread-reply',
      },
    });

    return safeParseIntent<ThreadReplyIntent>(response.content, { type: 'unknown' });
  } catch (err) {
    console.error('[intent-classifier] Thread reply classification error:', err);
    return { type: 'unknown' };
  }
}

export async function classifyDirectQuestion(
  workspaceId: string,
  question: string,
  skillIds: string[],
  repNames: string[]
): Promise<DirectQuestionRoute> {
  try {
    const response = await callLLM(workspaceId, 'classify', {
      systemPrompt: `You route natural language questions to handlers in a RevOps analytics platform. Respond with ONLY valid JSON.`,
      messages: [{
        role: 'user',
        content: `Available skills: ${skillIds.join(', ')}
Known rep names: ${repNames.join(', ')}

Classify the question:
1. data_query — asking for specific data (pipeline numbers, deal counts, rep metrics)
   Extract: entities (deals/reps/accounts), metrics (pipeline/coverage/forecast), filters (rep, stage, date range)
2. skill_trigger — asking to run a specific analysis
   Extract: skill_id (best match from available skills)
3. comparison — asking to compare two things (time periods, reps, segments)
   Extract: compare_a, compare_b, metric
4. explanation — asking why something is the way it is
   Extract: topic, entity_name
5. action_request — asking to take an action
   Extract: action_type, target
6. unknown — cannot determine intent

Question: "${question}"

Respond with ONLY JSON: { "type": "...", ... }`,
      }],
      maxTokens: 300,
      temperature: 0,
      _tracking: {
        workspaceId,
        phase: 'chat',
        stepName: 'classify-direct-question',
      },
    });

    return safeParseIntent<DirectQuestionRoute>(response.content, { type: 'unknown' });
  } catch (err) {
    console.error('[intent-classifier] Direct question classification error:', err);
    return { type: 'unknown' };
  }
}

function safeParseIntent<T>(content: string, fallback: T): T {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return fallback;
  }
}

// ============================================================================
// Intent Classifier + Model Router (NEW - Ask Pandora optimization)
// ============================================================================

export type IntentCategory =
  | 'data_query'                // Needs tools — "how many deals in pipeline?", "show me stalled deals"
  | 'advisory_stateless'        // No tools needed — "what's the difference between MEDDIC and MEDDPICC?"
  | 'advisory_with_data_option' // Better with data, but answerable without — "what closed-lost reasons should I use?"
  | 'document_request'          // User wants a downloadable document — "create a framework", "build a report"
  | 'retrospective'             // Quarterly/period retrospective analysis — "why did we miss?", "how did Q1 go?"
  | 'deal_deliberation'         // Bull/Bear Analysis — "will this deal close?", "what's the risk?"
  | 'ambiguous';                // Unclear — fall through to existing path

export interface IntentClassification {
  category: IntentCategory;
  confidence: number;           // 0-1
  reasoning: string;            // Why this category was selected
  gating_question?: string;     // Only set for advisory_with_data_option
  fast_path: boolean;           // true if determined by regex (no LLM used)
  tokens_used: number;          // 0 for fast path
  is_followup_doc?: boolean;    // true when user wants previous response converted to a doc
}

export type DeliberationMode =
  | 'bull_bear'
  | 'red_team'
  | 'boardroom'
  | 'socratic'
  | 'prosecutor_defense'
  | 'none';

export type DeliberationLens =
  | 'deal_viability'
  | 'data_challenge'
  | 'triage_allocation'
  | 'plan_stress_test'
  | 'red_team'
  | 'none';

// Maps modes to their CoS lens names
const MODE_TO_LENS: Record<DeliberationMode, DeliberationLens> = {
  bull_bear: 'deal_viability',
  boardroom: 'triage_allocation',
  socratic: 'data_challenge',
  prosecutor_defense: 'plan_stress_test',
  red_team: 'red_team',
  none: 'none',
};

export interface DeliberationClassification {
  mode: DeliberationMode;
  lens: DeliberationLens;
  confidence: number;
  rationale: string;
}

// Deliberation trigger patterns — only fire when chat is deal-scoped
const DELIBERATION_PATTERNS = [
  // Close probability questions
  /will (this|the) deal close\b/i,
  /will (we|it) close\b/i,
  /is this deal going to close\b/i,
  /\bhow (likely|probable) is (it|this) to close\b/i,
  /\b(chance|probability|likelihood) (this|of this) (deal )?(closes?|closing)\b/i,

  // Risk and concern questions
  /should (i|we) be (worried|concerned|nervous)\b/i,
  /what(\'s| is) the risk (here|on this|with this)\b/i,
  /what are the (chances|odds)\b/i,

  // Judgment and assessment requests
  /what do you think about this deal\b/i,
  /give me your honest assessment\b/i,
  /what's your (call|take|read|honest|assessment|view) on this deal\b/i,
  /what('s| is) your (honest )?(take|read|call|assessment|view)\b/i,

  // Explicit deliberation requests
  /bull.{0,10}bear (case|analysis|on this)\b/i,
  /bear.{0,10}bull (case|analysis|on this)\b/i,
  /prosecutor.{0,10}defense\b/i,
  /devil.{0,5}advocate\b/i,
  /argue (both|the other) side\b/i,
  /steelman (this|the deal)\b/i,

  // Deal viability questions
  /is this (deal )?(worth|dead|salvageable|lost|over)\b/i,
  /is it (worth|dead|too late|salvageable)\b/i,
  /is there (still )?(a )?path (to close|forward|here)\b/i,
  /is this (deal )?dead\b/i,

  // Continuation judgment
  /should we (keep|continue|pursue|cut|drop|walk away from|abandon)\b/i,

  // Effort vs return
  /are we wasting (our )?time\b/i,
  /is this (deal )?worth (our |the )?effort\b/i,
  /worth (pursuing|continuing|our time)\b/i,
];

// Retrospective intent patterns — route to 3-phase evidence-harvest architecture
const RETROSPECTIVE_PATTERNS = [
  /why did we (miss|make|hit|beat)\b/i,
  /how did (we|the team) (do|perform) (this|last) quarter/i,
  /what (happened|went wrong|drove) (this|last) quarter/i,
  /q[1-4]\s*(retro|retrospective|review|analysis|debrief|post.?mortem)/i,
  /look back (at|on) (the quarter|q[1-4])/i,
  /quarterly (retro|retrospective|review|debrief|post.?mortem)/i,
  /did we (make|hit|beat|miss|achieve) (our\s+)?(number|quota|target|goal)\b/i,
  /how (did|do) we explain (the|this) (miss|beat|gap|shortfall|result)/i,
  /(were we|did we get) (lucky|unlucky)\b/i,
  /process vs\.?\s*luck/i,
  /did we execute well (or|vs) get lucky/i,
  /why (did|do) we (win|lose|won|lost) (so many|more|fewer|last|this) quarter/i,
  /diagnose (the|this|our|last) quarter/i,
  /(replicable|structural|lucky|unlucky) (quarter|result|performance)/i,
];

// Fast-path pattern matchers (no LLM, ~0ms)
const DATA_QUERY_PATTERNS = [
  /^(how many|what is (the|our)|show me|list|count|total|give me)\b/i,
  /^(what('s| is) (my|our|the) (pipeline|forecast|win rate|quota|attainment))/i,
  /\b(which deals|what deals|which accounts|what accounts)\b/i,
  /\b(last (week|month|quarter|year)|this (week|month|quarter))\b/i,
  /\b(show|pull|get|find|search|look up)\b.*(deal|account|contact|opportunity)/i,
  // Temporal + metric combinations — always require CRM data, never advisory
  /\b(next quarter|next q\b|next fiscal|upcoming quarter)\b.*\b(pipeline|coverage|forecast|attainment|quota|deals?)\b/i,
  /\b(pipeline|coverage|forecast|attainment|quota|deals?)\b.*\b(next quarter|next q\b|next fiscal|upcoming quarter)\b/i,
  /\bq[1-4]\b.*\b(pipeline|coverage|forecast|attainment|quota|deals?)\b/i,
  /\b(pipeline|coverage|forecast|attainment|quota|deals?)\b.*\bq[1-4]\b/i,
];

const ADVISORY_STATELESS_PATTERNS = [
  /^what (is|are|does) (meddic|meddpicc|bant|spin|challenger|gap selling|bowtie|funnel)/i,
  /\b(difference between|compare|vs\.?|versus)\b.*(methodology|framework|model|approach)/i,
  /^(explain|define|what does .+ mean|how does .+ work)\b/i,
  /\b(best practice|industry standard|benchmark|typical|average company|most companies)\b/i,
  /\b(how do you|how do we|how is|how are)\s+(define|calculate|measure|determine|compute|count)\b/i,
  /\bwhat (counts?|qualifies?) as\b/i,
  /\bwhat does .+ (mean|include|count as|represent|qualify as)\b/i,
];

const ADVISORY_WITH_DATA_PATTERNS = [
  /\b(what|which) (values?|options?|reasons?|categories|fields?|picklist|dropdown) should (i|we|my team)/i,
  /how should (i|we) (set up|structure|configure|design|organize)\b/i,
  /what (closed.lost|close.lost|won|loss|churn) reasons?/i,
  /\b(design|build|create|define) (my|our|a|the) (icp|ideal customer|pipeline|process|playbook|stages?)\b/i,
  /^why (do|are|is|did|does) (we|our|my|the team|customers?|deals?)/i,
  /what should (i|we) (do|focus on|prioritize|change|fix|improve)\b/i,
];

const DOCUMENT_REQUEST_PATTERNS = [
  /\b(create|build|generate|put together|draft|write|prepare)\b.*\b(framework|report|document|doc|briefing|analysis|plan|summary|deck)\b/i,
  /\b(framework|report|document|briefing)\b.*\b(for|on|about)\b/i,
  /\bcapacity plan(ning)?\b/i,
  /\bstrategic (plan|analysis|brief|review)\b/i,
  /\b(comprehensive|executive|detailed|full)\s+(summary|report|overview|briefing|analysis)\b/i,
  /\b(qbr|board)\s+(deck|report|prep|presentation)\b/i,
];

const FOLLOWUP_DOC_PATTERNS = [
  /\b(in|into|as|to)\s+(a\s+)?(an?\s+)?(exportable\s+)?(downloadable\s+)?(docs?|documents?|docx|word|excel|xlsx|spreadsheet|files?)\b/i,
  /\b(give|send|share|output|export|convert|turn)\b.*\b(docs?|documents?|docx|word|files?|download)\b/i,
  /\bcreate the doc\b/i,
  /\bdownload\s+(this|that|it)\b/i,
  /\bexport\s+(this|that|it)\b/i,
  /\bmake\s+(this|that|it)\s+(a\s+)?(docs?|documents?|downloadable|exportable)\b/i,
  /\bcan\s+i\s+(have|get)\s+(this|that|it)\s+(as|in)\s/i,
  /\b(put|have|get)\s+(this|that|it)\s+in\s+(a\s+)?(docs?|documents?)\b/i,
];

const GATING_QUESTIONS: Record<string, string> = {
  'closed_lost_reasons':
    "I can answer this two ways — would you like general RevOps best practice, or should I first mine your actual closed-lost data and open-text reason fields to recommend values based on what your team is actually experiencing?",
  'churn_analysis':
    "I can draw on general SaaS churn patterns, or I can dig into your closed-lost deals and any call transcripts first to ground the answer in your actual data. Which would be more useful?",
  'process_design':
    "I can suggest a framework based on general best practice, or I can first look at how your current deals actually move through stages to base the recommendation on your team's real motion. Which approach?",
  'default':
    "I can answer this from general RevOps best practice, or I can first look at your actual data to give you a recommendation grounded in what's happening in your pipeline. Which would be more useful?",
};

function generateGatingQuestion(message: string): string {
  const lower = message.toLowerCase();
  if (/closed.lost|close.lost|loss reason|churn reason/.test(lower)) {
    return GATING_QUESTIONS['closed_lost_reasons'];
  }
  if (/churn|why.+customer|why.+lose/.test(lower)) {
    return GATING_QUESTIONS['churn_analysis'];
  }
  if (/stage|process|pipeline|structure/.test(lower)) {
    return GATING_QUESTIONS['process_design'];
  }
  return GATING_QUESTIONS['default'];
}

// ============================================================================
// Context Availability Hint
// ============================================================================

/**
 * Builds a hint string describing what workspace data is already loaded in
 * memory for this request. Prepended to the LLM classifier prompt so the
 * classifier knows not to route questions to tool-calling when the answer
 * already exists in context.
 */
export function buildContextAvailabilityHint(ctx: WorkspaceContext): string {
  const available: string[] = [];

  if (ctx.sales_reps?.length) {
    const names = ctx.sales_reps.map(r => r.name).join(', ');
    available.push(`Sales roster: ${ctx.sales_reps.length} reps loaded (${names})`);
  }
  if (ctx.current_quarter_target != null) {
    available.push(`Current quarter target: $${ctx.current_quarter_target.toLocaleString()} loaded`);
  }
  if (ctx.active_targets?.length) {
    available.push(`Quota targets: ${ctx.active_targets.length} period(s) loaded`);
  }
  if (ctx.confirmed_dimensions?.length) {
    available.push(`Business definitions: ${ctx.confirmed_dimensions.length} loaded`);
  }
  if (ctx.workspace_knowledge?.length) {
    available.push(`Business knowledge: ${ctx.workspace_knowledge.length} item(s)`);
  }

  if (!available.length) return '';

  return (
    `WORKSPACE CONTEXT ALREADY LOADED:\n` +
    available.map(a => `- ${a}`).join('\n') +
    `\n\nQuestions answerable from this context should be classified as ` +
    `'advisory_stateless', not 'data_query'. Use 'data_query' only for ` +
    `questions requiring live deal records, activity logs, or computed metrics ` +
    `(e.g. "which deals are stalled?", "what's our win rate?").\n\n`
  );
}

export const INTENT_CLASSIFIER_SYSTEM_PROMPT = `You are classifying sales operations questions into categories.

Categories:
- data_query: Requires pulling data from CRM or conversation tools to answer. Examples: "how many deals in pipeline?", "which deals are stalled?", "what's our win rate?", "how much pipeline do we need?", "what's our conversion rate?", "how does our win rate compare to our conversion rate?", "what coverage ratio do we need to hit quota?"
- advisory_stateless: Answerable from general RevOps knowledge, no data needed — OR answerable from workspace context that is already loaded in memory (sales roster, quota targets, pipeline definitions). Examples: "what's MEDDIC?", "who are our reps?", "what's our quota?", "what are our pipeline stage definitions?", "how does bowtie attribution work?"
- advisory_with_data_option: Could be answered generically, but would be MUCH better if we first mined the user's actual CRM data or call transcripts. ONLY for structural/configuration questions like: "what closed-lost reason values should I use?", "how should I structure my pipeline stages?", "why do our customers churn?". DO NOT use this for operational RevOps questions about pipeline health, deal hygiene, forecast improvement, deal risk, or rep performance — those are data_query because the data IS the answer, not an option.
- document_request: User wants a formatted deliverable — a framework, report, briefing, or strategic document. Keywords: "create a framework", "build a report", "put together a briefing", "draft a plan for", "generate a capacity plan". This category always requires data mining first, then document synthesis. Different from data_query (which returns a chat answer) because the user explicitly wants a downloadable document.
- retrospective: User is asking a retrospective revenue question about a past quarter or period — why did we miss/beat quota, how did Q1 go, what drove results, were we lucky or process-driven. These require correlating pipeline, activity, conversion, and rep performance data across a period. Examples: "why did we miss last quarter?", "how did we do in Q1?", "was our Q3 result replicable?", "what went wrong this quarter?"

Respond with ONLY valid JSON, no other text:
{
  "category": "data_query" | "advisory_stateless" | "advisory_with_data_option" | "document_request" | "retrospective",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence"
}`;

async function classifyWithLLM(
  message: string,
  workspaceId: string,
  tokenEstimate: TokenEstimate,
  contextHint?: string,
): Promise<IntentClassification> {
  const capability = tokenEstimate.totalInputTokens < TOKEN_THRESHOLDS.DEEPSEEK_MAX_INPUT
    ? 'classify'
    : 'reason';

  try {
    const result = await Promise.race([
      callIntentClassifier(capability, message, workspaceId, contextHint),
      timeoutPromise(3000),
    ]);

    return {
      ...result,
      fast_path: false,
      tokens_used: Math.ceil((INTENT_CLASSIFIER_SYSTEM_PROMPT.length + message.length) / 4),
    };
  } catch (err: any) {
    console.warn('[IntentClassifier] Classification failed, falling through:', err?.message || err);
    // Default to data_query rather than ambiguous — ambiguous causes uncertain routing.
    // Most questions that time out or fail classification are data queries.
    return {
      category: 'data_query',
      confidence: 0.5,
      reasoning: 'Classification timed out — defaulting to data_query',
      fast_path: false,
      tokens_used: 0,
    };
  }
}

async function callIntentClassifier(
  capability: 'classify' | 'reason',
  message: string,
  workspaceId: string,
  contextHint?: string,
): Promise<Pick<IntentClassification, 'category' | 'confidence' | 'reasoning'>> {
  const userContent = contextHint ? `${contextHint}Question to classify: ${message}` : message;
  const response = await callLLM(workspaceId, capability, {
    systemPrompt: INTENT_CLASSIFIER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 256,
    temperature: 0,
    _tracking: { workspaceId, phase: 'chat', stepName: 'intent-classifier', questionText: message },
  });

  const text = (response.content || '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        category: parsed.category || 'ambiguous',
        confidence: parsed.confidence || 0,
        reasoning: parsed.reasoning || 'No reasoning provided',
      };
    } catch (parseErr) {
      console.error('[IntentClassifier] JSON parse failed:', text);
    }
  }

  return {
    category: 'ambiguous',
    confidence: 0,
    reasoning: 'Failed to parse classifier response',
  };
}

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('classifier_timeout')), ms);
  });
}

export async function classifyDeliberationMode(
  message: string,
  context: {
    scopeType?: string;           // 'deal' | 'pipeline' | etc
    entityId?: string;
    recentMessages?: string[];
    // Context signals for auto-triggering without phrase patterns
    stageAgeVsMedian?: number;    // days over median stage age (positive = slow)
    daysSinceActivity?: number;   // days since last recorded activity
    multithreadingScore?: number; // 0–1; low = poor stakeholder coverage
    daysUntilClose?: number;      // negative = past due
    weekOfQuarter?: number;       // 1–13
    openDealCount?: number;       // total open deals in scope (for triage)
    entityRiskScore?: number;     // 0–100, from deal_scores; low = high risk
  }
): Promise<DeliberationClassification> {
  const q = message.toLowerCase().trim();

  // ── Negative guard — data questions never warrant deliberation ───────────────
  const DATA_QUESTION_PREFIXES = [
    'show me', 'what is the current', 'what are the contacts',
    'how many', 'when did', 'what stage', 'who is', 'list', 'summarize',
  ];
  if (DATA_QUESTION_PREFIXES.some(prefix => q.startsWith(prefix))) {
    return { mode: 'none', lens: 'none', confidence: 1, rationale: 'data lookup question' };
  }

  // ── Context-signal auto-triggers ────────────────────────────────────────────
  // These fire when entity context is deal-scoped and risk signals are present,
  // even if the user's message doesn't use deliberation phrases.
  if (context.scopeType === 'deal' && context.entityId) {
    const overMedian = (context.stageAgeVsMedian ?? 0) > 10;
    const poorCoverage = (context.multithreadingScore ?? 1) < 0.30;
    const activityGap = (context.daysSinceActivity ?? 0) > 14;
    const urgentClose = typeof context.daysUntilClose === 'number' && context.daysUntilClose >= 0 && context.daysUntilClose < 14;
    // Entity risk score: score < 40 signals a high-risk deal needing viability review
    const highRiskScore = context.entityRiskScore != null && context.entityRiskScore < 40;
    if (overMedian || poorCoverage || activityGap || urgentClose || highRiskScore) {
      const trigger = overMedian ? 'stage_age_over_median' : poorCoverage ? 'low_multithreading' : activityGap ? 'activity_gap' : urgentClose ? 'close_urgency' : 'low_risk_score';
      return {
        mode: 'bull_bear',
        lens: 'deal_viability',
        confidence: highRiskScore && !overMedian && !poorCoverage && !activityGap && !urgentClose ? 0.80 : 0.85,
        rationale: `context signal: ${trigger}`,
      };
    }
  }

  // Triage allocation auto-trigger: late quarter with multiple open deals
  if ((context.weekOfQuarter ?? 0) >= 9 && (context.openDealCount ?? 0) >= 3) {
    return {
      mode: 'boardroom',
      lens: 'triage_allocation',
      confidence: 0.80,
      rationale: 'context signal: late_quarter_triage',
    };
  }

  // ── Data challenge patterns (replaces socratic) ──────────────────────────────
  // Fires before entity guard — data challenge works from message alone.
  // Triggers on assertive claims that can be verified against live data.
  const DATA_CHALLENGE_PATTERNS = [
    /\bi (think|believe|feel) (the problem|this|that)\b/i,
    /\bthe (problem|issue|root cause|reason) is\b/i,
    /\bour (pipeline|win rate|coverage|close rate|attainment|conversion) (is|looks|seems|appears)\b/i,
    /\bwe (have|had) (good|great|strong|weak|poor|enough|plenty of) (pipeline|coverage|deals|activity)/i,
    /\bwe('re| are) (on track|behind|ahead|healthy|struggling|doing well|in good shape)/i,
    /\bdoes this make sense\b/i,
    /\bam i (right|wrong|missing|off)\b/i,
    /\bis (this|that|my) (assumption|hypothesis|theory|read)\b/i,
    /\btell me why i('m| am) wrong\b/i,
    /\bdoes (this|my) reasoning hold\b/i,
    /\bstress.?test (my|this|our) (assumption|thesis|view)\b/i,
    /\bam i missing something\b/i,
    /\bwe should (focus|prioritize|invest|hire|cut|double down|push|stop)\b/i,
    /\bthe (real|underlying|main|biggest|core) (issue|problem|challenge|risk) (is|here)\b/i,
  ];

  for (const pattern of DATA_CHALLENGE_PATTERNS) {
    if (pattern.test(message)) {
      return {
        mode: 'socratic',
        lens: 'data_challenge',
        confidence: 0.90,
        rationale: 'data challenge pattern — assertive claim detected',
      };
    }
  }

  // ── Fast-path guard: no deliberation if no entity context ────────────────────
  if (!context.scopeType && !context.entityId &&
      !/\b(hypothesis|sprint|plan)\b/i.test(message)) {
    return { mode: 'none', lens: 'none', confidence: 1, rationale: 'no entity context' };
  }

  // ── Fast-path: deal viability patterns ──────────────────────────────────────
  const DEAL_VIABILITY_PATTERNS = [
    /\bwill (this|the) deal close\b/i,
    /\b(probability|chance|likelihood) of (closing|winning)\b/i,
    /\bshould (i|we) (pursue|walk away|drop|kill)\b/i,
    /\bclose probability\b/i,
  ];

  for (const pattern of DEAL_VIABILITY_PATTERNS) {
    if (pattern.test(message)) {
      return {
        mode: 'bull_bear',
        lens: 'deal_viability',
        confidence: 1,
        rationale: 'deal viability phrase match',
      };
    }
  }

  // ── Fast-path: triage allocation patterns ────────────────────────────────────
  const TRIAGE_PATTERNS = [
    /\bwhat should (we|the team) do\b/i,
    /\bhow should (we|i) handle\b/i,
    /\bwe('re| are) considering\b/i,
    /\bprioritize\b.*\bor\b/i,
    /\btrade.?off\b/i,
    /\bwhich deals? (should|do) (we|i) (focus|prioritize|work|chase|pursue)\b/i,
    /\bwhere (should|do) (we|i) (spend|put|focus)\b.*(time|effort|energy)\b/i,
  ];

  for (const pattern of TRIAGE_PATTERNS) {
    if (pattern.test(message)) {
      return {
        mode: 'boardroom',
        lens: 'triage_allocation',
        confidence: 1,
        rationale: 'triage allocation phrase match',
      };
    }
  }

  // ── Fast-path: plan stress-test patterns ─────────────────────────────────────
  const PLAN_STRESS_PATTERNS = [
    /\bwe('re| are) planning (to|on)\b/i,
    /\bwe (decided|decided to)\b/i,
    /\bour (plan|strategy|approach) is\b/i,
    /\bwe('re| are) going to\b/i,
  ];

  for (const pattern of PLAN_STRESS_PATTERNS) {
    if (pattern.test(message)) {
      return {
        mode: 'prosecutor_defense',
        lens: 'plan_stress_test',
        confidence: 1,
        rationale: 'plan stress-test phrase match',
      };
    }
  }

  // ── DeepSeek fallback for ambiguous cases ────────────────────────────────────
  if (context.scopeType !== 'deal' &&
      !/\b(hypothesis|sprint|plan)\b/i.test(message)) {
    return { mode: 'none', lens: 'none', confidence: 0.9, rationale: 'not a deal context, no hypothesis keywords' };
  }

  try {
    const response = await callLLM('system', 'intent_classify', {
      systemPrompt: `Classify whether this RevOps question warrants deliberation analysis.

deal_viability (mode: bull_bear): Question about whether a specific deal will close, its risk vs. upside, close probability, or whether to pursue/drop it.
Examples: "will this deal close?", "should we walk away?", "what's the probability this lands in Q1?"

red_team (mode: red_team): Question about validating a hypothesis, sprint plan, or whether a proposed action is sufficient.
Examples: "will this sprint work?", "is this hypothesis right?", "does this plan address the root cause?"

triage_allocation (mode: boardroom): Question about which deals or priorities to focus on. Trade-offs between options, rep capacity, quarter close potential.
Examples: "what should we do about pipeline coverage?", "how should we prioritize these deals?", "which deals should we focus on?"

data_challenge (mode: socratic): User is making an assertive claim about pipeline state, metrics, or root cause that can be verified against live data. "I think...", "Our pipeline is...", "We have good coverage..."
Examples: "I think the problem is lack of discovery", "our pipeline is healthy", "we're on track for the quarter"

plan_stress_test (mode: prosecutor_defense): User is stating a plan and wants it stress-tested. "We're planning to...", "Our strategy is...", "We decided to..."
Examples: "we're planning to hire 5 SDRs", "our strategy is to target healthcare", "we decided to cut prices 20%"

none: Everything else — data lookups, pipeline questions, rep questions, general advice, list requests.

Respond ONLY with JSON:
{ "mode": "bull_bear" | "red_team" | "boardroom" | "socratic" | "prosecutor_defense" | "none", "confidence": 0.0, "rationale": "one sentence" }`,
      messages: [{
        role: 'user',
        content: `Context: ${context.scopeType || 'unknown'} scope${context.entityId ? ', entity present' : ''}\nMessage: "${message}"`,
      }],
      maxTokens: 100,
      temperature: 0,
    });

    const text = (response.content || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const mode: DeliberationMode = parsed.mode || 'none';
        return {
          mode,
          lens: MODE_TO_LENS[mode] ?? 'none',
          confidence: parsed.confidence || 0.5,
          rationale: parsed.rationale || 'classifier response',
        };
      } catch {
        // JSON parse failed
      }
    }
  } catch (err) {
    console.error('[classifyDeliberationMode] error:', err);
  }

  return { mode: 'none', lens: 'none', confidence: 1, rationale: 'classifier error' };
}

export async function classifyIntent(
  message: string,
  conversationHistory: Array<{ role: string; content: string }>,
  workspaceId: string,
  workspaceCtx?: WorkspaceContext | null,
): Promise<IntentClassification> {
  // Fast path — follow-up document request ("put that in a doc", "export this", "create the doc")
  for (const pattern of FOLLOWUP_DOC_PATTERNS) {
    if (pattern.test(message)) {
      return {
        category: 'document_request',
        confidence: 0.90,
        reasoning: 'Follow-up document request — user wants previous response as downloadable doc',
        fast_path: true,
        tokens_used: 0,
        is_followup_doc: true,
      };
    }
  }

  // Fast path — new document request patterns (check first as most specific)
  for (const pattern of DOCUMENT_REQUEST_PATTERNS) {
    if (pattern.test(message)) {
      return {
        category: 'document_request',
        confidence: 0.85,
        reasoning: 'Document request pattern match',
        fast_path: true,
        tokens_used: 0,
      };
    }
  }

  // Fast path — retrospective questions (check before data_query; more specific)
  for (const pattern of RETROSPECTIVE_PATTERNS) {
    if (pattern.test(message)) {
      return {
        category: 'retrospective',
        confidence: 0.88,
        reasoning: 'Retrospective intent pattern match — will run 3-phase evidence-harvest pipeline',
        fast_path: true,
        tokens_used: 0,
      };
    }
  }

  // Fast path — data query patterns
  for (const pattern of DATA_QUERY_PATTERNS) {
    if (pattern.test(message)) {
      return {
        category: 'data_query',
        confidence: 0.85,
        reasoning: 'Data query pattern match',
        fast_path: true,
        tokens_used: 0,
      };
    }
  }

  // Fast path — advisory stateless patterns
  for (const pattern of ADVISORY_STATELESS_PATTERNS) {
    if (pattern.test(message)) {
      return {
        category: 'advisory_stateless',
        confidence: 0.85,
        reasoning: 'Advisory pattern match',
        fast_path: true,
        tokens_used: 0,
      };
    }
  }

  // Fast path — advisory with data option patterns
  // Always pull data rather than asking — redirect to data_query
  for (const pattern of ADVISORY_WITH_DATA_PATTERNS) {
    if (pattern.test(message)) {
      return {
        category: 'data_query',
        confidence: 0.80,
        reasoning: 'Advisory-with-data pattern — auto-routing to data pull',
        fast_path: true,
        tokens_used: 0,
      };
    }
  }

  // LLM classification for ambiguous cases
  const tokenEstimate = estimateTokens(message, conversationHistory);
  const contextHint = workspaceCtx ? buildContextAvailabilityHint(workspaceCtx) : undefined;
  const result = await classifyWithLLM(message, workspaceId, tokenEstimate, contextHint);

  // advisory_with_data_option: always pull data rather than asking which the user prefers
  if (result.category === 'advisory_with_data_option') {
    result.category = 'data_query';
  }

  return result;
}

// ============================================================================
// Intent Classification Logging
// ============================================================================

export async function logIntentClassification(
  workspaceId: string,
  message: string,
  result: IntentClassification,
  tokenEstimate?: TokenEstimate,
): Promise<void> {
  try {
    const estimate = tokenEstimate || estimateTokens(message, []);
    const classifierModel = result.fast_path
      ? 'regex'
      : (result.tokens_used < 500 ? 'deepseek' : 'claude');

    await query(
      `INSERT INTO intent_classifications
       (workspace_id, question_text, question_length_tokens, context_length_tokens,
        category, confidence, fast_path, tokens_used, classifier_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        workspaceId,
        message.slice(0, 500),
        estimate.messageTokens,
        estimate.contextTokens,
        result.category,
        result.confidence,
        result.fast_path,
        result.tokens_used,
        classifierModel,
      ]
    );
  } catch (err) {
    console.error('[IntentClassifier] Failed to log classification:', err instanceof Error ? err.message : err);
  }
}
