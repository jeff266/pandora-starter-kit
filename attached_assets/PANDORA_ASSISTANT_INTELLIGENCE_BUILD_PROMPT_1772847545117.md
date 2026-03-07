# Pandora Build Prompt: Assistant Intelligence Layer
## Chart Renderer + Data Freshness + Trust Architecture

**Status:** Ready to build  
**Surfaces affected:** Ask Pandora (chat), Assistant / Command Center (VP RevOps Brief)  
**Core principle:** The assistant is a trusted teammate who owns the number — not a report reader. Every claim must be traceable, every number must be fresh, and every chart must be backed by a calculation, not LLM math.

---

## Before Starting

Read and understand these files before writing a single line of code:

1. `server/renderers/types.ts` — RendererInput, RenderOutput, renderer interface
2. `server/renderers/registry.ts` — how renderers are selected and invoked
3. `server/renderers/command-center-renderer.ts` — existing JSON shape for frontend
4. `client/src/pages/AssistantView.tsx` — how the brief and chat are composed
5. `client/src/components/assistant/ProactiveBriefing.tsx` — brief card rendering
6. `client/src/components/assistant/QuickActionPills.tsx` — section navigation
7. `server/agents/orchestrator.ts` — how chat responses are assembled today
8. `server/connectors/hubspot/sync.ts` — sync delta detection patterns
9. The `weekly_briefs` table schema — understand `ai_blurbs`, `the_number`, `deals_to_watch`, `assembled_at`
10. The `deals` table schema — the live source of truth for deal facts

**Do not proceed until you have read all ten.**

---

## Problem Statement

Three trust-breaking failures exist today:

**Failure 1 — Stale briefs presented as current.** The weekly brief assembles on a fixed cron (7 AM UTC). HubSpot syncs independently. When a deal closes between sync and brief assembly, the brief shows wrong attainment. It presents "21% attainment" with no timestamp, no caveat — just confident wrongness.

**Failure 2 — Chat reads brief snapshots, not live data.** When a user asks about a named deal, the chat layer reads `deals_to_watch` from the brief snapshot instead of querying the live `deals` table. A deal that closed yesterday is described as still open. A $315K deal is described as $240K because that was the brief's value at assembly time.

**Failure 3 — No chart rendering in chat or Assistant.** Ask Pandora produces excellent tables. But pipeline by stage, rep coverage comparison, attainment pacing — all of these are better as charts. Neither Ask Pandora nor the Assistant can render them today. The LLM describes what a chart would show instead of showing it.

---

## Architecture Principles for This Build

**The Calculation function is the only math authority.** The LLM never generates, derives, or rounds numeric values. It receives computed values from the Calculation layer and decides how to present them. If a chart spec contains a value not traceable to a `calculation_id`, reject it.

**Named deal queries always hit the live `deals` table.** The brief snapshot is for narrative context only — never for specific deal facts (amount, stage, close date, owner, pipeline). When a user mentions a deal by name, bypass all caches and skill_run outputs.

**Charts are a renderer output, not a frontend feature.** The chart spec is emitted by the LLM response assembler as a structured block, the same way table specs are emitted today. The frontend `<ChartRenderer>` component reads the spec. No chart logic lives in the LLM prompt.

**The brief knows how old it is.** Every brief display shows its assembly timestamp. When a sync has run since assembly and produced material changes (Closed Won, amount delta > 10%, pipeline reclassification), the brief shows a staleness banner and triggers reassembly.

---

## Task List

---

### T1 — Chart Spec Type + Renderer Registry Registration

**Files:** `server/renderers/types.ts`, `server/renderers/registry.ts`

Add `ChartSpec` to the renderer type system alongside the existing `TableSpec`.

