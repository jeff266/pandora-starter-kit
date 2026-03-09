# Claude Code Prompt: Behavioral Winning Path Skill

## Context

The Behavioral Winning Path answers a different question than stage-based
funnel charts. Stages show where a CRM record sat. This skill shows what
*actually happened* in deals that closed — behavioral milestones sourced
from conversation intelligence, email engagement, contact roles, and stage
history, in that order of richness.

A stage-based winning path says: "Discovery → Evaluation → Negotiation → Won."
A behavioral winning path says: "Discovery call held within 30 days with two
stakeholders → Champion joined three calls and named the use case → Technical
stakeholders introduced → Technical win verbalized by buyer → Executive sponsor
activated → Closed."

The output is a time-windowed milestone sequence per outcome (won/lost) with
lift statistics showing which behaviors most differentiate the two paths.

**This skill MUST work across four data tiers and degrade gracefully.** The
tier is determined at runtime by probing what data exists. The milestone
definitions, signal sources, and confidence of findings all shift per tier —
but the output format remains consistent so the UI renders the same way
regardless.

---

## Data Tiers

The skill probes available data in this priority order at runtime. Use the
richest tier available.

```
Tier 1 — Conversation Intelligence (Gong / Fireflies)
  Source: conversations table (participants, transcript, summary, duration)
  Milestones: call held, champion multi-threaded, use case articulated by
              customer, technical stakeholders joined, technical win verbalized,
              executive sponsor activated
  Confidence: HIGH — behavioral signals extracted from transcripts and metadata

Tier 2 — Email Engagement
  Source: activities table where type IN ('email_sent','email_opened',
          'email_replied') OR email connector (if present)
  Milestones: first reply received, bidirectional thread established, multi-
              contact thread, late-stage email cadence maintained
  Confidence: MEDIUM — engagement patterns without content signals

Tier 3 — Contact Roles
  Source: contacts table (role, title, is_primary_contact) joined to deals
  Milestones: champion identified, economic buyer engaged, technical evaluator
              added, executive sponsor associated
  Confidence: LOW-MEDIUM — persona coverage without behavioral proof

Tier 4 — Stage History Only
  Source: deal_stage_history table (stage, entered_at, exited_at)
  Milestones: stage transitions with timing buckets; early vs. late
              progression through each stage relative to peer average
  Confidence: LOW — structural proxy for behavior, not behavior itself
```

Label every milestone in output with its source tier and confidence level.
Never present Tier 3 or Tier 4 signals with the same authority as Tier 1.

---

## Before Starting

Find and read:
1. An existing working skill (pipeline-waterfall or forecast-rollup) — copy
   the registration pattern, step structure, and runtime wiring exactly
2. `server/analysis/stage-history-queries.ts` — getStageConversionRates,
   getAverageTimeInStage are already built; use them for Tier 4
3. The conversations table schema — check `participants` (JSONB), `transcript_text`,
   `summary`, `started_at`, `duration_seconds`, `source_data`
4. The activities table schema — check type values, actor_email, contact_email,
   deal_id, created_at columns
5. The contacts table schema — check role, title, is_primary_contact, deal_id
6. How ICP Discovery links conversations to deals (Option A: deal_id direct;
   Option B: fuzzy match on account + participants + date range) — replicate
   the same linkage logic here
7. The skill runtime / executor — understand how compute, deepseek, and
   claude steps are dispatched and chained

---

## Step 1: Register the Skill

```typescript
{
  id: 'behavioral-winning-path',
  name: 'Behavioral Winning Path',
  category: 'intelligence',
  description: 'Identifies behavioral milestone sequences that characterize won vs. lost deals, sourced from conversation intelligence, email engagement, contact roles, or stage history depending on data availability',
  schedule: { cron: '0 6 * * 1', trigger: 'on_demand' },
  // Monday 6 AM — available before weekly pipeline review
  output: ['slack', 'json', 'markdown'],
  version: '1.0.0',
}
```

Add to the skill registry and cron scheduler.

---

## Step 2: Data Tier Probe (COMPUTE — runs first, zero tokens)

Before any analysis, determine which tier is available. Create
`probeBehavioralDataTier()` in `server/analysis/aggregations.ts`:

```typescript
export async function probeBehavioralDataTier(
  workspaceId: string,
  db: DatabaseClient
): Promise<{
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  availability: {
    conversations: { exists: boolean; count: number; withTranscripts: number; linkedToDealsPct: number; };
    emailActivities: { exists: boolean; count: number; distinctDeals: number; };
    contactRoles:   { exists: boolean; dealsWithMultipleContacts: number; dealsWithRoles: number; };
    stageHistory:   { exists: boolean; count: number; distinctDeals: number; };
  };
}> {

  // --- Probe conversations ---
  const convResult = await db.query(`
    SELECT
      COUNT(*)                                        AS total,
      COUNT(*) FILTER (WHERE transcript_text IS NOT NULL
                         AND LENGTH(transcript_text) > 100) AS with_transcripts,
      COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL) AS linked_deals
    FROM conversations
    WHERE workspace_id = $1
  `, [workspaceId]);

  const totalConv    = parseInt(convResult.rows[0].total);
  const withTranscr  = parseInt(convResult.rows[0].with_transcripts);

  // Get deal count to compute linked pct
  const dealCount = await db.query(
    `SELECT COUNT(*) FROM deals WHERE workspace_id = $1`, [workspaceId]
  );
  const linkedPct = dealCount.rows[0].count > 0
    ? parseInt(convResult.rows[0].linked_deals) / parseInt(dealCount.rows[0].count)
    : 0;

  const conversations = {
    exists: totalConv > 0,
    count: totalConv,
    withTranscripts: withTranscr,
    linkedToDealsPct: linkedPct,
  };

  // --- Probe email activities ---
  const emailResult = await db.query(`
    SELECT
      COUNT(*)             AS total,
      COUNT(DISTINCT deal_id) AS distinct_deals
    FROM activities
    WHERE workspace_id = $1
      AND type IN ('email_sent','email_opened','email_replied','email')
      AND deal_id IS NOT NULL
  `, [workspaceId]);

  const emailActivities = {
    exists: parseInt(emailResult.rows[0].total) > 0,
    count: parseInt(emailResult.rows[0].total),
    distinctDeals: parseInt(emailResult.rows[0].distinct_deals),
  };

  // --- Probe contact roles ---
  const contactResult = await db.query(`
    SELECT
      COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL)               AS deals_with_contacts,
      COUNT(DISTINCT deal_id) FILTER (WHERE role IS NOT NULL AND role != '')    AS deals_with_roles
    FROM contacts
    WHERE workspace_id = $1
  `, [workspaceId]);

  // Also check if deals have >1 contact (multi-threading signal possible)
  const multiContact = await db.query(`
    SELECT COUNT(*) AS deals_multi
    FROM (
      SELECT deal_id, COUNT(*) AS cnt
      FROM contacts
      WHERE workspace_id = $1 AND deal_id IS NOT NULL
      GROUP BY deal_id
      HAVING COUNT(*) >= 2
    ) sub
  `, [workspaceId]);

  const contactRoles = {
    exists: parseInt(contactResult.rows[0].deals_with_contacts) > 0,
    dealsWithMultipleContacts: parseInt(multiContact.rows[0].deals_multi),
    dealsWithRoles: parseInt(contactResult.rows[0].deals_with_roles),
  };

  // --- Probe stage history ---
  const stageResult = await db.query(`
    SELECT COUNT(*) AS total, COUNT(DISTINCT deal_id) AS distinct_deals
    FROM deal_stage_history
    WHERE workspace_id = $1
  `, [workspaceId]);

  const stageHistory = {
    exists: parseInt(stageResult.rows[0].total) > 0,
    count: parseInt(stageResult.rows[0].total),
    distinctDeals: parseInt(stageResult.rows[0].distinct_deals),
  };

  // --- Determine tier ---
  // Tier 1: conversations exist with meaningful transcript coverage
  const tier1Ready = conversations.exists
    && conversations.withTranscripts >= 10
    && conversations.linkedToDealsPct >= 0.25; // 25% of deals have linked calls

  // Tier 2: email activities exist with meaningful deal coverage
  const tier2Ready = emailActivities.exists
    && emailActivities.distinctDeals >= 10;

  // Tier 3: contact roles exist with multi-contact deals
  const tier3Ready = contactRoles.exists
    && contactRoles.dealsWithMultipleContacts >= 5;

  // Tier 4: stage history — always available if stage history table is built
  const tier4Ready = stageHistory.exists;

  const tier = tier1Ready ? 1
             : tier2Ready ? 2
             : tier3Ready ? 3
             : 4;

  const tierLabels = {
    1: 'Conversation Intelligence (Gong / Fireflies)',
    2: 'Email Engagement',
    3: 'Contact Role Coverage',
    4: 'Stage Progression Only',
  };

  return {
    tier,
    tierLabel: tierLabels[tier],
    availability: { conversations, emailActivities, contactRoles, stageHistory },
  };
}
```

