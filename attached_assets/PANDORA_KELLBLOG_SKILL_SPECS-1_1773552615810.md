# Pandora — Kellblog-Inspired Skill Specs
## Source: Dave Kellogg's Kellblog (kellblog.com)

All skills follow the mandatory three-phase COMPUTE → CLASSIFY → SYNTHESIZE pattern
from PANDORA_SKILL_DESIGN_GUIDE.md.

---

## Architecture Overview: New Skills vs. Enhancements vs. Agent Patterns

| Kellblog Concept | Pandora Form | Type |
|---|---|---|
| Pipeline Progression Chart (Q0/Q+1/Q+2) | `pipeline-progression` | **New skill** |
| Week-3 Pipeline Conversion Rate | `pipeline-conversion-rate` | **New skill** |
| To-Go Coverage / Intra-Quarter Burn | Enhancement to `pipeline-coverage` | **Skill enhancement** |
| Triangulation Forecast (5 bearings) | Enhancement to `forecast-rollup` | **Skill enhancement** |
| Rep Ramp Chart (tenure cohort) | Enhancement to `rep-scorecard` | **Skill enhancement** |
| GTM Diagnostic (coverage vs. conversion) | `gtm-health-diagnostic` | **New skill + Agent playbook** |
| Narrow vs. Broad Win Rate | Enhancement to `forecast-rollup` / `rep-scorecard` | **Shared compute function** |
| Pipeline Source Conversion Mix | Enhancement to Marketing Attribution skill | **Skill enhancement** |

### How These Are Called

**Scheduled runs (Operator agents):**
- `pipeline-progression` → Monday 8 AM alongside `pipeline-coverage`
- `pipeline-conversion-rate` → Monday 8 AM (quarter-to-date snapshot)
- `gtm-health-diagnostic` → Monday 8 AM (weekly GTM health check)

**Ask Pandora entry points (the most valuable ones):**
- "What's our pipeline coverage for next quarter?" → `pipeline-progression`
- "Are we a coverage problem or a conversion problem?" → `gtm-health-diagnostic`
- "What's our actual conversion rate vs win rate?" → `pipeline-conversion-rate`
- "Is our pipeline real?" → triggers to-go burn analysis inside `pipeline-coverage`
- "Why are we missing forecast?" → `gtm-health-diagnostic` loop mode

**Command Center surface:**
- Pipeline Progression Chart → visual panel on Command Center home (pre-computed Layer 1)
- GTM Diagnostic summary → headline finding card on home

---

## 1. Pipeline Progression Skill

**ID:** `pipeline-progression`
**Category:** pipeline
**Schedule:** `{ cron: '0 8 * * 1', trigger: 'on_demand' }` — Monday 8 AM
**Output:** slack, markdown, command_center
**Tier:** Flagship
**Depends on:** deals table, stage_configs, workspace quota config

### Why It Matters

Most companies track rolling-four-quarter pipeline, which obscures the real problem:
whether you'll start each specific quarter with sufficient coverage. This skill tracks
Q0 (current quarter), Q+1, and Q+2 pipeline over time — creating an early warning
system that gives you 6–9 months of notice instead of 6–9 weeks.

The Kellblog benchmark: **3.0x starting coverage** is the target for current quarter.
Out-quarter targets are lower and workspace-specific — the skill learns them over time.

### Required Data
- `deals` table: amount, stage_normalized, close_date, owner_email, forecast_category
- `workspace_config`: quota / coverage targets
- Historical snapshots from prior `skill_runs` (to build the progression curve)

### TimeConfig Defaults
```
analysisWindow: 'trailing_12_weeks'   // build the curve over time
snapshotDate: 'monday_week_start'     // take weekly snapshots
quarters: ['current', 'next', 'n+2']
```

### New Compute Functions Needed

```typescript
// server/analysis/pipeline-progression.ts

pipelineProgressionSnapshot(workspaceId: string, snapshotDate: Date)
→ {
  snapshotDate: string,
  quarters: {
    current: {
      quarterLabel: string,          // e.g., 'Q2 2026'
      quarterStart: string,
      quarterEnd: string,
      pipelineValue: number,         // total open pipeline closing this quarter
      dealCount: number,
      coverageRatio: number,         // pipeline ÷ quota
      coverageTarget: number,        // from workspace config (default 3.0)
      coverageStatus: 'above_target' | 'on_track' | 'at_risk' | 'critical',
      commitValue: number,
      bestCaseValue: number,
      closedWonValue: number,
      remainingQuota: number,
    },
    next: { ...same shape },
    nPlus2: { ...same shape },
  },
  teamQuota: { current: number, next: number, nPlus2: number },
}

pipelineProgressionHistory(workspaceId: string, weeksBack: number)
→ {
  // Pull from historical skill_runs.result_data for this skill
  // Returns array of weekly snapshots sorted ascending
  snapshots: PipelineProgressionSnapshot[],
  trendLines: {
    current: number[],   // coverage ratios over time for current quarter
    next: number[],
    nPlus2: number[],
  },
  earlyWarnings: {
    quarterLabel: string,
    weeksOut: number,
    currentCoverage: number,
    projectedCoverage: number,   // if trend continues
    gapToCover: number,          // $ needed to hit target
    urgent: boolean,             // <8 weeks to quarter start + below target
  }[],
}
```

### Steps

```
Step 1: resolve-quarters (COMPUTE)
  - Determine Q0, Q1, Q2 date ranges based on workspace fiscal calendar
  - Output: { quarters: [{ label, start, end }], teamQuota, coverageTarget }

Step 2: snapshot-current-pipeline (COMPUTE)
  - For each of 3 quarters: sum pipeline value, count deals, compute coverage ratio
  - Segment by forecast_category (commit / best_case / upside)
  - Output: current week's three-quarter snapshot

Step 3: load-historical-snapshots (COMPUTE)
  - Read prior 12 weeks of skill_runs.result_data for this skill
  - Extract coverage ratios per quarter per week
  - Compute trend direction and velocity
  - Output: { trendLines, weeksOfData, firstSnapshotDate }

Step 4: detect-early-warnings (COMPUTE)
  - For Q+1 and Q+2: project coverage if trend continues
  - Flag if projected coverage < target with < 8 weeks to quarter start
  - Also flag: week-over-week pipeline drops > 10% in any quarter
  - Output: earlyWarnings[]

Step 5: classify-quarter-health (DEEPSEEK)
  - Input: Q+1 and Q+2 status + trend + early warnings
  - Classify each: health_status, primary_cause, urgency
  - Output: { quarterClassifications: [{ quarter, health, cause, urgency }] }

Step 6: synthesize-progression-report (CLAUDE)
  - Headline: current quarter snapshot + trend assessment
  - Q+1 status with specific dollar gap and weeks remaining to fix
  - Q+2 early warning if applicable
  - One specific action per at-risk quarter
  - Tools: queryDeals (drill into specific quarters on demand)
```

