# Conversational Agent — Implementation Verification

## Context

You just built the conversational agent (chat backend + Slack thread replies + in-app sidebar). Before moving on, I need to verify that the implementation matches the architectural requirements. This is not a rebuild — it's an audit with targeted fixes.

Run through each section below. For each check, report what you find and fix anything that's missing. If something is intentionally different from the spec, explain why.

---

## Check 1: Database Schema

Show me the exact schema for all conversation-related tables. Run:

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('conversations', 'conversation_state', 'thread_anchors', 'chat_messages', 'chat_threads', 'chat_sessions')
ORDER BY table_name, ordinal_position;
```

### What I expect to see:

**A conversations/messages table (append-only log):**
- workspace_id, thread_id, role (user/assistant), content, timestamp
- entities_mentioned (JSONB — deals, accounts, reps referenced)
- skill_run_ids (which skill runs were referenced in the response)
- token_cost (tokens consumed for this turn)
- router_decision (what the router classified this as)
- data_strategy (how data was fetched — use_anchor, run_query, cross_skill, etc.)

**A conversation_state table (compact structured state per thread):**
- thread_id (unique per conversation thread)
- state (JSONB) containing at minimum:
  - focus: { type: 'workspace' | 'deal' | 'account' | 'rep', entity_id?, entity_name? }
  - period: string (e.g., "Q1 2026")
  - entities_discussed: array
  - questions_resolved: array
  - open_thread: string (current topic)
  - data_already_surfaced: array (skill run IDs already shown)
- turn_count
- total_token_cost
- updated_at, expires_at (24-hour TTL)

**A thread_anchors table (links Slack posts to skill runs):**
- workspace_id
- slack_channel_id, slack_message_ts (the Slack message Pandora posted)
- skill_run_id and/or agent_run_id (what produced this message)
- report_type (pipeline_hygiene, single_thread_alert, etc.)
- created_at

### If thread_anchors doesn't exist:

This is critical for Slack thread replies. Without it, when someone replies to a Monday pipeline report, the system can't know which skill run produced that message and has to do a full workspace scan instead of scoped evidence lookup. Build it:

```sql
CREATE TABLE IF NOT EXISTS thread_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  surface TEXT NOT NULL DEFAULT 'slack',
  channel_id TEXT,
  message_ts TEXT,
  skill_run_id UUID,
  agent_run_id UUID,
  report_type TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, message_ts)
);