---

## Step 3: Milestone Extraction per Tier (COMPUTE)

Create `extractBehavioralMilestones()`. This function branches on tier and
returns a normalized `MilestoneMatrix` regardless of which branch runs.

```typescript
interface BehavioralMilestone {
  id: string;
  timeWindow: string;       // e.g. "Day 0–30"
  windowStart: number;      // days from opp created
  windowEnd: number;
  title: string;            // human-readable behavior name
  subtitle: string;         // one-sentence description
  source: string;           // 'CI' | 'Email' | 'CRM Roles' | 'Stage History'
  tier: 1 | 2 | 3 | 4;
  signals: string[];        // specific sub-signals that compose this milestone
  wonDeals: number;         // deals that showed this pattern and closed won
  totalWonDeals: number;    // total won deals in analysis set
  lostDeals: number;        // deals that showed this pattern and closed lost
  totalLostDeals: number;
  wonPct: number;           // wonDeals / totalWonDeals
  lostPct: number;
  lift: number;             // win rate with signal / win rate without signal
  avgDaysToMilestone: number; // median days from opp created to milestone
  earlyCount: number;       // milestone occurred before window midpoint
  lateCount: number;        // milestone occurred after window midpoint
}

interface MilestoneMatrix {
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  analysisPeriodDays: number;
  totalWonDeals: number;
  totalLostDeals: number;
  avgWonCycleDays: number;
  avgLostCycleDays: number;
  wonMilestones: BehavioralMilestone[];
  lostAbsences: {
    milestoneId: string;
    title: string;          // inverse label: "No discovery call in first 45 days"
    source: string;
    lostDealPct: number;    // % of lost deals where this was absent
    liftIfPresent: number;  // win rate lift if milestone IS present
  }[];
  confidenceNote: string;   // shown in UI to set expectation about data richness
}
```

### Tier 1: Conversation Intelligence

```typescript
async function extractTier1Milestones(
  workspaceId: string,
  wonDealIds: string[],
  lostDealIds: string[],
  db: DatabaseClient
): Promise<Partial<MilestoneMatrix>> {

  // For each milestone definition, query whether the behavioral condition
  // was met within the time window for each deal, then compute stats.

  // Milestone definitions (what to look for, in which window)
  const MILESTONE_DEFS = [
    {
      id: 'discovery_call_held',
      title: 'Discovery call held',
      subtitle: 'First call within 30 days; ≥2 stakeholders; problem-definition agenda',
      timeWindow: 'Day 0–30', windowStart: 0, windowEnd: 30,
      // SQL condition (applied per deal, joined to conversations):
      // call within 30 days of deal.created_date
      // AND duration_seconds >= 1800 (30 min)
      // AND participant count (customer side) >= 2
    },
    {
      id: 'champion_multithreaded',
      title: 'Champion multi-threaded on calls',
      subtitle: 'Same champion contact appeared on ≥3 calls; introduced new stakeholders',
      timeWindow: 'Day 15–60', windowStart: 15, windowEnd: 60,
      // SQL: same email in participants JSONB across ≥3 conversations
      // AND at least one NEW participant email appeared in a later call
    },
    {
      id: 'use_case_articulated',
      title: 'Use case articulated by customer',
      subtitle: 'Customer-side speaker named specific workflow and success metric on a recorded call',
      timeWindow: 'Day 30–60', windowStart: 30, windowEnd: 60,
      // DeepSeek classifies transcript excerpts — see Step 4
      // Signal: DeepSeek returns use_case_articulated: true for a call in this window
    },
    {
      id: 'technical_stakeholders_joined',
      title: 'Technical stakeholders joined',
      subtitle: 'Engineer, architect, or IT/security persona present on a call',
      timeWindow: 'Day 45–90', windowStart: 45, windowEnd: 90,
      // SQL: participant title contains 'engineer','architect','security','infra',
      //      'devops','cto','ciso','it ' (case-insensitive)
      // AND deal moved to a technical-equivalent stage in CRM in this window
    },
    {
      id: 'technical_win_declared',
      title: 'Technical win declared',
      subtitle: 'Technical evaluation complete; buyer verbalized approval on a recorded call',
      timeWindow: 'Day 60–90', windowStart: 60, windowEnd: 90,
      // DeepSeek classifies transcript — looks for approval language, no blocking objections
    },
    {
      id: 'executive_sponsor_activated',
      title: 'Executive sponsor activated',
      subtitle: 'VP or C-level joined a call and named decision criteria',
      timeWindow: 'Day 75–120', windowStart: 75, windowEnd: 120,
      // SQL: participant title contains 'vp','vice president','chief','ceo','cfo',
      //      'cro','coo','evp','svp','president' AND conversation in this window
    },
  ];

  // For each definition, compute wonPct, lostPct, lift, avgDays
  // Return as BehavioralMilestone[]
  // See Step 4 for how DeepSeek handles the transcript-dependent milestones
}
```

