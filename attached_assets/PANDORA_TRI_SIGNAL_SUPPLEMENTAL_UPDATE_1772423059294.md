# Tri-Signal Intelligence Addendum — Supplemental Update
## Missing UI Components

**Parent:** `PANDORA_TRI_SIGNAL_INTELLIGENCE_ADDENDUM.md`
**Covers:** 10 surfaces where tri-signal integration was omitted from the initial addendum

---

## S1: Account List Page

The account list is the first place a user encounters accounts — before any detail page. If tri-signal isn't here, users sort by raw pipeline and miss dying accounts.

### Current spec columns:
account name, domain, deal count, total pipeline, relationship health indicator, last activity, finding count

### Updated columns:

```
| Account     | Domain      | Deals | Raw Pipeline | Quality Pipeline | Behavior       | ICP  | Findings |
|-------------|-------------|-------|-------------|-----------------|----------------|------|----------|
| Acme Corp   | acme.com    | 3     | $3.5M       | $1.4M (40%)     | Mixed (1A, 1D) | A    | 4 ⚠      |
| Globex Inc  | globex.io   | 2     | $1.8M       | $1.6M (89%)     | Engaged        | B    | 1 ℹ      |
| Initech     | initech.com | 1     | $500K       | $45K (9%)       | Going Dark     | —    | 2 🔴     |
```

**Key changes:**

Replace "total pipeline" with two columns: **Raw Pipeline** and **Quality Pipeline**. Quality Pipeline = sum of `amount × conditionalWinProbability` across open deals at the account. The percentage in parentheses is the probability discount — Acme's $3.5M is really $1.4M of expected value. This column is the most important sort dimension on the page because it answers "where is the real money?"

Replace "relationship health indicator" with **Behavior** — the account-level `overallLabel` from `AccountTriSignal.rfm`. Shows "Engaged", "Mixed (1A, 1D)", "Going Dark", or "Neutral". This is a richer signal than the existing binary engagement trend because it shows the deal-level composition.

Add **ICP** column — account-level ICP grade. Shows "—" if ICP scoring hasn't run. This lets users filter to "show me only A/B ICP accounts that are going dark" — the highest-leverage filter possible.

### Sort options:

Add `quality_pipeline` and `composite_priority` to the sortable columns. Default sort changes from `total_pipeline DESC` to `quality_pipeline DESC`. Users who want raw pipeline can still sort by it, but the default surfaces accounts where expected value is highest.

### Filter additions:

```
Behavior: [Engaged] [Mixed] [Going Dark] [Neutral]
ICP Grade: [A] [B] [C] [D] [F] [Not Scored]
Quality Pipeline: [> $X]
```

### API:

Extend `GET /api/workspaces/:id/accounts` to include pre-computed account-level tri-signal fields. These are aggregated from deal-level computed fields — no new computation at query time, just joins and sums:

```sql
SELECT
  a.id, a.name, a.domain, a.industry,
  COUNT(d.id) AS deal_count,
  SUM(d.amount) AS raw_pipeline,
  SUM(d.amount * COALESCE(/* TTE conditional prob from cache */, 0.25)) AS quality_pipeline,
  -- Account behavioral label: derived from deal RFM grades
  jsonb_build_object(
    'A', COUNT(d.id) FILTER (WHERE d.rfm_grade = 'A'),
    'B', COUNT(d.id) FILTER (WHERE d.rfm_grade = 'B'),
    'C', COUNT(d.id) FILTER (WHERE d.rfm_grade = 'C'),
    'D', COUNT(d.id) FILTER (WHERE d.rfm_grade = 'D'),
    'F', COUNT(d.id) FILTER (WHERE d.rfm_grade = 'F')
  ) AS deal_grade_breakdown,
  MIN(d.rfm_recency_days) AS most_recent_touch_days,
  -- ICP: from lead_scores if scored at account level, else avg of deal scores
  MAX(ls.total_score) AS icp_score,
  MAX(ls.score_grade) AS icp_grade,
  -- Findings
  COUNT(f.id) FILTER (WHERE f.severity = 'critical') AS critical_findings,
  COUNT(f.id) FILTER (WHERE f.severity = 'warning') AS warning_findings
FROM accounts a
LEFT JOIN deals d ON d.account_id = a.id AND d.is_closed = false
LEFT JOIN lead_scores ls ON ls.entity_id = d.id AND ls.entity_type = 'deal'
LEFT JOIN findings f ON f.account_id = a.id AND f.resolved_at IS NULL
WHERE a.workspace_id = $1
GROUP BY a.id
ORDER BY quality_pipeline DESC
```