```typescript
// Add to server/renderers/types.ts

export type ChartType =
  | 'bar'
  | 'horizontal_bar'
  | 'line'
  | 'stacked_bar'
  | 'waterfall'
  | 'donut';

export interface ChartDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;     // for stacked/grouped
  segment?: string;            // for color mapping
  annotation?: string;         // per-bar callout (e.g. "Below 2x")
}

export interface ChartSpec {
  type: 'chart';
  chartType: ChartType;
  title: string;
  subtitle?: string;           // e.g. "Trailing 90 days · Closed Won only"
  annotation?: string;         // The "so what" — one sentence below the chart
  data: ChartDataPoint[];
  xAxis?: { label: string };
  yAxis?: { label: string; format: 'currency' | 'number' | 'percent' };
  colorMap?: Record<string, string>;   // segment → color token
  source: {
    calculation_id: string;    // Must match a real Calculation function output
    run_at: string;            // ISO timestamp
    record_count: number;
  };
}

// Extend the existing response block union type:
// type ResponseBlock = ProseBlock | TableBlock | ChartBlock | ...
export interface ChartBlock {
  blockType: 'chart';
  spec: ChartSpec;
}
```

**Validation rule:** Before a `ChartSpec` is passed to the frontend, validate that `source.calculation_id` corresponds to a real calculation run in the current session. If not, log a warning and convert the block to a prose fallback describing what the chart would show.

**Acceptance:** `ChartSpec` type exists, is exported, and is included in the response block union. A validation function `validateChartSpec(spec, calculationContext)` exists and rejects specs with unverifiable sources.

---

### T2 — Chart Renderer React Component

**Files:** `client/src/components/shared/ChartRenderer.tsx`

Build a single `<ChartRenderer>` component using Recharts (already in the dependency tree per the Command Center spec). This component is shared — it renders identically in Ask Pandora chat responses and in the Command Center Assistant brief.

```typescript
// client/src/components/shared/ChartRenderer.tsx

interface ChartRendererProps {
  spec: ChartSpec;
  compact?: boolean;   // true in chat (narrower), false in brief/full width
}
```

**Chart type implementations:**

`bar` — `<BarChart>` with vertical bars. Currency y-axis uses `$Xk` / `$XM` formatting. Percent y-axis uses `X%`. Each bar optionally shows a `ChartDataPoint.annotation` as a small label above the bar in coral if it's a warning signal.

`horizontal_bar` — `<BarChart layout="vertical">`. Use for rep comparisons and rankings where label length needs horizontal space.

`line` — `<LineChart>` with dots at data points. Use for time-series: attainment pacing, pipeline trend. Show a reference line for quota/target when a `referenceValue` is present in the spec (add this optional field).

`stacked_bar` — `<BarChart>` with `<Bar stackId="a">` per segment. Use for forecast category breakdown per rep (Commit / Best Case / Pipeline stacked).

`waterfall` — implement as a composed bar chart with invisible base bars and visible delta bars. Colors: teal for positive movement (new, advanced), coral for negative (slipped, lost). This is the pipeline movement chart.

`donut` — `<PieChart>` with `innerRadius`. Use for ICP grade distribution, win/loss split.

**Annotation rendering:** Below every chart, if `spec.annotation` is set, render it as a single line in the voice of the assistant — `fontSize: 13, color: textSecondary, fontStyle: italic, marginTop: 8`. This is the "so what." It is always present on charts rendered in the Assistant brief. It is optional in Ask Pandora.

**Color tokens:** Use the existing dark theme palette. Do not hardcode hex values — import from the shared color constants. Segment color mapping: teal = positive/good, coral = risk/warning, muted = neutral.

**Compact mode:** When `compact={true}`, reduce chart height by 30%, hide subtitle, keep annotation. This is the mode used in Ask Pandora chat responses where horizontal space is constrained.

**Acceptance:** `<ChartRenderer spec={spec} />` renders all six chart types correctly. Annotation renders below. Compact mode renders in a narrower container without overflow.

---

### T3 — Chart Spec Emitter in the LLM Response Assembler

**Files:** `server/agents/orchestrator.ts` (or wherever Ask Pandora chat responses are assembled — scan for the function that builds the system prompt and assembles response blocks)

This is the bridge between "LLM decides what to show" and "ChartRenderer shows it."

**Step 1 — Identify the response assembler.** Find where the system prompt for Ask Pandora and Assistant chat is constructed. This is where chart awareness gets added.

**Step 2 — Add chart intent classification.** When the router classifies a user question, add a `visualization_hint` to the classification output:

```typescript
interface RouterClassification {
  // ... existing fields ...
  visualization_hint?: 'bar' | 'horizontal_bar' | 'line' | 'stacked_bar' | 'waterfall' | 'donut' | null;
  // null = prose/table is sufficient
  // set = this question is better answered with a chart of this type
}
```

Questions that warrant charts:
- "pipeline by stage" → `bar`
- "rep coverage" / "rep comparison" / "who has the most/least" → `horizontal_bar`
- "trend over time" / "pacing" / "how are we tracking" → `line`
- "forecast breakdown" / "commit vs best case" → `stacked_bar`
- "what changed" / "pipeline movement" → `waterfall`
- "distribution" / "breakdown" / "what percent" (non-time) → `donut`

**Step 3 — Inject chart spec instructions into the system prompt** when `visualization_hint` is set:

```
When answering this question, you have computed values from the Calculation layer available in <computed_values>.
If a chart would communicate the answer more clearly than prose, emit a chart_spec JSON block using ONLY the values from <computed_values>.
Do NOT calculate, estimate, derive, or round any numeric values yourself.
Every value in chart_spec.data must map directly to a field in <computed_values>.
Set source.calculation_id to the calculation_id from <computed_values>.
After the chart_spec, write one sentence of annotation — the "so what" — in the voice of a teammate who owns this number.
```

**Step 4 — Parse chart_spec from LLM response.** The response assembler already parses table blocks from LLM output. Add `chart_spec` block detection alongside it:

```typescript
function parseResponseBlocks(rawResponse: string, calculationContext: CalculationContext): ResponseBlock[] {
  const blocks: ResponseBlock[] = [];
  
  // Existing: parse ```table blocks
  // New: parse ```chart_spec blocks
  const chartMatch = rawResponse.match(/```chart_spec\n([\s\S]*?)\n```/);
  if (chartMatch) {
    try {
      const spec = JSON.parse(chartMatch[1]) as ChartSpec;
      const valid = validateChartSpec(spec, calculationContext);
      if (valid) {
        blocks.push({ blockType: 'chart', spec });
      } else {
        // Fall back: remove chart_spec block, LLM prose remains
        console.warn('[ChartEmitter] Chart spec failed validation, falling back to prose');
      }
    } catch (e) {
      console.warn('[ChartEmitter] Chart spec parse error', e);
    }
  }
  
  // ... existing prose and table block parsing ...
  return blocks;
}
```

**Acceptance:** Ask a pipeline-by-stage question in Ask Pandora. The response contains a rendered bar chart above the prose explanation. The chart values match the Calculation function output exactly. The annotation is one sentence in the teammate voice.

---

### T4 — Chart Rendering in Ask Pandora Chat

**Files:** `client/src/components/assistant/ChatMessage.tsx` (or equivalent chat message renderer)

The chat message renderer already handles `prose` and `table` block types. Add `chart` as a third block type:

```typescript
// In the block renderer switch/map:
case 'chart':
  return (
    <ChartRenderer
      key={block.id}
      spec={block.spec}
      compact={true}   // chat is narrow
    />
  );
```

Charts in chat have a maximum width matching the chat bubble container. They do not overflow. The annotation renders below the chart inside the same bubble.

**Acceptance:** A chart block returned by the server renders inline in a chat message in Ask Pandora. The chart is readable at chat width. The annotation appears below it.

---

### T5 — Chart Rendering in the Assistant Brief (Command Center)

**Files:** `client/src/pages/AssistantView.tsx`, `client/src/components/assistant/ProactiveBriefing.tsx`

The VP RevOps Brief should be able to include charts inline when the brief assembler includes chart specs in its output. This is the full-width version — no compact flag.

In the brief's section cards (TheNumberCard, DealsToWatchCard, RepsCard), if the assembled brief includes a `chart_spec` for that section, render `<ChartRenderer spec={spec} compact={false} />` above the prose/table content in that card.

The brief assembler (server side) should include chart specs for:
- **TheNumberCard** → `line` chart: attainment pacing by week through the quarter (actual vs. required pace)
- **RepsCard** → `horizontal_bar` chart: pipeline coverage per rep vs. 3x target line
- **DealsToWatchCard** → no chart (deal list is better as a table)
- **WhatChangedCard** → `waterfall` chart: pipeline movement this week (new, advanced, slipped, closed)

These are generated the same way as Ask Pandora charts — the brief assembler calls the Calculation layer, gets computed values, emits chart specs alongside prose.

**Acceptance:** The TheNumberCard in the brief renders an attainment pacing line chart. The RepsCard renders a horizontal bar coverage chart. Both charts have annotations in the teammate voice.

---

### T6 — Live Deal Lookup Bypass

**Files:** `server/agents/orchestrator.ts` (or the query routing layer for chat)

This is the trust fix for the ACES/$240K/$315K incident.

**Rule:** When a user message contains a deal name (proper noun that matches a deal in `deals` where `workspace_id = $workspaceId`), the response assembler must query the live `deals` table for that deal's facts before constructing the LLM context. The brief snapshot (`deals_to_watch`) must NOT be used as the source for specific deal facts.

**Implementation:**

```typescript
// server/agents/deal-lookup.ts

