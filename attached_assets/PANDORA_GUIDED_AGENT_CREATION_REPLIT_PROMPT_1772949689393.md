# Replit Prompt: Guided Agent Creation — Agents Page Entry Point

## Context

There are now three ways to create an Agent:
1. **Conversational (existing)** — Ask Pandora, 5+ turns, banner appears
2. **Guided (this prompt)** — Agents page → "Start from conversation" → focused
   2–3 turn chat → modal opens
3. **Manual (existing)** — Agents page → "Build manually" → Agent Builder config

This prompt builds path 2. The user arrives at the Agents page with intent to
create something recurring. Instead of filling out a config form cold, they
describe what they care about in plain language. Pandora asks 2–3 focused
questions, proposes a configuration, and opens the pre-filled modal.

The same `extract-agent` endpoint and `SaveAsAgentModal` are reused. The only
new pieces are the entry point UI and the guided chat component.

---

## Before You Start

Scan these files first:

1. **The Agents list page** — find the `[+ New Agent]` button or equivalent.
   Understand what it currently does. You're replacing or extending this
   interaction, not adding a separate button.

2. **`SaveAsAgentModal`** — confirm it accepts `extractionResult` and
   `seedConversationId` from the work done earlier. You'll be passing the
   same props from this new entry point.

3. **Ask Pandora chat component** — understand how the chat renders messages
   and handles the system prompt. The guided chat uses the same infrastructure
   but with a different system prompt and a hard 3-turn exit condition.

4. **`POST /api/workspaces/:id/chat/extract-agent`** — confirm it exists and
   what it accepts. The guided flow calls it after the conversation reaches
   its exit condition.

5. **How the existing chat sessions are created** — does opening a new chat
   create a session in the DB immediately, or lazily on first message? You
   need a `conversation_id` to pass to `extract-agent`.

---

## Task 1: Creation Mode Picker

Replace the existing `[+ New Agent]` button behavior with a two-path picker.
This can be a Dialog/Modal that opens when the button is clicked, or an
inline split view — use whichever pattern fits the existing page layout.

```
┌─────────────────────────────────────────────────────────┐
│  How do you want to build this Agent?                   │
│                                                         │
│  ┌───────────────────────┐  ┌───────────────────────┐  │
│  │  💬                   │  │  ⚙️                    │  │
│  │  Start from           │  │  Build manually        │  │
│  │  conversation         │  │                        │  │
│  │                       │  │  Pick skills, set      │  │
│  │  Tell Pandora what    │  │  schedule, configure   │  │
│  │  you want. It figures │  │  delivery yourself.    │  │
│  │  out the rest.        │  │                        │  │
│  │                       │  │                        │  │
│  │  Best for: "I want    │  │  Best for: power       │  │
│  │  a weekly pipeline    │  │  users who know        │  │
│  │  review"              │  │  exactly what          │  │
│  │                       │  │  they need.            │  │
│  └───────────────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Visual notes:**
- Cards side by side, equal width
- Hover state: teal border + subtle background lift
- "Start from conversation" card has slightly more visual weight — it's the
  recommended path for most users
- "Build manually" routes to the existing Agent Builder flow unchanged

---

## Task 2: Guided Chat Component

Create `client/src/components/agents/GuidedAgentChat.tsx`

This is a focused, minimal chat interface — not the full Ask Pandora UI.
It renders inside a Sheet or Dialog (full-screen on mobile, right-panel
slide-over on desktop).

### Visual layout

```
┌─────────────────────────────────────────────────────────┐
│  ← Back    Create an Agent                        [×]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  🤖  What business outcome do you want to       │   │
│  │      stay on top of week over week?             │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  👤  I want to make sure my team hits quota      │   │
│  │      and my reps aren't falling behind.         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  🤖  Got it — quota attainment and rep           │   │
│  │      coverage. Any particular cadence or        │   │
│  │      meeting this should prep you for?          │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  👤  Monday mornings before our pipeline call.  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  🤖  Perfect. Building your Agent config...  ⟳  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [Message input]                              [Send →]  │
└─────────────────────────────────────────────────────────┘
```

**Key behavioral differences from Ask Pandora:**
- Max 3 user turns. After the 3rd user message, automatically trigger extraction
  regardless of what was said.
- After 2 user turns, show a subtle prompt below the input:
  `"Ready to build? Hit send or type one more thought."`
- No skill invocation, no charts, no evidence lookup — pure conversation.
- The Pandora messages come from the guided system prompt (Task 3), not the
  general Ask Pandora orchestrator.
- Loading state after the final user message: Pandora shows "Building your
  Agent config..." with a spinner while extraction runs.

### Props

```typescript
interface GuidedAgentChatProps {
  workspaceId: string;
  onAgentSaved: (agentId: string, agentName: string) => void;
  onClose: () => void;
}
```

---

## Task 3: Guided Chat Backend Endpoint

Add a new endpoint specifically for the guided creation conversation:

```typescript
/**
 * POST /api/workspaces/:workspaceId/chat/guided-agent
 *
 * Handles a single turn in the guided Agent creation conversation.
 * Uses a focused system prompt with a hard 3-turn exit condition.
 * Returns: { message: string, shouldExtract: boolean }
 *
 * - Turn 1: Pandora asks about business outcome
 * - Turn 2: Pandora asks about cadence/context
 * - Turn 3: Pandora says "Building your config..." and sets shouldExtract: true
 *
 * When shouldExtract is true, the frontend calls extract-agent next.
 */

