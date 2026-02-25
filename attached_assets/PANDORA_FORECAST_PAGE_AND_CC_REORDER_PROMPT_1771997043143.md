# Claude Code Prompt: Command Center Reorder + Forecast Page

## Overview

Two related changes:

1. **Reorder Command Center** — Fix the section ordering so data comes first, annotations are compact, and nothing interrupts the content flow.
2. **Build Forecast Page** — New route at `/forecast` with the longitudinal tracking dashboard. Annotations get their full contextual treatment here, anchored to chart points, rep rows, and coverage bars.

The mental model: **Command Center = "What's happening right now?"** (current state, glanceable). **Forecast = "Are we converging on quota?"** (longitudinal, analytical).

---

# Part 1: Command Center Reorder

## Current Order (broken)

```
1. Top bar (title + scope filter)
2. Banner: quotas setup
3. Banner: Slack setup  
4. Duplicate title + time filter + pipeline filter (3 separate levels)
5. Annotations panel (ALL 6 annotations, flat list — takes entire first screen)
6. Pipeline Metrics
7. Banner: targets setup (MID-CONTENT)
8. Monte Carlo Forecast (full display)
9. Pipeline by Stage
10. Actions & Signals
11. Recent Findings
```

## Target Order (fixed)

```
1. Unified header bar (title + all 3 filters on one line) ← from filter consolidation prompt
2. Setup checklist (collapsed, 1 row) ← from filter consolidation prompt
3. Pipeline Metrics (FIRST — this is what 80% of users come here to see)
4. AI Alerts (compact — max 3 critical/warning, inline preview, link to Forecast page)
5. Monte Carlo Forecast (keep existing full display — no change)
6. Pipeline by Stage (keep existing position relative to Monte Carlo)
7. Actions & Signals
8. Recent Findings
```

### Why this order:

**Pipeline Metrics moves to the top.** The most common reason someone opens Command Center is "where's the pipeline at?" — total value, deal count, stage distribution. This should be the first thing after the header. Currently pushed below the fold by 6 annotation cards.

**Annotations become a compact AI Alerts section directly below metrics.** Instead of showing all 6 annotations in a flat list that dominates the first screen, show a maximum of 3 (critical and warning severity only) with inline preview text (not just titles). Include a "View all insights on the Forecast page →" link. The full annotation experience with contextual anchoring lives on the Forecast page. This section should be tight — no more than ~120px total for 3 alerts.

**Everything else keeps its current order.** Monte Carlo, Pipeline by Stage, Actions & Signals, Recent Findings all stay where they are relative to each other. The only change is they shift up because the bloated annotations panel is no longer pushing them down.

### Implementation:

**Before starting, find and read:**
1. The Command Center page component — understand the current section rendering order
2. The AnnotationsPanel component — understand how it renders currently
3. The Monte Carlo section component — understand what data it displays
4. The Pipeline by Stage component — understand where it currently lives
5. The Actions & Signals component
6. The Recent Findings component

**Step 1: Reorder sections in the Command Center page component.**

Move the JSX blocks to match the target order. This is primarily a cut-and-paste operation — you're rearranging existing components, not rewriting them.

```tsx
// Target render order:
return (
  <div>
    {/* 1. Unified header bar (if filter consolidation is done) */}
    <HeaderBar filters={filters} lastUpdated={lastUpdated} />
    
    {/* 2. Setup checklist (if filter consolidation is done) */}
    <SetupChecklist workspaceConfig={config} />
    
    {/* 3. Pipeline Metrics — FIRST content section */}
    <PipelineMetrics data={pipelineData} />
    
    {/* 4. AI Alerts — compact, max 3 */}
    <CompactAlerts workspaceId={workspaceId} />
    
    {/* 5-8: Everything else stays in current order */}
    <MonteCarloForecast data={mcData} />
    <PipelineByStage data={stageData} />
    <ActionsAndSignals data={actionsData} />
    <RecentFindings data={findingsData} />
  </div>
);
```

**Step 2: Create CompactAlerts component.**

This replaces the current full AnnotationsPanel in Command Center. It shows a maximum of 3 annotations (critical and warning only) with inline preview.

