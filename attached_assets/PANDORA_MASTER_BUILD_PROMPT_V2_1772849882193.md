# Pandora Master Build Prompt — Assistant Intelligence, Document Accumulator, Cross-Session Memory, Strategic Reasoning
## The Complete Digital RevOps Team

**Status:** Ready to build — all features discussed in design session  
**Surfaces:** Ask Pandora (chat), Command Center Assistant (VP RevOps Brief), Document renderer, Actions Engine  
**Depends on:** Existing skill framework, renderer pipeline (PANDORA_RENDERER_EXPANSION_BUILD_PROMPT.md), evidence architecture (PANDORA_EVIDENCE_ARCHITECTURE_REFERENCE.md), Actions Engine (PANDORA_ACTIONS_ENGINE_SPEC.md), prior build prompt (PANDORA_ASSISTANT_INTELLIGENCE_BUILD_PROMPT.md — T1–T9 already specced)

---

## North Star

Pandora is not a reporting tool. It is the RevOps analyst your team can't afford to hire — one that owns the number, has already looked at everything before you got in, and has a point of view it's prepared to defend. By the end of this build, Pandora should be able to:

- **Report** — proactive briefs with real voice, fresh data, charts backed by verified calculations
- **Analyze** — cross-signal reasoning that connects pipeline data to conversation intelligence
- **Strategize** — recommendations with tradeoffs, not just findings with observations
- **Act** — CRM writeback, document creation, Slack drafts queued for approval
- **Remember** — cross-session institutional memory that makes Pandora smarter the longer a client uses it

T1–T9 are already specced in `PANDORA_ASSISTANT_INTELLIGENCE_BUILD_PROMPT.md` (chart renderer, data freshness, live deal lookup, contradiction handler, event-driven brief reassembly, staleness indicator). **Do not re-implement those. This prompt is additive.**

---

## Before Starting

Read and understand these files before writing a single line of code:

1. `PANDORA_ASSISTANT_INTELLIGENCE_BUILD_PROMPT.md` — T1–T9 already specced; understand what's built
2. `PANDORA_EVIDENCE_ARCHITECTURE_REFERENCE.md` — the seven-layer evidence system; all new features must fit within it
3. `PANDORA_ACTIONS_ENGINE_SPEC.md` — three-ring action model (native execution, generated workflows, webhook events)
4. `PANDORA_RENDERER_EXPANSION_BUILD_PROMPT.md` — XLSX, PDF, PPTX, Slack renderers; document accumulator builds on these
5. `server/agents/orchestrator.ts` — how chat responses are assembled; session context object extends this
6. `server/skills/types.ts` — SkillEvidence, Claim, EvaluatedRecord shapes
7. `server/renderers/types.ts` — RendererInput, RenderOutput, ChartSpec (added in T1)
8. The `weekly_briefs` table schema — brief assembly, ai_blurbs, assembled_at
9. The `deals`, `skill_runs`, `actions` table schemas
10. `client/src/pages/AssistantView.tsx` — brief and chat composition

**Do not proceed until you have read all ten.**

---

## Architecture Principles for This Build

**Every number has a calculation_id.** Numbers that cannot be traced to a Calculation function output are rejected before reaching the LLM. The LLM maps labels to pre-computed values — it never generates, rounds, or estimates numeric values itself.

**Cross-signal analysis is the differentiator.** Pipeline data alone is a CRM report. Conversation intelligence alone is a CI tool. Pandora's value is connecting them: win rate drops AND pricing objection rate is up AND Stage 3→4 conversion is below benchmark — that is one finding, not three.

**The session is a workspace, not a conversation.** Every user exchange accumulates into a structured session context object — data fetched, scopes active, findings surfaced, charts rendered. The session context is the source material for the Document Accumulator.

**Actions require judgment, not just capability.** The system knows how to write to the CRM, post to Slack, and create documents. The question it must answer before doing any of those is: should I do this autonomously, queue for approval, or escalate? That judgment is a first-class system concern.

**Memory compounds value.** Findings from this week are interesting. The same finding recurring for three quarters is a systemic problem. Cross-session memory is what makes Pandora progressively more valuable — and what distinguishes it from a tool that resets every Monday.

---

## Task List

Tasks T10–T25 below. T10–T13 are the highest priority — they address the session coherence and document accumulation problems directly. T14–T17 are cross-signal analysis and strategic reasoning. T18–T21 are the action judgment layer. T22–T25 are cross-session memory.

---

### T10 — Session Context Object

**Priority:** High  
**Files:** `server/agents/orchestrator.ts`, new file `server/agents/session-context.ts`  
**Blocked by:** T6 (live deal lookup, from prior prompt)

**Problem:** Every user message triggers a full re-derivation. The system re-fetches pipeline data, re-scores deals, re-queries reps — even when that data was computed two messages ago. The session has no memory of work already done.

**Build a `SessionContext` object** that accumulates within a conversation session and is passed to the orchestrator on every turn:

