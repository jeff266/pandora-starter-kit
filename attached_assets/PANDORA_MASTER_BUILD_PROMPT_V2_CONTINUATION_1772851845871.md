# Pandora Build Prompt — V2 Continuation
## Remaining Tasks: T013, T015, T017, T018, T020, T021

**Status:** Continuation — T010, T011, T012, T014, T016, T019 are complete  
**Context:** Read `PANDORA_MASTER_BUILD_PROMPT_V2.md` for full specs on all tasks. This prompt covers only the six remaining tasks and their sequencing.

---

## What Was Built in the Prior Session

- **T010 — Session Context Object:** Active scope inheritance, TTL-based computation cache, session findings/charts/recommendations accumulation
- **T011 — Document Accumulator:** Document Pill UI, auto-slotting into WBR/QBR/Board Deck/Forecast Memo/Deal Review sections, user section overrides, Render → trigger
- **T012 — Narrative Synthesis:** Executive summary, section bridge transitions, `documentThroughline`, low-confidence flagging before distribution
- **T014 — Cross-Signal Analysis:** Four convergent patterns (pricing friction → conversion drop, single thread → deal risk, ICP mismatch → churn signal, data quality → forecast risk), "Connected Intelligence" block in chat, auto-slot to Key Risks
- **T016 — Action Judgment Layer:** Three-tier execution (autonomous / approval / escalate), Approve/Edit/Skip cards for standard CRM writes and rep DMs, escalation cards for bulk updates and territory/quota/forecast changes
- **T019 — Cross-Session Workspace Memory:** `workspace_memory` table, occurrence_count incrementing for recurring findings, `<workspace_memory>` injection into agent system prompt on every turn

---

## Before Starting

Scan and read these files before writing any code:

1. `server/agents/session-context.ts` — SessionContext shape built in T010
2. `server/documents/accumulator.ts` — DocumentAccumulator built in T011
3. `server/documents/synthesizer.ts` — narrative synthesis built in T012
4. `server/memory/workspace-memory.ts` — memory writer/reader built in T019
5. `server/actions/judgment.ts` — action judgment layer built in T016
6. `server/agents/orchestrator.ts` — how chat responses are assembled
7. `PANDORA_ACTIONS_ENGINE_SPEC.md` — three-ring action model (native, generated workflows, webhook events)
8. Existing Slack integration — where Slack messages are posted today
9. Existing Resend email integration — where transactional email is sent today
10. The `actions` table schema

**Do not proceed until you have read all ten.**

---

## Remaining Tasks

---

### T013 — Document Distribution + Human-in-the-Loop Review

**Priority:** High — completes the document workflow end-to-end  
**Files:** `server/documents/distributor.ts` (new), update `client/src/components/documents/RenderModal.tsx` or equivalent render trigger UI  
**Blocked by:** T012 complete ✓

**The render flow today ends at file generation.** T013 adds distribution channels and the mandatory human review gate before anything goes out.

#### Review Gate (mandatory when low-confidence items exist)

When the user clicks "Render →" and `lowConfidenceCount > 0`, show a review panel before generating the document:

```
Before distributing, review these items:

⚠  Attainment figure was updated mid-session (corrected from 21% → 110% when ACES closed)
   The document uses the corrected figure. Confirm this is right.
   [✓ Confirmed]  [✗ Remove from document]

⚠  Sara's forecast number — you corrected Pandora on this during the conversation.
   Document uses $190K (your correction). Confirm this is right.
   [✓ Confirmed]  [✗ Remove from document]

[Continue to render →]    [Cancel]
```

Rules:
- Review panel is **required before distribution** (Slack, email, Drive) when `lowConfidenceCount > 0`
- Review panel is a **warning, not a gate, for downloads** — user can proceed without confirming
- Each low-confidence item must be individually confirmed or removed before "Continue to render" activates
- Confirmed items: proceed as-is. Removed items: contribution is excluded from render, document re-synthesizes without it.

