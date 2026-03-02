# Claude Code Prompt: Chat Feedback Loop & Phase 1 Self-Heal

## Context

Pandora currently learns about workspaces during onboarding config (inference engine, Prompt 2) and through skill feedback signals (Prompt 3). But the conversational interface — where users ask questions and get answers every day — generates zero learning signal. When a user gets a bad answer and asks again, or gives a thumbs-down, that information vanishes.

This prompt builds the feedback capture and Phase 1 self-healing pipeline:

1. **T005: Chat feedback endpoint** — thumbs up/down on chat responses
2. **T006: Repeated-question detection** — silent telemetry when users re-ask
3. **T007: Self-heal reviewer** — LLM analyzes feedback patterns and proposes fixes
4. **T008: Integration test** — validate the full loop end-to-end

**Philosophy:** Pandora doesn't just answer questions — it learns which answers failed and proposes its own improvements. Phase 1 writes suggestions for human review. Phase 2 (future) auto-applies high-confidence fixes.

**The self-heal output types map to existing Pandora primitives:**
- **Resolver pattern fix** → a new regex + response shape in the chat heuristic router
- **Workspace context addition** → a fact to inject into the system prompt via context_layer
- **Named filter definition** → a pre-computed deal/rep/segment filter for faster future queries

---

## Before You Start

**Read these files first to understand the existing architecture:**

1. `server/routes/chat.ts` — Current chat API routes. You're adding a feedback POST endpoint here.
2. `server/chat/orchestrator.ts` — The main conversation handler. You're adding repeated-question detection before dispatch.
3. `server/chat/feedback-processor.ts` — If this exists, read it. You'll call `processFeedback()` from it. If it doesn't exist, you'll create it.
4. `server/db/migrations/` — Find the latest migration number. Check if `agent_feedback` table already exists.
5. `server/routes/agent-feedback.ts` — If this exists, you're adding the self-heal review endpoint here. If not, create it.
6. `shared/schema.ts` or the migrations folder — Find the `chat_messages` table schema. You need to understand what columns exist (workspace_id, role, content, created_at, session/thread identifiers).
7. `docs/AGENT_CURRENT_STATE.md` — Reference for what exists today.

**Check these tables exist before writing migrations:**
- `agent_feedback` — May already exist from the Operator Model or Agent Builder work. If so, verify it has: workspace_id, agent_id, generation_id, feedback_type, signal, rating, comment, tuning_key columns.
- `chat_messages` — Must exist (the chat system writes to it). Verify columns: workspace_id, role, content, created_at, plus any session/thread/channel identifier.

---

## Task 1: Ensure Schema (Migration if needed)

Check if `agent_feedback` table exists. If it does, verify the columns below are present. If not, create it.

### agent_feedback table

```sql
CREATE TABLE IF NOT EXISTS agent_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,                    -- 'pandora_chat' for conversational feedback
  generation_id TEXT,                        -- response_id from the chat response
  feedback_type TEXT NOT NULL DEFAULT 'overall',  -- 'overall', 'accuracy', 'relevance', 'completeness'
  signal TEXT NOT NULL,                      -- 'thumbs_up', 'thumbs_down', 'repeated_question'
  rating INTEGER,                            -- 1-5 numeric (thumbs_up=5, thumbs_down=1)
  comment TEXT,                              -- optional user comment or system-generated note
  tuning_key TEXT,                           -- null for raw feedback, 'self_heal_suggestion' for LLM suggestions
  metadata JSONB DEFAULT '{}',               -- extensible: original_question, router_decision, etc.
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_feedback_workspace 
  ON agent_feedback(workspace_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_signal 
  ON agent_feedback(workspace_id, signal);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_tuning 
  ON agent_feedback(workspace_id, tuning_key) WHERE tuning_key IS NOT NULL;
```

If the table exists but is missing `tuning_key` or `metadata`, add them:

```sql
ALTER TABLE agent_feedback ADD COLUMN IF NOT EXISTS tuning_key TEXT;
ALTER TABLE agent_feedback ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
```

---

## Task 2: T005 — Chat Feedback Endpoint

**File:** `server/routes/chat.ts`

Add `POST /:workspaceId/chat/feedback`

### Request Body

```typescript
interface ChatFeedbackRequest {
  response_id: string;       // The response_id returned with the chat response
  signal: 'thumbs_up' | 'thumbs_down';
  comment?: string;          // Optional user-typed feedback
}
```

### Implementation

```typescript
// POST /:workspaceId/chat/feedback
router.post('/:workspaceId/chat/feedback', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { response_id, signal, comment } = req.body;

    // Validate
    if (!response_id || !['thumbs_up', 'thumbs_down'].includes(signal)) {
      return res.status(400).json({ error: 'response_id and valid signal required' });
    }

    // Insert into agent_feedback
    const result = await query(
      `INSERT INTO agent_feedback (workspace_id, agent_id, generation_id, feedback_type, signal, rating, comment, metadata)
       VALUES ($1, 'pandora_chat', $2, 'overall', $3, $4, $5, $6)
       RETURNING id`,
      [
        workspaceId,
        response_id,
        signal,
        signal === 'thumbs_up' ? 5 : 1,
        comment || null,
        JSON.stringify({
          source: 'chat_ui',
          timestamp: new Date().toISOString(),
        }),
      ]
    );

    const feedbackId = result.rows[0].id;

    // Call existing feedback processor if it exists
    // This is a fire-and-forget — don't block the response
    try {
      const { processFeedback } = await import('../chat/feedback-processor');
      await processFeedback({
        id: feedbackId,
        workspace_id: workspaceId,
        agent_id: 'pandora_chat',
        generation_id: response_id,
        feedback_type: 'overall',
        signal,
        rating: signal === 'thumbs_up' ? 5 : 1,
        comment: comment || null,
      });
    } catch (e) {
      // feedback-processor may not exist yet — that's fine
      console.log('[Feedback] processFeedback not available or errored:', e.message);
    }

    return res.json({ ok: true, feedback_id: feedbackId });
  } catch (error) {
    console.error('[Feedback] Error saving feedback:', error);
    return res.status(500).json({ error: 'Failed to save feedback' });
  }
});
```

### Ensure response_id is returned from chat responses

Check the main chat handler in `server/routes/chat.ts` or `server/chat/orchestrator.ts`. The response object returned to the client MUST include `response_id` and `feedback_enabled: true`. If it doesn't already, add:

```typescript
// In the chat response object (wherever the orchestrator returns its answer):
return {
  answer: synthesizedAnswer,
  thread_id: threadId,
  // ... existing fields ...
  response_id: responseId,        // UUID generated for this response
  feedback_enabled: true,         // Tells the UI to show thumbs up/down
};
```

