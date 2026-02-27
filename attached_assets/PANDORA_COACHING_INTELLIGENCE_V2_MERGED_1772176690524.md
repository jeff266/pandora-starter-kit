# PANDORA_COACHING_INTELLIGENCE_V2_BUILD_PROMPT — MERGED

## Objective

Build Coaching Intelligence V2: replace the broken global age-based urgency signal with stage-specific, segment-aware velocity benchmarks and composite health scoring. Surface the new signal across three UI pages.

The core bug: a deal in Evaluation for 60 days is flagged as "stalled" for the same reason as a deal that's just been alive 6 months — both measure `sales_cycle_days > 2 × global_won_p75`. This is a tautology at later stages. The fix benchmarks `days_in_current_stage` against how long won deals spent in *that specific stage and segment*, producing actionable triage ("3 critical deals") instead of noise ("15 stalled deals").

---

## What Already Exists (Don't Rebuild)

- `deal_stage_history` with `duration_days` (time spent in each stage) and `stage_normalized`
- `svbComputeBenchmarks` tool (outcome-agnostic, no segmentation — we add won/lost split and segments on top)
- `coaching-breakdown` endpoint + `COACHED_DEALS_CTE` (we replace the signal classification logic)
- Win pattern discovery trigger logic in `post-sync-events.ts` (mirror for benchmark compute)
- `stage-velocity-benchmarks` skill (keeps its LLM-synthesis role; we add pre-compute storage below it)
- `conversations` table with Gong/Fireflies data (participants, transcripts, action_items, source_data)
- Deal Dossier assembly function (`deal_dossier(workspaceId, dealId)`)

## What's New

- `stage_velocity_benchmarks` table — pre-computed won/lost benchmarks per stage × segment × pipeline
- `server/coaching/stage-benchmarks.ts` — compute, store, and look up benchmarks
- New health categories: `healthy` / `watch` / `at_risk` / `critical` (replacing fast / on_track / slowing / stalled)
- Unified filter bar on Conversations tab (owner + stage + health category)
- Stage Journey panel in Conversation Detail — each stage vs benchmark
- Action Tracker tab in Conversation Detail — overdue commitments from call transcripts
- Coaching Signals tab in Conversation Detail — velocity gauge, call quality, deal patterns, coaching script
- Benchmarks Grid page ("What Good Looks Like") — the stage × segment matrix for manager review
- Stage Velocity nav item under INTELLIGENCE
- Deal Detail page integration — composite health indicator + stage velocity overlay
- Deal Dossier extension — coaching data included in dossier assembly for "Ask about this deal" context

---

## Tasks

### T001: Migration + `computeStageBenchmarks` Function

**Blocked By:** []

**Details:**

Create `migrations/109_stage_velocity_benchmarks.sql`:

```sql
CREATE TABLE IF NOT EXISTS stage_velocity_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  pipeline TEXT NOT NULL DEFAULT 'all',
  stage_normalized TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT 'all',  -- smb / mid_market / enterprise / all
  outcome TEXT NOT NULL,                -- won / lost
  median_days NUMERIC,
  p75_days NUMERIC,
  p90_days NUMERIC,
  sample_size INTEGER NOT NULL,
  confidence_tier TEXT NOT NULL,        -- high / directional / insufficient
  is_inverted BOOLEAN DEFAULT FALSE,
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, pipeline, stage_normalized, segment, outcome)
);
CREATE INDEX idx_svb_lookup
  ON stage_velocity_benchmarks(workspace_id, stage_normalized, segment);
```

Add migration file to `server/migrate.ts` migration list.

Create `server/coaching/stage-benchmarks.ts` with:

- **`autoDetectSegmentBoundaries(workspaceId)`** — queries P25/P75 of amount from deals where amount > 0; returns `[low, high]` cutoffs. If workspace config has explicit `deal_size_buckets`, use those instead.
- **`computeAndStoreStageBenchmarks(workspaceId)`** — joins `deal_stage_history` + `deals` where outcome is `closed_won` or `closed_lost`; groups by `stage_normalized × segment × outcome × pipeline`; uses `duration_days` column (already computed); computes median/p75/p90 via `PERCENTILE_CONT`; requires `COUNT(*) >= 3` per group; sets confidence tier (≥20 = high, 5–19 = directional, <5 = insufficient); detects inversion (`won.median > lost.median × 1.2`); upserts to `stage_velocity_benchmarks`. Also computes an 'all' segment row per stage (unsegmented) as a fallback.
- **`lookupBenchmark(workspaceId, stage, segment, pipeline?)`** — reads from table; falls back: specific segment → 'all' segment → null.
- **`computeVelocitySignal(daysInStage, benchmark)`** — returns `{ signal: 'healthy'|'watch'|'at_risk'|'critical'|'premature', ratio, explanation }`. Inverted stages: fast movement (`< won.median × 0.5`) is the risk signal. Normal stages: ratio ≤ 1.2 = healthy, 1.2–2.0 = watch, > 2.0 and < lost.median = at_risk, > lost.median = critical. No benchmark: legacy fallback using `days > won_p75 * 2`.

**Files:** `migrations/109_stage_velocity_benchmarks.sql`, `server/coaching/stage-benchmarks.ts`, `server/migrate.ts`

**Acceptance:** `computeAndStoreStageBenchmarks` can be called manually and populates the table; `lookupBenchmark` returns the Frontera SMB/Evaluation row with won.median=7d, lost.median=74d, confidence=high, is_inverted=false. Mid-Market Evaluation row has is_inverted=true. The 'all' segment fallback row exists per stage.

---

### T002: Sync Wiring + New API Routes

**Blocked By:** [T001]

**Details:**

In `server/sync/post-sync-events.ts`: add `maybeRecomputeStageBenchmarks(workspaceId)` call after CRM sync, mirroring `maybeRunPatternDiscovery`. Trigger conditions: never computed before OR last compute > 7 days ago OR >= 3 new closed deals since last compute (check `computed_at` from most recent row in `stage_velocity_benchmarks`).

New file `server/routes/stage-benchmarks.ts` (or append to existing routing):

**`GET /api/workspaces/:workspaceId/stage-benchmarks?pipeline=`**
- Reads from `stage_velocity_benchmarks`
- Pivots won/lost rows into `StageBenchmark[]` objects
- Sorted by stage `display_order` from `stage_configs`
- Each benchmark includes: `{ stage, pipeline, segment, won: { median, p75, p90, sample_size } | null, lost: { ... } | null, confidence_tier, is_inverted, inversion_note? }`

**`GET /api/workspaces/:workspaceId/deals/:dealId/coaching`**
- Fetches deal's stage history from `deal_stage_history` ordered by `entered_at`
- Looks up benchmark for each stage via `lookupBenchmark`
- Computes velocity signal per stage via `computeVelocitySignal`
- For current stage: uses `deals.days_in_stage` or computes from `deals.stage_changed_at`
- Computes engagement signals (see engagement computation spec below)
- Returns:
```typescript
{
  stage_journey: StageJourneyEntry[],
  current_velocity: VelocitySignal,
  engagement: EngagementSignal | null,  // null if no conversation connector
  composite: {
    label: 'Healthy' | 'Running Long, But Active' | 'Watch Closely' | 'At Risk' | 'Critical',
    color: 'green' | 'yellow' | 'amber' | 'red',
    summary: string,      // Plain-English 1-2 sentence
    next_step: string     // Actionable recommendation
  },
  action_items: ActionItem[],  // from conversations.action_items
  benchmarks_confidence: string  // 'high' | 'directional' | 'insufficient'
}
```

**Engagement signal computation** (within the coaching endpoint):

```typescript
// Call recency
const lastCall = await db.query(`
  SELECT started_at FROM conversations
  WHERE deal_id = $1 AND workspace_id = $2
  ORDER BY started_at DESC LIMIT 1