Low-confidence signals (from T012):
- A number corrected by the user during the conversation (contradiction handler fired)
- A value sourced from a brief snapshot that predates the last sync
- A calculation where `record_count < 5`
- A recommendation the user initially pushed back on before accepting

#### Distribution Options

After the review gate (or immediately for downloads), show:

```
📄  Q1 WBR · March 6, 2026

[↓ Download PPTX]   [↓ Download DOCX]   [↓ Download PDF]

Share:
[📣 Post to Slack]   [📧 Email to team]   [💾 Save to Drive]
```

**Slack distribution:**
- Use existing Slack renderer to post a summary block to the configured workspace channel
- Include: document title, throughline sentence, section count, top 3 findings by severity
- Attach a download link or file if the Slack API supports it for the workspace
- Channel selection: use the workspace's default ops channel, with an option to override

**Email distribution:**
- Use existing Resend integration
- Subject: `[Pandora] {document_title} · {date}`
- Body: executive summary from T012 synthesis + download link
- Attachment: PDF version of the rendered document
- Recipients: pull from workspace settings (`notification_emails`), with option to add ad-hoc recipients

**Google Drive:**
- Use existing Google Drive connector
- Save to a configured Pandora folder in the workspace's Drive
- File name: `{document_type}_{date}_{workspace_name}.{ext}`
- Return a shareable link after saving

**Distribution record:** After any distribution, write to a `document_distributions` table:
```sql
CREATE TABLE document_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  document_id UUID NOT NULL,
  channel TEXT NOT NULL,          -- 'slack' | 'email' | 'drive' | 'download'
  recipient TEXT,                 -- channel name, email address, or drive folder
  distributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL,           -- 'sent' | 'failed'
  error TEXT
);
```

**Acceptance:** Complete a 5-message session. Click Render →. The review panel appears with two low-confidence items. Confirm both. Select "Post to Slack." The document summary appears in the Slack channel with a download link. The `document_distributions` table has a record.

---

### T015 — Strategic Reasoning Layer

**Priority:** Medium  
**Files:** `server/skills/strategic-reasoner.ts` (new), update `server/agents/orchestrator.ts` to route strategic questions  
**Blocked by:** T010 complete ✓, T014 complete ✓

**Strategic questions are fundamentally different from analytical questions.** An analytical question asks "what is happening." A strategic question asks "why does this keep happening" or "what should we change." They require a different reasoning mode and a different response structure.

#### Strategic Question Detection

Extend the router classification to add `question_type: 'strategic'` when the user message contains:

- "why do we keep..." / "why does this always..." / "why has this been..."
- "should we..." / "what should we change..." / "is our [X] right?"
- "what's the root cause of..." / "what's driving..."
- "next quarter..." / "going forward..." / "for Q2..."
- "is [our process / our motion / our territory / our quota] working?"
- Any question referencing 2+ prior quarters or time periods

#### Strategic Reasoning Output Shape

```typescript
interface StrategicReasoningOutput {
  question: string;
  hypothesis: string;              // Pandora's best answer to why — one clear sentence
  supportingEvidence: {
    claim: string;
    source: string;                // Which skill or signal
    strength: 'strong' | 'moderate' | 'weak';
  }[];
  contradictingEvidence: {
    claim: string;
    source: string;
    implication: string;           // What it means if this is right instead
  }[];
  recommendation: string;          // What to do — specific and actionable
  tradeoffs: string[];             // What you give up by doing this
  watchFor: string[];              // What signals would tell you the recommendation is wrong
  confidence: 'high' | 'medium' | 'low';
  confidenceReason: string;        // Why this confidence level
  memoryContext?: string;          // If workspace_memory has prior periods showing same pattern
}
```

#### Prompt Pattern

Strategic questions get a dedicated system prompt section. Inject into the orchestrator:

```
This is a strategic question — the user is asking about root causes or systemic changes, not current state.

Respond using this structure:
1. HYPOTHESIS: Your single best answer to why this is happening. Be direct. Don't hedge.
2. SUPPORTING EVIDENCE: 2-4 specific data points from the session context that point toward this hypothesis. Cite the skill or signal each came from.
3. CONTRADICTING EVIDENCE: 1-2 things that don't fit your hypothesis. Name them honestly. A good analyst calls out what they can't explain.
4. RECOMMENDATION: One specific action. Not a list of options — a recommendation. If you have uncertainty, name it in the tradeoffs, not in the recommendation itself.
5. TRADEOFFS: What the recommended action costs or risks.
6. WATCH FOR: What would tell you within 30-60 days if you're wrong.

If workspace_memory shows this pattern recurring across prior periods, open with that context before the hypothesis.

Tone: teammate, not consultant. You own this number too. Use "we" not "the team."
```

#### Response rendering in chat

Strategic reasoning responses render with distinct visual treatment — a structured card rather than prose:

```
🧠 Strategic Analysis

Hypothesis
We're missing mid-market because of coverage load, not conversion skill.

Supporting evidence
· Coverage ratio: 1.8x (vs. 3x needed at current conversion rates) — Pipeline Coverage skill
· Next-step documentation: 43% for mid-market reps vs. 71% for enterprise — Data Quality skill  
· Connected signal: Single-thread rate is 2x higher in mid-market deals — Cross-Signal analysis

What doesn't fit
· Enterprise conversion is only slightly better (34% vs. 31%) — if this were purely a capacity problem,
  enterprise would show a bigger gap. There may be a product-market fit component we can't rule out.

Recommendation
Reassign 4 mid-market accounts from Sara and Marcus to the new hire ramp cohort. Reduces their 
load by ~20% and gives new hires real pipeline without abandoning existing relationships.

What you give up
New hire ramp timelines extend when accounts are added early. If the issue is product fit, 
this doesn't fix anything.

Watch for
If coverage improves but conversion doesn't move in 60 days, the hypothesis is wrong — 
look at product-market fit for mid-market segment instead.

Confidence: Medium — the coverage signal is clear; the product fit question is unresolved.
```

#### Session context + memory integration

Before running strategic reasoning, pull:
1. All `sessionFindings` from T010 session context — full evidence base for this conversation
2. Relevant `workspace_memory` entries (T019) for the entity in scope — if this pattern has appeared before, say so at the top

If `occurrence_count >= 3` in workspace memory for related findings, open the response with:
> "This is the third quarter we've flagged this. That changes the frame — this isn't a tactical miss, it's a systemic pattern that hasn't been addressed."

#### Document accumulator integration

Strategic reasoning outputs slot into the Document Accumulator automatically:
- `hypothesis` + `recommendation` → `recommendations` section
- `contradictingEvidence` → `key_risks` section (honest uncertainty is a risk worth documenting)
- Full `StrategicReasoningOutput` → `appendix` section as supporting analysis

**Acceptance:** Ask "why do we keep struggling in mid-market?" The response renders as a structured strategic card with all six sections. The confidence level and reason are shown. If workspace memory has prior quarters' data, it opens with the recurrence context. The recommendation slots into the Document Accumulator.

---

### T017 — Slack Draft Queue

**Priority:** Medium  
**Files:** `server/actions/slack-draft.ts` (new), new `slack_drafts` table migration, update `client/src/components/actions/ActionCard.tsx`  
**Blocked by:** T016 complete ✓

**When Pandora recommends a rep-facing action, it should draft the Slack message and queue it for VP approval — not send it directly.**

This is a specific sub-mode of the approval ring in T016. When `action_type === 'slack_dm'` and `recipient_type === 'rep'`, the action judgment layer (T016) routes to approval mode. T017 builds the draft generation and the approval/send UI for that path.

#### Database migration

