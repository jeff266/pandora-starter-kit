# Replit Prompt: Agent Detail Page — Run History + Diff View

## Context

`agent_runs` now has two new columns from the goal-aware synthesis build:
- `synthesis_output TEXT` — the full Claude synthesis text for each run
- `synthesis_mode TEXT` — 'findings_dump' | 'goal_aware'

The Agent detail page already shows basic run history. This prompt adds:
1. **Run history panel** — enriched rows with finding counts, trend indicators,
   synthesis mode badge, and a [Diff ↕] button
2. **Diff view** — side-by-side comparison of synthesis output between any two
   runs, parsed by section (Status / Q&A / Actions)
3. **Backend endpoint** — `GET /agents/:agentId/runs` returning the data the
   panel needs

---

## Before You Start

Scan these files first:

1. **The Agent detail page** — find where run history is currently rendered.
   What data is already fetched? What columns from `agent_runs` are already
   used? You're extending what exists, not replacing it.

2. **`agent_runs` table schema** — check the latest migration. Confirm
   `synthesis_output` and `synthesis_mode` exist. Also note what other columns
   are present: `status`, `created_at`, `completed_at`, `findings_count` (or
   similar), `total_tokens`, etc. You'll use these for the run history rows.

3. **How the Agent detail page fetches data** — find the `useQuery` call(s).
   Use the same pattern for the new endpoint.

4. **Existing diff library** — check `package.json` for `diff`, `diff-match-patch`,
   or similar. If none exists, install `diff` (it's tiny, well-maintained, and
   already used across many projects). Use `diffWords()` from it.

5. **Modal/drawer pattern** — the diff view opens as a slide-over drawer or
   full-width panel below the run row. Find how other drawers/modals are
   implemented in the codebase and use the same component (likely shadcn Sheet
   or Dialog).

---

## Task 1: Backend Endpoint

Add to the appropriate agents routes file:

```typescript
/**
 * GET /api/workspaces/:workspaceId/agents/:agentId/runs
 *
 * Returns paginated run history for an agent.
 * Includes synthesis_output for diff view and enough metadata for the
 * run history panel rows.
 *
 * Query params:
 *   limit  — default 20, max 50
 *   before — ISO timestamp for cursor pagination (optional)
 *
 * Auth: same workspace membership check as existing agent endpoints.
 */

// Response shape per run:
interface AgentRunSummary {
  id: string;
  status: 'success' | 'failed' | 'running';
  synthesis_mode: 'findings_dump' | 'goal_aware' | null;
  started_at: string;           // ISO
  completed_at: string | null;  // ISO
  duration_ms: number | null;
  findings_count: number | null;  // total claims across all skills
  skills_run: string[];
  total_tokens: number | null;
  synthesis_output: string | null;  // Full text — used by diff view
  error_message: string | null;     // Only populated on failed runs
}
```

**Important:** Only return `synthesis_output` for `goal_aware` runs. For
`findings_dump` runs, return `null` for `synthesis_output` — the diff view
only works between goal-aware runs. This avoids sending large text payloads
for runs that won't be diffed.

**Trend calculation** — compute server-side before returning:

```typescript
// For each run (except the first), compare findings_count to previous run:
// findings_count decreased → trend: 'improving'
// findings_count increased → trend: 'worsening'  
// same              → trend: 'stable'
// no prior run      → trend: null
```

Add `trend: 'improving' | 'worsening' | 'stable' | null` to each run in the
response.

---

## Task 2: Run History Panel

Replace or extend the existing run history section on the Agent detail page.

**Row layout:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ✓  Mar 3, 8:02 AM   goal_aware   4 findings  ↓ improving          │
│                                   [View Output]  [Diff ↕]           │
├─────────────────────────────────────────────────────────────────────┤
│  ✓  Feb 24, 8:01 AM  goal_aware   6 findings  — stable             │
│                                   [View Output]  [Diff ↕]           │
├─────────────────────────────────────────────────────────────────────┤
│  ✓  Feb 17, 8:03 AM  findings_dump  2 findings                     │
│                                   [View Output]                      │
├─────────────────────────────────────────────────────────────────────┤
│  ✗  Feb 10, 8:00 AM  Failed                   [Retry]              │
└─────────────────────────────────────────────────────────────────────┘
```

**Per-row details:**

- **Status icon**: green checkmark (success), red X (failed), spinner (running)
- **Date/time**: formatted as "Mar 3, 8:02 AM" — not ISO
- **synthesis_mode badge**: small pill
  - `goal_aware` → teal pill, text "goal-aware"
  - `findings_dump` → gray pill, text "standard"
  - `null` → no badge
- **findings_count**: "N findings" — omit if null
- **trend indicator**:
  - `improving` → green ↓ arrow + "improving"
  - `worsening` → red ↑ arrow + "worsening"
  - `stable` → gray — + "stable"
  - `null` → nothing
- **[View Output]**: opens a drawer/sheet showing the raw `synthesis_output`
  text, formatted as markdown. Only shown if `synthesis_output` is non-null.
- **[Diff ↕]**: only shown when:
  - This run has `synthesis_mode: 'goal_aware'`
  - There is a previous run that also has `synthesis_mode: 'goal_aware'`
  - i.e., the first goal_aware run never shows Diff (nothing to compare to)
- **[Retry]**: only shown on failed runs. Calls the existing run-now endpoint.

---

## Task 3: Diff View Component

Create `client/src/components/agents/RunDiffView.tsx`

Opens as a Sheet (slide-over) or full-width expandable panel directly below
the run row — use whichever pattern is already established in the codebase.

### Section Parsing

The goal-aware synthesis output has a consistent structure:

```
## STATUS AGAINST GOAL
...content...

