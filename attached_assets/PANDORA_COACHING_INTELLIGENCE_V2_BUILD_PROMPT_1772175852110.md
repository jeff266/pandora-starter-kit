# PANDORA_COACHING_INTELLIGENCE_V2_BUILD_PROMPT.md

## Context for Replit

You've correctly identified that the current coaching signal — total deal age from `created_at` against a single global threshold — produces false positives at later stages. A deal in Pilot *should* be old. Flagging it as stalled because it's 186+ days from creation is a tautology, not a signal.

This prompt specifies three interconnected deliverables that fix the signal, surface it cohesively across pages, and leverage conversation intelligence data (Gong/Fireflies) to produce composite health scoring.

**What we're building:**
1. **Stage Velocity Benchmarks** — the `compute_stage_benchmarks` tool and backing skill
2. **Coaching Intelligence V2** — stage-specific, segment-aware, composite health signals
3. **UI integration** across three surfaces: Conversations page (list + detail), Deal Detail page, and a new Benchmarks Grid view

**What already exists that we're building on:**
- `deal_stage_history` table with `duration_in_previous_stage_ms` per stage per deal
- `win_patterns` with `segment_size_min`/`segment_size_max` segmentation
- `conversations` table with Gong/Fireflies data (participants, transcripts, action_items, source_data)
- Deal Dossier assembly function (`deal_dossier(workspaceId, dealId)`)
- Existing Coaching Intelligence tab on Conversations page
- Existing Deal Detail page with coverage gaps, contacts, findings, stage history

---

## Part 1: `compute_stage_benchmarks` Tool

### What it does

Computes time-in-stage benchmarks segmented by pipeline, stage, and deal size band. This is the P0 missing tool from the MECE map.

### Computation

```sql
-- Core query: median and p75 days-in-stage for won deals, segmented
WITH stage_durations AS (
  SELECT
    dsh.workspace_id,
    dsh.from_stage_normalized AS stage,
    d.pipeline_id,
    -- Segment by deal size
    CASE
      WHEN d.amount < ws_config.segment_boundaries[1] THEN 'smb'
      WHEN d.amount < ws_config.segment_boundaries[2] THEN 'mid_market'
      ELSE 'enterprise'
    END AS segment,
    dsh.duration_in_previous_stage_ms / 86400000.0 AS days_in_stage,
    d.stage_normalized AS outcome  -- 'closed_won' or 'closed_lost'
  FROM deal_stage_history dsh
  JOIN deals d ON d.id = dsh.deal_id
  WHERE dsh.workspace_id = $1
    AND dsh.duration_in_previous_stage_ms IS NOT NULL
    AND dsh.duration_in_previous_stage_ms > 0
    AND d.stage_normalized IN ('closed_won', 'closed_lost')
)
SELECT
  stage,
  pipeline_id,
  segment,
  outcome,
  COUNT(*) AS sample_size,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_in_stage) AS median_days,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY days_in_stage) AS p75_days,
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY days_in_stage) AS p90_days
FROM stage_durations
GROUP BY stage, pipeline_id, segment, outcome
HAVING COUNT(*) >= 3  -- minimum sample for any benchmark
```

### Output shape

```typescript
interface StageBenchmark {
  stage: string;
  pipeline_id: string;
  segment: 'smb' | 'mid_market' | 'enterprise' | 'all';
  won: {
    median_days: number;
    p75_days: number;
    p90_days: number;
    sample_size: number;
  } | null;
  lost: {
    median_days: number;
    p75_days: number;
    p90_days: number;
    sample_size: number;
  } | null;
  confidence_tier: 'high' | 'directional' | 'insufficient';
  is_inverted: boolean;  // CRITICAL: won deals take LONGER than lost
  inversion_note?: string;
}
```

### Confidence tiers

| Sample size (won deals) | Tier | UI treatment |
|---|---|---|
| ≥ 20 | `high` | Show benchmarks with full confidence |
| 5–19 | `directional` | Show benchmarks with "Based on N deals — directional" caveat |
| < 5 | `insufficient` | Suppress stage-specific signal, fall back to global |

