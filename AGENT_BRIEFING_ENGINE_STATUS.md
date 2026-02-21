# Agent Briefing Engine — Build Status

**Project Plan:** PANDORA_AGENT_BRIEFING_ENGINE_PROJECT_PLAN.md
**Started:** February 21, 2026

---

## Phase 1: Editorial Synthesis Engine ✅ CORE COMPLETE

**Goal:** Agent reads skill evidence, makes editorial decisions, produces SectionContent[] instead of static template assembly.

**Status:** Tasks 1A-1D complete. Task 1E (smoke test) pending.

### Task 1A: Editorial Synthesis Function ✅
**File:** `server/agents/editorial-synthesizer.ts` (253 lines)

**What it does:**
- Single Claude call to synthesize entire briefing (not per-section)
- Reads all skill evidence holistically to identify 2-3 most important things
- Makes editorial decisions: lead_with, drop_section, promote_finding, adjust_depth
- Writes opening narrative that frames the whole briefing
- Adjusts section depth based on importance (12 issues → detailed, tracking fine → one line)
- Returns `EditorialOutput` with decisions + sections

**Key design decisions:**
- One Claude call for editorial coherence (not one per section)
- Budget: ~4K input tokens (evidence summaries) + ~3K output tokens (structured sections)
- Cost per briefing: ~$0.10
- Structured JSON output with editorial_decisions[] for transparency

### Task 1B: Wire Into Report Generation Pipeline ✅
**Files:**
- `server/reports/editorial-generator.ts` (287 lines) - New editorial generation flow
- `server/reports/generator.ts` (modified) - Routes to editorial when agent_id present

**What it does:**
- Report generation checks `template.agent_id`
- If set: routes to `generateEditorialReport()` (agent-powered)
- If null: uses legacy `generateReport()` (section-generator.ts)
- Backward compatible: existing templates continue to work

**Flow:**
1. Load template + agent
2. Gather fresh evidence (via evidence-gatherer)
3. Load tuning pairs (from context_layer)
4. Build audience config from agent metadata
5. Call `editorialSynthesize()`
6. Render to PDF/DOCX/PPTX (existing renderers unchanged)
7. Save with editorial metadata

### Task 1C: Evidence Gathering Helper ✅
**File:** `server/agents/evidence-gatherer.ts` (166 lines)

**What it does:**
- Reads latest skill runs for each skill in agent's skill list
- Uses staleness thresholds to decide cache vs fresh run:
  - Pipeline skills: 12 hours
  - Forecasting: 24 hours
  - Intelligence (expensive): 48-72 hours
  - Config/audit: 168 hours (weekly)
- Returns `Record<skillId, SkillEvidence>`

**Stats tracking:**
- Cached evidence count
- Fresh runs triggered
- Failed skill runs

### Task 1D: Tuning Pairs Reader ✅
**File:** `server/agents/tuning.ts` (135 lines)

**What it does:**
- Reads tuning pairs from `context_layer` table (category='agent_tuning')
- Key format: `{agentId}:{preference}` (e.g., `abc-123:emphasis_preference`)
- Filters by confidence ≥ 0.5
- Returns top 10 tuning instructions for synthesis prompt
- Provides save/remove functions for Phase 4 feedback pipeline

### Task 1E: Smoke Test ⏳ PENDING
**What needs testing:**
1. Take existing Monday Pipeline Briefing template for a workspace
2. Create agent linked to that template
3. Run editorial synthesis
4. Compare outputs:
   - Static: 4 sections, same structure every time
   - Editorial: Agent decides structure, adjusts depth, writes narrative arc
5. Verify: editorial output renders correctly in PDF/Slack/viewer

**Success criteria:**
- ✅ Editorial output renders in existing PDF renderer without changes
- ⏳ Agent produces different structure when skill evidence changes
- ⏳ Opening narrative references specific workspace data, not generic text
- ⏳ Editorial decisions are logged and inspectable
- ⏳ Total generation time < 15 seconds
- ⏳ Token cost per briefing < $0.15

---

## Phase 2: Agent Templates + Builder Parameters ❌ NOT STARTED

**Goal:** Agent Builder lets users configure audience, focus questions, data windows, and event prep schedules.

**Duration:** ~4 hours

### Task 2A: Agent Template Schema
- Extend `agents` table with:
  - `audience` JSONB (role, detail_preference, vocabulary_avoid/prefer)
  - `focus_questions` JSONB array
  - `data_window` JSONB (primary, comparison)
  - `output_formats` JSONB
  - `event_config` JSONB (for prep schedules)

### Task 2B: Pre-Built Agent Templates
Create 5 templates:
1. Monday Pipeline Briefing (weekly sales leadership)
2. Forecast Call Prep (pre-meeting intelligence)
3. Friday Recap (end-of-week retrospective)
4. Board Meeting Prep (strategic analysis + deck)
5. Quarterly Business Review (comprehensive analysis)

### Task 2C: Agent Builder UI Expansion
Add to existing Agent Builder:
- Audience selector with vocabulary preferences
- Focus questions text input list
- Data window dropdown
- Event prep mode with date picker
- Template gallery to start with defaults

### Task 2D: Migration
`migrations/076_agent_briefing_config.sql`

---

## Phase 3: Self-Reference (Memory Across Runs) ❌ NOT STARTED

**Goal:** Agent reads previous outputs and tracks patterns without blowing context.

**Duration:** ~4 hours