```typescript
// server/agents/session-context.ts

interface SessionContext {
  sessionId: string;
  workspaceId: string;
  startedAt: string;
  
  // Data already fetched this session — check before re-querying
  computedThisSession: {
    [calculationKey: string]: {
      data: Record<string, any>;
      calculationId: string;
      fetchedAt: string;
      ttlMinutes: number;         // How long before this should be re-fetched
    }
  };
  
  // Named deals looked up via live table (T6)
  dealsLookedUp: {
    [dealName: string]: LiveDealFact;
  };
  
  // Active scope — inherited across turns unless explicitly changed
  activeScope: {
    rep?: string;
    pipeline?: string;
    stage?: string;
    timeRange?: { start: string; end: string };
    dealName?: string;
  };
  
  // Conversation history for LLM context
  conversationHistory: ConversationTurn[];
  
  // Findings surfaced this session — for document accumulator
  sessionFindings: SessionFinding[];
  
  // Charts rendered this session
  sessionCharts: { chartSpec: ChartSpec; context: string }[];
  
  // Tables rendered this session
  sessionTables: { tableSpec: TableSpec; context: string }[];
  
  // Recommendations made this session
  sessionRecommendations: Recommendation[];
}

interface SessionFinding {
  id: string;
  turnIndex: number;              // Which conversation turn produced this
  category: string;               // 'pipeline_health' | 'rep_performance' | 'forecast' | 'deal_risk' | 'cross_signal'
  severity: 'critical' | 'warning' | 'info';
  claim: string;                  // The finding in one sentence
  supportingData: Record<string, any>;
  calculationIds: string[];       // Math trace
  documentSection?: string;       // Which document section this belongs to (set by accumulator)
}

interface Recommendation {
  id: string;
  turnIndex: number;
  action: string;                 // "Multi-thread Behavioral Framework before Monday"
  owner?: string;                 // "Sara" — who should do this
  dealId?: string;
  urgency: 'today' | 'this_week' | 'next_week' | 'strategic';
  status: 'pending' | 'accepted' | 'dismissed' | 'actioned';
}
```

**Scope inheritance:** When the user establishes a scope ("show me Sara's pipeline"), set `activeScope.rep = "Sara"`. Subsequent messages that don't explicitly change scope inherit it. "What about her single-threaded deals?" resolves to Sara without requiring the user to repeat it. Scope resets when the user explicitly changes it ("now show me Nate's") or starts a new session.

**Cache-before-query:** Before running any Calculation function, check `computedThisSession` for a matching `calculationKey`. If found and within TTL, use the cached result. TTL defaults:
- Pipeline aggregates: 15 minutes
- Rep-level data: 15 minutes  
- Named deal facts (live lookup): 5 minutes
- Forecast calculations: 30 minutes

**Acceptance:** Ask "show me Sara's pipeline." Then ask "what are her single-threaded deals?" The second query does not re-fetch pipeline data — it uses the session context. The response correctly inherits the Sara scope. Response latency on the second question is meaningfully lower than the first.

---

### T11 — Document Accumulator

**Priority:** High  
**Files:** New `server/documents/accumulator.ts`, new `server/documents/types.ts`, update `server/agents/orchestrator.ts`  
**Blocked by:** T10 (session context)

**The Document Accumulator** runs alongside every chat session and silently builds a structured document outline from the session's findings, charts, tables, and recommendations. At any point the user can say "build me the WBR from this conversation" and the accumulator hands a fully structured brief to the renderer.

```typescript
// server/documents/types.ts

type DocumentTemplate = 
  | 'weekly_business_review'
  | 'qbr'
  | 'board_deck'
  | 'ad_hoc_analysis'
  | 'deal_review'
  | 'rep_performance_review'
  | 'forecast_memo';

interface DocumentSection {
  id: string;
  name: string;                   // "Pipeline Health" | "Rep Performance" | "Forecast" | "Key Risks" | "Recommendations"
  order: number;
  contributions: DocumentContribution[];
  narrativeBridge?: string;       // Synthesized connecting narrative (populated at render time)
}

interface DocumentContribution {
  id: string;
  type: 'finding' | 'chart' | 'table' | 'recommendation' | 'narrative';
  content: SessionFinding | ChartSpec | TableSpec | Recommendation | string;
  turnIndex: number;
  confidence: 'high' | 'medium' | 'low';    // Low = flagged for human review before distribution
  placedBy: 'auto' | 'user';               // Was this auto-slotted or explicitly placed by user?
}

interface AccumulatedDocument {
  id: string;
  sessionId: string;
  workspaceId: string;
  template: DocumentTemplate;
  sections: DocumentSection[];
  assembledAt: string;
  lowConfidenceCount: number;    // Contributions flagged for review
  priorDocumentId?: string;      // Previous version for comparison
}
```

**Template section maps:**

```typescript
const TEMPLATE_SECTIONS: Record<DocumentTemplate, string[]> = {
  weekly_business_review: [
    'exec_summary',
    'attainment_and_forecast',
    'pipeline_health',
    'rep_performance',
    'key_risks',
    'recommendations',
    'appendix'
  ],
  qbr: [
    'exec_summary',
    'quarter_results',
    'pipeline_analysis',
    'win_loss_review',
    'rep_performance',
    'process_health',
    'next_quarter_plan',
    'appendix'
  ],
  board_deck: [
    'business_overview',
    'revenue_performance',
    'pipeline_and_forecast',
    'key_wins_and_losses',
    'risks_and_mitigations',
    'next_quarter_outlook'
  ],
  ad_hoc_analysis: [
    'executive_summary',
    'methodology',
    'findings',
    'recommendations',
    'appendix'
  ],
  forecast_memo: [
    'forecast_summary',
    'commit_analysis',
    'risk_deals',
    'upside_deals',
    'recommended_actions'
  ],
  deal_review: [
    'deal_summary',
    'opportunity_analysis',
    'stakeholder_map',
    'risk_assessment',
    'recommended_next_steps'
  ],
  rep_performance_review: [
    'performance_summary',
    'pipeline_coverage',
    'activity_metrics',
    'deal_quality',
    'coaching_recommendations'
  ]
};
```

