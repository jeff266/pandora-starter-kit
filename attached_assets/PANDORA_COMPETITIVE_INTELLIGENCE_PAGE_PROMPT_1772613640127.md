# Build Prompt: Competitive Intelligence Detail Page

## Context

The `competitive-intelligence` skill already runs and produces structured output.
It runs on the 1st of each month, logs to `skill_runs`, parses findings into the
`findings` table, and posts to Slack. This page does **not** re-run the skill — it
reads from what the skill already produced and joins it against live open deal data.

Before starting, read:
1. An existing Intelligence page (Stage Velocity or Coaching Intelligence) — copy
   the routing pattern, page layout, and how it loads data from a single API endpoint
2. The `skill_runs` table schema — specifically how `result_data` is structured for
   competitive-intelligence runs (JSON blob with `competitors`, `open_threats`,
   `win_rates`, `baseline_win_rate`, `field_intel`)
3. The `deal_insights` table — rows where `insight_type = 'competition'`, columns
   `deal_id`, `content`, `source_quote`, `confidence_score`, `competitor_name`,
   `created_at`
4. The `deals` table — `stage`, `amount`, `owner_email`, `is_closed`, `is_won`
5. The `conversations` table — `competitor_mentions` JSONB field
6. The design reference: `competitive-intelligence-page.jsx` in project root — the
   approved UI mockup. Match it exactly: colors, typography, layout, interactions.

---

## What This Page Is (and Isn't)

**Is:** Read-only intelligence surface. A manager opens this page and immediately
sees where competitors are showing up, how hard they are to beat, which open deals
are at risk, and what reps are actually hearing in the field.

**Is not:** An admin console, a skill runner, or a log viewer. No "Run Skill" button.
No token usage stats. No raw JSON. Those belong in the Skills page.

---

## Step 1: API Endpoint

Create `GET /api/workspaces/:workspaceId/intelligence/competitive`

This is a single endpoint that assembles the full page payload. It runs four queries
in parallel and returns a merged response.

### Query 1 — Last Skill Run

```sql
SELECT result_data, created_at
FROM skill_runs
WHERE workspace_id = $1
  AND skill_id = 'competitive-intelligence'
  AND status = 'completed'
ORDER BY created_at DESC
LIMIT 1
```

From `result_data` extract:
- `baseline_win_rate` — win rate for deals with no competitor mentions
- `competitors[]` — array of:
  - `name`, `deal_count`, `win_rate`, `delta` (vs baseline), `pattern`, `trend`,
    `mention_trend` (e.g. "+18% MoM")
- `last_run_at` — the `created_at` timestamp

### Query 2 — Open Deal Exposure

```sql
SELECT
  d.id,
  d.deal_name,
  d.amount,
  d.stage,
  d.owner_email,
  di.competitor_name,
  di.confidence_score,
  di.created_at AS last_mention_at,
  COUNT(DISTINCT di.id) AS mention_count
FROM deals d
JOIN deal_insights di ON di.deal_id = d.id
WHERE d.workspace_id = $1
  AND d.is_closed = false
  AND di.insight_type = 'competition'
GROUP BY d.id, d.deal_name, d.amount, d.stage, d.owner_email,
         di.competitor_name, di.confidence_score, di.created_at
ORDER BY d.amount DESC
```

For each deal, derive `risk` level server-side:
- `high` — pattern is `displacement_threat` or `emerging_threat`, AND last mention
  within 7 days, AND stage is Evaluation or later
- `med` — any competitor mention within 14 days OR high-delta competitor in any stage
- `low` — everything else

### Query 3 — Field Intel Feed

```sql
SELECT
  di.competitor_name,
  di.source_quote,
  di.confidence_score,
  di.created_at,
  d.deal_name,
  d.owner_email
FROM deal_insights di
JOIN deals d ON d.id = di.deal_id
WHERE d.workspace_id = $1
  AND di.insight_type = 'competition'
  AND di.source_quote IS NOT NULL
  AND di.source_quote != ''
ORDER BY di.confidence_score DESC, di.created_at DESC
LIMIT 20
```

### Query 4 — Trend Header Stats

Compute from skill_runs history (last 2 completed runs):
- `mention_change_pct` — % change in total competitor mentions between runs
- `pipeline_at_risk` — sum of `amount` for open deals with competition mentions
- `high_risk_pipeline` — sum of `amount` for high-risk deals only
- `hardest_competitor` — competitor with lowest win rate (most negative delta)

### Response shape

```typescript
{
  last_run_at: string;              // ISO timestamp
  competitors_tracked: number;
  baseline_win_rate: number;        // e.g. 0.61
  mention_change_pct: number;       // e.g. +22 (percentage points)
  pipeline_at_risk: number;         // dollars
  high_risk_pipeline: number;       // dollars
  hardest_competitor: string;       // competitor name
  hardest_competitor_delta: number; // e.g. -23

  competitors: {
    name: string;
    deal_count: number;
    win_rate: number;
    delta: number;
    trend: 'up' | 'down' | 'stable';
    mention_trend: string;          // human-readable e.g. "+18% MoM"
    pattern: CompetitorPattern;
  }[];

  open_deals: {
    deal_id: string;
    deal_name: string;
    competitor_name: string;
    amount: number;
    stage: string;
    owner_email: string;
    mention_count: number;
    last_mention_at: string;
    risk: 'high' | 'med' | 'low';
  }[];

  field_intel: {
    competitor_name: string;
    deal_name: string;
    owner_email: string;
    source_quote: string;
    confidence_score: number;
    created_at: string;
  }[];
}
```