**Two-Tier Bounded Memory Architecture:**
- **Tier 1:** Last run digest (~500 tokens) - compressed summary, generated at write time
- **Tier 2:** Rolling memory (~800 tokens) - recurring flags, deal history, metric trends, predictions
- **Total:** Always under 1,500 tokens regardless of run count (week 1 = week 52)

### Task 3A: Run Digest Schema
- `AgentRunDigest` - compressed summary of each run
- Fields: opening_narrative, key_findings[], actions_recommended[], sections_included/dropped
- Stored in `report_generations.run_digest` JSONB

### Task 3B: Rolling Memory Schema
- `AgentMemory` - fixed-size rolling structures
- Stored in `context_layer` (category='agent_memory', key='memory:{agentId}')
- Structures:
  - `recurring_flags[]` (cap: 30, prune resolved > 30 days)
  - `deal_history[]` (cap: 20 deals, 5 mentions each, FIFO)
  - `metric_history[]` (8 data points per metric, FIFO)
  - `predictions[]` (cap: 10, FIFO)

### Task 3C: Memory Update Function
- Runs after each generation
- Updates recurring flags, deal history, metric trends, prediction outcomes
- Enforces all caps and eviction policies

### Task 3D: Memory Injection into Synthesis Prompt
- Format digest + rolling memory into 600-1200 token prompt block
- Self-reference instructions: note changes, check if flagged deals were addressed, escalate recurring issues

### Task 3E: Wire Into Generation Pipeline
- Load digest + memory before synthesis
- Pass memoryContext to editorialSynthesize()
- Extract digest and update memory after generation

### Task 3F: Migration
Already done in 075_agent_editorial.sql (run_digest column added)

---

## Phase 4: Feedback UI + Tuning Pipeline ❌ NOT STARTED

**Goal:** Structured feedback on agent outputs converts to tuning pairs.

**Duration:** ~5 hours

### Task 4A: Feedback Data Model
`migrations/077_agent_feedback.sql`
- `agent_feedback` table with feedback_type, signal, comment, rating
- Signals: useful, not_useful, wrong_emphasis, too_detailed, too_brief, wrong_data, good_insight

### Task 4B: Feedback UI in Report Viewer
- Per-section feedback controls (thumbs up/down, comment)
- Overall briefing feedback (rating, editorial preferences)
- Quick signals: "too detailed", "led with wrong thing", etc.

### Task 4C: Feedback → Tuning Pipeline
- Background processor converts feedback to tuning pairs
- Maps signals to instructions (e.g., "too_detailed" → "Keep {section} brief — 1-2 points only")
- Upserts to context_layer with confidence scores

### Task 4D: Tuning Pair Injection
Already done in Phase 1 (getTuningPairs + formatTuningForPrompt)

### Task 4E: Feedback API Endpoints
- POST `/api/workspaces/:id/agents/:agentId/feedback`
- GET `/api/workspaces/:id/agents/:agentId/feedback`
- GET `/api/workspaces/:id/agents/:agentId/tuning`
- DELETE `/api/workspaces/:id/agents/:agentId/tuning/:key`

---

## Phase 5: Dogfood + Polish ❌ NOT STARTED

**Goal:** Run agents against real client data for 1 week. Fix what breaks.

**Duration:** 1 week minimum

### Setup
1. Frontera: Monday Pipeline Briefing (Mon 7am)
2. Imubit: Forecast Call Prep (Thu 4pm)
3. Both: Friday Recap (Fri 5pm)
4. Self: Board Meeting Prep (hypothetical March 15 date)

### Week 1 Checklist
- Day 1: Set up agents, manual first runs, review outputs
- Day 2: Submit feedback, test feedback loop
- Day 3: Monday agent runs on schedule, verify tuning took effect
- Day 4: Thursday forecast prep runs
- Day 5: Friday recap runs (test self-reference), compare to static reports

### What to Watch For
- Editorial decisions that don't make sense
- Generic narratives vs specific data references
- Repetitive across runs
- Hallucinated data
- Token cost creep (>$0.15/run)
- Feedback not taking effect
- Self-reference errors

---

## Build Sequence Summary

| Phase | Duration | Status | Key Deliverable |
|-------|----------|--------|-----------------|
| 1: Editorial Synthesis | ~6 hrs | ✅ 90% (4/5 tasks) | Agent that thinks, not assembles |
| 2: Templates + Builder | ~4 hrs | ❌ Not started | User-configurable agent parameters |
| 3: Self-Reference | ~4 hrs | ❌ Not started | Two-tier bounded memory |
| 4: Feedback + Tuning | ~5 hrs | ❌ Not started | Learning loop |
| 5: Dogfood | 1 week | ❌ Not started | Real-world validation |

**Total estimated time:** ~19 hours build + 1 week dogfooding

---

## What This Changes About Pandora's Positioning

**Before:** "Automated reports delivered on your schedule."
→ Feature. Every BI tool does this.

**After:** "An AI analyst that briefs you every Monday morning. It knows your business, remembers what it told you last week, and gets better every time you tell it what matters."
→ Product. No one else does this.

---

## Next Steps

1. **Run migration:** Execute `migrations/075_agent_editorial.sql` in production
2. **Smoke test (Task 1E):** Test editorial synthesis with real workspace data
3. **Phase 2:** Build agent templates and parameter expansion
4. **Phase 3:** Implement self-reference memory
5. **Phase 4:** Build feedback UI and tuning pipeline
6. **Phase 5:** Dogfood for 1 week