If `response_id` is not already generated, add `const responseId = randomUUID();` at the top of the handler and include it in the response. Also store it in the `chat_messages` row for the assistant message if possible (add a `response_id` column to `chat_messages` if it doesn't exist).

**Acceptance:** POST with `{ response_id, signal: 'thumbs_down' }` creates a row in `agent_feedback` with `agent_id='pandora_chat'`, `signal='thumbs_down'`, `rating=1`.

---

## Task 3: T006 — Repeated-Question Detection

**File:** `server/routes/chat.ts` (in the main conversation stream handler, before dispatching to the orchestrator)

### Logic

After receiving the user message, BEFORE routing to the orchestrator, check if this exact question was asked before in this workspace within the last 7 days.

```typescript
// In the main POST handler for chat messages, after extracting the message content
// but BEFORE calling the orchestrator:

async function checkForRepeatedQuestion(
  workspaceId: string,
  message: string,
  currentSessionId?: string
): Promise<void> {
  try {
    // Find previous identical question (case-insensitive)
    const previousQuestion = await query(
      `SELECT id, created_at FROM chat_messages
       WHERE workspace_id = $1 AND role = 'user'
         AND created_at > NOW() - INTERVAL '7 days'
         AND LOWER(TRIM(content)) = LOWER(TRIM($2))
       ORDER BY created_at DESC
       LIMIT 1`,
      [workspaceId, message]
    );

    if (previousQuestion.rows.length === 0) return; // Not a repeat

    const prevMessageId = previousQuestion.rows[0].id;
    const prevTimestamp = previousQuestion.rows[0].created_at;

    // Don't flag if the previous question was asked in this same session
    // (user might just be starting a new conversation)
    // Only flag if at least 1 minute has passed (avoid double-submit detection)
    const timeDiffMs = Date.now() - new Date(prevTimestamp).getTime();
    if (timeDiffMs < 60_000) return; // Within 1 minute — likely double-submit, not dissatisfaction

    // Find the assistant response that followed the previous question
    const prevResponse = await query(
      `SELECT id, response_id FROM chat_messages
       WHERE workspace_id = $1 AND role = 'assistant'
         AND created_at > $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [workspaceId, prevTimestamp]
    );

    const prevResponseId = prevResponse.rows[0]?.response_id || prevResponse.rows[0]?.id || 'unknown';

    // Insert silent negative signal
    await query(
      `INSERT INTO agent_feedback (workspace_id, agent_id, generation_id, feedback_type, signal, rating, comment, metadata)
       VALUES ($1, 'pandora_chat', $2, 'overall', 'repeated_question', 2, $3, $4)`,
      [
        workspaceId,
        prevResponseId,
        'User repeated this question — previous answer was likely unsatisfactory',
        JSON.stringify({
          source: 'auto_detection',
          original_question: message,
          previous_message_id: prevMessageId,
          time_between_asks_minutes: Math.round(timeDiffMs / 60_000),
        }),
      ]
    );

    console.log(`[Feedback] Repeated question detected in workspace ${workspaceId}: "${message.substring(0, 60)}..."`);
  } catch (error) {
    // Silent — never block the user's question
    console.error('[Feedback] Repeated question check failed:', error);
  }
}
```

### Wire it in

In the main chat POST handler, call this BEFORE dispatching:

```typescript
// Early in the POST /:workspaceId/chat handler, after extracting message:
await checkForRepeatedQuestion(workspaceId, message, sessionId);

