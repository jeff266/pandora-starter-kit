# Tri-Signal Intelligence Addendum
## Surfacing ICP Fit × RFM Behavior × TTE Probability Across Pandora

**Parent specs:**
- `PANDORA_COMMAND_CENTER_SPEC.md` (Account Detail, Deal Dossier, headline metrics)
- `PANDORA_LEAD_SCORING_SKILL_SPECS.md` (ICP Discovery, Lead Scoring)
- `PANDORA_RFM_BEHAVIORAL_SCORING_BUILD_PROMPT.md` (RFM engine)
- `PANDORA_TTE_SURVIVAL_CURVE_BUILD_PROMPT.md` (survival curve engine)

**Affected surfaces:** Command Center (home, deal detail, account detail, pipeline chart), ICP Discovery skill, Lead Scoring skill, Forecast Rollup synthesis, Slack briefings, CRM sidebar widget

**Prerequisite:** RFM computed fields on deals table, survival curve engine operational, ICP profiles table populated (at least point-based scoring)

**Implementation:** Replit (UI components, dossier assembler updates) + Claude Code (ICP Discovery feature matrix expansion, synthesis prompt updates)

---

## Why This Matters

Pandora currently shows deal health through a patchwork of single-dimension signals scattered across different skills. Pipeline Hygiene flags stale deals. Lead Scoring reports ICP fit. Forecast Rollup applies static multipliers. Each skill sees one facet. No surface shows the complete picture: is this the right customer (ICP), are they actively engaged (RFM), and what does time say about their odds (TTE)?

These three signals are orthogonal — they answer different questions and they fail in different ways. A deal can have perfect ICP fit but zero engagement (attribute-rich, behaviorally dead). A deal can be red-hot engagement but terrible ICP fit (enthusiastic tire-kicker). A deal can have strong ICP and strong engagement but it's been open 200 days and the survival curve says it's past the point of no return. Any single signal alone is misleading. Together they form a triangle that catches what each dimension alone misses.

The goal of this addendum is to wire the triangle into every surface where deal or account health is shown, so the user never sees a one-dimensional picture again.

---

## Part 1: The Tri-Signal Data Shape

### 1a. Deal-Level Tri-Signal

Every open deal has all three signals available from different sources. The dossier assembler computes a unified shape:

```typescript
interface DealTriSignal {
  // Dimension 1: ICP Fit (who they are)
  icpFit: {
    score: number | null;          // 0-100 from lead_scores table
    grade: string | null;          // A-F
    method: 'point_based' | 'regression' | null;
    topFactors: string[];          // ["industry_match", "seniority_match", "company_size"]
    available: boolean;            // false if ICP Discovery hasn't run
  };

  // Dimension 2: RFM Behavior (what they're doing)
  rfm: {
    grade: string;                 // A-F from deals.rfm_grade
    label: string;                 // "Hot Opportunity", "Going Cold", etc.
    recencyDays: number;
    recencySource: string;         // 'activity' | 'conversation' | 'stage_change' | 'record_update'
    frequencyCount: number | null; // null if rm_only or r_only mode
    segment: string;               // "R5-F4-M3" or "R5-M3"
    mode: string;                  // 'full_rfm' | 'rm_only' | 'r_only'
    available: boolean;            // always true — RFM runs on every sync
  };

  // Dimension 3: TTE Probability (when / how likely)
  tte: {
    conditionalWinProb: number;    // 0-1 from survival curve
    confidence: { lower: number; upper: number };
    dealAgeDays: number;
    isExtrapolated: boolean;       // true if deal age exceeds observed data range
    medianTimeToWin: number | null;
    daysRemaining: number | null;  // median - dealAge, null if past median
    available: boolean;            // false if < 20 closed deals in workspace
  };

  // Composite priority (for ranking, not display)
  compositePriority: number;       // 0-100 weighted blend
  priorityRank: number;            // rank among all open deals in workspace

  // Data quality context
  signalsAvailable: number;        // 1, 2, or 3 — how many dimensions have real data
  caveats: string[];               // data quality notes for narrative synthesis
}
```

### 1b. Account-Level Tri-Signal

Accounts aggregate across their open deals:

```typescript
interface AccountTriSignal {
  // ICP Fit: from the account's ICP fit score (account_signals + icp_profiles)
  // or averaged from deal-level scores if account-level scoring hasn't run
  icpFit: {
    score: number | null;
    grade: string | null;
    available: boolean;
  };

  // RFM: aggregated from all open deals at the account
  rfm: {
    dealBreakdown: Record<string, number>;  // { A: 1, B: 2, D: 1 } — deals per grade
    bestGrade: string;                       // highest grade among open deals
    worstGrade: string;                      // lowest grade (the one losing momentum)
    overallLabel: string;                    // synthesized: "Mixed — 1 hot, 1 going cold"
    mostRecentTouchDays: number;             // lowest recency across all deals
    totalFrequency: number;                  // sum of weighted activities across all deals
    available: boolean;
  };

  // TTE: weighted blend across open deals
  tte: {
    totalExpectedValue: number;              // sum of deal amount × conditional probability
    totalRawPipeline: number;                // sum of deal amounts (unweighted)
    probabilityDiscount: number;             // 1 - (expectedValue / rawPipeline)
    bestDealProb: { dealName: string; prob: number };
    worstDealProb: { dealName: string; prob: number };
    available: boolean;
  };

  signalsAvailable: number;
  caveats: string[];
}
```

### 1c. Composite Priority Calculation

```typescript
function computeCompositePriority(tri: DealTriSignal): number {
  // Map grades to numeric for blending
  const gradeToScore: Record<string, number> = { A: 90, B: 70, C: 50, D: 30, F: 10 };

  // Weights shift based on what's available
  // If all three dimensions exist, balance them
  // If one is missing, redistribute its weight to the other two

  let icpWeight = 0.35;
  let rfmWeight = 0.35;
  let tteWeight = 0.30;

  if (!tri.icpFit.available) {
    icpWeight = 0;
    rfmWeight = 0.50;
    tteWeight = 0.50;
  }
  if (!tri.tte.available) {
    tteWeight = 0;
    icpWeight = tri.icpFit.available ? 0.50 : 0;
    rfmWeight = tri.icpFit.available ? 0.50 : 1.0;
  }

  const icpScore = tri.icpFit.score ?? 50;              // neutral if unavailable
  const rfmScore = gradeToScore[tri.rfm.grade] ?? 50;
  const tteScore = (tri.tte.conditionalWinProb ?? 0.25) * 100;

  return (icpScore * icpWeight) + (rfmScore * rfmWeight) + (tteScore * tteWeight);
}
```

