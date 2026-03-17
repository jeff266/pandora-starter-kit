# Replit Prompt: Surface 4 — Deliberation Output Renderer

## Context

Surfaces 1–3 are complete and demo-ready:
- Surface 1: Standing hypothesis cards with breach state
- Surface 2: "Challenge This Plan" button renders on breached cards
- Surface 3: `runHypothesisRedTeam()` executes and writes to `deliberation_runs`

Surface 4 is the missing last step: reading a completed `deliberation_runs`
record and rendering it as a readable Prosecutor → Defense → Verdict exchange
on the hypothesis card. Right now the button clicks, the run completes, and
nothing appears — there is no formatter for the deliberation schema.

This is a **pure rendering task**. No new AI calls, no new DB writes, no new
compute. The data exists. It just needs a display layer.

---

## Step 0: Read Before Building

Read these files before writing any code:

1. The `deliberation_runs` table migration — confirm the exact column names
   for `perspectives` (JSONB array) and `verdict` (JSONB object). Also
   confirm `hypothesis_id`, `status`, and `created_at` exist.

2. The hypothesis card component — find where the "Challenge This Plan" button
   renders. This is where the deliberation output needs to appear after the
   run completes.

3. The endpoint that `runHypothesisRedTeam()` calls — confirm it returns the
   `deliberation_run` ID on success. If it doesn't, add it to the response:
   `{ success: true, deliberation_run_id: run.id }`

4. Any existing Slack formatter files — find where hypothesis alert Slack
   messages are built so you know where to add the deliberation Slack output.

Report what you find before building.

---

## Step 1: GET Endpoint for Deliberation Run

Create a route that fetches a completed deliberation run by ID:

```
GET /api/workspaces/:workspaceId/deliberations/:deliberationRunId
```

### Handler logic

```typescript
// Fetch the deliberation run, scoped to workspace
const run = await query(`
  SELECT
    id,
    hypothesis_id,
    pattern,
    trigger_surface,
    perspectives,
    verdict,
    token_cost,
    created_at,
    status
  FROM deliberation_runs
  WHERE id = $1
    AND workspace_id = $2
`, [deliberationRunId, workspaceId]);

if (!run.rows.length) return res.status(404).json({ error: 'Not found' });

return res.json({ deliberation: run.rows[0] });
```

Auth: same workspace auth middleware as all other routes. Rep role
can read deliberations for deals they own. Admin reads all.

---

## Step 2: DeliberationRenderer utility

Create `server/renderers/deliberation-renderer.ts`

This is a pure formatting function — no async, no DB calls. Takes a
`deliberation_runs` row and returns structured output for both UI and Slack.

### The `perspectives` JSONB schema (from the migration):

```typescript
// Each item in the perspectives array:
interface Perspective {
  agent: string;       // 'prosecutor' | 'defense' | 'verdict'
  argument: string;    // The narrative text
  data_points: string[]; // Supporting evidence bullets
}
```

### The `verdict` JSONB schema:

```typescript
interface Verdict {
  conclusion: string;       // One-sentence summary
  expected_value?: number;  // Dollar value if applicable
  key_variable: string;     // The pivotal unknown
  re_evaluate_by?: string;  // ISO date string
}
```

### Implementation:

```typescript
// server/renderers/deliberation-renderer.ts

const AGENT_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  prosecutor: { label: 'Skeptic',  emoji: '⚠️',  color: '#E53E3E' },
  defense:    { label: 'Advocate', emoji: '✅',  color: '#38A169' },
  verdict:    { label: 'Synthesis', emoji: '⚖️', color: '#3182CE' },
};

export interface DeliberationUIOutput {
  deliberation_run_id: string;
  hypothesis_id: string;
  pattern: string;
  perspectives: {
    role: string;
    label: string;
    emoji: string;
    color: string;
    argument: string;
    data_points: string[];
  }[];
  verdict: {
    conclusion: string;
    expected_value?: number;
    key_variable: string;
    re_evaluate_by?: string;
    re_evaluate_by_formatted?: string; // "March 29, 2026"
  } | null;
  created_at: string;
  token_cost: number;
}

export function formatDeliberationForUI(run: any): DeliberationUIOutput {
  const perspectives = (run.perspectives || []).map((p: any) => ({
    role: p.agent,
    label: AGENT_LABELS[p.agent]?.label || p.agent,
    emoji: AGENT_LABELS[p.agent]?.emoji || '•',
    color: AGENT_LABELS[p.agent]?.color || '#718096',
    argument: p.argument,
    data_points: p.data_points || [],
  }));

  const verdict = run.verdict
    ? {
        ...run.verdict,
        re_evaluate_by_formatted: run.verdict.re_evaluate_by
          ? new Date(run.verdict.re_evaluate_by).toLocaleDateString('en-US', {
              month: 'long', day: 'numeric', year: 'numeric',
            })
          : undefined,
      }
    : null;

  return {
    deliberation_run_id: run.id,
    hypothesis_id: run.hypothesis_id,
    pattern: run.pattern,
    perspectives,
    verdict,
    created_at: run.created_at,
    token_cost: run.token_cost || 0,
  };
}

export function formatDeliberationForSlack(run: any): any[] {
  const formatted = formatDeliberationForUI(run);
  const blocks: any[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '⚖️ Hypothesis Challenge Complete' },
  });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Pattern: ${formatted.pattern}  •  ${formatted.token_cost} tokens`,
    }],
  });

  blocks.push({ type: 'divider' });

  // Each perspective
  for (const p of formatted.perspectives) {
    if (p.role === 'verdict') continue; // Verdict gets its own block below

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${p.emoji} *${p.label}*\n${p.argument}`,
      },
    });

    if (p.data_points.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: p.data_points.map((dp: string) => `• ${dp}`).join('\n'),
        },
      });
    }

    blocks.push({ type: 'divider' });
  }

  // Verdict
  if (formatted.verdict) {
    const v = formatted.verdict;
    let verdictText = `⚖️ *Synthesis*\n${v.conclusion}`;
    if (v.expected_value) {
      verdictText += `\n*Expected value:* $${v.expected_value.toLocaleString()}`;
    }
    verdictText += `\n*Key variable:* ${v.key_variable}`;
    if (v.re_evaluate_by_formatted) {
      verdictText += `\n*Re-evaluate by:* ${v.re_evaluate_by_formatted}`;
    }

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: verdictText },
    });
  }

  return blocks;
}
```

---

## Step 3: UI — Deliberation Panel on Hypothesis Card

After the "Challenge This Plan" button is clicked and the run completes,
show the deliberation output below (or replacing) the button on the same card.

### State flow

```
Button click
  → POST /run-red-team
  → Response: { success: true, deliberation_run_id: '...' }
  → Store deliberation_run_id in component state
  → SET status = 'loading'

While loading
  → Show spinner: "Pandora is analyzing..."
  → Poll GET /deliberations/:id every 2s until status = 'complete'
     OR if the POST response already returns the full run, skip polling

On complete
  → Call formatDeliberationForUI() on the result
  → Render the DeliberationPanel component
  → Hide the button (replaced by the panel)
```

### DeliberationPanel component (inline on the card)

```
┌─────────────────────────────────────────────────────┐
│  ⚖️  Hypothesis Challenge                           │
│  conversion_rate  •  35.6% vs 36% target            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ⚠️  SKEPTIC                                        │
│  Conversion has trended down 3 points in 6 weeks.  │
│  • Q1 week-3 pipeline was 2.9x, but conversion     │
│    rate suggests structural close rate erosion      │
│  • Large deal cohort is 0.6 vs historical 236       │
│  • 4 deals in late stage have been silent 22+ days  │
│                                                     │
│  ✅  ADVOCATE                                       │
│  137% attainment YTD signals the team can close.   │
│  • Q1 is overperforming — current gap is narrow     │
│  • Pipeline coverage at 2.9x exceeds 2.5x target   │
│  • 3 large deals have strong contact engagement     │
│                                                     │
│  ⚖️  SYNTHESIS                                      │
│  Conversion gap is real but recoverable this        │
│  quarter. Key variable: whether the 4 silent late-  │
│  stage deals re-engage before March 29.             │
│  Re-evaluate by: March 29, 2026                    │
│                                                     │
│  [Ask Pandora about this]        [Dismiss]          │
└─────────────────────────────────────────────────────┘
```

Implementation notes:
- The panel replaces the button in the card's action area — don't show both
- "Ask Pandora about this" opens Ask Pandora pre-seeded with:
  `"Tell me more about the hypothesis challenge on [metric_key]"`
- "Dismiss" collapses the panel back to the card default state (does not
  delete the deliberation run — just hides it in the UI)
- Render data_points as a bulleted list under each argument
- Color the role label using the color from `formatDeliberationForUI()`
  (red for Skeptic, green for Advocate, blue for Synthesis)
- If `re_evaluate_by` is present, show it as a footer line on the Synthesis block
- If `expected_value` is present, show it prominently under Synthesis

### Loading state

```tsx
// While deliberation is running
<div className="deliberation-loading">
  <Spinner size="sm" />
  <span>Pandora is building the case...</span>
</div>
```

---

## Step 4: Wire the Run Response to the Panel

The POST endpoint for the red team run currently returns `{ success: true }`.
Update it to also return the full deliberation run record so the UI doesn't
need to poll:

```typescript
// In the red team run endpoint, after writing to deliberation_runs:
const run = await db.query(
  'SELECT * FROM deliberation_runs WHERE id = $1',
  [newRunId]
);

return res.json({
  success: true,
  deliberation_run_id: newRunId,
  deliberation: formatDeliberationForUI(run.rows[0]),
});
```

If the run is async (queued), return `deliberation_run_id` only and have
the UI poll the GET endpoint until `status = 'complete'`.

---

## Acceptance Criteria

- [ ] GET `/deliberations/:id` returns the full run record scoped to workspace
- [ ] `formatDeliberationForUI()` correctly maps `perspectives` array to
      labeled, colored role blocks
- [ ] `formatDeliberationForSlack()` produces valid Slack Block Kit JSON —
      paste into Slack Block Kit Builder to verify
- [ ] Clicking "Challenge This Plan" shows a loading state, then renders
      the DeliberationPanel when complete
- [ ] Panel shows all three perspectives (Skeptic, Advocate, Synthesis)
      with data_points as bullets under each
- [ ] Verdict shows `key_variable` and `re_evaluate_by` if present
- [ ] "Ask Pandora about this" button pre-seeds the Ask Pandora input
- [ ] "Dismiss" collapses the panel without deleting the run
- [ ] The `conversion_rate` breach card (the demo hypothesis) successfully
      shows the full Prosecutor → Defense → Verdict exchange after running

## Do Not Build

- Do not add a new AI call inside the renderer — all content comes from
  `deliberation_runs.perspectives` and `deliberation_runs.verdict`
- Do not modify `runHypothesisRedTeam()` logic
- Do not add a separate "deliberation history" page — that's post-demo
- Do not add Slack delivery of the deliberation output — that's a follow-on;
  the formatter just needs to exist and be tested locally for now
