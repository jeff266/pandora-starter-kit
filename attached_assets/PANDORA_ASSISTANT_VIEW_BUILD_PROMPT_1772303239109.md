# Claude Code Prompt: Assistant View — Calm Interface with Streaming Conversation

## Context

Pandora is adding a dual-view interface: **Assistant View** (conversational-first, calm app) alongside the existing **Command View** (dashboard-first). Both views share the same data layer, skills, evidence, and operators. A sidebar toggle lets users switch between them. The toggle is the permanent final state — not a migration path.

The Assistant View turns Ask Pandora into the home screen with a greeting + briefing, and its conversational flow visibly recruits operators, streams their findings, synthesizes recommendations, shows expandable evidence, offers HITL action approval, and generates deliverables. This is what makes Pandora feel like *its own system* — not a Claude wrapper.

**The design spec is attached as a JSX mockup** (`pandora-calm-assistant-mockup.jsx`). It demonstrates the exact UX — interaction flow, animations, component structure, agent recruitment progression, evidence cards, HITL actions, and deliverable generation. Match this UX. The mockup uses hardcoded data and simulated timers — your job is to wire it to real infrastructure.

---

## Before You Start

**Read these files to understand the existing architecture:**

1. `client/src/` — Explore the current React app structure. Find the router, layout, sidebar, and existing Ask Pandora chat component.
2. `server/chat/orchestrator.ts` — The conversational agent. This is where questions get classified and routed.
3. `server/chat/intent-classifier.ts` — Intent classification for chat messages.
4. `server/agents/runtime.ts` — The `executeAgent()` pipeline: skills → synthesize → deliver.
5. `server/agents/seed-agents.ts` — The system agent definitions (your "operators").
6. `server/agents/types.ts` — Agent TypeScript interfaces.
7. `server/skills/` — Browse all skill files. Each skill produces evidence (claims, evaluated_records, etc.).
8. `server/db/migrations/` — Find the latest migration number.
9. `server/routes/` — Existing API routes.
10. `server/config/workspace-config-loader.ts` — Workspace config system.
11. Find the existing findings table and its API endpoints (`GET /findings`, `GET /findings/summary`).
12. Find any existing greeting, briefing, or morning brief logic (check `weeklyPreps` table, `prep-brief-viewer.tsx`, or similar).

