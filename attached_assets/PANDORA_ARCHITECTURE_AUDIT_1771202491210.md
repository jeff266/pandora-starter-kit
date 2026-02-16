# Pandora Architecture Audit — What's Built vs. What's Spec'd

**As of: February 15, 2026**

---

## Data Platform (Foundation)

| Component | Status | Notes |
|-----------|--------|-------|
| Multi-tenant PostgreSQL (Neon) | ✅ Built | Workspace-scoped, all tables have workspace_id |
| Workspaces, auth, workspace selector | ✅ Built | |
| Credential encryption at rest | ✅ Built | Biggest trust blocker resolved |
| LLM routing (capability-based) | ✅ Built | Claude for synthesis, DeepSeek for classification |
| Token budget tracking + monthly resets | ✅ Built | |

---

## Connectors (Data Ingestion)

| Component | Status | Notes |
|-----------|--------|-------|
| HubSpot (OAuth + sync) | ✅ Built | Frontera: 691 deals, 46K contacts, 17K accounts |
| Salesforce (OAuth + sync) | ✅ Built | Imubit: 247 deals worth $148.8M |
| Gong (API + sync) | ✅ Built | 66 calls synced for Frontera |
| Fireflies (API + sync) | ✅ Built | 21 calls synced |
| File Import (CSV) | ✅ Built | Render test data, consultant use case |
| Cross-entity linker | ✅ Built | 20/22 Gong calls matched to accounts, 12 to deals |
| Otter.ai (via Zapier webhook) | ❌ Spec'd | Generic webhook endpoint designed, not built |
| PM tools (Monday, Asana, Linear, Jira) | ❌ Spec'd | Monday connector partially ported from Copilot |
| Connection Health Center | ❌ Spec'd | Sync logs exist, no dedicated health UI |

---

## Normalized Entity Tables

| Table | Status | Notes |
|-------|--------|-------|
| deals | ✅ Built + populated | |
| contacts | ✅ Built + populated | |
| accounts | ✅ Built + populated | |
| conversations | ✅ Built + populated | Gong + Fireflies data |
| activities | ✅ Built + populated | |
| deal_stage_history | ✅ Built + populated | |
| quotas | ✅ Built | Quota upload with AI mapping |
| stage_mappings | ✅ Built | Stage normalization |
| deal_contacts | ✅ Built + populated | Buying committee with Apollo enrichment |
| account_signals | ✅ Built + populated | Serper signals classified by DeepSeek |
| icp_profiles | ✅ Migrated | Empty — ICP Discovery hasn't written to it yet |
| lead_scores | ✅ Migrated | Empty — Lead Scoring hasn't persisted yet |
| findings | ✅ Built + populated | 661 findings from 43 skill runs, 163 active |
| skill_runs | ✅ Built + populated | Full run history with result_data |
| sync_log | ✅ Built | |
| deal_insights | ✅ Built + populated | DeepSeek extraction from conversations |

---

## Skills (Tier 1 — Production)

| Skill | Status | Notes |
|-------|--------|-------|
| Pipeline Hygiene | ✅ Production | 11 steps, three-phase AI pattern |
| Single-Thread Alert | ✅ Production | |
| Data Quality Audit | ✅ Production | |
| Pipeline Coverage by Rep | ✅ Production | |

## Skills (Tier 2+ — Built but less tested)

| Skill | Status | Notes |
|-------|--------|-------|
| Deal Risk Review | ✅ Built | |
| Rep Scorecard | ✅ Built | |
| Forecast Rollup | ✅ Built | |
| Velocity Alerts | ✅ Built | |
| Weekly Recap | ✅ Built | |
| Forecast Review | ✅ Built | |
| ICP Discovery (descriptive mode) | ✅ Built | Not yet consuming enrichment data |
| Lead Scoring (point-based v1) | ✅ Built | Not yet consuming ICP weights |
| Contact Role Resolution | ✅ Built | |
| Conversation Intelligence | ✅ Built | 4-tier graceful degradation |
| Workspace Config Audit | ✅ Built | 8 drift checks, biweekly schedule |