### Token Budget Estimate
- Compute: ~2,500 tokens
- DeepSeek: ~1,000 tokens (classifying 2–3 quarters)
- Claude: ~3,500 tokens
- **Total: ~7,000 tokens**

### Ask Pandora Integration

**Query:** "What does our pipeline look like for next quarter?"
**Route:** Heuristic → pipeline_progression → query skill_runs (Layer 1, no rerun)
**Response:** Pulls latest snapshot, renders Q0/Q+1/Q+2 coverage in text with trend

**Query:** "Are we on track for Q3?"
**Route:** Heuristic → pipeline_progression + deal scoping
**Response:** Q+1 coverage ratio, gap, specific deals in that quarter

### Command Center Surface

The progression chart is the ideal Command Center visualization: a three-line chart
(Q0, Q+1, Q+2 coverage over time) with a horizontal 3.0x target line. Pre-computed
from `skill_runs` data — zero token cost on page load.

---

## 2. Pipeline Conversion Rate Skill

**ID:** `pipeline-conversion-rate`
**Category:** pipeline
**Schedule:** `{ cron: '0 8 * * 1', trigger: 'on_demand' }` — Monday 8 AM
**Output:** slack, markdown
**Tier:** Solid
**Depends on:** deals table, deal_stage_history, skill_runs (for historical rates)

### Why It Matters

Win rate (wins ÷ wins + losses) is the wrong metric for forecasting required pipeline
coverage. It excludes no-decisions/derails and measures a different time horizon.
The correct metric is **week-3 pipeline conversion rate**: new ARR closed ÷ week-3
starting pipeline value. This is historically stable and directly invertible to find
required starting coverage.

This skill also distinguishes **narrow win rate** (wins ÷ wins + losses, excluding
derails) from **broad win rate** (wins ÷ all terminal states including no-decisions),
which reveals whether the company is losing to competitors or losing to status quo.

### Required Data
- `deals` table: amount, stage_normalized, close_date, closed_won_date, forecast_category, owner_email
- `skill_runs` table: historical conversion rates for trend
- Quarterly start dates to define "week 3" snapshots

### New Compute Functions Needed

```typescript
// server/analysis/pipeline-conversion.ts

week3PipelineConversionRate(
  workspaceId: string,
  quarterStart: Date,
  quarterEnd: Date
) → {
  quarterLabel: string,
  week3SnapshotDate: string,        // day 21 of quarter
  week3PipelineValue: number,       // total open pipeline on day 21
  closedWonValue: number,           // new ARR closed during quarter
  conversionRate: number,           // closedWon ÷ week3Pipeline
  impliedCoverageTarget: number,    // 1 ÷ conversionRate (what coverage you need)
  dealCount: {
    week3Pipeline: number,
    closedWon: number,
    closedLost: number,
    derailed: number,               // no decision / status quo / cancelled
    stillOpen: number,
  },
}

winRateAnalysis(workspaceId: string, lookbackQuarters: number) → {
  narrow: {
    rate: number,                   // wins ÷ (wins + losses)
    wins: number,
    losses: number,
    trend: 'improving' | 'stable' | 'declining',
    quarterlyRates: number[],
  },
  broad: {
    rate: number,                   // wins ÷ (wins + losses + derails)
    wins: number,
    losses: number,
    derails: number,
    trend: 'improving' | 'stable' | 'declining',
    quarterlyRates: number[],
  },
  narrowToBroadGap: number,         // how much derails are hiding loss rate
  derailRate: number,               // derails ÷ all terminal states
  lossReasons: {                    // from CRM loss reason field if available
    [reason: string]: number,
  },
}
```

### Steps

```
Step 1: resolve-completed-quarters (COMPUTE)
  - Find last 4–6 completed quarters with sufficient data
  - For each: week-3 snapshot date, closed ARR, deal terminal states
  - Output: { completedQuarters: QuarterConversionData[] }

Step 2: compute-current-quarter-projection (COMPUTE)
  - Current quarter: compute to-date conversion rate
  - Project final conversion rate based on current pacing + historical rate
  - Compute implied coverage target: if our rate is 28%, we need 3.57x
  - Output: { currentQuarterProjection, impliedCoverageTarget }

Step 3: compute-win-rates (COMPUTE)
  - Narrow and broad win rates for last 4 quarters
  - Derail rate trend
  - Loss reason distribution if field is populated
  - Output: { narrowWinRate, broadWinRate, derailRate, lossReasons }

Step 4: compute-coverage-adequacy (COMPUTE)
  - Compare current coverage (from pipeline-coverage skill_run) to implied need
  - Flag: "your conversion rate implies you need 3.6x; your coverage is 2.8x — gap of 0.8x ($640K)"
  - Output: { coverageGap, coverageAdequate, shortfallValue }

Step 5: classify-conversion-health (DEEPSEEK)
  - Input: conversion rate trend, win rate trends, derail rate, coverage gap
  - Classify: conversion_trend, primary_drag (win_rate | derail_rate | deal_size_shift | mix_shift), severity
  - Output: { classification, primaryDrag, severity, suggestedFocus }

Step 6: synthesize-conversion-report (CLAUDE)
  - Lead with the key number: "Your week-3 conversion rate is 31%, implying 3.2x coverage needed"
  - Narrow vs. broad win rate gap and what it means
  - Trend: improving, stable, or declining — and over how many quarters
  - If coverage-adjusted gap exists, call it out with $ amount
  - Specific action: whether to focus on coverage, conversion, or derail reduction
```

### Token Budget Estimate
- Compute: ~3,000 tokens
- DeepSeek: ~800 tokens
- Claude: ~3,000 tokens
- **Total: ~6,800 tokens**

### Ask Pandora Integration

**Query:** "What's our win rate?"
**Route:** Heuristic → pipeline_conversion_rate → Layer 1 skill_run query
**Response:** Both narrow and broad win rates, with the gap explained

**Query:** "How much pipeline do we actually need to hit number?"
**Route:** Heuristic → pipeline_conversion_rate + pipeline_coverage
**Response:** Conversion rate → implied coverage target → gap vs current coverage

**Query:** "Are we losing to competitors or losing to no-decision?"
**Route:** Heuristic → pipeline_conversion_rate → narrow/broad gap + derail rate
**Response:** Derail rate, trend, and if loss reason data exists, a breakdown

---

## 3. To-Go Coverage Enhancement (pipeline-coverage)

**Type:** Enhancement to existing `pipeline-coverage` skill
**Adds:** Intra-quarter burn tracking, fake pipeline detection, week-over-week to-go table

### Why It Matters

Week-3 starting coverage tells you if you began the quarter with enough.
To-go coverage tells you where you stand *right now*. The key detection: if pipeline
is burning off faster than deals are closing or advancing, it signals "fake pipeline"
— deals that entered but shouldn't have, now quietly being removed or aged out.

