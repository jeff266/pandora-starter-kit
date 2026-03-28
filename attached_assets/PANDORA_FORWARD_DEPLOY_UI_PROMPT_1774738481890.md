# PANDORA: Forward Deployment UI — Replit Build Prompt

**Surface:** Workspace Settings / Config tab
**Users:** Jeff (forward deployment specialist) + client (on a shared screen call)
**Flow:** 5-phase linear wizard — Ingest → Checklist → Confirmation → Lock → Infuse
**API:** All endpoints built in Phase 10 of WorkspaceIntelligence build

---

## Pre-read before building anything

```
Read these files first:
- server/routes/forward-deploy.ts — all 8 API endpoints, request/response shapes
- server/lib/calibration-questions.ts — 108 questions, domains, answer_types
- server/lib/skill-manifests.ts — 38 skills, required_checklist_items
- server/types/workspace-intelligence.ts — WorkspaceIntelligence shape
- client/src/ — find the existing workspace settings/config page and understand
  how it's structured, what tab pattern is used, what components exist
- client/src/components/ — find existing UI components: buttons, inputs,
  modals, progress indicators, badges
```

**Do not build in isolation.** Match the existing Pandora UI patterns exactly —
same fonts, same colors, same component library, same spacing system.
This screen is shown to clients. It must feel like the rest of the product.

---

## Where it lives

Find the existing workspace settings or config route. Add a new tab called
**"Forward Deployment"** alongside existing tabs.

Route: `/workspaces/:id/settings/forward-deploy` or equivalent
that matches the existing settings URL pattern.

If settings uses a tab component, add Forward Deployment as a tab.
If settings uses a sidebar nav, add it as a nav item.
Match whatever pattern already exists.

---

## Page structure overview

```
┌─────────────────────────────────────────────────────────────┐
│  Forward Deployment                          Readiness: 3%  │
│  Configure Pandora's understanding of your business         │
├─────────────────────────────────────────────────────────────┤
│  ① Ingest  ② Checklist  ③ Confirm  ④ Lock  ⑤ Infuse       │
│  ━━━━━━━━━━━━━━━○──────────────────────────────────        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Phase content area]                                       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                          [Back]  [Continue →]               │
└─────────────────────────────────────────────────────────────┘
```

The phase stepper is always visible. Progress bar fills as readiness score rises.
Navigation between phases is free — clicking a completed phase step goes back.
A phase is "completed" when its minimum requirements are met, not just visited.

---

## Data loading

On mount, load:

```typescript
// 1. Full WorkspaceIntelligence (for readiness, skill gates, pipeline config)
GET /api/workspaces/:id/intelligence

// 2. Calibration checklist (for all 108 questions with current answers)
GET /api/workspaces/:id/calibration

// 3. Metrics list (for confirmation phase)
GET /api/workspaces/:id/metrics
```

Cache locally in component state. Invalidate and re-fetch after any PATCH or POST.

Show a loading skeleton while fetching — do not show empty states.

---

## Phase 1: Ingest

**Purpose:** Give Pandora context before the checklist. Upload transcripts, docs,
or notes from the sales call. Also shows what was already auto-discovered from CRM.

**Left column: Auto-discovered**

Pull from `WorkspaceIntelligence` and show what Pandora already knows:

```
✅ CRM Connected — HubSpot
✅ 10 active pipeline stages detected
✅ Stage history available
✅ 24 fields tracked in data dictionary
⚠️  No segment field confirmed
⚠️  No deal type taxonomy confirmed
❌ No revenue model configured
```

Each item is a row with a status icon, label, and a small "Configure →" link
that jumps directly to the relevant question in Phase 2.

**Right column: Upload**

```
┌────────────────────────────────┐
│  Drop files here               │
│  or click to browse            │
│                                │
│  Accepts: PDF, DOCX, TXT, MD   │
│  Max 10MB per file             │
└────────────────────────────────┘

Or paste notes from the sales call:
┌────────────────────────────────┐
│  [Textarea — free text]        │
│                                │
└────────────────────────────────┘
[Save Notes]
```

For Phase 1, file upload stores locally (no backend processing yet — flag as
"saved, will be processed"). Notes save to `workspace_knowledge` via an existing
endpoint if one exists, otherwise skip for now.

**Phase 1 is never blocked** — user can always continue to Phase 2.
Show a note: "You can always come back and add more context."

---

## Phase 2: Checklist

**Purpose:** Answer the 108 questions across 6 domains. This is the main
configuration surface. Designed to be completed collaboratively on a call.

**Left sidebar: Domain navigation**

```
Domain              Progress
─────────────────────────────
Pipeline            3 / 18  ●●○○○○○○○○○○○○○○○○
Segmentation        0 / 12  ○○○○○○○○○○○○
Taxonomy            0 / 18  ○○○○○○○○○○○○○○○○○○
Metrics             1 / 24  ●○○○○○○○○○○○○○○○○○○○○○○○
Business            0 / 18  ○○○○○○○○○○○○○○○○○○
Data Quality        2 / 18  ●●○○○○○○○○○○○○○○○○
─────────────────────────────
Total               6 / 108
```