**Store the three component scores separately, not just the composite.** The composite drives sort order. The components drive the explanation. "This deal ranks #3 because: strong ICP fit (82), active engagement (A grade), and 38% forward win probability" is only possible if all three inputs are preserved.

---

## Part 2: Command Center — Home Page Updates

### 2a. Headline Metrics Row

The current spec defines five headline metrics: total pipeline, weighted pipeline, coverage ratio, open findings, win rate. Add a sixth:

```
Pipeline Quality Distribution
  A: 12 deals ($3.8M) | B: 18 ($2.9M) | C: 8 ($1.1M) | D: 5 ($890K) | F: 3 ($210K)
```

This replaces the need to click through Pipeline Hygiene findings to understand overall pipeline health. One glance tells you: 30 of 46 deals are healthy (A+B), 8 need attention (C), 8 are at risk or dead (D+F). The dollar amounts next to each grade communicate the stakes.

Implementation: single SQL aggregate query on `deals.rfm_grade WHERE is_closed = false`, grouped by grade with `SUM(amount)` and `COUNT(*)`. No joins needed — the computed field is already on the deals table.

Trend indicator: compare this week's grade distribution to last week's. If A+B count dropped or D+F count grew, show a downward arrow. The trend tells you if pipeline quality is improving or decaying independently of pipeline size.

### 2b. Annotated Pipeline Chart

The existing spec annotates pipeline stage bars with skill findings ("3 deals stalled 21+ days"). Add a behavioral overlay:

Each stage bar gets a stacked color segment showing the RFM grade distribution of deals in that stage. Visually, this looks like a stacked bar where green (A+B), yellow (C), and red (D+F) segments show what percentage of each stage's pipeline is behaviorally healthy.

A stage with $5M in pipeline where $4M is green is in good shape. A stage with $5M where $3.5M is red has a problem that the raw dollar amount hides. This is the kind of insight that stacked-color bars communicate instantly without requiring any text.

The annotation flags extend to include tri-signal compound alerts:

```
"$1.2M in Negotiation is A-grade ICP fit but behaviorally cold (D/F)"
  → This is a different alert than "stale deal" because ICP fit tells you it's WORTH saving
  → Pipeline Hygiene alone would just say "stale" without the ICP context

"$800K in Proposal has < 10% forward probability — past typical close window"
  → TTE adds a dimension Pipeline Hygiene can't: deal isn't just stale, it's statistically dead
  → The survival curve knows this deal type closes in 60 days and it's at day 180
```

These compound annotations require the dossier assembler to have pre-computed the `DealTriSignal` for each deal in the pipeline snapshot.

### 2c. Pipeline Snapshot API Update

Extend the existing `GET /api/workspaces/:id/pipeline/snapshot` response:

```typescript
// Existing fields stay:
{
  by_stage: [{
    stage, count, amount, annotated_findings: [...]
  }],
  total_pipeline, weighted_pipeline, coverage_ratio, win_rate_90d,

  // NEW: tri-signal additions
  quality_distribution: {
    A: { count: number, amount: number },
    B: { count: number, amount: number },
    C: { count: number, amount: number },
    D: { count: number, amount: number },
    F: { count: number, amount: number },
  },
  quality_trend: {                               // vs prior period
    ab_count_change: number,                     // positive = improving
    df_count_change: number,                     // positive = deteriorating
    period: 'week' | 'month',
  },
  by_stage_quality: [{                           // per-stage quality breakdown
    stage: string,
    quality: Record<string, { count: number, amount: number }>,
  }],
  probability_weighted_pipeline: number,         // sum of amount × TTE conditional probability
  quality_weighted_pipeline: number,             // sum of amount for A+B deals only
  compound_alerts: [{                            // tri-signal alerts
    type: 'high_icp_going_cold' | 'past_close_window' | 'hot_but_wrong_icp' | 'all_signals_red',
    deal_ids: string[],
    total_amount: number,
    message: string,
  }],
}
```

---

## Part 3: Deal Detail Page Updates

### 3a. Deal Dossier — Tri-Signal Header

The current deal dossier header shows: name, amount, stage, close_date, owner, pipeline, days_in_stage, health_score, velocity_score, created_date, forecast_category.

Replace `health_score` and `velocity_score` (which are single-composite numbers with no explanatory power) with the tri-signal display. The header gains three compact indicators:

```
┌─────────────────────────────────────────────────────────────┐
│  Acme Corp Enterprise  │  $2.8M  │  Negotiation  │  Day 87 │
│                                                             │
│  ICP Fit: A (82)       │  Behavior: D (Going Cold)  │  Win Prob: 12%  │
│  ██████████░░  Strong   │  ██░░░░░░░░  34 days cold   │  ██░░░░░░░░  Past peak │
└─────────────────────────────────────────────────────────────┘
```

Each indicator is a mini progress bar with label. The visual contrast between a green ICP bar and a red RFM bar screams "worth saving but losing it" without reading any text.

Click any indicator to expand its evidence:
- ICP Fit → shows score breakdown (industry match ✓, seniority match ✓, company size ✓, missing champion ✗)
- Behavior → shows RFM score card (Layer 1 from RFM prompt: recency, frequency, monetary in plain language)
- Win Prob → shows where this deal sits on the survival curve (forward probability, time remaining, confidence interval)

### 3b. Dossier Assembler Update

Extend the `deal_dossier()` function to compute and include the tri-signal:

```typescript
// In server/dossier/deal-dossier.ts (or wherever deal_dossier lives)

async function deal_dossier(workspaceId: string, dealId: string): Promise<DealDossier> {
  // ... existing assembly: deal, stage_history, contacts, conversations, skill_findings, enrichment, coverage_gaps ...

  // NEW: Compute tri-signal
  const triSignal = await computeDealTriSignal(db, workspaceId, deal);

  return {
    ...existingDossier,
    triSignal,
  };
}

async function computeDealTriSignal(
  db: DatabaseClient,
  workspaceId: string,
  deal: Deal
): Promise<DealTriSignal> {
  // Dimension 1: ICP Fit — read from lead_scores table
  const leadScore = await db.query(`
    SELECT total_score, score_grade, scoring_method, score_breakdown
    FROM lead_scores
    WHERE workspace_id = $1 AND entity_type = 'deal' AND entity_id = $2
    ORDER BY scored_at DESC LIMIT 1
  `, [workspaceId, deal.id]);

  const icpFit = leadScore.rows.length > 0
    ? {
        score: leadScore.rows[0].total_score,
        grade: leadScore.rows[0].score_grade,
        method: leadScore.rows[0].scoring_method,
        topFactors: extractTopFactors(leadScore.rows[0].score_breakdown),
        available: true,
      }
    : { score: null, grade: null, method: null, topFactors: [], available: false };

  // Dimension 2: RFM — already on the deals table as computed fields
  const rfm = {
    grade: deal.rfm_grade ?? 'C',
    label: deal.rfm_label ?? 'Not Scored',
    recencyDays: deal.rfm_recency_days ?? 0,
    recencySource: deal.rfm_recency_source ?? 'record_update',
    frequencyCount: deal.rfm_frequency_count,
    segment: deal.rfm_segment ?? 'unknown',
    mode: deal.rfm_mode ?? 'r_only',
    available: deal.rfm_grade !== null,
  };

  // Dimension 3: TTE — compute from survival curve
  let tte: DealTriSignal['tte'];
  try {
    const { overall: curve } = await buildSurvivalCurves(db, {
      workspaceId,
      lookbackMonths: 24,
    });

    if (curve.isReliable) {
      const dealAgeDays = daysBetween(deal.created_at, new Date());
      const { probability, confidence, isExtrapolated } = conditionalWinProbability(curve, dealAgeDays);

      tte = {
        conditionalWinProb: probability,
        confidence,
        dealAgeDays,
        isExtrapolated,
        medianTimeToWin: curve.medianTimeTilWon,
        daysRemaining: curve.medianTimeTilWon ? Math.max(0, curve.medianTimeTilWon - dealAgeDays) : null,
        available: true,
      };
    } else {
      tte = { conditionalWinProb: 0, confidence: { lower: 0, upper: 0 }, dealAgeDays: 0, isExtrapolated: true, medianTimeToWin: null, daysRemaining: null, available: false };
    }
  } catch {
    tte = { conditionalWinProb: 0, confidence: { lower: 0, upper: 0 }, dealAgeDays: 0, isExtrapolated: true, medianTimeToWin: null, daysRemaining: null, available: false };
  }

  const signalsAvailable = [icpFit.available, rfm.available, tte.available].filter(Boolean).length;

  const caveats: string[] = [];
  if (!icpFit.available) caveats.push('ICP scoring not yet configured for this workspace.');
  if (rfm.mode === 'r_only') caveats.push('Limited activity data — behavioral scoring uses CRM record changes as a proxy.');
  if (!tte.available) caveats.push('Insufficient closed deal history for probability modeling.');
  if (tte.isExtrapolated) caveats.push('Deal age exceeds historical data range — probability is extrapolated.');

  const triSignal: DealTriSignal = {
    icpFit,
    rfm,
    tte,
    compositePriority: 0,
    priorityRank: 0,
    signalsAvailable,
    caveats,
  };

  triSignal.compositePriority = computeCompositePriority(triSignal);

  return triSignal;
}
```

**Performance note:** The survival curve computation should be cached (6-hour TTL per the TTE spec). The dossier assembler reads the cached curve, not recomputes it. `conditionalWinProbability()` is a O(n) walk of the step function — microseconds per deal.

### 3c. Narrative Synthesis Update

The current narrative synthesis prompt produces 2-3 sentences from the dossier data. Extend the context block with tri-signal data:

```
// ADD to the Claude synthesis prompt for deal dossier narrative:

DEAL INTELLIGENCE SIGNALS:
{{#if triSignal.icpFit.available}}
- ICP Fit: Grade {{triSignal.icpFit.grade}} ({{triSignal.icpFit.score}}/100)
  Top factors: {{triSignal.icpFit.topFactors}}
{{else}}
- ICP Fit: Not yet scored
{{/if}}

- Behavioral Health: Grade {{triSignal.rfm.grade}} ({{triSignal.rfm.label}})
  Last touch: {{triSignal.rfm.recencyDays}} days ago (source: {{triSignal.rfm.recencySource}})
  {{#if triSignal.rfm.frequencyCount}}Activity: {{triSignal.rfm.frequencyCount}} touchpoints in last 30 days{{/if}}

{{#if triSignal.tte.available}}
- Forward Win Probability: {{triSignal.tte.conditionalWinProb | percent}}
  ({{triSignal.tte.confidence.lower | percent}} — {{triSignal.tte.confidence.upper | percent}} range)
  Deal age: {{triSignal.tte.dealAgeDays}} days. Median time to win: {{triSignal.tte.medianTimeToWin}} days.
  {{#if triSignal.tte.daysRemaining}}Estimated {{triSignal.tte.daysRemaining}} days remaining before probability flatlines.{{/if}}
  {{#if triSignal.tte.isExtrapolated}}⚠ Deal is older than typical close window — probability is extrapolated.{{/if}}
{{else}}
- Win Probability: Insufficient history to model
{{/if}}

SIGNAL CONFLICTS TO ADDRESS IN NARRATIVE:
{{#if (and triSignal.icpFit.available (gte triSignal.icpFit.score 70) (lte triSignal.rfm.recencyQuintile 2))}}
- ⚠ HIGH ICP FIT + LOW ENGAGEMENT: This looks like the right customer but the deal is going cold. Emphasize re-engagement urgency.
{{/if}}
{{#if (and (gte triSignal.rfm.recencyQuintile 4) triSignal.icpFit.available (lte triSignal.icpFit.score 40))}}
- ⚠ HIGH ENGAGEMENT + LOW ICP FIT: Active deal but poor profile match. Flag whether effort is well-allocated.
{{/if}}
{{#if (and triSignal.tte.available (lte triSignal.tte.conditionalWinProb 0.10) (not (eq triSignal.rfm.grade "F")))}}
- ⚠ LOW PROBABILITY + NOT BEHAVIORALLY DEAD: Deal is statistically unlikely to close but still showing some activity. This may be a "zombie deal" — consuming rep time without realistic close potential.
{{/if}}

Write a 2-3 sentence narrative that synthesizes all available signals. Lead with the most
important conflict or insight. Use the specific numbers. Do not repeat what the user can
already see in the header — add interpretation.
```

**Example output with all three signals:**