The behavioral label is computed client-side from the `deal_grade_breakdown` JSONB to avoid a complex CASE expression in the query.

---

## S2: Findings Feed Cards (Command Center Home)

Each finding card in the Command Center home feed currently shows: skill name, severity, message, deal/account name, owner, timestamp.

### Add tri-signal badge row:

```
┌──────────────────────────────────────────────────────────────┐
│  🔴 Pipeline Hygiene  •  critical  •  2 hours ago           │
│  "Acme Enterprise ($2.8M) — no activity in 34 days"         │
│  Owner: Sarah Chen                                           │
│  ┌─────────────────────────────────────────────┐             │
│  │  ICP: A  │  Behavior: D  │  Prob: 12%      │             │
│  └─────────────────────────────────────────────┘             │
│  [View Deal →]  [Snooze]  [Assign]                           │
└──────────────────────────────────────────────────────────────┘
```

The tri-signal row is compact — three inline badges with color coding. It appears only when the finding references a deal (`entity_type = 'deal'` and `entity_id` is set). Account-level findings show the account tri-signal instead.

### Implementation:

The findings API already returns `entity_type` and `entity_id`. Extend the response to include pre-joined tri-signal data:

```typescript
// In GET /api/workspaces/:id/findings response, add per-finding:
{
  // ... existing fields ...
  tri_signal: {
    icp_grade: string | null,
    rfm_grade: string | null,
    rfm_label: string | null,
    tte_prob: number | null,
  } | null   // null for findings without entity reference
}
```

This is a LEFT JOIN to deals (for rfm_grade, rfm_label) and lead_scores (for icp grade) during the findings query. TTE conditional probability comes from the cached curve — store the last-computed conditional probability as a column on the deals table during `refreshComputedFields()` to avoid curve lookups at query time:

```sql
ALTER TABLE deals ADD COLUMN IF NOT EXISTS tte_conditional_prob NUMERIC;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS tte_computed_at TIMESTAMPTZ;
```

Populate alongside RFM during the computed fields refresh cycle.

### Triage value:

Without the badge, a user scanning 20 findings treats them as equally urgent within the same severity level. With the badge, they instantly see: "this critical finding is on an A-grade ICP deal going cold (worth saving)" vs "this critical finding is on an F-grade deal that's probably dead anyway (clean it up when you get to it)." The badges turn the findings feed from a flat list into a prioritized triage queue without changing the underlying data model.

---

## S3: Insights Feed Page

The Insights Feed is the chronological findings stream with infinite scroll (Phase B4). It's the same finding cards as S2, just on a dedicated page with more filter space.

### Additions beyond S2:

**Tri-signal filters in the sidebar:**

```
PIPELINE QUALITY:
  □ A-grade deals only
  □ B-grade deals
  □ C-grade deals
  □ D/F-grade deals

ICP FIT:
  □ A/B (strong fit)
  □ C (moderate)
  □ D/F (weak fit)
  □ Not scored

PROBABILITY:
  □ > 30% (healthy)
  □ 10-30% (at risk)
  □ < 10% (unlikely)
```

These filters compose with existing severity/skill/rep filters. The compound filter "severity=critical AND rfm_grade IN (A,B) AND tte_prob < 0.15" answers: "show me urgent findings on high-quality deals that are running out of time." That's a specific, actionable view that neither severity alone nor behavioral scoring alone produces.

**Aggregate summary bar at top of page:**

```
Showing 47 findings across 31 deals
Pipeline at risk: $4.2M across 8 A/B-grade deals with critical findings
Quick wins: 12 D/F-grade deals ($890K) recommended for cleanup
```

This summary reads from the same findings + deal join, aggregated client-side from the loaded result set.

---

## S4: Actions Queue