Filled circles = confirmed or inferred. Empty = unknown.
Clicking a domain scrolls the right panel to that section.

**Right panel: Questions**

Group questions by domain with a sticky domain header.
Each question is a card:

```
┌─────────────────────────────────────────────────────────────┐
│ Which stages count as active pipeline?          [REQUIRED]  │
│ Used by: pipeline-waterfall, pipeline-coverage, +4 more     │
│                                                             │
│ [Stage picker — multi-select from CRM stages]               │
│                                                             │
│ ● INFERRED from CRM scan    Confidence: 90%                 │
│ Pilot, Negotiation, Contract Sent, Demo Conducted...        │
│                                              [Confirm] [Edit]│
└─────────────────────────────────────────────────────────────┘
```

**Question card states:**

UNKNOWN — shows empty input, no pre-fill
INFERRED — shows pre-filled answer with confidence badge and source,
           Confirm button to promote to CONFIRMED
CONFIRMED — shows answer with green checkmark, Edit button to change

**Answer input types** (match `answer_type` from CalibrationQuestion):

- `stage_picker` — multi-select dropdown populated from `wi.pipeline.active_stages`
  plus excluded stages. Show all known stages as options.
- `field_picker` — searchable dropdown of field names from data dictionary
- `select` — radio group using `options` array from question definition
- `multiselect` — checkbox group using `options` array
- `boolean` — toggle switch with Yes / No labels
- `number` — number input with appropriate units hint
- `text` — textarea for free text

**Confirming an INFERRED answer:**

```
PATCH /api/workspaces/:id/calibration/:questionId
Body: { answer: { value: currentAnswer }, status: 'CONFIRMED', confirmed_by: userEmail }
```

Re-fetch WI readiness after each confirm. Update domain progress in sidebar.

**Saving a new answer:**

```
PATCH /api/workspaces/:id/calibration/:questionId
Body: { answer: { value: inputValue }, status: 'CONFIRMED', confirmed_by: userEmail }
```

**Depended-on questions:**

If a question has `depends_on` array, show it grayed out with a note:
"Answer [parent question] first" until the parent is answered.

**Required for LIVE badge:**

Questions with `required_for_live: true` show a red "REQUIRED" badge.
Questions that are `required_for_live: false` show a gray "OPTIONAL" badge.

**Skill impact tooltip:**

Hovering the "Used by: pipeline-waterfall, +4 more" text shows a popover
listing all skills this question gates, with their current gate status
(LIVE / DRAFT / BLOCKED).

**Phase 2 completion:**
Phase 2 is "complete enough" to proceed when all `required_for_live` questions
across priority skills (pipeline-waterfall, pipeline-coverage, rep-scorecard,
forecast-rollup) are either CONFIRMED or INFERRED.
Show a banner: "Priority skills configured. Continue to confirmation, or keep
filling in optional questions."

---

## Phase 3: Confirmation

**Purpose:** Pandora shows computed baseline numbers. Jeff and the client confirm
whether these match reality. Binary yes/no per metric.

**Layout: Cards grid (2 columns)**

One card per metric from `/api/workspaces/:id/metrics`.
Only show metrics where `last_computed_value` is non-null.
Metrics with null computed value show a "Not yet computed" state.

```
┌─────────────────────────────────────┐
│ Win Rate                     INFERRED│
│                                      │
│  Pandora calculated:                 │
│  ████████████████░░░░  23%           │
│                                      │
│  Does this match your records?       │
│  [✓ Yes, that's right] [✗ No, fix it]│
└─────────────────────────────────────┘
```

**On "Yes, that's right":**
```
POST /api/workspaces/:id/metrics/:metricKey/confirm
Body: { confirmed_value: last_computed_value, confirmed: true, confirmed_by: userEmail }
```
Card turns green. Metric confidence upgrades to CONFIRMED.

**On "No, fix it":**
Card expands to show:
```
What should Win Rate be?  [____%]
Why is Pandora wrong?     [text field — optional]
[Submit correction]
```

On submit:
```
POST /api/workspaces/:id/metrics/:metricKey/confirm
Body: { confirmed_value: userValue, confirmed: false, confirmed_by: userEmail }
```
Card turns amber. Shows note: "Pandora's calculation will be reviewed.
Check metric definition in the Metrics tab."

**Progress indicator:**
"X of Y metrics confirmed" shown at top of phase.
Phase 3 is complete when all non-null metrics have been confirmed or flagged.

---

## Phase 4: Lock

**Purpose:** Summary of what's been configured. Shows what's confirmed,
what's still unknown, and which skills will go LIVE vs DRAFT.

**Top section: Readiness score**

```
┌─────────────────────────────────────────────────────────────┐
│  Configuration Readiness                                    │
│                                                             │
│  ████████████████████████████░░░░░░░░░░  68%               │
│                                                             │
│  Pipeline ████████ 80%    Segmentation ███░░░░ 42%         │
│  Taxonomy ██████░░ 60%    Metrics      █████░░░ 58%         │
│  Business ████░░░░ 44%    Data Quality ██████░░ 67%         │
└─────────────────────────────────────────────────────────────┘
```

