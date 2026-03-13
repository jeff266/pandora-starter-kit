# Concierge — Target Scoping Fix
## Claude Code Prompt

Read server/context/opening-brief.ts, server/routes/briefing.ts,
and server/routes/briefing-math.ts before writing any code.

---

## CONTEXT

Frontera Health has four targets, all with status = 'Active':

  Q1 FY2027 · $350K · Core Sales Pipeline · period ~Jan–Mar 2026
  Q2 FY2027 · $400K · Core Sales Pipeline · period ~Apr–Jun 2026
  Q3 FY2027 · $450K · Core Sales Pipeline · period ~Jul–Sep 2026
  Q4 FY2027 · $500K · Core Sales Pipeline · period ~Oct–Dec 2026

Today is March 13, 2026. The correct active target is Q1 FY2027 · $350K.

The current implementation is selecting the wrong target — likely
ORDER BY amount DESC or ORDER BY created_at DESC — and returning
Q4 FY2027 · $500K, which has no closed won deals in its period,
producing 0% attainment. Or it is summing all-time closed won
against the wrong target, producing 250–927% attainment.

Both are wrong. The fix is below.

---

## STEP 0 — AUDIT FIRST

Before writing any code, run this query and report the result:

  SELECT id, period_label, amount, period_start, period_end,
    is_primary, status, pipeline_name
  FROM targets
  WHERE workspace_id = '[frontera-workspace-id]'
  ORDER BY period_start ASC;

Report:
1. The exact column names (period_start, period_end — or are they
   named differently?)
2. Whether pipeline_name is a column or stored differently
3. What the current target selection query looks like in the code
4. Where closed won deals are summed — what date filter if any
   is currently applied

Do not proceed until this audit is reported.

---

## STEP 1 — FIX TARGET SELECTION

Replace every target selection query with this pattern:

  SELECT * FROM targets
  WHERE workspace_id = $1
    AND status = 'Active'
    AND period_start <= CURRENT_DATE
    AND period_end >= CURRENT_DATE
  ORDER BY
    CASE WHEN is_primary THEN 0 ELSE 1 END ASC,
    amount ASC
  LIMIT 1

The LIMIT 1 with ASC on amount is intentional: if multiple active
targets overlap today's date, prefer the more specific (smaller)
one over an annual rollup.

Apply this fix everywhere the headline target is selected:
  - assembleOpeningBrief() in opening-brief.ts (if target is queried
    there — check first, do not assume)
  - /briefing/math/coverage denominator
  - /briefing/math/attainment numerator and denominator
  - /briefing/math/pipeline denominator

If the column names differ from period_start/period_end (e.g.
starts_at, ends_at, quota_start), use the actual column names
confirmed in Step 0.

---

## STEP 2 — FIX CLOSED WON SCOPING

The closed won query must be scoped to the active target's period.
Not all-time. Not the current calendar quarter. The exact
period_start to period_end of the matched target.

Pattern:

  -- First get the active target
  const target = await getActiveTarget(workspaceId);

  -- Then scope closed won to that period
  SELECT SUM(amount) as closed_won_value
  FROM deals
  WHERE workspace_id = $1
    AND stage_normalized = 'closed_won'
    AND close_date >= target.period_start
    AND close_date <= target.period_end
    [AND pipeline = target.pipeline_name if pipeline_name is not null]

The pipeline filter on closed won: only apply it if the target has
a specific pipeline_name. If pipeline_name is null or 'All pipelines',
do not filter by pipeline — sum all closed won in the period.

Apply this fix to:
  - assembleOpeningBrief() closedWonValue and pctAttained calculation
  - /briefing/math/attainment numerator
  - /briefing/math/coverage gap calculation (gap = target - closed_won)

---

## STEP 3 — HANDLE MISSING OR MISMATCHED TARGETS

After the date-scoped target selection query runs, handle these cases:

CASE 1 — No target found (query returns null):
  Return brief.targets as:
  {
    headline: null,
    pctAttained: null,
    closedWonValue: [sum of closed won in current fiscal quarter,
                     even without a target],
    gap: null,
    periodStart: [fiscal quarter start],
    periodEnd: [fiscal quarter end],
    hasTarget: false
  }

  The Concierge verdict block must NOT show a percentage when
  hasTarget = false. Instead show pipeline coverage ratio
  (brief.pipeline.coverageRatio) as the primary metric.

  Do not show "No target configured" or "0% attained" in the
  verdict block. Just show what can be measured without a target.