## Skills — Not Built

| Skill | Status | Notes |
|-------|--------|-------|
| Closed Deal Enrichment | ❌ Spec'd | Apollo + Serper + LinkedIn orchestration |
| ICP Discovery (point-based, regression modes) | ❌ Spec'd | Descriptive only today |

---

## Workspace Configuration Layer

| Component | Status | Notes |
|-----------|--------|-------|
| WorkspaceConfig schema + types | ✅ Built | Pipelines, win rate, teams, thresholds, etc. |
| Default config factory | ✅ Built | |
| WorkspaceConfigLoader singleton | ✅ Built | All skills read from this |
| Config CRUD API (GET/PUT/PATCH/DELETE) | ✅ Built | |
| ConfigAssumptions tracker | ✅ Built | Surfaces low-confidence values |
| Bootstrap Inference Engine (12-source) | ✅ Built | Auto-populates on first sync |
| Drift detection | ✅ Built | Runs on subsequent syncs |
| ConfigSuggestion type + storage | ✅ Built | Skill-generated suggestions |
| Suggestion CRUD API (list/accept/dismiss) | ✅ Built | |
| Skill feedback signals (10 skills) | ⚠️ Partial | Parking lot detection, stale threshold calibration done. Strategic subset of skill refactors complete. |
| Voice/Tone system (detail_level, framing, alert_threshold) | ⚠️ QA phase | Infrastructure built, needs tuning for VP-level tone |

---

## Command Center (Frontend)

### Phase A — Backend APIs

| Component | Status | Notes |
|-----------|--------|-------|
| Findings table + migration | ✅ Built | 7 specialized extractors |
| Auto-extraction from skill runtime | ✅ Built | Every completed run populates findings |
| Historical backfill | ✅ Built | 661 findings from 43 runs |
| GET /findings (paginated, filterable) | ✅ Built | |
| GET /findings/summary | ✅ Built | SQL GROUPING SETS |
| GET /pipeline/snapshot | ✅ Built | Annotated with findings |
| Deal dossier assembler | ✅ Built | Health signals: activity, threading, velocity, completeness |
| Account dossier assembler | ✅ Built | |
| POST /analyze (scoped analysis) | ✅ Built | Rate limited 10/min, token tracking |

### Phase B — Frontend UI

| Component | Status | Notes |
|-----------|--------|-------|
| Shell + sidebar navigation | ✅ Built | Dark SaaS theme from pandora-platform.jsx |
| Workspace selector | ✅ Built | |
| Command Center home page | ✅ Built | Metrics row, pipeline chart, findings feed |
| Annotated pipeline chart | ✅ Built | Flags on stages, click to expand |
| Deal list page | ✅ Built | Filterable, sortable |
| Deal detail page | ✅ Built | Full dossier with Ask Pandora |
| Account list page | ✅ Built | |
| Account detail page | ✅ Built | Contact map, conversation timeline |
| Connectors page | ✅ Built | Status, sync-now, health indicators |
| Skills page | ✅ Built | Run history, manual trigger |
| Insights Feed | ✅ Built | Chronological findings stream |
| Connector Health page | ❌ Not built | Dedicated health detail view |
| Settings page | ❌ Not built | Voice controls, token budget, scheduling |
| Data Dictionary page | ❌ Not built | |
| Playbooks page | ❌ Not built | Skill sequence config (Phase C) |
| Actions queue | ❌ Not built | Resolve/snooze/assign on findings (Phase C) |
| Members page | ❌ Not built | |

---

## Seven-Layer Evidence Architecture