POST /api/workspaces/:workspaceId/chat/guided-agent
Body: {
  messages: { role: 'user' | 'assistant', content: string }[];
  conversation_id: string;  // Created by frontend before first message
}
Response: {
  message: string;
  shouldExtract: boolean;   // true on turn 3
  conversation_id: string;
}
```

### Guided System Prompt

```typescript
const GUIDED_AGENT_SYSTEM_PROMPT = `You are helping a RevOps professional create 
a recurring automated Agent in Pandora.

Your job is to understand what business outcome they want to track and propose 
a configuration. You have exactly 3 turns to gather what you need.

TURN 1 (first response):
Ask one focused question about the business outcome they want to stay on top of.
Keep it short — one sentence. Example:
"What business outcome do you want to stay on top of week over week?"

TURN 2 (after their first answer):
You now know their goal. Ask one focused follow-up about cadence or context.
This is the last question before you build. Example:
"Got it — [restate their goal in 5 words]. Any particular cadence or meeting 
this should prep you for?"

TURN 3 (after their second answer):
You have everything you need. Do NOT ask another question.
Respond with exactly:
"Perfect. Let me build your Agent configuration based on what you've told me."

RULES:
- Never ask more than one question per turn.
- Never ask about specific skills or technical configuration — that's Pandora's job.
- Never say "I'll need to" or "I'll try to" — be confident.
- If the user gives you everything in their first message (goal + cadence),
  skip turn 2 and go straight to turn 3.
- Keep every response under 40 words.`;
```

### Early Exit Detection

If the user's first message contains both a goal AND a cadence signal (e.g.,
"I want a weekly pipeline review every Monday"), skip to turn 3 immediately:

```typescript
const CADENCE_SIGNALS = /\b(daily|weekly|monday|friday|monthly|every\s+\w+)\b/i;
const GOAL_SIGNALS = /\b(pipeline|forecast|rep|quota|coverage|review|report|brief)\b/i;

function shouldSkipToExtract(messages: Message[]): boolean {
  if (messages.filter(m => m.role === 'user').length >= 3) return true;
  
  const firstUserMessage = messages.find(m => m.role === 'user')?.content ?? '';
  const hasGoal = GOAL_SIGNALS.test(firstUserMessage);
  const hasCadence = CADENCE_SIGNALS.test(firstUserMessage);
  
  // If user gave us everything in one message, extract after 1 turn
  if (hasGoal && hasCadence && messages.filter(m => m.role === 'user').length >= 1) {
    return true;
  }
  
  return false;
}
```

---

## Task 4: Extraction + Modal Flow

After `shouldExtract: true` is returned, the frontend:

1. Calls `POST /chat/extract-agent` with the `conversation_id`
2. While waiting, shows "Building your Agent config..." spinner in the chat
3. When extraction returns, closes the guided chat and opens `SaveAsAgentModal`
   pre-filled with the extraction result
4. `created_from: 'conversation'` and `seed_conversation_id` are set as usual

```typescript
// In GuidedAgentChat.tsx, after receiving shouldExtract: true:

const handleExtraction = async () => {
  setExtracting(true);
  
  try {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/chat/extract-agent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      }
    );
    const extractionResult = await res.json();
    
    // Close guided chat, open modal
    setExtracting(false);
    onReadyToSave(extractionResult, conversationId);
    
  } catch {
    // Extraction failed — open modal with empty defaults
    setExtracting(false);
    onReadyToSave(null, conversationId);
  }
};
```

The parent component (Agents page) handles `onReadyToSave`:

```typescript
const [guidedChatOpen, setGuidedChatOpen] = useState(false);
const [modalOpen, setModalOpen] = useState(false);
const [extractionResult, setExtractionResult] = useState(null);
const [seedConversationId, setSeedConversationId] = useState(null);