`, [dealId, workspaceId]);
const daysSinceCall = lastCall ? daysBetween(lastCall.started_at, now()) : null;

// Multi-threading: unique buyer contacts across recent calls
const participants = await db.query(`
  SELECT DISTINCT jsonb_array_elements(participants)->>'email' as email
  FROM conversations
  WHERE deal_id = $1 AND workspace_id = $2
    AND started_at > now() - interval '60 days'
`, [dealId, workspaceId]);
const contactCount = participants.rows.length;

// Missing stakeholders: contacts on deal NOT on any call
const missingStakeholders = await db.query(`
  SELECT c.name, c.title,
    COALESCE(dc.buying_role, 'unknown') as role
  FROM contacts c
  JOIN deal_contacts dc ON dc.contact_id = c.id
  WHERE dc.deal_id = $1
    AND c.email NOT IN (
      SELECT DISTINCT jsonb_array_elements(participants)->>'email'
      FROM conversations
      WHERE deal_id = $1 AND workspace_id = $2
    )
`, [dealId, workspaceId]);

// Flag critical gaps: decision_maker or executive_sponsor not on calls
const criticalMissing = missingStakeholders.filter(
  s => ['decision_maker', 'executive_sponsor'].includes(s.role)
);

// Composite engagement
const engagementSignal = daysSinceCall === null ? 'no_data'
  : daysSinceCall <= 14 ? 'active'
  : daysSinceCall <= 30 ? 'cooling'
  : 'dark';
```

**Composite health matrix** (velocity × engagement):

| Velocity | Engagement active | Engagement mixed | Engagement dark/no data |
|---|---|---|---|
| healthy | Healthy | Healthy | Watch Closely |
| watch | Running Long, But Active | Watch Closely | At Risk |
| at_risk | At Risk (But Active) | At Risk | Critical |
| critical | Critical (But Active) | Critical | Critical |

**Action item extraction** (within the coaching endpoint):

```typescript
// Fireflies: action_items come structured in conversations.action_items JSONB
const actionItems = await db.query(`
  SELECT c.title as source_title, c.started_at as source_date,
    jsonb_array_elements(c.action_items) as item
  FROM conversations c
  WHERE c.deal_id = $1 AND c.workspace_id = $2
    AND c.action_items IS NOT NULL
  ORDER BY c.started_at DESC
`, [dealId, workspaceId]);

// Map to ActionItem[]:
// { text, owner (if extractable), source_conversation_title, source_date,
//   status: 'open' | 'overdue' (if source_date > 14 days ago, assume overdue) }
// For Gong: action_items may not exist — return empty array, not an error
```

**`POST /api/workspaces/:workspaceId/stage-benchmarks/refresh`**
- Calls `computeAndStoreStageBenchmarks(workspaceId)` manually
- Returns updated benchmark count
- Used by "Refresh Benchmarks" button on Grid page

Register all routes in `server/index.ts`.

**Files:** `server/routes/stage-benchmarks.ts`, `server/sync/post-sync-events.ts`, `server/index.ts`

---

### T003: Replace Coaching-Breakdown Signal Classification (Backend)

**Blocked By:** [T001]

**Details:**

In `server/routes/conversations.ts`, rewrite the `signal_typed` CTE that currently classifies deals based on `sales_cycle_days > won_p75 * 2`:

- Join `stage_velocity_benchmarks svb` ON `svb.workspace_id = d.workspace_id AND svb.stage_normalized = d.stage_normalized AND svb.segment = [deal_segment] AND svb.outcome = 'won'` (LEFT JOIN — many deals won't have benchmarks yet)
- Add a second left join for the lost benchmark (`svb_lost WHERE outcome = 'lost'`)
- Deal segment derived inline:
```sql
CASE
  WHEN d.amount < $smb_cutoff THEN 'smb'
  WHEN d.amount < $mid_cutoff THEN 'mid_market'
  ELSE 'enterprise'
END
```
- New classification:
```sql
CASE
  WHEN svb.median_days IS NULL THEN  -- no benchmark: fall back to legacy
    CASE
      WHEN lower_wins AND sales_cycle_days > won_p75 * 2 THEN 'critical'
      WHEN lower_wins AND sales_cycle_days > won_p75      THEN 'at_risk'
      WHEN lower_wins AND sales_cycle_days <= won_median   THEN 'healthy'
      ELSE 'watch'
    END
  WHEN svb.is_inverted AND days_in_stage < svb.median_days * 0.5 THEN 'at_risk'
  WHEN days_in_stage > svb_lost.median_days                       THEN 'critical'
  WHEN days_in_stage > svb.median_days * 2.0                      THEN 'at_risk'
  WHEN days_in_stage > svb.median_days * 1.2                      THEN 'watch'
  ELSE 'healthy'
END AS signal_type
```
- Fetch segment cutoffs from `autoDetectSegmentBoundaries` (cache in memory per workspace per request)
- `total_at_risk_value` / `total_at_risk_count` use `critical + at_risk` (was `stalled + slowing`)
- Response shape stays identical — only `signal_type` string values change. Frontend adapts in T004.

**Files:** `server/routes/conversations.ts`

**Acceptance:** Frontera's SMB Evaluation deals at 60d show `at_risk` or `critical`; Pilot deals at 63d show `watch` not `critical`; Mid-Market inverted stages don't flag long-time deals as critical.

---

### T004: Unified Filter Bar + Updated Chart Colors (Conversations Page Frontend)

**Blocked By:** [T003]

**Details:**

In `client/src/pages/ConversationsPage.tsx`:

- Add `const [selectedOwner, setSelectedOwner] = useState<string | null>(null)` with other filter state
- Derive `availableOwners` from `allCoachingConvs.map(c => c.deal_owner).filter(Boolean)` deduplicated and sorted
- Replace `SIGNAL_BUCKETS` / `SIGNAL_LABEL` / `SIGNAL_COLOR` constants with new categories:
  - `critical` → "Critical" → red `#E53E3E`
  - `at_risk` → "At Risk" → orange `#DD6B20`
  - `watch` → "Watch" → yellow `#D69E2E`
  - `healthy` → "Healthy" → green `#38A169`
- Unified filter bar between headline and chart:
  - Owner `<select>` dropdown (All Owners + sorted owner names)
  - Stage badge (shown when `selectedStage` set, with × dismiss)
  - Four health category pill buttons (toggle active/inactive)
  - "Clear all" button when any filter active
- Remove old signal pills from below chart (legend becomes static color swatches only)
- Remove old active-filter row above conv list header
- `filteredCoachingConvs` filter adds: `if (selectedOwner && conv.deal_owner !== selectedOwner) return false`
- `hasFilter = selectedStage || selectedSignal || selectedOwner`
- `clearAllFilters` resets all three
- Empty-state "Clear filters" also clears owner

**Files:** `client/src/pages/ConversationsPage.tsx`

**Acceptance:** Owner dropdown shows All Owners / Sara Bollman / Nate Phillips; health categories show meaningful counts (expect fewer Critical than old Stalled); chart + list stay in sync. The "wall of red" problem is gone — Pilot deals in yellow, not red.

---

### T005: Conversation Detail — "Deal Health" Tab with Stage Journey

**Blocked By:** [T002]

**Details:**

In `client/src/pages/ConversationDetail.tsx`:

- Rename first tab "Deal Impact" → "Deal Health"
- Fetch `GET /api/workspaces/:id/deals/:dealId/coaching` on mount (when `dealId` available from `conversation.deal_id`)

**Composite verdict banner** at top of tab:
- Colored border (green/yellow/amber/red) matching composite signal
- Label: "Running Long, But Showing Life" (or whatever composite.label returns)
- 1-sentence explanation from `composite.summary`
- Suggested next step from `composite.next_step`
- Show skeleton while loading

**Stage Journey panel** (left column, ~60% width):
- List each stage from `stage_journey[]`:
  - Stage indicator: checkmark (completed), dot (current), circle (future)
  - Stage name + days this deal spent there (or "Xd and counting" if current)
  - Signal dot color (green/yellow/red) from signal field
  - Expandable on click — shows:
    - Plain-English explanation text
    - Three comparison bars: "This deal" / "Won deals" / "Lost deals" with proportional widths
    - Confidence footnote: "High confidence · N won deals" or "Directional · N deals" or dimmed "Insufficient data"
  - Inverted stages: purple ⚠️ badge with "Won deals spend longer here"
  - Current stage expanded by default

**Engagement Signals panel** (right column, ~40% width):
- Call recency indicator with colored dot and days-since-call
- Multi-threading: contact count + trend arrow (↑ improving / → stable / ↓ declining) + benchmark ("Won deals avg N+ contacts")
- Missing stakeholders: list names and roles, flag decision_maker/executive_sponsor as critical
- Each signal gets a small icon, label, signal dot, and 1-line explanation

**Recent Conversations** list below engagement panel:
- Title, date, contact count, duration for last 3 calls

**Graceful degradation:**
- If `/coaching` returns no `stage_journey` entries: "Stage benchmarks are computing — available after next sync"
- If no conversation connector: engagement panel shows "Connect Gong or Fireflies to see engagement signals" with link to connector settings
- If no action_items: Action Tracker tab shows appropriate empty state (see T005a)

**Files:** `client/src/pages/ConversationDetail.tsx`

---

### T005a: Conversation Detail — "Action Tracker" Tab

**Blocked By:** [T002]

*This was missing from Replit's original plan. The Action Tracker is a key differentiator — it answers "why is this deal stuck?" with evidence from call transcripts.*

**Details:**

In `client/src/pages/ConversationDetail.tsx`, implement the Action Tracker tab (second tab):

**Summary banner** at top:
- Count of overdue items + total days overdue
- Plain-English diagnosis: e.g., "The deal isn't stuck because of the buyer — it's stuck because of follow-through"
  - This text is derived from the pattern: if most overdue items are seller-owned commitments, the diagnosis is follow-through; if they're buyer-side (e.g., "send us the contract"), the diagnosis is buyer hesitation
  - Simple heuristic, not LLM — if > 50% of overdue items have the deal owner as the likely owner, it's a follow-through issue
- Next step suggestion

**Overdue action items** section:
- Sorted by days overdue (most overdue first)
- Each item shows:
  - Checkbox (unchecked, red-tinted for overdue)
  - Action text
  - Owner name + "Xd overdue"
  - Expandable context panel:
    - Source conversation title + date
    - Transcript context (the surrounding text where this commitment was made)
- Items from `action_items[]` in the coaching response where `status === 'overdue'`

**Completed items** section (collapsed by default):
- Toggle to show/hide
- Same format but muted styling, checkmark instead of alert

**Commitment timeline** at bottom:
- Chronological dot-timeline of all action items
- Each dot: date committed → date due (or date completed)
- Color: green (done), red (overdue), gray (open)

**Graceful degradation:**
- If `action_items` is empty and workspace has Fireflies: "No action items detected from recent calls. Action items are extracted from Fireflies transcripts automatically."
- If `action_items` is empty and workspace has Gong only: "Action item extraction from Gong transcripts is coming soon. Connect Fireflies for automatic action tracking."
- If no conversation connector: "Connect Gong or Fireflies to automatically track commitments made on calls."

**Files:** `client/src/pages/ConversationDetail.tsx`

---

### T005b: Conversation Detail — "Coaching Signals" Tab

**Blocked By:** [T002, T008]

*This was partially covered in Replit's T008 (script generation) but the full tab UI was missing.*

**Details:**

In `client/src/pages/ConversationDetail.tsx`, implement the Coaching Signals tab (third tab):

**Velocity gauge** at top:
- Horizontal spectrum bar: green zone (0 to won median) → yellow zone → red zone (past lost median)
- Deal position marker (colored dot on the spectrum)
- Labels: "Win pace" at won median position, "Lose pace" at lost median position
- Below gauge: "Xd in [Stage] — Y× your typical win pace"
- Countdown: "At current pace, reaches lost-deal territory in ~N days" (only if signal is watch or at_risk)

**Last Call Quality** section (only when conversation source_data available):
- Talk ratio: percentage + signal dot + benchmark comparison
  - Gong: native `source_data.talk_ratio`
  - Fireflies: compute from sentences (rep talk time / total)
  - If neither available: hide this row
- Questions asked: count + signal dot
  - Gong: `source_data.question_count`
  - Fireflies: not natively available — hide row or show "N/A"
- Next steps set: action item count from the call
- Competitor mentions: flag if transcript mentions competitors
  - Gong: `source_data.trackers` if competitor trackers configured
  - Fireflies: search keywords for known competitor names (from workspace config if available)
  - If no data: hide row
- Each metric: label, value, signal dot (green/yellow/red), 1-line benchmark explanation, source attribution ("via Gong" or "via Fireflies")

**Deal Patterns** section:
- 2-column grid of pattern cards
- Risk patterns (red/amber cards):
  - "Economic buyer not engaged" — if critical missing stakeholders exist
  - "Going dark" — if days since last call > 21
  - "Competitor mentioned without follow-up" — if transcript analysis detected
- Positive patterns (green cards):
  - "Multi-threading improving" — if contact count increased between recent calls
  - "Consistent call cadence" — if calls are evenly spaced
  - "Action items being completed" — if > 50% of action items are done
- Each card: icon, title, 1-2 sentence explanation with specific data

**Manager Coaching Script** section:
- "Generate Coaching Script" button (calls T008 endpoint)
- While generating: skeleton/spinner
- Rendered script: opener paragraph + 3 numbered coaching points
- Each point: focus area, specific evidence, suggested question to ask rep
- "Copy to clipboard" button
- "Regenerate" button for subsequent calls
- Footer: "Generated from call transcripts, action items, and deal stage patterns. Adapt to your management style."

**Graceful degradation:**
- No conversation data at all: show velocity gauge only, hide call quality section, show pattern cards based on CRM data only (missing stakeholders from deal_contacts, velocity signal), hide coaching script
- Fireflies only: show all except Gong-specific metrics (interactivity, patience)
- Gong only: show all except Fireflies-native action items in patterns

**Files:** `client/src/pages/ConversationDetail.tsx`

---

### T006: Deal Detail Page — Composite Health Indicator + Stage Velocity Overlay

**Blocked By:** [T002]

**Details:**

Find the Deal Detail page component (explore during implementation — likely `DealDetail.tsx` or similar).

- Fetch `/deals/:dealId/coaching` on mount

**Header strip change:**
- Replace "Velocity: Check Velocity" with "Health: [label]" using composite color (green/yellow/orange/red dot)
- Clicking the health indicator navigates to the Conversation Detail for the most recent conversation on this deal (or opens a coaching summary panel if no conversations)

**Stage history velocity overlay:**
- Below the existing Stage History timeline, for each stage row add a right-aligned column:
  - `Xd · Won avg Yd · [signal dot]`
  - If inverted: `Xd · ⚠️ Won avg Yd (inverted)` in purple
  - If insufficient data: dim text, no signal dot

**Coverage Gaps enhancement:**
- The existing Coverage Gaps section shows "Key Contacts Never Engaged"
- Add cross-reference with conversation participants: contacts listed as "never engaged" who also don't appear in any conversation participants get flagged as "not on any call" (this data comes from the coaching endpoint's `engagement.missing_stakeholders`)
- This unifies the Deal Detail coverage gap display with the Conversation Detail missing stakeholders view