| Layer | Name | Status | Notes |
|-------|------|--------|-------|
| Layer 1 | Skills + Evidence | ✅ Built | Skills produce SkillEvidence, stored in skill_runs |
| Layer 2 | Agents (multi-skill orchestration) | ❌ Not built | No agent that composes multiple skills into one run |
| Layer 3 | Dimension Discovery | ❌ Not built | Determines what a deliverable should contain |
| Layer 4 | Template Assembly | ❌ Not built | Builds skeleton matrix from Discovery output |
| Layer 5 | Cell Population | ❌ Not built | Fills every cell (static/config/computed/synthesize) |
| Layer 6 | Renderers | ⚠️ Partial | Slack formatter exists. XLSX, PDF, PPTX not built. |
| Layer 7 | Channels | ⚠️ Partial | Slack posting works. Email, CRM writeback, file download not built. |

**Summary:** Layer 1 is production. Layers 2-5 are fully spec'd with build prompts written but not executed. Layer 6-7 have Slack working, everything else spec'd.

---

## Conversational Agent (7-Layer Message Pipeline)

This is the chat/Slack conversational system — completely separate from the Evidence Architecture layers above.

| Layer | Name | Status | Notes |
|-------|------|--------|-------|
| Layer 1 | Inbound Message + Thread Awareness | ❌ Not built | Message arrives, identify surface, load thread context |
| Layer 2 | Thread-Aware Router | ❌ Not built | Classify turn type (follow-up, focus shift, scope escalation) |
| Layer 3 | Data Strategy | ❌ Not built | Determine what data to fetch (use_anchor, run_query, cross_skill) |
| Layer 4 | State Management | ❌ Not built | DeepSeek extracts structured state from conversation |
| Layer 5 | Context Assembly | ❌ Not built | Token-budgeted prompt construction (~6K total) |
| Layer 6 | Response Generation | ❌ Not built | Claude call with assembled context |
| Layer 7 | Persist + Deliver | ❌ Not built | Write to conversations table, deliver to surface |

### Supporting Infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| conversations table (chat messages) | ❌ Not built | Append-only log of all turns |
| conversation_state table | ❌ Not built | Compact structured state per thread |
| thread_anchors table | ❌ Not built | Links Slack messages to skill_runs that produced them |
| Heuristic-first router (zero-token classification) | ❌ Not built | Handles 30-40% of turns without LLM |
| DeepSeek state extraction | ❌ Not built | Updates structured state per turn |
| Data retrieval strategies (5 types) | ❌ Not built | use_anchor, scope_to_entity, run_query, cross_skill, no_data |
| Slack thread reply handler | ❌ Not built | |
| Slack DM handler | ❌ Not built | |
| In-app sidebar chat | ❌ Not built | |
| Suggested prompts (pre-routed) | ❌ Not built | |
| Rate limiting (Layer 3 calls only) | ❌ Not built | 10 req/hour per workspace |

### Build Prompts Written

| Prompt | Status | Notes |
|--------|--------|-------|
| 1. Migration + Schemas | ✅ Written | Tables, CRUD, thread anchor recording |
| 2. Router | ✅ Written | Heuristic-first, DeepSeek fallback, entity extraction |
| 3. Context Assembler | ✅ Written | Data retrieval, state extraction, orchestrator |
| 4. Thread Reply Handler | ✅ Written | Slack + in-app wiring |
| 5. Architecture Reference | ✅ Written | Full ASCII diagram, 5 scenarios, token budgets |

**Summary:** Fully designed with 5 build prompts ready. Zero code built. The `/analyze` endpoint exists but doesn't go through the router — everything hits Layer 3 (expensive) even for Layer 1 (free) questions.

---

## Feedback & Learning System (Proposed Today)

