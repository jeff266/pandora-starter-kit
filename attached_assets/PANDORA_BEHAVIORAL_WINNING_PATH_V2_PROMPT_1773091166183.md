# Claude Code Prompt: Behavioral Winning Path v2
## Full Rebuild — Discovery-First, Per-Pipeline, Quarterly

---

## What's changing and why

The v1 implementation scored a fixed 6-item GTM checklist against every
pipeline. The checklist was written by a domain expert, not discovered from
data. The milestones ("Discovery call held", "Champion multi-threaded") are
generically correct but not specific to how any particular company wins.

The result: a fill-in-the-blank exercise. Core Sales Pipeline at Frontera
wins in 70 days median. The v1 taxonomy was built for a 120-day cycle and
labeled Executive Sponsor Activated at Day 75 — after most won deals had
already closed. The "Insufficient data" cards weren't a sample problem. The
skill was looking in the wrong place entirely.

The v2 approach:

1. **Discover milestones from the data, don't assume them.** For workspaces
   with conversation data, DeepSeek reads transcript excerpts from closed
   won deals and surfaces recurring behavioral themes as named milestones.
   These are this company's winning behaviors, in their language.

2. **Anchor time windows to the pipeline's actual cycle, not a generic
   template.** Day windows are computed as percentiles of the won deal cycle
   length for that specific pipeline. A 70-day pipeline gets different
   windows than a 140-day pipeline.

3. **Run quarterly, not weekly.** Winning behaviors are structural patterns
   that emerge over months of closed deals. Running weekly produces noise
   on small sample sizes and burns tokens on a signal that doesn't change
   week-to-week. Quarterly runs on the trailing 18 months of closed deals.

4. **The predefined taxonomy is a fallback only.** For Tier 2 (email),
   Tier 3 (contact roles), and Tier 4 (stage history) workspaces where
   discovery isn't possible, the v1 predefined milestones are still
   correct as proxies. But any workspace with sufficient transcript data
   gets discovered milestones, not assumed ones.

---

## Before starting

Read these files:

1. `server/skills/compute/behavioral-milestones.ts` — the v1 compute layer.
   You are replacing most of this file. Preserve the tier probe logic
   (`probeBehavioralDataTier`) and the fallback milestone definitions for
   Tiers 2–4. Replace the Tier 1 extraction entirely.

2. `server/skills/library/behavioral-winning-path.ts` — the v1 skill
   definition. Update the cron schedule and step pipeline.

3. `server/analysis/stage-history-queries.ts` — `getAverageTimeInStage`,
   `getStageConversionRates`. You'll need `getWonCyclePercentiles` — check
   if it exists; if not, add it here.

4. An existing skill that uses DeepSeek classification (pipeline-hygiene
   or rep-scorecard) — copy the DeepSeek call pattern exactly. Do not
   invent a new pattern.

5. The conversations table schema — `participants`, `transcript_text`,
   `summary`, `started_at`, `duration_seconds`, `deal_id`.

6. The deals table schema — confirm column names. In particular: the
   created date column is `created_at`, NOT `created_date`. This was a
   bug in v1 that crashed all 12 SQL queries on first run.

---

## Step 1: Update cron schedule

In `server/skills/library/behavioral-winning-path.ts`, change:

```typescript
// v1 — WRONG
schedule: { cron: '0 6 * * 1', trigger: 'on_demand' }

// v2 — quarterly, first Monday of each quarter at 5 AM UTC
// Jan 1, Apr 1, Jul 1, Oct 1 — use on_demand as the primary trigger
// until the cron pattern is validated
schedule: { cron: '0 5 1 1,4,7,10 *', trigger: 'on_demand' }
```

Add a comment: "Quarterly cadence. Winning behaviors are structural patterns
over 18 months of closed deals — not a weekly signal."

---

## Step 2: Won cycle percentiles (COMPUTE)

Add `getWonCyclePercentiles()` to `server/analysis/stage-history-queries.ts`
if it doesn't already exist:

```typescript
export async function getWonCyclePercentiles(
  workspaceId: string,
  pipelineId: string | null,  // null = all pipelines
  db: DatabaseClient
): Promise<{
  p25: number;   // days
  p50: number;   // median
  p75: number;
  p90: number;
  sampleSize: number;
}> {
  // Query closed won deals, compute days from created_at to close_date
  // Filter by pipeline if pipelineId provided
  // Return percentile distribution
  // If sample < 10 deals, return null (insufficient for percentile calc)
  
  const result = await db.query(`
    SELECT
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY cycle_days) AS p25,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY cycle_days) AS p50,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cycle_days) AS p75,
      PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY cycle_days) AS p90,
      COUNT(*) AS sample_size
    FROM (
      SELECT
        EXTRACT(DAY FROM (close_date::timestamptz - created_at)) AS cycle_days
      FROM deals
      WHERE workspace_id = $1
        AND is_closed = true
        AND is_won = true
        AND close_date IS NOT NULL
        AND created_at IS NOT NULL
        ${pipelineId ? 'AND pipeline_id = $2' : ''}
    ) sub
    WHERE cycle_days > 0 AND cycle_days < 730  -- exclude outliers
  `, pipelineId ? [workspaceId, pipelineId] : [workspaceId]);

  return {
    p25: Math.round(result.rows[0].p25),
    p50: Math.round(result.rows[0].p50),
    p75: Math.round(result.rows[0].p75),
    p90: Math.round(result.rows[0].p90),
    sampleSize: parseInt(result.rows[0].sample_size),
  };
}
```

---

## Step 3: Relative time window computation (COMPUTE)

Replace the hardcoded column definitions with pipeline-relative windows.

```typescript
function computeTimeWindows(wonMedianDays: number): TimeWindow[] {
  // Four windows anchored to the pipeline's actual won median cycle.
  // Boundaries at 0%, 25%, 50%, 75%, 100% of median cycle length.
  // Round to nearest 5 days for readable labels.
  
  const round5 = (n: number) => Math.round(n / 5) * 5;

  const w1End = round5(wonMedianDays * 0.25);
  const w2End = round5(wonMedianDays * 0.50);
  const w3End = round5(wonMedianDays * 0.75);
  const w4End = round5(wonMedianDays * 1.00);

  return [
    {
      id: 'open',
      label: `Day 0–${w1End}`,
      sublabel: 'Opening motion',
      start: 0,
      end: w1End,
    },
    {
      id: 'develop',
      label: `Day ${w1End}–${w2End}`,
      sublabel: 'Development',
      start: w1End,
      end: w2End,
    },
    {
      id: 'validate',
      label: `Day ${w2End}–${w3End}`,
      sublabel: 'Validation',
      start: w2End,
      end: w3End,
    },
    {
      id: 'close',
      label: `Day ${w3End}–${w4End}+`,
      sublabel: 'Close motion',
      start: w3End,
      end: w4End,
    },
  ];
}
```

These windows are computed fresh per pipeline per run. The UI column
headers show the actual day ranges — not generic "Day 0–30" labels.

---

## Step 4: Transcript sampling (COMPUTE)

Before DeepSeek discovery, assemble a representative transcript sample
from closed won deals. This is the input to the discovery step.