### New Compute Function

```typescript
toGoCoverageByWeek(workspaceId: string, quarterStart: Date) → {
  weeks: {
    weekNumber: number,           // 1–13
    weekStartDate: string,
    openPipelineValue: number,    // total open pipeline at start of this week
    closedWonThisWeek: number,    // new ARR closed
    pipelineAddedThisWeek: number, // new deals created with close date this quarter
    pipelineRemovedThisWeek: number, // deals closed-lost, deleted, or pushed out
    netPipelineChange: number,
    toGoCoverage: number,         // remaining pipeline ÷ remaining quota
    remainingQuota: number,
    burnRate: number,             // pipeline removed ÷ pipeline at week start
  }[],
  burnAlert: {
    triggered: boolean,
    weekNumber: number,
    burnRate: number,
    historicalAvgBurnRate: number,
    excessBurnValue: number,      // $ above normal burn
    fakePipelineRisk: 'high' | 'medium' | 'low',
  },
  projectedLanding: number,       // if burn rate continues, projected closed ARR
}
```

### Steps to Add

Add after existing `gather-coverage-data` step:

```
Step 3b: compute-to-go-coverage (COMPUTE)
  - Weekly pipeline snapshots for current quarter
  - Compute burn rate per week vs historical average
  - Flag weeks where burn rate exceeds 1.5x historical average
  - Output: toGoCoverageByWeek result

Step 3c: detect-fake-pipeline (COMPUTE)
  - Compare week-3 pipeline to current pipeline by original deal
  - Identify deals that were in week-3 pipeline and have since been
    removed (not closed-won) — these are the "fake" ones
  - Compute: fake pipeline % = removed deals ÷ week-3 total
  - Output: { fakePipelinePct, removedDealCount, removedDealValue }
```

Extend `classify-rep-risk` to include to-go signals:
```
  - Reps whose pipeline is burning off faster than average = 'pipeline_quality' root cause
  - Reps who added high-value deals in week 1 that have since disappeared = 'floating_bar'
```

Extend synthesis prompt with to-go section:
```
TO-GO COVERAGE (intra-quarter):
- Current to-go coverage: {{toGoCoverage}}x ({{weeksRemaining}} weeks left)
- Pipeline burn rate: {{burnRate}}% per week vs {{historicalBurnRate}}% historical
- Fake pipeline risk: {{fakePipelineRisk}} ({{fakePipelinePct}}% of week-3 pipeline has been removed)
- Projected landing: ${{projectedLanding}} ({{projectedAttainmentPct}}% of quota)
```

### Ask Pandora Integration

**Query:** "Is our pipeline real?"
**Route:** Heuristic → pipeline_coverage (to-go section) → Layer 1
**Response:** Burn rate vs historical, fake pipeline %, projected landing

**Query:** "How much pipeline do we have left this quarter?"
**Route:** Heuristic → pipeline_coverage → to-go coverage → current week snapshot

---

## 4. Triangulation Forecast Enhancement (forecast-rollup)

**Type:** Enhancement to existing `forecast-rollup` skill
**Adds:** 5 simultaneous forecast bearings, divergence detection, capacity-based projection

### Why It Matters

The best forecast conversations happen when you have 4–5 independent bearings
pointing at the same number — or revealing why they diverge. A CRO who's $300K
above their managers' rollup usually knows about a big deal they're counting on.
Surfacing that divergence explicitly converts a vague disagreement into a specific
conversation: "what's the deal, and what's the evidence it closes?"

### The 5 Bearings

| Bearing | Source | Notes |
|---|---|---|
| Rep-level rollup | Sum of each rep's self-forecast | Often overoptimistic |
| Manager-level rollup | Sum of manager adjustments | Kellogg says most accurate |
| Stage-weighted EV | Pipeline × stage close probabilities | Structural view |
| Forecast-category EV | Pipeline × category probabilities | Rep-classified view |
| Capacity model | Ramped reps × historical productivity | Independent of pipeline |

### New Compute Functions

```typescript
triangulationBearings(workspaceId: string, quarterStart: Date, quarterEnd: Date) → {
  repRollup: {
    total: number,
    byRep: { name: string, forecast: number, quota: number }[],
    vsQuota: number,    // pct of team quota
  },
  managerRollup: {
    total: number,
    adjustmentFromReps: number,    // manager total - rep total (negative = haircut)
    adjustmentPct: number,
  },
  stageWeightedEV: {
    total: number,
    byStage: { stage: string, pipeline: number, probability: number, ev: number }[],
    stageWeights: Record<string, number>,    // from workspace config or defaults
  },
  categoryWeightedEV: {
    total: number,
    commit: number,
    forecast: number,
    bestCase: number,
    commitProbability: number,    // workspace-configured or default 0.90
    forecastProbability: number,  // default 0.60
    bestCaseProbability: number,  // default 0.30
  },
  capacityModel: {
    rampedReps: number,           // full-quota equivalent
    historicalProductivityPerRRE: number,
    projectedARR: number,
    dataConfidence: 'high' | 'medium' | 'low',  // depends on rep history depth
  },
  divergence: {
    range: number,           // max bearing - min bearing
    rangePct: number,        // range ÷ quota
    highestBearing: { name: string, value: number },
    lowestBearing: { name: string, value: number },
    alert: boolean,          // range > 20% of quota
    alertMessage: string,    // "Rep rollup is $420K above manager rollup..."
  },
}
```

### Steps to Add

Add after existing `gather-pipeline-data` step:

```
Step 2b: compute-triangulation-bearings (COMPUTE)
  - All 5 bearings in one compute step
  - Compute divergence: range, highest, lowest, alert flag
  - Output: triangulationBearings result

Step 2c: compute-capacity-model (COMPUTE)
  - If rep hire date data available: compute RREs
  - Multiply by historical productivity per RRE from last 4 quarters
  - Output: { rampedReps, historicalProductivity, projectedARR, confidence }
```

Extend DeepSeek classification to include bearing alignment:
```
  - bearing_alignment: 'converging' | 'mixed' | 'diverging'
  - divergence_cause: 'cro_pull_forward' | 'rep_optimism' | 'stage_weight_mismatch' | 'capacity_constrained'
```

Extend synthesis to lead with triangulation if divergence alert is triggered:
```
TRIANGULATION ALERT: Bearings are ${{divergence.range}} apart ({{divergence.rangePct}}% of quota).
  - Highest: {{highestBearing.name}} at ${{highestBearing.value}}
  - Lowest: {{lowestBearing.name}} at ${{lowestBearing.value}}
  - Most likely cause: {{divergenceCause}}
```

### Ask Pandora Integration