CREATE INDEX idx_thread_anchors_lookup ON thread_anchors(channel_id, message_ts);
CREATE INDEX idx_thread_anchors_workspace ON thread_anchors(workspace_id, created_at DESC);
```

Then wire it: everywhere Pandora posts a Slack message after a skill run, record the anchor:

```typescript
// After posting skill result to Slack:
await db.query(`
  INSERT INTO thread_anchors (workspace_id, channel_id, message_ts, skill_run_id, report_type)
  VALUES ($1, $2, $3, $4, $5)
`, [workspaceId, channel, result.ts, skillRunId, skillId]);
```

### If conversation_state is missing or just stores raw messages:

The structured state is what keeps token cost constant. Without it, turn 15 of a conversation sends all 14 prior messages to Claude (~7K tokens of conversation history alone). With it, you send ~300 tokens of structured state + last 2-3 raw messages. Build the state extraction — see Check 4.

---

## Check 2: Router — Does It Actually Save Tokens?

Show me the router/classification code. I need to see the actual decision logic.

### What I expect:

**Tier 1: Heuristic (zero tokens, handles 30-40% of turns):**

Pattern matching that catches common questions without any LLM call:

```typescript
// These patterns should route to direct SQL — no DeepSeek, no Claude:
"how many stale deals" → query findings WHERE category = 'stale_deal', return count
"what's my pipeline" → query pipeline/snapshot, return summary
"show me [rep]'s deals" → query deals WHERE owner = rep, return list
"how many findings" → query findings/summary, return counts
"what's our win rate" → query from skill evidence, return number
```

**Tier 2: DeepSeek classification (~500 tokens, handles remaining 60%):**

Only fires when heuristics don't match. Classifies into:
- evidence_inquiry → Layer 1 SQL lookup (no Claude)
- scoped_analysis → pull data slice + Claude synthesis
- follow_up → inherit scope from conversation state, minimal new data
- deliverable_request → defer to async generation
- skill_execution → trigger skill run

**What would be wrong:**
- Every message goes to DeepSeek regardless of content
- Every message goes to Claude regardless of classification
- No distinction between "answerable from SQL" and "needs Claude synthesis"

### Test it:

Send these messages through the router and show me what happens at each step:

1. "How many stale deals do we have?" — Should be answerable from findings table. Zero Claude tokens.
2. "Why did pipeline drop this month?" — Needs data pull + Claude synthesis. Should cost ~3-5K tokens.
3. "Show me Sara's deals" — Should be a SQL query against deals table. Zero Claude tokens.
4. "What happened with the Acme deal?" — Should assemble a dossier (Layer 2), optional narrative.
5. "That makes sense, thanks" — Should be classified as acknowledgment. Zero data fetch, minimal response.

For each, report:
- Did heuristic match? (y/n)
- Did DeepSeek fire? (y/n, and token count)
- Did Claude fire? (y/n, and token count)
- Total token cost for the turn

---

## Check 3: Slack Thread Awareness

When someone replies to a Pandora Slack message in a thread:

### 3a. Does the system know which skill run produced the parent message?

Walk me through the code path:
1. Slack event arrives with `thread_ts` (the parent message timestamp)
2. System looks up... what? How does it find the skill run that produced that parent?
3. If it finds the skill run, does it load that run's evidence as context?

### 3b. Does scope persist across the thread?

If someone asks "Why is Acme flagged?" in a pipeline report thread, and then follows up with "What calls have we had with them?" — does the second message know "them" refers to Acme?

Show me how follow-up scope resolution works. Where is the current scope stored between turns?

### 3c. Does the same pipeline handle both Slack and in-app chat?

Show me the entry points for:
- Slack thread reply
- Slack DM
- In-app chat (`POST /chat`)

Do they converge to a single orchestrator function, or are there separate code paths? The architecture requires one orchestrator with surface as a parameter:

```typescript
// Expected pattern:
async function handleConversationTurn(input: {
  surface: 'slack_thread' | 'slack_dm' | 'in_app';
  workspaceId: string;
  threadId: string;
  message: string;
  // Slack-specific context (if applicable)
  anchor?: ThreadAnchor;
}) {
  // Same logic regardless of surface
}
```

---

## Check 4: State Management — Token Cost Constancy

This is the most important architectural requirement. Token cost per turn must stay roughly constant regardless of conversation depth.

### 4a. Show me how conversation context is built for Claude

On turn 10 of a conversation, what exactly goes into Claude's context window?

**Expected (constant ~5-6K tokens):**
```
A. System prompt: workspace identity + role (~100 tokens)
B. Business context: selective workspace config (~300-500 tokens)
C. Conversation state: structured JSON from conversation_state table (~300 tokens)
D. Recent raw messages: last 2-3 turns only (~500-800 tokens)
E. Data payload: freshly fetched for THIS turn (~2-3K tokens)
F. Voice config: tone settings (~50 tokens)
Total: ~4-5.5K input tokens (constant)
```

**Wrong (growing with conversation):**
```
All 10 messages sent as conversation history (~5-8K and growing)
+ Full data from all previous turns (~15-20K and growing)
Total: grows linearly with conversation length
```

### 4b. Is there a DeepSeek state extraction step?

After each turn, does the system extract structured state from the conversation? This is the "compression" step:

```typescript
// After Claude responds, before persisting:
const updatedState = await extractState(recentMessages, currentState);
// DeepSeek call (~500 tokens) that updates focus, entities_discussed, etc.
await saveConversationState(threadId, updatedState);
```

If this doesn't exist, every follow-up turn either:
- Sends the full transcript (expensive, growing)
- Has no memory of what was discussed (broken follow-ups)

### 4c. Empirical test

If the system is running, send 8 messages in a single thread. After each turn, report:
- Input tokens to Claude
- Output tokens from Claude  
- Total token cost for the turn

If cost is roughly constant (±30%) from turn 3 to turn 8, the architecture is right.
If cost is growing linearly, state management needs work.

---

## Check 5: In-App Chat Panel

### 5a. Scope awareness

When viewing a deal detail page and opening the chat panel:
- Does the chat know which deal you're viewing?
- Are suggested prompts scoped to that deal? (e.g., "Who should we be talking to?" not "How's my pipeline?")
- If you navigate to an account page, do suggestions change?

### 5b. Show me the ChatPanel component

What props does it receive? Expected:
```typescript
interface ChatPanelProps {
  workspaceId: string;
  scope?: {
    type: 'workspace' | 'deal' | 'account' | 'rep';
    entityId?: string;
    entityName?: string;
  };
}
```

### 5c. New Chat behavior

When user clicks "New Chat":
- Is a new thread_id generated?
- Is the conversation_state reset?
- Is the old thread preserved (queryable via `GET /chat/:threadId/history`)?

---

## Check 6: What's NOT Built (Confirm Intentionally Deferred)

These should NOT be built yet. Confirm they're absent:

- [ ] Workspace annotations table (feedback system — separate prompt)
- [ ] Thumbs up/down on responses (feedback system — separate prompt)
- [ ] Confirmation/correction detection (feedback system — separate prompt)
- [ ] Inline skill execution from chat (v2 — currently should say "I'd need to run a fresh analysis, use the Skills page")
- [ ] Streaming responses (v1 blocks until complete)
- [ ] Cross-thread memory (each thread is independent)
- [ ] Slash commands (/pandora run, ask, export)

---

## Check 7: Rate Limiting

### 7a. Are expensive calls (Claude synthesis) rate-limited separately from cheap calls (SQL lookups)?

Expected:
- Layer 1 queries (findings, pipeline snapshot, deal lists): NO rate limit
- Layer 2 dossier assembly: NO rate limit (or very high)
- Layer 3 Claude synthesis: 10-20 per hour per workspace
- DeepSeek classification: NOT rate limited (it's cheap)

### 7b. What happens when rate limit is hit?

Does the system:
- Return an error?
- Gracefully degrade to a SQL-only response?
- Tell the user when the limit resets?

---

## Summary Report

After running all checks, give me a summary in this format:

```
CONVERSATIONAL AGENT VERIFICATION
==================================

