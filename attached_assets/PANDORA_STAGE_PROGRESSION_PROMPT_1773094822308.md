# Claude Code Prompt: Stage Progression
## Second tab on the Winning Path page — quarterly cadence

---

## What this is and why it's different from Win Path

Win Path asks: what did deals that closed won do?
Stage Progression asks: what distinguishes deals that moved out of a
stage from deals that stalled in it?

These are different questions requiring different data.

Win Path needs won deal transcripts. Frontera has 6 — not enough for
discovery. Stage Progression needs transcripts from any deal that had
a conversation while in a given stage — won, lost, or still open.
Frontera almost certainly has far more of those, because Gong records
calls regardless of outcome.

The unit of analysis shifts from deal outcome to stage transition:
- Progressor: a deal that had a call in stage X and moved to stage X+1
  within a reasonable window (2× the won median time in that stage)
- Staller: a deal that had a call in stage X and did not advance within
  that same window (still in X, moved backward, or closed lost from X)

This connects directly to what Pipeline Mechanics already shows. The
19.2× signal gap in Decision stage (won deals spend 7 days, lost deals
spend 128 days) becomes the primary input. Stage Progression shows what
actually happened in those 7 days for deals that moved out.

Pipeline filters apply exactly as in Win Path. Core Sales Pipeline shows
the stage progression behaviors for Core Sales deals only.

---

## Before starting

Read these files:

1. `server/skills/library/behavioral-winning-path.ts` — the existing
   skill. Stage Progression runs on the same quarterly cron. Add it as
   a second step within the same skill run, not a separate skill.

2. `server/skills/compute/behavioral-milestones.ts` — the existing
   compute layer. You are adding new functions alongside the existing
   ones, not modifying them.

3. `server/analysis/stage-history-queries.ts` — `getAverageTimeInStage`,
   `getStageConversionRates`, `getWonCyclePercentiles`. You will need
   a new function: `getStageTranscriptCoverage`. Check if it exists.

4. `client/src/pages/BehavioralWinningPathPage.tsx` — the existing page.
   You are adding a second tab, not replacing the first one.

5. The `deal_stage_history` table schema — `deal_id`, `to_stage`,
   `from_stage`, `changed_at`, `duration_in_previous_stage_ms`.

6. The `conversations` table schema — `deal_id`, `started_at`,
   `transcript_text`, `participants`, `is_internal`.

---

## Data model

### Progressor vs. Staller classification

For each stage in the pipeline:

```typescript
interface StageTranscriptPool {
  stageId: string;
  stageName: string;
  stageOrder: number;        // position in pipeline sequence
  wonMedianDaysInStage: number;  // from getAverageTimeInStage()
  stallThresholdDays: number;    // 2 × wonMedianDaysInStage, min 7
  progressors: DealInStage[];    // had call in stage + moved forward
  stallers:    DealInStage[];    // had call in stage + stalled/regressed
  noCoverageCount: number;       // deals in stage with no linked calls
}

interface DealInStage {
  dealId: string;
  dealName: string;
  enteredStageAt: Date;
  exitedStageAt: Date | null;
  daysInStage: number;
  outcome: 'progressed' | 'stalled' | 'closed_lost' | 'closed_won';
  conversations: {
    id: string;
    startedAt: Date;
    daysFromStageEntry: number;
    transcriptExcerpt: string | null;   // customer turns only, max 300 chars
    summary: string | null;
  }[];
}
```

### Stage ordering

Stage Progression columns are ordered by pipeline stage sequence, not
by time window. Query the workspace's stage config to get the canonical
order. Fall back to frequency-of-progression order from
`deal_stage_history` if no explicit config exists.

Do not include Closed Won or Closed Lost as columns — only open/active
stages.

---

## Step 1: Stage transcript coverage probe (COMPUTE)

Add `getStageTranscriptCoverage()` to
`server/analysis/stage-history-queries.ts`:

```typescript
export async function getStageTranscriptCoverage(
  workspaceId: string,
  pipelineId: string | null,
  db: DatabaseClient
): Promise<{
  stages: {
    stageName: string;
    stageOrder: number;
    wonMedianDays: number;
    stallThresholdDays: number;
    totalDealsEverInStage: number;
    dealsWithTranscripts: number;
    transcriptCoveragePct: number;
    progressorCount: number;
    stallerCount: number;
  }[];
  totalCoveragePct: number;
  usableStages: number;  // stages with ≥5 deals having transcripts
}> {

  // For each stage:
  // 1. Count deals that ever entered the stage (from deal_stage_history)
  // 2. Of those, count deals that have ≥1 conversation linked while
  //    the deal was in that stage (started_at between entry and exit)
  // 3. Of those with transcripts, classify as progressor or staller
  //    using stallThresholdDays = 2 × wonMedianDaysInStage

  const stageQuery = `
    WITH stage_deals AS (
      SELECT
        dsh.to_stage AS stage_name,
        dsh.deal_id,
        dsh.changed_at AS entered_at,
        LEAD(dsh.changed_at) OVER (
          PARTITION BY dsh.deal_id ORDER BY dsh.changed_at
        ) AS exited_at
      FROM deal_stage_history dsh
      JOIN deals d ON d.id = dsh.deal_id
      WHERE dsh.workspace_id = $1
        ${pipelineId ? 'AND d.pipeline_id = $2' : ''}
        AND dsh.to_stage NOT ILIKE '%closed%'
        AND dsh.to_stage NOT ILIKE '%won%'
        AND dsh.to_stage NOT ILIKE '%lost%'
    ),
    stage_with_convos AS (
      SELECT
        sd.stage_name,
        sd.deal_id,
        sd.entered_at,
        sd.exited_at,
        COUNT(c.id) AS convo_count
      FROM stage_deals sd
      LEFT JOIN conversations c
        ON c.deal_id = sd.deal_id
        AND c.started_at >= sd.entered_at
        AND (sd.exited_at IS NULL OR c.started_at < sd.exited_at)
        AND c.is_internal = false
        AND c.deal_id IS NOT NULL
      GROUP BY sd.stage_name, sd.deal_id, sd.entered_at, sd.exited_at
    )
    SELECT
      stage_name,
      COUNT(*) AS total_deals,
      COUNT(*) FILTER (WHERE convo_count > 0) AS deals_with_transcripts
    FROM stage_with_convos
    GROUP BY stage_name
    ORDER BY MAX(entered_at) DESC
  `;

  // Execute, compute coverage pct per stage, join with
  // getAverageTimeInStage() for wonMedianDays, compute stallThreshold
}
```

---

## Step 2: Progressor vs. staller sampling (COMPUTE)

For each stage with ≥5 deals having transcripts, assemble the
classification pool:

```typescript
async function buildStagePool(
  workspaceId: string,
  stageName: string,
  stallThresholdDays: number,
  pipelineId: string | null,
  maxDeals: number = 40,  // 20 progressors + 20 stallers
  db: DatabaseClient
): Promise<StageTranscriptPool> {

  // A deal is a PROGRESSOR if:
  //   - It entered this stage
  //   - It moved to the NEXT stage (forward) within stallThresholdDays
  //   - It had ≥1 conversation while in this stage
  //
  // A deal is a STALLER if:
  //   - It entered this stage
  //   - It did NOT move forward within stallThresholdDays
  //     (still in stage, regressed, or closed lost from this stage)
  //   - It had ≥1 conversation while in this stage
  //
  // Sort both sets by entered_at DESC (most recent first, highest
  // probability of linked transcripts — same logic as T001 fix)
  // Take up to 20 progressors and ALL stallers with transcripts
  // (don't cap stallers — same lesson as T001)

  // For each sampled deal, fetch the best conversation:
  //   - Longest duration call while deal was in this stage
  //   - Extract customer turns only (same extractCustomerTurns() from
  //     behavioral-milestones.ts — reuse, don't duplicate)
  //   - Max 300 chars per excerpt
}
```

---

## Step 3: DeepSeek discovery per stage (DEEPSEEK)

Run one DeepSeek call per stage with usable coverage. Pass progressor
and staller excerpts side by side.

**Token budget:** Max 4K input per stage. With 20 progressors + 20
stallers at 300 chars each = ~3K chars ≈ 750 tokens of excerpts plus
prompt overhead. Should be well within budget.

DeepSeek prompt per stage:

```
You are analyzing sales call transcripts to discover what buyer behaviors
distinguish deals that PROGRESSED through {stageName} from deals that
STALLED in {stageName}.

Pipeline: {pipelineName}
Stage: {stageName}
Median days to progress (won deals): {wonMedianDays} days
Stall threshold: {stallThresholdDays} days

PROGRESSOR transcripts ({progressorCount} deals that advanced):
{For each: "Deal {i}: {excerpt}"}

STALLER transcripts ({stallerCount} deals that did not advance):
{For each: "Deal {i}: {excerpt}"}

YOUR TASK:
Identify 2–4 buyer behaviors that appear notably more often in
PROGRESSOR transcripts than STALLER transcripts.

These should be:
- Specific things the buyer said or did (not rep behaviors)
- Observable in a transcript (not inferred from outcome)
- Contrastive — clearly more present in progressors than stallers

For each behavior, return:
{
  "id": "snake_case_id",
  "title": "Short buyer-centric label (3–6 words)",
  "description": "One sentence. What specifically did the buyer say or do?",
  "evidence": ["1–2 phrases from the progressor transcripts above"],
  "absent_in_stallers": "One sentence describing what stallers did instead, or what was missing",
  "confidence": "high | medium | low"
}

Also identify 1–2 WARNING behaviors — things that appear in STALLER
transcripts but not progressors:
{
  "id": "snake_case_id",
  "title": "Short buyer-centric label",
  "description": "One sentence. What did stalling buyers say or do?",
  "evidence": ["1–2 phrases from staller transcripts"],
  "confidence": "high | medium | low"
}

Return JSON: { "progression_signals": [...], "warning_signals": [...] }
No preamble. JSON only.
```

