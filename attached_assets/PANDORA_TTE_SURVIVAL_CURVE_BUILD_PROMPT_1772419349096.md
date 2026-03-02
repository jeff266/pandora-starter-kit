# Claude Code Prompt: TTE Survival Curve Engine (Win Rate Curves, Not Numbers)

## Context

This prompt replaces Pandora's current win probability model with a Time-to-Event (TTE) survival curve engine. The current model treats win rate as a single number per stage — a Beta distribution fit to historical win/loss counts. The replacement treats win rate as a curve over time — a Kaplan-Meier estimator that answers "given this deal has been open X days and is currently in stage Y, what's the probability it wins from here?"

This is not a new skill. It's a shared compute module that replaces the probability engine underneath three existing skills: Monte Carlo Revenue Forecast, Weekly Forecast Roll-up, and Pipeline Coverage by Rep. After this work, every deal in the system gets a time-aware win probability that penalizes old deals automatically and gives fresh deals realistic forward projections.

**Why this matters:**
- A deal in Negotiation for 10 days currently gets the same win probability as a deal in Negotiation for 200 days. That's wrong.
- Forecast Roll-up uses static multipliers (commit × 0.8, best case × 0.5, pipeline × 0.2) with no empirical basis. Those go away.
- Monte Carlo hardcodes `Beta(2,6)` (~25%) for projected new pipeline. The curve provides an empirical alternative.
- Pipeline Coverage reports raw dollar ratios. Probability-weighted coverage is more honest.
- The cohort-by-quarter approach to win rate calculation is volatile, requires ancient history for mature cohorts, and averages across deals with wildly different ages within a quarter. TTE solves all three problems.

**The math:** Kaplan-Meier survival analysis. Proven in engineering, epidemiology, and actuarial science for decades. It handles right-censored data (deals still open) correctly, uses all available data regardless of deal age, and produces confidence intervals via Greenwood's formula.

**Before starting, find and read:**
1. `server/analysis/monte-carlo-distributions.ts` — the file you'll be partially replacing. Understand `fitStageWinRates()` and how Monte Carlo currently consumes the Beta distribution.
2. `server/analysis/monte-carlo-engine.ts` — the simulation loop. Understand how `sampleBeta()` and `sampleBernoulli()` are called per deal per iteration.
3. The forecast-rollup skill — find where the static bear/base/bull multipliers are applied (commit × 0.8, bestCase × 0.5, pipeline × 0.2).
4. The pipeline-coverage skill — find where coverage ratio is calculated as raw pipeline ÷ remaining quota.
5. The `deals` table schema — you need: `id`, `workspace_id`, `amount`, `stage_normalized`, `created_at`, `closed_at`, `close_date`, `is_closed_won`, `is_closed_lost`, `is_closed`, `owner_email`, `source` (or `lead_source` or equivalent).
6. The `deal_stage_history` table — `deal_id`, `stage_normalized`, `entered_at`, `exited_at`.
7. The context layer / workspace config — how fiscal quarters and cadence are determined.

---

## Step 1: Build the Kaplan-Meier Estimator

Create `server/analysis/survival-curve.ts`.

This is the core mathematical engine. It takes a set of deal observations and produces a step-function curve of cumulative win rate over time.

### 1a. Data Types

```typescript
/**
 * A single deal observation for the KM estimator.
 * "event" means won. "censored" means still open or lost/no-decision.
 * 
 * Why losses are censored, not events: We're modeling time-to-WIN.
 * A loss at day 60 tells us the deal didn't win by day 60, but it doesn't
 * tell us anything about the win curve shape. Treating losses as censored
 * (removed from the risk set at their resolution time) is the standard
 * TTE approach and avoids the arbitrary timing problem — you know exactly
 * when a deal wins, but loss timing is often an admin cleanup artifact.
 */
export interface DealObservation {
  dealId: string;
  daysOpen: number;              // days from created_at to event/censor date
  event: boolean;                // true = won, false = censored (lost, open, no-decision)
  amount?: number;               // for value-weighted curves
  segment?: string;              // for segmented curves (source, rep, size band, etc.)
}

/**
 * A single step in the KM curve.
 * The curve is a step function — probability is constant between event times.
 */
export interface SurvivalStep {
  day: number;                   // days since deal creation
  atRisk: number;                // deals still in the risk set at this time
  events: number;                // wins at this time point
  censored: number;              // deals censored at this time point
  cumulativeWinRate: number;     // 1 - S(t), the probability of having won by day t
  survival: number;              // S(t) = probability of NOT having won yet
  standardError: number;         // Greenwood's formula
  ciLower: number;               // 95% CI lower bound on cumulativeWinRate
  ciUpper: number;               // 95% CI upper bound on cumulativeWinRate
}

/**
 * A complete survival curve with metadata.
 */
export interface SurvivalCurve {
  steps: SurvivalStep[];
  segment: string | null;        // null for unsegmented (all deals)
  sampleSize: number;            // total observations
  eventCount: number;            // total wins
  censoredCount: number;         // total censored
  medianTimeTilWon: number | null;  // day at which cumulativeWinRate crosses 50%, if ever
  terminalWinRate: number;       // cumulativeWinRate at the last observed event
  isReliable: boolean;           // sampleSize >= 30 AND eventCount >= 10
  dataWindow: {                  // the time range of data used
    from: Date;
    to: Date;
  };
}
```

### 1b. The Kaplan-Meier Algorithm