interface LiveDealFact {
  id: string;
  name: string;
  amount: number;
  stage: string;
  close_date: string;
  owner_name: string;
  pipeline: string;
  forecast_category: string;
  last_synced_at: string;       // from deals.updated_at or sync log
  contact_count: number;
  days_since_activity: number | null;
}

async function lookupLiveDeal(
  workspaceId: string,
  dealNameFragment: string
): Promise<LiveDealFact | null> {
  // Query deals table directly — no skill_runs, no brief snapshot
  const result = await db.query(`
    SELECT
      d.id, d.name, d.amount, d.stage, d.close_date,
      d.owner_name, d.pipeline, d.forecast_category,
      d.updated_at as last_synced_at,
      COUNT(DISTINCT dc.contact_id) as contact_count,
      EXTRACT(EPOCH FROM (NOW() - MAX(a.occurred_at))) / 86400 as days_since_activity
    FROM deals d
    LEFT JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
    LEFT JOIN activities a ON a.deal_id = d.id AND a.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1
      AND LOWER(d.name) LIKE LOWER($2)
    GROUP BY d.id, d.name, d.amount, d.stage, d.close_date,
             d.owner_name, d.pipeline, d.forecast_category, d.updated_at
    LIMIT 1
  `, [workspaceId, `%${dealNameFragment}%`]);
  
  return result.rows[0] || null;
}
```

**Deal name detection:** Before building LLM context, run a lightweight extraction pass on the user message. Look for:
- Proper nouns that match deal names in the workspace (fuzzy match, case-insensitive)
- Explicit phrases like "the [X] deal", "[Company] deal", "[Company] opportunity"

If a deal name is detected, call `lookupLiveDeal` and inject the live fact as a `<live_deal_fact>` block into the LLM context with higher priority than any brief snapshot data:

```
<live_deal_fact synced_at="2026-03-06T01:01:00Z">
  Deal: ACES ABA
  Amount: $315,000
  Stage: Closed Won
  Pipeline: Core Sales Pipeline
  Close Date: 2026-03-05
  Owner: Nate Phillips
  Contacts: 3
  Last Activity: 1 day ago
</live_deal_fact>

Note: The weekly brief may show different values for this deal — always prefer the live_deal_fact above when answering questions about this specific deal.
```

**Acceptance:** Ask "what's the status of ACES ABA?" after a sync has updated the deal. The response reflects the live table values, not the brief snapshot. The response includes the sync timestamp so the user can see data freshness.

---

### T7 — Contradiction Handler

**Files:** `server/agents/orchestrator.ts`, wherever user message intent is classified

When a user pushes back on a specific number that the assistant just stated ("That's not right, it's $315K" / "Are you sure about that?" / "I thought it was X"), the system must re-query live data rather than re-assert the cached value.

**Contradiction detection:** Classify user messages for contradiction intent. Signals:
- "That's not right" / "Are you sure" / "I thought" / "That doesn't sound right"
- User states a specific number that differs from what the assistant just said
- User names a deal and states a fact about it

**On contradiction detected:**
1. Re-run `lookupLiveDeal` for any deal names in the prior exchange
2. Re-run the relevant Calculation function for any metrics being challenged
3. Explicitly reconcile in the response:

```
You're right to question that. Pulling live data now...