**Deal Dossier extension:**
- In the `deal_dossier()` assembly function (wherever it lives), add coaching data:
```typescript
deal_dossier.coaching = {
  stage_journey: stageJourneyFromCoachingEndpoint,
  current_velocity: velocitySignal,
  engagement: engagementSignal,
  composite: compositeHealth,
  action_items: actionItems,
};
```
- This makes the "Ask about this deal" chat automatically coaching-aware — when the `/analyze` endpoint assembles context for Claude, it includes the coaching data in the prompt

If no coaching data yet: "Health: Computing..." in gray.

**Files:** Deal Detail component (path determined during implementation), deal dossier assembly function

---

### T007: Benchmarks Grid Page ("Stage Velocity")

**Blocked By:** [T002]

**Details:**

New file `client/src/pages/BenchmarksGrid.tsx`.

**Data fetching:**
- Fetches `GET /api/workspaces/:id/stage-benchmarks`
- Also fetches current open deal averages per stage for the "Open now" row (may need a supplementary query or include in the benchmarks endpoint response)

**Grid structure** — pivots data into Segment × Stage matrix:

- **Segment rows:** SMB / Mid-Market / Enterprise — each collapsible with chevron toggle
  - Segment header shows: label, range, confidence badge (●●● High / ●●○ Directional / ●○○ Insufficient), sample counts
  - Sub-rows per segment:
    - Won median (green dot) — median_days for outcome='won'
    - Lost median (red dot) — median_days for outcome='lost'
    - Signal gap — ratio of lost/won (higher = cleaner coaching signal)
    - Open now (avg) — average days_in_stage for currently open deals in this segment+stage
    - Each sub-row labeled with icon + text