### Tier 2: Email Engagement

When no conversation data exists, substitute email engagement signals.
The milestone structure maps to analogous behavioral phases:

```
Email Tier Milestone Mapping:

"Opening motion"     → First reply received from customer within 14 days
                       (proxy for: discovery interest demonstrated)

"Champion signal"    → Bidirectional email thread: ≥3 reply cycles with same
                       contact, ≥2 customer emails initiated (not just replies)
                       (proxy for: champion multi-threading)

"Stakeholder expand" → Email thread includes ≥2 distinct customer email domains
                       OR customer CC'd new contacts on a reply
                       (proxy for: multi-stakeholder engagement)

"Evaluation signal"  → Email cadence maintained: no gap > 14 days between
                       customer replies during active evaluation window
                       (proxy for: sustained technical evaluation)

"Closing motion"     → Customer-initiated email within 21 days of close date
                       (proxy for: executive or champion driving close)
```

Query `activities` table. The SQL shape is:

```sql
-- Example: "first reply received within 14 days" check per deal
SELECT
  deal_id,
  MIN(created_at) AS first_reply_at,
  EXTRACT(DAY FROM MIN(created_at) - d.created_date) AS days_to_first_reply
FROM activities a
JOIN deals d ON d.id = a.deal_id
WHERE a.workspace_id = $1
  AND a.type IN ('email_replied', 'email_received')
  AND a.deal_id = ANY($2)  -- pass won OR lost deal IDs
GROUP BY deal_id, d.created_date
```

Apply the same lift calculation logic as Tier 1. Label all milestones
`source: 'Email'`, `tier: 2`.

Add `confidenceNote` to the matrix output:
> "Behavioral milestones derived from email engagement patterns. Conversation
> intelligence (Gong or Fireflies) would produce higher-confidence signals
> based on transcript content and call participation."

### Tier 3: Contact Role Coverage

When neither conversation data nor email activities exist in sufficient volume,
use CRM contact role coverage as a structural proxy for stakeholder engagement.

```
Contact Role Tier Milestone Mapping:

"Champion identified"      → A contact is marked primary_contact OR role contains
                             'champion','sponsor','owner','main'
                             AND was associated with deal within first 30 days

"Economic buyer engaged"   → A contact with title/role matching economic buyer
                             persona (VP, Director, C-level, budget holder)
                             associated with deal at any point

"Technical evaluator added" → A contact with technical title associated with
                              deal (engineer, architect, IT, security, admin)

"Executive sponsor on record" → Executive-titled contact (VP+, C-level)
                                associated with deal

"Multi-stakeholder coverage" → ≥3 distinct contacts associated with deal
                               across ≥2 different functional areas
```

Query the `contacts` table joined to `deals`. Compute milestones present
vs. absent per won/lost cohort. Label all milestones `source: 'CRM Roles'`,
`tier: 3`.

Add `confidenceNote`:
> "Behavioral milestones derived from CRM contact associations. These indicate
> stakeholder presence on record, not verified engagement. Email or conversation
> data would confirm whether those contacts were actually active."

### Tier 4: Stage History Only

When only stage history exists, generate time-relative milestone proxies.
The goal is to preserve the time-windowed, behavioral framing even when
the only signal is stage transitions.

```
Stage History Tier Milestone Mapping:

"Early discovery motion"    → Deal entered first active stage within
                              30 days of creation AND average time in
                              discovery stage was below peer median

"Stage velocity above median" → Deal progressed through ≥2 stages within
                                60 days AND each stage duration was below
                                the workspace average for that stage

"Mid-funnel commitment"     → Deal reached middle stages (Evaluation,
                              Feasibility, or equivalent) within 75% of
                              the workspace's median sales cycle length

"No regression"             → Deal moved only forward through stages
                              (zero backwards transitions detected)

"On-time close motion"      → Deal entered final stage within the expected
                              window based on historical close patterns
```

Use existing `getAverageTimeInStage()` and `getStageConversionRates()` from
`server/analysis/stage-history-queries.ts`. Label all milestones
`source: 'Stage History'`, `tier: 4`.