CASE 2 — Target found but pipeline doesn't match current view:
  When a ?pipeline query param is passed to /briefing/concierge:

  If target.pipeline_name IS NULL or 'All pipelines':
    Apply the target workspace-wide. No pipeline mismatch.

  If target.pipeline_name != the requested pipeline param:
    Set hasTarget = false for this view.
    Do not mix a target from one pipeline against deals from another.
    Show coverage ratio instead of attainment.

  If target.pipeline_name == the requested pipeline param:
    Normal attainment. Show percentage.

CASE 3 — Target found, current period, matching pipeline:
  Normal calculation. hasTarget = true. Show pctAttained.

Add hasTarget: boolean to the targets object returned by both
assembleOpeningBrief() and the /briefing/math endpoints.

---

## STEP 4 — ADD PIPELINE FILTER SUPPORT

Add a ?pipeline query parameter to GET /briefing/concierge.

When ?pipeline=Core+Sales+Pipeline is passed:
  1. Filter the target selection to targets where pipeline_name
     matches (or pipeline_name is null/All)
  2. Filter all deal queries to deals.pipeline = pipeline param
     - open pipeline (for coverage)
     - closed won (for attainment)
     - findings join (only surface findings for deals in this pipeline)
  3. Return the matched target for that pipeline

When ?pipeline is absent:
  Use the workspace-wide target (pipeline_name = null or
  'All pipelines'). If no workspace-wide target exists, use the
  largest-scope target that covers today's date.
  Apply no pipeline filter to deals.

Add a new endpoint:
  GET /api/workspaces/:workspaceId/briefing/pipelines

  Returns:
  {
    pipelines: [
      { name: 'All Data', value: null, hasTarget: true/false },
      { name: 'Core Sales Pipeline', value: 'Core Sales Pipeline',
        hasTarget: true, targetAmount: 350000 },
      { name: 'Fellowship Pipeline', value: 'Fellowship Pipeline',
        hasTarget: false },
      { name: 'Partnership Pipeline', value: 'Partnership Pipeline',
        hasTarget: false }
    ]
  }

  Build the list from:
    - DISTINCT deals.pipeline for this workspace (all pipelines
      that have deals)
    - LEFT JOIN targets to show hasTarget and targetAmount

  This endpoint powers the "All Data" dropdown in the Concierge
  topbar. Replit will wire the dropdown in a separate session.

---

## STEP 5 — FINDINGS SCOPING (secondary, do after Steps 1–4)

The current brief surfaces findings from ALL pipelines against a
target from only ONE pipeline. This creates misaligned action cards.

When a pipeline filter is active (either from ?pipeline param or
from the target's pipeline_name), scope the findings query to only
findings where:

  findings.deal_id IN (
    SELECT id FROM deals
    WHERE workspace_id = $1
      AND pipeline = [active pipeline filter]
  )

When no pipeline filter is active, show all findings (existing
behavior).

This ensures action cards are always apples-to-apples with the
verdict block target.

---

## STEP 6 — VALIDATE

After all fixes are applied:

1. GET /briefing/concierge for Frontera Health workspace:
   - brief.targets.headline should be $350K (Q1 FY2027)
   - brief.targets.pctAttained should be between 0–300%
     (a plausible Q1 number, not 927%)
   - brief.targets.closedWonValue should be deals closed
     between ~Jan 1 2026 and Mar 31 2026 only

2. GET /briefing/math/attainment:
   - numerator: closed won in Q1 FY2027 period
   - denominator: $350K
   - ratio: plausible percentage

3. GET /briefing/math/coverage:
   - denominator should be the gap (target - closed won),
     not the full target amount

4. GET /briefing/pipelines:
   - Returns all three pipelines with hasTarget flags

5. GET /briefing/concierge?pipeline=Fellowship+Pipeline:
   - hasTarget = false (no target configured for Fellowship)
   - verdict block would show coverage, not attainment
   - findings scoped to Fellowship Pipeline deals only

6. GET /briefing/concierge for a workspace with NO targets at all:
   - hasTarget = false
   - No crash, no 0% attainment shown
   - Pipeline coverage shown as primary metric

Report results for each validation point.

---

## DO NOT TOUCH

- server/context/opening-brief.ts synthesis/narrative logic
- server/chat/orchestrator.ts
- server/chat/pandora-agent.ts
- Any existing migrations
- The targets table schema (read only — do not add columns)

The targets table schema is sufficient as-is. The pipeline scoping
works through the existing pipeline_name column. No migration needed.