| Component | Status | Notes |
|-----------|--------|-------|
| workspace_annotations table | ❌ Not built | Entity annotations from chat corrections |
| Feedback signal taxonomy (6 types) | ❌ Designed | Dismiss, thumbs down, thumbs up, confirm, correct, dismiss velocity |
| Thumbs up/down on responses | ❌ Not built | Quality signal for voice tuning |
| Confirmation detection ("that's right") | ❌ Not built | Validates thresholds |
| Correction detection ("actually...") | ❌ Not built | Creates workspace annotations |
| Dismiss velocity tracking | ❌ Not built | Feeds alert_threshold ConfigSuggestion |
| Product Owner dashboard (Workspace Learning) | ❌ Not built | Annotation counts, feedback signals, config suggestions, learning rate |
| Annotation expiry (90 days default) | ❌ Not built | |
| ConfigSuggestion from chat feedback | ❌ Not built | Pattern detection → threshold proposals |

**Summary:** Taxonomy designed in this conversation. No code. ConfigSuggestion infrastructure exists from Workspace Config Prompt 3, but chat-originated suggestions are new.

---

## Enrichment Pipeline

| Component | Status | Notes |
|-----------|--------|-------|
| Apollo API integration | ✅ Built | Contact enrichment with verified seniority |
| Serper API integration | ✅ Built | Account signal discovery |
| DeepSeek signal classification | ✅ Built | Categorizes Serper results |
| Contact Role Resolution | ✅ Built | Buying committee mapping |
| Closed Deal Enrichment orchestration | ✅ Built | Chains Apollo → Serper → classify |
| ICP Discovery consuming enrichment | ❌ Not wired | Skill exists but doesn't read deal_contacts/account_signals |
| Lead Scoring consuming ICP weights | ❌ Not wired | Skill exists but doesn't read icp_profiles |

---

## Slack Integration

| Component | Status | Notes |
|-----------|--------|-------|
| Webhook posting (skill results) | ✅ Built | Skills post formatted messages |
| Slack formatter | ✅ Built | Per-skill formatting |
| Drill-deal handler | ✅ Built | Returns dossier data in thread |
| Action buttons (resolve, snooze, assign) | ❌ Not built | Spec'd, deferred |
| Thread reply handler (conversational) | ❌ Not built | Needs conversational agent |
| DM handler | ❌ Not built | Needs conversational agent |
| Slash commands (/pandora run, ask, export) | ❌ Not built | |

---

## Other Infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| Skill cron scheduler | ✅ Built | Configurable per-skill schedules |
| Startup optimization (1.3s, health probes) | ✅ Built | |
| Deploy settings | ❌ Not built | |
| Push API (outbound webhooks) | ❌ Not built | Next after Command Center per roadmap |
| Agent Builder (with visible tradeoffs) | ❌ Not built | Token cost meter, conflicts, alert fatigue, focus score |
| CRM writeback | ❌ Not built | Custom fields for ICP score, lead grade, risk flags |
| Email digest/reports | ❌ Not built | |
| RBAC / multi-user | ❌ Not built | Single workspace admin for now |

---

## Summary Scorecard

| Domain | Built | Spec'd | % Complete |
|--------|-------|--------|------------|
| Data Platform | 5/5 | — | 100% |
| Connectors | 6/9 | 3 remaining | 67% |
| Entity Tables | 14/14 | — | 100% (2 empty) |
| Skills | 15/17 | 2 remaining | 88% |
| Workspace Config | 9/11 | 2 remaining | 82% |
| Command Center Backend | 9/9 | — | 100% |
| Command Center Frontend | 11/17 | 6 remaining | 65% |
| Evidence Architecture (L1-7) | 1/7 | 6 remaining | 14% |
| Conversational Agent (L1-7) | 0/7 | 7 remaining | 0% |
| Feedback System | 0/9 | 9 remaining | 0% |
| Enrichment Pipeline | 5/7 | 2 remaining | 71% |
| Slack Integration | 3/7 | 4 remaining | 43% |

**Overall: The data platform, skills, and Command Center are solid. The conversational agent and feedback system are fully designed but unbuilt. The evidence architecture (Layers 2-7) for deliverable generation is the biggest structural gap.**