```typescript
/**
 * Compute a Kaplan-Meier survival curve from deal observations.
 * 
 * Algorithm:
 * 1. Sort observations by daysOpen ascending
 * 2. Walk through sorted list. At each unique time point:
 *    a. Count events (wins) and censorings at this time
 *    b. Update survival: S(t) = S(t-1) × (1 - events / atRisk)
 *    c. Update Greenwood variance sum
 *    d. Compute confidence interval
 * 3. Return step function
 *
 * Right-censoring is handled naturally: censored observations reduce
 * the risk set but don't affect the survival estimate at their time.
 */
export function computeKaplanMeier(
  observations: DealObservation[],
  segment?: string
): SurvivalCurve {
  if (observations.length === 0) {
    return emptyCurve(segment ?? null);
  }

  // Sort by time, events before censorings at same time
  const sorted = [...observations].sort((a, b) => {
    if (a.daysOpen !== b.daysOpen) return a.daysOpen - b.daysOpen;
    // Events (wins) should be processed before censorings at same time
    return (b.event ? 1 : 0) - (a.event ? 1 : 0);
  });

  const steps: SurvivalStep[] = [];
  let atRisk = sorted.length;
  let survival = 1.0;
  let greenwoodSum = 0;           // running sum for Greenwood's formula
  let totalEvents = 0;
  let totalCensored = 0;

  // Add initial step at day 0
  steps.push({
    day: 0,
    atRisk,
    events: 0,
    censored: 0,
    cumulativeWinRate: 0,
    survival: 1.0,
    standardError: 0,
    ciLower: 0,
    ciUpper: 0,
  });

  // Group by unique time points
  let i = 0;
  while (i < sorted.length) {
    const currentDay = sorted[i].daysOpen;
    let eventsAtTime = 0;
    let censoredAtTime = 0;

    // Count all events and censorings at this time point
    while (i < sorted.length && sorted[i].daysOpen === currentDay) {
      if (sorted[i].event) {
        eventsAtTime++;
        totalEvents++;
      } else {
        censoredAtTime++;
        totalCensored++;
      }
      i++;
    }

    // Update survival estimate (only changes if there were events)
    if (eventsAtTime > 0 && atRisk > 0) {
      survival = survival * (1 - eventsAtTime / atRisk);

      // Greenwood's formula for variance
      // Var(S(t)) = S(t)^2 × Σ(d_i / (n_i × (n_i - d_i)))
      if (atRisk > eventsAtTime) {
        greenwoodSum += eventsAtTime / (atRisk * (atRisk - eventsAtTime));
      }

      const standardError = survival * Math.sqrt(greenwoodSum);

      // 95% CI using log-log transformation (more accurate at extremes)
      const z = 1.96;
      const logSurvival = Math.log(-Math.log(Math.max(survival, 0.001)));
      const logSE = standardError / (survival * Math.abs(Math.log(Math.max(survival, 0.001))));

      const ciSurvivalLower = Math.exp(-Math.exp(logSurvival + z * logSE));
      const ciSurvivalUpper = Math.exp(-Math.exp(logSurvival - z * logSE));

      steps.push({
        day: currentDay,
        atRisk,
        events: eventsAtTime,
        censored: censoredAtTime,
        cumulativeWinRate: 1 - survival,
        survival,
        standardError,
        ciLower: Math.max(0, 1 - ciSurvivalUpper),   // invert for win rate
        ciUpper: Math.min(1, 1 - ciSurvivalLower),
      });
    }

    // Remove events AND censorings from risk set
    atRisk -= (eventsAtTime + censoredAtTime);
  }

  // Compute median time-til-won
  const medianStep = steps.find(s => s.cumulativeWinRate >= 0.5);
  const medianTimeTilWon = medianStep ? medianStep.day : null;

  return {
    steps,
    segment: segment ?? null,
    sampleSize: observations.length,
    eventCount: totalEvents,
    censoredCount: totalCensored,
    medianTimeTilWon,
    terminalWinRate: steps.length > 0 ? steps[steps.length - 1].cumulativeWinRate : 0,
    isReliable: observations.length >= 30 && totalEvents >= 10,
    dataWindow: { from: new Date(), to: new Date() },  // set by caller
  };
}
```

### 1c. Conditional Win Probability (the key function)

This is what downstream consumers call. Given a deal that has been open X days and hasn't won yet, what's the probability it wins from here?

```typescript
/**
 * Conditional win probability: P(win after day X | survived to day X)
 * 
 * This is the forward-looking probability for an open deal.
 * Formula: (terminalWinRate - winRateAtDayX) / (1 - winRateAtDayX)
 * 
 * Intuition: If the overall curve says 40% of deals win eventually,
 * and 10% have already won by day X, then the remaining 30% wins
 * are spread among the 90% of deals that haven't won yet.
 * Conditional probability = 30/90 = 33.3%.
 * 
 * As deal age increases, this number drops — old deals that haven't
 * won yet are increasingly unlikely to win. This is exactly the
 * time-awareness that the Beta distribution model lacks.
 */
export function conditionalWinProbability(
  curve: SurvivalCurve,
  dealAgeDays: number
): { probability: number; confidence: { lower: number; upper: number }; isExtrapolated: boolean } {
  
  if (curve.steps.length === 0) {
    return { probability: 0, confidence: { lower: 0, upper: 0 }, isExtrapolated: true };
  }

  // Find the step at or just before dealAgeDays
  let stepAtAge = curve.steps[0];
  for (const step of curve.steps) {
    if (step.day <= dealAgeDays) {
      stepAtAge = step;
    } else {
      break;
    }
  }

  const lastStep = curve.steps[curve.steps.length - 1];
  const terminalWinRate = lastStep.cumulativeWinRate;
  const winRateAtAge = stepAtAge.cumulativeWinRate;
  const survivalAtAge = stepAtAge.survival;

  // If survival at this age is near zero, no deals survive this long
  if (survivalAtAge < 0.01) {
    return { probability: 0, confidence: { lower: 0, upper: 0 }, isExtrapolated: false };
  }

  // Conditional probability
  const prob = Math.max(0, (terminalWinRate - winRateAtAge) / (1 - winRateAtAge));

  // Propagate confidence interval
  const ciLower = Math.max(0, (lastStep.ciLower - stepAtAge.ciUpper) / (1 - stepAtAge.ciUpper));
  const ciUpper = Math.min(1, (lastStep.ciUpper - stepAtAge.ciLower) / (1 - stepAtAge.ciLower));

  // Flag if deal age exceeds observed data range
  const isExtrapolated = dealAgeDays > lastStep.day;

  return { probability: prob, confidence: { lower: Math.max(0, ciLower), upper: Math.min(1, ciUpper) }, isExtrapolated };
}
```