- **Stage columns:** in `display_order` from stage configs

**Cell treatments:**
- Signal gap cells: green text if >5×, yellow if 2–5×, gray if <2×
- Inverted cells: purple tint background, ⚠️ `Inverted` badge, tooltip: "Winning deals spend longer here — fast exits correlate with losses"
- Insufficient data rows: 40% opacity, grayed text
- Open avg cells: turn yellow if avg > won median, red if avg > lost median; show deal count below value ("N deals")
- Null values: show em-dash "—"

**Controls:**
- Pipeline selector dropdown (if workspace has multiple pipelines)
- "Refresh Benchmarks" button → calls `POST /stage-benchmarks/refresh`, shows spinner, reloads data
- Segment rows expand/collapse (all expanded by default)

**"What the Data Tells You" insight cards** below the grid:
- 4-6 cards generated by the `stage-velocity-benchmarks` skill's Claude synthesis step (stored in `skill_runs.result_data`)
- Fetch from skill_runs for the most recent stage-velocity-benchmarks run
- Three card types with distinct visual treatment:
  - **Opportunity** (green border): stages where signal gap is large enough to be a reliable coaching lever
  - **Anomaly** (purple border): inverted stages or unexpected patterns
  - **Risk** (red border): thin data, ambiguous signals, or concerning open deal positions