// Then continue with normal orchestrator dispatch...
```

**Critical:** This is SILENT TELEMETRY. It does NOT alter the response, block the question, or tell the user anything. It only writes to `agent_feedback`.

**Acceptance:** Asking "What's my pipeline coverage?" twice (with >1 minute gap) results in a `repeated_question` entry in `agent_feedback` with the response_id of the FIRST answer.

---

## Task 4: T007 — Phase 1 Self-Heal — LLM Feedback Reviewer

**File:** `server/routes/agent-feedback.ts` (create if it doesn't exist)

This is the intelligence layer. It reads accumulated feedback, finds patterns, and proposes concrete fixes using Pandora's own primitives.

### Route

```typescript
// POST /:workspaceId/agents/pandora_chat/feedback/review
```

### Implementation

```typescript
router.post('/:workspaceId/agents/pandora_chat/feedback/review', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    // 1. Read last 30 days of feedback for pandora_chat
    const feedback = await query(
      `SELECT signal, rating, comment, generation_id, metadata, created_at
       FROM agent_feedback
       WHERE workspace_id = $1 AND agent_id = 'pandora_chat'
         AND created_at > NOW() - INTERVAL '30 days'
         AND tuning_key IS NULL
       ORDER BY created_at DESC
       LIMIT 200`,
      [workspaceId]
    );

    if (feedback.rows.length === 0) {
      return res.json({ suggestions: [], message: 'No feedback to review' });
    }

    // 2. Group feedback into analyzable patterns
    const patterns = analyzeFeedbackPatterns(feedback.rows);

    // 3. Send to Claude for analysis
    const suggestions = await generateSelfHealSuggestions(workspaceId, patterns);

    // 4. Store suggestions in agent_feedback with tuning_key
    for (const suggestion of suggestions) {
      await query(
        `INSERT INTO agent_feedback (workspace_id, agent_id, feedback_type, signal, rating, comment, tuning_key, metadata)
         VALUES ($1, 'pandora_chat', 'self_heal', 'suggestion', 0, $2, 'self_heal_suggestion', $3)`,
        [
          workspaceId,
          JSON.stringify(suggestion),
          JSON.stringify({
            source: 'self_heal_review',
            feedback_count: feedback.rows.length,
            review_timestamp: new Date().toISOString(),
          }),
        ]
      );
    }

    return res.json({
      suggestions,
      feedback_analyzed: feedback.rows.length,
      patterns_found: patterns.length,
    });
  } catch (error) {
    console.error('[SelfHeal] Review failed:', error);
    return res.status(500).json({ error: 'Self-heal review failed' });
  }
});
```

### Pattern Analyzer

```typescript
interface FeedbackPattern {
  type: 'thumbs_down_cluster' | 'repeated_question' | 'commented_complaint';
  question?: string;           // The question that triggered the feedback
  count: number;
  examples: Array<{
    signal: string;
    comment?: string;
    metadata?: any;
    created_at: string;
  }>;
}

function analyzeFeedbackPatterns(rows: any[]): FeedbackPattern[] {
  const patterns: FeedbackPattern[] = [];

  // Group repeated questions
  const repeats = rows.filter(r => r.signal === 'repeated_question');
  const repeatsByQuestion: Record<string, any[]> = {};
  for (const r of repeats) {
    const q = r.metadata?.original_question?.toLowerCase()?.trim() || 'unknown';
    if (!repeatsByQuestion[q]) repeatsByQuestion[q] = [];
    repeatsByQuestion[q].push(r);
  }
  for (const [question, entries] of Object.entries(repeatsByQuestion)) {
    if (entries.length >= 1) {
      patterns.push({
        type: 'repeated_question',
        question,
        count: entries.length,
        examples: entries.slice(0, 3),
      });
    }
  }

  // Group thumbs-down
  const thumbsDown = rows.filter(r => r.signal === 'thumbs_down');
  if (thumbsDown.length > 0) {
    patterns.push({
      type: 'thumbs_down_cluster',
      count: thumbsDown.length,
      examples: thumbsDown.slice(0, 5),
    });
  }

  // Extract thumbs-down with comments (most informative)
  const withComments = thumbsDown.filter(r => r.comment && r.comment.length > 5);
  if (withComments.length > 0) {
    patterns.push({
      type: 'commented_complaint',
      count: withComments.length,
      examples: withComments.slice(0, 5),
    });
  }

  return patterns;
}
```

### LLM Suggestion Generator

```typescript
interface SelfHealSuggestion {
  type: 'resolver_pattern' | 'workspace_context' | 'named_filter';
  description: string;
  implementation_hint: string;
  confidence: number;           // 0-1
  source_pattern: string;       // Which feedback pattern triggered this
}

