# PANDORA: Command Center Improvements

Read REPLIT_CONTEXT.md if you haven't already.

This prompt upgrades the existing Command Center page. The page already has headline metrics, AI alerts, a pipeline-by-stage chart, Monte Carlo forecast, actions & signals, and a findings feed. This prompt addresses five specific gaps that weaken the page's value proposition as an opinionated command center vs. a generic dashboard.

Reference the mockup in `pandora-command-center-v2.jsx` for exact layout, spacing, and component structure.

---

## Current State

What's already built and working:
- Headline metrics row (Total Pipeline, Weighted, Coverage, Win Rate, Open Findings)
- AI Alerts section with severity-colored finding cards
- Pipeline by Stage horizontal bar chart
- Monte Carlo Forecast with tornado chart, confidence slider, and Ask Pandora input
- Actions Needing Attention + Signals This Week panels
- Recent Findings list

What's wrong:
1. Metrics are flat numbers with no directional context — no trend indicators
2. Metrics have no "show the math" — violates the evidence architecture principle that every number is traceable
3. Pipeline chart has no AI annotations — it looks like any CRM chart, missing the "so what" that differentiates Pandora
4. Monte Carlo tornado chart has persistent centering/alignment issues — needs a different visualization
5. Findings feed has no filters — becomes wallpaper at scale
6. No connector status strip — users can't tell if they're looking at stale data
7. Layout puts Monte Carlo above Actions and Findings, pushing the highest-action sections below the fold

---

## Build Sequence

### Step 1: Headline Metrics — Add Trend Arrows and Show-the-Math

Each metric card gets two additions:

**Trend arrow badge** below the sub-label, right-aligned:
- Green `↑` badge with value (e.g., "+12% MoM") if metric improved
- Red `↓` badge with value (e.g., "-4.2pp") if metric declined
- Gray `→` badge with "stable" if flat

Data source: Compare current metric value to the same metric from the prior period (use the time range selector — if "This Week" is selected, compare to last week). The pipeline snapshot endpoint should already return prior-period comparisons. If it doesn't, compute client-side by querying the previous period's skill run result.

**"Show math" expandable** — a subtle link at the bottom of each card:
```
📐 Show math →
```

When clicked, expands inline (within the card, not a modal) showing:
- The formula in monospace font (e.g., `Σ (amount × stage probability)` for Weighted Pipeline)
- A "View full evidence →" link in accent color that navigates to the evidence drill-through

Formulas per metric:
- **Total Pipeline**: `Sum of amount where stage ∉ {Closed Won, Closed Lost}`
- **Weighted Pipeline**: `Σ (deal.amount × stage.probability)`
- **Coverage Ratio**: `Total Pipeline ÷ Quota ({pipeline} ÷ {quota})`
- **Win Rate (90d)**: `Won ÷ (Won + Lost) trailing 90 days`
- **Open Findings**: `Count of unresolved findings from latest skill runs`

The expand/collapse is a simple useState toggle per metric card. Only one card can be expanded at a time (clicking a second one closes the first).

### Step 2: Annotated Pipeline Chart — Add AI Flags to Stage Bars

This is the highest-priority change. The pipeline chart must show annotations from skill findings directly on the bars. This is what makes it a Pandora chart instead of a Salesforce report.

**Data source**: The findings data is already loaded on this page (it powers the Recent Findings feed). Filter findings to extract stage-level annotations:

```typescript
// Group relevant findings by stage
const stageAnnotations = {};
for (const finding of allFindings) {
  // Map finding to a stage based on the deal's current stage
  const stage = finding.deal?.stage;
  if (!stage) continue;
  if (!stageAnnotations[stage]) stageAnnotations[stage] = [];
  stageAnnotations[stage].push(finding);
}
```

**Annotation flags** render to the right of each bar. Each flag is a compact pill:
- Red pill: critical findings (e.g., "1 stalled 28d ($22K)")
- Orange pill: warning findings involving deal risk (e.g., "Single-threaded")
- Yellow pill: data quality or non-critical warnings (e.g., "2 missing close date")

Flag pill styling:
- Font size 9–10px, font weight 600
- Text color matches severity color
- Background: severity color at 15% opacity
- Border: severity color at 30% opacity
- 4px border radius
- Small severity dot (4px) before the text
- White-space: nowrap

**Aggregate flags per stage** — don't show one pill per finding. Group findings by type within each stage:
- Multiple stale deals → "3 deals stalled 21+ days ($67K)"
- Multiple single-threaded → "Single-threaded: 2 deals"
- Multiple missing close dates → "2 missing close date"

