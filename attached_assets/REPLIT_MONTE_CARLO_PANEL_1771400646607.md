# Replit Prompt: Monte Carlo Forecast Panel — Command Center UI

## What This Is

Add a Monte Carlo Revenue Forecast panel to the Command Center Flight Plan tab. The backend skill is already built and running. This is purely a frontend task — consuming an existing API endpoint and rendering the output.

**Do not touch the simulation logic, skill registration, or any server/analysis files.**

---

## The API

The backend exposes:

```
GET /api/workspaces/:workspaceId/monte-carlo/latest
```

Returns the most recent completed `monte-carlo-forecast` skill run payload. Response shape:

```typescript
interface MonteCarloPayload {
  // Headline
  p50: number;
  probOfHittingTarget: number | null;  // 0–1 float, null if no quota set
  quota: number | null;

  // Probability band
  p10: number;
  p25: number;
  p75: number;
  p90: number;

  // Component breakdown
  existingPipelineP50: number;
  projectedPipelineP50: number;

  // Variance drivers — top 5, sorted by totalVariance desc
  varianceDrivers: {
    label: string;        // e.g. "Win rate", "Pipeline creation", "Close date slippage"
    upsideImpact: number;   // dollars
    downsideImpact: number; // dollars
  }[];

  // Metadata
  iterationsRun: number;
  dealsInSimulation: number;
  closedDealsUsedForFitting: number;
  forecastWindowEnd: string;   // ISO date string
  dataQualityTier: 1 | 2 | 3; // 1 = thin data, 2 = no quota, 3 = full
  warnings: string[];

  // Histogram — 100 buckets for distribution chart
  histogram: {
    bucketMin: number;
    bucketMax: number;
    count: number;
  }[];
}
```

If no skill run exists yet, the endpoint returns `404`. Handle this with an empty state (see below).

---

## Where to Add It

Find the Command Center Flight Plan tab component. It currently renders:
1. KPI strip (Total Pipeline, Weighted Pipeline, Coverage Ratio, Win Rate, Deal Velocity)
2. Two-column row: Pipeline by Stage + Rep Activity Health
3. Active Findings

**Insert the Monte Carlo panel between the KPI strip and the two-column row.** It should be full-width.

---

## What to Render

The panel has three sections arranged horizontally in a single card:

### Left column (40% width) — Headline

- If `probOfHittingTarget` is not null and quota is set:
  - Large number: `{Math.round(probOfHittingTarget * 100)}%`
  - Label below: `probability of hitting ${formatCurrency(quota)}`
  - Color the percentage: green if ≥ 70%, orange if 40–69%, red if < 40%

- If no quota (`dataQualityTier === 2`):
  - Show `P50: ${formatCurrency(p50)}` as headline
  - Label: `most likely outcome`
  - Small note below: `Set quota to unlock probability analysis →` (links to quota setup)

- If thin data (`dataQualityTier === 1`):
  - Show P50 with a `~` prefix to signal low confidence
  - Show a yellow warning badge: `Limited historical data`

Below the headline in all cases:
- Three stat chips in a row: `P10: $X` · `P50: $X` · `P90: $X`
- Component breakdown: two small bars showing existing pipeline vs projected pipeline split at P50
  - Label: `${existingPct}% from existing pipeline · ${projectedPct}% from new pipeline`

### Center column (35% width) — Probability Band

Render a horizontal bar showing the P10→P90 range with markers:

```
|----[P10]--------[P25]---[P50]---[P75]--------[P90]----|
       $10.2M    $11.5M  $13.1M  $14.8M       $16.2M
```

- The bar background represents the full range (P10 to P90)
- Color gradient: red at P10 end → green at P90 end
- P50 has a vertical tick mark and label, slightly larger than P25/P75
- If quota is set, draw a thin vertical line at the quota value with a small label `target`
- If quota falls outside P10–P90, show it as a dashed line beyond the bar

### Right column (25% width) — Variance Drivers

Label: `WHAT MOVES THE NUMBER`

List the top 5 variance drivers as a mini tornado chart:

For each driver:
- Driver name (e.g. "Win rate")
- Two small horizontal bars side by side:
  - Green bar extending right: upside impact (`+$2.1M`)
  - Red bar extending left: downside impact (`-$2.1M`)
- The bars should be proportionally sized relative to the largest driver

Keep it compact — this is a summary, not a detailed chart.

---

## Empty States

**No skill run yet (404):**
```
[Monte Carlo icon]
Revenue forecast not yet computed
[Run forecast button] → POST /api/workspaces/:id/skills/monte-carlo-forecast/run
```

**Skill currently running:**
Show a subtle loading shimmer on the panel with text: `Computing 10,000 scenarios...`

**dataQualityTier === 1 (thin data):**
Show the panel normally but with a yellow banner at the top of the card:
`Forecast confidence is low — based on limited historical data. Confidence improves as more deals close.`

---

## Styling

Match the existing Command Center dark theme exactly. Use the same CSS variables / color values already defined in the component:

- Card background: same surface color as Pipeline by Stage and Rep Activity Health cards
- Border: same `1px solid` border color as other cards
- Border radius: match other cards
- Padding: `18px 20px` to match
- All text sizes, font weights, and colors should match the existing KPI strip and card patterns

The panel header row should follow the same pattern as other cards:
- Left: title `Monte Carlo Forecast` in the same font/weight as `Pipeline by Stage`
- Right: metadata in muted text — `10,000 simulations · ${dealsInSimulation} deals · updated Xh ago`

Do not introduce new color variables, new font families, or new component patterns. This panel should look like it was always part of the Command Center.

---

## Data Fetching

- Fetch on mount when the Flight Plan tab is active
- Use the existing workspace context / `workspaceId` already available in the component
- Cache the result for the session — no need to refetch on every tab switch
- Show loading shimmer while fetching
- If the fetch fails (not 404, but a real error), show a quiet error state: `Forecast unavailable` with a retry button

---

## After You Build It

Test against the Imubit workspace — it has a completed Monte Carlo skill run. The panel should display real P10/P50/P90 values and a variance driver list. If the panel shows the empty state instead, check that the `/api/workspaces/:id/monte-carlo/latest` route is returning data correctly for Imubit's workspace ID.