**Auto-slotting logic:** When a new `SessionFinding`, `ChartSpec`, or `Recommendation` is added to the session context, the accumulator classifies it and slots it into the appropriate section:

```typescript
function autoSlotContribution(
  contribution: DocumentContribution,
  template: DocumentTemplate
): string {   // returns section id

  // Classification rules by finding category:
  // 'attainment' | 'coverage' | 'forecast' → 'attainment_and_forecast'
  // 'pipeline_health' | 'stage_velocity' | 'data_quality' → 'pipeline_health'  
  // 'rep_performance' | 'rep_scorecard' → 'rep_performance'
  // 'deal_risk' | 'single_thread' | 'stale_deal' → 'key_risks'
  // 'recommendation' type → 'recommendations'
  // 'chart' type → section matching chart's data topic
  // 'table' type → section matching table's data topic
  // anything unclassified → 'appendix'
}
```

**User section override:** The user can say "put that in the exec summary" or "that chart goes in the appendix." This sets `placedBy: 'user'` and overrides auto-slotting. User placements are never overridden.

**Accumulator state display:** At the bottom of the chat interface, show a persistent "Document" pill that expands to show the current accumulator outline — sections with contribution counts. Example:

```
📄 WBR in progress
  Executive Summary (0)
  Attainment & Forecast (2 findings, 1 chart)
  Pipeline Health (3 findings)
  Rep Performance (2 findings, 1 chart)
  Key Risks (4 findings)
  Recommendations (3)
  Appendix (2 tables)
[Render →]
```

The user can click any section to see what's been accumulated. They can remove contributions or move them between sections. This makes the accumulator visible — not a black box.

**Acceptance:** Have a 10-message conversation covering pipeline health, rep performance, and a deal risk. Open the document pill — the outline should have contributions auto-slotted into correct sections. Say "render as WBR." A structured document renders with all contributions in place.

---

### T12 — Narrative Synthesis at Render Time

**Priority:** High  
**Files:** `server/documents/synthesizer.ts` (new), called from document render pipeline  
**Blocked by:** T11

**Problem:** A collected set of findings is not a document. A document has an argument — a throughline that connects the findings into a coherent narrative. The WBR doesn't just say "attainment is 21%" and separately "Sara's deals are single-threaded" — it says "we're at risk of missing quarter, and the biggest lever is Sara's Behavioral Framework deal which needs executive coverage today."

**The Synthesis Pass** runs once before rendering, after all contributions are assembled:

```typescript
// server/documents/synthesizer.ts

interface SynthesisInput {
  document: AccumulatedDocument;
  sessionContext: SessionContext;
  workspaceMetrics: {
    attainment_pct: number;
    coverage_ratio: number;
    days_remaining: number;
    quarter_phase: 'early' | 'mid' | 'late';
  };
}

interface SynthesisOutput {
  executiveSummary: string;           // 2-3 paragraph narrative for the document opener
  sectionBridges: Record<string, string>; // section_id → transition sentence
  documentThroughline: string;        // The single argument of the document in one sentence
  lowConfidenceFlags: {               // Items that need human review before distribution
    contributionId: string;
    reason: string;
    suggestedAction: string;
  }[];
}
```

**Synthesis prompt pattern:**

The synthesizer sends Claude a compact context — NOT the raw data, NOT the full conversation transcript. It sends:
- The document template type
- The workspace metrics (attainment, coverage, days remaining, quarter phase)
- The claims from each section (one-sentence summaries only, not full finding objects)
- The recommendations list

Claude produces the executive summary and narrative bridges. It does not touch the charts, tables, or evidence — those stay as-is. It only writes the connective prose.

Token budget for synthesis: < 3K input, < 2K output. If the accumulator has more contributions than fit in 3K tokens, summarize by section (top 2 findings per section) before sending to Claude.

**The throughline matters:** The `documentThroughline` is one sentence that captures the document's argument. It goes in the document header below the title. Example: *"We're on track to miss Q1 by $180K unless Action Behavior Centers closes this month — everything else is secondary."*

**Acceptance:** Render a WBR from a 10-message session. The executive summary reads as a coherent narrative that connects the findings — not a bullet list dressed up as prose. The section bridges provide transitions between Pipeline Health and Rep Performance that reference the same deals. The throughline appears in the document header.

---

### T13 — Document Distribution + Human-in-the-Loop Review

**Priority:** High  
**Files:** `server/documents/distributor.ts` (new), update `client/src/components/documents/RenderModal.tsx` (or equivalent)  
**Blocked by:** T12

**Distribution is the end of the workflow, not render.** After render, Pandora should offer:
- Send to Slack (channel or DM)
- Email to the team (via Resend)
- Save to Google Drive
- Download (existing)

But before distribution, **the human-in-the-loop review step is mandatory** when `lowConfidenceCount > 0`.

**Review UI:** When the user clicks "Render →", before the document is generated, show a review panel if there are low-confidence contributions:

```
Before sending, review these 2 items:

⚠ Attainment figure (21%) — This was updated mid-session when ACES closed.
  The document uses the corrected figure ($387K / 110%). Confirm this is right.
  [✓ Confirmed] [✗ Remove]

⚠ Sara's forecast — You corrected Pandora on this number during the conversation.
  The document uses the corrected value ($190K). Confirm this is right.
  [✓ Confirmed] [✗ Remove]

[Continue to render →]  [Cancel]
```