Add `confidenceNote`:
> "Stage-based milestones only. These reflect CRM record movement, not verified
> buyer behavior. Connect Gong, Fireflies, or your email system to unlock
> behavioral signal analysis."

---

## Step 4: DeepSeek Classification (Tier 1 only)

Two milestones require transcript content classification that SQL alone
cannot handle: `use_case_articulated` and `technical_win_declared`.

For each call linked to a deal in the analysis window, pass relevant
transcript excerpts to DeepSeek for classification.

**Keep total DeepSeek tokens under 2K input / 2K output.**
Batch: process up to 20 calls per run. For larger workspaces, sample
the most recent 100 closed deals.

DeepSeek prompt template (call once per relevant call):

```
You are classifying a sales call transcript excerpt. Answer ONLY in JSON.
No preamble, no explanation.

Transcript excerpt (customer speaker turns only, max 800 words):
{CUSTOMER_TURNS_EXCERPT}

Classify the following signals. Return true only if clearly present.

{
  "use_case_articulated": boolean,         // Customer named a specific workflow, 
                                            // use case, or problem they are solving
  "success_metric_stated": boolean,        // Customer named a KPI, metric, or 
                                            // measurable outcome
  "technical_win_language": boolean,       // Approval, sign-off, passed eval, or 
                                            // equivalent language from customer
  "blocking_objection_present": boolean,  // Unresolved objection raised by customer
  "executive_decision_language": boolean,  // Budget, board, timeline, or final 
                                            // decision criteria discussed
  "primary_speaker": "customer" | "rep" | "balanced"  // Who dominated the call
}
```

Aggregate DeepSeek classifications across deals. For each milestone:
- `use_case_articulated`: true if ≥1 call in window has `use_case_articulated: true`
  AND `success_metric_stated: true`
- `technical_win_declared`: true if ≥1 call in window has `technical_win_language: true`
  AND `blocking_objection_present: false`

---

## Step 5: Lift Calculation (COMPUTE — all tiers)

For each milestone, compute win rate lift. Apply to whatever tier's milestones
were extracted.

```typescript
function computeLift(
  milestone: { wonDeals: number; totalWonDeals: number; lostDeals: number; totalLostDeals: number }
): number {
  // Win rate when milestone IS present
  const totalWithSignal = milestone.wonDeals + milestone.lostDeals;
  if (totalWithSignal < 3) return 0; // insufficient data

  const winRateWith = milestone.wonDeals / totalWithSignal;

  // Win rate when milestone IS NOT present
  const wonWithout  = milestone.totalWonDeals  - milestone.wonDeals;
  const lostWithout = milestone.totalLostDeals - milestone.lostDeals;
  const totalWithout = wonWithout + lostWithout;

  if (totalWithout < 3) return 0;

  const winRateWithout = wonWithout / totalWithout;
  if (winRateWithout === 0) return 0;

  return Math.round((winRateWith / winRateWithout) * 10) / 10; // 1 decimal place
}
```

Suppress any milestone where lift cannot be calculated (< 3 deals in either
cohort). Flag it as `insufficient_data: true` rather than omitting it — the
UI should show a greyed-out card with "Not enough data yet."

---

## Step 6: Claude Synthesis (SYNTHESIZE)

Pass the completed `MilestoneMatrix` to Claude for narrative synthesis.
Claude's input should be under 4K tokens.

```
You are a RevOps analyst synthesizing a Behavioral Winning Path analysis.

Data tier: {tierLabel}
Analysis window: {analysisPeriodDays} days of closed deals
Won deals: {totalWonDeals} | Avg cycle: {avgWonCycleDays} days
Lost deals: {totalLostDeals} | Avg cycle: {avgLostCycleDays} days

Top behavioral milestones (won deals):
{wonMilestones — id, title, wonPct, lift, avgDaysToMilestone — JSON, max 6}

Key absences in lost deals:
{lostAbsences — id, title, lostDealPct, liftIfPresent — JSON, max 6}

Data confidence: {confidenceNote}

Write a RevOps synthesis with the following structure. Be direct. No filler.

1. HEADLINE (1 sentence): The single most differentiating behavioral pattern
   between won and lost deals.

2. TOP 3 MILESTONES (3 bullets): The milestones with the highest lift.
   For each: behavior name, lift stat, what it implies for the sales process.

3. BIGGEST RISK SIGNAL (1–2 sentences): The absence pattern in lost deals
   that is most actionable for reps working open pipeline RIGHT NOW.

4. COACHING IMPLICATION (1–2 sentences): What managers should reinforce or
   inspect based on this pattern.

5. DATA CAVEAT (1 sentence, only if tier is 2, 3, or 4): What richer data
   would reveal that current signals cannot.

Return only the synthesis text. Do not repeat the input data.
```