```sql
CREATE TABLE slack_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_action_id UUID REFERENCES actions(id),
  source_skill_id TEXT,
  
  recipient_slack_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  
  draft_message TEXT NOT NULL,
  edited_message TEXT,          -- populated if VP edits before sending
  context TEXT NOT NULL,        -- why Pandora drafted this (one sentence)
  
  status TEXT NOT NULL DEFAULT 'draft',
  -- 'draft' | 'approved' | 'sent' | 'dismissed'
  
  approved_by TEXT,             -- user ID of approver
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismiss_reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Draft generation

When the action judgment layer routes a rep DM to approval mode, generate the draft before presenting the action card. Draft generation call:

```typescript
async function generateSlackDraft(
  recipientName: string,
  recommendation: Recommendation,
  dealContext?: LiveDealFact
): Promise<string> {
  // Prompt pattern:
  // Write a Slack DM from a VP of RevOps to a rep named {recipientName}.
  // The message is about: {recommendation.action}
  // Deal context: {dealContext}
  // 
  // Tone: direct, collegial, peer-to-peer — not a system notification.
  // Length: 2-4 sentences. No bullet points. No formal greeting ("Hi Sara —" is fine).
  // The VP is helping, not criticizing.
  // Don't mention Pandora or that this was AI-generated.
}
```

**Example draft for a single-thread risk:**
```
Hi Sara — Behavioral Framework needs a second decision-maker on the next call before we 
can move it forward. Can you get their VP or an economic buyer looped in by Wednesday? 
Happy to help with an intro if you have a warm contact in mind.
```

**Example draft for a stale deal:**
```
Hey Marcus — Action Behavior Centers has been quiet for 12 days. Worth a quick check-in 
before end of week? Even a "just confirming timeline" message keeps us visible.
```

#### Action card UI (update T016's approval card for this specific type)

When `action_type === 'slack_dm'`, the approval card shows the draft inline:

```
📨  Draft Slack DM → Sara Phillips

"Hi Sara — Behavioral Framework needs a second decision-maker on the next call before 
we can move it forward. Can you get their VP or an economic buyer looped in by Wednesday? 
Happy to help with an intro if you have a warm contact in mind."

[✓ Send as-is]   [✎ Edit & Send]   [✗ Dismiss]
```

"Edit & Send" opens an inline text editor with the draft pre-populated. The user edits and hits Send. The edited version is stored in `slack_drafts.edited_message`.

**Slack send:** Use the existing Slack API integration to send the DM. The message is sent as the connected Slack bot, with the VP's name in the message body. It does NOT appear as being from Pandora.

**Acceptance:** A single-thread finding on Sara triggers an action recommendation. The action card appears with the drafted Slack message. "Send as-is" sends the DM to Sara's Slack. The `slack_drafts` table records the sent message with status = 'sent'.

---

### T018 — Closed-Loop Recommendation Tracking

**Priority:** Medium  
**Files:** `server/documents/recommendation-tracker.ts` (new), update `server/memory/workspace-memory.ts`  
**Blocked by:** T019 complete ✓, T011 complete ✓

**Pandora makes recommendations. It should know what happened to them.**

#### Recommendation lifecycle

Recommendations created in T011's session accumulator flow through this lifecycle:

```
created (session)
  → accepted | dismissed (user in chat)
  → actioned (task created, Slack sent, user confirms)
  → resolved (deal outcome known — closed_won / closed_lost / slipped / timeout)
  → retrospective (was the recommendation correct?)
```

#### Outcome detection

After every sync that produces material changes (T8 from the prior prompt), check whether any open recommendations reference the changed deals:

```typescript
async function evaluateRecommendationOutcomes(
  workspaceId: string,
  materialChanges: MaterialChange[]
): Promise<void> {
  
  for (const change of materialChanges) {
    // Find open recommendations for this deal
    const openRecs = await db.query(`
      SELECT * FROM recommendations
      WHERE workspace_id = $1
        AND deal_id = $2
        AND status IN ('accepted', 'actioned')
        AND resolved_at IS NULL
    `, [workspaceId, change.dealId]);
    
    for (const rec of openRecs.rows) {
      const outcome = change.type === 'deal_closed_won' ? 'closed_won'
        : change.type === 'deal_closed_lost' ? 'closed_lost'
        : 'slipped';
      
      await resolveRecommendation(rec.id, outcome, change);
    }
  }
}

