# Pandora Build Prompt: Trust & Intelligence Layer
## Confidence Tiers + Document Accumulator + Cross-Session Memory + Assistant Failure Hardening

**Status:** Ready to build  
**Depends on:** PANDORA_ASSISTANT_INTELLIGENCE_BUILD_PROMPT.md (chart renderer, live deal lookup, brief freshness)  
**Surfaces affected:** Ask Pandora (chat), Assistant / Command Center brief, all skill evidence output, document rendering pipeline  
**Core principle:** The assistant knows what it knows, knows what it doesn't, and tells you the difference. Every claim carries a confidence tier. Every document carries the full session's reasoning. Every pattern persists across sessions so Pandora gets smarter the longer a client uses it.

---

## Before Starting

Read these files before writing a single line of code:

1. `server/skills/types.ts` — `SkillEvidence`, `Claim`, `EvaluatedRecord` — this is what you're extending
2. `PANDORA_EVIDENCE_ARCHITECTURE_REFERENCE.md` — the seven-layer architecture; confidence tiers plug into Layer 1 (Skills) and flow through all downstream layers
3. `server/agents/orchestrator.ts` — how chat responses are assembled; conversation context object goes here
4. `server/renderers/types.ts` — `RendererInput`, `RenderOutput`; document accumulator feeds the renderer
5. `client/src/components/assistant/ProactiveBriefing.tsx` — brief rendering; confidence styling applies here
6. `client/src/components/assistant/ChatMessage.tsx` — chat message rendering; confidence indicators apply here
7. `server/briefs/brief-assembler.ts` — brief assembly; cross-session memory is read here
8. The `weekly_briefs` table schema — understand `assembled_at`, `ai_blurbs`, `the_number`
9. The `skill_runs` table schema — confidence metadata gets stored here alongside evidence
10. The `workspace_memory` table — does it exist? If not, you will create it in T11

Do not proceed until you have read all ten.

---

## Problem Set

**Problem 1 — Everything looks equally confident.** A finding from a 200-deal dataset and a finding from a 4-deal dataset render with the same card design, the same severity badge, the same voice. The user has no signal about which claims to interrogate and which to trust. This causes two failure modes: over-trusting thin findings and under-trusting strong ones.

**Problem 2 — Metrics don't show their denominators.** "Win rate: 34%" — calculated on how many deals? Excluding what? "Sara's coverage improved 40%" — from 3 deals to 4? From 50 to 70? Relative numbers without absolute context are misleading. The LLM synthesizes from compute outputs and strips the denominator context when it narrates.

**Problem 3 — Missing data is treated as zero.** Average deal size calculated on 60% of deals with amounts populated. The other 40% are silently excluded. The answer looks authoritative and is systematically understated. Same for coverage ratios, win rates, conversion rates — any aggregate computed on a subset of records without flagging the subset.

**Problem 4 — No document memory across sessions.** Each WBR, QBR, and ad-hoc analysis session starts from scratch. Pandora surfaces the same Sara single-thread risk three weeks in a row without connecting them. Recommendations are made and never tracked to outcomes. The second WBR has no memory of the first.

**Problem 5 — Long chat sessions don't accumulate into documents.** A 30-message Ask Pandora session that produces findings, charts, and tables can't be turned into a WBR without starting over. The findings exist in chat history but aren't structured for document assembly.

**Problem 6 — Assistant fails predictably on specific question types.** Multi-part questions, short follow-ups over long sessions, metric definition disagreements, questions about data Pandora doesn't have, hallucinated causation. These aren't routing failures — they're reasoning failures that happen after correct routing.

---

## Architecture Principles

**Confidence is a first-class property of every claim.** The `Claim` interface gets a `confidence` block. Every skill populates it. Every renderer consumes it. It is never optional.

**The document accumulator is a session-level object.** It lives in the conversation context alongside `computed_this_session` and `active_scope`. It collects tagged contributions automatically and presents an outline before rendering.

**Cross-session memory is workspace-scoped and queryable.** It is not a log. It is a structured store of resolved findings, tracked recommendations, recurring patterns, and prior document versions. Skills and the brief assembler query it before producing output.

**Failure hardening is prompt-level and validation-level.** Some failures (short follow-ups, compound questions) are fixed with prompt engineering. Others (missing data disclosure, denominator surfacing) are fixed with output validation rules that run before the LLM response reaches the user.

---

## Task List

---

### T10 — Confidence Tier System: Claim Extension + Skill Population

**Files:** `server/skills/types.ts`, all skill implementation files under `server/skills/`

**Step 1 — Extend the `Claim` interface:**

