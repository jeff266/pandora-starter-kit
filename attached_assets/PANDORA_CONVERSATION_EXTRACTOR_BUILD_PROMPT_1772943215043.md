# Claude Code Prompt: Conversation Extraction Engine

## Context

When a user has a meaningful Ask Pandora conversation and clicks "Save as Agent,"
Pandora needs to silently extract:
- The **goal** motivating the conversation (one sentence)
- The **standing questions** the user actually asked (3–5, rephrased as recurring)
- The **skills that were invoked** during the session (deterministic from tool metadata)
- A **suggested name** for the Agent
- A **suggested schedule** (heuristic, no LLM)
- A **suggested delivery config** (heuristic, no LLM)

This extraction runs server-side when the user clicks the CTA. It returns a
pre-filled modal payload. No Agent is created yet — that's a separate POST after
the user confirms.

This prompt builds:
1. `server/chat/conversation-extractor.ts` — the extraction engine
2. `POST /api/workspaces/:id/chat/extract-agent` — the endpoint
3. Unit tests for the extractor

---

## Before You Start

Read these files to understand the existing context:

1. `server/chat/orchestrator.ts` — understand how chat messages are stored/structured.
   What is the shape of a message in the DB? Does it have `role`, `content`,
   `tool_calls`, `metadata`? Find the actual column names.

2. `server/chat/` — scan all files. Is there already a `conversations` table for
   chat sessions (distinct from the `conversations` table for Gong/Fireflies calls)?
   What is the chat session table called? What are its columns?

3. `server/llm-client.ts` (or wherever LLM calls are made) — understand how
   DeepSeek is called today. Use the same pattern. Do NOT introduce a new HTTP
   client or a different calling convention.

4. `server/agents/types.ts` — find the Agent interface. Confirm that `goal`,
   `standing_questions`, `created_from`, `seed_conversation_id` columns exist
   after migration XXX (from the Ask-to-Agent spec). If the migration hasn't run
   yet, note that and add a TODO comment but don't block the build.

5. `server/routes/` — find where chat routes live. This endpoint goes alongside
   existing chat routes, not in the agents routes file.

6. `server/db/migrations/` — check the latest migration number so you can
   reference it in comments.

**Do NOT modify any existing files unless explicitly instructed below.**

---

## Task 1: Types

Create `server/chat/conversation-extractor.ts`. Start with the types.

```typescript
// ─── Input ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  skill_id?: string;          // Populated on tool/skill invocation messages
  metadata?: Record<string, any>;
  created_at?: string;
}

export interface ExtractionInput {
  messages: ChatMessage[];
  workspace_id: string;
  conversation_id: string;
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface ScheduleSuggestion {
  cron: string;               // Standard cron expression, e.g. "0 8 * * 1"
  label: string;              // Human readable, e.g. "Every Monday at 8 AM"
  timezone: string;           // Default "America/New_York" unless workspace TZ known
}

export interface DeliverySuggestion {
  format: 'slack' | 'email' | 'command_center';
  channel?: string;           // Slack channel or email address if detectable
}

export interface ConversationExtractionResult {
  // Core Agent fields
  suggested_name: string;            // ≤ 40 chars
  goal: string;                      // ≤ 200 chars, one sentence
  standing_questions: string[];      // 3–5 items, each ≤ 120 chars
  detected_skills: string[];         // skill IDs from tool call metadata

  // Schedule + delivery suggestions shown in modal
  suggested_schedule: ScheduleSuggestion;
  suggested_delivery: DeliverySuggestion;

  // Quality signal shown in modal UI
  confidence: 'high' | 'medium' | 'low';

  // Internal — logged but not returned to frontend
  _reasoning: string;
  _user_message_count: number;
  _deepseek_tokens_used: number;
}
```

---

## Task 2: Skill Detection (deterministic — no LLM)