### 1d. Expected Value Within Time Window

For pipeline generation planning: given a deal that's X days old, what's its expected value by a future date?

```typescript
/**
 * Expected revenue from a deal within a specific time window.
 * Used by pipeline generation gap analysis and Monte Carlo.
 * 
 * For an open deal: amount × P(win between now and windowEnd | survived to now)
 * For a hypothetical future deal: amount × P(win within cycleDays)
 */
export function expectedValueInWindow(
  curve: SurvivalCurve,
  dealAgeDays: number,
  daysUntilWindowEnd: number,
  dealAmount: number
): { expectedValue: number; winProbInWindow: number } {
  
  const probAtAge = conditionalWinProbability(curve, dealAgeDays);
  const probAtWindowEnd = conditionalWinProbability(curve, dealAgeDays + daysUntilWindowEnd);

  // P(win between age and age+window) = P(win | survived to age) - P(win after age+window | survived to age)
  // Simplified: use the curve values directly
  const winRateAtAge = getCumulativeWinRateAtDay(curve, dealAgeDays);
  const winRateAtWindowEnd = getCumulativeWinRateAtDay(curve, dealAgeDays + daysUntilWindowEnd);
  const survivalAtAge = 1 - winRateAtAge;

  if (survivalAtAge < 0.01) {
    return { expectedValue: 0, winProbInWindow: 0 };
  }

  const winProbInWindow = (winRateAtWindowEnd - winRateAtAge) / survivalAtAge;
  const expectedValue = dealAmount * Math.max(0, winProbInWindow);

  return { expectedValue, winProbInWindow: Math.max(0, winProbInWindow) };
}

/**
 * Interpolate cumulative win rate at any day from the step function.
 */
function getCumulativeWinRateAtDay(curve: SurvivalCurve, day: number): number {
  let rate = 0;
  for (const step of curve.steps) {
    if (step.day <= day) {
      rate = step.cumulativeWinRate;
    } else {
      break;
    }
  }
  return rate;
}
```

---

## Step 2: Build the Data Query Layer

Create `server/analysis/survival-data.ts`.

This fetches deal data and produces `DealObservation[]` arrays for the KM estimator. It supports segmentation for on-demand queries from Ask Pandora and the assistant.

### 2a. Base Query — All Deals

```typescript
export interface SurvivalQueryOptions {
  workspaceId: string;
  lookbackMonths?: number;          // default 24
  groupBy?: SurvivalSegment;        // optional segmentation
  filters?: {
    source?: string;                // lead source / original source
    ownerEmail?: string;            // specific rep
    minAmount?: number;             // deal size floor
    maxAmount?: number;             // deal size ceiling
    stage?: string;                 // only deals that reached this stage
    pipeline?: string;              // CRM pipeline name
  };
  minSegmentSize?: number;          // minimum observations per segment, default 30
}

export type SurvivalSegment = 
  | 'source'           // lead_source or original_source
  | 'owner'            // owner_email
  | 'size_band'        // small/mid/large based on workspace deal size distribution
  | 'stage_reached'    // highest stage reached
  | 'pipeline'         // CRM pipeline
  | 'segment'          // ICP segment if available
  | 'none';            // unsegmented

export async function fetchDealObservations(
  db: DatabaseClient,
  options: SurvivalQueryOptions
): Promise<DealObservation[]>
```

**SQL:**

```sql
SELECT
  d.id AS deal_id,
  -- Days open: for closed deals use closed_at, for open deals use NOW()
  EXTRACT(EPOCH FROM (
    COALESCE(d.closed_at, NOW()) - d.created_at
  )) / 86400 AS days_open,
  -- Event: only closed-won is a win event
  d.is_closed_won AS event,
  d.amount,
  -- Segmentation fields (include all, filter in application layer)
  d.owner_email,
  d.stage_normalized,
  d.source_data->>'original_source' AS lead_source,
  d.source_data->>'pipeline' AS pipeline_name
FROM deals d
WHERE d.workspace_id = $1
  AND d.created_at > NOW() - INTERVAL '$2 months'
  -- Exclude deals with obviously bad data
  AND d.created_at IS NOT NULL
  AND d.created_at < NOW()
  -- Exclude $0 or null amount deals if amount segmentation is needed
  AND (d.amount IS NOT NULL AND d.amount > 0)
ORDER BY days_open ASC
```

**Segmentation in application layer (not SQL):**

After fetching, apply `groupBy` to split observations into segments. For each segment with fewer than `minSegmentSize` observations, merge into an "Other" bucket. Return a `Map<string, DealObservation[]>`.