### Inversion detection

This is the most important edge case. When `won.median_days > lost.median_days` for a stage-segment combo, the signal is inverted — longer time in stage correlates with winning, not losing. This was observed in Frontera's Mid-Market data at Evaluation and Negotiation.

```typescript
// Detection
const isInverted = won.median_days > lost.median_days * 1.2; // 20% buffer

// When inverted:
// - Do NOT flag deals as stalled for spending longer in this stage
// - Instead, flag deals that move THROUGH this stage unusually fast
//   as potential premature advancement
// - UI shows: "Winning deals spend longer here — fast exits correlate with losses"
```

### Storage

Store computed benchmarks in a `stage_velocity_benchmarks` table (or as a JSON result in skill_runs if you prefer the existing pattern). Recompute on sync cadence — same schedule as win patterns.

```sql
CREATE TABLE IF NOT EXISTS stage_velocity_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  pipeline_id TEXT NOT NULL,
  stage_normalized TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT 'all',
  outcome TEXT NOT NULL,  -- 'won' or 'lost'
  median_days NUMERIC,
  p75_days NUMERIC,
  p90_days NUMERIC,
  sample_size INTEGER NOT NULL,
  confidence_tier TEXT NOT NULL,
  is_inverted BOOLEAN DEFAULT FALSE,
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, pipeline_id, stage_normalized, segment, outcome)
);
```

### Segment boundary resolution

Pull segment boundaries from workspace config. If `deal_size_buckets` are configured, use those. If not, auto-detect from deal amount distribution:

```typescript
function resolveSegmentBoundaries(workspaceId: string): number[] {
  // 1. Check workspace_config for explicit boundaries
  const config = getWorkspaceConfig(workspaceId);
  if (config?.deal_size_buckets) return config.deal_size_buckets;

  // 2. Fall back to percentile-based auto-detection
  // P25 and P75 of deal amounts where amount > 0
  const boundaries = computePercentiles(workspaceId, [0.25, 0.75]);
  return boundaries; // e.g., [10000, 50000]
}
```

---

## Part 2: Coaching Signal V2 — Composite Health Scoring

### Replace the current signal computation

The current coaching signal in the Conversations page uses:
```
stalled = deal_age_days > 2 × global_won_p75
slowing = deal_age_days > global_won_p75
```

Replace with stage-specific + engagement composite:

### Step 1: Stage velocity signal

For each open deal:

```typescript
function computeVelocitySignal(deal, benchmarks: StageBenchmark): VelocitySignal {
  const benchmark = benchmarks.find(b =>
    b.stage === deal.stage_normalized &&
    b.pipeline_id === deal.pipeline_id &&
    b.segment === classifySegment(deal.amount)
  );

  // Fall back: try 'all' segment if specific segment has insufficient data
  if (!benchmark || benchmark.confidence_tier === 'insufficient') {
    benchmark = benchmarks.find(b =>
      b.stage === deal.stage_normalized &&
      b.pipeline_id === deal.pipeline_id &&
      b.segment === 'all'
    );
  }

  // If still no benchmark, fall back to old global signal (graceful degradation)
  if (!benchmark) return computeLegacySignal(deal);

  const daysInStage = deal.days_in_current_stage;

  // Handle inverted stages
  if (benchmark.is_inverted) {
    // In inverted stages, FAST movement is the risk signal
    if (daysInStage < benchmark.won.median_days * 0.5) {
      return { signal: 'premature', color: 'yellow', ratio: null,
        explanation: `Winning deals spend longer here (${benchmark.won.median_days}d median). Moving through in ${daysInStage}d may indicate insufficient engagement.` };
    }
    return { signal: 'on_track', color: 'green', ratio: null,
      explanation: `This is a stage where winning deals take their time. ${daysInStage}d is healthy.` };
  }

  // Normal stages: longer = more risk
  const ratio = daysInStage / benchmark.won.median_days;

  if (ratio <= 1.2) {
    return { signal: 'on_pace', color: 'green', ratio,
      explanation: `${daysInStage}d in ${deal.stage} — right on track with your ${benchmark.won.median_days}d win pace.` };
  }
  if (ratio <= 2.0) {
    return { signal: 'running_long', color: 'yellow', ratio,
      explanation: `${daysInStage}d in ${deal.stage} — ${ratio.toFixed(1)}× your typical win pace of ${benchmark.won.median_days}d. Watch closely.` };
  }
  // Beyond 2x: compare to lost deal pace
  if (benchmark.lost && daysInStage > benchmark.lost.median_days) {
    return { signal: 'outlier', color: 'red', ratio,
      explanation: `${daysInStage}d in ${deal.stage} — past your lost deal median of ${benchmark.lost.median_days}d. This needs intervention or disqualification.` };
  }
  return { signal: 'stalled', color: 'red', ratio,
    explanation: `${daysInStage}d in ${deal.stage} — ${ratio.toFixed(1)}× your win pace. Lost deals average ${benchmark.lost?.median_days || '?'}d here.` };
}
```