Max 2 flags per stage bar. If more exist, show the top 2 by severity and add "+N more" text.

**Bar color shifts based on annotations:**
- No flags: blue gradient (`accent` at 55% → 20%)
- Warning flags only: yellow gradient
- Any critical flag: red gradient

**Click interaction:**
When a user clicks a flag pill (or the bar itself if it has flags), expand an inline panel below that bar showing the specific flagged deals:

```
┌─────────────────────────────────────────────┐
│ Flagged deals in Proposal                    │
│ Acme Corp    Sarah Mitchell    $22K  28d stale│
│ Beta Inc     James Park        $24K  14d stale│
└─────────────────────────────────────────────┘
```

Each deal row shows: deal name (clickable, accent color, navigates to deal detail), owner, amount (monospace), and the flag reason as a badge. Only one stage can be expanded at a time.

### Step 3: Monte Carlo — Replace Tornado with Range of Outcomes

The tornado chart has persistent centering issues. Replace it with a two-column layout:

**Left column — Headline + Range of Outcomes:**

Keep the existing elements:
- Pipeline badges (core-sales-pipeline, New Business)
- Headline number ($670K, large font weight 800, 38px)
- "most likely outcome" sub-label
- "Set a target to see hit probability" link
- "86% existing pipeline · 14% new pipeline needed" stat

Replace the tornado chart with a **Range of Outcomes** visualization:

Three labeled values across the top:
```
Floor               Median              Ceiling
$367K               $670K               $1.1M
(red text)          (white text)        (green text)
```

Below them, a single horizontal bar (28px tall, rounded):
- Background: `surfaceHover`
- Fill: gradient from red (left) through yellow/blue to green (right)
- Median marker: 2px white vertical line at the 50% point
- Confidence marker: 3px accent-colored vertical line at the current confidence percentile, with a subtle glow shadow. This marker moves when the slider is dragged.

The confidence slider stays as-is (range input, 5 to 95). When dragged:
- The headline number updates to the interpolated value at that percentile
- The confidence marker on the range bar moves
- The label shows: `{percentile}th percentile → {value}`

Interpolation: Linear between floor (P5) → median (P50) → ceiling (P95).

**Right column — What Moves the Number:**

Replace the tornado bars with a vertical stack of cards. Each card shows:
- Factor name (bold, 12px) — e.g., "Win Rate", "Sales Cycle Length", "Close Date Slippage"
- Impact value (right-aligned, monospace, bold) — e.g., "±$78K", "+$20K"
- Impact value color: green if positive-only, default text color if mixed
- One-line explanation (muted, 10px) — e.g., "Biggest swing factor — 5pp change shifts forecast $78K"

Card styling: `surfaceRaised` background, 6px border radius, 1px border, 10-12px padding. Stack with 8px gap.

Factors to show (from the existing Monte Carlo computation — these should already be in the skill run output):
1. Win Rate
2. Sales Cycle Length
3. Close Date Slippage
4. Pipeline Creation Rate
5. Deal Size

**Ask Pandora section** — keep at the bottom of the Monte Carlo accordion, separated by a top border:

```
ASK A QUESTION                    What-if scenarios supported ✦
```

Suggested prompt pills (keep the existing ones):
- Gray outline pill: "Which deals must close to hit target?"
- Blue accent pill with ↻ icon: "What if our win rate improves 20%?"
- Blue accent pill with ↻ icon: "What happens if we close the biggest deal?"

Explanatory text: "Blue chips are what-if scenarios — try 'What if we lose our top rep?' or any scenario question"

Text input with send button (existing). Send button activates (accent background) when input has text.

Below input: "▸ Past runs (7)" and "▸ Recent questions" as expandable toggles (existing).

Wire the input to the existing `/analyze` endpoint with scope `{ type: 'pipeline' }`.

### Step 4: Findings Feed — Add Filters

Add a filter bar at the top of the Recent Findings accordion section body:

**Row 1 — Severity filters** (pill toggle buttons):
```
[All] [Critical] [Warning] [Info]
```

Active button styling: background and text color match severity (red/yellow/blue). Inactive: transparent background, muted text, border color.

**Separator** — 1px vertical divider between severity and skill filters.

**Row 2 — Skill filters** (pill toggle buttons):
```
[All Skills] [Pipeline Hygiene] [Forecast Roll-up] [Data Quality] [Single-Thread] [Coverage by Rep]
```

Active button: accent background/text. Inactive: transparent, muted.