```typescript
export async function buildSurvivalCurves(
  db: DatabaseClient,
  options: SurvivalQueryOptions
): Promise<{
  overall: SurvivalCurve;
  segments: Map<string, SurvivalCurve>;
  metadata: {
    totalDeals: number;
    segmentsComputed: number;
    segmentsBelowThreshold: string[];   // merged into "Other"
    lookbackWindow: { from: Date; to: Date };
  };
}> {
  const observations = await fetchDealObservations(db, options);
  
  // Always compute the overall curve
  const overall = computeKaplanMeier(observations);
  overall.dataWindow = { from: ..., to: new Date() };

  // Compute segmented curves if requested
  const segments = new Map<string, SurvivalCurve>();
  if (options.groupBy && options.groupBy !== 'none') {
    const grouped = groupObservations(observations, options.groupBy);
    const belowThreshold: string[] = [];

    for (const [segmentName, segmentObs] of grouped) {
      if (segmentObs.length >= (options.minSegmentSize ?? 30)) {
        segments.set(segmentName, computeKaplanMeier(segmentObs, segmentName));
      } else {
        belowThreshold.push(segmentName);
      }
    }

    // Merge below-threshold segments into "Other"
    if (belowThreshold.length > 0) {
      const otherObs = belowThreshold.flatMap(name => grouped.get(name) ?? []);
      if (otherObs.length >= (options.minSegmentSize ?? 30)) {
        segments.set('Other', computeKaplanMeier(otherObs, 'Other'));
      }
    }
  }

  return { overall, segments, metadata: { ... } };
}
```

### 2b. Size Band Classification

When `groupBy = 'size_band'`, classify deals into bands based on the workspace's deal size distribution:

```typescript
function classifyDealSizeBand(amount: number, distribution: { p25: number; p75: number }): string {
  if (amount <= distribution.p25) return 'Small';
  if (amount <= distribution.p75) return 'Mid-Market';
  return 'Enterprise';
}
```

Compute p25/p75 from all closed-won deals in the lookback window. Three bands is enough — more granularity kills sample size.

### 2c. Lead Source Normalization

CRM lead source fields are messy. Normalize before segmenting:

```typescript
function normalizeLeadSource(rawSource: string | null): string {
  if (!rawSource) return 'Unknown';
  const lower = rawSource.toLowerCase().trim();
  
  // Inbound
  if (['organic', 'website', 'inbound', 'content', 'seo', 'blog', 'webinar', 'event', 'marketing'].some(k => lower.includes(k))) {
    return 'Inbound';
  }
  // Outbound
  if (['outbound', 'cold', 'prospecting', 'sdr', 'bdr', 'sales generated', 'sales sourced'].some(k => lower.includes(k))) {
    return 'Outbound';
  }
  // PLG
  if (['product', 'plg', 'self-serve', 'freemium', 'trial', 'signup', 'free'].some(k => lower.includes(k))) {
    return 'PLG';
  }
  // Partner / Referral
  if (['partner', 'referral', 'channel', 'reseller', 'alliance'].some(k => lower.includes(k))) {
    return 'Partner';
  }
  return 'Other';
}
```

**Important:** Store this normalization in the observation's `segment` field. The raw source stays in the deal record. The survival curve engine only sees normalized categories.

---

## Step 3: Replace Monte Carlo's Win Rate Sampling

Open `server/analysis/monte-carlo-engine.ts`. This is a surgical swap — the simulation loop structure stays identical. Only the probability lookup changes.

### 3a. New Input Shape

Add the survival curves to the simulation inputs. The existing `stageWinRates: Record<string, BetaDistribution>` field gets replaced:

```typescript
// BEFORE (delete this)
export interface SimulationInputs {
  distributions: {
    stageWinRates: Record<string, BetaDistribution>;  // ← REMOVE
    // ... dealSize, cycleLength, slippage, pipelineRates stay
  };
}

// AFTER (add this)
export interface SimulationInputs {
  distributions: {
    survivalCurve: SurvivalCurve;                      // ← ADD: overall curve
    stageCurves: Map<string, SurvivalCurve> | null;    // ← ADD: per-stage curves (optional)
    // ... dealSize, cycleLength, slippage, pipelineRates stay unchanged
  };
}
```

### 3b. Swap the Sampling in the Iteration Loop

```typescript
// BEFORE — find this block in runIteration():
//
//   const baseWinRate = sampleBeta(
//     inputs.distributions.stageWinRates[deal.stageNormalized]?.alpha ?? 2,
//     inputs.distributions.stageWinRates[deal.stageNormalized]?.beta ?? 2
//   );
//   const adjustment = inputs.riskAdjustments[deal.id]?.multiplier ?? 1.0;
//   const adjustedWinRate = Math.max(0.05, Math.min(0.95, baseWinRate * adjustment));
//   if (!sampleBernoulli(adjustedWinRate)) continue;

// AFTER — replace with:
const dealAgeDays = daysBetween(deal.createdAt, inputs.today);

// Use stage-specific curve if available, fall back to overall
const curve = inputs.distributions.stageCurves?.get(deal.stageNormalized)
  ?? inputs.distributions.survivalCurve;

const { probability: baseWinProb } = conditionalWinProbability(curve, dealAgeDays);

// Risk adjustments still apply as multiplicative modifiers
const adjustment = inputs.riskAdjustments[deal.id]?.multiplier ?? 1.0;
const adjustedWinProb = Math.max(0.05, Math.min(0.95, baseWinProb * adjustment));

if (!sampleBernoulli(adjustedWinProb)) continue;  // deal lost in this iteration
```

