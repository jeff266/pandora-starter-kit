# Claude Code Prompt: RFM Behavioral Scoring Engine

## Context

This prompt adds a Recency-Frequency-Monetary behavioral scoring engine to Pandora. RFM is a proven model from direct marketing (1960s) that scores entities on three dimensions: how recently they engaged (Recency), how often they engage (Frequency), and how much they're worth (Monetary). It still outperforms most ML models on behavioral segmentation because it captures momentum — "what they're doing right now" — rather than static attributes like industry or company size.

This is not a standalone skill. It's a shared compute module that produces a behavioral score for every open deal and account, stored alongside existing computed fields. Other skills consume it:
- **Pipeline Hygiene** uses RFM to distinguish "stale but worth saving" (R1-F1-M5) from "stale and let it die" (R1-F1-M1)
- **Pipeline Coverage** reports weighted coverage using RFM-adjusted expected values
- **Forecast Rollup** adds behavioral momentum to the narrative: "commit pipeline is $2M but $600K is behaviorally cold"
- **Lead Scoring** gains a behavioral dimension that complements ICP fit (attribute score)
- **Monte Carlo** uses RFM as an additional risk adjustment signal alongside single-thread and activity signals
- **Rep Scorecard** shows deal health distribution per rep using RFM grades
- **Survival Curve Engine** can compute per-RFM-segment curves, answering "do hot deals convert faster?"