### Step 2: Engagement signal

Computed from conversation data (Gong/Fireflies). Only available when workspace has a conversation connector.

```typescript
interface EngagementSignal {
  call_recency: {
    days_since_last_call: number | null;
    signal: 'active' | 'cooling' | 'dark';
    color: 'green' | 'yellow' | 'red' | 'gray';
    explanation: string;
  };
  multi_threading: {
    current_contacts: number;
    trend: 'improving' | 'stable' | 'declining';
    benchmark_contacts: number;  // avg contacts on won deals at this stage
    signal: 'strong' | 'adequate' | 'thin';
    color: 'green' | 'yellow' | 'red';
  };
  missing_stakeholders: {
    contacts: Array<{ name: string; role: string; last_seen?: string }>;
    has_economic_buyer: boolean;
    signal: 'covered' | 'gaps' | 'critical_gaps';
    color: 'green' | 'yellow' | 'red';
  };
  composite: {
    signal: 'active' | 'mixed' | 'going_dark';
    color: 'green' | 'yellow' | 'red';
  };
}

function computeEngagementSignal(deal, conversations, contacts): EngagementSignal {
  // Call recency
  const lastCall = conversations
    .filter(c => c.deal_id === deal.id)
    .sort((a, b) => b.started_at - a.started_at)[0];
  const daysSinceCall = lastCall
    ? daysBetween(lastCall.started_at, now())
    : null;

  // Thresholds: derive from won deal conversation cadence at this stage
  // For now, use reasonable defaults:
  const callRecency = daysSinceCall === null
    ? { signal: 'dark', color: 'gray', explanation: 'No recorded calls on this deal.' }
    : daysSinceCall <= 14
      ? { signal: 'active', color: 'green', explanation: `Last call ${daysSinceCall}d ago.` }
      : daysSinceCall <= 30
        ? { signal: 'cooling', color: 'yellow', explanation: `Last call ${daysSinceCall}d ago — engagement cooling.` }
        : { signal: 'dark', color: 'red', explanation: `Last call ${daysSinceCall}d ago — going dark.` };

  // Multi-threading: unique buyer contacts across recent calls
  // ... (compute from conversation participants)

  // Missing stakeholders: contacts on deal but NOT on any call
  // Cross-reference deal_contacts with conversation participants
  // Flag contacts with buying_role = 'executive_sponsor' or 'decision_maker' as critical

  // Composite: worst-of call_recency and missing_stakeholders, tempered by multi_threading trend
  // ...
}
```

### Step 3: Composite health signal (the 2×2)