The Actions queue (Phase C) shows findings that need human decision: resolve, snooze, assign. Currently sorted by severity then recency.

### Sort by composite priority instead:

```typescript
// Actions queue sort order:
// 1. Severity (critical > warning > info)
// 2. Within same severity: composite priority descending
//    A $2.8M deal with ICP:A, Behavior:D, Prob:12% outranks
//    a $50K deal with ICP:F, Behavior:F, Prob:3% even at the same severity

function actionsQueueSort(a: Finding, b: Finding): number {
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
  if (sevDiff !== 0) return sevDiff;

  // Within same severity, sort by composite priority (higher = more important)
  return (b.tri_signal?.compositePriority ?? 0) - (a.tri_signal?.compositePriority ?? 0);
}
```

### Action card enhancement:

Each action card gains a "why this matters" line synthesized from the tri-signal:

```
🔴 Critical — Stale Deal
Acme Enterprise ($2.8M, Negotiation)
ICP: A | Behavior: D | Prob: 12%
💡 High-value deal with strong ICP fit is losing momentum.
   Re-engagement within 7 days increases recovery odds by 2.3x.

[Re-engage Now]  [Snooze 7d]  [Close Lost]  [Assign to →]
```

The "💡" line is NOT AI-generated at render time. It's a template-based sentence assembled from the tri-signal values and the historical win rates from the RFM backtest:

```typescript
function generateActionInsight(finding: Finding, triSignal: DealTriSignal): string | null {
  // High ICP + going cold = re-engagement urgency
  if (triSignal.icpFit.available && triSignal.icpFit.score >= 70 && triSignal.rfm.recencyDays > 21) {
    return `High-value deal with strong ICP fit is losing momentum. ` +
      `Deals re-engaged within 7 days of going cold recover at higher rates.`;
  }

  // Low probability + still active = zombie deal
  if (triSignal.tte.available && triSignal.tte.conditionalWinProb < 0.10 && triSignal.rfm.grade !== 'F') {
    return `Statistical likelihood of closing is below 10%, but the deal is still consuming rep time. ` +
      `Consider whether this deal warrants continued investment.`;
  }

  // All signals red = close it out
  if (triSignal.rfm.grade === 'F' && triSignal.tte.available && triSignal.tte.conditionalWinProb < 0.05) {
    return `This deal is behaviorally dead and statistically unlikely to close. ` +
      `Closing it out frees pipeline focus.`;
  }

  return null;
}
```

Pure template logic, zero LLM cost. The action buttons adapt based on the insight: if the insight says "re-engage," show a "Re-engage Now" button that creates a CRM task. If the insight says "close it out," show a "Close Lost" button.

---

## S5: Ask Pandora — Inline Deal Cards

When a user asks "which deals should I focus on?" or "tell me about this deal" via the Ask Pandora chat interface or the scoped query input on deal/account pages, the response currently renders as prose.

### Deal card component for chat responses:

When the response references specific deals, render them as compact inline cards rather than prose lists:

```
Here are the 5 deals most worth your attention this week:

┌──────────────────────────────────────────────────────┐
│ 1. Acme Enterprise          $2.8M    Negotiation     │
│    ICP: A (82)  │  Beh: D (Cold)  │  Prob: 12%      │
│    ⚠ Strong fit, losing momentum — last touch 34d    │
│    [View Deal →]                                      │
├──────────────────────────────────────────────────────┤
│ 2. Globex Platform          $1.5M    Proposal        │
│    ICP: A (78)  │  Beh: B (Healthy)  │  Prob: 38%   │
│    ✅ On track — proposal review scheduled Thursday   │
│    [View Deal →]                                      │
├──────────────────────────────────────────────────────┤
│ 3. DataFlow Expansion       $900K    Evaluation      │
│    ICP: B (65)  │  Beh: A (Hot)  │  Prob: 42%       │
│    ✅ High engagement — 12 touchpoints this month     │
│    [View Deal →]                                      │
└──────────────────────────────────────────────────────┘

The remaining 2 (Wayne Corp $400K, Initech $200K) are lower
priority — Wayne is going cold and Initech has weak ICP fit.
```

### Implementation:

This requires the Ask Pandora response format to support structured blocks. The scoped analysis endpoint (`POST /analyze`) returns prose today. Extend the response shape:

```typescript
interface AnalyzeResponse {
  answer: string;                    // Claude narrative (existing)
  structured_blocks?: StructuredBlock[];  // NEW: inline renderable blocks
  data_consulted: { ... };
  tokens_used: number;
}

type StructuredBlock =
  | { type: 'deal_cards'; deals: DealCardData[] }
  | { type: 'account_cards'; accounts: AccountCardData[] }
  | { type: 'survival_chart'; curve: SurvivalStep[]; dealAge?: number }
  | { type: 'quality_distribution'; distribution: Record<string, { count: number; amount: number }> };

interface DealCardData {
  dealId: string;
  name: string;
  amount: number;
  stage: string;
  triSignal: DealTriSignal;
  insightLine: string | null;      // from generateActionInsight()
}
```

The Claude synthesis prompt for Ask Pandora gains an instruction:

```
When your answer references specific deals, output a structured block alongside
your prose. Format: <deals>[deal_id_1, deal_id_2, ...]</deals>

The system will automatically render these as interactive deal cards with
tri-signal indicators. You do not need to list deal details in your prose —
the cards provide that. Focus your prose on interpretation and recommended actions.
```

The backend parses the `<deals>` tag from Claude's response, fetches the tri-signal for each referenced deal, and assembles the `DealCardData` array. The frontend renders the prose and the deal cards together.

---

## S6: Deal Stage History Timeline

The deal detail page shows stage transitions: from_stage → to_stage with timestamps. Currently a flat timeline with no behavioral context.

### Overlay behavioral state at each transition:

```
Timeline:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

● Created                         Day 0    Beh: —   Prob: 34%
│
● Discovery → Evaluation          Day 18   Beh: A   Prob: 38%
│  8 touchpoints in prior 30d, champion identified
│
● Evaluation → Proposal           Day 41   Beh: A   Prob: 41%
│  12 touchpoints, 3 calls including CFO
│
● Proposal → Negotiation          Day 56   Beh: B   Prob: 35%
│  Activity slowed to 5 touchpoints — normal for this stage
│
● [NOW]  Negotiation (stalled)    Day 87   Beh: D   Prob: 12%
│  2 touchpoints in last 30d, no calls in 34 days
│  ⚠ Behavioral grade dropped B → D since last stage change

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Data assembly:

For each stage transition in `deal_stage_history`, compute a point-in-time behavioral snapshot:

```typescript
interface TimelineNode {
  fromStage: string | null;
  toStage: string;
  changedAt: Date;
  dealAgeDays: number;

  // Behavioral state at this moment
  rfmGradeAtTransition: string | null;
  activityCountPrior30d: number;
  recencyDaysAtTransition: number;

  // TTE probability at this deal age
  conditionalProbAtTransition: number | null;

  // Delta from previous node
  behaviorChange: 'improved' | 'stable' | 'declined' | null;
  probChange: number | null;    // positive = improving
}
```

The RFM grade at a historical transition point requires a point-in-time activity query — same pattern as the T-30 snapshot in the RFM backtest, but at the transition date instead of T-30:

```sql
-- Activity count in 30 days before a specific date
SELECT COUNT(*) AS activity_count
FROM activities
WHERE deal_id = $1
  AND activity_date BETWEEN ($2::timestamptz - INTERVAL '30 days') AND $2::timestamptz
```

The TTE probability at a historical deal age is a lookup on the cached survival curve — `conditionalWinProbability(curve, dealAgeDaysAtTransition)`. No recomputation needed.

**Performance consideration:** This is N queries per deal (one per stage transition), typically 3-6 transitions. Acceptable for a drill-through view that loads on demand, not for list rendering.

### Visual encoding:

The behavioral grade at each node drives the node's color: green (A/B), yellow (C), red (D/F). The connector line between nodes also takes the color of the destination grade. A timeline that starts green and turns red tells the decay story visually before reading any text.

The probability at each node can optionally render as a mini sparkline running alongside the timeline, showing the probability trajectory as the deal aged. This reuses the sparkline component from Part 9b of the main addendum.

---

## S7: Conversation Timeline on Account Detail

The account detail page shows conversations chronologically with participants and summaries. Currently no behavioral context at call dates.

### Add behavioral state markers to conversation nodes:

```
Conversations with Acme Corp:

Jan 3   Call: "Q1 Planning Discussion" (42 min)
        Participants: Lisa Chen (Champion), James Park (CFO)
        Deal state: Enterprise ($2.8M) — Beh: A, Prob: 38%
        ✅ Peak engagement period

Jan 15  Call: "Technical Review" (28 min)
        Participants: Lisa Chen, Sarah Kim (Sr. Eng)
        Deal state: Enterprise ($2.8M) — Beh: A, Prob: 41%

Jan 22  Call: "Budget Discussion" (18 min)         ← last call
        Participants: James Park (CFO)
        Deal state: Enterprise ($2.8M) — Beh: B, Prob: 35%
        ⚠ Champion (Lisa Chen) absent from this call

─ ─ ─ ─ ─ 34 day gap ─ ─ ─ ─ ─                     ← visual gap

Feb 25  [TODAY]
        Deal state: Enterprise ($2.8M) — Beh: D, Prob: 12%
        🔴 No calls in 34 days. Behavioral grade dropped B → D.
```

### Key elements:

**Deal state at call time** — shows the deal's behavioral grade and TTE probability on the date of each call. This uses the same point-in-time lookup as the stage history timeline (S6). The user sees the deal was healthy during the January calls and then decayed during the gap.

**Gap visualization** — when there's a gap longer than the workspace's stale threshold between calls, render a dashed line with the gap duration. The gap is the story — it's where the deal went from B to D.

**"Today" node** — always show the current state at the bottom of the timeline, even if there's no call today. This anchors the decay narrative: "the last call was Jan 22, here's what's happened since."

**Missing participant alert** — if a contact who appeared in earlier calls (especially a champion or economic buyer from `deal_contacts`) disappears from later calls, flag it. This is a buying committee disengagement signal that's only visible when you overlay contact roles onto the conversation timeline.

### Data source:

All of this exists in the account dossier assembly — conversations + deal_contacts + deal RFM fields. The point-in-time behavioral state is the only new computation, using the same pattern as S6.

### When deal is not linked:

For conversations that aren't linked to a specific deal (unlinked calls from the cross-entity linker), show the conversation without deal state but with the account-level behavioral summary:

```
Feb 10  Call: "Follow-up" (15 min)               ⚠ UNLINKED
        Participants: unknown@acme.com
        Account state: Mixed — 1 active deal, 1 going cold
        [Link to Deal →]
```

---

## S8: CRM Custom Field Writeback

The existing spec mentions ICP score, lead grade, and risk flags as CRM writeback candidates. Extend with behavioral scoring and probability:

### Writeback fields:

```
Pandora_ICP_Grade         Text     "A"
Pandora_ICP_Score         Number   82
Pandora_Behavior_Grade    Text     "D"
Pandora_Behavior_Label    Text     "Going Cold"
Pandora_Win_Probability   Percent  0.12
Pandora_Priority_Rank     Number   3
Pandora_Last_Scored       DateTime 2026-02-28T14:30:00Z
```

### Why this matters:

Reps live in the CRM, not in Pandora. A rep looking at their pipeline in Salesforce or HubSpot needs to see `Pandora_Behavior_Grade: D` without opening another app. Managers building Salesforce reports can filter by `Pandora_Win_Probability < 0.10` to pull a cleanup list natively.

### Implementation:

Add to the bi-directional sync adapter (Session 5 in the build sequence). After `refreshComputedFields()` runs, the writeback step pushes updated fields to the CRM:

```typescript
// After computed fields refresh:
async function writebackTriSignalToCRM(
  workspaceId: string,
  deals: Deal[],
  crmAdapter: CRMAdapter
): Promise<WritebackResult> {
  const updates = deals.map(deal => ({
    externalId: deal.source_id,
    fields: {
      'Pandora_Behavior_Grade': deal.rfm_grade,
      'Pandora_Behavior_Label': deal.rfm_label,
      'Pandora_Win_Probability': deal.tte_conditional_prob,
      'Pandora_Priority_Rank': deal.priority_rank,
      'Pandora_Last_Scored': new Date().toISOString(),
    }
  }));

  return crmAdapter.batchUpdateDeals(updates);
}
```

**HubSpot:** Custom properties must be created first via the properties API. Create them during workspace setup or first sync. Property group: "Pandora Intelligence."

**Salesforce:** Custom fields on Opportunity. Same creation requirement. Field names become `Pandora_Behavior_Grade__c` per Salesforce naming conventions.

### Writeback frequency:

Every sync cycle (same as computed fields refresh). Not real-time — that would require webhook-based push which is Phase 6 of the build sequence. Daily or per-sync is sufficient because RFM grades don't change hour to hour.

### Writeback toggle:

Some workspaces won't want Pandora writing to their CRM. Add a workspace config flag:

```typescript
interface WorkspaceConfig {
  // ... existing fields ...
  crm_writeback: {
    enabled: boolean;
    fields: string[];   // which fields to write — subset of all available
    // e.g., ['behavior_grade', 'win_probability'] but not 'icp_grade'
  };
}
```

Default: disabled. Enabled per-workspace during onboarding.

---

## S9: Skills Page — Run Comparison

The Skills page shows run history per skill with a "Compare Runs" option that diffs two evidence objects. Add tri-signal distribution comparison.

### Run comparison card:

```
Pipeline Hygiene — Run Comparison
Feb 24 (this week) vs Feb 17 (last week)