The compound scoring model becomes: **ICP fit** (who they are) × **RFM behavior** (what they're doing) × **TTE conditional probability** (how likely and when). Three orthogonal dimensions that together give a dramatically better deal priority than any single number.

**This is pure SQL and arithmetic. Zero LLM tokens. Zero API cost.**

**Before starting, find and read:**
1. `server/analysis/computed-fields.ts` — the existing computed fields engine. RFM scores will be computed here alongside `engagementScore`, `healthScore`, `velocityScore`, and `daysSinceActivity`.
2. `server/analysis/survival-curve.ts` — the TTE engine. RFM integrates with it for per-segment curves.
3. The `deals` table schema — you need: `id`, `workspace_id`, `amount`, `created_at`, `updated_at`, `owner_email`, `stage_normalized`, `is_closed`, `close_date`.
4. The `activities` table schema — `type`, `activity_date`, `deal_id`, `actor_email`, `workspace_id`.
5. The `contacts` table and `deal_contacts` junction — for account-level RFM.
6. The `conversations` table — call data contributes to Frequency.
7. The workspace config / context layer — `ActivityConfig` with `engagement_weights` and `tracked_types`, and `ThresholdConfig` with `stale_deal_days`.
8. The lead scoring spec (`PANDORA_LEAD_SCORING_SKILL_SPECS.md`) — understand how point-based and regression scoring work so RFM can complement, not duplicate.

---

## Step 1: Assess Activity Data Coverage

Before computing anything, determine what's available. This check runs once per workspace per computation cycle and determines which RFM mode to use.

### 1a. Coverage Assessment Query

```typescript
export interface ActivityCoverageAssessment {
  mode: 'full_rfm' | 'rm_only' | 'r_only';
  totalOpenDeals: number;
  dealsWithActivityLast30d: number;
  dealsWithActivityEver: number;
  coveragePercent: number;            // dealsWithActivityLast30d / totalOpenDeals
  activitySources: string[];          // ['email', 'call', 'meeting'] — what types exist
  hasConversationData: boolean;       // conversations table has linked records
  caveats: string[];                  // human-readable data quality notes
}

export async function assessActivityCoverage(
  db: DatabaseClient,
  workspaceId: string
): Promise<ActivityCoverageAssessment>
```

**SQL:**

```sql
-- Count open deals
SELECT COUNT(*) AS total_open
FROM deals
WHERE workspace_id = $1
  AND is_closed = false;

-- Count deals with at least one activity in last 30 days
SELECT COUNT(DISTINCT a.deal_id) AS deals_with_recent_activity
FROM activities a
JOIN deals d ON a.deal_id = d.id
WHERE a.workspace_id = $1
  AND d.is_closed = false
  AND a.activity_date > NOW() - INTERVAL '30 days';

-- Count deals with ANY activity ever
SELECT COUNT(DISTINCT a.deal_id) AS deals_with_any_activity
FROM activities a
JOIN deals d ON a.deal_id = d.id
WHERE a.workspace_id = $1
  AND d.is_closed = false;

-- What activity types exist
SELECT DISTINCT type FROM activities
WHERE workspace_id = $1
  AND activity_date > NOW() - INTERVAL '90 days';

-- Conversation data availability
SELECT COUNT(*) AS linked_conversations
FROM conversations
WHERE workspace_id = $1
  AND deal_id IS NOT NULL;
```

### 1b. Mode Selection Logic

```typescript
function selectRFMMode(assessment: ActivityCoverageAssessment): 'full_rfm' | 'rm_only' | 'r_only' {
  // Full RFM: reliable activity data across most deals
  if (assessment.coveragePercent >= 0.70) return 'full_rfm';

  // RM only: some activity data but not enough for reliable Frequency
  // Recency still works because even sparse data tells you WHEN the last touch was
  // Monetary always works (deal amount from CRM)
  if (assessment.coveragePercent >= 0.30) return 'rm_only';

  // R only: almost no activity data
  // Recency falls back to deal updated_at or stage_changed_at
  // Frequency is meaningless
  // Monetary still works but alone it's just deal size ranking
  // In this mode, R uses CRM record modification as a proxy
  return 'r_only';
}
```

### 1c. Caveats Generation

```typescript
function generateCaveats(assessment: ActivityCoverageAssessment): string[] {
  const caveats: string[] = [];

  if (assessment.mode === 'r_only') {
    caveats.push(
      'Activity data covers less than 30% of open deals. ' +
      'Recency is based on CRM record changes, not actual engagement. ' +
      'Enable email/calendar sync or connect Gong/Fireflies for accurate behavioral scoring.'
    );
  }

  if (assessment.mode === 'rm_only') {
    caveats.push(
      `Activity data covers ${Math.round(assessment.coveragePercent * 100)}% of open deals. ` +
      'Frequency scores may undercount engagement for reps who don\'t log all touchpoints. ' +
      'Recency and Monetary scores are reliable.'
    );
  }

  if (!assessment.hasConversationData) {
    caveats.push(
      'No conversation intelligence data linked to deals. ' +
      'Calls and meetings from Gong/Fireflies would strengthen Frequency scoring.'
    );
  }

  if (!assessment.activitySources.includes('email')) {
    caveats.push('No email activity data detected. Email sync would improve Recency accuracy.');
  }

  return caveats;
}
```

**Store the assessment in the workspace's computed field metadata so downstream skills know what mode RFM is running in. Never hide the mode — every skill that consumes RFM should know whether it's full, RM-only, or R-only.**

---

## Step 2: Compute RFM Dimensions per Deal

Create `server/analysis/rfm-scoring.ts`.

### 2a. Data Types

```typescript
export interface RFMScore {
  // Raw values
  recencyDays: number;                // days since last meaningful activity
  recencySource: 'activity' | 'conversation' | 'stage_change' | 'record_update';  // what the recency is based on
  frequencyCount: number;             // weighted activity count in window
  frequencyWindow: number;            // days (default 30)
  monetaryValue: number;              // deal amount

  // Quintile scores (1-5, 5 is best)
  recencyQuintile: number;
  frequencyQuintile: number | null;   // null if mode is 'r_only'
  monetaryQuintile: number;

  // Composite
  rfmSegment: string;                 // e.g., "R5-F4-M3" or "R5-M3" in RM mode
  rfmGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  rfmLabel: string;                   // human-readable segment name

  // Context
  mode: 'full_rfm' | 'rm_only' | 'r_only';
  isReliable: boolean;               // false if based on proxies
}

export interface RFMQuintileBreakpoints {
  recency: number[];                  // [R5/R4 boundary, R4/R3, R3/R2, R2/R1] in days
  frequency: number[] | null;        // [F1/F2, F2/F3, F3/F4, F4/F5] in weighted count
  monetary: number[];                // [M1/M2, M2/M3, M3/M4, M4/M5] in dollars
  computedFrom: {
    dealCount: number;
    windowStart: Date;
    windowEnd: Date;
  };
}
```

### 2b. Fetch Raw Dimension Values

```typescript
export async function computeRawRFMValues(
  db: DatabaseClient,
  workspaceId: string,
  mode: 'full_rfm' | 'rm_only' | 'r_only',
  engagementWeights?: Record<string, number>
): Promise<Map<string, { recencyDays: number; recencySource: string; frequencyCount: number; monetaryValue: number }>>
```

**Recency — days since last meaningful touchpoint:**

```sql
-- Primary: most recent activity per deal
SELECT
  d.id AS deal_id,
  d.amount,
  d.updated_at AS deal_updated_at,
  -- Best recency source, in priority order
  COALESCE(
    -- 1. Most recent activity (email, call, meeting)
    latest_activity.last_date,
    -- 2. Most recent linked conversation
    latest_convo.last_date,
    -- 3. Most recent stage change
    latest_stage.last_date,
    -- 4. Deal record update (weakest signal)
    d.updated_at
  ) AS last_touch_date,
  CASE
    WHEN latest_activity.last_date IS NOT NULL THEN 'activity'
    WHEN latest_convo.last_date IS NOT NULL THEN 'conversation'
    WHEN latest_stage.last_date IS NOT NULL THEN 'stage_change'
    ELSE 'record_update'
  END AS recency_source
FROM deals d
LEFT JOIN LATERAL (
  SELECT MAX(a.activity_date) AS last_date
  FROM activities a
  WHERE a.deal_id = d.id
    AND a.activity_date IS NOT NULL
) latest_activity ON true
LEFT JOIN LATERAL (
  SELECT MAX(c.call_date) AS last_date
  FROM conversations c
  WHERE c.deal_id = d.id
    AND c.call_date IS NOT NULL
) latest_convo ON true
LEFT JOIN LATERAL (
  SELECT MAX(dsh.entered_at) AS last_date
  FROM deal_stage_history dsh
  WHERE dsh.deal_id = d.id
) latest_stage ON true
WHERE d.workspace_id = $1
  AND d.is_closed = false
```

Recency = `EXTRACT(EPOCH FROM (NOW() - last_touch_date)) / 86400` (days).

**Important:** For Recency, lower numbers are BETTER (more recent = good). The quintile assignment will invert this — R5 (best) = most recent, R1 (worst) = least recent.

**Frequency — weighted activity count in last 30 days:**

```sql
SELECT
  a.deal_id,
  SUM(
    CASE a.type
      WHEN 'meeting' THEN $2    -- engagement_weights.meeting (default 10)
      WHEN 'call' THEN $3       -- engagement_weights.call (default 5)
      WHEN 'email' THEN $4      -- engagement_weights.email_sent (default 2)
      ELSE 1
    END
  ) AS weighted_activity_count
FROM activities a
JOIN deals d ON a.deal_id = d.id
WHERE a.workspace_id = $1
  AND d.is_closed = false
  AND a.activity_date > NOW() - INTERVAL '30 days'
GROUP BY a.deal_id
```

Also add conversation count if available:

```sql
-- Add to frequency: linked conversations in last 30 days
SELECT
  c.deal_id,
  COUNT(*) * $5 AS weighted_convo_count   -- engagement_weights.meeting (conversations count as meetings)
FROM conversations c
JOIN deals d ON c.deal_id = d.id
WHERE c.workspace_id = $1
  AND d.is_closed = false
  AND c.call_date > NOW() - INTERVAL '30 days'
  AND c.deal_id IS NOT NULL
GROUP BY c.deal_id
```

Sum both for the total Frequency value. Deals with zero activities get Frequency = 0.

**Monetary — deal amount:**

Straightforward: `deal.amount`. Handle nulls and zeros:
- `NULL` amount → exclude from Monetary quintile (can't score what you don't have)
- `$0` amount → treat as M1 (lowest quintile)

Read engagement weights from workspace config `ActivityConfig.engagement_weights`, falling back to defaults if not configured:

```typescript
const DEFAULT_ENGAGEMENT_WEIGHTS = {
  meeting: 10,
  call: 5,
  email_sent: 2,
  email_received: 1,
  task: 1,
  note: 1,
};
```

### 2c. Skip Frequency in RM-Only and R-Only Modes

If mode is `'rm_only'` or `'r_only'`, don't run the Frequency query. Set all Frequency values to `null`. The quintile assignment will skip F entirely and produce two-dimensional segments (R-M).

If mode is `'r_only'`, Recency uses the `record_update` fallback for all deals (the COALESCE chain will reach `d.updated_at`). Still compute Monetary — it's always available.

---

## Step 3: Compute Quintile Breakpoints

Quintiles are calculated from the workspace's own data, not industry benchmarks. This is what makes the model self-calibrating.

### 3a. Breakpoint Calculation

```typescript
export function computeQuintileBreakpoints(
  values: number[],
  dimension: 'recency' | 'frequency' | 'monetary'
): number[] {
  if (values.length < 10) {
    // Not enough data for meaningful quintiles — use terciles instead
    // This happens for small workspaces with < 10 open deals
    return computeTercileBreakpoints(values, dimension);
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  return [
    sorted[Math.floor(n * 0.20)],   // Q1/Q2 boundary
    sorted[Math.floor(n * 0.40)],   // Q2/Q3 boundary
    sorted[Math.floor(n * 0.60)],   // Q3/Q4 boundary
    sorted[Math.floor(n * 0.80)],   // Q4/Q5 boundary
  ];
}
```

**Recency inverts:** For Recency, lower values (fewer days since last touch) are BETTER. Quintile 5 = lowest recency days. So assign quintiles in reverse:

```typescript
function assignRecencyQuintile(recencyDays: number, breakpoints: number[]): number {
  // Inverted: fewer days = higher quintile (better)
  if (recencyDays <= breakpoints[0]) return 5;
  if (recencyDays <= breakpoints[1]) return 4;
  if (recencyDays <= breakpoints[2]) return 3;
  if (recencyDays <= breakpoints[3]) return 2;
  return 1;
}
```

**Frequency and Monetary are normal:** Higher values = higher quintile = better.

```typescript
function assignQuintile(value: number, breakpoints: number[]): number {
  if (value <= breakpoints[0]) return 1;
  if (value <= breakpoints[1]) return 2;
  if (value <= breakpoints[2]) return 3;
  if (value <= breakpoints[3]) return 4;
  return 5;
}
```

### 3b. Tercile Fallback

For workspaces with fewer than 10 open deals, quintiles produce quintiles with 1-2 deals each, which is noisy. Fall back to terciles (3 groups):

```typescript
function computeTercileBreakpoints(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return [
    sorted[Math.floor(n * 0.33)],
    sorted[Math.floor(n * 0.67)],
  ];
}
```

Map terciles to grades instead of quintile numbers: Top third = A, Middle = C, Bottom = F. Skip the 5-point scale entirely — it would create false precision.

### 3c. Store Breakpoints

Store the breakpoints as metadata alongside the scores. The methodology layer (Step 7) needs them to show users how their deals were bucketed. Store in the same `skill_runs` output or a `workspace_rfm_meta` cache:

```typescript
export interface RFMWorkspaceMeta {
  workspaceId: string;
  computedAt: Date;
  mode: 'full_rfm' | 'rm_only' | 'r_only';
  breakpoints: RFMQuintileBreakpoints;
  coverage: ActivityCoverageAssessment;
  historicalWinRates: Record<string, number>;  // RFM segment → win rate (Step 5)
  dealCount: number;
}
```

---

## Step 4: Assign Segments, Grades, and Labels

### 4a. Segment String

```typescript
function buildRFMSegment(r: number, f: number | null, m: number): string {
  if (f !== null) return `R${r}-F${f}-M${m}`;
  return `R${r}-M${m}`;
}
```

### 4b. Grade Assignment

The grade is a simplified composite for quick consumption. Not a weighted average of quintiles — it's a strategic classification:

```typescript
function assignRFMGrade(r: number, f: number | null, m: number, mode: string): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (mode === 'r_only') {
    // Two-dimensional: R × M only
    if (r >= 4 && m >= 4) return 'A';
    if (r >= 3 && m >= 3) return 'B';
    if (r >= 2 && m >= 2) return 'C';
    if (r >= 2 || m >= 4) return 'D';  // either recent OR high value
    return 'F';
  }

  // Full RFM or RM mode
  const freq = f ?? 3;  // neutral if unavailable

  // A: Hot and valuable — recent engagement, high activity, big deal
  if (r >= 4 && freq >= 4 && m >= 4) return 'A';
  if (r >= 4 && freq >= 3 && m >= 5) return 'A';  // huge deal, active = A even with moderate frequency
  if (r >= 5 && freq >= 4 && m >= 3) return 'A';  // very recent, very active = A even for mid-size

  // B: Healthy — at least 2 of 3 dimensions strong
  if (r >= 3 && freq >= 3 && m >= 3) return 'B';
  if (r >= 4 && m >= 4) return 'B';  // recent and valuable, even if low frequency

  // C: Mixed signals — one strong dimension, others weak
  if (r >= 3 && m >= 3) return 'C';
  if (freq >= 4 && m >= 4) return 'C';

  // D: Weak — mostly low scores but not dead
  if (r >= 2 || m >= 4) return 'D';  // either some recency OR high value

  // F: Cold and small — likely dead or not worth the effort
  return 'F';
}
```

### 4c. Human-Readable Labels

```typescript
function assignRFMLabel(r: number, f: number | null, m: number, mode: string): string {
  const grade = assignRFMGrade(r, f, m, mode);

  // High-value cold deals get specific labels because they're actionable
  if (m >= 4 && r <= 2) return 'High Value, Going Cold';
  if (m >= 4 && r <= 2 && (f ?? 0) <= 2) return 'Big Deal at Risk';

  // Active but small
  if (r >= 4 && (f ?? 3) >= 4 && m <= 2) return 'Active but Small';

  // Standard labels by grade
  switch (grade) {
    case 'A': return 'Hot Opportunity';
    case 'B': return 'Healthy Pipeline';
    case 'C': return 'Needs Attention';
    case 'D': return 'Losing Momentum';
    case 'F': return 'Likely Dead';
  }
}
```

**Key design choice:** The labels are action-oriented, not academic. "High Value, Going Cold" tells a manager exactly what happened and implies the action (re-engage). "R2-F1-M5" tells them nothing. The segment string is for data consumers (skills, API); the label is for humans.

---

## Step 5: Backtest Win Rates by RFM Segment

This is the evidence that makes RFM credible. Before showing anyone a score, compute how historical deals with similar RFM profiles actually performed.

### 5a. Historical RFM Calculation

Apply the same RFM computation to closed deals, using their state at a point in time before close:

```sql
-- For each closed deal, compute what its RFM looked like 30 days before close
-- This is a snapshot reconstruction: "what did this deal look like when it was still open?"
SELECT
  d.id AS deal_id,
  d.is_closed_won,
  d.amount,
  -- Recency at T-30: days between last activity before (closed_at - 30 days) and (closed_at - 30 days)
  EXTRACT(EPOCH FROM (
    (d.closed_at - INTERVAL '30 days') -
    COALESCE(
      (SELECT MAX(a.activity_date) FROM activities a
       WHERE a.deal_id = d.id AND a.activity_date < d.closed_at - INTERVAL '30 days'),
      d.created_at
    )
  )) / 86400 AS recency_days_at_snapshot,
  -- Frequency at T-30: activities in 30 days before the snapshot
  COALESCE(
    (SELECT COUNT(*) FROM activities a
     WHERE a.deal_id = d.id
       AND a.activity_date BETWEEN (d.closed_at - INTERVAL '60 days') AND (d.closed_at - INTERVAL '30 days')),
    0
  ) AS frequency_at_snapshot,
  d.amount AS monetary_value
FROM deals d
WHERE d.workspace_id = $1
  AND d.is_closed = true
  AND d.closed_at > NOW() - INTERVAL '24 months'
```

**Why T-30?** Because at T-0 (close date), won deals have high activity (signing, last calls) and lost deals have low activity (they've been abandoned). That's circular — the RFM would predict the outcome because it's measuring the outcome. T-30 captures behavioral state BEFORE the deal resolved, which is predictive rather than descriptive.

### 5b. Compute Win Rates by Segment

After assigning quintiles to historical deals using the same breakpoints, compute:

```typescript
export async function computeHistoricalWinRatesByRFM(
  db: DatabaseClient,
  workspaceId: string,
  breakpoints: RFMQuintileBreakpoints,
  mode: 'full_rfm' | 'rm_only' | 'r_only'
): Promise<Record<string, { winRate: number; sampleSize: number; avgDealSize: number }>>
```

Output looks like:

```
R5-F5-M5: { winRate: 0.62, sampleSize: 14, avgDealSize: 185000 }
R5-F4-M3: { winRate: 0.48, sampleSize: 23, avgDealSize: 95000 }
R2-F1-M5: { winRate: 0.11, sampleSize: 9, avgDealSize: 220000 }
R1-F1-M1: { winRate: 0.04, sampleSize: 31, avgDealSize: 18000 }
```

Also compute win rates by grade:

```
A: { winRate: 0.54, sampleSize: 37 }
B: { winRate: 0.38, sampleSize: 62 }
C: { winRate: 0.22, sampleSize: 48 }
D: { winRate: 0.12, sampleSize: 35 }
F: { winRate: 0.05, sampleSize: 41 }
```

**If there aren't enough closed deals to produce meaningful win rates (< 50 total closed), skip this step and flag it.** The RFM scores still have relative value (ranking deals against each other) even without backtested win rates. But the evidence layer (Step 7) can't show "deals like this historically close at X%" without the backtest.

### 5c. Discrimination Test

A simple check that the model is actually separating outcomes:

```typescript
function testRFMDiscrimination(
  winRatesByGrade: Record<string, { winRate: number }>
): { isDiscriminating: boolean; spread: number; warning: string | null } {
  const rates = Object.entries(winRatesByGrade)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v.winRate);

  // Spread = difference between best and worst grade win rate
  const spread = Math.max(...rates) - Math.min(...rates);

  // If A-grade win rate isn't at least 2x F-grade, the model isn't working
  const aRate = winRatesByGrade['A']?.winRate ?? 0;
  const fRate = winRatesByGrade['F']?.winRate ?? 0.01;
  const lift = aRate / fRate;

  if (spread < 0.15 || lift < 1.5) {
    return {
      isDiscriminating: false,
      spread,
      warning: 'RFM grades do not strongly predict win/loss outcomes for this workspace. ' +
        'This may indicate insufficient activity data or a sales process where engagement ' +
        'patterns don\'t correlate with outcomes. Scores are still useful for relative ' +
        'prioritization but should not be treated as predictive.'
    };
  }

  return { isDiscriminating: true, spread, warning: null };
}
```

**If the model isn't discriminating, still compute and store scores** (they're useful for sorting), but suppress predictive language in downstream skill synthesis ("deals like this win at 54%") and flag the warning in metadata.

---

## Step 6: Store Scores and Wire to Computed Fields

### 6a. Storage

RFM scores are stored as columns on the `deals` table alongside existing computed fields, NOT in a separate table. They're refreshed every sync cycle.

```sql
-- Add columns to deals table (migration)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_recency_days NUMERIC;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_recency_quintile SMALLINT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_recency_source TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_frequency_count NUMERIC;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_frequency_quintile SMALLINT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_monetary_quintile SMALLINT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_segment TEXT;          -- "R5-F4-M3"
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_grade TEXT;            -- "A", "B", "C", "D", "F"
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_label TEXT;            -- "Hot Opportunity"
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_mode TEXT;             -- "full_rfm", "rm_only", "r_only"
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_scored_at TIMESTAMPTZ;

CREATE INDEX idx_deals_rfm_grade ON deals(workspace_id, rfm_grade) WHERE is_closed = false;
CREATE INDEX idx_deals_rfm_segment ON deals(workspace_id, rfm_segment) WHERE is_closed = false;
```

### 6b. Wire into refreshComputedFields

In `server/analysis/computed-fields.ts`, add RFM computation to the existing `refreshComputedFields()` function:

```typescript
export async function refreshComputedFields(workspaceId: string, db: DatabaseClient) {
  // ... existing computed fields (engagementScore, healthScore, etc.) ...

  // RFM scoring — runs after activity-dependent fields are computed
  const coverage = await assessActivityCoverage(db, workspaceId);
  const mode = selectRFMMode(coverage);
  const engagementWeights = await getEngagementWeights(db, workspaceId);

  const rawValues = await computeRawRFMValues(db, workspaceId, mode, engagementWeights);

  // Compute breakpoints from current data
  const recencyValues = [...rawValues.values()].map(v => v.recencyDays);
  const frequencyValues = mode !== 'r_only'
    ? [...rawValues.values()].map(v => v.frequencyCount)
    : null;
  const monetaryValues = [...rawValues.values()]
    .filter(v => v.monetaryValue > 0)
    .map(v => v.monetaryValue);

  const breakpoints: RFMQuintileBreakpoints = {
    recency: computeQuintileBreakpoints(recencyValues, 'recency'),
    frequency: frequencyValues ? computeQuintileBreakpoints(frequencyValues, 'frequency') : null,
    monetary: computeQuintileBreakpoints(monetaryValues, 'monetary'),
    computedFrom: { dealCount: rawValues.size, windowStart: ..., windowEnd: new Date() },
  };

  // Assign quintiles and grades
  const scores: Map<string, RFMScore> = new Map();
  for (const [dealId, raw] of rawValues) {
    const r = assignRecencyQuintile(raw.recencyDays, breakpoints.recency);
    const f = mode !== 'r_only'
      ? assignQuintile(raw.frequencyCount, breakpoints.frequency!)
      : null;
    const m = raw.monetaryValue > 0
      ? assignQuintile(raw.monetaryValue, breakpoints.monetary)
      : 1;

    scores.set(dealId, {
      recencyDays: raw.recencyDays,
      recencySource: raw.recencySource,
      frequencyCount: raw.frequencyCount,
      frequencyWindow: 30,
      monetaryValue: raw.monetaryValue,
      recencyQuintile: r,
      frequencyQuintile: f,
      monetaryQuintile: m,
      rfmSegment: buildRFMSegment(r, f, m),
      rfmGrade: assignRFMGrade(r, f, m, mode),
      rfmLabel: assignRFMLabel(r, f, m, mode),
      mode,
      isReliable: raw.recencySource !== 'record_update',
    });
  }

  // Batch update deals table
  await batchUpdateRFMScores(db, workspaceId, scores);

  // Compute and cache historical win rates (less frequently — only if > 50 closed deals)
  const closedDealCount = await getClosedDealCount(db, workspaceId, 24);
  if (closedDealCount >= 50) {
    const historicalWinRates = await computeHistoricalWinRatesByRFM(db, workspaceId, breakpoints, mode);
    await cacheRFMWorkspaceMeta(db, workspaceId, { breakpoints, coverage, historicalWinRates, mode });
  }

  // Log
  console.log(`RFM scored ${scores.size} deals in ${mode} mode (${Math.round(coverage.coveragePercent * 100)}% activity coverage)`);
}
```

### 6c. Account-Level RFM (Optional Extension)

For skills that operate at the account level (ICP Discovery, Account Dossier), compute an account-level RFM by aggregating across all open deals at the account:

```typescript
// Account Recency = most recent activity across all deals at account
// Account Frequency = sum of weighted activities across all deals
// Account Monetary = sum of open deal amounts (or largest deal)
```

This is a future extension — don't build it now. Note the hook and move on.

---

## Step 7: Build the Three Evidence Layers

This is how users see and trust the scores. Each layer is a rendering function, not a skill.

### 7a. Layer 1: Score Card (Slack / Command Center)

```typescript
export function renderRFMScoreCard(
  deal: Deal & RFMScore,
  mode: string
): string {
  const lines: string[] = [];

  lines.push(`*${deal.name}* — Priority: ${deal.rfmGrade} (${deal.rfmLabel})`);

  // Recency
  const recencyEmoji = deal.recencyQuintile >= 4 ? '✅' : deal.recencyQuintile >= 2 ? '⚠️' : '🔴';
  const recencyContext = deal.recencyDays <= 1 ? 'today'
    : deal.recencyDays <= 7 ? `${Math.round(deal.recencyDays)} days ago`
    : `${Math.round(deal.recencyDays)} days ago`;
  lines.push(`  ${recencyEmoji} Recency: Last touch ${recencyContext}`);

  // Frequency (if available)
  if (deal.frequencyQuintile !== null) {
    const freqEmoji = deal.frequencyQuintile >= 4 ? '✅' : deal.frequencyQuintile >= 2 ? '⚠️' : '🔴';
    lines.push(`  ${freqEmoji} Activity: ${deal.frequencyCount} touchpoints in last 30d`);
  }

  // Monetary
  const moneyEmoji = deal.monetaryQuintile >= 4 ? '💰' : deal.monetaryQuintile >= 2 ? '💵' : '📉';
  lines.push(`  ${moneyEmoji} Value: $${(deal.monetaryValue / 1000).toFixed(0)}K`);

  return lines.join('\n');
}
```

**No math shown. Just dimensions in plain language with context relative to their own pipeline.**

### 7b. Layer 2: Historical Comparison (Drill-Through)

```typescript
export function renderRFMComparison(
  deal: Deal & RFMScore,
  historicalWinRates: Record<string, { winRate: number; sampleSize: number }>,
  isDiscriminating: boolean
): string {
  const segmentStats = historicalWinRates[deal.rfmSegment];
  const gradeStats = historicalWinRates[deal.rfmGrade];

  const lines: string[] = [];

  if (!isDiscriminating) {
    lines.push('_RFM scores are useful for prioritization but have limited predictive power for this workspace._');
    return lines.join('\n');
  }

  if (gradeStats && gradeStats.sampleSize >= 5) {
    lines.push(`Deals graded ${deal.rfmGrade} in your pipeline historically close at ${Math.round(gradeStats.winRate * 100)}% (based on ${gradeStats.sampleSize} deals).`);
  }

  // Show what happened to similar deals
  if (deal.rfmGrade === 'D' || deal.rfmGrade === 'F') {
    const aRate = historicalWinRates['A']?.winRate ?? 0;
    lines.push(`For comparison, your A-grade deals close at ${Math.round(aRate * 100)}%.`);
  }

  // Specific pattern for high-value cold deals
  if (deal.monetaryQuintile >= 4 && deal.recencyQuintile <= 2) {
    lines.push(`This is a high-value deal that has gone cold. Of similar deals in your history:`);
    // Query: deals that were M4/M5 and R1/R2 — what % recovered vs lost?
    // This would need a specific backtest query, stored in meta
  }

  return lines.join('\n');
}
```

### 7c. Layer 3: Methodology (Settings / Documentation)

```typescript
export function renderRFMMethodology(
  meta: RFMWorkspaceMeta
): string {
  const lines: string[] = [];

  lines.push(`## Your RFM Model`);
  lines.push(`Auto-calibrated from ${meta.dealCount} open deals. Mode: ${meta.mode}.`);
  lines.push('');

  // Recency breakpoints
  lines.push(`### Recency (days since last activity)`);
  lines.push(`  R5 (best):  0–${meta.breakpoints.recency[0]} days`);
  lines.push(`  R4:         ${meta.breakpoints.recency[0]+1}–${meta.breakpoints.recency[1]} days`);
  lines.push(`  R3:         ${meta.breakpoints.recency[1]+1}–${meta.breakpoints.recency[2]} days`);
  lines.push(`  R2:         ${meta.breakpoints.recency[2]+1}–${meta.breakpoints.recency[3]} days`);
  lines.push(`  R1 (worst): ${meta.breakpoints.recency[3]+1}+ days`);
  lines.push('');

  // Historical win rates by quintile
  if (meta.historicalWinRates) {
    lines.push(`### Historical Win Rates by Grade`);
    for (const grade of ['A', 'B', 'C', 'D', 'F']) {
      const stats = meta.historicalWinRates[grade];
      if (stats) {
        lines.push(`  ${grade}: ${Math.round(stats.winRate * 100)}% (${stats.sampleSize} deals)`);
      }
    }
  }

  // Coverage caveats
  if (meta.coverage.caveats.length > 0) {
    lines.push('');
    lines.push(`### Data Quality Notes`);
    for (const caveat of meta.coverage.caveats) {
      lines.push(`  ⚠ ${caveat}`);
    }
  }

  return lines.join('\n');
}
```

---

## Step 8: Wire RFM into Existing Skills

Each integration is small — skills read from `deals.rfm_grade` and `deals.rfm_segment` columns that are already populated by the computed fields engine.

### 8a. Pipeline Hygiene

In the compute step that identifies stale deals, add RFM context:

```typescript
// After computing stale deals list:
const staleByGrade = {
  A: staleDeals.filter(d => d.rfm_grade === 'A'),  // High-value deals going cold — top priority
  B: staleDeals.filter(d => d.rfm_grade === 'B'),
  C: staleDeals.filter(d => d.rfm_grade === 'C'),
  D: staleDeals.filter(d => d.rfm_grade === 'D'),
  F: staleDeals.filter(d => d.rfm_grade === 'F'),  // Probably should be closed-lost
};
```

Add to the synthesis prompt context:

```
STALE DEAL PRIORITY (by behavioral grade):
- ${staleByGrade.A.length} A-grade deals (${sumAmount(staleByGrade.A)}) are stale — these are your biggest losses to save
- ${staleByGrade.F.length} F-grade deals (${sumAmount(staleByGrade.F)}) are stale — likely dead, candidates for cleanup
```

This changes the Pipeline Hygiene output from "47 stale deals" to "3 high-value deals worth saving and 28 dead deals to clean up" — dramatically more actionable.

### 8b. Forecast Rollup

In the synthesis prompt context, add behavioral quality of forecast categories:

```
BEHAVIORAL QUALITY OF COMMITTED PIPELINE:
- Commit ($${commitTotal}): ${commitByGrade.A + commitByGrade.B} deals are behaviorally active (A/B grade), ${commitByGrade.D + commitByGrade.F} are cold (D/F grade, $${coldCommitValue})
- Best Case ($${bestCaseTotal}): ${bestCaseByGrade.A + bestCaseByGrade.B} active, ${bestCaseByGrade.D + bestCaseByGrade.F} cold ($${coldBestCaseValue})
- ⚠ ${coldCommitPercent}% of commit pipeline has gone behaviorally cold — these deals may not close on schedule
```

### 8c. Pipeline Coverage

Add weighted coverage using RFM:

```typescript
// Alongside raw coverage, compute RFM-adjusted coverage
// Only A and B grade deals are "quality pipeline"
const qualityPipeline = openDeals
  .filter(d => d.rfm_grade === 'A' || d.rfm_grade === 'B')
  .reduce((sum, d) => sum + d.amount, 0);