This is not optional for distributions — it is required whenever `lowConfidenceCount > 0`. For downloads, it's a warning, not a gate.

**Low-confidence signals:**
- A number that was corrected during the conversation (contradiction handler fired — T7)
- A value from a brief snapshot that predates the last sync
- A calculation where `record_count < 5` (small sample)
- A recommendation the user pushed back on before accepting

**Distribution options UI:** After render, show:

```
📄 Q1 WBR — March 6, 2026

[↓ Download PPTX]  [↓ Download DOCX]  [↓ Download PDF]

Share:
[Slack → #revenue-team]  [Email → team@frontera.com]  [Save to Drive]
```

Slack distribution uses the existing Slack renderer to post a summary with a download link. Email uses Resend with the PDF attached. Drive uses the existing Google Drive connector.

**Acceptance:** Complete a session, trigger render, see the low-confidence review panel, confirm items, select Slack distribution, and receive the document summary in the Slack channel with a download link.

---

### T14 — Cross-Signal Analysis Engine

**Priority:** High  
**Files:** `server/skills/cross-signal-analyzer.ts` (new), called from orchestrator when multi-source signals exist  
**Blocked by:** T10 (session context)

**The gap today:** Pipeline skills and conversation intelligence skills run separately and surface findings independently. Pandora tells you "win rate is low in mid-market" (pipeline skill) and separately "pricing objection rate is 70% in Stage 3" (conversation intelligence skill). A good analyst connects these — they're the same problem, manifesting in two different data sources.

**Cross-signal analysis** is triggered when the session context contains findings from two or more skill categories that involve overlapping entity sets (same stage, same rep, same deal size band, same time window).

```typescript
// server/skills/cross-signal-analyzer.ts

interface CrossSignalInput {
  pipelineSignals: SessionFinding[];        // from pipeline skills
  conversationSignals: SessionFinding[];    // from CI skills
  repSignals: SessionFinding[];             // from rep scorecard
  icpSignals: SessionFinding[];             // from ICP skill
  scope: ActiveScope;
}

interface CrossSignalFinding {
  id: string;
  type: 'convergent' | 'contradictory' | 'amplifying';
  // convergent: multiple signals point to the same root cause
  // contradictory: signals conflict (pipeline says healthy, CI says struggling)
  // amplifying: one signal makes another signal significantly worse
  
  signals: SessionFinding[];               // The signals being connected
  synthesis: string;                       // The unified finding in one sentence
  rootCause: string;                       // Pandora's hypothesis about why
  recommendation: string;                  // What to do about it
  confidence: 'high' | 'medium' | 'low';
  entities: { type: string; id: string; name: string }[];
}
```

**Pattern library — cross-signal patterns to detect:**

```typescript
const CROSS_SIGNAL_PATTERNS = [
  {
    id: 'pricing_friction_to_conversion_drop',
    signal_a: { category: 'conversation_intelligence', subcategory: 'pricing_objection' },
    signal_b: { category: 'stage_velocity', metric: 'conversion_rate', direction: 'below_benchmark' },
    stage_overlap_required: true,
    synthesis_template: 'Pricing objection rate of {a.rate}% in {stage} is likely driving the {b.conversion_rate}% conversion rate (benchmark: {b.benchmark}%). Same stage, same symptom.',
    recommendation_template: 'Review pricing packaging for {stage} deals — the objection pattern and conversion drop are correlated.'
  },
  {
    id: 'single_thread_to_deal_risk',
    signal_a: { category: 'single_thread_alert', entity_type: 'deal' },
    signal_b: { category: 'deal_risk', entity_type: 'deal' },
    entity_overlap_required: true,
    synthesis_template: '{deal.name} is both single-threaded and flagged as high risk — the single contact is the only line of defense on a {deal.amount} deal.',
    recommendation_template: 'Multi-thread {deal.name} before any other action — losing the single contact ends the deal.'
  },
  {
    id: 'icp_mismatch_to_churn_signal',
    signal_a: { category: 'icp_discovery', grade: ['C', 'D'] },
    signal_b: { category: 'conversation_intelligence', subcategory: 'implementation_concern' },
    synthesis_template: 'Deals with C/D ICP scores are generating {b.rate}% of implementation concern conversations — below-ICP accounts are struggling post-sale.',
    recommendation_template: 'Tighten ICP criteria at qualification — low-grade accounts are creating downstream CS burden.'
  },
  {
    id: 'data_quality_to_forecast_risk',
    signal_a: { category: 'data_quality', field: ['close_date', 'amount', 'next_step'] },
    signal_b: { category: 'forecast_rollup', metric: 'commit_accuracy' },
    synthesis_template: '{a.missing_pct}% of commit deals have missing {a.fields} — forecast accuracy of {b.accuracy}% is at least partly a data quality problem.',
    recommendation_template: 'Enforce {a.fields} as required fields for commit-category deals before next forecast call.'
  }
];
```

**Trigger:** After any message that adds two or more findings to the session context across different skill categories, run the cross-signal analyzer in the background. If it finds convergent signals, surface them as a new `SessionFinding` with `category: 'cross_signal'` and elevated severity.

**In the response:** Cross-signal findings appear as a distinct block type in the chat response, visually distinguished from single-source findings:

```
🔗 Connected finding
Pricing objection rate (70% in Stage 3) and Stage 3→4 conversion (28% vs 45% benchmark) 
are the same problem showing up in two places. The calls are telling you what the pipeline 
data is confirming.

→ Review pricing packaging for Stage 3 deals before next QBR.
```

**Acceptance:** In a session where both pipeline analysis and conversation intelligence findings exist for overlapping stages, the cross-signal analyzer fires and surfaces at least one `convergent` finding that names both source signals. The finding is slotted into the document accumulator under `key_risks`.

---

### T15 — Strategic Reasoning Layer

**Priority:** Medium  
**Files:** `server/skills/strategic-reasoner.ts` (new), called from orchestrator when question type = `strategic`  
**Blocked by:** T14

**The gap today:** Pandora surfaces what's happening and flags what needs immediate attention. It does not reason about what should change systemically. A question like "why do we keep missing mid-market?" or "should we restructure territories next quarter?" is strategic — it requires synthesizing multiple signals into a recommendation with explicit tradeoffs.

**Strategic question classification:** Extend the router to classify questions as `strategic` when they contain signals like:
- "why do we keep..." / "why does this always..."
- "should we..." / "what should we change..."
- "what's the root cause of..."
- "next quarter..." / "going forward..."
- "is our [process/motion/territory/quota] right?"

**Strategic reasoning prompt pattern:**

Strategic questions get a different prompt than analytical questions. Instead of "here's what the data shows," the prompt instructs Claude to:

1. State the hypothesis (what Pandora believes is the root cause)
2. List the evidence that supports it (from session context + skill outputs)
3. List the evidence that could contradict it (intellectual honesty)
4. State the recommendation with explicit tradeoffs
5. State what would need to be true for the recommendation to be wrong

```typescript
interface StrategicReasoningOutput {
  question: string;
  hypothesis: string;                    // Pandora's best answer to why
  supportingEvidence: string[];          // What points toward this hypothesis
  contradictingEvidence: string[];       // What doesn't fit — be honest
  recommendation: string;               // What to do
  tradeoffs: string[];                  // What you give up by doing this
  watchFor: string[];                   // What would tell you if you're wrong
  confidence: 'high' | 'medium' | 'low';
  confidenceReason: string;             // Why it's that confidence level
}
```

**Example output in chat:**

> **Hypothesis:** Mid-market miss is a coverage problem, not a conversion problem.
>
> Mid-market pipeline is generating at 1.8x coverage — below the 3x needed at your Stage 3→4 conversion rate. The reps assigned to mid-market are carrying the most accounts and have the lowest next-step documentation rate (43% vs. 71% enterprise). This looks like a capacity issue, not a skill issue.
>
> **What contradicts this:** Enterprise conversion is only slightly better (34% vs. 31%), which suggests there may be a product-market fit component that's cross-segment.
>
> **Recommendation:** Reassign two mid-market accounts from Sara and Marcus to the new hire ramp cohort. Reduces their load by 20%, increases new hire pipeline visibility.
>
> **What you give up:** New hire ramp timelines extend when accounts are assigned early. And if the issue is actually product fit, this doesn't fix it.
>
> **Watch for:** If coverage improves but conversion doesn't move after 60 days, the hypothesis is wrong.

**Acceptance:** Ask "why do we keep struggling in mid-market?" The response follows the strategic reasoning structure — hypothesis, evidence for and against, recommendation with tradeoffs, what to watch for. The response slots into the Document Accumulator under `key_risks` or `recommendations` depending on its `actionability`.

---

### T16 — Action Judgment Layer

**Priority:** High  
**Files:** `server/actions/judgment.ts` (new), integrate with existing `PANDORA_ACTIONS_ENGINE_SPEC.md` implementation  
**Blocked by:** T10

**The problem:** Pandora knows how to write to the CRM, post to Slack, and create documents. What it lacks is the judgment about when to do these things autonomously, when to queue for approval, and when to escalate to the human.

**Three execution modes:**

```typescript
type ActionExecutionMode = 
  | 'autonomous'    // Execute immediately, notify after
  | 'approval'      // Queue for user approval before executing
  | 'escalate';     // Surface to human, don't execute — too consequential

interface ActionJudgment {
  actionId: string;
  mode: ActionExecutionMode;
  reason: string;             // Why this mode was selected
  approvalPrompt?: string;    // What to show the user for approval-mode actions
  escalationReason?: string;  // Why this was escalated instead of queued
}
```

**Judgment rules:**

```typescript
const JUDGMENT_RULES = [
  // AUTONOMOUS — low-stakes, reversible, clearly correct
  { condition: 'action_type === "crm_task_create" AND severity === "info"', mode: 'autonomous' },
  { condition: 'action_type === "slack_notify" AND target === "ops_channel"', mode: 'autonomous' },
  { condition: 'action_type === "snooze_finding" AND duration_days <= 7', mode: 'autonomous' },
  
  // APPROVAL — meaningful, partially reversible, depends on context
  { condition: 'action_type === "crm_field_update" AND field IN ["close_date", "amount", "stage"]', mode: 'approval' },
  { condition: 'action_type === "slack_dm" AND recipient_type === "rep"', mode: 'approval' },
  { condition: 'action_type === "crm_task_create" AND severity === "critical"', mode: 'approval' },
  { condition: 'action_type === "document_distribute" AND channel IN ["email", "slack"]', mode: 'approval' },
  
  // ESCALATE — high-stakes, hard to reverse, or requires business context Pandora doesn't have
  { condition: 'action_type === "crm_bulk_update" AND record_count > 10', mode: 'escalate' },
  { condition: 'action_type === "forecast_override"', mode: 'escalate' },
  { condition: 'action_type === "territory_reassignment"', mode: 'escalate' },
  { condition: 'action_type === "quota_adjustment"', mode: 'escalate' },
];
```