**Reference documents (read for vision but do NOT implement everything — only what's scoped below):**
- `PANDORA_CALM_ASSISTANT_VISION.md` — Full vision document
- `PANDORA_GREETING_ENGINE_ADDENDUM.md` — Greeting engine design
- `PANDORA_COMMAND_CENTER_SPEC.md` — Command Center page spec
- `PANDORA_OPERATOR_MODEL_BUILD_PROMPT.md` — Operator identity and execution model
- `PANDORA_EVIDENCE_ARCHITECTURE_REFERENCE.md` — Evidence layer architecture

---

## What You're Building

Four tasks, in order:

| Task | What | Effort |
|------|------|--------|
| 1 | View Toggle Infrastructure | ~4-6 hrs |
| 2 | Greeting Engine + Morning Brief Assembler | ~8-10 hrs |
| 3 | Assistant View Home Page | ~6-8 hrs |
| 4 | Streaming Conversation with Operator Recruitment | ~12-16 hrs |

**Total: ~30-40 hours of implementation.**

---

## Task 1: View Toggle Infrastructure

### 1A: Database Migration

Create migration `XXX_view_toggle.sql` (use next sequential number after latest migration).

```sql
-- Add view preference to users or workspace_members
ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS preferred_view TEXT DEFAULT 'command'
  CHECK (preferred_view IN ('assistant', 'command'));

-- Add workspace-level default for new users
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS default_view TEXT DEFAULT 'command'
  CHECK (default_view IN ('assistant', 'command'));

COMMENT ON COLUMN workspace_members.preferred_view IS 'User view preference: assistant (calm app) or command (dashboard)';
COMMENT ON COLUMN workspaces.default_view IS 'Default view for new workspace members';
```

If `workspace_members` doesn't exist (users are tied to workspaces differently), adapt to whatever user-workspace association table exists. The key: per-user-per-workspace preference, persisted to DB, with a workspace-level default.

### 1B: API Endpoints

Add to existing user or workspace routes:

```
GET  /api/workspaces/:id/view-preference
  → Returns { preferred_view: 'assistant' | 'command' }
  → Falls back to workspace default_view if user has no preference

PUT  /api/workspaces/:id/view-preference
  Body: { preferred_view: 'assistant' | 'command' }
  → Updates workspace_members row for current user
  → Returns updated preference

PUT  /api/workspaces/:id/settings/default-view  (admin only)
  Body: { default_view: 'assistant' | 'command' }
  → Updates workspaces row
```

### 1C: Frontend Router Changes

In the main app router (likely using Wouter), add view-aware routing:

```typescript
// Pseudo-structure — adapt to actual router setup

function AppLayout() {
  const { data: viewPref } = useQuery(['view-preference'], fetchViewPreference);
  const [activeView, setActiveView] = useState(viewPref?.preferred_view || 'command');

  // Persist toggle changes
  const toggleView = async (view: 'assistant' | 'command') => {
    setActiveView(view);
    await updateViewPreference(view);
  };

  return (
    <div className="flex h-screen">
      <Sidebar
        mode={activeView}
        onModeChange={toggleView}
        // ... existing sidebar props
      />
      {activeView === 'assistant' ? <AssistantView /> : <CommandView />}
    </div>
  );
}
```

### 1D: Sidebar Toggle Component

Add a view toggle to the **bottom of the existing sidebar**, just above any user/logout controls:

```
┌─────────────────────┐
│  View                │
│  ┌────────┬────────┐ │
│  │◉ Asst  │▦ Cmd   │ │
│  └────────┴────────┘ │
└─────────────────────┘
```

The toggle is a segmented control. Active state gets a subtle background and accent color. This component:
- Reads from the `activeView` state
- Calls `onModeChange()` on click
- Persists via the PUT endpoint (debounced — don't hit API on every click if they toggle back and forth)
- Also switches which nav items show in the sidebar (see Task 3)

---

## Task 2: Greeting Engine + Morning Brief Assembler

### 2A: Greeting Engine

Create `server/briefing/greeting-engine.ts`.

The greeting engine produces a personalized greeting based on:
1. **Time of day** → "Good morning" / "Good afternoon" / "Good evening"
2. **Day of week** → Monday gets "A few things before your week starts." Friday gets "Here's where the week landed."
3. **Business state** → derived from recent findings

```typescript
// server/briefing/greeting-engine.ts

export interface GreetingPayload {
  headline: string;         // "Good morning, Jeff."
  subline: string;          // "A few things before your week starts."
  state_summary: string;    // "Pipeline at $2.4M with 2.1× coverage. 2 critical findings. 3 deals moved."
  severity: 'calm' | 'attention' | 'urgent';
  metrics: {
    pipeline_value: number;
    coverage_ratio: number;
    critical_count: number;
    warning_count: number;
    deals_moved: number;
  };
}

export async function generateGreeting(workspaceId: string): Promise<GreetingPayload> {
  // 1. Get user's first name from workspace context
  // 2. Get time of day from workspace timezone (from workspace config)
  // 3. Query findings summary: GET /api/workspaces/:id/findings/summary
  //    This should return counts by severity from the findings table
  // 4. Query pipeline snapshot for headline metrics
  //    Use existing pipeline aggregation SQL or the /pipeline/snapshot endpoint
  // 5. Query recent deal movements (stage changes in last 24-72 hours depending on day)
  //    Check skill_runs for deal-risk-review or pipeline-hygiene results
  // 6. Determine severity:
  //    - 'urgent' if critical_count >= 3 OR any finding with severity='critical' and impact > $500K
  //    - 'attention' if critical_count >= 1 OR warning_count >= 3
  //    - 'calm' otherwise
  // 7. Build state_summary string with inline metrics
  // 8. Return GreetingPayload
}
```

**Key implementation detail:** The greeting engine does NOT call AI. It's pure SQL aggregation + string templating. It should return in <200ms. The AI synthesis happens in the briefing cards (from skill run results) and in the conversation flow.

### 2B: Morning Brief Assembler

Create `server/briefing/brief-assembler.ts`.

The brief assembler collects the most recent findings from each active operator/agent and ranks them by severity and recency.

```typescript
// server/briefing/brief-assembler.ts

export interface BriefItem {
  id: string;
  operator_name: string;       // "Pipeline Analyst"
  operator_icon: string;       // emoji or icon key
  operator_color: string;      // hex color for UI
  severity: 'critical' | 'warning' | 'info';
  headline: string;            // "Pipeline generation is 28% below flight plan"
  body: string;                // 1-2 sentence detail
  evidence_snapshot?: any;     // Optional compact evidence for inline display
  skill_run_id: string;        // For drill-through
  created_at: string;
}

export async function assembleBrief(workspaceId: string, options?: {
  maxItems?: number;           // default 6
  since?: Date;                // default: last 24h on weekdays, last 72h on Monday
}): Promise<BriefItem[]> {
  // 1. Query the findings table for this workspace
  //    ORDER BY severity_rank ASC, created_at DESC
  //    (critical first, then warning, then info; within severity, most recent first)
  //    LIMIT options.maxItems
  //
  // 2. For each finding, look up which agent produced it
  //    (findings should have agent_id or skill_id → map to operator metadata)
  //
  // 3. Map agent/skill to operator display info:
  //    - Pipeline Analyst: { icon: "📊", color: "#22D3EE" }
  //    - Forecast Analyst: { icon: "🎯", color: "#7C6AE8" }
  //    - Deal Analyst: { icon: "🔍", color: "#FB923C" }
  //    - Coaching Analyst: { icon: "🏋️", color: "#34D399" }
  //    - Data Steward: { icon: "🧹", color: "#FBBF24" }
  //    (These should come from agent seed data — read agents table for display metadata)
  //
  // 4. Return BriefItem[]
}
```

### 2C: Operator Health Status

Create `server/briefing/operator-status.ts`.

Returns the health/status of each operator for the "Your Operators" strip.

```typescript
export interface OperatorStatus {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: 'green' | 'amber' | 'red' | 'paused';
  last_run_at: string | null;
  last_run_relative: string;   // "2h ago", "12h ago", "Paused"
}

export async function getOperatorStatuses(workspaceId: string): Promise<OperatorStatus[]> {
  // 1. Query agents table for this workspace (system agents + any custom)
  // 2. For each agent, query most recent skill_run
  // 3. Determine status:
  //    - 'green' if last run < 6 hours ago and status='completed'
  //    - 'amber' if last run 6-24 hours ago or last run had warnings
  //    - 'red' if last run failed or > 24 hours ago
  //    - 'paused' if agent.enabled = false
  // 4. Format last_run_relative with date-fns formatDistanceToNow
}
```

### 2D: API Endpoints

```
GET /api/workspaces/:id/briefing/greeting
  → Returns GreetingPayload

GET /api/workspaces/:id/briefing/brief
  → Returns BriefItem[]
  → Query params: limit (default 6), since (ISO datetime)

GET /api/workspaces/:id/briefing/operators
  → Returns OperatorStatus[]
```

These three endpoints power the entire Assistant View home screen. They should all return in <500ms combined.

---

## Task 3: Assistant View Home Page

### 3A: Navigation Changes

When `activeView === 'assistant'`, the sidebar shows a reduced nav:

```
Ask Pandora (home)     ← active by default
Operators              ← badge: count of active operators
Command Center         ← click switches to Command View
Settings
```

When `activeView === 'command'`, the sidebar shows the full nav (whatever currently exists — do NOT change the Command View nav).

Implement this by conditionally rendering different nav arrays based on `mode` prop in the Sidebar component.

### 3B: Assistant View Component

Create `client/src/pages/assistant-view.tsx` (or appropriate location in the existing component structure).

**Match the JSX mockup's layout exactly.** The component structure:

```
<AssistantView>
  <ScrollableContent>
    <Greeting />                    ← from /briefing/greeting
    <QuickActionPills />            ← clickable, trigger conversation
    <MorningBrief />                ← from /briefing/brief, severity dots + operator badges
    <OperatorStrip />               ← from /briefing/operators
  </ScrollableContent>
  <StickyInput />                   ← chat input, always visible at bottom
</AssistantView>
```

**Data fetching:** Use TanStack Query (already in the project) for all three briefing endpoints. Show skeleton loaders while loading. Refetch on window focus.

**Quick action pills:** These are contextual suggestions. For v1, use a static set based on day of week:

```typescript
const MONDAY_ACTIONS = ["Walk me through the findings", "Show the week ahead", "Prep my 1:1s", "Run pipeline review"];
const MIDWEEK_ACTIONS = ["What changed today?", "Show at-risk deals", "Pipeline health check", "Forecast update"];
const FRIDAY_ACTIONS = ["Week in review", "What needs attention Monday?", "Build board update", "Show win/loss this week"];
```

**Briefing cards:** Each BriefItem renders as a card with:
- Severity dot (color-coded, glowing for critical)
- Operator icon + name
- Headline (bold)
- Body text (muted)
- Clicking the card enters conversation mode with the headline as the question

**Operator strip:** Row of small status badges showing each operator's health.

### 3C: Command View Greeting Bar

In the existing Command Center home page component, add a **slim greeting bar** at the top:

```
┌─────────────────────────────────────────────────────────────┐
│ Morning, Jeff. 2 critical findings. Pipeline $2.4M.  [Walk me through] [Week ahead] │
└─────────────────────────────────────────────────────────────┘
```

This uses the same `/briefing/greeting` endpoint but renders it as a single-line bar with inline quick-action buttons. Clicking a quick-action button either switches to Assistant View or opens the Ask Pandora slide-out panel (whichever exists).

---

## Task 4: Streaming Conversation with Operator Recruitment

This is the most complex task. When the user asks a question in Assistant View, the entire flow from the JSX mockup plays out — but wired to real infrastructure.

### 4A: Conversation State Machine

The conversation has these phases:

```
idle → recruiting → findings → synthesis → [evidence] → [actions] → [deliverables]
```

Create a conversation state manager (React context or zustand store, depending on what's already used in the project):

```typescript
interface ConversationState {
  phase: 'idle' | 'recruiting' | 'findings' | 'synthesis' | 'evidence' | 'actions' | 'deliverables';
  messages: ConversationMessage[];
  activeOperators: OperatorProgress[];
  findings: AgentFinding[];
  synthesis: string | null;
  evidence: EvidenceCard[];
  actions: RecommendedAction[];
  deliverables: DeliverableOption[];
}

interface OperatorProgress {
  agent_id: string;
  agent_name: string;
  agent_icon: string;
  agent_color: string;
  skills_querying: string[];     // "Pipeline Waterfall", "Pipeline Hygiene"
  status: 'recruiting' | 'thinking' | 'found' | 'done';
  finding_preview?: string;      // Short preview when status='found'
}

interface AgentFinding {
  agent_id: string;
  agent_name: string;
  agent_icon: string;
  agent_color: string;
  finding_text: string;
  evidence?: {
    type: 'table' | 'timeline' | 'metric';
    data: any;
  };
}
```

### 4B: Backend — Streaming Conversation Endpoint

This is the critical new endpoint. When the user asks a question in Assistant View, the backend needs to:
1. Classify the intent (existing orchestrator)
2. Determine which operators/agents to recruit
3. Execute skills in parallel
4. Stream progress updates back to the frontend
5. Synthesize findings
6. Return recommended actions

**Option A: Server-Sent Events (SSE)** — Recommended for simplicity.

Create `server/routes/conversation-stream.ts`:

```
POST /api/workspaces/:id/conversation/stream
Body: { message: string, thread_id?: string }
Response: text/event-stream
```

Each SSE event has a type:

```typescript
// Event types streamed to the client:

type StreamEvent =
  | { type: 'recruiting', agent_id: string, agent_name: string, icon: string, color: string, skills: string[], task: string }
  | { type: 'agent_thinking', agent_id: string }
  | { type: 'agent_found', agent_id: string, finding_preview: string }
  | { type: 'agent_done', agent_id: string, finding: AgentFinding }
  | { type: 'synthesis_start' }
  | { type: 'synthesis_chunk', text: string }   // Stream synthesis token by token
  | { type: 'synthesis_done', full_text: string }
  | { type: 'evidence', cards: EvidenceCard[] }
  | { type: 'actions', items: RecommendedAction[] }
  | { type: 'deliverable_options', options: DeliverableOption[] }
  | { type: 'error', message: string }
  | { type: 'done' }
```

**Implementation flow inside the endpoint:**

```typescript
export async function handleConversationStream(req, res) {
  const { workspaceId } = req.params;
  const { message, thread_id } = req.body;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event: StreamEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    // 1. CLASSIFY — Use the existing chat orchestrator or intent classifier
    //    to determine what kind of question this is and which operators to involve.
    //    Read server/chat/orchestrator.ts and server/chat/mode-classifier.ts.
    //    The mode classifier already maps questions to operator slugs.
    const classification = classifyExecutionMode(message, { /* context */ });

    // 2. RECRUIT — Determine which agents/operators to dispatch.
    //    For simple questions: 1-2 operators.
    //    For complex questions: 3-5 operators.
    //    Use the operator's `skills` array to know what they'll query.
    const operators = await selectOperatorsForQuestion(workspaceId, message, classification);

    // 3. STREAM RECRUITMENT — Send recruiting events for each operator
    for (const op of operators) {
      send({
        type: 'recruiting',
        agent_id: op.id,
        agent_name: op.name,
        icon: op.icon,
        color: op.color,
        skills: op.skills.map(s => s.display_name),
        task: op.recruitment_task,  // "Pulling latest pipeline state..."
      });
      await sleep(300); // Stagger for visual effect
    }

    // 4. EXECUTE SKILLS IN PARALLEL — Run each operator's relevant skills
    //    Use Promise.allSettled to run in parallel.
    //    As each completes, stream the result.
    const skillPromises = operators.map(async (op) => {
      send({ type: 'agent_thinking', agent_id: op.id });

      // Execute the operator's relevant skills
      // This should use the existing skill execution infrastructure
      // in server/agents/runtime.ts or directly call skill executors
      const skillResults = await executeOperatorSkills(workspaceId, op, message);

      // Stream the finding preview
      const preview = extractFindingPreview(skillResults);
      send({ type: 'agent_found', agent_id: op.id, finding_preview: preview });

      // Stream the full finding with evidence
      const finding = formatAgentFinding(op, skillResults);
      send({ type: 'agent_done', agent_id: op.id, finding });

      return { operator: op, skillResults, finding };
    });

    const results = await Promise.allSettled(skillPromises);
    const successfulResults = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    // 5. SYNTHESIZE — Use Claude to produce the strategic narrative
    send({ type: 'synthesis_start' });

    // Build the synthesis prompt from operator findings
    // Use the existing agent synthesis prompt pattern from runtime.ts
    const synthesisInput = buildSynthesisPrompt(message, successfulResults);

    // Stream the synthesis response token by token
    // Use the Anthropic streaming API (callAnthropicAI with stream: true)
    const synthesisStream = await streamClaudeSynthesis(synthesisInput);
    let fullSynthesis = '';

    for await (const chunk of synthesisStream) {
      fullSynthesis += chunk;
      send({ type: 'synthesis_chunk', text: chunk });
    }

    send({ type: 'synthesis_done', full_text: fullSynthesis });

    // 6. EVIDENCE — Collect expandable evidence cards from skill results
    const evidenceCards = collectEvidenceCards(successfulResults);
    if (evidenceCards.length > 0) {
      send({ type: 'evidence', cards: evidenceCards });
    }

    // 7. ACTIONS — Extract recommended actions from findings
    //    Actions come from the actions engine or from the synthesis prompt
    const recommendedActions = extractRecommendedActions(successfulResults, fullSynthesis);
    if (recommendedActions.length > 0) {
      send({ type: 'actions', items: recommendedActions });
    }

    // 8. DELIVERABLES — Offer output format options
    send({
      type: 'deliverable_options',
      options: [
        { id: 'slides', icon: '📊', label: 'Slide deck', sub: 'Leadership briefing' },
        { id: 'doc', icon: '📄', label: 'Word doc', sub: 'Full analysis' },
        { id: 'slack', icon: '💬', label: 'Slack post', sub: 'Team summary' },
        { id: 'email', icon: '📧', label: 'Email draft', sub: 'VP briefing' },
      ],
    });

    send({ type: 'done' });

  } catch (error) {
    send({ type: 'error', message: error.message });
  } finally {
    res.end();
  }
}
```

### 4C: Helper Functions

**`selectOperatorsForQuestion()`** — Maps question intent to operators:

```typescript
async function selectOperatorsForQuestion(workspaceId: string, message: string, classification: any) {
  // Use the existing mode classifier's selectOperatorForQuestion() logic
  // but expand it to return MULTIPLE operators, not just one.
  //
  // For broad questions like "Walk me through the findings":
  //   → Pipeline Analyst, Deal Analyst, Conversation Intel, Forecast Analyst
  //
  // For focused questions like "What's happening with the Acme deal?":
  //   → Deal Analyst only (with deal-specific skills)
  //
  // For each operator, generate a recruitment_task description:
  //   "Pulling latest pipeline state and stale deal analysis"
  //   "Checking deal regression events and risk signals"
  //
  // Return: Array of operator objects with id, name, icon, color, skills, recruitment_task
}
```

**`executeOperatorSkills()`** — Runs the operator's relevant skills:

```typescript
async function executeOperatorSkills(workspaceId: string, operator: any, question: string) {
  // 1. Determine which of the operator's skills are relevant to the question
  // 2. Check for recent cached results (skill_runs within last 60 minutes)
  //    If cached and fresh, use cached results (fast path)
  // 3. If not cached, execute the skill using the existing skill execution infrastructure
  // 4. Return the skill results (evidence, claims, evaluated_records)
}
```

**`streamClaudeSynthesis()`** — Streams the AI synthesis:

```typescript
async function streamClaudeSynthesis(prompt: string): AsyncGenerator<string> {
  // Use the Anthropic SDK's streaming API
  // This should use the existing callAnthropicAI() from server/agents/ai-providers.ts
  // but in streaming mode
  //
  // The synthesis prompt should follow the existing pattern from agent runtime
  // but adapted for conversational output (no Slack formatting, use markdown-lite)
}
```

### 4D: Frontend — Conversation Components

Create these React components matching the JSX mockup:

**`AgentChip`** — Shows operator recruitment status with progression:
- `recruiting` → border color muted, name + "Recruiting..."
- `thinking` → border color active, pulsing dots, "Querying Pipeline Waterfall, Pipeline Hygiene..."
- `found` → border color active, finding preview text
- `done` → green check, finding preview text

**`EvidenceCard`** — Expandable card with title, severity dot, and drill-through items:
- Click to expand/collapse
- Items show label + value with color coding
- Matches the mockup's `EvidenceCard` component exactly

**`ActionCard`** — HITL action card with approve/edit/skip:
- Shows action type icon (Slack, CRM, email)
- Title, detail, preview text (if available)
- "Approve & Send" → calls action execution endpoint
- "Edit first" → shows editable textarea with preview content
- "Skip" → dismisses the action
- Wire to: `POST /api/workspaces/:id/actions/:actionId/execute` (or create if doesn't exist)

**`DeliverableButton`** — Output format selector:
- Grid of format options matching the mockup
- Selecting one triggers: `POST /api/workspaces/:id/deliverables/generate`
- Shows generation spinner, then "Ready" state with Download/Preview buttons
- Wire to the existing renderer infrastructure (workbook-generator, pdf-renderer, etc.)

**`ConversationView`** — The main conversation container:
- Connects to the SSE endpoint when user sends a message
- Processes stream events and updates conversation state
- Renders messages, agent chips, synthesis, evidence, actions, deliverables in order
- Auto-scrolls to bottom as new content streams in
- "← Back to brief" button returns to the home state

### 4E: Frontend — SSE Client

```typescript
function useConversationStream(workspaceId: string) {
  const [state, dispatch] = useReducer(conversationReducer, initialState);

  const sendMessage = async (message: string) => {
    dispatch({ type: 'USER_MESSAGE', message });
    dispatch({ type: 'SET_PHASE', phase: 'recruiting' });

    const response = await fetch(`/api/workspaces/${workspaceId}/conversation/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));
          dispatch({ type: 'STREAM_EVENT', event });
        }
      }
    }
  };

  return { state, sendMessage };
}
```

The `conversationReducer` handles each event type and updates the state accordingly, driving the UI through its phases.

---

## What This Connects To (Existing Infrastructure)

| Mockup Feature | Real Infrastructure |
|---|---|
| Agent recruitment animation | `server/agents/seed-agents.ts` → operator metadata (name, skills, icon) |
| Agent "thinking" with skill names | `agent.skills[]` → each skill has a `display_name` |
| Agent finding text | `skill_runs.result_data` → claims and evaluated_records |
| Evidence tables in findings | `evaluated_records` from skill evidence contract |
| Synthesis narrative | `callAnthropicAI()` with agent synthesis prompt from `runtime.ts` |
| Evidence cards with drill-through | Findings table + evidence architecture |
| HITL action cards | Actions engine (actions table, action execution) |
| Deliverable generation | Renderer infrastructure (workbook-generator, pdf-renderer, slack-renderer) |
| Greeting metrics | Pipeline aggregation SQL + findings summary |
| Operator status strip | Agent health from skill_runs table |
| "X operators working" bar | SSE event count |
| Follow-up quick replies | Generated from synthesis context or static per-phase |

---

## What NOT to Build

- **Voice input** — text only for v1
- **Multi-user conversation threads** — single user per conversation
- **Conversation persistence across sessions** — each visit starts fresh (briefing is always current)
- **Custom operator creation from Assistant View** — that's the Agent Builder in Command View
- **Real-time WebSocket for Command View** — Command View continues to use polling/TanStack Query
- **Mobile-responsive layout** — desktop-first
- **Animated transitions between views** — simple swap is fine, no page transition animations
- **AI-generated quick action pills** — use the static day-of-week sets for v1
- **Forced migration from Command to Assistant** — the toggle is permanent, both views stay

---

## File Structure Summary

### New Files

```
server/briefing/
├── greeting-engine.ts           # Task 2A: Greeting generation
├── brief-assembler.ts           # Task 2B: Morning brief collection
└── operator-status.ts           # Task 2C: Operator health

