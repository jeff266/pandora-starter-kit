# Pandora — Ask Pandora: Inline Action Cards in Chat Responses

## Concept

Ask Pandora already produces excellent analysis. The gap: recommendations live only as text. After identifying actionable items, Pandora should surface structured action cards inline in the chat that the user can execute immediately — without navigating to Deal Detail, Command Center, or Insights Feed.

This is the bridge between Pandora as an analysis tool and Pandora as an action agent.

---

## Before Writing Any Code

Read these files and report:

1. `server/chat/pandora-agent.ts` — how does the agent currently end a response? What's the final synthesis step? Is there any existing mechanism for emitting structured data alongside text?

2. `client/src/components/ChatPanel.tsx` — how are assistant messages currently rendered? Is the message content raw text/markdown, or structured? Where would action cards be injected?

3. `client/src/components/deals/ActionCard.tsx` — confirm it exists and what props it accepts. Can it be used outside of DealDetail?

4. The existing inline actions system (`InlineActionsPrompt`, `StageRecCard`) — confirm file locations and how they currently work. Can this pattern be extended?

5. `server/routes/actions.ts` and `server/deals/actions-sync.ts` — confirm the `POST /deals/:dealId/actions/sync` endpoint signature. What does it expect and return?

Report findings before writing any code.

---

## Architecture

### How action extraction works

After the main synthesis, the agent runs a lightweight secondary pass to extract structured actions from the response. This is NOT a new LLM call — it's a pattern match on the synthesis output combined with signals from the tool calls that were made.

```
User asks complex question
  → Loop executes (existing, unchanged)
  → Synthesis produces text response (existing, unchanged)
  → NEW: Action extractor runs on synthesis output + tool call context
  → NEW: Structured actions emitted via SSE as 'suggested_actions' event
  → NEW: Client renders action cards below the response text
```

The action extractor is deterministic — no extra LLM token cost.

---

## Part 1 — Server: Action Extractor

### Create `server/chat/action-extractor.ts`

```typescript
interface ExtractedAction {
  id: string;                    // uuid
  type: ActionType;
  title: string;                 // human-readable
  description: string;           // 1-line explanation
  priority: 'P1' | 'P2' | 'P3';
  deal_id?: string;              // if deal-specific
  deal_name?: string;
  execution_mode: 'auto' | 'queue' | 'hitl';  // from threshold resolver
  action_payload: object;        // what gets executed
  evidence: string;              // why Pandora is suggesting this
  threshold_note?: string;       // e.g. "Requires approval — protected field"
}

type ActionType = 
  | 'run_skill'
  | 'create_crm_tasks'
  | 'update_crm_field'
  | 'run_meddic_coverage'
  | 'update_forecast_category'
  | 'update_close_date'
  | 'dismiss_findings'
  | 'create_workflow_rule';
```

### Extraction logic

The extractor takes the synthesis text + tool call context and applies pattern matching:

```typescript
export async function extractActions(
  synthesisText: string,
  toolCalls: ToolCallRecord[],
  workspaceId: string,
  dealContext?: { deal_id: string; deal_name: string }
): Promise<ExtractedAction[]>
```

**Pattern rules:**

**Skill run actions** — triggered when synthesis mentions running a skill:
```typescript
// Patterns that trigger 'run_skill':
const RUN_SKILL_PATTERNS = [
  /run.*pipeline hygiene/i → skill_id: 'pipeline-hygiene-check'
  /run.*meddic/i          → skill_id: 'meddic-coverage'
  /run.*deal risk/i       → skill_id: 'deal-risk-assessment'
  /run.*forecast/i        → skill_id: 'forecast-rollup'
];
// execution_mode: 'auto' (skill runs are always safe)
```

**CRM task creation** — triggered when synthesis contains action items:
```typescript
// If synthesis has numbered list items + deal context:
// Extract each item as a task
// e.g. "1. Audit each deal this week" → task title for each deal
// execution_mode: 'queue' (respects workspace threshold)
```

**Forecast category update** — triggered when synthesis proposes forecast changes:
```typescript
// Patterns:
/commit.*only.*\$[\d]+K/i   → extract deal name + proposed category: 'commit'
/best case.*\$[\d]+K/i      → extract deal name + proposed category: 'best_case'
/pipeline.*\$[\d]+K/i       → extract deal name + proposed category: 'pipeline'
// execution_mode: 'hitl' (forecast_category is always protected)
```

**Close date update** — triggered when synthesis flags bad close dates:
```typescript
// Patterns:
/closing same day/i
/all.*april.*same date/i
/push.*close date/i
// Extract: deal names from tool call context, proposed dates from synthesis
// execution_mode: 'hitl' (close_date is always protected)
```