- Each card: icon, title, 1-2 sentence explanation, stage/segment tags
- If no skill run exists yet: "Run the Stage Velocity Benchmarks skill to generate insights"

**Reading guide** at bottom:
- Explanatory card: "How to read this grid"
- Explains signal gap, inversions, and confidence tiers in plain language
- Collapsible (shown on first visit, can be dismissed)

**Navigation:**
- Add "Stage Velocity" to sidebar under INTELLIGENCE section, between "ICP Profile" and "Agents":
```
INTELLIGENCE
  ICP Profile
  Stage Velocity   ← NEW
  Agents
  Skills (27)
  Tools
```

**Files:** `client/src/pages/BenchmarksGrid.tsx`, sidebar nav component, routing

**Acceptance:** Grid renders with real Frontera data; SMB Evaluation shows 7d won / 74d lost / 10.6× gap; Mid-Market Evaluation shows inverted badge; Enterprise rows are dimmed; pipeline selector works if multiple pipelines exist; insight cards render from skill_runs.

---

### T008: Coaching Script Generation (Claude, On-Demand)

**Blocked By:** [T005]

**Details:**

New endpoint `POST /api/workspaces/:id/deals/:dealId/coaching-script`:

**Context assembly** (keep compact — target ~2K tokens input to Claude):
- Deal: name, stage, amount, segment, owner, days_in_current_stage
- Stage journey: each stage with days + signal (from coaching endpoint)
- Last 3 conversations: title, date, duration, participant count, key metrics (talk ratio if available)
- Open/overdue action items from conversations.action_items
- Missing stakeholders from engagement computation
- Composite health label + summary