Discard any signal with `confidence: "low"` and no evidence phrases.
If fewer than 2 progression signals survive, mark the stage as
`insufficientSignal: true` — render a greyed card rather than empty.

---

## Step 4: Lift scoring per stage signal (COMPUTE)

For each progression signal, score it against the full stage pool
(not just the discovery sample) to compute:

```typescript
interface StageSignal {
  id: string;
  title: string;
  description: string;
  evidence: string[];
  absentInStallers: string;
  type: 'progression' | 'warning';
  progressorPct: number;    // % of progressors where signal is present
  stallerPct: number;       // % of stallers where signal is present
  progressionLift: number;  // progressorPct / stallerPct
  insufficientData: boolean;
  confidence: 'high' | 'medium' | 'low';
}
```

Use the same batched scoring approach as Win Path v2 — pass up to 10
deal excerpts per DeepSeek call, get back `{deal_id: boolean}`.

**Critical difference from Win Path:** the denominator here is
progressors + stallers in the stage, not won + lost deals. Make sure
the scoring pool is built from `buildStagePool()`, not from
`getClosedDeals()`.

---

## Step 5: Stage Progression matrix output (COMPUTE)

```typescript
interface StageProgressionMatrix {
  pipelineId: string | null;
  pipelineName: string;
  stages: StageProgressionResult[];
  meta: {
    totalStages: number;
    usableStages: number;      // stages with ≥5 transcript-linked deals
    totalProgressors: number;
    totalStallers: number;
    analysisPeriodDays: number;
    generatedAt: string;
  };
}

interface StageProgressionResult {
  stageName: string;
  stageOrder: number;
  wonMedianDays: number;
  stallThresholdDays: number;
  progressorCount: number;
  stallerCount: number;
  transcriptCoveragePct: number;
  signalGapMultiplier: number;  // from Pipeline Mechanics — won vs lost median
  progressionSignals: StageSignal[];   // 2–4 green cards
  warningSignals: StageSignal[];       // 1–2 red cards
  insufficientSignal: boolean;
  coverageTooLow: boolean;     // true if transcriptCoveragePct < 0.15
}
```

The `signalGapMultiplier` connects Stage Progression to Pipeline
Mechanics. Pull it from the existing stage velocity data rather than
recomputing. This is the number that appears in the column header —
"Decision · 19.2× gap".

---

## Step 6: Claude synthesis for Stage Progression (SYNTHESIZE)

One synthesis call covering all stages. Input target < 4K tokens.

Apply the same VOICE RULES from the Win Path synthesis:
- Calm, specific, data-first
- Report what the data shows
- Never use fear language, urgency language, or CTAs

```
Pipeline: {pipelineName}
Analysis: {totalProgressors} progressors vs {totalStallers} stallers
          across {usableStages} stages with transcript coverage

STAGE RESULTS (ordered by signal gap, largest first):
{For each stage:
  stageName, wonMedianDays, signalGapMultiplier,
  progressorCount, stallerCount, transcriptCoveragePct,
  top 2 progression signals (title, progressionLift, top evidence phrase),
  top 1 warning signal (title, evidence)}

YOUR TASK:
Write a Stage Progression analysis for {pipelineName}. 3 paragraphs.

1. The stage with the largest signal gap — what are progressors
   actually doing that stallers aren't? Use the evidence phrases.
   Be specific about the behavior, not the outcome.

2. The most consistent warning signal across stages — what buyer
   behavior predicts stalling? If it appears in multiple stages,
   say so.

3. The single most actionable coaching implication for reps with
   deals currently in the highest-gap stage.

VOICE RULES:
- Calm, specific, data-first.
- Report what the data shows. State limitations once, plainly.
- Never use fear language, urgency language, or CTAs.
- Never say "flying blind", "alarming", "unlock", "you need to".
```

---

## Step 7: API endpoint

Add to `server/routes/skills.ts`:

```
GET /:workspaceId/skills/behavioral-winning-path/stage-progression/latest
  → Returns most recent StageProgressionMatrix from skill_runs

GET /:workspaceId/skills/behavioral-winning-path/stage-progression/coverage
  → Returns getStageTranscriptCoverage() only — fast probe, no LLM
    Used by UI to show coverage state before full data loads
```

The Stage Progression run is triggered by the same
`POST /:workspaceId/skills/behavioral-winning-path/run` endpoint.
Both Win Path and Stage Progression compute in the same skill run.
Store results separately in skill_runs with different result_type
values: `'win_path'` and `'stage_progression'`.

---

## Step 8: UI — second tab on BehavioralWinningPathPage

Add a tab strip below the page header, above the pipeline filter tabs:

```
[Win Path]  [Stage Progression]
```

The pipeline filter tabs (All Pipelines / Core Sales / Fellowship / etc.)
remain below and apply to whichever tab is active.

### Stage Progression tab layout

**Column headers** — one column per stage, ordered by `stageOrder`.
Each header shows:

```
{stageName}
{wonMedianDays}d median · {signalGapMultiplier}× gap
```

The `signalGapMultiplier` gets a color treatment:
- > 5× → red/orange (high gap — big behavioral difference)
- 2–5× → amber
- < 2× → neutral

No row label column (no "Won / Lost" rows — this view has
Progression Signals and Warning Signals within each column).

**Within each stage column**, two card sections:

Section 1 — Progression signals (green tint):
```
↑ PROGRESSES DEALS
[signal card]
[signal card]
```

Section 2 — Warning signals (red/amber tint):
```
↓ STALLS DEALS
[signal card]
```

**Signal cards** — same visual structure as Win Path milestone cards:

```
[type badge: ↑ Progression | ↓ Warning]
Title (13px semibold)
Description (11px secondary)

[progressorPct% of progressors]  [progressionLift× lift]
```

On click: detail panel below grid shows evidence phrases ("From your
transcripts:"), absent_in_stallers description, and stat cards.

**Coverage indicator** per stage column:

If `coverageTooLow: true`:
- Dim the column header
- Show a single grey card: "Coverage too low — fewer than 15% of deals
  in this stage have linked conversations"
- Do not show signal cards

If `insufficientSignal: true`:
- Show a single grey card: "No distinguishing signals found — behaviors
  are similar across progressors and stallers in this stage"

**Stage Progression synthesis card** — below the grid, same style as
Win Path synthesis card. Renders `stageProgressionMatrix.summary`.

---

## Skill run sequencing

Both Win Path discovery and Stage Progression discovery run in the
same quarterly skill execution. Run them sequentially, not in parallel,
to avoid DeepSeek rate limits.

Order:
1. Tier probe (shared)
2. Won cycle percentiles (shared)
3. Win Path: transcript sampling → DeepSeek discovery → lift scoring
4. Stage Progression: coverage probe → stage pool building →
   DeepSeek discovery per stage → lift scoring per stage
5. Claude synthesis — Win Path
6. Claude synthesis — Stage Progression
7. Store both result objects in skill_runs

Total DeepSeek calls estimate (for a 4-stage pipeline with moderate
coverage): 1 Win Path discovery + 4 Stage Progression discovery +
~30 scoring batches = ~35 DeepSeek calls per quarterly run.

---

## Acceptance criteria

- [ ] `getStageTranscriptCoverage()` returns correct counts for
      Frontera — verify against known conversation/stage overlap
- [ ] Progressor vs. staller classification uses `stallThresholdDays`
      = 2 × wonMedianDays per stage, not a global threshold
- [ ] Most recent deals sampled first (ORDER BY entered_at DESC) —
      same fix as T001
- [ ] Staller pool not capped — all stallers with transcripts scored,
      not a fixed slice
- [ ] DeepSeek receives progressor AND staller excerpts side by side
      in the same prompt — contrastive framing is required
- [ ] `signalGapMultiplier` in output matches Pipeline Mechanics
      value for the same stage and pipeline
- [ ] Coverage gate: stages with < 15% transcript coverage show
      coverage card, not empty signal cards
- [ ] Stage columns ordered by `stageOrder`, not alphabetically
- [ ] Pipeline filter applies correctly — switching to Core Sales
      Pipeline filters both stage pool and signal discovery
- [ ] Both Win Path and Stage Progression results stored separately
      in skill_runs with correct result_type values
- [ ] Tab strip appears above pipeline filters; active tab state
      persists across pipeline filter changes
- [ ] Evidence phrases visible in detail panel ("From your transcripts:")
- [ ] Stage Progression synthesis references specific stage names and
      evidence phrases — not generic pipeline advice
- [ ] Quarterly cron unchanged — both views refresh together
- [ ] No TypeScript errors
- [ ] `created_at` used throughout — not `created_date`