async function resolveRecommendation(
  recommendationId: string,
  outcome: string,
  change: MaterialChange
): Promise<void> {
  
  const rec = await getRecommendation(recommendationId);
  const wasActioned = rec.status === 'actioned';
  
  // Determine if outcome aligned with recommendation intent
  const outcomePositive = outcome === 'closed_won';
  const recommendationWasRisk = rec.urgency === 'today' || rec.category === 'deal_risk';
  
  const recommendationCorrect = 
    (recommendationWasRisk && outcomePositive && wasActioned) ||  // warned → actioned → won
    (recommendationWasRisk && !outcomePositive && !wasActioned);  // warned → ignored → lost
  
  // Update recommendation record
  await db.query(`
    UPDATE recommendations
    SET status = 'resolved',
        resolved_at = NOW(),
        outcome = $1,
        was_actioned = $2,
        recommendation_correct = $3
    WHERE id = $4
  `, [outcome, wasActioned, recommendationCorrect, recommendationId]);
  
  // Write to workspace memory
  await writeRecommendationOutcomeMemory(rec, outcome, wasActioned, recommendationCorrect);
}
```

#### Workspace memory entry for outcomes

```typescript
async function writeRecommendationOutcomeMemory(
  rec: Recommendation,
  outcome: string,
  wasActioned: boolean,
  correct: boolean
): Promise<void> {
  await db.query(`
    INSERT INTO workspace_memory
      (workspace_id, memory_type, entity_type, entity_id, entity_name,
       period_start, period_end, period_label, content, summary)
    VALUES ($1, 'recommendation_outcome', 'deal', $2, $3, $4, $5, $6, $7, $8)
  `, [
    rec.workspaceId,
    rec.dealId,
    rec.dealName,
    getCurrentPeriodStart(),
    getCurrentPeriodEnd(),
    getCurrentPeriodLabel(),
    JSON.stringify({
      recommendation: rec.action,
      urgency: rec.urgency,
      outcome,
      was_actioned: wasActioned,
      recommendation_correct: correct
    }),
    correct
      ? `Recommendation on ${rec.dealName} was actioned and the deal ${outcome === 'closed_won' ? 'closed' : 'outcome matched warning'}.`
      : `Recommendation on ${rec.dealName} was ${wasActioned ? 'actioned but deal still lost' : 'not actioned — deal ' + outcome}.`
  ]);
}
```

#### Brief surface for outcomes

In the next brief assembly after a deal closes, if there was an active recommendation on that deal, surface the outcome in the "Since last week" comparison block (T020):

> "✓ Behavioral Framework closed — $105K won. The multi-thread recommendation from last week was actioned three days before close. This is the second time this quarter that adding a contact in Stage 3 preceded a win."

If the recommendation was NOT actioned and the deal was lost:

> "✗ Action Behavior Centers — lost. The single-thread risk was flagged two weeks ago. No second contact was added before the deal went dark."

The tone is factual, not accusatory. Pandora is building its own track record, not finger-pointing.

#### Pattern accumulation in workspace memory

When `occurrence_count >= 2` for `recommendation_outcome` memories of the same type:

```typescript
// Check for pattern: same recommendation type → same outcome
const pattern = await db.query(`
  SELECT 
    content->>'recommendation_type' as rec_type,
    outcome,
    COUNT(*) as count,
    SUM(CASE WHEN was_actioned THEN 1 ELSE 0 END) as actioned_count,
    SUM(CASE WHEN recommendation_correct THEN 1 ELSE 0 END) as correct_count
  FROM workspace_memory
  WHERE workspace_id = $1
    AND memory_type = 'recommendation_outcome'
  GROUP BY content->>'recommendation_type', outcome
  HAVING COUNT(*) >= 2
`, [workspaceId]);
```

When a pattern exists, inject into the system prompt:
> "Multi-thread recommendations have been actioned 3 times this quarter. All 3 deals closed. This pattern is worth naming in strategic reasoning."

**Acceptance:** Create a recommendation for Behavioral Framework (single-thread risk). Mark it as actioned. Sync ACES closing (or manually close the deal). The recommendation is resolved with `outcome = 'closed_won'` and `recommendation_correct = true`. The workspace memory has a `recommendation_outcome` entry. The next brief's comparison block surfaces the outcome.

---

### T020 — Prior Document Comparison

**Priority:** Medium  
**Files:** `server/documents/comparator.ts` (new), update `server/briefs/brief-assembler.ts`  
**Blocked by:** T019 complete ✓

**Every brief should know what the prior brief said.** The "Since last week" block transforms the brief from a standalone snapshot into a living record.

#### Comparison data model

```typescript
interface DocumentComparison {
  priorDocumentId: string;
  priorAssembledAt: string;
  priorPeriodLabel: string;       // "Last week" | "Last brief" | "Q4 2025"
  