const handleReadyToSave = (result, conversationId) => {
  setGuidedChatOpen(false);
  setExtractionResult(result);
  setSeedConversationId(conversationId);
  setModalOpen(true);
};
```

---

## Task 5: Conversation ID Creation

The guided chat needs a `conversation_id` before the first message so it can
be passed to `extract-agent` at the end.

Check how chat sessions are currently created in the codebase. Two options:

**Option A** — If chat sessions are created lazily (on first message):
Create the session on the first send, store the returned `conversation_id`
in component state, use it for all subsequent turns and the final extraction.

**Option B** — If you can pre-create a session:
```typescript
// On guided chat open, pre-create a session:
POST /api/workspaces/:id/chat/sessions
Body: { mode: 'guided_agent_creation' }
Response: { conversation_id: string }
```

Use whichever pattern the codebase already supports. Don't add new session
management if the lazy approach works.

---

## Task 6: Intent-to-Defaults Map (Extraction Enhancement)

When `extract-agent` runs on a short 2-turn guided conversation, the DeepSeek
extraction may return low confidence with few standing questions. Supplement
it with an intent-to-defaults map that fires when the conversation is short:

Add to `server/chat/conversation-extractor.ts`:

```typescript
interface AgentDefaults {
  suggested_name: string;
  skills: string[];
  suggested_schedule: ScheduleSuggestion;
  standing_questions: string[];
}

const INTENT_DEFAULTS: Array<{
  patterns: RegExp[];
  defaults: AgentDefaults;
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
 * Apply intent-based defaults when extraction confidence is low
 * OR when the conversation is short (guided creation, < 4 messages).
 *
 * Scan all user messages for intent patterns.
 * If a match is found, merge defaults into the extraction result:
 * - If DeepSeek returned a goal, keep it. Otherwise use defaults.
 * - If DeepSeek returned questions, keep them. Otherwise use defaults.
 * - Always override skills and schedule from defaults when matched
 *   (DeepSeek can't know which skills to use).
 */
export function applyIntentDefaults(
  result: ConversationExtractionResult,
  messages: ChatMessage[],
  isGuidedConversation: boolean,
): ConversationExtractionResult {
  const userText = messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
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
          ? defaults.suggested_schedule  // Always use defaults for guided
          : result.suggested_schedule,
        standing_questions: result.standing_questions.length >= 2
          ? result.standing_questions
          : defaults.standing_questions,
        // Upgrade confidence when intent matched
        confidence: result.confidence === 'low' ? 'medium' : result.confidence,
      };
    }
  }

  return result;
}
```

Call `applyIntentDefaults()` at the end of `extractAgentFromConversation()`,
passing `isGuidedConversation: messages.length <= 6`.

---

## Acceptance Criteria

1. **[+ New Agent] click** opens the two-path picker, not the Agent Builder directly.

2. **"Build manually"** routes to the existing Agent Builder flow — no regression.

3. **"Start from conversation"** opens the guided chat panel.

4. **Turn 1**: Pandora's opening question appears immediately (no user input needed).

5. **Turn 3 or early exit**: After the user's relevant messages, Pandora says
   "Perfect. Let me build your Agent configuration..." and extraction starts.

6. **"I want a weekly pipeline review"** as the first message triggers early exit
   (cadence + goal detected) — modal opens after 1 turn, not 3.

7. **Extraction result pre-fills modal**: name, goal, questions, skills, schedule
   are populated. Skills from the intent-defaults map appear when no skills
   were invoked in the guided conversation.

8. **`created_from: 'conversation'`** is set on the saved Agent.

9. **Short conversation (2 turns)** with a known intent pattern returns
   `confidence: 'medium'` (not 'low') due to intent-defaults upgrade.

10. **Guided chat closes cleanly** when the user clicks [×] before completing —
    no orphaned state, modal does not open.

---

## What NOT to Build

- **Skill invocation inside guided chat** — the guided conversation is pure
  natural language, no pipeline data lookup. The user describes intent;
  Pandora doesn't analyze their data during this flow.

- **More than 3 guided questions** — the hard cap is 3 user turns. If the
  user hasn't given enough signal by then, extract anyway and let the modal
  handle the gaps.

- **Modifying Ask Pandora** — the general Ask Pandora chat is unchanged.
  The guided flow is a separate component that reuses infrastructure.

- **Intent detection inside Ask Pandora** — if a user types "build me a
  weekly review" in Ask Pandora, don't intercept it there. The right response
  is: "Head to the Agents page to set that up — I can walk you through it."
  Keeping the surfaces clean matters more than handling every edge case.