ACES ABA shows $315,000 in the live database, synced 5 hours ago. The brief I referenced earlier had $240,000 — that was the value before last night's sync captured the update. The brief will auto-regenerate tonight at 7 AM UTC and will reflect the corrected amount.

With ACES at $315K closed, Core Sales attainment is $387K against the $350K target — you're over quota. Nate closed the quarter with that deal.
```

The key behaviors:
- Acknowledge the discrepancy honestly ("the brief had the pre-update amount")
- Explain why it was different (assembly timing vs. sync timing)
- Give the correct value from live data
- Recalculate any derived metrics that depend on the corrected value

**Acceptance:** After the assistant says "ACES is $240K," the user responds "that's wrong, it's $315K." The next response re-queries live data, acknowledges the discrepancy, explains the assembly/sync timing gap, and recalculates attainment correctly.

---

### T8 — Event-Driven Brief Reassembly

**Files:** `server/connectors/hubspot/sync.ts` (or equivalent sync completion handler), `server/briefs/brief-assembler.ts` (wherever `weekly_briefs` rows are generated)

**The problem:** The brief assembles on a fixed cron. Syncs run independently. A deal can close at 11 PM, sync at 1 AM, and the brief won't reflect it until 7 AM — 8 hours of wrong attainment shown to the user.

**Material change detection:** After every sync completes, compute a `SyncDelta` and check for material changes:

```typescript
interface SyncDelta {
  workspaceId: string;
  syncCompletedAt: string;
  materialChanges: MaterialChange[];
}

interface MaterialChange {
  type:
    | 'deal_closed_won'
    | 'deal_closed_lost'
    | 'amount_changed'         // delta > 10% of deal amount
    | 'pipeline_reclassified'  // deal moved between pipelines
    | 'stage_regression'       // deal moved backwards
    | 'close_date_slipped';    // close date pushed out
  dealId: string;
  dealName: string;
  before: Record<string, any>;
  after: Record<string, any>;
}