async function generateSelfHealSuggestions(
  workspaceId: string,
  patterns: FeedbackPattern[]
): Promise<SelfHealSuggestion[]> {
  if (patterns.length === 0) return [];

  // Use the workspace's LLM router if available, otherwise direct Claude call
  const prompt = `You are reviewing user feedback for Pandora, a RevOps intelligence assistant.
This workspace has accumulated feedback patterns that suggest the assistant's answers need improvement.

Here are the patterns detected:

${patterns.map((p, i) => `
### Pattern ${i + 1}: ${p.type}
${p.question ? `Question: "${p.question}"` : ''}
Count: ${p.count} occurrences
Examples:
${p.examples.map(e => `  - Signal: ${e.signal}${e.comment ? `, Comment: "${e.comment}"` : ''}${e.metadata?.original_question ? `, Question: "${e.metadata.original_question}"` : ''}`).join('\n')}
`).join('\n')}

For each pattern, suggest ONE of the following fix types:

1. **resolver_pattern** — A new regex pattern + response template for the chat router to handle this question type directly without LLM calls. Best for: factual questions with deterministic answers, common status checks, frequently asked data lookups.

2. **workspace_context** — A fact or rule to add to the workspace's system context so the LLM has better information next time. Best for: questions where the LLM gave a wrong answer because it lacked workspace-specific knowledge (team structure, process, terminology, business rules).

3. **named_filter** — A pre-computed deal/rep/segment filter that speeds up common queries. Best for: questions that always scope to the same subset of data ("my enterprise deals", "Sara's pipeline", "deals closing this quarter").

Output as JSON only (no markdown, no backticks):
{
  "suggestions": [
    {
      "type": "resolver_pattern | workspace_context | named_filter",
      "description": "Human-readable description of what this fixes",
      "implementation_hint": "Specific implementation details — regex pattern, context fact text, or filter definition",
      "confidence": 0.0-1.0,
      "source_pattern": "Which pattern this addresses"
    }
  ]
}

Rules:
- Only suggest fixes you're confident about (>0.5 confidence)
- Be specific in implementation_hint — vague suggestions are useless
- Maximum 5 suggestions
- If a pattern doesn't clearly map to a fix, skip it
- Prefer workspace_context for most issues — it's the safest fix type`;

  try {
    // Use the LLM router if available
    let response: string;
    try {
      const { llmRouter } = await import('../llm/router');
      const result = await llmRouter.call({
        workspaceId,
        capability: 'reason',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2000,
      });
      response = result.content;
    } catch {
      // Fallback: direct Anthropic call
      const { callClaude } = await import('../llm/anthropic');
      response = await callClaude(prompt, { maxTokens: 2000 });
    }

    // Parse the response
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed.suggestions || [];
  } catch (error) {
    console.error('[SelfHeal] LLM suggestion generation failed:', error);
    return [];
  }
}
```

### Wire the routes

Register the feedback routes in `server/index.ts` (or wherever routes are registered):

```typescript
import agentFeedbackRoutes from './routes/agent-feedback';
app.use('/api/workspaces', agentFeedbackRoutes);
```

**Acceptance:** POST to `/review` endpoint returns structured suggestions based on real feedback patterns. Suggestions are stored in `agent_feedback` with `tuning_key = 'self_heal_suggestion'`.

---

## Task 5: T008 — Restart and Integration Test

### 5A: Restart

Restart the Pandora API workflow to pick up all changes.

### 5B: Test the 3 existing bug fixes (from prior tasks)

These are regression tests — verify the fixes from the earlier part of this session still work:

```bash
# Test 1: "Which deals need to close to hit target" → Core Sales scoped attainment
curl -X POST http://localhost:3000/api/workspaces/{WORKSPACE_ID}/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Which deals need to close to hit target?"}'
# Expected: Should return Core Sales scoped attainment, not all pipelines

# Test 2: "Does Sara have any closed won deals?" → LLM investigation, not pipeline card
curl -X POST http://localhost:3000/api/workspaces/{WORKSPACE_ID}/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Does Sara have any closed won deals?"}'
# Expected: Should route to LLM investigation path, not return a pipeline card