**Query:** "What does the forecast look like?"
**Route:** Heuristic → forecast-rollup → Layer 1 (triangulation table pre-computed)
**Response:** All 5 bearings in a simple table with divergence highlighted

**Query:** "Why is the CRO's number higher than the rep rollup?"
**Route:** Loop mode → forecast-rollup + deal-risk-review → identify big deals in CRO view
**Response:** Identifies the specific deals driving the gap, their evidence quality

---

## 5. Rep Ramp Chart Enhancement (rep-scorecard)

**Type:** Enhancement to existing `rep-scorecard` skill
**Adds:** Tenure-relative productivity cohort (the "Rep Ramp Chart")

### Why It Matters

Fiscal quarter alignment shows you *what* is happening. Tenure alignment shows you
*who your company is producing*. A rep in their 3rd quarter should hit 50% of
steady-state productivity — if they're at 20%, that's a hiring or enablement problem,
not a territory problem. Kellogg's insight: **ramp assumptions belong in the center of
the bookings model**, not hidden in someone's spreadsheet.

### New Compute Function

```typescript
repRampAnalysis(workspaceId: string) → {
  ramps: {
    repEmail: string,
    repName: string,
    hireDate: string,
    currentTenureQuarters: number,
    isActive: boolean,
    quarterlyProductivity: {
      tenureQuarter: number,     // Q1 with company, Q2, Q3... (NOT fiscal quarter)
      fiscalQuarter: string,     // the actual fiscal quarter label
      newArrBookings: number,
      quotaAssigned: number,
      attainmentPct: number,
    }[],
    avgProductivityQ4Plus: number,   // "steady state" — average once tenured
  }[],
  rampCurve: {
    tenureQuarter: number,
    medianProductivity: number,      // median bookings across all reps at this tenure
    p25Productivity: number,
    p75Productivity: number,
    companyRampPct: number,          // median as % of steady-state (Q4+ average)
  }[],
  steadyStateProductivity: number,   // median Q4+ productivity across all reps
  impliedRampSchedule: {             // what the data says ramp looks like
    q1: number,   // % of steady state (e.g., 0.05)
    q2: number,   // 0.25
    q3: number,   // 0.60
    q4: number,   // 0.90
    q5Plus: number,  // 1.00
  },
  newRepRisk: {
    repsInFirstTwoQuarters: number,
    combinedExpectedProductivity: number,  // based on ramp schedule
    combinedActualProductivity: number,
    underperformingNewReps: string[],
  },
}
```

### Steps to Add

Add as a parallel compute step to the existing scorecard pipeline:

```
Step 1b: compute-rep-ramp (COMPUTE)
  - Requires rep hire dates (from workspace config or CRM user data)
  - If hire dates unavailable: skip gracefully, log in output
  - Compute tenure in quarters for each rep
  - For each tenure quarter: aggregate ARR bookings
  - Build company ramp curve from all historical reps (including departed)
  - Flag reps whose current tenure-quarter productivity is < p25 for their cohort
  - Output: repRampAnalysis result
```

Extend DeepSeek classification:
```
  - Add 'below_ramp_curve' root cause to rep risk classifications
  - Add 'ramp_reset' detection: rep who was tenured but reset (promotion, territory change)
```

Extend synthesis to include ramp section (only when new reps exist):
```
REP RAMP STATUS:
- Steady-state productivity: ${{steadyStateProductivity}}K/quarter
- Company ramp curve: {{q1}}% → {{q2}}% → {{q3}}% → {{q4}}%
- {{newRepCount}} reps in first 2 quarters: expected ${{expectedNew}}, actual ${{actualNew}}
- At-risk new reps: {{underperformingNewReps}} (below p25 for their tenure quarter)
```

### Ask Pandora Integration

**Query:** "How long does it take for new reps to ramp?"
**Route:** Heuristic → rep-scorecard (ramp section) → Layer 1
**Response:** Company ramp curve with percentile bands

**Query:** "Is [rep name] performing normally for how long they've been here?"
**Route:** Heuristic → rep-scorecard (ramp section) → rep scoping
**Response:** Rep's tenure-relative performance vs company p25/p50/p75

---

## 6. GTM Health Diagnostic Skill

**ID:** `gtm-health-diagnostic`
**Category:** pipeline
**Schedule:** `{ cron: '0 9 * * 1', trigger: 'on_demand' }` — Monday 9 AM (after other skills run)
**Output:** slack, markdown, command_center
**Tier:** Flagship
**Depends on:** `pipeline-coverage`, `pipeline-conversion-rate`, `forecast-rollup` skill_runs

### Why It Matters

Kellogg's most practical framework: every plan miss comes down to exactly two root
causes — insufficient coverage or insufficient conversion. Conflating them leads to
the wrong fix. Blaming sales for a coverage problem, or throwing leads at a conversion
problem, are both expensive mistakes.

This skill reads the outputs of other skills and renders a verdict: **coverage problem,
conversion problem, both, or neither** — with evidence and the recommended response.

It also catches the "floating bar" scenario: coverage looks fine but conversion is
falling because sellers are lowering their pipeline standards under pressure.

### Required Data
- `skill_runs` from: `pipeline-coverage`, `pipeline-conversion-rate`, `forecast-rollup`
- This skill does NOT re-query CRM data — it reads pre-computed skill outputs

### Steps

```
Step 1: load-skill-outputs (COMPUTE)
  - Pull latest completed run for: pipeline-coverage, pipeline-conversion-rate, forecast-rollup
  - Extract key metrics from each: coverage ratio, conversion rate, forecast attainment pct
  - If any required skill hasn't run: skip that dimension, note the gap
  - Output: {
      coverage: { ratio, target, adequacy, toGoBurnAlert },
      conversion: { rate, impliedCoverageNeeded, trend, narrowWinRate, broadWinRate, derailRate },
      forecast: { attainmentPct, divergenceAlert, topBearing, bottomBearing },
    }

Step 2: compute-coverage-adequacy (COMPUTE)
  - Compare actual coverage to conversion-implied coverage need
  - Coverage-adjusted gap: actual ratio vs (1 / conversion_rate)
  - Example: 2.8x coverage, 28% conversion rate → needs 3.57x → gap is 0.77x ($690K)
  - Output: { coverageAdequate, conversionAdequate, adjustedGap }

Step 3: compute-historical-context (COMPUTE)
  - Pull last 6 quarters of coverage + conversion from skill_run history
  - Identify: was this quarter's rate historically normal or a deviation?
  - Detect floating bar: coverage stable but conversion declining = likely pipeline quality issue
  - Output: { historicalCoverage, historicalConversion, floatingBarDetected }

Step 4: classify-gtm-problem (DEEPSEEK)
  - Input: coverage adequacy, conversion adequacy, historical context, floating bar flag
  - Classify primary problem: 
    - 'coverage_only' | 'conversion_only' | 'both' | 'healthy' | 'floating_bar'
  - Identify secondary signals: mix shift, competitive pressure, rep capacity
  - Output: { primaryProblem, confidence, secondarySignals, recommendedFocus }

Step 5: synthesize-gtm-health-report (CLAUDE)
  - Headline verdict: one sentence diagnosis
  - Evidence section: the numbers that support the verdict
  - What NOT to do: the common wrong response to this diagnosis
  - Recommended actions: 2–3 specific, sequenced steps
  - Tools: none (reads only pre-computed data)
```

