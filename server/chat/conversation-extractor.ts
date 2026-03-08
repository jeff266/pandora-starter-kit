import { callLLM } from '../utils/llm-router.js';
import { query } from '../db.js';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  skill_id?: string;
  metadata?: Record<string, any>;
  tool_trace?: Array<{ tool: string; input?: Record<string, any>; [key: string]: any }>;
  created_at?: string;
}

export interface ExtractionInput {
  messages: ChatMessage[];
  workspace_id: string;
  conversation_id: string;
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface ScheduleSuggestion {
  cron: string;
  label: string;
  timezone: string;
}

export interface DeliverySuggestion {
  format: 'slack' | 'email' | 'command_center';
  channel?: string;
}

export interface ConversationExtractionResult {
  suggested_name: string | null;
  goal: string;
  standing_questions: string[];
  detected_skills: string[];
  suggested_schedule: ScheduleSuggestion;
  suggested_delivery: DeliverySuggestion;
  confidence: 'high' | 'medium' | 'low';
  _reasoning: string;
  _user_message_count: number;
  _deepseek_tokens_used: number;
}

// ─── Task 2: Skill Detection (deterministic) ─────────────────────────────────

/**
 * Scan messages for skill invocations.
 * Sources checked:
 *  a) direct skill_id field on any message
 *  b) metadata.skill_id, metadata.skills_used, metadata.skill_evidence_used
 *  c) tool_trace on assistant messages — look for get_skill_evidence calls
 *  d) tool messages with name 'get_skill_evidence' in content (Anthropic format)
 *
 * Deduplicates and preserves first-appearance order.
 */
export function detectInvokedSkills(messages: ChatMessage[]): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];

  function addSkill(s: string | null | undefined) {
    if (s && typeof s === 'string' && !seen.has(s)) {
      seen.add(s);
      skills.push(s);
    }
  }

  for (const msg of messages) {
    addSkill(msg.skill_id);

    const meta = msg.metadata ?? {};
    addSkill(meta.skill_id);

    if (Array.isArray(meta.skills_used)) {
      for (const s of meta.skills_used) addSkill(s?.skill_id || s);
    }
    if (Array.isArray(meta.skill_evidence_used)) {
      for (const s of meta.skill_evidence_used) addSkill(s?.skill_id);
    }

    if (Array.isArray(msg.tool_trace)) {
      for (const trace of msg.tool_trace) {
        if (trace.tool === 'get_skill_evidence' && trace.input?.skill_id) {
          addSkill(trace.input.skill_id);
        }
      }
    }

    // Anthropic-format: assistant content blocks
    if (msg.role === 'assistant' && Array.isArray((msg as any).content)) {
      for (const block of (msg as any).content) {
        if (
          block?.type === 'tool_use' &&
          block?.name === 'get_skill_evidence' &&
          block?.input?.skill_id
        ) {
          addSkill(block.input.skill_id);
        }
      }
    }
  }

  return skills;
}

// ─── Task 3: Schedule Inference (heuristic) ───────────────────────────────────

interface ScheduleRule {
  patterns: RegExp[];
  cron: string;
  label: string;
}

const SCHEDULE_RULES: ScheduleRule[] = [
  {
    patterns: [/\b(daily|every day|each day|each morning|every morning)\b/i],
    cron: '0 7 * * 1-5',
    label: 'Weekdays at 7 AM',
  },
  {
    patterns: [
      /\b(monday|monday morning|start of week|beginning of week|weekly pipeline)\b/i,
      /\b(pipeline review|pipeline brief)\b/i,
    ],
    cron: '0 8 * * 1',
    label: 'Every Monday at 8 AM',
  },
  {
    patterns: [/\b(friday|end of week|weekly forecast|forecast call|forecast prep)\b/i],
    cron: '0 16 * * 5',
    label: 'Every Friday at 4 PM',
  },
  {
    patterns: [/\b(weekly|each week|every week|week over week|wow)\b/i],
    cron: '0 8 * * 1',
    label: 'Every Monday at 8 AM',
  },
  {
    patterns: [/\b(monthly|each month|every month|month over month|mom|end of month)\b/i],
    cron: '0 8 1 * *',
    label: '1st of every month at 8 AM',
  },
  {
    patterns: [/\b(quarterly|qbr|quarter end|end of quarter|eoq)\b/i],
    cron: '',
    label: 'On demand (quarterly)',
  },
];