```typescript
/**
 * Scan messages for skill invocations.
 * Skills are detected from:
 *  a) messages with role='tool' and a skill_id field
 *  b) assistant messages with metadata.skills_invoked array
 *  c) any message with metadata.skill_id
 *
 * Deduplicate and return as array of skill ID strings.
 * Order by first appearance.
 *
 * IMPORTANT: Scan the actual message structure from the DB.
 * If the structure differs from the above, adapt — don't assume.
 */
export function detectInvokedSkills(messages: ChatMessage[]): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];

  for (const msg of messages) {
    // Check direct skill_id field
    if (msg.skill_id && !seen.has(msg.skill_id)) {
      seen.add(msg.skill_id);
      skills.push(msg.skill_id);
    }

    // Check metadata
    const meta = msg.metadata ?? {};
    const candidates = [
      meta.skill_id,
      ...(Array.isArray(meta.skills_invoked) ? meta.skills_invoked : []),
    ].filter(Boolean);

    for (const s of candidates) {
      if (!seen.has(s)) {
        seen.add(s);
        skills.push(s);
      }
    }
  }

  return skills;
}
```

---

## Task 3: Schedule Inference (heuristic — no LLM)

```typescript
/**
 * Infer a recurring schedule from temporal signals in the user's messages.
 *
 * Scan user messages only (role='user').
 * Match against keyword patterns.
 * Return the FIRST matching rule.
 * Default to Monday 8 AM if nothing matches.
 */

interface ScheduleRule {
  patterns: RegExp[];
  cron: string;
  label: string;
}

const SCHEDULE_RULES: ScheduleRule[] = [
  // Daily
  {
    patterns: [/\b(daily|every day|each day|each morning|every morning)\b/i],
    cron: '0 7 * * 1-5',
    label: 'Weekdays at 7 AM',
  },
  // Monday / weekly pipeline
  {
    patterns: [
      /\b(monday|monday morning|start of week|beginning of week|weekly pipeline)\b/i,
      /\b(pipeline review|pipeline brief)\b/i,
    ],
    cron: '0 8 * * 1',
    label: 'Every Monday at 8 AM',
  },
  // Friday / end of week forecast
  {
    patterns: [
      /\b(friday|end of week|weekly forecast|forecast call|forecast prep)\b/i,
    ],
    cron: '0 16 * * 5',
    label: 'Every Friday at 4 PM',
  },
  // Generic weekly
  {
    patterns: [/\b(weekly|each week|every week|week over week|wow)\b/i],
    cron: '0 8 * * 1',
    label: 'Every Monday at 8 AM',
  },
  // Monthly
  {
    patterns: [/\b(monthly|each month|every month|month over month|mom|end of month)\b/i],
    cron: '0 8 1 * *',
    label: '1st of every month at 8 AM',
  },
  // Quarterly / on-demand
  {
    patterns: [/\b(quarterly|qbr|quarter end|end of quarter|eoq)\b/i],
    cron: '',       // Empty = on demand
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
    .map(m => m.content)
    .join(' ');

  for (const rule of SCHEDULE_RULES) {
    if (rule.patterns.some(p => p.test(userText))) {
      return {
        cron: rule.cron,
        label: rule.label,
        timezone: 'America/New_York',
      };
    }
  }

  return DEFAULT_SCHEDULE;
}
```

---

## Task 4: Delivery Inference (heuristic — no LLM)

```typescript
/**
 * Infer delivery preference from signals in the conversation.
 *
 * Slack is the default — RevOps teams live in Slack.
 * Look for explicit channel mentions (#channel-name) or "email" keywords.
 * If a Slack channel is mentioned, capture it.
 */
export function inferDelivery(messages: ChatMessage[]): DeliverySuggestion {
  const userText = messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join(' ');

  // Explicit Slack channel mention
  const channelMatch = userText.match(/#([a-z0-9_-]+)/i);
  if (channelMatch) {
    return { format: 'slack', channel: `#${channelMatch[1]}` };
  }

  // Email preference
  if (/\b(email|send to|mailto|inbox)\b/i.test(userText)) {
    return { format: 'email' };
  }

  // Default
  return { format: 'slack' };
}
```

---

## Task 5: Name Generation (deterministic)

```typescript
/**
 * Generate an Agent name from goal + schedule.
 * Max 40 characters.
 *
 * Pattern: "{Cadence} {Topic}"
 * Examples:
 *   "Weekly Pipeline Review"
 *   "Monday Forecast Brief"
 *   "Daily Rep Scorecard"
 *   "Monthly ICP Audit"
 */