**Approval UI in chat:** When an action is queued for approval, it appears as an action card in the chat response:

```
Pandora recommends:

📋 Create HubSpot task on Behavioral Framework
   "Add economic buyer to next call — Sara to intro Jeff Ignacio by Wednesday"
   Owner: Sara Phillips · Due: March 9

[✓ Create task]  [✗ Skip]  [✎ Edit before creating]
```

**Autonomous action notification:** For autonomous actions, a small notification appears in the chat after the fact:
```
✓ Created HubSpot task on Behavioral Framework (just now)
```

**Escalation card:** For escalated actions, Pandora explains why it's not acting:
```
⚡ Territory reassignment flagged for your decision
Pandora can model the scenarios, but territory changes affect comp, quotas, and team dynamics. 
This requires your call, not mine.
[Show me the scenarios →]
```

**Acceptance:** A critical single-thread finding triggers an action recommendation. The approval card appears in chat. Clicking "Create task" writes to HubSpot. The autonomous path creates a low-severity task without prompting and notifies after.

---

### T17 — Slack Draft Queue

**Priority:** Medium  
**Files:** `server/actions/slack-draft.ts` (new), integrate with existing Slack integration  
**Blocked by:** T16

When Pandora identifies that a rep needs to take a specific action, it should draft the Slack message to that rep and queue it for VP approval — not send it directly.

```typescript
interface SlackDraft {
  id: string;
  workspaceId: string;
  recipientSlackId: string;
  recipientName: string;
  draftMessage: string;
  context: string;              // Why Pandora drafted this
  sourceActionId: string;
  sourceSkillId?: string;
  status: 'draft' | 'approved' | 'sent' | 'dismissed';
  editedMessage?: string;       // If the VP edited before sending
  createdAt: string;
}
```

**Draft generation:** When a recommendation involves a specific rep action, generate the draft in the rep's voice (professional, direct, peer-to-peer — not corporate):

```
Draft for Sara:

"Hey Sara — Behavioral Framework needs an economic buyer on the next call before we can move 
forward. Can you get Jeff or another decision-maker looped in by Wednesday? Happy to help 
with the outreach if you need an intro angle."

[Send as-is]  [Edit & Send]  [Dismiss]
```

The draft is written as if from the VP, in a tone that matches how a VP would actually message a rep — not a system-generated notification.

**Acceptance:** A single-thread finding for a named rep generates a Slack draft in the approval queue. The draft reads naturally. Approving it sends the actual Slack DM to the rep.

---

### T18 — Closed-Loop Recommendation Tracking

**Priority:** Medium  
**Files:** `server/documents/recommendation-tracker.ts` (new), update `actions` table  
**Blocked by:** T11 (recommendations are accumulated in the session)

**The problem:** Pandora recommends "multi-thread Behavioral Framework." It never knows if that happened, whether the deal closed, or whether the recommendation was correct.

**Recommendation lifecycle:**

```
Created (in session) 
  → Accepted / Dismissed (by user in chat) 
  → Actioned (task created, Slack sent, or user confirms manually)
  → Resolved (deal outcome known — closed won/lost, or timeout)
  → Retrospective (was the recommendation correct?)
```

**Outcome tracking:** When a deal that was the subject of a recommendation reaches Closed Won or Closed Lost, the recommendation tracker fires:

```typescript
async function evaluateRecommendationOutcome(
  recommendation: Recommendation,
  dealOutcome: 'closed_won' | 'closed_lost' | 'slipped'
): Promise<RecommendationRetrospective> {
  
  // Was the recommendation actioned before outcome?
  const actioned = recommendation.status === 'actioned';
  
  // Did the outcome match what the recommendation was trying to achieve?
  const outcomeMatch = 
    (recommendation.type === 'deal_risk' && dealOutcome === 'closed_won' && actioned) ||
    (recommendation.type === 'deal_risk' && dealOutcome === 'closed_lost' && !actioned);
  
  return {
    recommendationId: recommendation.id,
    dealOutcome,
    wasActioned: actioned,
    outcomeAlignedWithRecommendation: outcomeMatch,
    // Surface in workspace_memory for pattern learning
  };
}
```

**Retrospective surface:** In the next brief after a deal closes, if there was an active recommendation on that deal, surface the outcome:

> "Behavioral Framework closed — $105K won. The multi-thread recommendation from last week was actioned. This is the third deal this quarter where adding a second contact in Stage 3 correlated with a close."

This is the beginning of institutional learning. Pandora is noticing its own patterns.

**Acceptance:** Create a recommendation for Behavioral Framework. Mark it as actioned. Close the deal in HubSpot. Trigger a sync. The next brief surfaces the outcome and connects it to the recommendation.

---

### T19 — Cross-Session Workspace Memory

**Priority:** High  
**Files:** New `server/memory/workspace-memory.ts`, new DB migration for `workspace_memory` table  

**This is the most strategically important task in this build.** Cross-session memory is what makes Pandora progressively more valuable and what distinguishes it from a tool that resets every Monday.

**Database migration:**