  resolved: ComparisonItem[];     // In prior, not in current — problem went away
  persisted: ComparisonItem[];    // In both — still happening
  new: ComparisonItem[];          // In current, not in prior — new issue
  improved: MetricChange[];       // Metrics that got better
  worsened: MetricChange[];       // Metrics that got worse
}

interface ComparisonItem {
  category: string;
  summary: string;               // One sentence
  entity?: string;               // Deal name, rep name, etc.
  occurrenceCount?: number;      // From workspace_memory
}

interface MetricChange {
  metric: string;
  prior: number | string;
  current: number | string;
  delta: string;                 // "+0.5x" | "-$50K" | "+7pp"
  direction: 'improved' | 'worsened';
}
```

#### Comparison logic

When assembling a brief, find the prior brief for this workspace:

```typescript
async function buildComparison(
  workspaceId: string,
  currentBriefId: string
): Promise<DocumentComparison | null> {
  
  const priorBrief = await db.query(`
    SELECT * FROM weekly_briefs
    WHERE workspace_id = $1
      AND id != $2
    ORDER BY assembled_at DESC
    LIMIT 1
  `, [workspaceId, currentBriefId]);
  
  if (!priorBrief.rows[0]) return null;
  
  const prior = priorBrief.rows[0];
  const current = await getCurrentBriefData(workspaceId, currentBriefId);
  
  // Compare findings from skill_runs associated with each brief period
  const priorFindings = await getFindingsForPeriod(workspaceId, prior.period_start, prior.period_end);
  const currentFindings = await getFindingsForPeriod(workspaceId, current.period_start, current.period_end);
  
  return {
    priorDocumentId: prior.id,
    priorAssembledAt: prior.assembled_at,
    priorPeriodLabel: getRelativePeriodLabel(prior.assembled_at),
    
    resolved: findResolved(priorFindings, currentFindings),
    persisted: findPersisted(priorFindings, currentFindings),
    new: findNew(priorFindings, currentFindings),
    improved: compareMetrics(prior.the_number, current.the_number, 'improved'),
    worsened: compareMetrics(prior.the_number, current.the_number, 'worsened')
  };
}
```

**Matching logic for resolved/persisted/new:** Match findings by `(category, entity_id)` pair. If the same category + entity appeared in both periods → `persisted`. If appeared in prior only → `resolved`. If appeared in current only → `new`.

#### Rendering in the brief

The comparison block appears near the top of the VP RevOps Brief, below the narrative intro and metrics strip, above the Focus block:

```
Since last week
✓  Behavioral Framework closed — $105K, multi-thread rec was actioned
↑  Coverage ratio: 1.6x → 2.1x (+0.5x)
→  Action Behavior Centers still single-threaded (week 3)
↓  Days remaining: 33 → 26 (-7)
⚡  New: ACES ABA close date slipped to Mar 20 (was Mar 5)
```

Icon legend:
- `✓` = resolved (green)
- `↑` = improved metric (teal)  
- `→` = persisted finding (amber)
- `↓` = worsened metric (coral)
- `⚡` = new finding (coral)

If `occurrence_count >= 3` in workspace_memory for a persisted finding, append ` · {n} consecutive weeks` in muted text:

```
→  Sara single-threaded on two deals · 4 consecutive weeks
```

**Acceptance:** Generate a brief. Then generate another brief the following week (or with a mock prior period). The second brief shows a "Since last week" block with at least one resolved, one persisted, and one new item correctly classified. Persisted items with 3+ occurrences show the week count.

---

### T021 — Forecast Accuracy Memory

**Priority:** Medium  
**Files:** Update `server/memory/workspace-memory.ts`, update `server/briefs/brief-assembler.ts`  
**Blocked by:** T019 complete ✓

**Historical forecast accuracy should discount current forecast confidence.** If a rep has called $200K commit for three quarters and averaged $140K closed, Pandora should apply that discount factor when discussing their current commit.

#### Forecast accuracy record

At the end of each quarter (or when sufficient data is available to compute actuals), write a `forecast_accuracy` memory entry:

```typescript
interface ForecastAccuracyMemory {
  period: string;                  // "Q1 2026"
  period_start: string;
  period_end: string;
  