---

## Step 7: Output Formatting

The skill produces two outputs:

### JSON output (for UI rendering)

Return the full `MilestoneMatrix` plus Claude's synthesis. The UI component
(React, already built as a prototype) reads this directly. Key fields:

```typescript
{
  tier: number,
  tierLabel: string,
  confidenceNote: string,
  summary: string,              // Claude synthesis text
  wonMilestones: BehavioralMilestone[],
  lostAbsences: { ... }[],
  meta: {
    totalWonDeals: number,
    totalLostDeals: number,
    avgWonCycleDays: number,
    avgLostCycleDays: number,
    analysisPeriodDays: number,
    generatedAt: string,
  }
}
```

### Slack output

```
*Behavioral Winning Path* — {tierLabel}
_{totalWonDeals} won · {totalLostDeals} lost · {analysisPeriodDays}-day window_

*What separates won deals:*

{For each top 3 milestone by lift:}
→ *{title}* — present in {wonPct}% of won deals · {lift}× win rate lift
   _{subtitle}_

*Biggest risk in open pipeline:*
{BIGGEST RISK SIGNAL from Claude synthesis}

*Coaching focus:*
{COACHING IMPLICATION from Claude synthesis}

{If tier < 1:}
⚠️ {confidenceNote}

_Run /pandora run behavioral-winning-path to refresh_
```

---

## Step 8: API Endpoint

Add to the skill's route handler:

```
GET /api/workspaces/:workspaceId/skills/behavioral-winning-path/latest
  → Returns most recent MilestoneMatrix JSON from skill_runs table

POST /api/workspaces/:workspaceId/skills/behavioral-winning-path/run
  → Triggers immediate skill execution

GET /api/workspaces/:workspaceId/skills/behavioral-winning-path/tier
  → Returns data tier probe result only (fast check, no analysis)
     Useful for the UI to show "connect Gong to unlock full analysis"
```

---

## Acceptance Criteria

- [ ] `probeBehavioralDataTier()` correctly identifies which tier is available
      for Imubit (Salesforce), Frontera (HubSpot + Gong), GrowthBook (HubSpot
      + Fireflies), and a bare HubSpot workspace
- [ ] Tier 1 milestone extraction runs without error when conversations table
      has linked deals with transcripts
- [ ] Tier 2 fallback activates correctly when conversations table is empty
      but activities table has email records
- [ ] Tier 3 fallback activates when both conversations and email are sparse
      but contacts table has role data
- [ ] Tier 4 fallback always works — stage history is always available
- [ ] Lift calculation suppresses milestones with < 3 deals in cohort
      (shows greyed "insufficient data" card, not an error)
- [ ] Claude synthesis stays under 4K tokens input regardless of tier
- [ ] Slack output renders without formatting errors
- [ ] JSON output matches the `MilestoneMatrix` interface exactly
- [ ] UI prototype can consume the JSON output and render milestone cards
      with correct source badges (CI / Email / CRM Roles / Stage History)
- [ ] `confidenceNote` is populated and visible in both Slack and JSON for
      Tier 2, 3, and 4 — never hidden from the user

---

## Milestone Column Layout (UI Reference)

The milestone cards map to four time columns. For Tiers 2–4, milestone
titles change but column layout is preserved:

```
Column 0: Day 0–30      "Opening motion"
Column 1: Day 31–60     "Champion & use case"  (Tier 1)
                        "Engagement signal"     (Tier 2)
                        "Stakeholder coverage"  (Tier 3)
                        "Early velocity"        (Tier 4)
Column 2: Day 61–90     "Technical validation" (Tier 1)
                        "Sustained engagement"  (Tier 2)
                        "Evaluator & buyer"     (Tier 3)
                        "Mid-funnel commitment" (Tier 4)
Column 3: Day 91–120+   "Executive & close"
```

The UI reads `timeWindow` and `windowStart` from the milestone object to
position cards. Column assignment is derived from `windowStart`:
- windowStart < 31  → col 0
- windowStart 15–60 → col 1 (overlapping windows are intentional)
- windowStart 45–90 → col 2
- windowStart 75+   → col 3

Cards with overlapping windows stack vertically within the same column.