const qualityCoverageRatio = qualityPipeline / remaining;

// Report both
// "Raw coverage: 3.2x | Quality coverage (A/B grade only): 1.8x"
```

### 8d. Lead Scoring (Compound Score)

RFM provides the behavioral dimension. ICP provides the attribute dimension. The compound score is:

```typescript
// Composite priority score (for ranking, not display)
// ICP fit: 0-100 (from lead_scores table)
// RFM behavioral: map grade to 0-100 (A=90, B=70, C=50, D=30, F=10)
// TTE conditional probability: 0-100 (from survival curve)

const rfmNumeric = { A: 90, B: 70, C: 50, D: 30, F: 10 }[deal.rfm_grade];
const icpFit = deal.lead_score?.icp_fit_score ?? 50;  // neutral if no ICP
const tteProbability = (conditionalWinProbability(curve, dealAge).probability * 100);

const compositePriority =
  (icpFit * 0.35) +               // who they are
  (rfmNumeric * 0.35) +           // what they're doing
  (tteProbability * 0.30);         // how likely, given time

// This composite drives deal ranking in the Command Center
```

**Don't store the composite as a single number.** Store the three components separately so the evidence layer can explain WHY a deal is ranked where it is. "This deal ranks #3 because: strong ICP fit (82), active engagement (A grade), and 38% forward win probability."

### 8e. Monte Carlo (Risk Adjustment)

Add RFM as an additional risk signal alongside existing single-thread and stale deal multipliers:

```typescript
// In monte-carlo-engine.ts, add to deal risk adjustments:
// RFM grade as a multiplier on top of TTE conditional probability