Add the route to the Intelligence router alongside Stage Velocity and Coaching
Intelligence. No auth bypass — use the same workspace middleware as the other
Intelligence endpoints.

---

## Step 2: Frontend Page

Create `client/src/pages/intelligence/CompetitiveIntelligencePage.tsx`.

Register it in the Intelligence section of the sidebar and router. Nav label:
**"Competition"**. Icon: shield-check (or closest available in the icon set).

### Layout — match the mockup exactly

The page has five sections top to bottom:

**1. Page Header**
- Title: "Competitive Intelligence" with shield icon
- Subtitle: "Last analyzed [date] · 90-day trailing window · [N] competitors tracked"
- Right: "Auto-runs 1st of each month" status pill (green dot). If a competitor is
  actively filtered, show a "Clear filter" button here too.

**2. KPI Strip (4 cards)**

| Card | Value | Sub-label | Accent color |
|------|-------|-----------|--------------|
| Baseline win rate | `{baseline_win_rate}%` | "Deals with no competitors" | green |
| Open pipeline at risk | `${pipeline_at_risk}K` | `${high_risk_pipeline}K flagged high-risk` | red |
| Hardest to beat | `{hardest_competitor}` | `−{abs(delta)}pp vs. baseline` | purple |
| Competitor mentions | `+{mention_change_pct}%` | "vs. prior 90-day period" | orange |

**3. Open Deal Exposure (full width)**

Table: Deal · Competitor · Amount · Stage · Calls w/ Mention · Last Mention · Risk

- Sort controls: "Deal Value" / "Risk" / "Last Mention" — active sort is highlighted
- Clicking a competitor name in this table filters the whole page to that competitor
- Risk column: colored dot + label (high = red, med = yellow, low = green), with a
  subtle glow on the dot
- Rows highlight on hover
- If a competitor filter is active, show only rows matching that competitor and show
  the filter label in the section subtitle

**4. Two-column grid: Competitor Leaderboard (left) + Field Intel Feed (right)**

**Leaderboard columns:** Competitor · Deals · Win Rate · vs. Baseline · Trend · Pattern

- Win rate colored red if <50%, green if >baseline
- Delta shown as `±Npp` in mono font, red/green
- Trend: ↑ (red) / ↓ (green) / → (muted), with MoM mention change next to it
- Pattern: colored badge with hover tooltip explaining the classification (see
  pattern legend below)
- Clicking a row sets the competitor filter; active row gets `surfaceActive` background

**Field Intel Feed:**

Each card shows:
- Competitor name (colored by pattern) → Deal name · Date · Rep
- Right-aligned confidence score badge (green ≥90, yellow ≥75, muted below)
- The source quote in italic, full text — do not truncate aggressively
- Left border colored by competitor's pattern color

Cards are ordered by confidence score descending. If a competitor filter is active,
show only quotes for that competitor. If no quotes exist for a filtered competitor,
show an empty state: "No intel found for [Competitor]".

**5. Pattern Legend (full width, bottom)**

Inline row of all six badges with a one-line description next to each. Always visible
— this is a first-visit affordance.

Pattern classifications and their colors:
```
displacement_threat → red    "Actively replacing your product in existing accounts"
pricing_pressure    → orange "Driving discounting behavior and budget conversations"
feature_gap         → yellow "Winning on specific capability your product lacks"
emerging_threat     → purple "Appearing more frequently — watch for acceleration"
declining_threat    → green  "Mention frequency and win-rate impact both decreasing"
segment_specific    → cyan   "Dominant in one ICP segment but not broadly threatening"
```

### Filtering behavior

Competitor filter is page-wide. When active:
- Open Deal Exposure table: show only rows for that competitor
- Field Intel Feed: show only quotes for that competitor
- Leaderboard: highlight the selected competitor row; all rows remain visible
- Header: show "Clear filter" button
- Section subtitles update to note the active filter

Filter state is local (React `useState`). No URL param needed for now.

### Loading and empty states

- Page load: skeleton shimmer on KPI cards and table rows while the API call resolves
- If `competitors.length === 0` (skill has never run or no competitor data): show a
  "No competitive data yet" empty state with a note that the skill runs on the 1st
  of each month and can be triggered manually from the Skills page
- If `open_deals.length === 0`: show "No open deals with competitor mentions" in the
  table body
- If `field_intel.length === 0`: show "No call transcripts with competitor mentions"
  in the feed

### No controls to include

Do NOT add:
- "Run Skill" or any trigger button
- Token usage, duration, or run metadata
- The full Claude-generated narrative from the skill run
- Export button (can be added later)

---

## Step 3: Navigation Wiring

Add "Competition" to the Intelligence section in the sidebar nav, between
"Coaching Intelligence" and whatever currently follows it.

Use the same active state styling as the other Intelligence nav items.

---

## Acceptance Criteria

- [ ] `GET /api/workspaces/:workspaceId/intelligence/competitive` returns correct
      payload from live data (test against Frontera or GrowthBook workspace)
- [ ] Page renders all five sections with real data
- [ ] KPI strip matches the four cards in the mockup with correct values
- [ ] Competitor filter works: clicking in leaderboard or deal table filters page-wide
- [ ] Clear filter restores full view
- [ ] Pattern badge hover tooltips display correctly
- [ ] Field intel quotes are untruncated and ordered by confidence score
- [ ] Risk derivation logic matches spec (high/med/low)
- [ ] Empty states render without errors when data is missing
- [ ] No "Run Skill" button or admin controls anywhere on the page
- [ ] Navigation item appears in sidebar and routes correctly
