# Pipeline Movement Skill
## Spec — Week-Over-Week Intelligence

**Skill ID:** `pipeline-movement`
**Category:** pipeline
**Schedule:** `{ cron: '0 7 * * 1', trigger: 'on_demand' }` — Monday 7am, before Pipeline Hygiene at 8am
**Output:** skill_runs result_data (feeds Concierge brief), Slack, markdown
**Version:** 1.0.0

---

## What This Skill Does

Pipeline Movement answers the question no other skill answers:
**"What changed since last time I looked — and does it matter?"**

Every other skill is a snapshot. This skill is a delta.

It runs weekly, compares this week's pipeline state to last week's,
and produces a structured movement report that:

1. Shows absolute change in pipeline value and deal count
2. Identifies which deals advanced, stalled, fell back, or were lost
3. Flags anomalies — stages moving significantly faster or slower
   than the workspace historical average
4. Surfaces the trend across the last 4 weeks, not just this week
5. Connects the movement to the quarterly goal — is the trend
   moving toward or away from the target?

---

## Why This Is Foundational

Every operator — CRO, VP RevOps, AE — has the same implicit
question when they look at any pipeline metric: "Is this better
or worse than before?"

Without this skill:
- Coverage ratio is 2.93×. Is that good? Getting better? Declining?
- 47 findings. More or fewer than last week?
- $2.1M open pipeline. Up or down since Monday?

With this skill, every other skill's output gains context.
The Concierge brief stops being a snapshot and becomes a narrative
about trajectory.

---

## The Three-Phase Pattern

### Phase 1 — COMPUTE (pure SQL, zero tokens)

Seven compute steps. All SQL against existing tables.

**Step 1: resolve-time-windows**
Standard time resolution. Four windows:
```
this_week:     today - 7 days → today
last_week:     today - 14 days → today - 7 days
trailing_4w:   today - 28 days → today (for trend line)
quarter_to_date: fiscal quarter start → today
```

**Step 2: compute-pipeline-snapshot-now**
Current pipeline state aggregated by stage:
```sql
SELECT
  stage_normalized,
  COUNT(*) as deal_count,
  SUM(amount) as total_value,
  AVG(amount) as avg_deal_size,
  COUNT(CASE WHEN rfm_grade IN ('A','B') THEN 1 END) as healthy_count,
  COUNT(CASE WHEN rfm_grade IN ('D','F') THEN 1 END) as at_risk_count
FROM deals
WHERE workspace_id = $1
  AND stage_normalized NOT IN ('closed_won', 'closed_lost')
GROUP BY stage_normalized;
```

Also compute workspace totals:
- total_open_pipeline_value
- total_open_deal_count
- weighted_pipeline_value (amount × probability/100)
- coverage_ratio (weighted ÷ gap_to_target)

**Step 3: compute-pipeline-snapshot-last-week**
Same query but reconstructed from deal_stage_history.
For each deal, what stage was it in 7 days ago?

```sql
-- Reconstruct last week's state:
-- A deal's stage last week = its most recent transition
-- that occurred BEFORE (today - 7 days)
SELECT
  d.id,
  d.amount,
  COALESCE(
    (SELECT h.to_stage
     FROM deal_stage_history h
     WHERE h.deal_id = d.id
       AND h.changed_at <= (NOW() - INTERVAL '7 days')
     ORDER BY h.changed_at DESC
     LIMIT 1),
    d.stage_normalized  -- if no history, assume current stage
  ) as stage_last_week
FROM deals d
WHERE d.workspace_id = $1;
```

**Step 4: compute-deal-movements**
For each deal, classify what happened this week:

```typescript
type DealMovement =
  | 'advanced'      // moved to a later stage
  | 'fell_back'     // moved to an earlier stage  
  | 'closed_won'    // won this week
  | 'closed_lost'   // lost this week
  | 'new_entry'     // created this week
  | 'stalled'       // no movement (deal age increased)
  | 'unchanged';    // same stage, recent activity

// Rank stages by position in pipeline order
// advanced = to_stage_rank > from_stage_rank
// fell_back = to_stage_rank < from_stage_rank
```