const rfmMultiplier: Record<string, number> = {
  A: 1.10,   // slight boost — behavioral momentum
  B: 1.00,   // neutral
  C: 0.90,   // slight penalty
  D: 0.75,   // significant penalty — deal is going cold
  F: 0.50,   // heavy penalty — deal is likely dead
};

// Applied alongside existing multipliers:
const adjustment = (inputs.riskAdjustments[deal.id]?.multiplier ?? 1.0)
  * (rfmMultiplier[deal.rfm_grade] ?? 1.0);
```

### 8f. Survival Curve Integration

Register RFM grade as a segmentation option in the survival curve engine:

```typescript
// In survival-data.ts, add to SurvivalSegment type:
export type SurvivalSegment =
  | 'source'
  | 'owner'
  | 'size_band'
  | 'stage_reached'
  | 'pipeline'
  | 'segment'
  | 'rfm_grade'        // ← NEW
  | 'none';

// When groupBy = 'rfm_grade', group observations by their RFM grade at time of resolution
// This produces per-grade survival curves that answer:
// "Do A-grade deals actually convert faster than C-grade deals?"
```

This is the ultimate validation: if the RFM-segmented survival curves show meaningfully different shapes (A-grade deals converge fast, F-grade deals flatline), the model is working. If the curves are similar regardless of grade, RFM isn't adding signal for this workspace.

---

## Step 9: API Endpoint for Ask Pandora

```typescript
// GET /api/workspaces/:id/rfm/summary
// Returns: current RFM distribution, breakpoints, win rates by grade