const DEFAULT_SCHEDULE: ScheduleSuggestion = {
  cron: '0 8 * * 1',
  label: 'Every Monday at 8 AM',
  timezone: 'America/New_York',
};

export function inferSchedule(messages: ChatMessage[]): ScheduleSuggestion {
  const userText = messages
    .filter(m => m.role === 'user')
    .map(m => (typeof m.content === 'string' ? m.content : ''))
    .join(' ');

  for (const rule of SCHEDULE_RULES) {
    if (rule.patterns.some(p => p.test(userText))) {
      return { cron: rule.cron, label: rule.label, timezone: 'America/New_York' };
    }
  }

  return DEFAULT_SCHEDULE;
}

// ─── Task 4: Delivery Inference (heuristic) ───────────────────────────────────

export function inferDelivery(messages: ChatMessage[]): DeliverySuggestion {
  const userText = messages
    .filter(m => m.role === 'user')
    .map(m => (typeof m.content === 'string' ? m.content : ''))
    .join(' ');

  const channelMatch = userText.match(/#([a-z0-9_-]+)/i);
  if (channelMatch) {
    return { format: 'slack', channel: `#${channelMatch[1]}` };
  }

  if (/\b(email|send to|mailto|inbox)\b/i.test(userText)) {
    return { format: 'email' };
  }

  return { format: 'slack' };
}

// ─── Task 5: Name Generation (deterministic) ──────────────────────────────────

const CADENCE_LABELS: Record<string, string> = {
  '0 7 * * 1-5': 'Daily',
  '0 8 * * 1': 'Weekly',
  '0 16 * * 5': 'Friday',
  '0 8 1 * *': 'Monthly',
  '': '',
};

const TOPIC_KEYWORDS: Array<{ patterns: RegExp[]; label: string }> = [
  {
    patterns: [/pipeline\s+(hygiene|health|review|coverage)/i, /stale\s+deal/i],
    label: 'Pipeline Review',
  },
  {
    patterns: [/forecast/i, /landing\s+zone/i, /commit/i],
    label: 'Forecast Brief',
  },
  {
    patterns: [/rep\s+(scorecard|performance|attainment)/i, /reps.*behind/i],
    label: 'Rep Scorecard',
  },
  {
    patterns: [/data\s+quality/i, /hygiene\s+audit/i],
    label: 'Data Quality Audit',
  },
  {
    patterns: [/icp|ideal\s+customer|win\s+pattern/i],
    label: 'ICP Audit',
  },
  {
    patterns: [/single.thread|multi.thread|contact\s+role/i],
    label: 'Coverage Alert',
  },
  {
    patterns: [/competitive|competitor/i],
    label: 'Competitive Brief',
  },
];

export function generateAgentName(
  goal: string,
  schedule: ScheduleSuggestion,
  messages: ChatMessage[]
): string | null {
  const cadence = CADENCE_LABELS[schedule.cron] ?? 'Weekly';

  const textToSearch =
    goal +
    ' ' +
    messages
      .filter(m => m.role === 'user')
      .map(m => (typeof m.content === 'string' ? m.content : ''))
      .join(' ');

  for (const { patterns, label } of TOPIC_KEYWORDS) {
    if (patterns.some(p => p.test(textToSearch))) {
      const name = cadence ? `${cadence} ${label}` : label;
      return name.slice(0, 40);
    }
  }

  return null;
}

// ─── Task 6: Goal + Standing Questions via DeepSeek ───────────────────────────

interface DeepSeekExtractionOutput {
  goal: string;
  questions: string[];
  confidence: 'high' | 'medium' | 'low';
}

const EXTRACTION_SYSTEM_PROMPT = `You are analyzing a RevOps analyst's conversation with an AI assistant.
Your job is to extract the business intent so it can be saved as a recurring automated report.

Extract:
1. goal — The single business outcome motivating this conversation. One sentence, max 200 chars.
   Frame it as a standing mandate, not a one-time question.
   BAD:  "Find out why we're missing forecast this week"
   GOOD: "Ensure forecast accuracy and surface deals at risk before each leadership call"

2. questions — The 3 to 5 most substantive questions the analyst asked.
   Rephrase as recurring standing questions — things that should be answered
   every time this report runs, not just today.
   BAD:  "What happened to the Acme deal?"
   GOOD: "Which deals changed forecast category since the last run?"
   Each question max 120 chars.

3. confidence — Your confidence in the extraction:
   "high"   — clear business focus, 5+ substantive user messages
   "medium" — reasonable focus, some ambiguity
   "low"    — conversation too short, too scattered, or too exploratory

Respond ONLY with a JSON object. No preamble, no markdown, no explanation:
{
  "goal": "...",
  "questions": ["...", "...", "..."],
  "confidence": "high" | "medium" | "low"
}`;

export async function extractGoalAndQuestions(
  messages: ChatMessage[],
  workspaceId: string
): Promise<{ result: DeepSeekExtractionOutput; tokensUsed: number }> {
  const userMessages = messages.filter(m => m.role === 'user');

  if (userMessages.length === 0) {
    return {
      result: { goal: '', questions: [], confidence: 'low' },
      tokensUsed: 0,
    };
  }

  const MAX_CHARS = 2400;
  let userContent = userMessages
    .map((m, i) => `[${i + 1}] ${(typeof m.content === 'string' ? m.content : '').trim()}`)
    .join('\n\n');

  if (userContent.length > MAX_CHARS) {
    const first3 = userMessages.slice(0, 3);
    const last3 = userMessages.slice(-3);
    const combined = [...first3, ...last3].filter(
      (m, i, arr) => arr.findIndex(x => x === m) === i
    );
    userContent = combined
      .map((m, i) => `[${i + 1}] ${(typeof m.content === 'string' ? m.content : '').trim()}`)
      .join('\n\n')
      .slice(0, MAX_CHARS);
  }

  try {
    const llmResponse = await callLLM(workspaceId, 'classify', {
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Analyst conversation messages:\n\n${userContent}`,
        },
      ],
      maxTokens: 300,
      temperature: 0.1,
    });

    const tokensUsed = (llmResponse.usage?.input ?? 0) + (llmResponse.usage?.output ?? 0);

    const raw = typeof llmResponse.content === 'string'
      ? llmResponse.content
      : '';

    const clean = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    let parsed: DeepSeekExtractionOutput;
    try {
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { goal: '', questions: [], confidence: 'low' };
    } catch {
      parsed = { goal: '', questions: [], confidence: 'low' };
    }

    const goal = (parsed.goal ?? '').slice(0, 200).trim();
    const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map(q => q.slice(0, 120).trim())
      .slice(0, 5);
    const confidence = (['high', 'medium', 'low'] as const).includes(
      parsed.confidence as any
    )
      ? (parsed.confidence as 'high' | 'medium' | 'low')
      : 'low';

    return { result: { goal, questions, confidence }, tokensUsed };
  } catch (err) {
    console.error('[ConversationExtractor] LLM extraction failed:', err);
    return {
      result: { goal: '', questions: [], confidence: 'low' },
      tokensUsed: 0,
    };
  }
}

// ─── Task 7: Confidence Override Logic ───────────────────────────────────────

export function computeFinalConfidence(
  deepseekConfidence: 'high' | 'medium' | 'low',
  userMessageCount: number,
  detectedSkills: string[],
  goal: string,
  questions: string[]
): 'high' | 'medium' | 'low' {
  if (userMessageCount < 3) return 'low';
  if (detectedSkills.length === 0) return 'low';
  if (!goal || goal.length < 20) return 'low';
  if (questions.length < 2) return 'low';

  if (
    deepseekConfidence === 'medium' &&
    userMessageCount >= 7 &&
    detectedSkills.length >= 2 &&
    questions.length >= 3
  ) {
    return 'high';
  }

  return deepseekConfidence;
}

// ─── Task 10: loadChatMessages helper ─────────────────────────────────────────

/**
 * Load messages for a chat session from conversation_state (primary) or
 * chat_session_messages (fallback).
 *
 * The frontend sends conversation_id = threadId (the thread_ts stored in
 * conversation_state). If not found there, we also try chat_session_messages
 * using the conversation_id as a session UUID.
 *
 * Throws with code 'NOT_FOUND' if the conversation doesn't belong to this workspace.
 */
export async function loadChatMessages(
  workspaceId: string,
  conversationId: string
): Promise<ChatMessage[]> {
  // Primary: conversation_state (stores full tool traces as JSONB)
  try {
    const stateResult = await query<{ messages: any; workspace_id: string }>(
      `SELECT messages, workspace_id
       FROM conversation_state
       WHERE workspace_id = $1 AND channel_id = 'web' AND thread_ts = $2
       LIMIT 1`,
      [workspaceId, conversationId]
    );

    if (stateResult.rows.length > 0) {
      const rawMessages: any[] = stateResult.rows[0].messages || [];
      return rawMessages.map(m => ({
        role: m.role as ChatMessage['role'],
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        skill_id: m.skill_id,
        metadata: m.metadata,
        tool_trace: m.tool_trace,
        created_at: m.created_at,
      }));
    }
  } catch {
    // Fall through to chat_session_messages
  }

  // Fallback: chat_session_messages (persistent storage, no tool traces)
  const sessionCheck = await query<{ workspace_id: string }>(
    `SELECT workspace_id FROM chat_sessions WHERE id = $1 LIMIT 1`,
    [conversationId]
  );

  if (sessionCheck.rows.length === 0) {
    const err: any = new Error('Conversation not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (sessionCheck.rows[0].workspace_id !== workspaceId) {
    const err: any = new Error('Conversation not found');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const messagesResult = await query<{
    role: string;
    content: string;
    metadata: any;
    created_at: string;
  }>(
    `SELECT role, content, metadata, created_at
     FROM chat_session_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );

  return messagesResult.rows.map(row => ({
    role: row.role as ChatMessage['role'],
    content: row.content,
    metadata: row.metadata,
    created_at: row.created_at,
  }));
}

// ─── Task 8: Main Orchestrator ────────────────────────────────────────────────

export async function extractAgentFromConversation(
  input: ExtractionInput
): Promise<ConversationExtractionResult> {
  const { messages, workspace_id, conversation_id } = input;

  const detectedSkills = detectInvokedSkills(messages);
  const suggestedSchedule = inferSchedule(messages);
  const suggestedDelivery = inferDelivery(messages);

  const userMessageCount = messages.filter(m => m.role === 'user').length;

  const { result: extracted, tokensUsed } = await extractGoalAndQuestions(
    messages,
    workspace_id
  );

  const confidence = computeFinalConfidence(
    extracted.confidence,
    userMessageCount,
    detectedSkills,
    extracted.goal,
    extracted.questions
  );

  const suggestedName = confidence === 'low'
    ? null
    : generateAgentName(extracted.goal, suggestedSchedule, messages);

  const rawResult: ConversationExtractionResult = {
    suggested_name: suggestedName,
    goal: extracted.goal,
    standing_questions: extracted.questions,
    detected_skills: detectedSkills,
    suggested_schedule: suggestedSchedule,
    suggested_delivery: suggestedDelivery,
    confidence,
    _reasoning: `skills=${detectedSkills.join(',')}, userMsgs=${userMessageCount}, confidence=${confidence}`,
    _user_message_count: userMessageCount,
    _deepseek_tokens_used: tokensUsed,
  };

  return applyIntentDefaults(rawResult, messages, messages.length <= 6);
}

// ─── Intent-to-Defaults Map ───────────────────────────────────────────────────

interface AgentDefaultsEntry {
  suggested_name: string;
  skills: string[];
  suggested_schedule: ScheduleSuggestion;
  standing_questions: string[];
}

const INTENT_DEFAULTS: Array<{
  patterns: RegExp[];
  defaults: AgentDefaultsEntry;
}> = [
  {
    patterns: [/\bweekly\s+(pipeline|business)\s+review\b/i, /\bpipeline\s+review\b/i],
    defaults: {
      suggested_name: 'Weekly Pipeline Review',
      skills: ['pipeline-hygiene', 'rep-scorecard', 'forecast-rollup'],
      suggested_schedule: { cron: '0 8 * * 1', label: 'Every Monday at 8 AM', timezone: 'America/New_York' },
      standing_questions: [
        'Which deals advanced or regressed in stage this week?',
        'Which reps are below 3x coverage?',
        'What is the gap to quota and is the run rate sufficient?',
      ],
    },
  },
  {
    patterns: [/\bforecast\b/i, /\bcommit\b/i, /\blanding zone\b/i],
    defaults: {
      suggested_name: 'Weekly Forecast Brief',
      skills: ['forecast-rollup', 'pipeline-hygiene'],
      suggested_schedule: { cron: '0 16 * * 5', label: 'Every Friday at 4 PM', timezone: 'America/New_York' },
      standing_questions: [
        'What is the current base case and gap to quota?',
        'Which deals changed forecast category since last week?',
        'Which commit deals have risk signals?',
      ],
    },
  },
  {
    patterns: [/\brep\s+(performance|scorecard|attainment)\b/i, /\breps.*behind\b/i, /\bcoaching\b/i],
    defaults: {
      suggested_name: 'Weekly Rep Scorecard',
      skills: ['rep-scorecard', 'pipeline-coverage'],
      suggested_schedule: { cron: '0 8 * * 1', label: 'Every Monday at 8 AM', timezone: 'America/New_York' },
      standing_questions: [
        'Which reps are on track vs. at risk this quarter?',
        'Who needs coaching and on what specifically?',
        'Which reps have coverage below 3x?',
      ],
    },
  },
  {
    patterns: [/\bdata\s+quality\b/i, /\bhygiene\b/i, /\bmissing\s+fields\b/i],
    defaults: {
      suggested_name: 'Weekly Data Quality Audit',
      skills: ['data-quality-audit', 'pipeline-hygiene'],
      suggested_schedule: { cron: '0 8 * * 1', label: 'Every Monday at 8 AM', timezone: 'America/New_York' },
      standing_questions: [
        'What percentage of deals are missing required fields?',
        'Which reps have the most data hygiene issues?',
        'What are the most impactful fields to fix this week?',
      ],
    },
  },
];

/**
 * Apply intent-based defaults when extraction confidence is low or the
 * conversation is short (guided creation, <= 6 messages).
 *
 * Scans all user messages for intent patterns.
 * If a match is found:
 *  - Keeps DeepSeek goal if non-empty, otherwise uses default
 *  - Keeps DeepSeek questions if >= 2, otherwise uses defaults
 *  - Always replaces skills when extraction found none
 *  - For guided conversations, always uses the default schedule
 *  - Upgrades 'low' confidence to 'medium'
 */
export function applyIntentDefaults(
  result: ConversationExtractionResult,
  messages: ChatMessage[],
  isGuidedConversation: boolean,
): ConversationExtractionResult {
  const userText = messages
    .filter(m => m.role === 'user')
    .map(m => (typeof m.content === 'string' ? m.content : ''))
    .join(' ');

  for (const { patterns, defaults } of INTENT_DEFAULTS) {
    if (patterns.some(p => p.test(userText))) {
      return {
        ...result,
        suggested_name: result.suggested_name ?? defaults.suggested_name,
        detected_skills: result.detected_skills.length > 0
          ? result.detected_skills
          : defaults.skills,
        suggested_schedule: isGuidedConversation
          ? defaults.suggested_schedule
          : result.suggested_schedule,
        standing_questions: result.standing_questions.length >= 2
          ? result.standing_questions
          : defaults.standing_questions,
        confidence: result.confidence === 'low' ? 'medium' : result.confidence,
      };
    }
  }

  return result;
}