```typescript
async function sampleWonTranscripts(
  workspaceId: string,
  wonDealIds: string[],
  maxDeals: number = 30,    // cap at 30 deals for token budget
  maxExcerptTokens: number = 300,  // per transcript excerpt
  db: DatabaseClient
): Promise<TranscriptSample[]> {
  
  // Sample strategy: prefer deals with the most calls (richer signal).
  // Within each deal, prefer the calls where the customer spoke most.
  // Extract customer speaker turns only — rep monologue is not useful
  // for discovering what the buyer said or did.

  const deals = await db.query(`
    SELECT
      d.id AS deal_id,
      d.name AS deal_name,
      d.close_date,
      EXTRACT(DAY FROM (d.close_date::timestamptz - d.created_at)) AS cycle_days,
      COUNT(c.id) AS call_count
    FROM deals d
    JOIN conversations c ON c.deal_id = d.id
    WHERE d.workspace_id = $1
      AND d.id = ANY($2)
      AND c.transcript_text IS NOT NULL
      AND LENGTH(c.transcript_text) > 200
    GROUP BY d.id, d.name, d.close_date, d.created_at
    ORDER BY call_count DESC
    LIMIT $3
  `, [workspaceId, wonDealIds, maxDeals]);

  const samples: TranscriptSample[] = [];

  for (const deal of deals.rows) {
    // For each deal, get the 2 most customer-heavy calls
    const calls = await db.query(`
      SELECT
        id,
        title,
        started_at,
        duration_seconds,
        transcript_text,
        summary,
        EXTRACT(DAY FROM (started_at - d.created_at)) AS days_from_open
      FROM conversations c
      JOIN deals d ON d.id = c.deal_id
      WHERE c.deal_id = $1
        AND c.transcript_text IS NOT NULL
        AND c.is_internal = false
      ORDER BY duration_seconds DESC
      LIMIT 2
    `, [deal.deal_id]);

    for (const call of calls.rows) {
      // Extract customer speaker turns only
      // Transcript format varies by source — try to detect speaker segments
      const customerExcerpt = extractCustomerTurns(
        call.transcript_text,
        maxExcerptTokens
      );

      if (customerExcerpt.length > 50) {
        samples.push({
          dealId: deal.deal_id,
          dealName: deal.deal_name,
          cycleDays: Math.round(deal.cycle_days),
          callTitle: call.title,
          daysFromOpen: Math.round(call.days_from_open),
          excerpt: customerExcerpt,
          summary: call.summary?.slice(0, 200) || null,
        });
      }
    }
  }

  return samples;
}

function extractCustomerTurns(
  transcript: string,
  maxTokenApprox: number
): string {
  // Transcripts typically use patterns like:
  // "Speaker Name: text" or "[00:01:23] Name: text"
  // Heuristic: lines NOT starting with rep-side indicators
  // We don't know who the rep is, so extract all named speaker turns
  // and let DeepSeek sort out who is customer-side by content

  const lines = transcript.split('\n').filter(l => l.trim().length > 20);
  const maxChars = maxTokenApprox * 4; // rough token → char conversion

  // Take a distributed sample: first third, middle third, last third
  const third = Math.floor(lines.length / 3);
  const sample = [
    ...lines.slice(0, Math.min(third, 15)),
    ...lines.slice(third, Math.min(third * 2, third + 15)),
    ...lines.slice(third * 2, Math.min(lines.length, third * 2 + 15)),
  ];

  return sample.join('\n').slice(0, maxChars);
}
```

---

## Step 5: DeepSeek discovery pass (DEEPSEEK)

This is the core of the v2 rebuild. Instead of scoring predefined milestones,
DeepSeek reads the transcript sample and surfaces what it actually finds.

Run once per pipeline, not per deal. Pass the full sample (up to 30 deals,
2 excerpts each = up to 60 excerpts) as a single batch.

**Token budget:** Target < 6K input tokens, < 3K output tokens. The sample
assembler in Step 4 enforces this via `maxExcerptTokens`.

DeepSeek prompt:

```
You are analyzing sales call transcripts from closed WON deals to discover 
the specific behavioral patterns that characterize how this company wins.

These are customer speaker turns from {sampleSize} won deals. The median 
sales cycle for this pipeline is {wonMedianDays} days.

TRANSCRIPT EXCERPTS:
{For each sample: "Deal: {dealName} | Day {daysFromOpen} of {cycleDays} | {excerpt}"}

YOUR TASK:
Identify 4–7 distinct behavioral milestones that recur across these won deals.
These should be specific behaviors observable in transcripts — things the buyer 
SAID or DID, not things the rep did.

Good milestones are:
- Specific to this company's motion (not generic GTM theory)
- Named in language that reflects what actually appears in these transcripts
- Observable and verifiable (could be checked against a new transcript)
- Sequenced — they occur in a natural order as deals progress

Bad milestones are:
- Generic ("stakeholders engaged", "good discovery")
- Rep-centric ("rep sent proposal", "rep followed up")
- Not evidenced in the excerpts provided

For each milestone, return:
{
  "id": "snake_case_identifier",
  "title": "Short name (3–6 words, buyer-centric)",
  "description": "One sentence. What specifically did the buyer say or do?",
  "evidence": ["2–3 direct phrases or paraphrases from the transcripts above that support this milestone"],
  "typical_timing": "early | mid | late",  // when in the cycle this typically appears
  "recurrence": "high | medium | low",     // how often across the sample you see this
  "signals": [
    "Specific observable signal 1",
    "Specific observable signal 2",
    "Specific observable signal 3"
  ]
}

Return a JSON array of 4–7 milestones. No preamble. No explanation. JSON only.
```

Parse the DeepSeek response. Validate each discovered milestone has all
required fields. Discard any with `recurrence: "low"` and fewer than 2
evidence items — they're noise.

If DeepSeek returns fewer than 3 valid milestones, fall back to the v1
predefined taxonomy with a flag: `discoveryFailed: true`. Log the reason.

---

## Step 6: Lift scoring against discovered milestones (COMPUTE)

Once milestones are discovered, score them against the full closed deal
population — not just the sample used for discovery.