function detectMaterialChanges(syncedRecords: SyncedRecord[]): MaterialChange[] {
  const changes: MaterialChange[] = [];
  
  for (const record of syncedRecords) {
    const before = record.previousValues;
    const after = record.currentValues;
    
    // Closed Won
    if (after.stage === 'closed_won' && before.stage !== 'closed_won') {
      changes.push({ type: 'deal_closed_won', dealId: record.id, dealName: record.name, before, after });
    }
    
    // Amount changed > 10%
    if (before.amount && after.amount) {
      const delta = Math.abs(after.amount - before.amount) / before.amount;
      if (delta > 0.1) {
        changes.push({ type: 'amount_changed', dealId: record.id, dealName: record.name, before, after });
      }
    }
    
    // Pipeline reclassified
    if (before.pipeline !== after.pipeline && after.pipeline) {
      changes.push({ type: 'pipeline_reclassified', dealId: record.id, dealName: record.name, before, after });
    }
    
    // Close date slipped
    if (before.close_date && after.close_date && new Date(after.close_date) > new Date(before.close_date)) {
      changes.push({ type: 'close_date_slipped', dealId: record.id, dealName: record.name, before, after });
    }
  }
  
  return changes;
}
```

**Reassembly trigger:** After sync completes, if `materialChanges.length > 0`:

```typescript
async function onSyncComplete(workspaceId: string, delta: SyncDelta): Promise<void> {
  if (delta.materialChanges.length === 0) return;
  
  // Log the trigger
  console.log(`[BriefReassembly] ${delta.materialChanges.length} material changes detected, queuing reassembly`);
  
  // Queue reassembly (don't block sync completion)
  await briefReassemblyQueue.add({
    workspaceId,
    triggeredBy: 'material_sync_change',
    triggerDetails: delta.materialChanges,
    priority: delta.materialChanges.some(c => c.type === 'deal_closed_won') ? 'high' : 'normal'
  });
}
```

**Reassembly should be async** — add to a queue, don't block. If a queue system isn't in place, use `setImmediate` or a simple async trigger with a short delay. Don't run synchronously during the sync.

**Acceptance:** Close a deal in HubSpot. Trigger a sync. The brief reassembles automatically within 5 minutes of sync completion. The next time the user opens the Command Center, attainment reflects the closed deal.

---

### T9 — Brief Staleness Indicator

**Files:** `client/src/components/assistant/ProactiveBriefing.tsx`, `client/src/pages/AssistantView.tsx`

While T8 handles automatic reassembly, there will always be a window where the brief could be stale. The brief must never present itself as current without telling the user when it was assembled.

**Backend:** Add to the brief API response:

```typescript
interface BriefMetadata {
  assembled_at: string;             // ISO timestamp — when the brief was built
  last_sync_at: string;             // ISO timestamp — last successful CRM sync
  is_potentially_stale: boolean;    // true if last_sync_at > assembled_at
  stale_reason?: string;            // "A sync ran after this brief was assembled. Reassembly in progress."
}
```

**Frontend — always show assembly time:**

In the ProactiveBriefing header, below the greeting, show a small metadata line:

```
As of [time] today  ·  [Sync ran X min ago — refreshing ↻]
```

- "As of 7:00 AM" — always present, derived from `assembled_at`
- "Sync ran 5 min ago — refreshing ↻" — shown only when `is_potentially_stale = true`, clicking the ↻ triggers manual reassembly via the existing sync endpoint

**Stale banner:** When `is_potentially_stale = true` and reassembly hasn't completed yet, show a subtle amber banner at the top of the brief card:

```
⚠ A sync ran after this brief was assembled. Some numbers may have changed. Refreshing...
```

This banner disappears once the reassembled brief loads.

**Acceptance:** The ProactiveBriefing card always shows its assembly time. When a sync has run since assembly, a staleness indicator appears with a manual refresh option.

---

## What NOT to Build in This Prompt

- Real-time websocket updates for brief reassembly (polling on page focus is fine for v1)
- Chart export to PDF/XLSX (that's the existing renderer expansion — wire in later)
- Historical chart comparison (show current period only for v1)
- Custom chart color themes per workspace (use shared token palette)
- Chart zoom/pan/tooltip interactions beyond Recharts defaults

---

## Sequencing

These tasks can be parallelized as follows:

**Track A (Chart Renderer — Frontend):** T1 → T2 → T4 → T5  
**Track B (Chart Emitter — Backend):** T1 → T3 (depends on T1 types)  
**Track C (Data Freshness):** T6 → T7 (T7 depends on T6's live lookup)  
**Track D (Brief Trust):** T8 → T9 (T9 depends on T8's metadata)  

T1 is the shared dependency for both chart tracks. Start there.

---

## Acceptance Criteria (Full Suite)

1. **Charts render in Ask Pandora.** Ask "show me pipeline by stage." A bar chart renders in the chat response with teal bars, correct dollar values from the Calculation function, and one annotation sentence below it.

2. **Charts render in the Assistant brief.** TheNumberCard shows an attainment pacing line chart. RepsCard shows a coverage comparison bar chart. Both have annotations.

3. **LLM never does math.** Inspect any chart spec emitted by the LLM. Every numeric value in `data[]` must match the corresponding `computed_values` from the Calculation layer. No rounding, estimating, or deriving by the LLM.

4. **Named deal queries hit live data.** Ask "what's the status of ACES ABA?" The response reflects the current `deals` table row, not a brief snapshot. The sync timestamp is surfaced in the response.

5. **Contradiction handling works.** After the assistant states a wrong deal amount, the user says "that's not right." The next response re-queries, acknowledges the discrepancy, explains why it happened, and gives the correct value with recalculated metrics.

6. **Brief reassembles after material sync changes.** Close a deal via HubSpot. Run a sync. The brief reassembles automatically. Attainment in the next brief view reflects the closed deal.

7. **Brief always shows assembly time.** The ProactiveBriefing card shows "As of [time]" at all times. When a sync has run since assembly, a staleness indicator appears.

8. **No regression on existing table rendering.** The existing table renderer in Ask Pandora continues to work. The chart renderer is additive, not a replacement.