router.get('/api/workspaces/:id/rfm/summary', async (req, res) => {
  const meta = await getRFMWorkspaceMeta(db, req.params.id);
  const distribution = await getRFMDistribution(db, req.params.id);
  // distribution = { A: { count, totalValue }, B: { ... }, ... }
  res.json({ meta, distribution });
});

// GET /api/workspaces/:id/rfm/deals?grade=A&grade=F
// Returns: deals filtered by RFM grade

router.get('/api/workspaces/:id/rfm/deals', async (req, res) => {
  const grades = [].concat(req.query.grade || []);
  const deals = await getDealsByRFMGrade(db, req.params.id, grades);
  res.json(deals);
});
```

Register as a tool for Ask Pandora:

```typescript
{
  id: 'rfm-deal-priority',
  name: 'Deal Behavioral Scoring',
  description: 'Query deal behavioral scores based on engagement recency, activity frequency, and deal value. Returns prioritized deal lists with A-F grades. Use for questions about deal health, engagement patterns, which deals to focus on, and pipeline quality.',
  parameters: {
    grade: { type: 'string[]', enum: ['A', 'B', 'C', 'D', 'F'], optional: true },
    owner: { type: 'string', optional: true },
  },
  examples: [
    { query: 'Which deals should I focus on?', params: { grade: ['A', 'B'] } },
    { query: 'Which deals are going cold?', params: { grade: ['D', 'F'] } },
    { query: 'Show me big deals at risk', params: { grade: ['D'] } },
    { query: 'How healthy is our pipeline?', params: {} },
  ],
}
```

### LLM Summary for Ask Pandora Context

```typescript
export function summarizeRFMForLLM(
  distribution: Record<string, { count: number; totalValue: number }>,
  meta: RFMWorkspaceMeta
): string {
  const lines: string[] = [];

  lines.push(`Deal behavioral health (${meta.mode} mode, ${meta.dealCount} open deals):`);

  for (const grade of ['A', 'B', 'C', 'D', 'F']) {
    const d = distribution[grade];
    if (d && d.count > 0) {
      const winRate = meta.historicalWinRates?.[grade];
      const winInfo = winRate ? ` (historically ${Math.round(winRate.winRate * 100)}% win rate)` : '';
      lines.push(`  ${grade}: ${d.count} deals, $${(d.totalValue / 1000).toFixed(0)}K${winInfo}`);
    }
  }

  if (meta.coverage.caveats.length > 0) {
    lines.push(`  ⚠ ${meta.coverage.caveats[0]}`);
  }

  return lines.join('\n');
}
```

---

## Step 10: Graceful Degradation Summary

| Data Available | Mode | R Source | F Source | M Source | Grade Precision | Win Rate Backtest |
|---|---|---|---|---|---|---|
| Full CRM + activities + conversations | `full_rfm` | Activity dates | Weighted activity count | Deal amount | High (3 dimensions) | Yes (if 50+ closed deals) |
| CRM + some activities | `rm_only` | Activity dates | Skipped | Deal amount | Medium (2 dimensions) | Yes (R×M segments) |
| CRM only, no activities | `r_only` | Record updated_at | Skipped | Deal amount | Low (2 dimensions, R is proxy) | Limited (R is noisy) |
| CRM with < 10 open deals | Any | Same as above | Same | Same | Terciles, not quintiles | No (insufficient sample) |
| No amount data | Any | Same | Same | All M1 | Reduced (1-2 dimensions) | Limited |

**Key rule: never suppress the score entirely.** Even in `r_only` mode with 5 deals, the relative ranking (this deal was touched more recently than that one, and this one is bigger) is useful information. What changes is the confidence language in synthesis prompts and whether predictive statistics ("deals like this close at X%") are shown.

---

## Step 11: Test with Client Data

### Imubit (247 deals, Salesforce)
1. Run `assessActivityCoverage` — determine what mode Imubit lands in
2. Run full RFM computation — verify quintile breakpoints look reasonable
3. Spot-check: find a deal the team considers "hot" — is it graded A or B? Find a deal they consider dead — is it D or F?
4. Run backtest — verify win rates by grade show discrimination (A > B > C > D > F)
5. If discrimination test fails, investigate: maybe Imubit's pipeline doesn't have enough activity data for behavioral scoring to work

### Frontera (HubSpot)
1. Same as Imubit
2. HubSpot typically has better activity logging (native email tracking) — expect `full_rfm` or `rm_only` mode
3. Check that HubSpot activity types map correctly to engagement weights

### Sanity Checks
- Every open deal should have an RFM grade after computation
- Quintile distribution should be roughly equal (that's how quintiles work — 20% per bucket)
- Grade distribution should NOT be equal (grades use threshold logic, not percentiles)
- `rfm_scored_at` should be recent (within last sync cycle)
- Backtest win rates should be monotonically decreasing A → F (if not, the model has a problem)

---

## Token Budget Impact

**Zero.** RFM is pure SQL and arithmetic. No LLM calls.

The only token change is ~100-200 additional tokens in skill synthesis prompts where RFM context is injected (Pipeline Hygiene, Forecast Rollup, Pipeline Coverage). Negligible.

| Component | Tokens | Cost |
|---|---|---|
| RFM computation | 0 (SQL) | $0.00 |
| Backtest computation | 0 (SQL) | $0.00 |
| Synthesis prompt additions | ~150 per skill | ~$0.002 per skill run |
| Ask Pandora summary | ~200 per query | ~$0.003 per query |

---

## File Summary

| File | Action | Description |
|---|---|---|
| `server/analysis/rfm-scoring.ts` | **CREATE** | RFM engine: coverage assessment, raw values, quintiles, grades, labels |
| `server/analysis/rfm-backtest.ts` | **CREATE** | Historical win rate computation, discrimination test, T-30 snapshot reconstruction |
| `server/analysis/rfm-rendering.ts` | **CREATE** | Three evidence layers: score card, comparison, methodology |
| `server/analysis/computed-fields.ts` | **MODIFY** | Add RFM computation to `refreshComputedFields()` |
| `server/analysis/survival-data.ts` | **MODIFY** | Add `'rfm_grade'` to `SurvivalSegment` type |
| `server/analysis/monte-carlo-engine.ts` | **MODIFY** | Add RFM grade multiplier to risk adjustments |
| Deals table migration | **CREATE** | Add `rfm_*` columns and indexes |
| Pipeline Hygiene skill | **MODIFY** | Add stale-by-grade breakdown to compute and synthesis |
| Forecast Rollup skill | **MODIFY** | Add behavioral quality of forecast categories to synthesis |
| Pipeline Coverage skill | **MODIFY** | Add quality-weighted coverage alongside raw coverage |
| `server/routes/workspace.ts` | **MODIFY** | Add `/rfm/summary` and `/rfm/deals` endpoints |
| Tool registry | **MODIFY** | Register `rfm-deal-priority` tool for Ask Pandora |

---

## What NOT to Build

- **Configurable weights on R, F, M dimensions.** The quintile approach is self-calibrating. Adding user-configurable weights creates a tuning surface nobody will use correctly. If the model needs adjustment, it should come from the discrimination test telling you which dimension isn't separating outcomes.
- **Real-time RFM (per-request recomputation).** RFM changes slowly — a deal doesn't go from A to F in an hour. Recomputing per sync cycle (daily or per-sync) is sufficient. Cache aggressively.
- **Account-level RFM.** Noted as a future extension in Step 6c. Don't build now — deal-level is the priority and accounts are a straightforward aggregation later.
- **RFM-specific Slack skill.** RFM is a dimension consumed by other skills, not a standalone briefing. Nobody wants a Monday message that says "here are your RFM scores." They want Pipeline Hygiene to tell them which stale deals are worth saving — that's where RFM shows up.
- **Custom quintile overrides.** Don't let users manually set breakpoints. The auto-calibration from their own data is the entire point. If they override, they break the self-calibrating property and the backtest win rates no longer apply.

---

**END OF RFM BEHAVIORAL SCORING BUILD PROMPT**