```typescript
// server/skills/types.ts — extend existing Claim interface

interface Claim {
  // ... existing fields (id, skill_id, severity, category, message, etc.) ...

  // NEW: Confidence block — required on every claim
  confidence: ClaimConfidence;
}

interface ClaimConfidence {
  tier: 'high' | 'medium' | 'low';

  // The evidence behind the tier assignment
  sample_size: number;                  // Number of records this claim is based on
  population_size: number;              // Total records in scope (denominator)
  coverage_rate: number;                // sample_size / population_size (0.0–1.0)
  missing_field_rate?: number;          // % of records where key fields were null/empty

  // Why the tier was assigned — shown to user when they inspect
  tier_reason: string;
  // e.g. "Based on 4 deals — small sample, treat as directional"
  // e.g. "34 of 61 deals had amount populated — coverage 56%"
  // e.g. "Calculated from 90 days of closed deals (n=47)"

  // Whether a key field had significant nulls
  data_quality_flags: DataQualityFlag[];
}

interface DataQualityFlag {
  field: string;                        // e.g. "amount", "close_date", "forecast_category"
  null_rate: number;                    // 0.0–1.0
  impact: 'high' | 'medium' | 'low';   // how much does null in this field affect the claim
  note: string;                         // e.g. "Amount missing on 23% of deals — aggregate understated"
}
```

**Step 2 — Confidence tier assignment rules:**

Implement a shared `assignConfidenceTier` function used by all skills:

```typescript
// server/skills/confidence.ts

interface ConfidenceInput {
  sample_size: number;
  population_size: number;
  key_field_null_rates: Record<string, number>;   // field → null rate
  has_historical_baseline: boolean;               // does this metric have a prior period to compare to?
  signal_consistency: 'consistent' | 'mixed' | 'conflicting'; // are sub-signals pointing the same way?
}

function assignConfidenceTier(input: ConfidenceInput): ClaimConfidence {
  const coverage_rate = input.sample_size / Math.max(input.population_size, 1);
  const max_null_rate = Math.max(...Object.values(input.key_field_null_rates), 0);

  let tier: 'high' | 'medium' | 'low';
  let tier_reason: string;

  // High: large sample, high coverage, clean data, consistent signal
  if (
    input.sample_size >= 20 &&
    coverage_rate >= 0.80 &&
    max_null_rate <= 0.15 &&
    input.signal_consistency === 'consistent'
  ) {
    tier = 'high';
    tier_reason = `Based on ${input.sample_size} records with ${Math.round(coverage_rate * 100)}% field coverage`;
  }
  // Low: small sample OR very low coverage OR very high nulls OR conflicting signal
  else if (
    input.sample_size < 5 ||
    coverage_rate < 0.40 ||
    max_null_rate > 0.50 ||
    input.signal_consistency === 'conflicting'
  ) {
    tier = 'low';
    if (input.sample_size < 5) {
      tier_reason = `Based on only ${input.sample_size} records — treat as directional, not definitive`;
    } else if (coverage_rate < 0.40) {
      tier_reason = `Only ${Math.round(coverage_rate * 100)}% of records had required data — aggregate likely understated`;
    } else if (max_null_rate > 0.50) {
      const worstField = Object.entries(input.key_field_null_rates).sort((a, b) => b[1] - a[1])[0];
      tier_reason = `${worstField[0]} is missing on ${Math.round(worstField[1] * 100)}% of records — confidence is low`;
    } else {
      tier_reason = 'Signals from different data sources are conflicting — interpret with caution';
    }
  }
  // Medium: everything else
  else {
    tier = 'medium';
    tier_reason = `Based on ${input.sample_size} of ${input.population_size} records`;
    if (max_null_rate > 0.20) {
      const worstField = Object.entries(input.key_field_null_rates).sort((a, b) => b[1] - a[1])[0];
      tier_reason += ` — ${worstField[0]} missing on ${Math.round(worstField[1] * 100)}% of records`;
    }
  }

  const data_quality_flags: DataQualityFlag[] = Object.entries(input.key_field_null_rates)
    .filter(([, rate]) => rate > 0.10)
    .map(([field, rate]) => ({
      field,
      null_rate: rate,
      impact: rate > 0.40 ? 'high' : rate > 0.20 ? 'medium' : 'low',
      note: `${field} missing on ${Math.round(rate * 100)}% of records`
    }));

  return {
    tier,
    sample_size: input.sample_size,
    population_size: input.population_size,
    coverage_rate,
    missing_field_rate: max_null_rate > 0 ? max_null_rate : undefined,
    tier_reason,
    data_quality_flags
  };
}
```