Populate the skill filter list dynamically from the workspace's available skills (the skills list endpoint). Don't hardcode skill names.

**Filter logic**: Both filter types are AND-ed. If "Critical" and "Pipeline Hygiene" are both active, only show critical findings from Pipeline Hygiene.

**Empty state**: When filters produce zero results, show centered text: "No findings match current filters" in muted color.

**Count update**: The badge in the accordion header should update to reflect the filtered count, not the total. E.g., if filtered to Critical only and there are 2 critical findings, show "2 findings" not "7 findings".

### Step 5: Connector Status Strip

Add a row of connector status cards at the bottom of the page (below all accordion sections).

**Data source**: The connectors API already returns status, last sync time, and record counts per connector.

```
GET /api/workspaces/:id/connectors
```

**Layout**: Horizontal flex row, one card per connector, equal width.

Each card shows:
- **Status dot** (8px circle, left side):
  - Green + glow: healthy (last sync within expected interval)
  - Yellow + glow: warning (sync older than expected but not failed)
  - Red + glow: error (sync failed or connector disconnected)
- **Connector name** (12px, bold)
- **Record counts** (10px, dim) — e.g., "738 contacts · 247 deals"
- **Last sync time** (10px, muted, right side) — e.g., "12 min ago"

Card styling: `surface` background, `border` border, 8px border radius, 10-14px padding. Cursor pointer — clicking navigates to the Connector Health page.

### Step 6: Layout Reflow

Reorder the page sections to put the highest-action content above the fold:

```
1. Headline Metrics (grid, always visible)
2. AI Alerts (accordion, default open)
3. Pipeline by Stage + Actions Queue + Signals (two-column grid)
4. Monte Carlo Forecast (accordion, default OPEN — was open before, keep it)
5. Recent Findings with filters (accordion, default open)
6. Connector Status Strip (flat row, always visible)
```

The key layout change: Pipeline chart and Actions/Signals are side-by-side in a two-column grid:
- Left column (flex: 1): Annotated pipeline chart
- Right column (340px fixed): Actions Queue card stacked above Signals This Week card

This keeps both the pipeline overview and the action queue visible at the same time without scrolling.

---

## Implementation Notes

### Reusable Components

Extract these if not already shared:
- `TrendArrow` — direction (up/down/flat) + value string → colored badge
- `SeverityDot` — severity → colored circle with glow
- `Badge` — generic colored pill
- `AccordionSection` — collapsible section with header, badge, chevron (same component used on Account Detail and Deal Detail)

### Animation

- Accordion expand/collapse: `max-height` transition, 0.35s ease
- "Show math" expand: `fadeIn` animation (opacity 0→1, translateY 4→0), 0.2s
- Flag click expand: same `fadeIn` animation
- Range bar confidence marker: `left` transition, 0.15s ease (follows slider)

### What NOT to Change

- AI Alerts section — keep as-is, it's working well
- Monte Carlo Ask Pandora — preserve all existing functionality (input, suggested prompts, past runs, recent questions)
- Sidebar navigation — don't modify
- Time range selector — keep as-is
- Workspace selector — keep as-is

---

## Validation

Test against the Frontera workspace (real data):

- [ ] Each headline metric shows a trend arrow badge with directional indicator
- [ ] "Show math" expands inline on each metric card showing the formula
- [ ] Only one metric's math panel is open at a time
- [ ] Pipeline bars have annotation flags matching skill findings for that stage
- [ ] Flags are aggregated per stage (not one per finding)
- [ ] Bar color shifts based on flag severity (blue → yellow → red)
- [ ] Clicking a flag expands an inline deal list below that bar
- [ ] Deal names in expanded list are clickable and navigate to deal detail
- [ ] Monte Carlo shows range-of-outcomes bar instead of tornado chart
- [ ] Range bar has gradient fill, median marker, and confidence marker
- [ ] Confidence slider moves the marker and updates the headline number
- [ ] "What Moves the Number" shows as a card list (not centered bars)
- [ ] Ask Pandora section is preserved with suggested prompts, input, and past runs
- [ ] Findings feed has severity filter pills (All/Critical/Warning/Info)
- [ ] Findings feed has skill filter pills (populated from workspace skills)
- [ ] Filters are AND-ed and update the header badge count
- [ ] Empty state shows when filters match nothing
- [ ] Connector status strip shows at the bottom with status dots and last sync times
- [ ] Pipeline chart and Actions/Signals are side-by-side (two-column layout)
- [ ] Page loads without errors — all data fetches are parallelized