Pipeline Quality Shift:
  A+B deals: 30 → 28 (lost 2, -$340K)
  C deals:    8 → 9  (gained 1, +$120K)
  D+F deals:  6 → 10 (gained 4, +$580K)
  ⚠ Pipeline quality deteriorated — 4 deals downgraded

Stale Deal Changes:
  New stale:    6 deals ($1.9M) — 2 are A-grade ICP (worth saving)
  Resolved:     3 deals ($800K) — re-engaged successfully
  Still stale:  14 deals ($3.2M)

Probability-Weighted Pipeline:
  Feb 17: $4.8M expected value
  Feb 24: $4.1M expected value (-$700K)
  Driver: 4 deals aged past their close window, dropping conditional probability
```

### Implementation:

Each skill run already stores `result_data` as JSONB. When comparing two runs, the diff engine computes:

```typescript
interface TriSignalRunDiff {
  gradeDistributionChange: {
    grade: string;
    countDelta: number;
    amountDelta: number;
  }[];

  dealsDowngraded: {
    dealId: string;
    dealName: string;
    previousGrade: string;
    currentGrade: string;
    amount: number;
  }[];

  dealsUpgraded: {
    dealId: string;
    dealName: string;
    previousGrade: string;
    currentGrade: string;
    amount: number;
  }[];

  probabilityWeightedPipelineChange: number;

  newStaleByIcpGrade: Record<string, { count: number; amount: number }>;
}
```

The diff computes by matching deals across runs (by deal ID), comparing their RFM grades and TTE probabilities. Deals present in one run but not the other are flagged as "new" or "removed."

This doesn't require storing tri-signal snapshots per run — the current deal state has the grades, and the previous run's `result_data` contains the deal list from that point. The comparison is deals-in-run-A vs deals-in-run-B with current computed fields for context.

---

## S10: Rep Scorecard — Slack Output

The Rep Scorecard skill already computes per-rep metrics (closed won, quota attainment, pipeline, activity). Add pipeline quality distribution per rep.

### Slack output update:

```
📊 *Rep Scorecard — Week of Feb 24*

*Sarah Chen* — 78% to quota
  Pipeline: $3.2M raw, $2.1M quality (66% healthy)
  Deals: 8 total — 5 A/B grade, 2 C, 1 D
  Activity: 34 touchpoints (↑ from 28 last week)
  ✅ Strong pipeline quality. On track.

*Mike Torres* — 42% to quota
  Pipeline: $2.8M raw, $800K quality (29% healthy)
  Deals: 12 total — 3 A/B grade, 4 C, 5 D/F
  Activity: 18 touchpoints (↓ from 25 last week)
  ⚠ High deal count but most pipeline is behaviorally cold.
     5 D/F-grade deals ($1.4M) consuming time without progress.