```typescript
interface CompositeHealth {
  velocity: VelocitySignal;
  engagement: EngagementSignal;
  composite: {
    label: string;     // "Healthy" | "Running Long, But Active" | "Early Warning" | "At Risk" | "Critical"
    color: string;     // green | yellow | amber | red
    summary: string;   // Plain-English 1-2 sentence summary
    next_step: string; // Actionable recommendation
  };
}

function computeCompositeHealth(velocity, engagement): CompositeHealth {
  // Matrix:
  // velocity green  + engagement green  → "Healthy"
  // velocity green  + engagement red    → "Early Warning — Going Dark"
  // velocity yellow + engagement green  → "Running Long, But Showing Life"
  // velocity yellow + engagement yellow → "Watch Closely"
  // velocity yellow + engagement red    → "At Risk"
  // velocity red    + engagement green  → "Stalled, But Active — Needs Intervention"
  // velocity red    + engagement red    → "Critical — Likely Lost"

  // If no conversation data (engagement is null/gray):
  // Fall back to velocity-only signal with caveat
}
```

### Step 4: Action tracking integration

Pull action items from Gong/Fireflies conversation data:

```typescript
// Source: conversations.action_items (Fireflies native)
// Source: conversations.source_data.trackers (Gong — if action item trackers configured)
// Source: DeepSeek extraction from transcript if neither above available

interface ActionItem {
  text: string;
  owner: string;           // extracted from transcript context
  source_conversation_id: string;
  source_conversation_title: string;
  source_date: string;
  due_date?: string;       // if extractable from context
  status: 'open' | 'overdue' | 'done';
  context: string;         // surrounding transcript context
}
```

For Fireflies, action items come structured from `conversations.action_items` JSONB field. Map directly.

For Gong, action items aren't natively structured the same way. Options:
- Use Gong's `trackers` if the workspace has "action item" trackers configured
- Fall back to DeepSeek classification of transcript segments (batch, on sync)
- Mark as "action items unavailable" with graceful degradation

For action item completion tracking:
- Compare action items from call N against transcript content from call N+1
- If the action item topic appears as "done" or "completed" in the next call, mark done
- Otherwise, if due_date < today, mark overdue
- This is a DeepSeek classification task — run on sync, not on page load

---

## Part 3: UI Integration — Three Surfaces

### Surface 1: Conversations Page (List + Detail)

**List view changes:**

The Pipeline by Stage · Urgency chart and the Coaching Intelligence filter bar now use the composite health signal instead of the global age-based signal.

The urgency categories change from the current set to:
- **Critical** — velocity red + engagement red (or velocity red + no engagement data)
- **At Risk** — velocity red + engagement mixed, OR velocity yellow + engagement red
- **Watch** — velocity yellow + engagement yellow or green
- **Healthy** — velocity green (regardless of engagement)

The stacked bar chart segments by these new categories. Crucially, later stages no longer automatically skew red. A Pilot deal that's 63 days in with active calls shows as "Watch" (yellow), not "Stalled" (red).

The filter bar (`Stalled | Slowing | On Track | Closing Fast`) changes to the new categories above. Add "Clear all" to reset.

The deal count next to each filter should be meaningful — if "Critical" shows 3 instead of 15, that's the signal quality improvement.

**Conversation detail changes:**

Replace the current three tabs (`Deal Impact | Action Tracker | Coaching Signals`) with:

`Deal Health | Action Tracker | Coaching Signals`

**Deal Health tab:** This is the new tab. Shows:
- Composite verdict banner at top (plain-English: "Running Long, But Showing Life")
  - 1-2 sentence explanation
  - Suggested next step
- Stage Journey panel: each stage the deal has passed through, with:
  - Days this deal spent in that stage
  - Signal dot (green/yellow/red) based on stage-specific benchmark
  - Expandable comparison bars: This deal vs Won median vs Lost median
  - Plain-English explanation per stage
  - Confidence footer ("Based on N closed-won deals")
- Engagement Signals panel (right column):
  - Call recency with signal
  - Multi-threading count + trend
  - Missing stakeholders with names and roles
- Recent Conversations list

**Action Tracker tab:** Shows:
- Summary banner: "N overdue action items — total X days overdue"
  - Plain-English diagnosis: "The deal isn't stuck because of the buyer — it's stuck because of follow-through" (or whatever the AI synthesis produces)
- Overdue items (sorted by days overdue, most overdue first)
  - Each item expandable to show: source call, date committed, context from transcript