**What this changes:** A 200-day-old deal in Proposal that would have gotten ~45% under Beta now gets whatever the curve says — probably 5-10% because most deals that win from Proposal do so within 90 days. The simulation immediately becomes more realistic.

### 3c. Swap Projected Pipeline Win Rate

```typescript
// BEFORE — find this block in the Component B (projected pipeline) loop:
//
//   const teamWinRate = sampleBeta(2, 6);  // ~25% baseline for new pipeline
//   if (!sampleBernoulli(teamWinRate)) continue;

// AFTER — replace with:
// For projected deals, use the overall curve at the projected deal age
// A deal created in month M has cycleDays to close
// Its effective age at close = cycleDays
// Use the curve to determine if a deal of that age would have won
const projectedDealAge = cycleDays;  // cycleDays is already sampled above in this loop
const { probability: newDealWinProb } = conditionalWinProbability(
  inputs.distributions.survivalCurve,
  0  // new deal starts at age 0
);

// But we only care about wins within the remaining forecast window
// Use expectedValueInWindow instead of a raw Bernoulli
const daysUntilDealCreated = dealCreatedDaysFromNow;
const daysRemainingForDeal = daysRemaining - daysUntilDealCreated;

if (daysRemainingForDeal <= 0) continue;

const { winProbInWindow } = expectedValueInWindow(
  inputs.distributions.survivalCurve,
  0,                        // new deal, age 0
  daysRemainingForDeal,     // time window it has to close
  1                         // dummy amount, we just need the probability
);

if (!sampleBernoulli(winProbInWindow)) continue;
```

### 3d. Update Distribution Fitting Call

In the Monte Carlo skill's compute step, replace the Beta fitting call:

```typescript
// BEFORE
const stageWinRates = await fitStageWinRates(workspaceId, db, 24);

// AFTER
const { overall: survivalCurve, segments: stageCurves } = await buildSurvivalCurves(db, {
  workspaceId,
  lookbackMonths: 24,
  groupBy: 'stage_reached',
  minSegmentSize: 20,
});
```

The `fitStageWinRates` function in `monte-carlo-distributions.ts` can be removed after this swap. Keep `fitDealSizeDistribution`, `fitCycleLengthDistribution`, `fitCloseSlippageDistribution`, and `fitPipelineCreationRates` — those are unchanged.

---

## Step 4: Replace Forecast Roll-up's Static Multipliers

Find the forecast-rollup skill's compute or synthesis step where bear/base/bull scenarios are calculated.

### 4a. Replace Scenario Calculation

```typescript
// BEFORE — static multipliers:
//
//   bearCase: closedWon + (commit × 0.8),
//   baseCase: closedWon + commit + (bestCase × 0.5),
//   bullCase: closedWon + commit + bestCase + (pipeline × 0.2),

// AFTER — curve-driven scenarios:
// 
// For each open deal, compute its expected value using the survival curve.
// Aggregate by forecast category to get empirically-weighted scenarios.

const { overall: survivalCurve } = await buildSurvivalCurves(db, {
  workspaceId,
  lookbackMonths: 24,
});

const daysRemainingInQuarter = daysBetween(today, quarterEnd);

// Compute per-deal expected values
const dealExpectedValues = openDeals.map(deal => {
  const dealAge = daysBetween(deal.createdAt, today);
  const { expectedValue, winProbInWindow } = expectedValueInWindow(
    survivalCurve,
    dealAge,
    daysRemainingInQuarter,
    deal.amount
  );
  return {
    ...deal,
    expectedValue,
    winProbInWindow,
  };
});

// Scenarios from percentile bands of the curve's confidence interval
const totalExpectedValue = dealExpectedValues.reduce((sum, d) => sum + d.expectedValue, 0);

const bearCase = closedWon + dealExpectedValues
  .reduce((sum, d) => {
    // Use lower CI bound for bear case
    const { confidence } = conditionalWinProbability(survivalCurve, daysBetween(d.createdAt, today));
    return sum + d.amount * Math.max(0, confidence.lower);
  }, 0);

const baseCase = closedWon + totalExpectedValue;  // P50 — the expected value

const bullCase = closedWon + dealExpectedValues
  .reduce((sum, d) => {
    // Use upper CI bound for bull case
    const { confidence } = conditionalWinProbability(survivalCurve, daysBetween(d.createdAt, today));
    return sum + d.amount * Math.min(1, confidence.upper);
  }, 0);
```

### 4b. Update Per-Rep Forecasted Attainment

```typescript
// BEFORE:
//   forecastedAttainment: (closedWon + commit + bestCase × 0.5) / quota

// AFTER:
//   forecastedAttainment: (closedWon + repExpectedValue) / quota
// Where repExpectedValue is the sum of expectedValueInWindow for all the rep's open deals

const repExpectedValue = dealExpectedValues
  .filter(d => d.ownerEmail === rep.email)
  .reduce((sum, d) => sum + d.expectedValue, 0);

const forecastedAttainment = (rep.closedWon + repExpectedValue) / rep.quota;
```

### 4c. Update the Synthesis Prompt

In the Claude synthesis prompt for forecast-rollup, replace references to static multipliers with the curve-based language:

```
// ADD to the business context block sent to Claude:
WIN RATE MODEL:
- Win probability is computed per deal based on deal age and the workspace's 
  historical time-to-won curve (Kaplan-Meier survival analysis)
- A deal open 30 days has a ${curve30day}% forward probability
- A deal open 90 days has a ${curve90day}% forward probability
- A deal open 180 days has a ${curve180day}% forward probability
- Bear/base/bull scenarios use the curve's 95% confidence interval, 
  not hardcoded multipliers
- Median time to win: ${medianTimeTilWon} days
```