**Middle section: Skill gates table**

```
Skill                    Gate     Missing
─────────────────────────────────────────────────────────────
Pipeline Waterfall       ● LIVE   —
Pipeline Coverage        ● LIVE   —
Rep Scorecard            ● DRAFT  attainment_method
Forecast Rollup          ● DRAFT  forecast_categories
Win/Loss Analysis        ● DRAFT  win_rate_denominator
Deal Stage History       ● LIVE   —
...
```

LIVE = green dot. DRAFT = amber dot. BLOCKED = red dot.
Each DRAFT/BLOCKED row shows which checklist items are missing.
Clicking a missing item jumps back to Phase 2 at that question.

**Bottom section: Gaps summary**

```
⚠️  12 required questions unanswered

These skills will run in DRAFT mode until configured:
Rep Scorecard, Forecast Rollup, Win/Loss Analysis...

Skills in DRAFT mode include a warning in their output that
configuration is incomplete. Results are directionally correct.

[Go back and fill gaps]    [Lock and continue →]
```

"Lock and continue" is always available — DRAFT mode skills still run.
The lock action is informational, not a system operation. It just advances
the wizard to Phase 5.

---

## Phase 5: Infuse

**Purpose:** Confirmation that the configuration is active and skills are running
against it. Show what changed. Give Jeff a summary to share with the client.

**Top: Activation summary**

```
✅ WorkspaceIntelligence Active

Pandora now knows your business.

Configured:           68 / 108 answers
Skills going LIVE:    24 / 38
Skills in DRAFT:      14 / 38 (will improve as you add context)
Metrics confirmed:    9 / 15
```

**Middle: What's different now**

Show before/after for the 4 priority skills:

```
Pipeline Waterfall
Before: Running without stage config — generic output
After:  Uses your 10 confirmed active stages, segments by deal type

Pipeline Coverage
Before: No coverage target — couldn't calculate ratio
After:  3.0x target confirmed, coverage calculated per segment

Rep Scorecard
Before: DRAFT — attainment_method not confirmed
After:  DRAFT — confirm quota currency to go LIVE
```

**Bottom: Next steps panel**

```
To complete configuration:
1. Confirm attainment_method (quota currency) → enables Rep Scorecard
2. Confirm forecast_categories → enables Forecast Rollup
3. Confirm segmentation_field → enables segment-level breakdowns

Schedule a 30-min follow-up to confirm remaining metrics.
```

**Export button:**

```
[Download Configuration Summary]
```

Generates a simple text/markdown summary of all CONFIRMED answers for the client's
records. Client can review what Pandora was told.

**Run skills button:**

```
[Run Skills Now →]
```

Triggers skill execution (if this functionality exists) or navigates to the
skills/dashboard page.

---

## Persistent header (all phases)

```
┌─────────────────────────────────────────────────────────────┐
│  Forward Deployment — Frontera Health                       │
│  Overall readiness: 3%  ●●○○○○○○○○○○○○○○○○○○              │
│                                                             │
│  Skills LIVE: 16    DRAFT: 22    BLOCKED: 0                 │
└─────────────────────────────────────────────────────────────┘
```

This updates in real time as questions are answered.
Re-fetch `/api/workspaces/:id/intelligence/readiness` after each answer.

---

## State management

Use React Query or equivalent for data fetching. Key queries:

```typescript
// Keys
['workspace-intelligence', workspaceId]
['workspace-calibration', workspaceId]
['workspace-metrics', workspaceId]

// Invalidate all three after any mutation
```

Local state:
- `currentPhase: 1 | 2 | 3 | 4 | 5`
- `activeDomain: string` (Phase 2 sidebar selection)
- `pendingAnswers: Map<string, any>` (unsaved changes before submit)

---

## Error handling

Every API call needs error handling:

- Network error → toast: "Connection lost. Changes may not have saved."
- 400 validation error → inline error under the relevant input
- 401 → redirect to login
- 500 → toast: "Something went wrong. Try again."

Optimistic updates: update UI immediately on PATCH, revert on error.

---

## Acceptance criteria

1. Forward Deployment tab appears in workspace settings alongside existing tabs
2. Phase stepper renders correctly, phases advance and can go back
3. Readiness score and domain progress update after each confirmed answer
4. All 6 domains visible in Phase 2 with correct question counts
5. INFERRED answers show pre-filled with Confirm button
6. Confirming an INFERRED answer calls PATCH and updates UI without full reload
7. Phase 3 shows metric cards with computed values for Frontera
8. Skill gates table in Phase 4 shows correct LIVE/DRAFT status
9. Phase 5 shows correct before/after summary
10. No console errors. No broken API calls.
11. Unauthenticated state handled gracefully (redirect, not crash)

---

## Do not build

- File processing / transcript parsing (Phase 1 upload is UI only for now)
- CRM re-scan trigger (future feature)
- Automated infuse / push to skills (skills already read from WI at runtime)
- Any new backend logic — all API endpoints exist, UI calls them only

---

*End of prompt. Build Phase 2 (Checklist) first — it is the highest-value surface.
Phases 1, 3, 4, 5 can be stubbed initially and filled in.*