const CADENCE_LABELS: Record<string, string> = {
  '0 7 * * 1-5': 'Daily',
  '0 8 * * 1':   'Weekly',
  '0 16 * * 5':  'Friday',
  '0 8 1 * *':   'Monthly',
  '':            '',
};

const TOPIC_KEYWORDS: Array<{ patterns: RegExp[]; label: string }> = [
  { patterns: [/pipeline\s+(hygiene|health|review|coverage)/i, /stale\s+deal/i], label: 'Pipeline Review' },
  { patterns: [/forecast/i, /landing\s+zone/i, /commit/i], label: 'Forecast Brief' },
  { patterns: [/rep\s+(scorecard|performance|attainment)/i, /reps.*behind/i], label: 'Rep Scorecard' },
  { patterns: [/data\s+quality/i, /hygiene\s+audit/i], label: 'Data Quality Audit' },
  { patterns: [/icp|ideal\s+customer|win\s+pattern/i], label: 'ICP Audit' },
  { patterns: [/single.thread|multi.thread|contact\s+role/i], label: 'Coverage Alert' },
  { patterns: [/competitive|competitor/i], label: 'Competitive Brief' },
];

export function generateAgentName(
  goal: string,
  schedule: ScheduleSuggestion,
  messages: ChatMessage[]
): string {
  const cadence = CADENCE_LABELS[schedule.cron] ?? 'Weekly';

  // Try to find a topic from the goal text + user messages
  const textToSearch = goal + ' ' + messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join(' ');

  for (const { patterns, label } of TOPIC_KEYWORDS) {
    if (patterns.some(p => p.test(textToSearch))) {
      const name = cadence ? `${cadence} ${label}` : label;
      return name.slice(0, 40);
    }
  }

  // Fallback: cadence + "Business Review"
  const fallback = cadence ? `${cadence} Business Review` : 'GTM Review';
  return fallback.slice(0, 40);
}
```

---

## Task 6: Goal + Standing Questions via DeepSeek

This is the only LLM call in the entire extraction. Keep it tight.

```typescript
/**
 * Send user messages only to DeepSeek.
 * Extract: goal (1 sentence) + standing questions (3–5, recurring framing).
 *
 * Use the existing LLM client pattern from your codebase.
 * Do NOT invent a new calling convention — use whatever callDeepSeek() /
 * llmRouter.call() / equivalent already exists.
 *
 * Target token budget:
 *   Input:  ≤ 800 tokens (user messages, truncated if needed)
 *   Output: ≤ 300 tokens (JSON only)
 *   Total:  ≤ 1,100 tokens per extraction
 */

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
  // Filter to user messages only — assistant messages add noise
  const userMessages = messages.filter(m => m.role === 'user');

  if (userMessages.length === 0) {
    return {
      result: { goal: '', questions: [], confidence: 'low' },
      tokensUsed: 0,
    };
  }

  // Build the user content block — truncate aggressively
  // Target: ≤ 600 tokens input for the messages themselves
  // Rough heuristic: 4 chars per token → 2,400 chars max
  const MAX_CHARS = 2400;
  let userContent = userMessages
    .map((m, i) => `[${i + 1}] ${m.content.trim()}`)
    .join('\n\n');

  if (userContent.length > MAX_CHARS) {
    // Keep first 3 messages + last 3 messages (beginning and end are highest signal)
    const first3 = userMessages.slice(0, 3);
    const last3  = userMessages.slice(-3);
    const combined = [...first3, ...last3]
      .filter((m, i, arr) => arr.findIndex(x => x === m) === i); // dedupe
    userContent = combined
      .map((m, i) => `[${i + 1}] ${m.content.trim()}`)
      .join('\n\n')
      .slice(0, MAX_CHARS);
  }

  // ── LLM CALL ──────────────────────────────────────────────────────────────
  // Use your existing DeepSeek/LLM client. Pattern from your codebase:
  //   const response = await callDeepSeek({ system: ..., userMessage: ... })
  // OR:
  //   const response = await llmRouter.call(workspaceId, 'classify', { messages: [...] })
  //
  // Adapt to whatever pattern actually exists in your codebase.
  // The key constraint: response must be parseable JSON.

  const llmResponse = await callLLM({
    workspaceId,
    capability: 'classify',          // DeepSeek handles classify capability
    system: EXTRACTION_SYSTEM_PROMPT,
    userMessage: `Analyst conversation messages:\n\n${userContent}`,
    maxTokens: 300,
    expectJson: true,
  });

  // ── PARSE ─────────────────────────────────────────────────────────────────
  let parsed: DeepSeekExtractionOutput;
  try {
    // Strip any accidental markdown fences
    const clean = llmResponse.content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    parsed = JSON.parse(clean);
  } catch {
    // Graceful degradation — return empty result, don't throw
    parsed = { goal: '', questions: [], confidence: 'low' };
  }

  // ── VALIDATE + SANITIZE ───────────────────────────────────────────────────
  const goal = (parsed.goal ?? '').slice(0, 200).trim();

  const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .map(q => q.slice(0, 120).trim())
    .slice(0, 5);   // Hard cap at 5

  const confidence = (['high', 'medium', 'low'] as const).includes(parsed.confidence as any)
    ? (parsed.confidence as 'high' | 'medium' | 'low')
    : 'low';

  return {
    result: { goal, questions, confidence },
    tokensUsed: llmResponse.usage?.input + llmResponse.usage?.output ?? 0,
  };
}
```

---

## Task 7: Confidence Override Logic

DeepSeek returns a confidence signal, but override it based on structural signals
that DeepSeek can't see:

```typescript
export function computeFinalConfidence(
  deepseekConfidence: 'high' | 'medium' | 'low',
  userMessageCount: number,
  detectedSkills: string[],
  goal: string,
  questions: string[]
): 'high' | 'medium' | 'low' {
  // Hard downgrades — never return high/medium if these fail
  if (userMessageCount < 3)       return 'low';
  if (detectedSkills.length === 0) return 'low';
  if (!goal || goal.length < 20)  return 'low';
  if (questions.length < 2)       return 'low';

  // Upgrade medium → high if structural signals are strong
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
```

---

## Task 8: Main Orchestrator Function

```typescript
export async function extractAgentFromConversation(
  input: ExtractionInput
): Promise<ConversationExtractionResult> {
  const { messages, workspace_id, conversation_id } = input;

  // Step 1: Skill detection (deterministic, ~0ms)
  const detectedSkills = detectInvokedSkills(messages);

  // Step 2: Schedule inference (heuristic, ~0ms)
  const suggestedSchedule = inferSchedule(messages);

  // Step 3: Delivery inference (heuristic, ~0ms)
  const suggestedDelivery = inferDelivery(messages);

  // Step 4: Goal + questions via DeepSeek (~500–1500ms)
  const userMessageCount = messages.filter(m => m.role === 'user').length;
  const { result: extracted, tokensUsed } = await extractGoalAndQuestions(
    messages,
    workspace_id
  );

  // Step 5: Confidence
  const confidence = computeFinalConfidence(
    extracted.confidence,
    userMessageCount,
    detectedSkills,
    extracted.goal,
    extracted.questions
  );

  // Step 6: Name generation (deterministic, ~0ms)
  const suggestedName = generateAgentName(
    extracted.goal,
    suggestedSchedule,
    messages
  );

  return {
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
}
```

---

## Task 9: Endpoint

Add to the appropriate chat routes file (wherever `POST /api/workspaces/:id/chat/...`
routes live — find it, don't create a new routes file unless none exists).

```typescript
/**
 * POST /api/workspaces/:workspaceId/chat/extract-agent
 *
 * Runs extraction on an existing chat session.
 * Returns pre-filled modal data. Does NOT create an Agent.
 *
 * Body: { conversation_id: string }
 *
 * Auth: same middleware as existing chat routes (workspace membership check).
 */
router.post(
  '/:workspaceId/chat/extract-agent',
  requireWorkspaceAccess,   // use existing auth middleware — check what it's called
  async (req, res) => {
    const { workspaceId } = req.params;
    const { conversation_id } = req.body;

    if (!conversation_id) {
      return res.status(400).json({ error: 'conversation_id required' });
    }

    // ── Load messages ──────────────────────────────────────────────────────
    // Use existing DB query pattern. Adapt table/column names to match your schema.
    // The goal is to load all messages for this conversation_id in order.
    //
    // Example (adapt to your actual schema):
    //   const messages = await db
    //     .select()
    //     .from(chatMessages)
    //     .where(eq(chatMessages.conversation_id, conversation_id))
    //     .orderBy(chatMessages.created_at);
    //
    // If the conversation doesn't belong to this workspace, return 404.

    let messages: ChatMessage[];
    try {
      messages = await loadChatMessages(workspaceId, conversation_id);
    } catch (err: any) {
      if (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN') {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      throw err;
    }

    if (messages.length < 2) {
      return res.status(400).json({
        error: 'Conversation too short to extract an Agent',
        confidence: 'low',
      });
    }

    // ── Run extraction ─────────────────────────────────────────────────────
    const result = await extractAgentFromConversation({
      messages,
      workspace_id: workspaceId,
      conversation_id,
    });

    // ── Log extraction (do not return _internal fields to client) ──────────
    console.log('[extract-agent]', {
      workspace_id: workspaceId,
      conversation_id,
      confidence: result.confidence,
      skills: result.detected_skills,
      tokens: result._deepseek_tokens_used,
      reasoning: result._reasoning,
    });

    // ── Return (strip internal fields) ────────────────────────────────────
    const { _reasoning, _user_message_count, _deepseek_tokens_used, ...publicResult } = result;
    return res.json(publicResult);
  }
);
```

---

## Task 10: Helper — loadChatMessages

Write a `loadChatMessages(workspaceId, conversationId)` helper in the same file
or in a shared chat service file if one exists.

```typescript
/**
 * Load all messages for a chat session.
 * Enforces workspace ownership — throws if conversation belongs to a different workspace.
 *
 * IMPORTANT: Scan the actual DB schema before writing this.
 * Find the chat session/message table(s) and use their real column names.
 * Do not assume the column names below are correct — verify first.
 */
async function loadChatMessages(
  workspaceId: string,
  conversationId: string
): Promise<ChatMessage[]> {
  // 1. Verify the conversation belongs to this workspace
  //    Find the chat sessions table — it may be called chat_sessions, chat_conversations,
  //    conversations (check if this conflicts with the Gong/Fireflies conversations table),
  //    or something else. Scan migrations to find it.

  // 2. Load messages ordered by created_at ascending

  // 3. Map to ChatMessage shape, populating skill_id from metadata if needed

  // 4. Return messages
}
```

---

## Task 11: Unit Tests

Create `server/chat/conversation-extractor.test.ts`.

Test these cases without hitting DeepSeek (mock the LLM call):

```typescript
describe('detectInvokedSkills', () => {
  it('deduplicates repeated skill invocations', () => {
    const messages = [
      { role: 'tool', content: '', skill_id: 'pipeline-hygiene' },
      { role: 'tool', content: '', skill_id: 'pipeline-hygiene' },  // duplicate
      { role: 'tool', content: '', skill_id: 'forecast-rollup' },
    ];
    expect(detectInvokedSkills(messages)).toEqual(['pipeline-hygiene', 'forecast-rollup']);
  });

  it('returns empty array when no skills invoked', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    expect(detectInvokedSkills(messages)).toEqual([]);
  });
});

describe('inferSchedule', () => {
  it('returns Monday 8 AM for weekly pipeline language', () => {
    const msgs = [{ role: 'user', content: 'I want a weekly pipeline review' }];
    const result = inferSchedule(msgs as any);
    expect(result.cron).toBe('0 8 * * 1');
  });

  it('returns Friday 4 PM for forecast call language', () => {
    const msgs = [{ role: 'user', content: 'help me prep for my friday forecast call' }];
    const result = inferSchedule(msgs as any);
    expect(result.cron).toBe('0 16 * * 5');
  });

  it('defaults to Monday 8 AM when no signal found', () => {
    const msgs = [{ role: 'user', content: 'show me my pipeline' }];
    const result = inferSchedule(msgs as any);
    expect(result.cron).toBe('0 8 * * 1');
  });
});

describe('computeFinalConfidence', () => {
  it('returns low when no skills detected', () => {
    expect(computeFinalConfidence('high', 10, [], 'good goal text here', ['q1', 'q2'])).toBe('low');
  });

  it('returns low when conversation too short', () => {
    expect(computeFinalConfidence('high', 2, ['pipeline-hygiene'], 'good goal', ['q1', 'q2'])).toBe('low');
  });

  it('upgrades medium → high when structural signals are strong', () => {
    expect(computeFinalConfidence('medium', 8, ['pipeline-hygiene', 'forecast-rollup'], 'ensure pipeline health and forecast accuracy', ['q1', 'q2', 'q3'])).toBe('high');
  });
});

describe('generateAgentName', () => {
  it('generates a forecast name for forecast-related conversations', () => {
    const schedule = { cron: '0 16 * * 5', label: 'Every Friday at 4 PM', timezone: 'America/New_York' };
    const msgs = [{ role: 'user', content: 'I want to review my forecast commit' }];
    const name = generateAgentName('keep forecast accurate', schedule, msgs as any);
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name).toContain('Forecast');
  });
});
```

---

## Validation Checklist

After building, verify:

1. **`POST /api/workspaces/:id/chat/extract-agent`** returns 200 with all fields
   when given a valid conversation_id with 5+ messages and at least one skill
   invocation.

2. **Short conversation** (< 3 user messages) returns 400 with a clear error.

3. **Wrong workspace** (conversation belongs to workspace B, request for workspace A)
   returns 404.

4. **`detected_skills` is always deterministic** — run extract twice on the same
   conversation, skills array is identical.

5. **`_reasoning` fields are NOT present** in the API response (stripped before returning).

6. **DeepSeek JSON parse failure** does not throw — returns `confidence: 'low'`
   with empty `goal` and `questions`.

7. **Token usage** is logged server-side on every extraction call.

8. **Unit tests pass** without network calls (LLM call is mocked).

---

## What NOT to Build

- **Do NOT create the Agent** — this endpoint returns modal data only. Agent creation
  is a separate `POST /agents-v2` call the frontend makes after the user confirms.

- **Do NOT modify `orchestrator.ts`** — the extraction engine is a new capability,
  not a change to the existing chat flow.

- **Do NOT add a conversations table** — use whatever chat session table already
  exists. If none exists, return an error and document the gap in a TODO.

- **Do NOT add streaming** — this is a one-shot synchronous call. Latency target
  is < 3 seconds total.

- **Do NOT exceed 1,100 DeepSeek tokens per extraction** — if input truncation
  isn't working, fix it before loosening the budget.

---

## Token Budget

| Step | LLM | Tokens |
|------|-----|--------|
| detectInvokedSkills | none | 0 |
| inferSchedule | none | 0 |
| inferDelivery | none | 0 |
| generateAgentName | none | 0 |
| extractGoalAndQuestions | DeepSeek | ≤ 800 in / ≤ 300 out |
| **Total per extraction** | | **≤ 1,100 tokens (~$0.001)** |

---

## File Summary

| File | Action |
|------|--------|
| `server/chat/conversation-extractor.ts` | CREATE — all extraction logic |
| `server/chat/conversation-extractor.test.ts` | CREATE — unit tests |
| `server/routes/chat.ts` (or equivalent) | MODIFY — add extract-agent endpoint |