For each discovered milestone, we need to know: what % of ALL won deals
showed this behavior, and what % of lost deals? This requires a second
DeepSeek pass — but against individual deals, not the aggregate sample.

**This is expensive if done naively. Apply strict budget controls:**

```
Budget rule:
- Max 50 deals scored per milestone (25 won + 25 lost, sampled by recency)
- Max 1 call per deal for scoring (the most relevant call by duration)
- Max 150 tokens per call excerpt for scoring
- Run scoring for the top 5 milestones by recurrence only
- Total DeepSeek calls: 5 milestones × 50 deals = 250 calls MAX
  → Batch into groups of 10 deals per call to reduce to 25 DeepSeek calls
```

Batched scoring prompt per milestone:

```
Milestone to detect: "{title}"
Definition: {description}
Observable signals: {signals joined}

For each deal excerpt below, return true if this milestone is clearly 
present, false if absent or unclear. JSON only: {"deal_id": boolean, ...}

{Up to 10 deal excerpts}
```

From scoring results, compute per milestone:
- `wonPct`: % of won deals scored where milestone = true
- `lostPct`: % of lost deals scored where milestone = true  
- `lift`: wonPct / lostPct (if lostPct = 0, cap at 5.0)
- `avgDaysToMilestone`: median days_from_open for scored won deals
  where milestone = true

Assign each milestone to a time window column based on `avgDaysToMilestone`
relative to the pipeline's `wonMedianDays`.

---

## Step 7: Lost absence derivation (COMPUTE)

For each discovered milestone, the lost absence card is derived from
scoring results — not predefined.

```typescript
function deriveLostAbsence(milestone: DiscoveredMilestone): LostAbsence {
  return {
    milestoneId: milestone.id,
    // Flip the title to describe absence
    // "Workflow fit confirmed by buyer" → "Buyer never confirmed workflow fit"
    // Do NOT hardcode these — pass the milestone title to a simple
    // string transform: prepend "Buyer never" or "No [milestone noun]"
    // The Claude synthesis step will rewrite these into natural language
    title: `Absent: ${milestone.title}`,
    source: 'CI',
    lostDealPct: 1 - milestone.lostPct,
    liftIfPresent: milestone.lift,
  };
}
```

---

## Step 8: Fallback for Tiers 2–4 (unchanged from v1)

If the tier probe returns tier 2, 3, or 4 (no usable conversation data),
skip Steps 4–7 entirely and use the v1 predefined milestone taxonomy.

The v1 predefined milestones are still correct as structural proxies when
no transcript content exists. They are only wrong when presented as
discovered insights. At Tier 2–4, they are explicitly labeled as proxies:

```typescript
const IS_DISCOVERED = false;  // set true only when Steps 4–7 ran
```

The UI renders a different header for discovered vs. proxy milestones:
- Tier 1 discovered: "How {workspaceName} wins — discovered from {N} closed deals"
- Tier 2–4 proxy: "Structural proxies — connect conversation intelligence
  for deal-specific discovery"

---

## Step 9: Claude synthesis (SYNTHESIZE)

Claude receives the completed milestone matrix plus discovery metadata.
Input target: < 4K tokens.

```
Pipeline: {pipelineName}
Won cycle median: {wonMedianDays} days
Analysis: {totalWonDeals} won + {totalLostDeals} lost deals, 
          trailing 18 months
Discovery: {discoveryMethod} — {sampleSize} transcripts analyzed

DISCOVERED MILESTONES (ordered by avg timing):
{For each milestone: id, title, description, wonPct, lift, avgDaysToMilestone,
 top 2 evidence phrases}

BIGGEST GAPS (milestones with highest won/lost divergence):
{Top 3 milestones by lift, sorted desc}

PIPELINE CONTEXT (from Pipeline Mechanics):
Won median: {wonMedianDays}d | Lost median: {lostMedianDays}d
Signal gap at {highestGapStage}: {gapMultiplier}× 
  (won {wonDaysInStage}d vs lost {lostDaysInStage}d)

YOUR TASK:
Write a Behavioral Winning Path analysis for {pipelineName}. 
3–4 paragraphs. No generic GTM advice. Everything you say must be 
grounded in the discovered milestones and pipeline data above.

Structure:
1. What this pipeline's winning motion actually looks like, in specific 
   behavioral terms (not stage names). Use the milestone titles and 
   evidence phrases.
2. The single most differentiating behavior — highest lift milestone — 
   and what it implies about how buyers here make decisions.
3. Where lost deals break down. Connect the biggest gap stage from 
   Pipeline Mechanics to the milestone absence pattern.
4. One coaching implication for reps working open deals right now.

Do not write bullet points. Do not use the phrase "it's important to".
Write like a senior RevOps analyst who has read these transcripts.
```