### Synthesis Prompt Structure

```
You are diagnosing a go-to-market health problem for a B2B SaaS company.
Your job: render a verdict, show the math, and give a clear recommended path.

COVERAGE STATUS:
- Current coverage: {{coverageRatio}}x (target: {{coverageTarget}}x)
- Coverage-adjusted need: {{impliedCoverageTarget}}x (based on {{conversionRate}}% conversion rate)
- Coverage gap: {{coverageGap}}x (${{coverageGapValue}})
- To-go burn: {{toGoBurnStatus}}

CONVERSION STATUS:
- Week-3 conversion rate: {{conversionRate}}% (historical avg: {{historicalConversionRate}}%)
- Narrow win rate: {{narrowWinRate}}% | Broad win rate: {{broadWinRate}}%
- Derail rate: {{derailRate}}% ({{derailTrend}})
- Conversion trend: {{conversionTrend}} over {{trendQuarters}} quarters

DIAGNOSIS:
- Primary problem: {{primaryProblem}}
- Confidence: {{confidence}}
- Floating bar detected: {{floatingBarDetected}}

Rules:
- Lead with the verdict in one sentence
- Show exactly which numbers support the verdict
- State explicitly what the WRONG response would be
- Give 2–3 actions in priority order, with $ targets where possible
- Do not hedge. RevOps teams need a clear diagnosis, not a list of possibilities.
```

### Token Budget Estimate
- Compute: ~2,000 tokens (reading skill_run outputs, not raw CRM data)
- DeepSeek: ~800 tokens
- Claude: ~3,500 tokens
- **Total: ~6,300 tokens** — extremely efficient because it reuses prior computations

### Ask Pandora Integration

**Query:** "Why are we missing plan?"
**Route:** Loop mode → gtm-health-diagnostic → deal-risk-review if needed
**Response:** Coverage vs conversion diagnosis + top deals driving the gap

**Query:** "Is this a pipeline problem or a conversion problem?"
**Route:** Heuristic → gtm-health-diagnostic → Layer 1 (if recent run exists)
**Response:** Verdict with evidence from pre-computed skill outputs

**Query:** "What should we focus on to hit Q2?"
**Route:** Loop mode → gtm-health-diagnostic → pipeline-progression → specific action plan
**Response:** Diagnosis → implied action → specific dollar target

### Agent Playbook Integration

The GTM Diagnostic should be added to the **Bowtie Funnel Review** agent's skill list:
```typescript
loop_config: {
  available_skills: [
    'gtm-health-diagnostic',   // ADD THIS — runs first as the diagnostic frame
    'pipeline-coverage',
    'deal-risk-review',
    'rep-scorecard',
    'icp-discovery',
    'lead-scoring'
  ],
}
```

Add a post-action playbook trigger:
```typescript
{
  trigger: 'on_coverage_problem_detected',
  actions: [
    { type: 'notify', channel: 'slack',
      template: '⚠️ GTM Diagnostic: Coverage problem detected. {{coverageRatio}}x vs {{impliedTarget}}x needed. Gap: ${{coverageGapValue}}. Recommended focus: pipeline generation.' },
    { type: 'emit_action', action_type: 'flag_coverage_shortfall',
      payload_template: { gap: '{{coverageGapValue}}', quarter: '{{currentQuarter}}', weeksRemaining: '{{weeksRemaining}}' } },
  ]
},
{
  trigger: 'on_conversion_problem_detected',
  actions: [
    { type: 'notify', channel: 'slack',
      template: '⚠️ GTM Diagnostic: Conversion problem detected. Rate is {{conversionRate}}% vs {{historicalRate}}% historical. Floating bar: {{floatingBarDetected}}.' },
  ]
}
```

---

## 7. Narrow vs. Broad Win Rate (Shared Compute Function)

**Type:** Shared compute function — used by `pipeline-conversion-rate`, `rep-scorecard`, and `forecast-rollup`
**Not a standalone skill** — a function in `server/analysis/win-rate.ts`

### Why It Matters

Narrow win rate hides the derail rate. When a company's derail rate rises
(more prospects choosing status quo), narrow win rate stays flat and no alarm sounds.
This is how companies convince themselves their sales team is fine while their TAM
is drying up or their positioning is losing relevance.

### Implementation

```typescript
// server/analysis/win-rate.ts

export interface WinRateResult {
  narrow: {
    rate: number,
    wins: number,
    losses: number,
    quarterlyTrend: { quarter: string, rate: number }[],
  },
  broad: {
    rate: number,
    wins: number,
    losses: number,
    derails: number,
    quarterlyTrend: { quarter: string, rate: number }[],
  },
  derailRate: number,
  narrowToBroadGap: number,
  derailTrend: 'rising' | 'stable' | 'falling',
  lossReasons: { reason: string, count: number, pct: number }[],
  interpretation: {
    // computed, not AI-generated
    primaryPressure: 'competitive' | 'status_quo' | 'mixed' | 'insufficient_data',
    // competitive = losses rising faster than derails
    // status_quo = derails rising faster than losses
  },
}

export async function computeWinRates(
  workspaceId: string,
  lookbackQuarters: number = 6
): Promise<WinRateResult>
```

**Deal terminal state classification:**
- `closed_won` → win
- `closed_lost` + loss reason contains competitor name → narrow loss
- `closed_lost` + loss reason contains "no decision" / "status quo" / "budget" / null → derail (for broad)
- `closed_lost` with no reason → narrow loss, exclude from broad OR flag as unclassified

This function gets called by `pipeline-conversion-rate` (Step 3), `rep-scorecard`
(in the win rate section), and `forecast-rollup` (for the triangulation section).

---

## 8. Pipeline Source Conversion Mix (Marketing Attribution Enhancement)

**Type:** Enhancement to the planned Marketing Attribution skill
**Adds:** Conversion rate and deal quality breakdown by pipeline source

### Why It Matters

Marketing often gets measured on volume of pipeline generated. Kellogg's point:
that's the wrong metric if different sources convert at radically different rates.
A source generating 40% of pipeline but 60% of closed revenue is undervalued.
A source generating 40% of pipeline but 15% of closed revenue is overvalued.

### New Compute Function