```sql
CREATE TABLE workspace_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  
  memory_type TEXT NOT NULL,
  -- 'recurring_finding'     — same finding across multiple periods
  -- 'resolved_finding'      — finding that was fixed
  -- 'recommendation_outcome'— recommendation + what happened
  -- 'rep_pattern'           — rep-level behavioral pattern over time
  -- 'deal_pattern'          — deal characteristics that correlate with outcomes
  -- 'forecast_accuracy'     — historical forecast vs. actual by period
  -- 'icp_evolution'         — how ICP understanding has changed
  
  entity_type TEXT,           -- 'rep' | 'deal' | 'stage' | 'pipeline' | 'workspace'
  entity_id TEXT,             -- ID of the entity this memory is about
  entity_name TEXT,           -- Human-readable name
  
  period_start DATE,          -- What time period this memory covers
  period_end DATE,
  period_label TEXT,          -- "Q1 2026" | "Week of March 1"
  
  content JSONB NOT NULL,     -- The structured memory
  summary TEXT NOT NULL,      -- One-sentence human-readable summary
  
  occurrence_count INT DEFAULT 1,   -- How many times this pattern has appeared
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  source_skill_run_ids UUID[],     -- Which skill runs contributed to this memory
  source_document_ids UUID[],      -- Which documents referenced this
  
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspace_memory_workspace ON workspace_memory(workspace_id);
CREATE INDEX idx_workspace_memory_type ON workspace_memory(workspace_id, memory_type);
CREATE INDEX idx_workspace_memory_entity ON workspace_memory(workspace_id, entity_type, entity_id);
CREATE INDEX idx_workspace_memory_recurring ON workspace_memory(workspace_id, occurrence_count DESC);
```

**Memory writer:** After every brief assembly and every skill run, the memory writer checks for patterns worth storing:

```typescript
// server/memory/workspace-memory.ts

async function writeMemoryFromSkillRun(
  workspaceId: string,
  skillRunId: string,
  findings: Claim[]
): Promise<void> {
  
  for (const finding of findings) {
    // Check if this finding has appeared in prior periods
    const existingMemory = await db.query(`
      SELECT * FROM workspace_memory
      WHERE workspace_id = $1
        AND memory_type = 'recurring_finding'
        AND content->>'claim_category' = $2
        AND entity_id = $3
        AND is_resolved = FALSE
    `, [workspaceId, finding.category, finding.entity_id]);
    
    if (existingMemory.rows.length > 0) {
      // Increment occurrence count
      await db.query(`
        UPDATE workspace_memory
        SET occurrence_count = occurrence_count + 1,
            last_seen_at = NOW(),
            source_skill_run_ids = source_skill_run_ids || $1::uuid
        WHERE id = $2
      `, [skillRunId, existingMemory.rows[0].id]);
    } else {
      // Create new memory
      await db.query(`
        INSERT INTO workspace_memory 
          (workspace_id, memory_type, entity_type, entity_id, entity_name,
           period_start, period_end, period_label, content, summary,
           source_skill_run_ids)
        VALUES ($1, 'recurring_finding', $2, $3, $4, $5, $6, $7, $8, $9, ARRAY[$10::uuid])
      `, [
        workspaceId,
        finding.entity_type,
        finding.entity_id,
        finding.entity_name,
        getCurrentPeriodStart(),
        getCurrentPeriodEnd(),
        getCurrentPeriodLabel(),
        JSON.stringify({ claim_category: finding.category, claim: finding.message, severity: finding.severity }),
        finding.message,
        skillRunId
      ]);
    }
  }
}
```

**Memory reader:** When assembling a brief or responding to a chat question, the orchestrator queries workspace memory for relevant context before building the LLM prompt:

```typescript
async function getRelevantMemories(
  workspaceId: string,
  scope: ActiveScope,
  memoryTypes: string[]
): Promise<WorkspaceMemory[]> {
  return db.query(`
    SELECT * FROM workspace_memory
    WHERE workspace_id = $1
      AND memory_type = ANY($2)
      AND (entity_id = $3 OR entity_id IS NULL)
      AND is_resolved = FALSE
    ORDER BY occurrence_count DESC, last_seen_at DESC
    LIMIT 10
  `, [workspaceId, memoryTypes, scope.rep || scope.dealName]);
}
```

**Memory injection into brief:** When workspace memory contains recurring findings, they surface in the brief with temporal context:

> "Sara's single-thread pattern has appeared in 4 of the last 6 weekly briefs. This isn't a one-time flag — it's a coaching conversation that hasn't happened yet."

> "Pricing objection rate in Stage 3 has been above 60% for the last three quarters. This predates the current competitive landscape — it's a packaging problem, not a competitive response problem."

**Memory-aware document accumulator:** When the Document Accumulator is assembling a QBR or board deck, it queries workspace memory for the prior quarter's findings and includes a "Prior Period Comparison" section automatically:

```
Prior Period Pattern:
Q4 2025: Sara single-thread — 3 occurrences → 2 deals closed anyway, 1 lost
Q1 2026: Sara single-thread — 4 occurrences so far → 0 resolved
Trend: Getting worse, not better.
```

**Acceptance:** Flag a single-thread finding on Sara in Week 1. The same finding surfaces in Week 2, Week 3, and Week 4. In Week 4's brief, the finding says "4 consecutive weeks" not just "flagged." The QBR document includes the recurring pattern in the Prior Period section.

---

### T20 — Prior Document Comparison

