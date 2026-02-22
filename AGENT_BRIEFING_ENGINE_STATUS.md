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

## Phase 2: Agent Templates + Builder Parameters ✅ COMPLETE

**Goal:** Agent Builder lets users configure audience, focus questions, data windows, and event prep schedules.

**Status:** All tasks complete. Built in Replit.

### Task 2A: Agent Template Schema ✅
**File:** `migrations/077_agent_briefing_config.sql`

Extended `agents` table with:
- `audience` JSONB (role, detail_preference, vocabulary_avoid/prefer)
- `focus_questions` JSONB array
- `data_window` JSONB (primary, comparison)
- `output_formats` JSONB
- `event_config` JSONB (for prep schedules)

### Task 2B: Pre-Built Agent Templates ✅
**File:** `server/agents/agent-templates.ts` (230 lines)

Created 5 templates:
1. **Monday Pipeline Briefing** - Weekly sales leadership, leads with what matters
2. **Forecast Call Prep** - Pre-meeting intelligence, frames as distance-to-target
3. **Friday Recap** - End-of-week retrospective, compares Monday predictions to Friday actuals
4. **Board Meeting Prep** - Strategic analysis + deck, avoids jargon
5. **Quarterly Business Review** - Comprehensive analysis with full pipeline + team review

Each template includes:
- Default skills list
- Audience configuration (role, detail preference, vocabulary)
- Focus questions (3-5 questions the agent should answer)
- Data window (current_week, current_quarter, fiscal_year, etc.)
- Output formats (PDF, DOCX, PPTX, Slack, Email)
- Schedule (cron or event_prep with dates)

### Task 2C: Agent Builder UI ✅
**File:** `client/src/pages/AgentBuilder.tsx` (796 lines)

Full-featured Agent Builder UI with:
- Template gallery to start with sensible defaults
- Audience selector with role + detail level + vocabulary preferences
- Focus questions text input list (add/remove questions)
- Data window dropdown (primary + comparison period)
- Event prep mode with date picker for board meetings/QBRs
- Output formats multi-select
- Schedule configuration (cron or event prep)

---

## Phase 3: Self-Reference (Memory Across Runs) ✅ COMPLETE

**Goal:** Agent reads previous outputs and tracks patterns without blowing context.

**Status:** All tasks complete. Built in Replit.

**Two-Tier Bounded Memory Architecture:**
- **Tier 1:** Last run digest (~500 tokens) - compressed summary, generated at write time
- **Tier 2:** Rolling memory (~800 tokens) - recurring flags, deal history, metric trends, predictions
- **Total:** Always under 1,500 tokens regardless of run count (week 1 = week 52)

### Task 3A: Run Digest Schema ✅
**File:** `server/agents/editorial-types.ts`

`AgentRunDigest` interface with:
- `opening_narrative` - 2-3 sentence opening from last run
- `key_findings[]` - Headlines, deals flagged, metrics snapshot, severity
- `actions_recommended[]` - What the agent recommended last time
- `sections_included/dropped` - Editorial decisions metadata
- Stored in `report_generations.run_digest` JSONB column

### Task 3B: Rolling Memory Schema ✅
**File:** `server/agents/agent-memory.ts` (386 lines)
**Migration:** `migrations/078_agent_memory.sql`

`AgentMemory` table with fixed-size rolling structures:
- **recurring_flags[]** - Cap: 30, prune resolved > 30 days
- **deal_history[]** - Cap: 20 deals, 5 mentions each (FIFO)
- **metric_history[]** - Cap: 8 data points per metric (FIFO)
- **predictions[]** - Cap: 10 predictions (FIFO)

### Task 3C: Memory Update Function ✅
**File:** `server/agents/agent-memory.ts`

Functions:
- `updateAgentMemory()` - Runs after each generation
- `extractDigest()` - Compresses output into digest
- Updates recurring flags (marks resolved when severity changes to 'good')
- Tracks deal mentions (adds status changes: flagged → closed_won)
- Appends metric snapshots (maintains 8-point rolling window)
- Checks prediction outcomes against current evidence
- Enforces all caps and FIFO eviction policies

### Task 3D: Memory Injection into Synthesis Prompt ✅
**File:** `server/agents/agent-memory.ts`

`formatMemoryForPrompt()` function:
- Formats digest + rolling memory into 600-1200 token block
- Tier 1: Last run summary (opening, deals flagged, key metrics)
- Tier 2: Recurring patterns (unresolved flags, deal tracking, metric trends, prediction accuracy)
- Self-reference instructions: "Note what changed", "Check if flagged deals were addressed", "Escalate recurring issues"

### Task 3E: Wire Into Generation Pipeline ✅
**Files:**
- `server/reports/editorial-generator.ts` - Updated to load and save memory
- `server/agents/editorial-synthesizer.ts` - Updated to inject memoryContext into prompt

**Flow:**
1. Load latest digest from `report_generations.run_digest`
2. Load rolling memory from `agent_memory` table
3. Format memory into prompt block
4. Pass `memoryContext` to `editorialSynthesize()`
5. After generation: extract new digest
6. Update rolling memory structures
7. Save digest to `report_generations.run_digest`

### Task 3F: Migration ✅
**Files:**
- `migrations/075_agent_editorial.sql` - Added `run_digest` column
- `migrations/078_agent_memory.sql` - Created `agent_memory` table

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
| 1: Editorial Synthesis | ~6 hrs | ✅ COMPLETE (5/5 tasks) | Agent that thinks, not assembles |
| 2: Templates + Builder | ~4 hrs | ✅ COMPLETE (4/4 tasks) | User-configurable agent parameters |
| 3: Self-Reference | ~4 hrs | ✅ COMPLETE (6/6 tasks) | Two-tier bounded memory |
| 4: Feedback + Tuning | ~5 hrs | ⏳ NEXT | Learning loop |
| 5: Dogfood | 1 week | ⏳ PENDING | Real-world validation |

**Total time invested:** ~14 hours (Phases 1-3)
**Remaining:** ~5 hours (Phase 4) + 1 week dogfooding (Phase 5)

---

## What This Changes About Pandora's Positioning

**Before:** "Automated reports delivered on your schedule."
→ Feature. Every BI tool does this.

**After:** "An AI analyst that briefs you every Monday morning. It knows your business, remembers what it told you last week, and gets better every time you tell it what matters."
→ Product. No one else does this.

---

## Next Steps

### Immediate (Phase 4)
1. **Feedback Data Model** (Task 4A) - Create `agent_feedback` table
2. **Feedback UI** (Task 4B) - Add feedback controls to Report Viewer
3. **Feedback → Tuning Pipeline** (Task 4C) - Convert feedback to tuning pairs
4. **Feedback API Endpoints** (Task 4E) - POST/GET/DELETE endpoints
   - Tuning injection (Task 4D) already complete from Phase 1

### After Phase 4
5. **Run migrations:** Execute all 3 migrations (075, 077, 078) in production
6. **Phase 5 (Dogfood):** Set up 4 agents, run for 1 week, test feedback loop
7. **Polish:** Fix issues discovered during dogfooding