*Priya Patel* — 95% to quota
  Pipeline: $1.8M raw, $1.5M quality (83% healthy)
  Deals: 6 total — 5 A/B grade, 1 C
  Activity: 42 touchpoints (stable)
  ✅ Highest quality pipeline on the team. Focused execution.
```

### Key insight for managers:

Mike has $2.8M in pipeline — more than Priya. By raw numbers he looks better. But only $800K is quality pipeline. He's carrying 5 dead deals that inflate his total. The quality pipeline metric instantly reveals that Mike needs coaching on deal qualification and cleanup, while Priya's smaller but cleaner pipeline is actually more likely to convert.

### Compute additions:

In the Rep Scorecard compute step, add per-rep quality metrics:

```typescript
// Add to repScorecard() output per rep:
{
  // ... existing fields ...

  // Pipeline quality
  qualityPipeline: number,            // sum of amount for A/B-grade deals
  qualityPipelinePercent: number,     // qualityPipeline / openPipeline
  dealGradeDistribution: Record<string, number>,  // { A: 2, B: 3, C: 2, D: 1, F: 0 }
  deadPipelineValue: number,          // sum of amount for D/F-grade deals
  deadPipelineCount: number,

  // Probability-weighted
  expectedPipeline: number,           // sum of amount × conditional probability
  expectedToQuota: number,            // (closedWon + expectedPipeline) / quota
}
```

### Synthesis prompt addition:

```
PER-REP PIPELINE QUALITY:
{{#each reps}}
- {{name}}: ${{qualityPipeline}} quality of ${{openPipeline}} raw ({{qualityPipelinePercent}}% healthy)
  Grade distribution: {{formatGradeDist(dealGradeDistribution)}}
  {{#if (gt deadPipelineCount 3)}}
  ⚠ {{deadPipelineCount}} D/F-grade deals (${{deadPipelineValue}}) — candidates for cleanup
  {{/if}}
  Expected pipeline (probability-weighted): ${{expectedPipeline}}
  Expected-to-quota: {{expectedToQuota | percent}} (vs {{quotaAttainment | percent}} closed-to-quota)
{{/each}}

When writing each rep's section, highlight the gap between raw pipeline and quality pipeline.
If a rep has high raw pipeline but low quality pipeline, they need deal cleanup coaching.
If a rep has high quality pipeline but low activity, they're efficient but may not be generating enough.
Use the expected-to-quota metric as the most honest assessment of where each rep stands.
```

### Composite score update:

The Rep Scorecard composite score formula currently weights `coverageRatio_normalized * 0.20`. Replace with `qualityPipelinePercent_normalized * 0.20` — this rewards reps who maintain clean, healthy pipeline over reps who inflate their numbers with dead deals.

---

## Build Effort for Supplemental Components

| Component | Track | Effort | Dependencies |
|---|---|---|---|
| S1: Account list columns + API | Replit | 2-3 hours | RFM computed fields, TTE cached prob |
| S2: Finding card tri-signal badges | Replit | 1-2 hours | Findings API join extension |
| S3: Insights Feed filters + summary | Replit | 1-2 hours | S2 (same data, different page) |
| S4: Actions queue sort + insight line | Replit + Claude Code | 2-3 hours | S2 + generateActionInsight() |
| S5: Ask Pandora deal cards | Replit + Claude Code | 3-4 hours | AnalyzeResponse extension, card component |
| S6: Stage history behavioral overlay | Replit | 2-3 hours | Point-in-time activity queries |
| S7: Conversation timeline markers | Replit | 2-3 hours | Same pattern as S6 |
| S8: CRM writeback extension | Claude Code + Replit | 3-4 hours | Bi-directional sync (Session 5) |
| S9: Skills run comparison diff | Replit | 2-3 hours | Run comparison engine |
| S10: Rep Scorecard quality metrics | Claude Code | 2-3 hours | RFM computed fields |
| **Total** | | **~22-30 hours** | |

Combined with the main addendum (~30-35 hours), the full tri-signal integration across all surfaces is **~52-65 hours** total. The critical dependency chain remains the same: `computeDealTriSignal()` and the `tte_conditional_prob` column on deals unlock everything downstream.

---

**END OF SUPPLEMENTAL UPDATE**