**Step 3 — Wire into every skill.** Each skill's compute phase already calculates sample sizes and null rates for its key fields. Audit every skill in `server/skills/` and ensure `assignConfidenceTier` is called when building each `Claim`. The required inputs are all available from existing compute queries — this is a wiring task, not a new computation task.

Key field mappings per skill:
- `pipeline-hygiene` → key fields: `amount`, `close_date`, `next_step`, `days_since_activity`
- `single-thread-alert` → key fields: `contact_count`, `contact_roles`
- `pipeline-coverage` → key fields: `amount`, `forecast_category`, quota config completeness
- `forecast-rollup` → key fields: `amount`, `forecast_category`, `probability`, `close_date`
- `rep-scorecard` → key fields: `amount`, `stage`, `activity_count`
- `icp-discovery` → key fields: enrichment coverage rate, `company_size`, `industry`
- `conversation-intelligence` → key fields: transcript availability rate, speaker attribution rate

**Acceptance:** Every `Claim` produced by every skill has a populated `confidence` block. No claim is produced without `sample_size`, `population_size`, and `tier_reason` set.

---

### T11 — Confidence Tier Rendering: UI Components

**Files:** `client/src/components/shared/ConfidenceBadge.tsx`, `client/src/components/assistant/ChatMessage.tsx`, `client/src/components/assistant/ProactiveBriefing.tsx`, all finding card components

**Step 1 — `<ConfidenceBadge>` component:**

```typescript
// client/src/components/shared/ConfidenceBadge.tsx

interface ConfidenceBadgeProps {
  confidence: ClaimConfidence;
  compact?: boolean;   // true: icon only; false: icon + label
}
```

Visual treatment:
- `high`: no badge shown by default — high confidence is the assumed baseline, not worth marking
- `medium`: small amber dot `●` with label "Moderate confidence" on hover/expand. Does not visually interrupt the finding card but signals "worth knowing"
- `low`: amber `⚠` with label visible inline (not just on hover). Finding card gets a subtle left border in amber. The `tier_reason` is shown as a small line below the claim message.

The goal: high confidence findings look normal. Low confidence findings are visually distinct — not alarming, but honest. The user's eye should be drawn to low-confidence claims when they're deciding where to push back.

**Step 2 — Denominator disclosure in prose synthesis.**

The LLM synthesis layer (wherever Claude produces narrative text from compute summaries) must include a validation rule: any sentence containing a percentage or ratio must include its denominator in parentheses if the denominator is less than the full population.

Add a post-processing pass on LLM output before it reaches the frontend:

```typescript
// server/agents/output-validator.ts

function validateDenominatorDisclosure(
  text: string,
  claimContext: Map<string, ClaimConfidence>
): { text: string; warnings: string[] } {
  const warnings: string[] = [];

  // Pattern: percentage or ratio mentioned without sample context
  // If a claim in context has coverage_rate < 0.9 and the text references that metric,
  // append the coverage note.
  
  // This is a heuristic pass — not perfect, but catches the most common failure:
  // "Win rate is 34%" when win_rate claim has coverage_rate = 0.61
  // → append: " (calculated on 37 of 61 deals with amount populated)"
  
  // Implementation: for each claim with coverage_rate < 0.90 and the claim's 
  // metric keyword appears in the text, append the tier_reason inline.
  
  return { text: augmentedText, warnings };
}
```

**Step 3 — Voice modulation based on confidence tier.**

The LLM system prompt for synthesis gets a new instruction block:

```
CONFIDENCE VOICE RULES:
- High confidence findings: state directly. "Win rate is 34%." "Sara has 3 single-threaded deals."
- Medium confidence findings: use hedged framing. "Based on the deals with amounts populated, coverage looks like 2.4x — worth confirming the missing 23% aren't skewing this."
- Low confidence findings: always flag the limitation first. "Early signal only — based on 4 deals: [finding]. Treat as directional until the sample grows."
- Never present a relative change (%, delta) without the absolute base value.
- Never state causation. State correlation and invite the user to investigate. "This coincides with X" not "X caused this."
```

**Acceptance:** A low-confidence claim in the brief shows an amber `⚠` indicator, a `tier_reason` line below the claim, and the synthesized prose uses hedged language. A high-confidence claim shows no badge and direct language. A medium-confidence claim shows a subtle amber dot that expands to the tier reason on click.

---

### T12 — Conversation Context Object

**Files:** `server/agents/orchestrator.ts`, `server/agents/session-context.ts` (create this file)

Today every chat turn is stateless beyond the raw conversation history. This task creates a structured `SessionContext` that accumulates within a session and is passed with every turn.