```tsx
// client/src/components/command-center/CompactAlerts.tsx

function CompactAlerts({ workspaceId }) {
  const { annotations, dismiss, snooze } = useForecastAnnotations(workspaceId);
  
  // Filter to critical + warning, cap at 3
  const alerts = annotations
    .filter(a => a.severity === 'critical' || a.severity === 'warning')
    .slice(0, 3);
  
  if (alerts.length === 0) return null;
  
  return (
    <div style={{ /* card styling */ }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>✨</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>AI Alerts</span>
          <span style={{ /* badge styling */ }}>{alerts.length}</span>
        </div>
        <a href="/forecast" style={{ fontSize: 12, color: 'var(--accent)' }}>
          View all insights →
        </a>
      </div>
      
      {/* Compact alert cards — show title + first line of body */}
      {alerts.map(alert => (
        <CompactAlertCard 
          key={alert.id} 
          alert={alert}
          onDismiss={() => dismiss(alert.id)}
        />
      ))}
      
      {/* "N more on Forecast page" if total > 3 */}
      {annotations.length > 3 && (
        <a href="/forecast" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {annotations.length - 3} more insights on the Forecast page →
        </a>
      )}
    </div>
  );
}

function CompactAlertCard({ alert, onDismiss }) {
  // Shows:
  // - Severity icon (🔴 critical, 🟡 warning)
  // - Title (bold)
  // - First sentence of body text (not hidden behind expand)
  // - Impact line if critical severity
  // - Dismiss button (subtle)
  
  return (
    <div style={{
      padding: '10px 12px',
      borderLeft: `3px solid ${alert.severity === 'critical' ? 'var(--red)' : 'var(--yellow)'}`,
      marginBottom: 6,
      borderRadius: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span>{alert.severity === 'critical' ? '🔴' : '🟡'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{alert.title}</div>
          {/* Show body preview — first sentence only */}
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {alert.body?.split('.')[0]}.
          </div>
          {/* Show impact for critical */}
          {alert.severity === 'critical' && alert.impact && (
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', marginTop: 4 }}>
              Impact: {alert.impact}
            </div>
          )}
        </div>
        <button onClick={onDismiss} style={{ /* subtle dismiss */ }}>✕</button>
      </div>
    </div>
  );
}
```

**Key difference from current AnnotationsPanel:** The current panel shows all annotations grouped by severity with expand/collapse. The CompactAlerts component shows only critical + warning (max 3), with body preview always visible (no expand needed), and a clear link to the Forecast page for the full experience.

**Step 3: Remove the mid-content targets banner.**