Output per movement type:
```typescript
{
  advanced:    { count, totalValue, deals: TopDeal[] },
  fell_back:   { count, totalValue, deals: TopDeal[] },
  closed_won:  { count, totalValue, deals: TopDeal[] },
  closed_lost: { count, totalValue, deals: TopDeal[] },
  new_entry:   { count, totalValue, deals: TopDeal[] },
  stalled:     { count, totalValue, deals: TopDeal[] },
}
// TopDeal: { name, amount, owner, from_stage, to_stage, days_in_stage }
// Cap at 5 deals per movement type (token budget)
```

**Step 5: compute-stage-velocity**
For each stage, compare this week's average time-in-stage
to the historical workspace average:

```sql
SELECT
  stage_normalized,
  AVG(days_in_stage) as avg_days_this_week,
  (SELECT AVG(days_in_stage) FROM deal_stage_history
   WHERE workspace_id = $1
     AND changed_at < NOW() - INTERVAL '7 days') as historical_avg,
  COUNT(*) as sample_size
FROM deal_stage_history
WHERE workspace_id = $1
  AND changed_at >= NOW() - INTERVAL '7 days'
GROUP BY stage_normalized;
```

Flag stages where avg_days_this_week > historical_avg × 1.3
as "slowing down" and < historical_avg × 0.7 as "accelerating."

**Step 6: compute-4-week-trend**
Pull the last 4 weekly skill_runs outputs for pipeline-movement
and extract key metrics for trend detection:

```sql
SELECT result_data
FROM skill_runs
WHERE workspace_id = $1
  AND skill_id = 'pipeline-movement'
ORDER BY created_at DESC
LIMIT 4;
```

Extract from each: total_open_value, coverage_ratio, 
closed_won_value, new_entry_value.

Compute trend direction:
- is_coverage_improving: last 2 weeks > prior 2 weeks
- is_new_pipeline_consistent: std deviation of new_entry_value < 30%
- is_loss_rate_increasing: closed_lost_count trending up

If no prior runs exist (first run): skip trend, flag as
"Baseline established — trend available next week."

**Step 7: compute-net-delta**
Single summary object for the synthesis prompt:
```typescript
{
  // Value changes
  pipeline_value_delta: number,     // $ change this week
  pipeline_value_delta_pct: number, // % change
  deals_added: number,
  deals_lost: number,
  net_deal_change: number,
  
  // Coverage
  coverage_ratio_now: number,
  coverage_ratio_last_week: number,
  coverage_trend: 'improving' | 'declining' | 'stable',
  
  // Goal connection
  gap_to_target: number,
  gap_change_this_week: number,     // did we get closer or further?
  weeks_remaining_in_quarter: number,
  on_track: boolean,                // coverage >= 2.5× with ≥3 weeks left
  
  // Health
  healthy_deal_count: number,       // rfm A/B
  at_risk_deal_count: number,       // rfm D/F
  health_trend: 'improving' | 'declining' | 'stable',
  
  // Anomalies
  anomalies: string[],              // human-readable flags
}
```

---

### Phase 2 — CLASSIFY (DeepSeek, minimal)

One classification step. Input: the stalled deals list (max 20).

For each stalled deal, classify the stall reason:
```
'no_activity'     — no logged touchpoints in 14+ days
'stage_age'       — in current stage significantly longer than p90
'champion_dark'   — primary contact hasn't engaged recently
'awaiting_response' — rep sent something, waiting on prospect
'internal_delay'  — legal/procurement/internal approval likely
'unknown'         — insufficient signal to classify
```