> "Acme Corp is a strong ICP match (A grade) but this deal is losing momentum — no touchpoint in 34 days and activity has dropped to 2 interactions this month, down from 8 last month. At 87 days old, the survival curve gives it a 12% forward probability, below the 28% you'd expect at this stage. This is a deal worth saving, but the window is closing — your median close time is 72 days and you're past it."

**Example output with ICP missing:**

> "This $2.8M deal has gone behaviorally cold (D grade) — last touch was 34 days ago. The survival curve gives it a 12% forward win probability at day 87, well below typical close timing. ICP scoring isn't configured yet, so we can't assess whether this account fits your winning profile. If it does, re-engagement this week is critical."

### 3d. Tri-Signal Evidence Drill-Through

Clicking the TTE probability indicator in the deal header opens an evidence panel showing:

```
Forward Win Probability: 12%

┌─ Survival Curve ──────────────────────────────────┐
│                                                    │
│  50% ┤          ╭───────                           │
│      │       ╭──╯       ╲                          │
│  25% ┤    ╭──╯            ╲─────                   │
│      │  ╭─╯                     ╲───── terminal    │
│   0% ┤──╯         ▲                                │
│      └──┬──┬──┬──┬──┬──┬──┬──┬──┬──               │
│         0  30 60 90 120 150 180 210                 │
│                    │                                │
│              This deal (day 87)                     │
└────────────────────────────────────────────────────┘

Your deals typically win within 72 days (median).
This deal is at day 87 — past the median, but 23% of your wins
happen between day 72 and day 150.

Curve based on 247 closed deals from the last 24 months.
```

This is a lightweight SVG or Recharts chart rendered in the drill-through panel. The "you are here" marker on the curve is the key UX element — the user sees exactly where this deal sits on the probability curve and intuitively understands whether time is on their side.

For ICP and RFM drill-throughs, use the evidence layers already defined in the RFM build prompt (score card for RFM, score breakdown for ICP). No new rendering needed — just wire the existing Layer 1 renderers into the dossier panel.

---

## Part 4: Account Detail Page Updates

### 4a. Account Header — Tri-Signal Summary

The current account header shows: name, domain, industry, employee_count, owner. Below that, deals table, contact map, conversation timeline, findings panel.

Add a tri-signal summary strip between the header and the deals table:

```
┌──────────────────────────────────────────────────────────────────┐
│  ICP Fit: B (68)          │  Behavior: Mixed         │  Expected Value     │
│  Good industry match,     │  1 Hot, 1 Going Cold,    │  $1.4M of $3.5M     │
│  missing decision maker   │  1 Likely Dead           │  (40% probability    │
│                           │                          │   weighted)          │
└──────────────────────────────────────────────────────────────────┘
```

The "Mixed" behavioral label is synthesized from the deal-level RFM grades. The expected value shows probability-weighted pipeline vs. raw pipeline — the gap between $3.5M and $1.4M tells the user immediately that this account's pipeline is more hope than reality.

### 4b. Account Dossier Assembler Update

Extend the `account_dossier()` function:

```typescript
async function account_dossier(workspaceId: string, accountId: string): Promise<AccountDossier> {
  // ... existing assembly: account, deals, contacts, conversations, skill_findings, enrichment, relationship_health ...

  // NEW: Compute account-level tri-signal
  const dealTriSignals = await Promise.all(
    openDeals.map(deal => computeDealTriSignal(db, workspaceId, deal))
  );

  const accountTriSignal = aggregateToAccountLevel(account, openDeals, dealTriSignals);

  return {
    ...existingDossier,
    dealTriSignals,         // per-deal tri-signals (for the deals table)
    accountTriSignal,       // aggregated account-level (for the header)
  };
}

function aggregateToAccountLevel(
  account: Account,
  deals: Deal[],
  dealSignals: DealTriSignal[]
): AccountTriSignal {
  // ICP Fit: use account-level score if available, else average deal scores
  const dealIcpScores = dealSignals
    .filter(d => d.icpFit.available && d.icpFit.score !== null)
    .map(d => d.icpFit.score!);
  
  // RFM: breakdown by grade
  const dealBreakdown: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const sig of dealSignals) {
    if (sig.rfm.grade && dealBreakdown[sig.rfm.grade] !== undefined) {
      dealBreakdown[sig.rfm.grade]++;
    }
  }
  const grades = dealSignals.map(d => d.rfm.grade).filter(Boolean);
  const gradeOrder = ['A', 'B', 'C', 'D', 'F'];
  const bestGrade = gradeOrder.find(g => grades.includes(g)) ?? 'F';
  const worstGrade = [...gradeOrder].reverse().find(g => grades.includes(g)) ?? 'A';

  // Synthesize label
  const hotCount = (dealBreakdown.A || 0) + (dealBreakdown.B || 0);
  const coldCount = (dealBreakdown.D || 0) + (dealBreakdown.F || 0);
  const middleCount = dealBreakdown.C || 0;

  let overallLabel: string;
  if (coldCount === 0 && hotCount > 0) overallLabel = 'Fully Engaged';
  else if (hotCount === 0 && coldCount > 0) overallLabel = 'Going Dark';
  else if (hotCount > 0 && coldCount > 0) overallLabel = `Mixed — ${hotCount} active, ${coldCount} cold`;
  else overallLabel = 'Neutral';

  // TTE: expected value aggregation
  const totalExpectedValue = dealSignals.reduce((sum, d) => {
    if (!d.tte.available) return sum + (deals.find(deal => true)?.amount ?? 0) * 0.25; // conservative default
    return sum + (deals.find(deal => true)?.amount ?? 0) * d.tte.conditionalWinProb;
  }, 0);
  const totalRawPipeline = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  return {
    icpFit: {
      score: dealIcpScores.length > 0 ? dealIcpScores.reduce((a, b) => a + b, 0) / dealIcpScores.length : null,
      grade: null, // computed from score
      available: dealIcpScores.length > 0,
    },
    rfm: {
      dealBreakdown,
      bestGrade,
      worstGrade,
      overallLabel,
      mostRecentTouchDays: Math.min(...dealSignals.map(d => d.rfm.recencyDays)),
      totalFrequency: dealSignals.reduce((sum, d) => sum + (d.rfm.frequencyCount ?? 0), 0),
      available: true,
    },
    tte: {
      totalExpectedValue,
      totalRawPipeline,
      probabilityDiscount: totalRawPipeline > 0 ? 1 - (totalExpectedValue / totalRawPipeline) : 0,
      bestDealProb: findBestDealProb(deals, dealSignals),
      worstDealProb: findWorstDealProb(deals, dealSignals),
      available: dealSignals.some(d => d.tte.available),
    },
    signalsAvailable: [
      dealSignals.some(d => d.icpFit.available),
      true, // RFM always available
      dealSignals.some(d => d.tte.available),
    ].filter(Boolean).length,
    caveats: deduplicateCaveats(dealSignals.flatMap(d => d.caveats)),
  };
}
```