Find the Banner 3 ("Set your target to unlock gap analysis...") that currently renders between Pipeline Metrics and Monte Carlo. Remove it from this position. It should only appear in the Setup Checklist (if that's been built from the filter consolidation prompt) or nowhere if it was already dismissed.

**Step 4: Remove the current full AnnotationsPanel from Command Center.**

Replace the `<AnnotationsPanel>` component with the new `<CompactAlerts>` component. The full AnnotationsPanel with all annotations, expand/collapse, and severity tabs is no longer used in Command Center — that experience moves to the Forecast page.

---

# Part 2: Forecast Page

## What This Page Is

The Forecast page is the only view in Pandora with a time axis. Every other page shows current state — this one shows longitudinal change. "Are we converging on quota or drifting away?" It answers fundamentally different questions than Command Center and gets more valuable every week as snapshots accumulate.

**Who opens this page:** CRO, VP Sales, CFO — every Monday morning after receiving the Slack digest. They click through from the Slack alert to see the full picture.

**Route:** `/forecast` (or `/workspaces/:id/forecast` depending on routing pattern)

**Sidebar location:** Under OPERATIONS, as a peer of Targets and Playbooks. Call it "Forecast" with a chart icon.

## Page Structure

The page has five sections, top to bottom:

### Section 1: Header + Metrics Row

```
Forecast  [Q1 2026 ▾]  Week 8 of 13          [Export ▾]  [Query in SQL]
```

Below the header, a row of 5 metric cards:

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ MC P50       │ │ Closed Won   │ │ Gap to Quota │ │ MC Range     │ │ Pipe Gen     │
│ $1.29M  ↓   │ │ $810K  ↑     │ │ $690K        │ │ $1.14M-1.44M │ │ $90K/wk  ↓   │
│ -$20K WoW   │ │ 54% of $1.5M │ │ 5 weeks left │ │ P25-P75      │ │ Avg $130K/wk │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

Each clickable metric card opens the deal drill-down panel for that number's underlying deals.

**Data source:** Latest forecast snapshot from `skill_runs` output where `skill_id = 'forecast-rollup'`.

### Section 2: Forecast vs. Attainment Chart

The centerpiece. An SVG line chart showing four toggleable lines over the quarter's weeks:

- **Stage-weighted** (blue) — `snapshot.stage_weighted_forecast` per week
- **Category-weighted** (cyan) — `snapshot.category_weighted_forecast` per week  
- **MC P50** (purple, thicker) — `snapshot.monte_carlo_p50` per week
- **Actual attainment** (green, with area fill) — `snapshot.attainment_at_snapshot` per week

Additional elements:
- **MC confidence band** (P25-P75 as shaded purple region) — toggleable
- **Quota line** (red dashed horizontal)
- **Annotation markers** (pulsing dots on the chart at the week where the annotation is anchored)

Toggle buttons above the chart let the user show/hide each line and the confidence band.

Chart endpoint values are clickable — clicking the MC P50 endpoint opens the deal drill-down showing which deals contribute to that forecast number.

**Data source:** Array of forecast snapshots from `skill_runs` output, ordered by snapshot_date. Each snapshot has the three forecast method values, P25/P75, and attainment.

**If < 2 snapshots exist:** Show a message "Forecast tracking begins after 2 weekly snapshots. First snapshot captured [date]." Don't show an empty chart.

### Section 3: Chart Insights Sidebar

A sidebar panel to the right of the chart (or below on narrower screens) showing chart-anchored annotations. These are annotations where `anchor.type === 'chart'`.

Each annotation card shows:
- Severity badge (colored dot + label)
- Type label (e.g., "Forecast Divergence", "Confidence Narrowing", "Attainment Pace")
- Title (e.g., "Methods diverge at Week 4")
- Expandable body, impact, and recommendation
- Dismiss/Snooze buttons

Clicking an annotation card highlights the corresponding pulsing marker on the chart. Clicking a chart marker scrolls the sidebar to that annotation.

**If no chart annotations exist:** Don't render the sidebar. Let the chart take full width.

### Section 4: Deal Risk Alerts + Rep Table (two columns)

**Left column (wider): Rep Breakdown Table**

Sortable table with columns: Rep Name, Deals, Pipeline, Stage W, Cat W, MC P50, Actual, Quota, Attainment bar, Accuracy badge.

Reps with annotations (where `anchor.type === 'rep'` and `anchor.rep_email` matches) get:
- A colored left border (orange for warning, green for positive)
- An inline annotation below their row showing the body text and recommendation
- Example: Mike Torres's row has an orange border and "72% accuracy — commits close at 62% vs team avg of 84%"

**Right column (narrower): Deal Risk Alerts**

Deal-anchored annotations (where `anchor.type === 'deal'`) rendered as cards:
- Deal name + amount
- Severity badge
- Title + body (always visible, not collapsed)
- Impact line
- "View deal →" link

**Data source:** `by_rep` from the latest snapshot output for the rep table. Deal annotations from the annotations API.

### Section 5: Coverage + Pipe Gen (two columns)

**Left column: Coverage by Quarter**

Horizontal bars showing coverage for current quarter + next 1-2 quarters:
- Solid bar = existing pipeline
- Lighter extension = projected pipeline (if "Include pipe gen" toggle is on)
- 3x target marker as a dashed vertical line
- Coverage ratio label (e.g., "2.1x")

Coverage-anchored annotations (`anchor.type === 'coverage'`) render directly below the relevant quarter's bar.

**Right column: Pipe Gen Trend**

Vertical bar chart showing weekly pipeline generation over trailing 8 weeks. Trailing average as a horizontal dashed line.

**Data source:** Coverage projections from the snapshot output. Weekly pipe gen calculated from `deals.created_date` grouped by week.

### Deal Drill-Down Panel

A slide-out panel from the right edge that shows the deals behind any clicked number. Same as the mockup — deal name, amount, stage, owner, probability, forecast category badge, MC contribution bar, days in stage.

Triggered by:
- Clicking a metric card
- Clicking a chart endpoint value
- Clicking a rep's forecast number
- Clicking "View deals →" on an annotation card

Footer buttons: "Query in SQL Workspace" + "Export to Excel"

## Data Fetching

The Forecast page needs three API calls:

```typescript
// 1. Snapshot history (for chart + metrics)
GET /api/workspaces/:id/skills/forecast-rollup/runs?limit=13
// Returns the last 13 weekly runs (one quarter), each with snapshot data in output

// 2. Annotations (for all annotation surfaces)
GET /api/workspaces/:id/forecast/annotations
// Returns active annotations with anchor, evidence, body, impact, recommendation

// 3. Current deals (for drill-down)
GET /api/workspaces/:id/deals?close_date_gte={quarterStart}&close_date_lte={quarterEnd}
// Returns open deals in the forecast period for drill-down panels
```

The snapshot history endpoint may need to be created if it doesn't exist. Check whether the current skill_runs API supports fetching multiple runs for a specific skill with output data included. If not, add:

```typescript
GET /api/workspaces/:id/forecast/snapshots?period=Q1+2026
// Returns: array of { snapshot_date, stage_weighted, category_weighted, mc_p50, mc_p25, mc_p75, attainment, by_rep, pipe_gen_this_week }
// Extracted from skill_runs.output for forecast-rollup runs in the given period
```

## Sidebar Navigation

Add "Forecast" to the sidebar under OPERATIONS:

```
OPERATIONS
  ◎  Targets
  ▶  Playbooks
  📈  Forecast       ← NEW
  🔔  Push
```

Use a chart/trend icon. The route should be `/workspaces/:workspaceId/forecast` or whatever pattern the existing routes follow.

## Annotation Integration

The Forecast page is where annotations get their full contextual treatment. Use the `useForecastAnnotations` hook and the `grouped` object to place annotations in the right location:

```typescript
const { grouped, dismiss, snooze } = useForecastAnnotations(workspaceId);

// Chart markers: grouped.chart
// Chart sidebar: grouped.chart (same data, different rendering)
// Deal risk cards: grouped.deals
// Rep inline annotations: grouped.reps
// Coverage inline annotations: grouped.coverage
// Global insights: grouped.global (render in chart sidebar if no better home)
```

The ✨ AI On/Off toggle in the header controls visibility of all annotation surfaces. Default is on. When off, the page is a pure data dashboard — chart markers hidden, sidebar hidden, rep annotations hidden, deal risk cards hidden.

## Graceful Degradation

### No snapshots yet (brand new workspace)
Show the page shell with a centered empty state: "Forecast tracking starts after your first weekly pipeline review. Run a forecast skill to capture your first snapshot." Include a "Run now" button that triggers the forecast-rollup skill.

### 1 snapshot
Show metric cards and the current week's data. No chart (need 2+ points). Show a message: "Forecast chart appears after 2 weekly snapshots."

### 2-4 snapshots (first month)
Show the chart with available data points. Tier 1 annotations only (deal risk, divergence, basic confidence band). No attainment pace or rep bias (need more history).

### 5+ snapshots (full feature set)
Everything renders. Chart has enough points to be meaningful. Coverage trends have enough pipe gen history. Confidence band narrowing is visible.

### No Monte Carlo results
Hide the MC P50 line on the chart. Hide the MC P50 metric card. Show stage-weighted and category-weighted only. Show a note: "Enable Monte Carlo simulations for probability-based forecasting."

### No quotas configured
Hide the quota line on the chart. Hide attainment % on metric cards. Hide gap-to-quota metric. Show: "Configure quotas to see attainment tracking."

---

## Files to Create

### Part 1 (Command Center Reorder):
1. `client/src/components/command-center/CompactAlerts.tsx` — Max 3 critical/warning annotations with inline preview

### Part 2 (Forecast Page):
3. `client/src/pages/ForecastPage.tsx` — Main page component with all 5 sections
4. `client/src/components/forecast/ForecastChart.tsx` — SVG line chart with toggleable lines, confidence band, annotation markers, clickable endpoints
5. `client/src/components/forecast/MetricCards.tsx` — Row of 5 clickable metric cards with smart formatting
6. `client/src/components/forecast/RepTable.tsx` — Sortable rep breakdown with inline annotations
7. `client/src/components/forecast/CoverageBars.tsx` — Coverage bars with pipe gen projections and inline annotations
8. `client/src/components/forecast/PipeGenChart.tsx` — Trailing 8-week pipe gen bar chart
9. `client/src/components/forecast/DrillDownPanel.tsx` — Slide-out deal list panel
10. `client/src/components/forecast/ChartInsightsSidebar.tsx` — Chart-anchored annotations panel

### API (if needed):
11. `server/routes/forecast-snapshots.ts` — GET endpoint that extracts snapshot history from skill_runs

## Files to Modify

1. `client/src/pages/CommandCenter.tsx` — Reorder sections: Pipeline Metrics first, replace AnnotationsPanel with CompactAlerts below metrics, remove mid-content targets banner
2. `client/src/App.tsx` (or router config) — Add `/forecast` route pointing to ForecastPage
3. Sidebar component — Add "Forecast" nav item under OPERATIONS

---

## Implementation Order

1. **Command Center reorder first** (1-2 hrs) — Move Pipeline Metrics above annotations, replace AnnotationsPanel with CompactAlerts, remove mid-content banner. Immediate visual improvement with minimal code change.
2. **Forecast page shell** (1-2 hrs) — Route, sidebar link, header + metric cards. Even with no chart, the metric cards from the latest snapshot are useful.
3. **Forecast chart** (3-4 hrs) — SVG chart with 4 lines, confidence band, quota line. This is the most complex component.
4. **Annotation integration** (2-3 hrs) — Chart markers, sidebar, rep inline annotations, coverage annotations, AI toggle.
5. **Drill-down panel** (2-3 hrs) — Slide-out deal list triggered by clicking any number.
6. **Rep table + coverage bars** (2-3 hrs) — Below the chart, with annotation integration.
7. **Snapshot API** (1-2 hrs) — If the existing skill_runs API doesn't support the needed query pattern.

Total: ~15-20 hours.

---

## What NOT to Build Yet

- **SQL Workspace integration** from the Forecast page (the "Query in SQL" button). Wire it as a link for now, implement the state-passing navigation later.
- **Export to Excel** from the drill-down panel. Wire as a disabled button for now.
- **Week-over-week snapshot comparison table** (the raw data table at the bottom of the mockup). The chart is the primary view — the table is a power user feature for later.
- **Pipe gen projections on coverage bars** — Show existing pipeline only for v1. The projection math requires the trailing average and trend calculation which is a separate compute step.

---

## Verification

### Command Center:
1. Pipeline Metrics is the first content section (visible without scrolling)
2. AI Alerts section sits directly below Pipeline Metrics
3. No more than 3 annotations visible, all critical/warning severity
4. Annotations show body preview text (not just titles)
5. "View all insights →" link navigates to /forecast
6. Monte Carlo, Pipeline by Stage, Actions, Findings all render in their current order below alerts
7. No banners interrupting between content sections

### Forecast Page:
1. Route `/forecast` loads the page
2. Sidebar shows "Forecast" under OPERATIONS
3. Metric cards display latest snapshot data
4. Chart renders with available snapshot history (or empty state message)
5. Annotation markers appear on chart at correct weeks
6. Chart insights sidebar shows chart-anchored annotations
7. Rep table shows rep breakdown with inline annotations
8. Coverage bars render with coverage annotations
9. AI toggle shows/hides all annotation surfaces
10. Clicking any number opens drill-down panel with underlying deals
11. Graceful degradation works for 0, 1, 2-4, and 5+ snapshots

---

## Commit Messages

```
fix: reorder Command Center — pipeline metrics first, compact AI alerts below, remove mid-content banner

feat: add Forecast page with longitudinal tracking chart, contextual annotations, rep table, and coverage projections
```