server/routes/
├── briefing.ts                  # Task 2D: API endpoints for briefing
└── conversation-stream.ts       # Task 4B: SSE streaming endpoint

client/src/pages/
└── assistant-view.tsx           # Task 3B: Assistant View home page

client/src/components/assistant/
├── greeting.tsx                 # Greeting display component
├── morning-brief.tsx            # Brief card list
├── operator-strip.tsx           # Operator health badges
├── quick-actions.tsx            # Quick action pill buttons
├── conversation-view.tsx        # Task 4D: Streaming conversation container
├── agent-chip.tsx               # Operator status chip with progression
├── evidence-card.tsx            # Expandable evidence card
├── action-card.tsx              # HITL action card
├── deliverable-picker.tsx       # Deliverable format selector
└── use-conversation-stream.ts   # Task 4E: SSE client hook
```

### Modified Files

```
server/db/migrations/XXX_view_toggle.sql        # Task 1A
server/routes/index.ts (or routes.ts)            # Register new routes
client/src/components/sidebar.tsx (or layout)     # Task 1D: Add toggle + conditional nav
client/src/App.tsx (or router file)               # Task 1C: View-aware routing
client/src/pages/command-center.tsx (or home)     # Task 3C: Add greeting bar
```

---

## Validation Checklist

After building, verify:

1. **Migration runs** — new columns exist on workspace_members and workspaces
2. **View toggle persists** — switch to Assistant, refresh page, still on Assistant
3. **Sidebar changes** — Assistant View shows 4 nav items, Command View shows full nav
4. **Greeting loads** — `/briefing/greeting` returns data within 200ms
5. **Brief assembles** — `/briefing/brief` returns findings sorted by severity
6. **Operator status** — `/briefing/operators` shows all agents with correct health
7. **Assistant View renders** — greeting, brief cards, operator strip, and input all visible
8. **Command View greeting bar** — slim bar appears at top of Command Center
9. **Conversation streams** — send "Walk me through the findings" → see recruitment events, agent findings, synthesis streaming, evidence cards
10. **Agent chips progress** — recruiting → thinking → found → done, with real skill names
11. **Evidence cards expand** — click to see drill-through data from actual skill runs
12. **Action cards work** — Approve/Edit/Skip buttons function, Approve calls execution endpoint
13. **Deliverable picker works** — select format, see generation spinner, get download link
14. **Back to brief** — clicking "← Back to brief" returns to home state cleanly
15. **Both views share data** — same findings appear in both Assistant briefing and Command Center findings feed

---

## Implementation Order

Build in this exact order. Each task depends on the previous:

1. **Task 1** (toggle) — get the toggle working with placeholder pages
2. **Task 2** (greeting engine) — build the backend that powers the home screen
3. **Task 3** (Assistant home) — build the home screen UI consuming Task 2's endpoints
4. **Task 4** (streaming conversation) — build the full conversation flow

Test each task before moving to the next. Task 1 is testable with empty views. Task 2 is testable with curl. Task 3 is testable with real data. Task 4 is the integration of everything.

---

## Design Reference

The attached JSX mockup (`pandora-calm-assistant-mockup.jsx`) is your design spec. It demonstrates:

- **Color palette** — dark theme with cyan/purple/green/yellow/red operator colors
- **Typography** — DM Sans for body, DM Mono for data/labels
- **Agent chip design** — left-border colored by operator, status progression
- **Evidence card design** — expandable with severity dots and data rows
- **Action card design** — HITL with approve/edit/skip pattern
- **Greeting layout** — Pandora avatar + headline + state summary
- **Briefing card layout** — severity dot + operator badge + headline + body
- **Input bar design** — sticky bottom with ✦ icon and send button
- **Synthesis block** — Pandora avatar, streamed text, follow-up pills

Match this UX precisely. The mockup's hardcoded data and `setTimeout` timers are replaced by real API calls and SSE events, but the visual output should be identical.