This gives Claude the context to explain WHY a deal has a low probability without Claude needing to understand the math.

---

## Step 5: Update Pipeline Coverage with Weighted Values

Find the pipeline-coverage skill's compute function.

```typescript
// BEFORE:
//   coverageRatio: pipeline / remaining

// AFTER:
//   weightedPipeline = sum of expectedValueInWindow for all open deals closing this quarter
//   coverageRatio: weightedPipeline / remaining

const { overall: survivalCurve } = await buildSurvivalCurves(db, {
  workspaceId,
  lookbackMonths: 24,
});

const weightedPipeline = openDeals
  .filter(d => d.closeDate <= quarterEnd)
  .reduce((sum, deal) => {
    const dealAge = daysBetween(deal.createdAt, today);
    const daysUntilQuarterEnd = daysBetween(today, quarterEnd);
    const { expectedValue } = expectedValueInWindow(
      survivalCurve, dealAge, daysUntilQuarterEnd, deal.amount
    );
    return sum + expectedValue;
  }, 0);

// Per rep:
const repWeightedPipeline = openDeals
  .filter(d => d.ownerEmail === rep.email && d.closeDate <= quarterEnd)
  .reduce((sum, deal) => {
    const dealAge = daysBetween(deal.createdAt, today);
    const { expectedValue } = expectedValueInWindow(
      survivalCurve, dealAge, daysBetween(today, quarterEnd), deal.amount
    );
    return sum + expectedValue;
  }, 0);

// Report BOTH raw and weighted coverage
const rawCoverageRatio = rawPipeline / remaining;
const weightedCoverageRatio = weightedPipeline / remaining;

// The gap calculation becomes more honest:
// gap = remaining - weightedPipeline (not remaining - rawPipeline)
```

**Important:** Keep raw coverage in the output alongside weighted. Sales teams are used to the raw number. Show both and let the synthesis explain the difference: "Your raw pipeline coverage is 3.2x, but when adjusted for deal age and historical conversion timing, your effective coverage is 1.8x — meaning you need to generate more pipeline or accelerate existing deals."

---

## Step 6: Build the Parameterized Query API for Ask Pandora

The survival curve engine must be callable on-demand with arbitrary filters. This is what makes it an analytical primitive, not just a scheduled reporter.

### 6a. API Endpoint

Add to the workspace API routes:

```typescript
// GET /api/workspaces/:id/survival-curve
// Query params:
//   groupBy: 'source' | 'owner' | 'size_band' | 'stage_reached' | 'pipeline' | 'none'
//   lookbackMonths: number (default 24)
//   source: string (filter by lead source)
//   owner: string (filter by owner email)
//   minAmount: number
//   maxAmount: number
//   stage: string (filter by stage reached)

router.get('/api/workspaces/:id/survival-curve', async (req, res) => {
  const options: SurvivalQueryOptions = {
    workspaceId: req.params.id,
    lookbackMonths: parseInt(req.query.lookbackMonths as string) || 24,
    groupBy: (req.query.groupBy as SurvivalSegment) || 'none',
    filters: {
      source: req.query.source as string,
      ownerEmail: req.query.owner as string,
      minAmount: req.query.minAmount ? parseFloat(req.query.minAmount as string) : undefined,
      maxAmount: req.query.maxAmount ? parseFloat(req.query.maxAmount as string) : undefined,
      stage: req.query.stage as string,
    },
    minSegmentSize: parseInt(req.query.minSegmentSize as string) || 30,
  };

  const result = await buildSurvivalCurves(db, options);
  res.json(result);
});
```

### 6b. Register as a Tool for Ask Pandora / Assistant

Add to the tool registry so the LLM router can call it:

```typescript
{
  id: 'survival-curve-query',
  name: 'Win Rate Curve Analysis',
  description: 'Query historical win rate curves segmented by source, rep, deal size, or stage. Returns time-to-won survival curves showing how win probability changes over deal age. Use for questions about conversion rates, pipeline quality, and planning.',
  parameters: {
    groupBy: { type: 'string', enum: ['source', 'owner', 'size_band', 'stage_reached', 'pipeline', 'none'] },
    lookbackMonths: { type: 'number', default: 24 },
    source: { type: 'string', optional: true },
    owner: { type: 'string', optional: true },
    minAmount: { type: 'number', optional: true },
    maxAmount: { type: 'number', optional: true },
  },
  examples: [
    { query: 'What is our win rate by source?', params: { groupBy: 'source' } },
    { query: 'How does outbound pipeline convert compared to inbound?', params: { groupBy: 'source' } },
    { query: 'Which rep has the best conversion rate?', params: { groupBy: 'owner' } },
    { query: 'What percentage of Q2 pipeline will close this quarter?', params: { groupBy: 'none' } },
    { query: 'Do enterprise deals convert differently than mid-market?', params: { groupBy: 'size_band' } },
    { query: 'How long does it take deals to close?', params: { groupBy: 'none' } },
  ],
}
```

### 6c. Curve Summary for LLM Consumption

When the assistant or Ask Pandora calls this tool, don't send the raw step array to Claude. Summarize:

```typescript
export function summarizeCurveForLLM(curve: SurvivalCurve): string {
  const checkpoints = [30, 60, 90, 120, 180, 270, 365];
  const lines: string[] = [];

  lines.push(`Win rate curve (${curve.sampleSize} deals, ${curve.eventCount} wins):`);
  
  if (!curve.isReliable) {
    lines.push(`⚠ LOW SAMPLE SIZE — confidence intervals are wide`);
  }

  for (const day of checkpoints) {
    const rate = getCumulativeWinRateAtDay(curve, day);
    if (rate > 0) {
      lines.push(`  By day ${day}: ${(rate * 100).toFixed(1)}% cumulative win rate`);
    }
  }

  lines.push(`  Terminal win rate: ${(curve.terminalWinRate * 100).toFixed(1)}%`);
  
  if (curve.medianTimeTilWon) {
    lines.push(`  Median time to win: ${curve.medianTimeTilWon} days`);
  }

  // Add conditional probabilities at key ages
  lines.push(`Forward-looking probability for open deals:`);
  for (const age of [0, 30, 60, 90, 180]) {
    const { probability } = conditionalWinProbability(curve, age);
    if (probability > 0.01) {
      lines.push(`  Deal open ${age} days: ${(probability * 100).toFixed(1)}% chance of winning from here`);
    }
  }

  return lines.join('\n');
}
```

This summary is what gets injected into the Claude synthesis prompt or assistant response context. ~200-300 tokens per curve, well within budget.

---

## Step 7: Caching Strategy

Survival curves are expensive to recompute (full table scan of deals). Cache them.

```typescript
// Cache key structure:
// survival:{workspaceId}:{groupBy}:{filterHash}
// TTL: 6 hours (curves don't change minute to minute)

// Invalidation triggers:
// 1. After a deal sync completes (new deals, updated close dates)
// 2. After manual cache bust via API
// 3. After TTL expiry

// The Monday morning skill runs (Monte Carlo, Forecast Rollup, Pipeline Coverage)
// should pre-warm the cache with the curves they need:
//   - overall (no segmentation)
//   - by stage_reached
//   - by owner
//   - by source

// Ask Pandora queries hit cache first. If miss, compute on demand.
```

Store computed curves in the `skill_runs` output under a `survival_curves` key when run as part of a scheduled skill. For on-demand API queries, use an in-memory cache (Map or Redis if available) with 6-hour TTL.

---

## Step 8: Handle Graceful Degradation

### Tier 1: Very few deals (< 20 closed deals total)
- Curve is unreliable — `isReliable = false`
- Still compute and display, but flag prominently
- Confidence intervals will be very wide
- Downstream skills fall back to conservative defaults:
  - Monte Carlo: use curve but widen variance sampling
  - Forecast Rollup: show expected values but caveat "based on limited history"
  - Pipeline Coverage: show raw coverage only, skip weighted
- Flag: "Win rate curves improve as you close more deals. Currently based on limited history."

### Tier 2: Sufficient deals (20-50 closed-won) but not enough for segmentation
- Overall curve is reliable
- Segmented curves will mostly fall below threshold
- Downstream skills use overall curve for all deals regardless of segment
- Flag specific segments that are below threshold: "Outbound win curve based on 8 deals — using overall curve instead"

### Tier 3: Strong data (50+ closed-won deals)
- Overall curve and at least some segmented curves are reliable
- Full feature set including segmented analysis
- Monte Carlo uses stage-specific curves
- Ask Pandora can answer segmented questions

### Tier 4: Excellent data (200+ closed-won deals)
- All segmented curves likely reliable
- Can narrow lookback window for more recent curves
- Can compute rep-level curves for coaching

### Implementation:
```typescript
function assessDataTier(curve: SurvivalCurve): 1 | 2 | 3 | 4 {
  if (curve.eventCount < 20) return 1;
  if (curve.eventCount < 50) return 2;
  if (curve.eventCount < 200) return 3;
  return 4;
}
```

Each downstream consumer checks the tier and adjusts its output accordingly. Never show empty or misleading sections.

---

## Step 9: Cohort Win Matrix as a Rendering Layer

The TTE engine is the compute foundation. But planning conversations still happen in cohort language ("how much of our Q2 pipe will close?"). Build a rendering function that translates curves into the cohort view:

```typescript
/**
 * Render the survival curve as a cohort win matrix.
 * This is a PRESENTATION of the curve data, not a separate computation.
 * 
 * Output looks like:
 * | Created   | Q0 Won | Q+1 Won | Q+2 Won | Total Won | Win Rate |
 * |-----------|--------|---------|---------|-----------|----------|
 * | Q1 '24    | $1.5M  | $2.0M   | $800K   | $4.3M     | 43%      |
 * | Q2 '24    | $1.2M  | $1.8M   | ...     | ...       | ...      |
 * 
 * But the MATH behind each cell uses the survival curve rather than
 * raw cohort counting, avoiding all the problems the Funnelcast article
 * identifies (volatility, ancient history dependence, time-averaging).
 */
export interface CohortWinMatrix {
  cohorts: {
    label: string;                    // "Q1 2024", "Q2 2024", etc.
    periodStart: Date;
    periodEnd: Date;
    totalCreated: number;             // count of deals created
    totalCreatedValue: number;        // $ value created
    isMature: boolean;                // enough time has passed to see full conversion
    quarters: {
      label: string;                  // "Q0", "Q+1", "Q+2", etc.
      wonCount: number;
      wonValue: number;
      cumulativeWonValue: number;
      cumulativeWinRate: number;      // by value
    }[];
  }[];
  projectedConversion: {
    // For the current/developing cohort, use the survival curve to project
    // what's LIKELY to convert based on the mature cohort patterns
    cohortLabel: string;
    currentWonValue: number;
    projectedTotalWonValue: number;   // curve-based projection
    projectedWinRate: number;
  } | null;
}

export function buildCohortWinMatrix(
  deals: Deal[],
  curve: SurvivalCurve,
  cadence: 'quarterly' | 'monthly',
  fiscalYearStart: number             // month (1-12) from workspace config
): CohortWinMatrix
```