- Completed items (collapsed by default)
- Commitment timeline (chronological view of all action items with status)

Data source: `conversations.action_items` (Fireflies) or DeepSeek extraction (Gong/no native action items).
If no conversation connector, show: "Connect Gong or Fireflies to track action items from calls."

**Coaching Signals tab:** Shows:
- Velocity gauge: visual spectrum from "Win pace" to "Lose pace" with deal position
  - Countdown: "At current pace, reaches lost-deal territory in ~N days"
- Last Call Quality section (from conversation source_data):
  - Talk ratio (Gong native, or computed from Fireflies sentences)
  - Questions asked (Gong native `question_count`, or DeepSeek extraction)
  - Next steps set (action item count from call)
  - Competitor mentions (Gong trackers, or DeepSeek extraction)
  - Each with signal dot + benchmark explanation
- Deal Patterns: risk signals and positive signals side by side
  - Economic buyer not engaged (from missing stakeholders)
  - Competitor mentioned without follow-up (from transcript analysis)
  - Multi-threading improving (from contact trend)
  - Call cadence consistent (from conversation timestamps)
- Manager Coaching Script: AI-generated 1:1 talking points
  - Opener + 2-3 numbered coaching points
  - Grounded in specific call data, action items, and patterns
  - Generated by Claude synthesis on demand (button: "Generate Coaching Script")
  - Inputs to Claude: deal dossier + conversation history + action items + velocity signal

**Graceful degradation by data availability:**

| Data available | Deal Health tab | Action Tracker tab | Coaching Signals tab |
|---|---|---|---|
| CRM only (no conversations) | Stage journey + velocity signal only. Engagement panel shows "Connect Gong or Fireflies" | "No conversation data" | Velocity gauge only. Call quality hidden. Patterns limited to CRM signals |
| CRM + Fireflies | Full experience. Action items from Fireflies native. Talk ratio computed from sentences | Full experience | Full minus Gong-specific metrics (interactivity, patience) |
| CRM + Gong | Full experience. Action items from DeepSeek extraction or Gong trackers | Partial (action items less structured) | Full experience including Gong-native call quality metrics |
| CRM + Gong + Fireflies | Full experience, prefer Gong for call quality metrics, Fireflies for action items | Full experience | Full experience |

### Surface 2: Deal Detail Page

The Deal Detail page already shows a lot of relevant data (from the screenshot: coverage gaps, contacts with engagement status, findings, stage history). The coaching intelligence data should flow into this page to create a cohesive experience.

**Changes to Deal Detail header area:**

The current header shows:
```
Activity: Active | Threading: Multi-Threaded | Velocity: Check Velocity | Data: 100% Complete
```

Replace the "Velocity: Check Velocity" indicator with the new composite health signal. The four-indicator strip becomes:

```
Activity: Active | Threading: Multi-Threaded | Health: Running Long ⚠️ | Data: 100% Complete
```