# Test 3: "Top 5 deals" cold (no brief ready) → live DB fallback
curl -X POST http://localhost:3000/api/workspaces/{WORKSPACE_ID}/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Top 5 deals"}'
# Expected: Should fall back to live DB query, not error or return empty
```

### 5C: Test feedback endpoint

```bash
# Get a response_id from a chat interaction first
RESPONSE_ID=$(curl -s -X POST http://localhost:3000/api/workspaces/{WORKSPACE_ID}/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "How many open deals do we have?"}' | jq -r '.response_id')

# Submit thumbs down
curl -X POST http://localhost:3000/api/workspaces/{WORKSPACE_ID}/chat/feedback \
  -H 'Content-Type: application/json' \
  -d "{\"response_id\": \"$RESPONSE_ID\", \"signal\": \"thumbs_down\", \"comment\": \"Number seemed wrong\"}"
# Expected: { ok: true, feedback_id: "..." }

# Verify in database
psql -c "SELECT id, signal, rating, comment FROM agent_feedback WHERE workspace_id = '{WORKSPACE_ID}' AND agent_id = 'pandora_chat' ORDER BY created_at DESC LIMIT 5;"
```

### 5D: Test repeated question detection

```bash
# Ask a question
curl -X POST http://localhost:3000/api/workspaces/{WORKSPACE_ID}/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "What is our pipeline coverage?"}'

# Wait 2 minutes, then ask the EXACT same question
sleep 120

curl -X POST http://localhost:3000/api/workspaces/{WORKSPACE_ID}/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "What is our pipeline coverage?"}'

# Verify repeated_question signal was recorded
psql -c "SELECT id, signal, comment, metadata FROM agent_feedback WHERE workspace_id = '{WORKSPACE_ID}' AND signal = 'repeated_question' ORDER BY created_at DESC LIMIT 3;"
```

### 5E: Test self-heal endpoint

```bash
# Requires some feedback to exist (run 5C and 5D first)
curl -X POST http://localhost:3000/api/workspaces/{WORKSPACE_ID}/agents/pandora_chat/feedback/review \
  -H 'Content-Type: application/json'
# Expected: { suggestions: [...], feedback_analyzed: N, patterns_found: N }

# Verify suggestions stored
psql -c "SELECT comment, metadata FROM agent_feedback WHERE workspace_id = '{WORKSPACE_ID}' AND tuning_key = 'self_heal_suggestion' ORDER BY created_at DESC LIMIT 3;"
```

### 5F: Screenshot

Take a screenshot of:
1. The `agent_feedback` table showing thumbs_down, repeated_question, and self_heal_suggestion rows
2. The self-heal endpoint response JSON showing structured suggestions
3. The chat UI showing feedback buttons (thumbs up/down) on chat bubbles — if the UI already renders them

---

## What This Does NOT Change

- The existing chat orchestrator routing logic (heuristic → LLM → scoped analysis)
- The existing skill execution pipeline
- The workspace config or config loader
- The agent runtime or agent seed data
- The Slack delivery system
- Any existing resolver patterns or intent classification

---

## Summary of New/Modified Files

| File | Status | Purpose |
|---|---|---|
| `server/db/migrations/XXX_chat_feedback.sql` | NEW (if agent_feedback doesn't exist) | Schema for feedback table |
| `server/routes/chat.ts` | MODIFIED | Add POST feedback endpoint + repeated-question check |
| `server/routes/agent-feedback.ts` | NEW or MODIFIED | Self-heal review endpoint |
| `server/chat/feedback-analyzer.ts` | NEW | Pattern analysis + LLM suggestion generation |

## Future: Phase 2 Self-Heal (NOT this prompt)

Phase 2 will auto-apply high-confidence suggestions:
- `resolver_pattern` suggestions → auto-register in the heuristic router
- `workspace_context` suggestions → auto-inject into context_layer
- `named_filter` suggestions → auto-create in workspace config
- Requires confidence > 0.8 AND at least 3 supporting feedback signals
- Auto-applied fixes get a 7-day trial period with automatic rollback if feedback worsens

Phase 3 will close the loop fully:
- Self-heal writes its own skills (new compute → classify → synthesize definitions)
- Self-heal authors agent playbooks from observed patterns
- The workspace effectively programs itself from user behavior