---

## Step 10: Output schema

The `MilestoneMatrix` interface changes for v2. Update the TypeScript
interface in both `behavioral-milestones.ts` and the frontend type
definitions:

```typescript
interface DiscoveredMilestone {
  id: string;
  title: string;              // discovered from transcripts, not predefined
  description: string;
  evidence: string[];         // 2–3 phrases from actual transcripts
  source: 'CI' | 'Email' | 'CRM Roles' | 'Stage History';
  tier: 1 | 2 | 3 | 4;
  isDiscovered: boolean;      // true = from transcript discovery; false = predefined proxy
  timeWindow: string;         // computed from pipeline cycle, e.g. "Day 0–18"
  windowStart: number;
  windowEnd: number;
  signals: string[];
  wonPct: number;
  lostPct: number;
  lift: number;
  avgDaysToMilestone: number;
  insufficientData: boolean;
}

interface MilestoneMatrix {
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  isDiscovered: boolean;      // true if discovery ran; false if predefined fallback
  discoveryNote: string;      // "Discovered from 28 won deal transcripts" OR
                              // "Predefined proxies — connect Gong to unlock discovery"
  confidenceNote: string | null;  // null for Tier 1 discovered
  wonMedianDays: number;      // pipeline-specific cycle length
  summary: string;
  wonMilestones: DiscoveredMilestone[];
  lostAbsences: LostAbsence[];
  meta: {
    totalWonDeals: number;
    totalLostDeals: number;
    wonMedianDays: number;
    lostMedianDays: number;
    transcriptsSampled: number;
    dealsScored: number;
    analysisPeriodDays: number;  // always 548 (18 months)
    generatedAt: string;
    pipelineId: string | null;
  };
}
```

---

## Step 11: UI updates (minimal)

The page component (`BehavioralWinningPathPage.tsx`) needs two small changes:

**1. Column header labels** — read from `wonMilestones[].timeWindow` rather
than hardcoded "Day 0–30" strings. The four unique time windows in the
milestone array become the four column headers.

**2. Discovery badge** — in the page header, replace the tier badge with:
- If `isDiscovered: true`: green badge "Discovered · {transcriptsSampled} transcripts"
- If `isDiscovered: false`: amber badge "Proxies · {tierLabel}"

**3. Evidence drawer** — when a milestone card is clicked, the detail panel
shows the `evidence[]` array (actual phrases from transcripts) alongside
the signals list. Label the section "From your transcripts:" and render
each phrase in a subtle quote style (left border, slightly indented).
This is the most important UI change — it's what makes discovered milestones
feel real vs. theoretical.

Everything else in the page — grid layout, card components, lost row toggle,
synthesis card, upgrade prompts — stays exactly as built.

---

## Acceptance criteria

- [ ] Cron updated to `0 5 1 1,4,7,10 *` with quarterly comment
- [ ] `getWonCyclePercentiles()` returns correct p50 for Frontera Core Sales
      Pipeline (~70 days per Pipeline Mechanics)
- [ ] Time window columns show pipeline-relative day ranges, not hardcoded
      "Day 0–30" labels
- [ ] DeepSeek discovery prompt runs against sampled transcripts and returns
      4–7 structured milestones with evidence phrases
- [ ] Discovered milestones have `isDiscovered: true` and non-empty
      `evidence[]` array
- [ ] Fallback to predefined taxonomy triggers correctly when transcript
      sample < 3 valid milestones
- [ ] Scoring pass computes `wonPct`, `lostPct`, `lift` against full
      closed deal population (not just the discovery sample)
- [ ] `wonMedianDays` in MilestoneMatrix matches Pipeline Mechanics output
      for the same pipeline — these two skills must agree on cycle length
- [ ] Claude synthesis references discovered milestone titles and evidence
      phrases — not generic GTM language
- [ ] UI column headers show actual computed day ranges per pipeline
- [ ] Evidence drawer shows `evidence[]` phrases when milestone card clicked
- [ ] Discovery badge correct: green for discovered, amber for proxies
- [ ] No TypeScript errors
- [ ] `d.created_at` used throughout — not `d.created_date` (v1 regression bug)