Where "Health" uses the composite label and color from the coaching signal computation. Clicking it opens an expanded panel (or navigates to the Conversations detail view for this deal's most recent conversation).

**Add a "Stage Velocity" section to Deal Detail:**

Below the existing Stage History timeline, add a velocity benchmark overlay. For each stage the deal has passed through, show:

```
Stage History (existing)                 Velocity Benchmark (new overlay)
├─ Appointment Scheduled                 6d (Won avg: 4d) ● On pace
│   Apr 3, 2025 · 0d
├─ Qualified to Buy                      12d (Won avg: 7d) ● Running long
│   Apr 3, 2025 · 20d
├─ ...
```

This is a lightweight enhancement — the stage history already renders as a timeline. Add a right-aligned column with the benchmark comparison.

**Integrate the Findings section with coaching signals:**

The existing Findings section already shows `Finding from flagged_deals | Warning | stage-velocity-benchmarks · 3d ago`. This is the existing mechanism for surfacing skill findings on the deal detail page.

When the Stage Velocity Benchmarks skill runs, its findings should include per-deal velocity signals. These flow into the existing findings infrastructure:

```typescript
// Finding generated by stage-velocity-benchmarks skill run
{
  skill_id: 'stage-velocity-benchmarks',
  severity: 'warning',  // or 'critical' for red signals
  entity_type: 'deal',
  entity_id: dealId,
  message: `${dealName} has been in ${stage} for ${days}d — ${ratio}× your win pace of ${benchmark}d`,
  metadata: {
    stage: 'pilot',
    days_in_stage: 63,
    won_median: 45,
    ratio: 1.4,
    segment: 'smb',
    confidence_tier: 'high',
    composite_health: 'running_long_but_active'
  }
}
```

**Connect the "Ask about this deal" chat to coaching data:**

The Deal Detail page has an "Ask about this deal" button. When the scoped analysis endpoint processes a question about a deal, it should include the stage velocity benchmarks and coaching signals in the context passed to Claude. This means the `/analyze` endpoint's deal scope data pull should include:

```typescript
// Add to deal_dossier assembly
deal_dossier.velocity_benchmarks = await getStageVelocityForDeal(workspaceId, dealId);
deal_dossier.coaching_signals = await computeCompositeHealth(deal, benchmarks, conversations, contacts);
deal_dossier.action_items = await getActionItemsForDeal(workspaceId, dealId);
```

### Surface 3: Benchmarks Grid View (New Page)

This is a new view accessible from the sidebar — either under Intelligence or as a sub-view of the Conversations page. It shows the "what good looks like" matrix that we computed from the database.

**Grid structure:**

```
                    Qualification   Evaluation   Negotiation   Decision   Pilot
SMB (<$10k)
  Won median          4d              7d           1d           2d        45d
  Lost median         10d             74d          14d          30d       90d
  Signal gap          2.5×            10.6×        14×          15×       2×
  Open now (avg)      8d              2d           5d           12d       63d
  Sample (won)        50              50           50           50        50
  Confidence          High            High         High         High      High

Mid-Market ($10k-$50k)
  Won median          5d              17d          22d          56d       —
  Lost median         9d              4d           7d           185d      —
  Signal gap          1.8×            INVERTED ⚠️   INVERTED ⚠️  3.3×      —
  Open now (avg)      7d              53d          3d           17d       —
  Sample (won)        6               6            6            6         —
  Confidence          Directional     Directional  Directional  Directional —

Enterprise ($50k+)
  Won median          9d              —            23d          —         —
  Lost median         9d              22d          58d          103d      —
  Sample (won)        <5              <5           <5           <5        —
  Confidence          Insufficient    Insufficient Insufficient Insufficient —
```

**Grid features:**
- Pipeline selector dropdown (if workspace has multiple pipelines)
- Segment rows are collapsible
- Inverted stages highlighted with ⚠️ icon and explanation tooltip: "In this segment, winning deals spend *longer* at this stage. Fast exits correlate with losses."
- Insufficient data cells are dimmed/grayed out
- "Open now" row shows where current deals sit relative to benchmarks — cells turn yellow/red if the average exceeds the won median
- Clicking a cell drills into the underlying deals (filtered list view)
- Column sorting by any metric
- Refresh button that re-runs the benchmark computation

**This page serves two audiences:**
1. **VP of RevOps** reviewing their sales process: "Where do deals get stuck? How should I set stage exit criteria?"
2. **Sales managers** coaching reps: "What should I tell a rep whose deal has been in Evaluation for 20 days?" — they look at the grid, see won median is 7d for SMB, and know this is a conversation to have.

---

## Part 4: Data Flow Architecture

### How conversation data feeds into coaching signals

```
┌──────────────┐     ┌──────────────┐     ┌────────────────────┐
│   Gong API   │     │ Fireflies API│     │   CRM (HubSpot/    │
│              │     │              │     │   Salesforce)       │
└──────┬───────┘     └──────┬───────┘     └────────┬───────────┘
       │                    │                      │
       ▼                    ▼                      ▼
┌──────────────────────────────────────────────────────────────┐
│                    Sync Layer (existing)                      │
│  conversations table │ deals table │ deal_stage_history       │
│  contacts table      │ activities  │ deal_contacts            │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────┐   ┌───────────────────────────────┐
│ compute_stage_benchmarks │   │ Engagement Signal Computation  │
│ (runs on sync cadence)   │   │ (runs on sync cadence)         │
│                          │   │                                │
│ Input: deal_stage_history│   │ Input: conversations,          │
│        + deals (outcome) │   │   deal_contacts, contacts      │
│                          │   │                                │
│ Output: stage_velocity_  │   │ Output: per-deal engagement    │
│         benchmarks table │   │   signals (stored in findings  │
│                          │   │   or computed on demand)        │
└──────────┬───────────────┘   └──────────────┬────────────────┘
           │                                  │
           ▼                                  ▼
┌──────────────────────────────────────────────────────────────┐
│              Composite Health Computation                     │
│  Input: velocity signal + engagement signal                  │
│  Output: per-deal composite health (label, color, summary)   │
│  Stored: findings table (for list views + deal detail)       │
│  Computed: on demand for detail views (for latest data)      │
└──────────────────────────┬───────────────────────────────────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
     ┌────────────┐ ┌───────────┐ ┌──────────────┐
     │Conversations│ │Deal Detail│ │ Benchmarks   │
     │Page (list + │ │Page       │ │ Grid View    │
     │detail)      │ │           │ │              │
     └─────────────┘ └───────────┘ └──────────────┘
```

### What gets computed on sync vs on demand

**On sync (batch, when CRM data refreshes):**
- Stage velocity benchmarks (full recompute — fast, ~200ms SQL)
- Per-deal velocity signal for all open deals (write to findings table)
- Per-deal engagement signal for all open deals with conversation data
- Per-deal composite health for all open deals
- Action item extraction from new conversations (DeepSeek, batched)

**On demand (when user opens a page):**
- Deal dossier assembly (existing pattern — assembles from pre-computed tables)
- Coaching script generation (Claude synthesis — only when user clicks "Generate")
- Benchmark grid data (reads from pre-computed benchmarks table)

### API endpoints needed

```
GET /api/workspaces/:id/stage-benchmarks
  Query: pipeline_id, segment (optional)
  Returns: StageBenchmark[] — the full grid data
  Source: stage_velocity_benchmarks table

GET /api/workspaces/:id/deals/:dealId/coaching
  Returns: {
    velocity: VelocitySignal,
    engagement: EngagementSignal | null,
    composite: CompositeHealth,
    action_items: ActionItem[],
    stage_journey: StageJourneyEntry[]  // deal's stages with benchmark comparison
  }
  Source: computed from benchmarks + conversations + deal_stage_history

GET /api/workspaces/:id/deals/:dealId/coaching-script
  Returns: { script: CoachingScript }
  Source: Claude synthesis on demand (uses deal dossier + coaching data as input)
  Cost: ~2K tokens per generation

PATCH on existing endpoints:
  GET /api/workspaces/:id/conversations/coaching
    → Use new composite health signals instead of global age-based
    → Filter categories change to: critical, at_risk, watch, healthy

  GET /api/workspaces/:id/deals/:dealId/dossier
    → Include velocity_benchmarks and coaching_signals in response
```

---

## Part 5: Deal Dossier Integration

The existing `deal_dossier()` function should be extended to include coaching intelligence data. This makes the Deal Detail page and the "Ask about this deal" chat automatically coaching-aware.

### Additions to deal_dossier assembly

```typescript
// Add to the existing deal_dossier function:
deal_dossier.coaching = {
  // Stage velocity for each stage this deal has been through
  stage_journey: deal.stageHistory.map(stage => ({
    stage: stage.to_stage,
    days_in_stage: stage.duration_days,
    benchmark: lookupBenchmark(stage.to_stage, deal.pipeline_id, deal.segment),
    // Returns: { won_median, lost_median, sample_size, confidence_tier, is_inverted }
    signal: computeStageSignal(stage.duration_days, benchmark),
    // Returns: { color, label, explanation }
  })),

  // Current stage health
  current_velocity: computeVelocitySignal(deal, benchmarks),

  // Engagement (null if no conversation connector)
  engagement: hasConversationData
    ? computeEngagementSignal(deal, conversations, contacts)
    : null,

  // Composite
  composite: computeCompositeHealth(velocity, engagement),

  // Action items from conversations
  action_items: extractActionItems(conversations),
};
```

### How the Deal Detail page consumes this

The existing Deal Detail page already calls the dossier endpoint. With coaching data added to the dossier response, the frontend can render:

1. **Header health indicator** — reads `dossier.coaching.composite.label` and `.color`
2. **Stage History velocity overlay** — reads `dossier.coaching.stage_journey[]`
3. **Coverage Gaps enhancement** — the existing Coverage Gaps section already shows "Key Contacts Never Engaged." With coaching data, also show:
   - "Key contacts not on recent calls" (from engagement.missing_stakeholders)
   - This unifies the Deal Detail coverage gaps with the Conversation detail missing stakeholders
4. **Findings integration** — coaching findings appear in the existing Findings section (already wired)

---

## Build Sequence

### Phase 1: Backend (do first)

1. **Migration: `stage_velocity_benchmarks` table** — create table, indexes
2. **`compute_stage_benchmarks` tool** — the SQL computation with segmentation, confidence tiers, inversion detection
3. **Wire into sync cadence** — recompute on same schedule as win patterns
4. **Coaching signal computation functions** — velocity, engagement, composite
5. **API endpoints** — `/stage-benchmarks`, `/deals/:id/coaching`, PATCH existing endpoints
6. **Extend `deal_dossier` assembly** — add coaching data to dossier response
7. **Action item extraction** — wire Fireflies action_items, add DeepSeek fallback for Gong

### Phase 2: Frontend — Conversations Page

8. **Replace urgency computation** — swap global age-based signal for composite health
9. **Update chart + filter bar** — new categories (Critical, At Risk, Watch, Healthy)
10. **Conversation detail tabs** — implement Deal Health, Action Tracker, Coaching Signals
11. **Graceful degradation** — handle no-conversation-data cases

### Phase 3: Frontend — Deal Detail + Grid

12. **Deal Detail header** — composite health indicator in the status strip
13. **Deal Detail stage history** — velocity benchmark overlay on timeline
14. **Benchmarks Grid page** — new page with Segment × Stage × metrics matrix
15. **Navigation** — add grid page to sidebar

### Phase 4: AI Features

16. **Coaching script generation** — Claude synthesis endpoint
17. **Action item completion tracking** — DeepSeek cross-call comparison
18. **Deal Dossier narrative** — include coaching context in "Ask about this deal" responses

---

## Test Against Frontera

The real data from Frontera's database (included in our conversation) serves as the validation set:

**Expected outcomes after implementation:**
- SMB deals in Evaluation for 60d → flagged as outlier (10× win pace) ✅ correct signal
- SMB deals in Pilot for 63d → flagged as running long (1.4× win pace), NOT stalled ✅ fixes false positive
- Mid-Market deals in Evaluation for 20d → NOT flagged (inverted stage) ✅ fixes inverted signal
- Mid-Market deals blowing through Evaluation in 3d → flagged as premature ✅ new useful signal
- Enterprise deals → "Directional" or "Insufficient" confidence labels ✅ honest about data quality
- Coaching Intelligence filter: "Critical" shows ~3-5 deals instead of 15 ✅ trustworthy, triageable
- Deal Detail for "Action Behavior Centers - DB" ($150k, Decision stage) → shows composite health in header, velocity benchmark in stage history ✅ cohesive experience

**Regression checks:**
- Workspaces with NO deal_stage_history → graceful fallback to legacy signal
- Workspaces with NO conversation connector → velocity-only signal, engagement panels show "connect" CTA
- Stages with < 3 data points → suppressed (no false confidence)
- New workspaces with zero closed deals → "Insufficient data to compute benchmarks" message