## STANDING QUESTIONS
Q1: ...
A: ...

Q2: ...
A: ...

## THIS WEEK'S ACTIONS
1. ...
2. ...
```

Parse both outputs into sections before diffing:

```typescript
interface SynthesisSection {
  header: string;   // "STATUS AGAINST GOAL", "STANDING QUESTIONS", "THIS WEEK'S ACTIONS"
  content: string;  // Raw text content of that section
}

function parseSynthesisOutput(text: string): SynthesisSection[] {
  // Split on ## headers
  // Return array of { header, content } objects
  // If parsing fails (non-goal-aware output), return single section with
  // header: "Full Output" and content: entire text
}
```

### Diff Rendering

For each section, render a side-by-side diff:

```
┌─────────────────────────────────────────────────────────────────┐
│  STATUS AGAINST GOAL                                            │
├────────────────────────┬────────────────────────────────────────┤
│  Feb 24 (previous)     │  Mar 3 (current)                       │
│                        │                                        │
│  At risk. Run rate is  │  At risk. Run rate is ~~$143K~~        │
│  $143K/wk vs required  │  $151K/wk vs required $187K/wk.        │
│  $187K/wk.             │  Coverage improved but still short.    │
└────────────────────────┴────────────────────────────────────────┘
```

**Diff highlighting:**
- Use `diffWords()` from the `diff` library
- Removed text: red background `bg-red-950`, strikethrough, muted red text
- Added text: green background `bg-green-950`, green text
- Unchanged text: normal styling

**Header:**

```
Comparing  Feb 24, 8:01 AM  →  Mar 3, 8:02 AM
[6 findings → 4 findings  ↓ improving]
```

**If sections don't match** (one run has 3 standing questions, another has 2):
- Render what exists in both
- For sections only present in one run, show "Not present in [date]" in the
  other column with muted styling

**Empty state** — when the diff shows no changes (identical output):
Show a single centered message: "No changes between these runs."

---

## Task 4: View Output Sheet

Simpler than the diff — just a Sheet/drawer showing the synthesis_output
formatted as markdown.

```
┌───────────────────────────────────────────────────────┐
│  Run Output — Mar 3, 8:02 AM              [×]         │
│  goal-aware  ·  4 findings  ·  2,847 tokens           │
├───────────────────────────────────────────────────────┤
│                                                        │
│  ## STATUS AGAINST GOAL                               │
│  At risk. Run rate is $151K/wk vs...                   │
│                                                        │
│  ## STANDING QUESTIONS                                │
│  **Which deals moved out of commit?**                  │
│  Acme Corp pushed to Q2...                             │
│                                                        │
│  ## THIS WEEK'S ACTIONS                               │
│  1. Jordan: get champion call on Meridian...           │
│                                                        │
└───────────────────────────────────────────────────────┘
```

Use a markdown renderer if one already exists in the codebase (check for
`react-markdown`, `marked`, or similar). If not, a simple pre-formatted text
block with whitespace preserved is acceptable for v1.

---

## Task 5: Pagination

The run history panel loads 20 runs initially. Add a "Load more" button at the
bottom that fetches the next page using cursor pagination (`before` param set
to the `started_at` of the oldest loaded run).

Only show "Load more" if the API returned exactly `limit` runs (indicating
there may be more). Hide it if fewer than `limit` were returned.

---

## Acceptance Criteria

1. **Run history loads** on the Agent detail page with status, date, mode badge,
   findings count, and trend indicator per row.

2. **[Diff ↕] only appears** on `goal_aware` runs that have a prior `goal_aware`
   run to compare against. First goal-aware run never shows Diff.

3. **Diff view opens** showing side-by-side sections with word-level highlighting.

4. **Trend indicators** are correct: if run A had 6 findings and run B had 4,
   run B shows "↓ improving".

5. **[View Output]** opens the synthesis text formatted as markdown.

6. **Failed run row** shows [Retry] button. Clicking it triggers a run.

7. **No synthesis_output** returned for `findings_dump` runs — verify in Network
   tab that the API response has `synthesis_output: null` for those rows.

8. **"Load more"** appears when 20 runs returned, disappears when fewer than 20.

9. **Diff with no changes** shows the empty state message, not blank columns.

10. **Parsing failure** (malformed synthesis_output) degrades gracefully to
    single "Full Output" section rather than crashing the component.

---

## What NOT to Build

- **Automated trend analysis** — the trend is purely `findings_count` delta,
  nothing more sophisticated. No LLM involved.
- **Diff between findings_dump runs** — only goal_aware runs can be diffed.
  The section structure is required for the diff to be meaningful.
- **Pinning or bookmarking runs** — run history is read-only for now.
- **Bulk export of run history** — out of scope.
- **Real-time updates** — polling is fine. No websocket needed for this feature.