### 4c. Deals Table Enhancement

The existing deals table in the account detail page shows: stage, amount, health score, days in stage. Replace the single `health_score` column with the three tri-signal indicators as compact inline badges:

```
| Deal Name            | Stage       | Amount  | ICP | Behavior | Prob  | Days |
|----------------------|-------------|---------|-----|----------|-------|------|
| Enterprise Platform  | Negotiation | $2.8M   |  A  |    D     |  12%  |  87  |
| Mid-Market Module    | Proposal    | $900K   |  B  |    A     |  38%  |  34  |
| Add-On License       | Discovery   | $500K   |  —  |    F     |  22%  |  62  |
```

Each letter grade is color-coded (A/B = green, C = yellow, D/F = red). The "—" indicates ICP scoring not available for that deal. The probability column shows the TTE conditional probability, color-coded by magnitude.

Sorting by any tri-signal column is supported. The default sort is by `compositePriority` descending — the deal most worth the user's attention appears first.

### 4d. Contact Map — Engagement Gradient

The current contact map shows contacts grouped by role/seniority with a binary "called/dark" indicator. Replace the binary indicator with a recency gradient that uses the same color scale as RFM:

```
Champion: Lisa Chen (VP Engineering)
  ████████████ Last call: 3 days ago — 6 touchpoints this month

Economic Buyer: James Park (CFO)
  ██░░░░░░░░░░ Last call: 47 days ago — 0 touchpoints this month

Evaluator: Sarah Kim (Sr. Engineer)
  █████░░░░░░░ Last email: 12 days ago — 2 touchpoints this month
```

The gradient bar fills based on recency relative to the workspace's own recency quintile breakpoints (from the RFM engine). This is not a separate computation — it reads the same breakpoints stored in `RFMWorkspaceMeta`.

For contacts without direct deal-level engagement data, the system falls back to the last activity date from the contacts table or the most recent conversation where that contact appeared as a participant.

### 4e. Account Narrative Synthesis Update

Extend the account narrative synthesis prompt with tri-signal context:

```
ACCOUNT INTELLIGENCE SIGNALS:
- ICP Fit: {{accountTriSignal.icpFit.grade}} ({{accountTriSignal.icpFit.score}}/100)
- Behavioral Health: {{accountTriSignal.rfm.overallLabel}}
  Deal breakdown: {{formatDealBreakdown(accountTriSignal.rfm.dealBreakdown)}}
  Most recent touch across all deals: {{accountTriSignal.rfm.mostRecentTouchDays}} days ago
- Expected Value: ${{accountTriSignal.tte.totalExpectedValue}} of ${{accountTriSignal.tte.totalRawPipeline}} raw pipeline
  ({{accountTriSignal.tte.probabilityDiscount | percent}} probability discount)

DEAL-LEVEL DETAIL:
{{#each dealTriSignals}}
- {{dealName}}: ICP {{icpFit.grade ?? '—'}} | Behavior {{rfm.grade}} ({{rfm.label}}) | {{tte.conditionalWinProb | percent}} forward probability at day {{tte.dealAgeDays}}
{{/each}}

SIGNAL CONFLICTS:
{{#if mixedBehavior}}
- Account has both active and cold deals — narrative should address which deals to prioritize
{{/if}}
{{#if highIcpLowEngagement}}
- Strong ICP fit but engagement is declining — flag relationship risk
{{/if}}

Synthesize a 3-4 sentence account narrative. Lead with the most important insight.
Address the health of each deal separately if they differ. Conclude with a recommended action.
```

---

## Part 5: ICP Discovery — Behavioral Feature Matrix Expansion

### 5a. New Feature Columns