```typescript
// server/agents/session-context.ts

interface SessionContext {
  session_id: string;
  workspace_id: string;
  started_at: string;

  // Conversation history (existing — formalize it here)
  conversation_history: ConversationTurn[];

  // Data computed this session — avoid re-fetching
  computed_this_session: {
    [calculation_key: string]: {
      data: any;
      calculation_id: string;
      fetched_at: string;
      ttl_minutes: number;        // how long before this is considered stale
    };
  };

  // Named deals looked up this session (live table)
  deals_looked_up: {
    [deal_name_normalized: string]: LiveDealFact & { looked_up_at: string };
  };

  // Active scope — what the conversation is currently "about"
  active_scope: {
    rep?: string;                 // "Sara" — inherited by follow-up questions
    pipeline?: string;            // "Core Sales" — inherited until explicitly changed
    time_range?: string;          // "this quarter", "last 90 days"
    deal?: string;                // specific deal in focus
    topic?: string;               // "coverage", "forecast", "pipeline health"
  };

  // Scope stack — previous scopes, so "go back to total pipeline" works
  scope_stack: ActiveScope[];

  // Document accumulator (see T13)
  document_accumulator: DocumentAccumulator;

  // Correction history — track what was corrected so the system doesn't repeat
  corrections: {
    turn_index: number;
    original_claim: string;
    corrected_value: string;
    correction_type: 'wrong_amount' | 'wrong_stage' | 'wrong_attribution' | 'scope_mismatch' | 'other';
  }[];
}

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  turn_index: number;
  timestamp: string;
  response_blocks?: ResponseBlock[];    // structured blocks (prose, table, chart)
  calculations_used?: string[];         // calculation_ids used to generate this turn
  scope_at_turn?: ActiveScope;          // what scope was active when this was generated
}
```

**Scope inheritance rules:**

When a new user message arrives, before routing:

1. Extract any explicit scope signals from the message ("what about Core Sales?", "and for Sara?")
2. If explicit scope found → update `active_scope` and push prior scope to `scope_stack`
3. If no explicit scope found AND message is a follow-up (short message, references prior context) → inherit current `active_scope`
4. If no explicit scope found AND message is a new question (long, new topic signal) → clear `active_scope`, start fresh

Inject the active scope into the LLM context:

```
<active_scope>
  Rep: Sara Johnson
  Pipeline: Core Sales
  Time range: Q1 FY2026 (Jan 1 – Mar 31)
  Topic: Coverage
</active_scope>

When answering the user's question, interpret it within this scope unless they explicitly ask to change it. If the question seems to be changing scope, confirm before switching: "Switching to total pipeline — or did you mean Sara's pipeline specifically?"
```

**Computation cache rules:** Before querying the Calculation layer, check `computed_this_session`:
- If the required `calculation_key` exists and `fetched_at` is within `ttl_minutes` → use cached value
- If stale or missing → run calculation, store result in context

Standard TTLs: pipeline metrics = 10 min, rep scorecards = 10 min, deal lookups = 5 min, ICP scores = 60 min.

**Acceptance:** Ask "how's Sara's pipeline?" then "what about her single-threaded deals?" The second question inherits Sara scope without being told. No re-query for data already fetched this session. The `active_scope` is visible in debug mode.

---

### T13 — Document Accumulator

**Files:** `server/agents/session-context.ts` (extend), `server/documents/accumulator.ts` (create), `client/src/components/assistant/DocumentAccumulatorPanel.tsx` (create)

The Document Accumulator runs silently alongside every chat session and collects contributions that could form a document. The user can render the accumulated content into a WBR, QBR, board deck, or ad-hoc analysis at any point.

**Step 1 — Accumulator data structure:**

```typescript
// server/documents/accumulator.ts

interface DocumentAccumulator {
  document_type?: 'wbr' | 'qbr' | 'board_deck' | 'ad_hoc_analysis' | 'forecast_review';
  // null until user declares intent or system infers it

  contributions: DocumentContribution[];

  // Inferred outline based on contributions so far
  outline: DocumentSection[];

  // Whether the user has declared a document intent
  intent_declared: boolean;
  intent_declared_at?: string;
}

interface DocumentContribution {
  id: string;
  turn_index: number;             // which conversation turn this came from
  timestamp: string;

  contribution_type:
    | 'finding'                   // a claim or insight
    | 'chart'                     // a rendered chart spec
    | 'table'                     // a rendered table
    | 'recommendation'            // an action recommendation
    | 'metric'                    // a key metric with value + context
    | 'narrative'                 // a prose paragraph worth including
    | 'correction';               // a correction to a prior finding (updates, not adds)

  content: {
    prose?: string;               // the text of the finding/recommendation/narrative
    chart_spec?: ChartSpec;       // if contribution_type = 'chart'
    table_spec?: TableSpec;       // if contribution_type = 'table'
    metric?: {
      label: string;
      value: string | number;
      context: string;            // e.g. "vs. $350K target"
      confidence: ClaimConfidence;
    };
  };

  // Where in the document this belongs
  assigned_section?: string;      // user-assigned or inferred
  inferred_section?: string;      // system's best guess before user confirms
  include_in_document: boolean;   // user can exclude specific contributions
}

interface DocumentSection {
  id: string;
  label: string;                  // "Pipeline Health", "Rep Performance", "Forecast", "Risks & Actions"
  contribution_ids: string[];     // which contributions belong here
  is_empty: boolean;              // true if no contributions assigned
}
```

