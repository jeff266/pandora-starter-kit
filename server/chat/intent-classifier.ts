import { callLLM } from '../utils/llm-router.js';
import { estimateTokens, TOKEN_THRESHOLDS, type TokenEstimate } from './token-estimator.js';
import { query } from '../db.js';

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

export const INTENT_CLASSIFIER_SYSTEM_PROMPT = `You are classifying sales operations questions into categories.

Categories:
- data_query: Requires pulling data from CRM or conversation tools to answer. Examples: "how many deals in pipeline?", "which deals are stalled?", "what's our win rate?"
- advisory_stateless: Answerable from general RevOps knowledge, no data needed. Examples: "what's MEDDIC?", "what's a good sales process?", "how does bowtie attribution work?"
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
): Promise<IntentClassification> {
  const capability = tokenEstimate.totalInputTokens < TOKEN_THRESHOLDS.DEEPSEEK_MAX_INPUT
    ? 'classify'
    : 'reason';

  try {
    const result = await Promise.race([
      callIntentClassifier(capability, message, workspaceId),
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
): Promise<Pick<IntentClassification, 'category' | 'confidence' | 'reasoning'>> {
  const response = await callLLM(workspaceId, capability, {
    systemPrompt: INTENT_CLASSIFIER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: message }],
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

export async function classifyIntent(
  message: string,
  conversationHistory: Array<{ role: string; content: string }>,
  workspaceId: string,
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
  const result = await classifyWithLLM(message, workspaceId, tokenEstimate);

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