This classification powers the "why is this stalling" narrative
and feeds the coaching signal (if one rep has 4 stalled deals,
that's a coaching conversation).

Token budget: ~800 input, ~400 output.

---

### Phase 3 — SYNTHESIZE (Claude, one call)

Input: ~1,800 tokens of structured movement data.
Output: ~400 tokens of narrative + structured summary.

**System prompt additions specific to this skill:**

```
You are analyzing pipeline movement for a B2B SaaS RevOps team.

Your job: explain what changed this week, why it matters to the
quarterly goal, and what to do about it.

STRUCTURE (always follow this order):
1. The headline: net change in one sentence
   "Pipeline grew $180K this week — coverage moved from 2.7× to 2.93×."
   
2. What drove it: the 2-3 most significant movements
   Name specific deals and amounts. Not "several deals advanced" —
   "ABS Kids ($200K) moved from Evaluation to Proposal."

3. The concern: what's moving in the wrong direction
   Name specific stalled or lost deals. Explain the stall reason
   from the classification data.

4. The trend: is this week better or worse than the pattern?
   Use the 4-week trend data. "This is the third consecutive week
   of declining new pipeline entry" is more useful than "new pipeline
   was low this week."

5. The goal connection: where does this leave the quarter?
   Connect movement to gap_to_target and weeks_remaining.
   "At current pace, coverage will reach 3× by week 9 — 
   on track for Q2." Or: "Coverage has declined 3 weeks in a row.
   If this continues, you'll enter Q2 at 1.8× — well below target."

VOICE RULES:
- No fear language. State trajectory, not alarm.
- Numbers must match the compute data exactly. Never estimate.
- If the trend is positive, say so directly.
- If on_track = true, lead with that.
- If on_track = false, lead with the gap and the specific lever.
- Maximum 300 words. Depth over breadth.
```

**Structured output (JSON alongside narrative):**

```typescript
interface MovementSummary {
  narrative: string;           // 200-300 word synthesis
  headline: string;            // 1 sentence for Concierge brief topline
  net_delta: NetDelta;         // from compute Step 7
  top_movements: {
    advanced: TopDeal[];
    lost: TopDeal[];
    stalled: StalledDeal[];
    new_entries: TopDeal[];
  };
  trend_signal: 'positive' | 'neutral' | 'negative';
  on_track: boolean;
  primary_concern: string | null;   // 1 sentence, null if none
  recommended_action: string | null; // 1 specific action
}
```

---

## Concierge Integration

This is what makes the skill foundational for the brief.

**In assembleBriefData()**, add one query after the existing pipeline stats:

```typescript
// Get most recent pipeline-movement skill run
const movementRun = await db.query(`
  SELECT result_data, created_at
  FROM skill_runs
  WHERE workspace_id = $1
    AND skill_id = 'pipeline-movement'
    AND status = 'success'
  ORDER BY created_at DESC
  LIMIT 1
`, [workspaceId]);

const movement = movementRun.rows[0]?.result_data?.summary || null;
```

Add to OpeningBriefData:
```typescript
pipelineMovement: {
  headline: string | null;
  netDelta: number | null;           // $ change this week
  coverageTrend: 'improving' | 'declining' | 'stable' | null;
  onTrack: boolean | null;
  primaryConcern: string | null;
  lastRunAt: Date | null;
} | null;
```

**In renderBriefContext()**, add after the pipeline section:

```
PIPELINE MOVEMENT (week-over-week):
Headline: {movement.headline}
Net delta: {movement.netDelta > 0 ? '+' : ''}{formatCurrency(movement.netDelta)} this week
Coverage trend: {movement.coverageTrend}
On track for quarter: {movement.onTrack ? 'Yes' : 'No'}
{movement.primaryConcern ? `Primary concern: ${movement.primaryConcern}` : ''}
```

**In the Concierge overnight activity log**, add as a distinct row:

```
✓  Pipeline Movement — +$180K this week · coverage 2.93× (↑ from 2.7×)
```

Or if declining:
```
⚠  Pipeline Movement — −$240K this week · coverage 2.1× (↓ from 2.4×)
```

The yellow dot / warning indicator fires when:
- coverage_trend = 'declining' AND weeks_remaining < 6
- on_track = false
- net_delta < 0 for 2+ consecutive weeks

---

## Comparison to Existing Skills

| Skill | Question | Time frame |
|---|---|---|
| Pipeline Hygiene | What's wrong right now? | Snapshot |
| Single Thread Alert | Which deals lack coverage? | Snapshot |
| Deal Risk Review | Which deals might slip? | Snapshot |
| RFM Scoring | How engaged are deals behaviorally? | Snapshot + behavioral history |
| Pipeline Waterfall | How did deals flow through stages? | Period (weekly default) |
| **Pipeline Movement** | **What changed and does it matter?** | **Delta (this week vs last week) + 4-week trend** |

Pipeline Waterfall and Pipeline Movement overlap but are distinct.
Waterfall shows stage-level flow detail (how many entered/left each stage).
Movement shows deal-level narrative + trend + goal connection.
Both should run. Movement consumes Waterfall's compute functions
where possible rather than duplicating.

---

## Implementation Notes

**Builds on:**
- `server/analysis/stage-history-queries.ts` — use existing functions
- `deal_stage_history` table — 1,481 transitions already loaded for Frontera
- `pipeline-waterfall` compute functions — reuse waterfallAnalysis()
- RFM grades on deals table — already computed, use for health signal
- `skill_runs` table — reads prior outputs for 4-week trend

**Migration needed:**
None. All required tables exist.

**First run behavior:**
No prior skill_runs exist → skip 4-week trend, output baseline.
"This is the first Pipeline Movement run for this workspace.
Trend data will be available after 4 weekly runs."

**Token budget:**
- Compute: 0 tokens
- DeepSeek classify: ~1,200 tokens
- Claude synthesize: ~2,200 tokens
- Total: ~3,400 tokens per run
- Cost: ~$0.05 per workspace per week

**Schedule:**
Monday 7am — runs before Pipeline Hygiene (8am) so Concierge
brief on Monday morning has fresh movement data from the weekend
alongside fresh hygiene findings.

---

## Claude Code Prompt

```
Read server/analysis/stage-history-queries.ts,
server/skills/library/pipeline-waterfall.ts,
server/context/opening-brief.ts, and one existing
working skill (pipeline-hygiene.ts) before writing
any code.

TASK: Build the Pipeline Movement skill.

This skill computes week-over-week pipeline changes
and surfaces them in the Concierge brief as a trend
signal. Full spec in PIPELINE_MOVEMENT_SKILL_SPEC.md.

Build in this order:

1. server/analysis/pipeline-movement.ts
   — computePipelineSnapshot(workspaceId, asOfDate)
   — computeDealMovements(workspaceId, startDate, endDate)
   — computeVelocityDeltas(workspaceId, startDate, endDate)
   — computeNetDelta(now, lastWeek, target)
   — getTrendFromSkillRuns(workspaceId, limit=4)
   All pure SQL, zero LLM calls.

2. server/skills/library/pipeline-movement.ts
   Skill definition following existing skill pattern.
   7 compute steps → 1 DeepSeek classify → 1 Claude synthesize.
   Register in skill registry.
   Add to cron: Monday 7am.

3. Extend assembleBriefData() in opening-brief.ts
   Add pipelineMovement field pulling from most recent
   pipeline-movement skill_run.
   
4. Extend renderBriefContext() in opening-brief.ts
   Add PIPELINE MOVEMENT section to the context block.

CRITICAL: 
- Reuse waterfallAnalysis() from pipeline-waterfall 
  where it overlaps — do not duplicate.
- Stage reconstruction from deal_stage_history must 
  handle deals with no history (assume current stage).
- The 4-week trend query must handle < 4 prior runs 
  gracefully — use however many exist.
- Follow safeExecute pattern throughout.
- Do not touch orchestrator.ts or pandora-agent.ts.

Validate:
  1. Skill runs manually for Frontera workspace
  2. result_data contains MovementSummary with headline
  3. assembleBriefData() returns pipelineMovement field
  4. renderBriefContext() includes PIPELINE MOVEMENT block
  5. Token usage under 5,000 total (well within budget)

Report each step before proceeding to the next.
```