**Step 2 — Auto-tagging contributions.**

After every assistant response, the accumulator runs a lightweight classification pass on the response blocks:

```typescript
function classifyContributions(
  turn: ConversationTurn,
  existingAccumulator: DocumentAccumulator
): DocumentContribution[] {
  const contributions: DocumentContribution[] = [];

  for (const block of turn.response_blocks || []) {
    if (block.blockType === 'chart') {
      contributions.push({
        contribution_type: 'chart',
        content: { chart_spec: block.spec },
        inferred_section: inferSection(block.spec.title),
        include_in_document: true,
        // ...
      });
    }

    if (block.blockType === 'table') {
      contributions.push({
        contribution_type: 'table',
        content: { table_spec: block.spec },
        inferred_section: inferSection(block.spec.title),
        include_in_document: true,
      });
    }

    if (block.blockType === 'prose' && isSubstantiveFinding(block.text)) {
      contributions.push({
        contribution_type: isProseProse(block.text) ? 'finding' : 'narrative',
        content: { prose: block.text },
        inferred_section: inferSectionFromProse(block.text),
        include_in_document: true,
      });
    }
  }

  return contributions;
}

function isSubstantiveFinding(text: string): boolean {
  // Exclude: clarifications, corrections, meta-conversation, one-liners
  // Include: findings with metrics, named entities, or action recommendations
  const hasMetric = /\d+[%xkKmM$]/.test(text);
  const hasNamedEntity = text.length > 100;   // rough proxy
  return hasMetric || hasNamedEntity;
}

function inferSection(title: string): string {
  // Map common titles to standard sections
  const sectionMap: Record<string, string[]> = {
    'Pipeline Health': ['pipeline', 'coverage', 'stage', 'hygiene', 'stale'],
    'Rep Performance': ['rep', 'sara', 'nate', 'scorecard', 'quota', 'attainment'],
    'Forecast': ['forecast', 'commit', 'attainment', 'gap', 'close'],
    'Risks & Actions': ['risk', 'single-thread', 'blocked', 'action', 'recommendation', 'focus'],
    'Market & ICP': ['icp', 'segment', 'persona', 'competitive', 'win rate'],
  };
  const titleLower = title.toLowerCase();
  for (const [section, keywords] of Object.entries(sectionMap)) {
    if (keywords.some(kw => titleLower.includes(kw))) return section;
  }
  return 'General';
}
```

**Step 3 — Document intent detection.**

When a user message contains document intent signals, set `intent_declared = true` and `document_type`:

Signals:
- "build me a WBR" / "create a weekly review" → `wbr`
- "put this together as a QBR" / "I need a QBR deck" → `qbr`
- "board deck" / "board update" → `board_deck`
- "create a doc from this" / "export this conversation" / "make a report" → `ad_hoc_analysis`
- "forecast review" / "forecast doc" → `forecast_review`

When intent is detected, respond with the outline preview before rendering:

```
Got it — building a WBR from this session. Here's what I've accumulated so far:

📊 Pipeline Health — 3 findings, 2 charts
  · Sara's Behavioral Framework is single-threaded (low confidence — 1 deal)
  · Pipeline coverage at 2.4x total, 1.6x Core Sales only
  · Waterfall: net pipeline down $145K this week

👥 Rep Performance — 2 findings, 1 table
  · Nate closed ACES ABA ($315K) — Core Sales now at 110% attainment
  · Rep coverage chart: Marcus and David below 2x

🎯 Forecast — 1 finding
  · Realistic close range $310K–$380K vs. $420K commit

⚠ Risks & Actions — 2 recommendations
  · Multi-thread Behavioral Framework before Monday
  · Audit 14-day no-touch deals before EOD Wednesday

Missing sections for a complete WBR: Market & ICP, Prior Period Comparison.
Want to fill those in before I render, or render now with what we have?
```

**Step 4 — Render trigger.**