```typescript
// server/analysis/pipeline-source.ts

pipelineSourceConversion(workspaceId: string, lookbackQuarters: number) → {
  sources: {
    source: string,           // 'inbound', 'sdr_outbound', 'ae_outbound', 'alliances', 'plg', 'event'
    // from lead_source field or UTM data in CRM
    pipelineGenerated: number,
    pipelinePct: number,
    closedWon: number,
    closedWonPct: number,
    conversionRate: number,   // closedWon ÷ pipelineGenerated
    avgDealSize: number,
    avgSalesCycle: number,    // days to close
    weightedValue: number,    // pipeline × conversion rate = expected value
    roi: number,              // closedWon ÷ pipelineGenerated (conversion efficiency)
  }[],
  topConvertingSource: string,
  lowestConvertingSource: string,
  mixShift: {
    // has pipeline source composition changed significantly in last 2 quarters?
    detected: boolean,
    from: { source: string, pct: number }[],
    to: { source: string, pct: number }[],
    conversionImpact: number,    // $ impact of mix shift on expected ARR
  },
}
```

This function feeds into both the Marketing Attribution skill (when built) and the
GTM Health Diagnostic (as a secondary signal in the conversion problem diagnosis).

The mix shift detection is particularly valuable for the GTM Diagnostic: if conversion
rate is falling but win rates are stable, it may be a mix shift problem (more low-quality
sources in the pipeline) rather than a sales execution problem.

---

---

## 9. Methodology Comparison & Divergence Footnotes

### The Design Pattern

This is not a ChatGPT-style A/B ("pick the better answer"). It's **methodology
divergence as signal** — when two valid calculation methods disagree significantly,
the gap itself is a finding about the workspace's sales dynamics.

The product pattern is a **Methodology Footnote** on any metric where two methods
are available and diverge beyond a threshold:

```
Pipeline coverage required: 3.2x
  ┌─ Based on: week-3 conversion rate (31%, trailing 4Q)
  └─ Win rate method would suggest: 5.3x  ↑ Why the gap?
```

"Why the gap?" expands inline — a 1–2 sentence Claude synthesis explaining what
the divergence reveals. No winner is declared. The gap is the insight.

### When to Surface a Footnote

Trigger threshold: divergence > 15% of the lower value between two methods.

| Primary Metric | Method A (default) | Method B (footnote) | Gap Interpretation |
|---|---|---|---|
| Coverage required | Week-3 conversion rate inverted | Win rate inverted | Positive gap = reps qualify out effectively; late-stage win rate > early-stage entry rate |
| Forecast landing | Category-weighted EV | Stage-weighted EV | Positive gap = reps over-categorize (too much in commit); negative = under-categorize |
| Rep productivity | Quota attainment % | Tenure-relative vs. ramp curve | New rep underperform = ramp problem, not rep problem |
| Win rate | Narrow (excl. derails) | Broad (incl. derails) | Gap = derail/no-decision rate; rising gap = positioning/ICP drift, not sales execution |

### Where Footnotes Appear

**FindingCard (Command Center):**
Every metric tile that has a secondary method emits a `methodology_comparison`
field in the skill output. The FindingCard component renders it as a collapsible
footnote row with the "Why the gap?" expansion trigger.

**Ask Pandora responses:**
When Claude synthesizes a metric that has a secondary method in the skill output,
include the divergence if it exceeds threshold. Claude receives both values in its
synthesis context and is prompted to explain the gap when present.

**Slack briefings:**
Only surface the footnote if the divergence is "alert" severity (> 30% of lower
value). Don't clutter Slack with routine methodology differences.

### Skill Output Schema Addition

Add to every skill that computes a metric with a secondary method:

```typescript
interface MethodologyComparison {
  metric: string,                    // 'required_coverage', 'forecast_landing', 'win_rate'
  primaryMethod: {
    name: string,                    // 'week3_conversion_rate'
    label: string,                   // 'Week-3 Conversion Rate (trailing 4Q)'
    value: number,
  },
  secondaryMethod: {
    name: string,                    // 'win_rate_inverted'
    label: string,                   // 'Win Rate Inverted'
    value: number,
  },
  divergence: number,                // absolute difference
  divergencePct: number,             // as % of lower value
  severity: 'info' | 'notable' | 'alert',  // info <15%, notable 15-30%, alert >30%
  gapExplanation: string,            // 1–2 sentences, Claude-generated during synthesis
  recommendedMethod: string,         // which method to trust more, with brief rationale
}
```

Add `methodologyComparisons: MethodologyComparison[]` to the output of:
- `pipeline-coverage` (coverage required: conversion rate vs. win rate)
- `forecast-rollup` (landing: category EV vs. stage EV)
- `pipeline-conversion-rate` (win rate: narrow vs. broad)

### Claude Synthesis Prompt Addition

When `methodologyComparisons` is non-empty and any comparison is `notable` or
`alert` severity, append to the synthesis prompt:

```
METHODOLOGY DIVERGENCE (include as footnote in your output):
{{#each methodologyComparisons where severity != 'info'}}
- {{metric}}: {{primaryMethod.label}} says {{primaryMethod.value}},
  {{secondaryMethod.label}} says {{secondaryMethod.value}}
  ({{divergencePct}}% gap)
  In one sentence: explain what this gap reveals about how this team sells.
  Do not recommend one method over the other. Just explain the gap.
{{/each}}
```

---

## 10. Forecast Accuracy Tracker

### The Key Insight: Retroactive Bootstrap via HubSpot Field History

The accuracy tracker does not need to wait 4 live quarters to be meaningful.
HubSpot's property history API stores **complete change history for every deal
property**. The existing `deal_stage_history` backfill already calls:

```
GET /crm/v3/objects/deals/{id}?propertiesWithHistory=dealstage
```

Extending this to:

```
GET /crm/v3/objects/deals/{id}?propertiesWithHistory=dealstage,forecastcategory,amount,closedate
```

...costs **zero additional API calls**. Same 1 call per deal, same rate limit
budget (~80 seconds for ~700 deals). But now we can reconstruct the exact state
of any deal at any point in time across all four fields.

This means: one extended backfill run → years of retroactive accuracy data.

### Retroactive Computability by Method

| Method | Retro? | Data Required | Notes |
|---|---|---|---|
| Week-3 pipeline conversion rate | ✅ **Full** | `deals` table only | Closed deals + close dates already exist. Reconstruct which deals were open on day 21 of any past quarter from `closed_won_date` and `created_at`. No field history needed. |
| Narrow/broad win rate | ✅ **Full** | `deals` table only | Terminal states are in the deals table today. Immediately computable. |
| Stage-weighted EV at week 3 | ✅ **With field history** | `dealstage` history (already backfilled) | Know what stage each deal was in on day 21 of each past quarter. |
| Category-weighted EV at week 3 | ✅ **With field history** | `forecastcategory` history (new — same API call) | Know what forecast category each deal was in on day 21. |
| Amount-adjusted pipeline at week 3 | ✅ **With field history** | `amount` history (new — same API call) | Some deals had amounts that changed mid-quarter. Use the day-21 value. |
| Manager/CRO rollup | ❌ **Never retro** | Rep forecast submissions not stored in CRM | Must capture live going forward. |
| Capacity model | ✅ **Partial** | Rep hire dates + historical ARR by rep | Approximation — hire dates may not be in CRM. |