**Key design choice:** For mature cohorts, use actual deal data (ground truth). For developing cohorts (not enough time to see full conversion), use the survival curve to PROJECT what the remaining conversion will be. This solves the "ancient history" problem — you can show projected win rates for recent cohorts based on the curve shape from all historical data.

---

## Step 10: Test with Client Data

### Imubit (247 deals, Salesforce)
1. Run `buildSurvivalCurves(db, { workspaceId: imubitId, lookbackMonths: 24 })`
2. Verify the curve shape: should be monotonically increasing, flattening after median cycle time
3. Check terminal win rate against known team win rate — should be roughly similar
4. Verify `conditionalWinProbability` decreases as deal age increases
5. Run segmented by `stage_reached` — verify stage-specific curves make intuitive sense (later stages should have higher conditional probabilities at the same age)
6. Run Monte Carlo with the new curve — compare P50 to the old Beta-based P50. The TTE version should produce a LOWER P50 if they have stale pipeline (old deals are now penalized)

### Frontera (HubSpot)
1. Same tests as Imubit
2. Additionally verify HubSpot source field mapping (`original_source`) produces clean segments
3. Run segmented by `source` — verify inbound vs outbound curves differ

### Sanity Checks
- `conditionalWinProbability(curve, 0)` should approximately equal `terminalWinRate` (a brand new deal's forward probability is roughly the overall win rate)
- `conditionalWinProbability(curve, 999)` should be near 0 (a very old deal is almost certainly dead)
- `expectedValueInWindow(curve, 0, 365, 100000)` should equal approximately `$100K × terminalWinRate` (a new deal with a full year has time to reach terminal rate)
- The sum of `expectedValueInWindow` across all open deals should roughly match the Forecast Rollup base case (if not, investigate which deals are getting very different probabilities)

---

## Step 11: What NOT to Change

- **Deal risk adjustments in Monte Carlo stay.** Single-threaded × 0.75, no activity × 0.70, etc. These multiply the curve-derived probability, not replace it. The curve gives the base rate; risk signals adjust it.
- **Deal size distribution (log-normal) stays.** TTE replaces win probability, not amount modeling.
- **Cycle length distribution stays.** Used for projected pipeline timing, not win probability.
- **Close date slippage distribution stays.** Orthogonal to win probability.
- **Pipeline creation rate distribution stays.** Used for Component B volume, not conversion.
- **The three-phase pattern (Compute → Classify → Synthesize) stays.** The survival curve is computed in the COMPUTE phase. It doesn't change the skill architecture.
- **Forecast categories (commit, best case, pipeline) stay in Forecast Rollup.** They're CRM input data. What changes is how they're weighted — by curve probability instead of static multipliers.

---

## Step 12: What to Delete

After validating the swap works correctly:

1. **`fitStageWinRates()`** in `monte-carlo-distributions.ts` — replaced by `buildSurvivalCurves` with `groupBy: 'stage_reached'`
2. **`sampleBeta()` usage for win rates** in `monte-carlo-engine.ts` — keep the function (it's used for sampling with uncertainty), but it's no longer the primary win rate source
3. **Static multiplier constants** (0.8, 0.5, 0.2) in forecast-rollup — replaced by curve-derived values
4. **`Beta(2,6)` hardcode** for projected pipeline win rate — replaced by `expectedValueInWindow` at age 0

---

## Token Budget Impact

The survival curve engine is pure compute — zero LLM tokens. It replaces the Beta distribution fitting which was also pure compute. Net token impact: **zero change**.

The only token difference is in synthesis prompts, which now include a ~200-token curve summary instead of stage win rate percentages. Negligible.

| Component | Tokens Before | Tokens After | Change |
|---|---|---|---|
| Distribution fitting | 0 (compute) | 0 (compute) | None |
| Monte Carlo simulation | 0 (compute) | 0 (compute) | None |
| Monte Carlo synthesis prompt | ~3,500 | ~3,700 | +200 (curve summary) |
| Forecast Rollup synthesis | ~3,000 | ~3,200 | +200 (curve summary) |
| Pipeline Coverage synthesis | ~2,000 | ~2,200 | +200 (curve context) |
| Survival curve API (Ask Pandora) | N/A | ~300 per query | New capability |

---

## File Summary

| File | Action | Description |
|---|---|---|
| `server/analysis/survival-curve.ts` | **CREATE** | Kaplan-Meier estimator, conditional probability, expected value functions |
| `server/analysis/survival-data.ts` | **CREATE** | Data query layer, segmentation, curve building, caching |
| `server/analysis/survival-rendering.ts` | **CREATE** | Cohort win matrix renderer, LLM summary builder |
| `server/analysis/monte-carlo-engine.ts` | **MODIFY** | Swap Beta sampling → curve-based conditional probability |
| `server/analysis/monte-carlo-distributions.ts` | **MODIFY** | Remove `fitStageWinRates`, keep other distributions |
| Forecast rollup skill compute | **MODIFY** | Replace static multipliers with curve-derived expected values |
| Pipeline coverage skill compute | **MODIFY** | Add weighted coverage alongside raw coverage |
| `server/routes/workspace.ts` (or equivalent) | **MODIFY** | Add `/survival-curve` API endpoint |
| Tool registry | **MODIFY** | Register `survival-curve-query` tool for Ask Pandora |

---

**END OF TTE SURVIVAL CURVE BUILD PROMPT**