**Priority:** Medium  
**Files:** `server/documents/comparator.ts` (new), update brief assembler  
**Blocked by:** T19 (workspace memory stores prior document references)

Every brief and document should know what the previous version said and surface what changed, what got resolved, and what persisted.

```typescript
interface DocumentComparison {
  priorDocumentId: string;
  priorAssembledAt: string;
  
  resolved: ComparisonItem[];     // Findings in prior doc that don't appear this time
  persisted: ComparisonItem[];    // Findings in both docs
  new: ComparisonItem[];          // Findings in current doc not in prior
  
  metricChanges: {
    metric: string;
    prior: number;
    current: number;
    delta: number;
    direction: 'improved' | 'worsened' | 'unchanged';
  }[];
}
```

**In the brief:** The comparison surfaces as a "Since last week" block near the top:

```
Since last week:
✓ Resolved: Behavioral Framework closed ($105K) — Sara's single-thread risk is gone
↑ Improved: Coverage ratio up from 1.6x to 2.1x
→ Persisted: Action Behavior Centers still single-threaded (3rd consecutive week)
↑ New: ACES ABA close date slipped from Mar 5 to Mar 20
```

**Acceptance:** Generate a brief. Generate another brief the following week. The second brief shows a "Since last week" comparison block with accurate resolved/persisted/new classification.

---

### T21 — Forecast Accuracy Memory

**Priority:** Medium  
**Files:** Part of `server/memory/workspace-memory.ts`  
**Blocked by:** T19

Track forecast vs. actual by period so Pandora can tell you how reliable your team's forecast has historically been — and factor that into confidence ratings.

After each quarter closes, write a `forecast_accuracy` memory:

```typescript
interface ForecastAccuracyMemory {
  period: string;                 // "Q1 2026"
  commit_called: number;          // What reps committed
  commit_closed: number;          // What actually closed
  best_case_called: number;
  best_case_closed: number;
  accuracy_pct: number;           // commit_closed / commit_called
  by_rep: {
    rep_name: string;
    committed: number;
    closed: number;
    accuracy_pct: number;
  }[];
}
```

**In the brief and chat:** When discussing forecast, surface historical accuracy:

> "The team's commit accuracy over the last 4 quarters has averaged 71%. Nate is the most reliable at 89%. Sara called $190K commit last quarter and closed $140K — 74% accuracy. Use that as a discount factor when evaluating this quarter's commit."

**Acceptance:** After a quarter closes, workspace memory contains a `forecast_accuracy` entry for that period. The next quarter's brief uses historical accuracy to contextualize the current forecast call.

---

## What NOT to Build in This Prompt

- Real-time collaborative document editing (Google Docs style)
- Public document sharing links
- Document version control beyond the prior/current comparison
- Chart export within documents (use existing renderer)  
- Custom workspace memory schemas (the schema defined here is fixed for v1)
- Automatic territory restructuring recommendations (strategic reasoning surfaces the analysis, human makes the call)
- Rep-facing memory (memory is VP/admin view only for now)

---

## Sequencing

**Phase 1 — Session Coherence (build first, everything depends on it):**
T10 → T11 → T12 → T13

**Phase 2 — Intelligence Depth (can start after T10):**
T14 → T15 (T15 depends on T14)
T16 → T17 (T17 depends on T16)

**Phase 3 — Memory Layer (start after Phase 1 is stable):**
T19 → T18 → T20 → T21

Phase 1 and Phase 2 can run in parallel tracks. Phase 3 starts after Phase 1 is stable in production.

---

## Acceptance Criteria — Full Suite

1. **Session context is live.** Ask two related questions. The second question uses cached data from the first turn. Scope is inherited. Response latency on the second question is lower.

2. **Document accumulator works end-to-end.** Have a 10-message conversation. Open the document pill — the outline has contributions auto-slotted. Render as WBR. The document has a coherent narrative, not a findings dump.

3. **Synthesis produces a throughline.** The rendered WBR executive summary reads as a connected argument, not a bullet list. The document throughline appears in the header.

4. **Low-confidence review gates distribution.** A number corrected mid-session appears in the review panel before distribution. Confirming it proceeds to render. Slack distribution sends the document summary to the channel.

5. **Cross-signal analysis fires.** A session with both pipeline and CI findings surfaces at least one cross-signal finding that names both source signals and proposes a unified root cause.

6. **Strategic questions get strategic answers.** Ask "why do we keep missing mid-market?" The response has a hypothesis, supporting and contradicting evidence, a recommendation with tradeoffs, and what to watch for.

7. **Action judgment works.** A critical finding generates an approval-mode action card. A low-severity task is created autonomously with an after-the-fact notification. A territory question escalates with explanation.

8. **Slack drafts queue for approval.** A rep-facing recommendation generates a Slack draft in the approval queue. The draft reads naturally. Approving it sends the DM.

9. **Recurring findings accumulate in memory.** The same finding appearing across multiple skill runs increments the `occurrence_count`. The brief surfaces "4 consecutive weeks" not just "flagged."

10. **Prior document comparison works.** Two consecutive briefs produce a "Since last week" block that accurately classifies resolved, persisted, and new findings.

11. **Forecast accuracy tracks over time.** After a quarter closes, a `forecast_accuracy` memory entry exists. The next period's brief uses it to contextualize the current forecast.

12. **No regression on T1–T9.** All chart rendering, live deal lookup, contradiction handling, event-driven reassembly, and staleness indicators from the prior prompt continue to work correctly.