Check 1 — Schema
  conversations/messages table: ✅/⚠️/❌
  conversation_state table: ✅/⚠️/❌
  thread_anchors table: ✅/⚠️/❌
  Notes: [any gaps]

Check 2 — Router Token Savings
  Heuristic tier exists: ✅/❌
  Heuristic hit rate estimate: X%
  "How many stale deals" token cost: X tokens
  "Why did pipeline drop" token cost: X tokens
  Notes: [any gaps]

Check 3 — Slack Thread Awareness
  Anchor lookup works: ✅/❌
  Scope persists across turns: ✅/⚠️/❌
  Single orchestrator for all surfaces: ✅/❌
  Notes: [any gaps]

Check 4 — Token Cost Constancy
  Structured state extraction: ✅/❌
  Turn 3 cost: ~X tokens
  Turn 8 cost: ~X tokens
  Cost growth: constant / linear / unknown
  Notes: [any gaps]

Check 5 — In-App Chat
  Scope-aware suggestions: ✅/⚠️/❌
  Deal page scoping: ✅/❌
  New Chat reset: ✅/❌
  Notes: [any gaps]

Check 6 — Deferred Features
  All confirmed absent: ✅/❌
  Notes: [anything that was built that shouldn't be yet]

Check 7 — Rate Limiting
  Tiered by cost: ✅/❌
  Graceful degradation: ✅/❌
  Notes: [any gaps]

FIXES APPLIED: [list any changes made during this audit]
REMAINING GAPS: [list anything that needs a follow-up prompt]
```