**Claude prompt:**
```
You are a sales manager preparing for a 1:1 coaching conversation about a deal.

DEAL CONTEXT:
{compact context from above}

Generate a coaching script with:
1. An opener (2 sentences) that acknowledges what's working before addressing concerns
2. Three numbered coaching points, each with:
   - focus: the specific area to address (e.g., "Executive access", "Competitor response")
   - evidence: the specific data point grounding this (e.g., "Matty Allon hasn't been on any of the 3 calls")
   - question: a coaching question to ask the rep (not a directive — a question that prompts self-reflection)
3. A closing note (1 sentence) reinforcing confidence in the rep

Be specific. Use names, dates, and numbers from the context. Never be generic.
```

**Response shape:**
```typescript
{
  script: {
    opener: string,
    points: Array<{
      focus: string,
      evidence: string,
      question: string
    }>,
    closing_note: string
  }
}
```

**Frontend** (in Coaching Signals tab — T005b):
- "Generate Coaching Script" button
- Spinner while generating (~3-5 seconds)
- Rendered with opener in italic, numbered points with labels, closing note
- "Copy to clipboard" button (copies as plain text)
- "Regenerate" button for subsequent calls

**Files:** `server/routes/stage-benchmarks.ts` (or new `server/routes/coaching-script.ts`), `client/src/pages/ConversationDetail.tsx`

---

## Diff vs. Replit's Original Plan

| Area | Replit's plan | This merged version | What changed |
|---|---|---|---|
| T001 | ✅ Solid | + 'all' segment fallback row | Small addition for degradation |
| T002 | Light on engagement | + Full engagement signal spec, missing stakeholders, action item extraction, composite matrix | Significant expansion |
| T003 | ✅ Solid | No change | — |
| T004 | ✅ Solid | + "wall of red is gone" acceptance criteria | Minor |
| T005 | Covers Deal Health tab | + Engagement panel spec, expandable stages, graceful degradation details | Moderate expansion |
| T005a | **Missing** | **NEW: Action Tracker tab** | Key differentiator from mockup |
| T005b | **Missing** | **NEW: Coaching Signals tab** (velocity gauge, call quality, patterns) | Major addition from mockup |
| T006 | Light | + Coverage Gaps enhancement, Deal Dossier extension for "Ask about this deal" | Moderate expansion |
| T007 | Covers grid basics | + Insight cards from skill_runs, reading guide, specific nav placement, open deal avg row | Moderate expansion |
| T008 | ✅ Solid | + Claude prompt template, response shape, frontend spec | Minor expansion |

### New items not in Replit's plan:
1. **T005a (Action Tracker tab)** — the whole tab was missing. This is the "why is the deal stuck?" evidence layer.
2. **T005b (Coaching Signals tab)** — velocity gauge, call quality metrics, deal patterns, coaching script UI. Replit had script generation (T008) but not the full tab it lives in.
3. **Deal Dossier extension** (in T006) — coaching data flowing into the "Ask about this deal" context.
4. **Insight cards on Grid** (in T007) — AI-generated observations from skill_runs, not just raw numbers.
5. **Composite health matrix** (in T002) — the explicit velocity × engagement → label mapping.

---

## Build Sequence

```
Phase 1: Backend
  T001 → T002 → T003 (can run in parallel once T001 done)

Phase 2: Conversations Page
  T004 (filter bar — depends on T003)
  T005 (Deal Health tab — depends on T002)
  T005a (Action Tracker — depends on T002)
  T005b (Coaching Signals — depends on T002, T008)

Phase 3: Other Pages
  T006 (Deal Detail — depends on T002)
  T007 (Benchmarks Grid — depends on T002)

Phase 4: AI Features
  T008 (Coaching script — depends on T005)
```

**Critical path:** T001 → T002 → T005 + T004 (in parallel) → T005a/T005b → T008

**Ship gate:** T001 through T004 can ship as a unit — the signal fix + filter bar — before the detail tabs are done. This immediately fixes the "wall of red" problem on the Conversations list page.