**Bottom line: 4 of 5 triangulation bearings are retroactively computable.**
For a workspace with 2+ years of deal history, you get 8 quarters of accuracy
data on day one of enabling this feature.

### New Infrastructure Required

#### 1. Extend Property History Backfill

In `server/connectors/hubspot/stage-history-backfill.ts`, extend the existing
backfill to pull additional properties in the same API call:

```typescript
// Change from:
const url = `https://api.hubapi.com/crm/v3/objects/deals/${deal.source_id}?propertiesWithHistory=dealstage`;

// To:
const TRACKED_PROPERTIES = ['dealstage', 'forecastcategory', 'amount', 'closedate'];
const url = `https://api.hubapi.com/crm/v3/objects/deals/${deal.source_id}?propertiesWithHistory=${TRACKED_PROPERTIES.join(',')}`;
```

#### 2. New Table: `deal_field_history`

```sql
CREATE TABLE IF NOT EXISTS deal_field_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  deal_source_id TEXT NOT NULL,
  field_name TEXT NOT NULL,           -- 'forecastcategory', 'amount', 'closedate'
                                      -- NOT dealstage — that stays in deal_stage_history
  from_value TEXT,                    -- stored as TEXT; callers cast as needed
  to_value TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,               -- 'hubspot_history' | 'salesforce_history' | 'sync_detection'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_field_history_deal ON deal_field_history(deal_id, field_name, changed_at);
CREATE INDEX idx_field_history_workspace ON deal_field_history(workspace_id, field_name, changed_at);
CREATE UNIQUE INDEX idx_field_history_unique
  ON deal_field_history(deal_id, field_name, changed_at, to_value);
```

Note: `dealstage` stays in `deal_stage_history` (normalized, with duration tracking).
All other tracked fields go in `deal_field_history` as raw TEXT values.

**Salesforce equivalent:** `OpportunityFieldHistory` object stores field changes for
up to 20 tracked fields. The Salesforce adapter already mentions `salesforce_history`
as a source type — extend the sync to pull `ForecastCategoryName`, `Amount`,
`CloseDate` field history and write to `deal_field_history`.

#### 3. Core Function: `reconstructDealStateAtDate`

```typescript
// server/analysis/field-history-queries.ts

interface DealStateAtDate {
  dealId: string,
  dealSourceId: string,
  snapshotDate: Date,
  stage: string | null,              // from deal_stage_history
  stageNormalized: string | null,
  forecastCategory: string | null,   // from deal_field_history
  amount: number | null,             // parsed from TEXT
  closeDate: Date | null,            // parsed from TEXT
  wasOpenOnDate: boolean,            // stage was not closed_won/closed_lost on snapshotDate
  wasInQuarter: boolean,             // closeDate was in the target quarter on snapshotDate
}

export async function reconstructDealStateAtDate(
  workspaceId: string,
  dealIds: string[],
  snapshotDate: Date,
  db: DatabaseClient
): Promise<Map<string, DealStateAtDate>>

// For each deal: find the last-known value of each tracked field
// where changed_at <= snapshotDate.
// If no history row exists before snapshotDate, use the deal's
// current value (it was created after snapshotDate) or null.
```

#### 4. Core Function: `reconstructQuarterSnapshot`

```typescript
// server/analysis/retro-accuracy.ts

interface QuarterSnapshot {
  quarterLabel: string,              // 'Q3 2025'
  quarterStart: Date,
  quarterEnd: Date,
  week3SnapshotDate: Date,           // day 21 of quarter
  openPipelineOnDay21: {
    deals: DealStateAtDate[],
    totalValue: number,
    dealCount: number,
    byStage: Record<string, { count: number, value: number }>,
    byForecastCategory: Record<string, { count: number, value: number }>,
  },
  actualOutcome: {
    closedWonValue: number,
    closedWonCount: number,
    closedLostCount: number,
    derailCount: number,             // no decision / status quo
    stillOpenCount: number,          // open past quarter end (slipped)
  },
  dataCompleteness: {
    hasStageHistory: boolean,
    hasForecastCategoryHistory: boolean,
    hasAmountHistory: boolean,
    hasCloseDateHistory: boolean,
    completenessScore: number,       // 0–1, what fraction of deals have full field history
    caveat: string | null,           // "Stage history available for 87% of deals"
  },
}

export async function reconstructQuarterSnapshot(
  workspaceId: string,
  quarterStart: Date,
  quarterEnd: Date,
  db: DatabaseClient
): Promise<QuarterSnapshot>
```

#### 5. Accuracy Computation per Method

```typescript
// server/analysis/retro-accuracy.ts

interface MethodAccuracy {
  method: ForecastMethod,
  quarterLabel: string,
  snapshotDate: Date,
  predictedARR: number,
  actualARR: number,
  errorAbs: number,                  // |predicted - actual|
  errorPct: number,                  // errorAbs / actual * 100
  errorDirection: 'over' | 'under',
  source: 'live' | 'retro',
}

type ForecastMethod =
  | 'week3_conversion_rate'         // closedWon / week3Pipeline (historical rate applied)
  | 'stage_weighted_ev'             // pipeline × stage close probabilities
  | 'category_weighted_ev'          // pipeline × forecast category probabilities
  | 'win_rate_inverted'             // quota / (1 / win_rate) — the wrong way, tracked for comparison
  | 'capacity_model'                // rampedReps × historical productivity

// Compute predicted ARR for each method given a QuarterSnapshot
export function computeMethodPrediction(
  method: ForecastMethod,
  snapshot: QuarterSnapshot,
  workspaceConfig: WorkspaceConfig
): number
```

#### 6. New Table: `forecast_accuracy_log`

```sql
CREATE TABLE IF NOT EXISTS forecast_accuracy_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  quarter_label TEXT NOT NULL,        -- 'Q3 2025'
  quarter_start DATE NOT NULL,
  quarter_end DATE NOT NULL,
  method TEXT NOT NULL,               -- ForecastMethod enum values
  snapshot_date DATE NOT NULL,        -- day 21 of the quarter
  predicted_arr NUMERIC NOT NULL,
  actual_arr NUMERIC NOT NULL,
  error_abs NUMERIC NOT NULL,
  error_pct NUMERIC NOT NULL,
  error_direction TEXT NOT NULL,      -- 'over' | 'under'
  source TEXT NOT NULL DEFAULT 'live',  -- 'live' | 'retro'
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(workspace_id, quarter_label, method)  -- one row per workspace/quarter/method
);