  // Workspace-level
  commit_called: number;
  commit_closed: number;
  best_case_called: number;
  best_case_closed: number;
  commit_accuracy_pct: number;     // commit_closed / commit_called
  
  // Per-rep breakdown
  by_rep: {
    rep_name: string;
    rep_id: string;
    committed: number;
    closed: number;
    accuracy_pct: number;
    trend: 'improving' | 'stable' | 'declining';  // vs. prior period
  }[];
  
  // Data quality note
  sample_deals: number;           // How many deals were in this period
  confidence: 'high' | 'medium' | 'low';
}
```

#### When to write forecast accuracy memory

Trigger after each quarter close is detected — when the workspace has `days_remaining = 0` or when a manual "close quarter" action is taken. If a full quarter hasn't passed yet, write partial accuracy for the current period using closed deals to date.

```typescript
async function writeQuarterlyForecastAccuracy(workspaceId: string, period: string): Promise<void> {
  
  // Pull all deals closed this period
  const closedDeals = await db.query(`
    SELECT d.owner_name, d.amount, d.forecast_category,
           dsh.entered_at as close_date
    FROM deals d
    JOIN deal_stage_history dsh ON dsh.deal_id = d.id
    WHERE d.workspace_id = $1
      AND d.stage = 'closed_won'
      AND dsh.stage_normalized = 'closed_won'
      AND dsh.entered_at BETWEEN $2 AND $3
  `, [workspaceId, periodStart, periodEnd]);
  
  // Pull commit forecasts made at the start of the period
  // (from weekly_briefs or forecast_rollup skill runs at period start)
  const forecastCalls = await getCommitCallsForPeriod(workspaceId, periodStart);
  
  // Calculate accuracy per rep
  const byRep = computeRepAccuracy(closedDeals.rows, forecastCalls);
  
  await db.query(`
    INSERT INTO workspace_memory
      (workspace_id, memory_type, entity_type, period_start, period_end, period_label, content, summary)
    VALUES ($1, 'forecast_accuracy', 'workspace', $2, $3, $4, $5, $6)
  `, [
    workspaceId,
    periodStart,
    periodEnd,
    period,
    JSON.stringify({ commit_called, commit_closed, commit_accuracy_pct, by_rep: byRep }),
    `Q commit accuracy: ${commit_accuracy_pct}% (called $${commit_called.toLocaleString()}, closed $${commit_closed.toLocaleString()})`
  ]);
}
```

#### Using forecast accuracy in the brief and chat

When discussing the current forecast, inject historical accuracy from workspace memory:

```typescript
async function getForecastAccuracyContext(workspaceId: string): Promise<string> {
  const history = await db.query(`
    SELECT content, period_label
    FROM workspace_memory
    WHERE workspace_id = $1
      AND memory_type = 'forecast_accuracy'
    ORDER BY period_start DESC
    LIMIT 3
  `, [workspaceId]);
  
  if (history.rows.length === 0) return '';
  
  // Build context string for LLM injection
  // "Over the last 2 quarters, team commit accuracy has averaged 71%.
  //  Nate: 89% (most reliable). Sara: 74%. Marcus: 61% (consistently over-calls)."
  return buildAccuracyContextString(history.rows);
}
```

Inject into the agent system prompt as `<forecast_accuracy_history>` when the question involves forecast or commit numbers.

#### In the brief

Below the attainment metrics strip (the `21% attainment · 2.4x coverage · $278K gap · 26d remaining` badges), show a forecast accuracy line when history exists:

```
Historical commit accuracy: 71% avg (last 2 quarters) · Nate 89% · Sara 74% · Marcus 61%
```

This appears in small muted text — it's context, not a headline. But it's always there when the data exists.

#### In chat responses about forecast

When the user asks about commit or forecast numbers, Pandora should apply the discount factor explicitly:

> "The team is calling $420K commit. Based on historical accuracy (71% avg over 2 quarters), the realistic close range is $285K–$340K. Sara's $190K commit discounts to $140K at her 74% accuracy rate. Marcus at 61% makes his $80K look more like $49K."

This is the math a VP does in their head every week. Pandora does it explicitly and shows it.

**Acceptance:** After a period with closed deals, a `forecast_accuracy` entry exists in workspace_memory. The next brief shows the accuracy context line below the metrics strip. Asking "what's realistic for our commit?" produces a response that applies the per-rep discount factors and shows the math.

---

## Sequencing for This Session

All six tasks can be executed in this order — each is mostly independent given T019, T010, T011, and T016 are already complete:

1. **T013** — completes the document workflow; highest user-visible impact
2. **T015** — strategic reasoning; extends the intelligence depth of every conversation
3. **T017** — Slack draft queue; short task, high operational value
4. **T018** — recommendation tracking; builds on T019's memory infrastructure
5. **T020** — prior document comparison; builds on T019 and brief assembler
6. **T021** — forecast accuracy memory; final piece of the memory layer

---

## Full Suite Acceptance Criteria

By the end of this session, the following should all pass:

1. **T013:** Render a document → review panel appears for low-confidence items → confirm → Slack distribution posts a summary to the ops channel with download link.

2. **T015:** Ask "why do we keep missing mid-market?" → structured strategic card renders with hypothesis, supporting evidence, contradicting evidence, recommendation, tradeoffs, and watch-for signals. If workspace memory has prior quarter data, the response opens with recurrence context.

3. **T017:** A single-thread recommendation generates a Slack draft card → "Send as-is" sends the DM to the rep's Slack → `slack_drafts` record shows status = 'sent'.

4. **T018:** Create and action a recommendation on a deal → deal closes in next sync → `recommendations` table shows `outcome = 'closed_won'` and `recommendation_correct = true` → next brief surfaces the outcome in the comparison block.

5. **T020:** Generate two consecutive briefs → second brief shows "Since last week" block with resolved, persisted, and new items correctly classified → persisted items with 3+ occurrences show week count.

6. **T021:** After sufficient closed deal data exists → `workspace_memory` has `forecast_accuracy` entry → brief shows accuracy context below metrics strip → asking about commit produces a discount-adjusted forecast range.

7. **No regression:** T010, T011, T012, T014, T016, T019 continue to function correctly.