Add RFM behavioral features to the ICP Discovery feature matrix. These are computed using the T-30 snapshot method from the RFM build prompt (what did the deal's behavioral state look like 30 days before resolution):

```typescript
// Add to the feature matrix builder (Step 2 of ICP Discovery)

interface BehavioralFeatures {
  // RFM values at T-30 (30 days before close)
  rfm_recency_at_close: number;       // days since last activity at T-30
  rfm_frequency_at_close: number;     // weighted activity count at T-30
  rfm_grade_at_close: string;         // A-F grade at T-30
  rfm_monetary_quintile: number;      // deal size quintile (static, doesn't change pre-close)

  // Activity pattern features
  activity_trajectory: 'accelerating' | 'stable' | 'decelerating' | 'dormant';
  peak_frequency_month: number;       // which month of the deal lifecycle had most activity
  frequency_consistency: number;      // coefficient of variation of monthly activity counts (lower = more consistent)

  // Engagement timing features
  days_to_first_meeting: number | null;   // days from deal creation to first meeting
  days_to_first_call: number | null;
  total_unique_activity_days: number;     // distinct days with any activity (engagement breadth)

  // Cross-reference features
  has_behavioral_data: boolean;           // true if any of the above are non-null
}
```

**SQL for T-30 behavioral snapshot:**

```sql
-- For each closed deal, compute behavioral state at T-30
WITH deal_activity_at_snapshot AS (
  SELECT
    d.id AS deal_id,
    d.is_closed_won,
    d.amount,
    d.closed_at,
    -- Recency at T-30
    EXTRACT(EPOCH FROM (
      (d.closed_at - INTERVAL '30 days') -
      COALESCE(
        (SELECT MAX(a.activity_date) FROM activities a
         WHERE a.deal_id = d.id
         AND a.activity_date < d.closed_at - INTERVAL '30 days'),
        d.created_at
      )
    )) / 86400 AS recency_days,
    -- Frequency at T-30 (activities in 30 days before snapshot)
    (SELECT COALESCE(SUM(
      CASE a.type
        WHEN 'meeting' THEN 10
        WHEN 'call' THEN 5
        WHEN 'email' THEN 2
        ELSE 1
      END
    ), 0)
    FROM activities a
    WHERE a.deal_id = d.id
      AND a.activity_date BETWEEN (d.closed_at - INTERVAL '60 days') AND (d.closed_at - INTERVAL '30 days')
    ) AS frequency_count,
    -- Activity trajectory: compare last 30 days before snapshot to 30 days before that
    (SELECT COALESCE(COUNT(*), 0)
     FROM activities a
     WHERE a.deal_id = d.id
       AND a.activity_date BETWEEN (d.closed_at - INTERVAL '60 days') AND (d.closed_at - INTERVAL '30 days')
    ) AS recent_activity_count,
    (SELECT COALESCE(COUNT(*), 0)
     FROM activities a
     WHERE a.deal_id = d.id
       AND a.activity_date BETWEEN (d.closed_at - INTERVAL '90 days') AND (d.closed_at - INTERVAL '60 days')
    ) AS prior_activity_count,
    -- Days to first meeting
    (SELECT MIN(EXTRACT(EPOCH FROM (a.activity_date - d.created_at)) / 86400)
     FROM activities a
     WHERE a.deal_id = d.id AND a.type = 'meeting'
    ) AS days_to_first_meeting,
    -- Unique activity days
    (SELECT COUNT(DISTINCT DATE(a.activity_date))
     FROM activities a
     WHERE a.deal_id = d.id
       AND a.activity_date < d.closed_at - INTERVAL '30 days'
    ) AS unique_activity_days
  FROM deals d
  WHERE d.workspace_id = $1
    AND d.is_closed = true
    AND d.closed_at > NOW() - INTERVAL '24 months'
)
SELECT *,
  CASE
    WHEN recent_activity_count > prior_activity_count * 1.3 THEN 'accelerating'
    WHEN recent_activity_count < prior_activity_count * 0.7 THEN 'decelerating'
    WHEN recent_activity_count = 0 AND prior_activity_count = 0 THEN 'dormant'
    ELSE 'stable'
  END AS activity_trajectory
FROM deal_activity_at_snapshot
```

### 5b. Graceful Degradation in Feature Matrix

Apply the same coverage tier logic from the RFM engine. If activity coverage for closed deals is below 30%, exclude behavioral features from the regression model (they'd be mostly NULLs and would pollute the coefficients). Still include them in the descriptive output for deals that DO have data.

```typescript
// In ICP Discovery Step 2 (feature matrix builder):
const closedDealActivityCoverage = dealsWithActivityData / totalClosedDeals;

if (closedDealActivityCoverage < 0.30) {
  // Skip behavioral features in regression
  // Include in descriptive output with caveat
  behavioralFeatureStatus = 'excluded_from_model';
} else if (closedDealActivityCoverage < 0.70) {
  // Include with regularization penalty
  behavioralFeatureStatus = 'included_with_penalty';
} else {
  // Full inclusion
  behavioralFeatureStatus = 'full';
}
```

### 5c. New ICP Discovery Output Section: "Winning Behaviors"

Add a new section to the ICP Discovery Claude synthesis prompt:

```
{{#if behavioralFeatures.available}}

BEHAVIORAL PATTERNS IN WON VS LOST DEALS:

Activity levels:
- Won deals: avg {{wonAvgFrequency}} weighted touchpoints/month ({{wonAvgUniqueActivityDays}} distinct days)
- Lost deals: avg {{lostAvgFrequency}} weighted touchpoints/month ({{lostAvgUniqueActivityDays}} distinct days)
- Lift: {{frequencyLift}}x (deals with above-median activity win at {{highActivityWinRate}}% vs {{lowActivityWinRate}}%)

Engagement timing:
- Won deals had first meeting within {{wonAvgDaysToFirstMeeting}} days (median)
- Lost deals had first meeting within {{lostAvgDaysToFirstMeeting}} days (or never: {{lostNoMeetingPercent}}%)

Activity trajectory at T-30 (30 days before resolution):
- Won deals: {{wonAccelerating}}% accelerating, {{wonStable}}% stable, {{wonDecelerating}}% decelerating
- Lost deals: {{lostAccelerating}}% accelerating, {{lostStable}}% stable, {{lostDecelerating}}% decelerating, {{lostDormant}}% dormant

RFM grade distribution at T-30:
- Won deals: A={{wonGradeA}}%, B={{wonGradeB}}%, C={{wonGradeC}}%, D={{wonGradeD}}%, F={{wonGradeF}}%
- Lost deals: A={{lostGradeA}}%, B={{lostGradeB}}%, C={{lostGradeC}}%, D={{lostGradeD}}%, F={{lostGradeF}}%
- Discrimination: A-grade deals won at {{aGradeWinRate}}%, F-grade at {{fGradeWinRate}}%

{{#if regressionModelIncludesBehavior}}
Model feature importance (behavioral):
{{#each behavioralFeatureImportance}}
- {{feature}}: coefficient {{coefficient}}, importance rank {{rank}} of {{totalFeatures}}
{{/each}}
{{/if}}

Write a "Winning Behaviors" section that describes:
1. The engagement cadence that correlates with winning (how often, how broadly)
2. Critical timing milestones (when must first meeting happen?)
3. The behavioral warning signs that precede losses (trajectory patterns)
4. Whether behavioral engagement or ICP fit is more predictive for this workspace
Keep it specific to this workspace's data. 3-5 bullet points.

{{#if behavioralFeatures.caveat}}
⚠ {{behavioralFeatures.caveat}}
{{/if}}

{{/if}}
```

### 5d. ICP Profile Schema Extension

Add behavioral patterns to the `icp_profiles` table output:

```typescript
// Extend the icp_profiles.company_profile JSONB to include:
{
  // ... existing fields (industries, size_ranges, signals_correlated) ...

  behavioral_profile: {
    optimal_cadence: {
      touchpoints_per_month: number,
      unique_activity_days_per_month: number,
      meeting_frequency: string,         // "weekly", "biweekly", "monthly"
    },
    critical_milestones: {
      first_meeting_by_day: number,      // days from creation
      champion_identified_by_day: number | null,
    },
    warning_patterns: {
      frequency_drop_threshold: number,  // below this monthly count = risk
      max_gap_days: number,              // gap longer than this = risk
      trajectory_decline_weeks: number,  // consecutive weeks of declining activity = risk
    },
    model_contribution: {
      behavioral_features_included: boolean,
      behavioral_feature_importance_rank: number | null, // where do behavioral features rank among all features
      rfm_discrimination_spread: number | null,          // win rate spread between A and F grades
    },
    data_coverage: number,              // % of closed deals with behavioral data
  } | null,
}
```

### 5e. Lead Scoring Cascade

When ICP Discovery produces a `behavioral_profile`, Lead Scoring automatically picks up behavioral weights in its next run through the existing weight inheritance mechanism. For real-time scoring of open deals:

```typescript
// In lead scoring Step 2 (Build Contact Feature Vectors), add deal-level behavioral features:

// Behavioral fit score (how well does this deal's current behavior match the winning pattern?)
const behavioralFit = computeBehavioralFit(deal, icpProfile.behavioral_profile);

function computeBehavioralFit(deal: Deal, profile: BehavioralProfile | null): number {
  if (!profile) return 50; // neutral if no behavioral profile exists

  let score = 50; // start neutral

  // Cadence fit: is the deal's current activity level close to the optimal?
  const currentFrequency = deal.rfm_frequency_count ?? 0;
  const optimalFrequency = profile.optimal_cadence.touchpoints_per_month;
  if (currentFrequency >= optimalFrequency * 0.8) score += 15;
  else if (currentFrequency >= optimalFrequency * 0.5) score += 5;
  else if (currentFrequency < optimalFrequency * 0.3) score -= 15;

  // Milestone fit: did the deal hit critical milestones on time?
  if (profile.critical_milestones.first_meeting_by_day) {
    // check if first meeting happened within the milestone window
    // requires a query to activities table
  }

  // Warning pattern detection
  if (deal.rfm_recency_days > (profile.warning_patterns.max_gap_days ?? 30)) score -= 20;

  return Math.max(0, Math.min(100, score));
}
```

This behavioral fit score joins the existing ICP fit score and RFM grade as the third vertex of the triangle in the lead_scores output.

---

## Part 6: Slack Briefing Updates

### 6a. Pipeline Hygiene Slack Output

The current Pipeline Hygiene Slack message lists stale deals. With tri-signal context, restructure the stale deal list by urgency:

```
🔴 *Save These Now* (high ICP, going cold):
• Acme Enterprise ($2.8M, Negotiation) — ICP: A, 34 days cold, 12% forward probability
• Globex Platform ($1.5M, Proposal) — ICP: A, 28 days cold, 18% forward probability

⚪ *Clean These Up* (low ICP or dead probability):
• SmallCo Add-On ($50K, Discovery) — 62 days cold, 3% forward probability
• TestOrg Trial ($25K, Qualification) — ICP: D, 45 days cold, 5% forward probability

📊 *Pipeline Quality This Week:*
A/B deals: 30 ($6.7M) | C: 8 ($1.1M) | D/F: 8 ($1.1M)
vs last week: A/B +2 deals, D/F -1 deal
```

The "Save These Now" vs "Clean These Up" distinction is only possible because of the ICP × RFM × TTE triangle. Without ICP fit, you don't know which stale deals are worth saving. Without TTE, you don't know which ones are past the point of no return.

### 6b. Forecast Rollup Slack Output

Add a behavioral quality section:

```
📊 *Forecast Quality Check:*
Commit pipeline ($2.0M): $1.4M behaviorally active (A/B), $600K cold (D/F)
Best Case pipeline ($1.5M): $900K active, $600K cold
⚠ 30% of committed pipeline is behaviorally cold — these deals may slip.
Probability-weighted total: $1.8M (vs $3.5M raw pipeline)
```

---

## Part 7: CRM Sidebar Widget

The existing spec mentions a CRM sidebar widget showing "ICP score, active findings, risk flags (read-only)." Extend to show the tri-signal as three compact indicators:

```
┌──────────────────────┐
│  PANDORA INTELLIGENCE │
│                       │
│  ICP Fit     A  (82)  │
│  Behavior    D  Cold  │
│  Win Prob    12%  ▼   │
│                       │
│  ⚠ High ICP, going   │
│    cold — re-engage   │
│                       │
│  3 open findings      │
│  View in Pandora →    │
└──────────────────────┘
```

This widget reads from the dossier API. It does NOT recompute anything — it's a read-only rendering of pre-computed data. The arrow on "12% ▼" indicates the probability is declining (current probability < probability at last skill run).

---

## Part 8: Graceful Degradation Matrix

Different workspaces will have different signal availability. The UI must adapt without showing broken or empty sections.

| Signals Available | Account Header | Deal Header | Narrative | Pipeline Chart |
|---|---|---|---|---|
| All 3 (ICP + RFM + TTE) | Full tri-signal strip | Three indicators | Full synthesis with conflicts | Stacked quality bars + probability annotations |
| RFM + TTE (no ICP) | Two-signal strip, "ICP not configured" link | Two indicators, ICP shows "—" | Behavioral + probability focus, suggests enabling ICP | Quality bars, no ICP annotations |
| RFM only (no ICP, no TTE) | RFM grade only | RFM grade + label | Behavioral assessment only | Quality bars only |
| ICP + RFM (no TTE, < 20 closed deals) | Two-signal strip | Two indicators, probability shows "insufficient data" | Attribute + behavior focus | Quality bars, no probability weighting |
| Nothing configured yet | "Enable data connectors to see intelligence" | Basic deal info only | No narrative (or generic) | Standard pipeline bars |

**Key rule:** Never show an empty indicator. If a dimension isn't available, either hide it entirely or show a clear "not configured" state with a link to enable it. Never show "0%" or "F" for a missing signal — that implies bad data when there's actually no data.

```typescript
// In the UI component:
function TriSignalIndicator({ triSignal }: { triSignal: DealTriSignal }) {
  return (
    <div className="flex gap-4">
      {triSignal.icpFit.available && (
        <SignalBadge label="ICP Fit" grade={triSignal.icpFit.grade} score={triSignal.icpFit.score} />
      )}
      {triSignal.rfm.available && (
        <SignalBadge label="Behavior" grade={triSignal.rfm.grade} sublabel={triSignal.rfm.label} />
      )}
      {triSignal.tte.available && (
        <ProbabilityBadge label="Win Prob" probability={triSignal.tte.conditionalWinProb} isExtrapolated={triSignal.tte.isExtrapolated} />
      )}
      {triSignal.signalsAvailable === 0 && (
        <EmptyState message="Connect data sources to see deal intelligence" />
      )}
    </div>
  );
}
```

---

## Part 9: Survival Curve Visualization Component

### 9a. Shared Chart Component

Build a reusable survival curve chart component used in both deal detail drill-through and the Ask Pandora response:

```typescript
// React component for rendering a KM survival curve with "you are here" marker

interface SurvivalCurveChartProps {
  steps: SurvivalStep[];                // from the survival curve engine
  dealAgeDays?: number;                 // "you are here" marker position
  dealLabel?: string;                   // e.g., "Acme Corp (Day 87)"
  medianTimeTilWon?: number;            // vertical reference line
  showConfidenceBand?: boolean;         // shade the CI area
  segmentCurves?: Map<string, SurvivalStep[]>;  // overlay comparisons
  height?: number;                      // chart height in px
}
```

**Chart elements:**
- X-axis: days since deal creation (0 to max observed)
- Y-axis: cumulative win rate (0% to terminal rate, not 100% — most B2B win rates top out at 30-50%)
- Step function line: the KM curve (step-wise, not smoothed — smoothing implies precision that doesn't exist)
- Confidence band: shaded area between ciLower and ciUpper (light fill, no stroke)
- "You are here" marker: vertical dotted line at dealAgeDays with a dot on the curve and the conditional probability labeled
- Median marker: if medianTimeTilWon exists, a vertical reference line with label
- Segment overlays: when comparing (e.g., "your deals" vs "inbound deals"), show multiple curves in different colors

Use Recharts `<AreaChart>` with `<ReferenceLine>` for markers. The step function rendering requires setting the `type` prop to `"stepAfter"` on the `<Area>` component.

### 9b. Mini Sparkline Variant

For the deal header and account overview, a full chart is too large. Build a mini sparkline variant (120×32px) that shows just the curve shape with the "you are here" dot:

```typescript
interface SurvivalSparklineProps {
  steps: SurvivalStep[];
  dealAgeDays: number;
  conditionalProb: number;
}
```

No axes, no labels, no confidence band. Just the line and the dot. The user sees at a glance whether the deal is on the rising part of the curve (good — probability is still increasing) or the flat tail (bad — probability has plateaued or is declining). Color the dot green/yellow/red based on the conditional probability value.

---

## Part 10: Token Budget Impact

The tri-signal itself is pure compute — zero LLM tokens. The impact is entirely in synthesis prompts that now receive additional context:

| Surface | Additional Tokens | Cost Impact |
|---|---|---|
| Deal dossier narrative | +200 tokens (tri-signal context + conflict detection) | +$0.003 per view |
| Account dossier narrative | +300 tokens (account-level aggregation + per-deal signals) | +$0.005 per view |
| ICP Discovery "Winning Behaviors" | +500 tokens (behavioral pattern tables + synthesis) | +$0.007 per monthly run |
| Pipeline Hygiene synthesis | +100 tokens (save-vs-cleanup prioritization) | +$0.002 per weekly run |
| Forecast Rollup synthesis | +100 tokens (behavioral quality check) | +$0.002 per weekly run |
| Pipeline snapshot API | 0 (pure SQL aggregation) | $0.00 |
| CRM sidebar widget | 0 (reads pre-computed data) | $0.00 |

**Monthly total additional cost per workspace:** ~$0.10 (negligible)

The survival curve chart component and tri-signal indicators are client-side React rendering — zero server cost.

---

## Dependencies & Build Order

| Component | Track | Depends On | Effort |
|---|---|---|---|
| `DealTriSignal` type + `computeDealTriSignal()` | Claude Code | RFM computed fields, TTE engine, lead_scores table | 2-3 hours |
| `AccountTriSignal` type + aggregation | Claude Code | DealTriSignal | 1-2 hours |
| Deal dossier assembler update | Replit | DealTriSignal function | 1-2 hours |
| Account dossier assembler update | Replit | AccountTriSignal function | 1-2 hours |
| Pipeline snapshot API extension | Replit | RFM computed fields | 1-2 hours |
| Deal header tri-signal UI component | Replit | Deal dossier API | 2-3 hours |
| Account header tri-signal UI component | Replit | Account dossier API | 2-3 hours |
| Survival curve chart component | Replit | TTE engine API | 3-4 hours |
| Survival sparkline component | Replit | Survival curve chart | 1 hour |
| Pipeline chart quality overlay | Replit | Pipeline snapshot API | 2-3 hours |
| Deal dossier narrative synthesis update | Claude Code | DealTriSignal | 1 hour |
| Account dossier narrative synthesis update | Claude Code | AccountTriSignal | 1 hour |
| ICP Discovery behavioral feature matrix | Claude Code | RFM T-30 snapshot queries | 3-4 hours |
| ICP Discovery "Winning Behaviors" synthesis | Claude Code | Behavioral feature matrix | 2 hours |
| ICP profiles schema extension | Claude Code | Behavioral synthesis | 1 hour |
| Lead Scoring behavioral fit function | Claude Code | ICP behavioral profile | 2 hours |
| Slack briefing updates | Claude Code + Replit | Tri-signal data | 2-3 hours |
| CRM sidebar widget update | Replit | Deal dossier API | 1-2 hours |
| **Total** | | | **~30-35 hours** |

**Critical path:** `computeDealTriSignal()` → dossier assemblers → UI components. The ICP Discovery behavioral features are a parallel track that can ship independently.

**What ships first:** The dossier assemblers and pipeline snapshot API (backend, Phase A). These power the existing Slack output improvements even before the Command Center UI components are built. A Slack briefing that says "save these, clean those up" is valuable before any chart component exists.

---

## What NOT to Build

- **A separate "intelligence dashboard" page.** The tri-signal appears on existing surfaces (deal detail, account detail, pipeline chart, Slack). It doesn't need its own page.
- **Configurable weights on the three dimensions.** The composite priority uses fixed weights that shift based on availability. Adding user-configurable weights creates a tuning surface that confuses more than it helps. If weights need to change, the ICP Discovery regression model should discover the right balance from data.
- **Animated transitions between signal states.** Nice-to-have. Ship without animations, add polish later.
- **Historical tri-signal tracking over time.** Interesting future feature (show how a deal's three signals evolved over its lifecycle) but requires storing snapshots per skill run. Park for later.
- **Tri-signal in email digests.** Email is a low-resolution channel. The weekly email digest should link to the Command Center for tri-signal detail, not try to render it inline.

---

**END OF TRI-SIGNAL INTELLIGENCE ADDENDUM**