When user confirms render intent, call the existing renderer pipeline with the accumulated contributions as input:

```typescript
async function renderFromAccumulator(
  accumulator: DocumentAccumulator,
  format: 'pptx' | 'docx' | 'xlsx',
  workspace: WorkspaceContext,
  sessionContext: SessionContext
): Promise<RenderOutput> {

  // 1. Run synthesis pass — generate narrative bridges between sections
  const synthesizedOutline = await synthesizeDocumentNarrative(accumulator, sessionContext);

  // 2. Map to RendererInput
  const rendererInput: RendererInput = {
    agentOutput: accumulatorToAgentOutput(synthesizedOutline),
    workspace,
    options: {
      detail_level: 'summary_and_data',
      include_methodology: true,
      time_range_label: `Q${currentQuarter} · Week of ${weekLabel}`,
      generated_at: new Date().toISOString(),
    }
  };

  // 3. Hand to existing renderer (PPTX, DOCX, or XLSX)
  return await rendererRegistry.render(format, rendererInput);
}
```

**Synthesis pass** — before rendering, one Claude call that takes the full accumulated outline and writes:
- An executive summary (3–5 sentences, the throughline argument)
- A one-sentence narrative bridge between each section
- A "Key Actions" closing section drawn from all `recommendation` contributions

This is what makes the document readable as a document, not just a findings dump.

**Step 5 — Frontend panel.**

```typescript
// client/src/components/assistant/DocumentAccumulatorPanel.tsx
```

A collapsible panel in the Ask Pandora chat sidebar (or bottom of AssistantView). Shows:
- Number of contributions accumulated: "14 contributions · 3 charts · 2 tables"
- Section breakdown with contribution counts per section
- "Build Document →" button that opens format picker (PPTX / DOCX / XLSX)
- Individual contributions with an × to exclude before rendering
- Inline section reassignment ("Move to Forecast →")

The panel is visible but not intrusive — it should feel like a natural part of the workspace, not a separate mode.

**Acceptance:** Have a 10+ message session about pipeline, reps, and forecast. Click "Build Document." See the outline preview with correct section assignments. Render as DOCX. The document contains all charts and tables from the session, synthesized narrative bridges, and a key actions closing section.

---

### T14 — Cross-Session Memory (Workspace Memory Layer)

**Files:** `server/memory/workspace-memory.ts` (create), `migrations/050_workspace_memory.sql` (create), `server/briefs/brief-assembler.ts` (extend)

**Step 1 — Database schema:**

```sql
-- migrations/050_workspace_memory.sql

CREATE TABLE workspace_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  memory_type VARCHAR(50) NOT NULL,
  -- Types: 'recurring_finding', 'tracked_recommendation', 'resolved_finding',
  --        'metric_baseline', 'prior_document', 'rep_pattern', 'deal_outcome'

  -- Entity this memory is about (optional)
  entity_type VARCHAR(20),              -- 'deal', 'rep', 'account', 'pipeline', 'workspace'
  entity_id VARCHAR(255),               -- CRM ID or name
  entity_name VARCHAR(255),

  -- The memory content
  summary TEXT NOT NULL,                -- Human-readable summary of what's remembered
  detail JSONB,                         -- Full structured data

  -- Recurrence tracking
  first_observed_at TIMESTAMPTZ NOT NULL,
  last_observed_at TIMESTAMPTZ NOT NULL,
  observation_count INTEGER DEFAULT 1,

  -- Resolution tracking (for findings and recommendations)
  status VARCHAR(20) DEFAULT 'active',  -- 'active', 'resolved', 'expired', 'overridden'
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,

  -- Linkage
  source_skill_run_ids UUID[],          -- which skill runs produced this memory
  source_document_ids UUID[],           -- which documents referenced this memory

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workspace_memory_workspace ON workspace_memory(workspace_id);
CREATE INDEX idx_workspace_memory_type ON workspace_memory(workspace_id, memory_type);
CREATE INDEX idx_workspace_memory_entity ON workspace_memory(workspace_id, entity_type, entity_id);
CREATE INDEX idx_workspace_memory_status ON workspace_memory(workspace_id, status);
```

**Step 2 — Memory writer: post-skill-run.**

After every skill run completes, the memory writer compares new findings to existing `workspace_memory` rows:

```typescript
// server/memory/workspace-memory.ts

async function processSkillRunForMemory(
  workspaceId: string,
  skillId: string,
  newClaims: Claim[]
): Promise<void> {

  for (const claim of newClaims) {
    // Check if this finding has been seen before
    const existing = await findExistingMemory(workspaceId, claim);

    if (existing) {
      // Increment observation count, update last_observed_at
      await db.query(`
        UPDATE workspace_memory
        SET observation_count = observation_count + 1,
            last_observed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `, [existing.id]);
    } else {
      // New finding — create memory row
      await db.query(`
        INSERT INTO workspace_memory
          (workspace_id, memory_type, entity_type, entity_id, entity_name,
           summary, detail, first_observed_at, last_observed_at, source_skill_run_ids)
        VALUES ($1, 'recurring_finding', $2, $3, $4, $5, $6, NOW(), NOW(), $7)
      `, [
        workspaceId,
        claim.entity_type,
        claim.entity_id,
        claim.entity_type === 'rep' ? claim.message.split(' ')[0] : claim.entity_id,
        claim.message,
        JSON.stringify({ claim, original_severity: claim.severity }),
        [currentSkillRunId]
      ]);
    }
  }
}
```

**Step 3 — Memory reader: brief assembler.**

Before assembling the brief narrative, query workspace memory for context that should inform the brief:

```typescript
// In brief-assembler.ts, before Claude synthesis call:

const memoryContext = await queryRelevantMemory(workspaceId, {
  types: ['recurring_finding', 'tracked_recommendation', 'resolved_finding'],
  status: 'active',
  min_observation_count: 2,      // only patterns seen at least twice
  limit: 10
});

// Inject into Claude synthesis prompt:
const memoryPrompt = memoryContext.length > 0 ? `
<workspace_memory>
These patterns have been observed in prior weeks. Reference them when relevant — 
acknowledge what has improved and what is recurring:

${memoryContext.map(m =>
  `- ${m.summary} (observed ${m.observation_count} times, first seen ${formatRelativeDate(m.first_observed_at)})`
).join('\n')}
</workspace_memory>
` : '';
```

This produces brief language like: "Sara's single-thread pattern on Behavioral Framework has now been flagged three weeks in a row — this isn't a one-week observation anymore, it's a process gap."

**Step 4 — Recommendation tracking.**

When the brief or Assistant emits a `recommendation` contribution, log it to `workspace_memory` as `tracked_recommendation`:

```typescript
interface TrackedRecommendation {
  recommendation_text: string;
  entity_type: string;
  entity_id: string;
  recommended_at: string;
  outcome?: 'completed' | 'ignored' | 'partially_completed' | 'superseded';
  outcome_detected_at?: string;
  outcome_evidence?: string;      // e.g. "Deal moved to next stage 2 days later"
}
```

Outcome detection runs as part of the post-sync material change check (T8). If a deal was recommended for multi-threading and now has 3+ contacts, mark the recommendation `completed`. If the deal closed lost and was never multi-threaded, mark it `ignored`. This is the closed-loop learning that makes Pandora's recommendations credible over time.

**Acceptance:** A finding flagged in week 1 brief appears in week 2 brief with "flagged again this week — 2nd occurrence." By week 3 it says "recurring pattern — 3rd week in a row." A recommendation that was actioned shows as resolved in the memory store.

---

### T15 — Assistant Failure Hardening

**Files:** `server/agents/orchestrator.ts`, system prompt templates

**Failure 1 — Compound questions:**

Add a pre-routing pass that detects multi-part questions:

```typescript
function detectCompoundQuestion(message: string): {
  isCompound: boolean;
  parts: string[];
} {
  const conjunctionPattern = /\b(and|also|as well as|plus|what about)\b/gi;
  const questionPattern = /\?/g;
  const questionCount = (message.match(questionPattern) || []).length;
  const hasConjunction = conjunctionPattern.test(message);

  if (questionCount > 1 || (hasConjunction && message.length > 60)) {
    // Split into parts and route each independently
    // Merge responses before returning to user
    return { isCompound: true, parts: splitCompoundQuestion(message) };
  }
  return { isCompound: false, parts: [message] };
}
```

Each part is routed and answered independently, then the responses are merged into a single structured answer that addresses both parts explicitly.

**Failure 2 — Short follow-ups losing context:**

Add to the system prompt for all turns after the first:

```
CONVERSATION CONTINUITY RULES:
- The active scope is: <active_scope>...</active_scope>
- If the user's message is 10 words or fewer and contains no new entities or metrics, treat it as a follow-up within the current scope.
- Never lose context of what was just discussed. If uncertain about scope, state your assumption: "Still looking at Sara's pipeline — if you meant total pipeline, just say so."
- Never re-introduce yourself or re-explain what Pandora is mid-conversation.
```

**Failure 3 — Questions about data Pandora doesn't have:**

Before routing, check whether the required data category exists for this workspace:

```typescript
const DATA_AVAILABILITY_MAP: Record<string, string[]> = {
  'win_rate': ['deals'],
  'nrr': ['revenue_data'],          // not in standard schema
  'mql_conversion': ['marketing_data'],  // not in standard schema
  'competitive_win_rate': ['conversation_intelligence', 'deal_tags'],
  'churn_rate': ['customer_success_data'],  // not in standard schema
};

function checkDataAvailability(questionCategory: string, workspaceConnectors: string[]): {
  available: boolean;
  missing?: string;
  explanation?: string;
} {
  const required = DATA_AVAILABILITY_MAP[questionCategory] || [];
  const missing = required.filter(r => !workspaceConnectors.includes(r));
  if (missing.length > 0) {
    return {
      available: false,
      missing: missing[0],
      explanation: `This question requires ${missing[0]}, which isn't connected to your workspace yet.`
    };
  }
  return { available: true };
}
```

When data is unavailable, the response should be honest and specific — not "I couldn't find data on this" but "NRR requires revenue/subscription data, which isn't in your connected sources. Pandora has your CRM deals — if SFDC tracks ARR or ACV as a custom field, I could approximate it from there."

**Failure 4 — Hallucinated causation:**

Add to the synthesis system prompt:

```
CAUSATION RULE:
Never state that X caused Y. You are a correlation surface, not a causal inference engine.
Permitted: "This coincides with", "This followed", "This pattern emerged around the same time as"
Not permitted: "This was caused by", "This happened because", "This led to"
If you see a correlation worth flagging, say: "Worth investigating whether X is connected to Y."
```

**Failure 5 — Metric definition transparency:**

Any message that returns a calculated metric must include the definition inline, as a small expandable disclosure. Add to the response assembler:

```typescript
function appendMetricDefinition(
  metricName: string,
  value: string | number,
  definition: MetricDefinition
): string {
  return `${metricName}: ${value}
  _(${definition.formula} · ${definition.scope} · ${definition.time_window})_`;
}

// Example output:
// Win rate: 34%
// _(Closed Won / (Closed Won + Closed Lost) · Core Sales Pipeline · trailing 90 days · n=47)_
```

**Acceptance:** Ask a compound question — both parts are answered in the same response. Ask a short follow-up — scope is preserved. Ask about NRR — get a clear explanation of what's missing and what's possible. Check a win rate response — the definition is visible inline.

---

## Sequencing

**Track A (Confidence — backend):** T10 only — wire `assignConfidenceTier` into all skills  
**Track B (Confidence — frontend):** T11 — depends on T10 types being exported  
**Track C (Session intelligence):** T12 → T13 → (document accumulator depends on session context)  
**Track D (Memory):** T14 — independent, can run in parallel with C  
**Track E (Hardening):** T15 — independent, prompt + validation layer changes  

T10 is the highest-leverage single task. It changes the trust signal of every finding Pandora produces. Start there.

---

## Acceptance Criteria (Full Suite)

1. **Every claim has a confidence tier.** Inspect any skill run output. Every `Claim` has `confidence.tier`, `confidence.sample_size`, `confidence.population_size`, `confidence.tier_reason`. No exceptions.

2. **Low-confidence claims are visually distinct.** A finding based on 3 deals looks different from a finding based on 200 deals. The user can see why at a glance without clicking.

3. **Prose synthesis uses hedged language for low-confidence findings.** A low-confidence finding in the brief uses "early signal" framing. A high-confidence finding uses direct declarative language.

4. **Denominators are visible.** Any aggregate metric response includes its n, its coverage rate, and its time window. "Win rate: 34% (n=47, Core Sales, trailing 90 days, 61% of deals had required fields)" is the standard, not the exception.

5. **Session scope persists across follow-ups.** A 20-message session about Sara's pipeline doesn't lose Sara as scope when the user asks a short follow-up. Scope changes are explicit and confirmed.

6. **Document accumulator builds a correct outline.** After a 15-message session, the accumulator panel shows the correct section breakdown. Every chart and substantive finding is included. Excluding a contribution removes it from the outline.

7. **Render from accumulator produces a readable document.** The rendered DOCX/PPTX has an executive summary, narrative bridges between sections, and a key actions closing section — not just a list of findings.

8. **Recurring patterns surface in the brief.** A finding flagged two weeks in a row is described as recurring on its second appearance. A finding flagged four weeks in a row is described as a persistent pattern requiring a structural fix, not a weekly alert.

9. **Compound questions are fully answered.** A two-part question receives two complete answers in the same response, clearly labeled.

10. **Missing data is explained, not hidden.** A question about data Pandora doesn't have receives a specific, honest explanation of what's missing and what Pandora can offer as an approximation.