CREATE INDEX idx_accuracy_workspace ON forecast_accuracy_log(workspace_id, quarter_start);
```

### The Retro Bootstrap Job

A one-time job run per workspace after the extended field history backfill completes:

```typescript
// server/jobs/retro-accuracy-bootstrap.ts

export async function retroAccuracyBootstrap(workspaceId: string, db: DatabaseClient) {
  // 1. Find all completed quarters with enough deal data
  //    "Completed" = quarter_end < today
  //    "Enough data" = >= 10 closed deals in the quarter
  const completedQuarters = await findCompletedQuarters(workspaceId, db);

  for (const quarter of completedQuarters) {
    // 2. Reconstruct the week-3 snapshot for this quarter
    const snapshot = await reconstructQuarterSnapshot(
      workspaceId, quarter.start, quarter.end, db
    );

    // 3. Skip if data completeness is too low
    if (snapshot.dataCompleteness.completenessScore < 0.5) {
      console.log(`[RetroAccuracy] Skipping ${quarter.label} — completeness ${snapshot.dataCompleteness.completenessScore}`);
      continue;
    }

    // 4. Compute prediction for each available method
    const methods: ForecastMethod[] = [
      'week3_conversion_rate',
      'stage_weighted_ev',
      snapshot.dataCompleteness.hasForecastCategoryHistory ? 'category_weighted_ev' : null,
      'win_rate_inverted',
    ].filter(Boolean);

    for (const method of methods) {
      const predicted = computeMethodPrediction(method, snapshot, workspaceConfig);
      await upsertAccuracyLog({
        workspaceId,
        quarterLabel: quarter.label,
        quarterStart: quarter.start,
        quarterEnd: quarter.end,
        method,
        snapshotDate: snapshot.week3SnapshotDate,
        predictedARR: predicted,
        actualARR: snapshot.actualOutcome.closedWonValue,
        source: 'retro',
      }, db);
    }

    console.log(`[RetroAccuracy] Bootstrapped ${quarter.label} — ${methods.length} methods`);
  }
}
```

Trigger this job via:
```
POST /api/workspaces/:id/jobs/retro-accuracy-bootstrap
```

Runs in background. Typical runtime for 8 quarters × 5 methods: < 30 seconds
(pure SQL after field history is populated).

### The Accuracy Dashboard Surface

Once `forecast_accuracy_log` is populated, this is a Command Center widget:

```
Forecast Accuracy by Method — Last 6 Quarters
  Week-3 Conversion Rate:    avg error  8%  ★ Most predictive for you
  Stage-weighted EV:         avg error 11%
  Category-weighted EV:      avg error 14%
  Win Rate Inverted:         avg error 23%  ⚠ Consistently over-predicts

  Based on 6 completed quarters. Retroactively computed from deal history.
```

This feeds into forecast synthesis in two ways:

**1. Weighted triangulation:** The GTM Diagnostic and Forecast Rollup synthesis
prompts can receive the accuracy-ranked methods and weight their triangulation
accordingly. If stage-weighted EV has historically been most accurate for this
workspace, it gets more weight in the synthesis narrative.

**2. Training data signal:** Each `forecast_accuracy_log` row where `source = 'live'`
and `error_pct < 10%` is a high-quality training pair: the synthesis that produced
that forecast + the actual outcome. This is exactly the kind of labeled data needed
for the fine-tuning pipeline.

### Live Capture: Manager Rollup

The one method that can never be retro-computed is the manager rollup — because
rep forecast submissions aren't stored in the CRM. Start capturing it now:

Add to the forecast-rollup skill output schema:
```typescript
managerRollupCapture: {
  capturedAt: string,
  quarterLabel: string,
  totalManagerRollup: number,       // sum of manager-adjusted forecasts
  byManager: { name: string, rollup: number, repSubmitted: number }[],
}
```

Write this to `forecast_accuracy_log` with `method = 'manager_rollup'` and
`predicted_arr = totalManagerRollup`. When the quarter closes, the job that
populates `actual_arr` will complete the row.

After 4 live quarters, manager rollup joins the accuracy comparison table.

---

## Implementation Sequencing (Updated)

**Phase 0 — Field history infrastructure (enables retro bootstrap):**
1. Extend HubSpot property history backfill to pull `forecastcategory`, `amount`, `closedate`
2. Create `deal_field_history` table and populate via extended backfill
3. Build `reconstructDealStateAtDate` and `reconstructQuarterSnapshot` functions
4. Create `forecast_accuracy_log` table
5. Run retro bootstrap job per workspace → immediate accuracy data for all completed quarters

**Phase 1 — Highest ROI skills (builds on Phase 0 data):**
6. `pipeline-conversion-rate` skill (week-3 conversion rate — uses retro data to show trend immediately)
7. Win rate shared compute function (narrow/broad — uses deals table directly)
8. To-go coverage enhancement to `pipeline-coverage`

**Phase 2 — New flagship skills:**
9. `pipeline-progression` skill
10. `gtm-health-diagnostic` skill

**Phase 3 — Triangulation and comparison layer:**
11. Triangulation forecast in `forecast-rollup` (all 5 bearings + divergence footnotes)
12. Methodology comparison footnotes UI (FindingCard + Ask Pandora)
13. Accuracy dashboard widget (Command Center)

**Phase 4 — Depth enhancements:**
14. Rep ramp chart in `rep-scorecard`
15. Pipeline source conversion mix (Marketing Attribution dependency)

---

## Token Cost Summary

| Skill / Enhancement | Est. Tokens/Run | Schedule | Weekly Cost (4 workspaces) |
|---|---|---|---|
| `pipeline-progression` | ~7,000 | Weekly | 28,000 |
| `pipeline-conversion-rate` | ~6,800 | Weekly | 27,200 |
| `gtm-health-diagnostic` | ~6,300 | Weekly | 25,200 |
| To-go coverage (enhancement) | +2,000 | Weekly | +8,000 |
| Triangulation forecast (enhancement) | +2,500 | Weekly | +10,000 |
| Rep ramp chart (enhancement) | +1,500 | Weekly | +6,000 |
| **Total new weekly load** | | | **~104,400 tokens/week** |

At Claude Sonnet pricing (~$3/1M tokens input, $15/1M output), this is
approximately **$0.50–$1.50/workspace/week** — well within design partner range.

**One-time retro bootstrap cost:** Pure SQL after field history is populated.
Zero LLM tokens — accuracy computations are mathematical, not generative.
The only LLM cost is the divergence footnote synthesis, which fires during
normal skill runs when a comparison is `notable` or `alert` severity.

---

*Spec sourced from Dave Kellogg's Kellblog (kellblog.com). All frameworks are Kellogg's
original methodology. This document specifies Pandora's implementation only.*