**MEDDIC coverage** — triggered when MEDDIC is mentioned for specific deals:
```typescript
// If synthesis mentions MEDDIC + deal names visible in tool calls
// Create one 'run_meddic_coverage' action per deal
// execution_mode: 'auto'
```

**Max 6 actions per response.** Sort by priority: P1 first, then P2, then P3. If more than 6 match, take the highest priority 6.

---

## Part 2 — Server: Emit Actions via SSE

In `pandora-agent.ts`, after the synthesis loop exits and before returning the final response, call the extractor and emit:

```typescript
// After synthesis is complete:
const actions = await extractActions(
  synthesisText,
  toolCallHistory,
  workspaceId,
  dealContext  // from session scope if available
);

if (actions.length > 0) {
  sseEmit({
    type: 'suggested_actions',
    data: { actions }
  });
}
```

The `suggested_actions` SSE event fires AFTER `synthesis_started` and AFTER the text response streams. It arrives as the last event before the stream closes.

---

## Part 3 — Client: Render Action Cards

### In `useConversationStream.ts`

Add handling for `suggested_actions` event:

```typescript
case 'suggested_actions':
  // Attach actions to the most recent assistant message
  setState(prev => ({
    ...prev,
    messages: prev.messages.map((msg, idx) => 
      idx === prev.messages.length - 1
        ? { ...msg, suggestedActions: event.data.actions }
        : msg
    )
  }));
  break;
```

### In `ChatPanel.tsx` or `ConversationView.tsx`

After each assistant message, check for `suggestedActions`. If present, render an action panel below the message:

```
─────────────────────────────────────────────────────────
⚡  5 actions identified from this analysis

  P1  Run MEDDIC Coverage on 4 deals                    [Run now ▶]
      Transcripts available — score qualification gaps

  P1  Create deal audit tasks (4 deals)                 [Create tasks ▶]
      "Confirm trigger event, blockers, kill risks" — due Friday
      
  P2  Update forecast categories                        [Review ▶]
      Commit: $110K · Best Case: $88K · Pipeline: $87K
      Requires approval — protected field
      
  P2  Fix stale close dates (3 deals)                  [Review ▶]
      All showing April 22 — likely placeholder
      Requires approval — protected field
      
  P3  Run Pipeline Hygiene Check                        [Run now ▶]
      Stage velocity data missing from this analysis

─────────────────────────────────────────────────────────
```

### `SuggestedActionsPanel` component (new)

Create `client/src/components/assistant/SuggestedActionsPanel.tsx`:

```typescript
interface SuggestedActionsPanelProps {
  actions: ExtractedAction[];
  workspaceId: string;
  onActionComplete: (actionId: string, result: string) => void;
}
```

**Each action row:**
- Priority badge (P1/P2/P3) — coral for P1, amber for P2, muted for P3
- Title + description
- Evidence text (muted, smaller)
- Threshold note if applicable ("Requires approval — protected field")
- Action button — adapts to `execution_mode`:
  - `auto` → "[Run now ▶]" — executes immediately on click
  - `queue` → "[Create tasks ▶]" — syncs to actions table, appears in Pending Actions
  - `hitl` → "[Review ▶]" — opens a confirmation modal showing what will change

**Action button behavior:**

```typescript
async function handleAction(action: ExtractedAction) {
  setLoading(action.id, true);
  
  switch (action.type) {
    case 'run_skill':
      // POST /skills/:skill_id/run
      // Show toast: "Pipeline Hygiene Check started — results in ~60s"
      break;
      
    case 'create_crm_tasks':
      // POST /deals/:deal_id/actions/sync for each deal
      // Show toast: "4 tasks created in HubSpot"
      break;
      
    case 'run_meddic_coverage':
      // POST /skills/meddic-coverage/run with deal_id
      // Show toast: "MEDDIC Coverage running for [deal name]"
      break;
      
    case 'update_forecast_category':
    case 'update_close_date':
      // Open confirmation modal showing:
      //   Field: forecast_category
      //   Current: Pipeline
      //   Proposed: Commit
      //   Evidence: [from action.evidence]
      //   [Confirm ▶]  [Cancel]
      // On confirm: POST /actions/:id/approve
      break;
  }
  
  setLoading(action.id, false);
  onActionComplete(action.id, 'success');
}
```

**After execution:** Replace the action row with a ✅ confirmation and the result ("4 tasks created", "Skill running", etc.). Don't remove the row — keep it as a record of what was done.

**Dismiss all:** Small "Dismiss suggestions" link at the bottom of the panel. Removes the panel entirely for this message. Does not create any records.

---

## Part 4 — Confirmation Modal for HITL Actions

For `execution_mode: 'hitl'` actions (forecast category, close date, stage), clicking "[Review ▶]" opens a modal:

```
┌──────────────────────────────────────────────────────────┐
│  Update Forecast Category                            ✕   │
├──────────────────────────────────────────────────────────┤
│  Deal:    Priya's Deal ($110K)                           │
│  Field:   Forecast Category                              │
│  Current: Pipeline                                       │
│  Proposed: Commit                                        │
│                                                          │
│  Evidence:                                               │
│  "Deal is in Contract Sent stage — Pandora identified    │
│   this as Commit-eligible based on stage + EB status"   │
│                                                          │
│  ⚠️  This field always requires approval before writing  │
│      to CRM. Write will be logged and reversible.        │
│                                                          │
│  [Confirm — write to CRM ▶]          [Cancel]           │
└──────────────────────────────────────────────────────────┘
```

On confirm: calls the appropriate approval endpoint. Shows ✅ in the action row.

---

## Part 5 — Bulk Actions

When multiple actions of the same type exist (e.g., 4 deals all need tasks), surface a bulk option:

```
P1  Create deal audit tasks (4 deals)
    Priya ($110K) · Marcus ($88K) · Deal 3 · Deal 4
    [Create all 4 tasks ▶]   [Review individually]
```

"Create all 4 tasks ▶" fires `POST /deals/:id/actions/sync` for each deal in parallel. Shows progress: "Creating... 3/4 complete". Final toast: "4 tasks created in HubSpot".

---

## Part 6 — Ask Pandora as Action Initiator

When the user responds to an action suggestion conversationally, Pandora should recognize it and execute:

```
User: "Yes, run the MEDDIC on all of them"
→ Pandora calls run_meddic_coverage_skill for each deal from prior context
→ "Running MEDDIC Coverage on 4 deals. I'll surface the results when complete."

User: "Go ahead and create those tasks"  
→ Pandora calls create_crm_tasks for the deals identified in prior turn
→ "Created 4 audit tasks in HubSpot, assigned to Nate and Sara."

User: "Update the forecast categories like you suggested"
→ Pandora shows HITL confirmation for each protected field
→ Waits for explicit confirmation before writing
```

This requires the prior turn's extracted actions to be available in the conversation context. Store `suggestedActions` in the session state and include them in the next turn's context:

```
PRIOR SUGGESTED ACTIONS (available to execute):
  - run_meddic_coverage: 4 deals [Priya, Marcus, Deal 3, Deal 4]
  - create_crm_tasks: 4 deals, "Deal audit" title, due Friday
  - update_forecast_category: Priya → Commit, Marcus → Best Case
```

---

## Files to Create / Modify

| File | Action |
|---|---|
| `server/chat/action-extractor.ts` | Create |
| `server/chat/pandora-agent.ts` | Call extractor after synthesis, emit `suggested_actions` SSE |
| `client/src/components/assistant/SuggestedActionsPanel.tsx` | Create |
| `client/src/components/assistant/ActionConfirmModal.tsx` | Create |
| `client/src/hooks/useConversationStream.ts` | Handle `suggested_actions` event |
| `client/src/components/ChatPanel.tsx` | Render `SuggestedActionsPanel` after assistant messages |

---

## Threshold Integration

The action extractor must call `ThresholdResolver` to determine `execution_mode` for each action. Import `getActionThresholdResolver()` from the threshold module.

Fields that are always `hitl` regardless of workspace threshold:
- `forecast_category`
- `deal_stage`
- `amount`
- `close_date`

Fields that respect workspace threshold:
- `next_action_date`
- `next_steps`
- All MEDDIC fields

Skill runs are always `auto` — no CRM write risk.
Task creation is always `queue` — creates a task, not a field write.

---

## Constraints

- **No extra LLM calls** — the extractor is pattern-matching only. Zero token cost.
- **Max 6 actions per response** — don't overwhelm the UI
- **Actions panel only shows for complex responses** — if `toolProgress.length < 3`, suppress the panel entirely
- **Never auto-execute HITL actions** — even if user says "yes do it all", HITL fields always get a confirmation modal
- **Actions persist in session** — prior turn's suggested actions are available for conversational follow-up
- **Dismiss is always available** — user can always remove the panel

---

## Exit Criteria

- "Tell me about deal hygiene and forecast" response surfaces 4-6 action cards below the analysis
- "[Run now ▶]" on a skill action triggers the skill and shows a toast
- "[Create tasks ▶]" creates CRM tasks and shows "4 tasks created in HubSpot"
- "[Review ▶]" on a forecast category action opens confirmation modal
- Confirming the modal writes to CRM via the existing approval flow
- "Yes, run the MEDDIC on all of them" (follow-up turn) executes without requiring the user to click the card
- Actions panel only appears when 3+ tools were called
- Dismissed panel doesn't reappear on page reload
- Workspace threshold is respected — HITL fields always get modal regardless of threshold setting
