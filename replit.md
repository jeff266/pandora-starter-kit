# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant, agent-based Go-To-Market (GTM) intelligence platform designed for RevOps teams. It integrates and normalizes GTM data from various sources such as CRM, call intelligence, task management, and document repositories into eight core entities. The platform leverages AI to generate actionable insights, aiming to enhance decision-making, refine GTM strategies, and improve overall business vision and market potential.

## User Preferences
- Raw SQL with parameterized queries — no ORM
- Minimal dependencies — only install what's needed
- Full control over database queries (complex joins, window functions, aggregations)
- Multi-tenant first — every table scoped by `workspace_id`

## System Architecture
Pandora is built on Node.js 20 with TypeScript 5+, utilizing Express.js and PostgreSQL (Neon) via the `pg` client with raw SQL.

**Core Architectural Patterns:**
-   **Multi-Tenancy:** Strict data isolation enforced by `workspace_id`.
-   **Universal Adapter Pattern:** Standardizes data ingestion from diverse connectors.
-   **Data Normalization:** Transforms raw data into 8 core entities: `deals`, `contacts`, `accounts`, `activities`, `conversations`, `tasks`, `calls`, and `documents`.
-   **Context Layer:** A `context_layer` table, unique per workspace, stores business context in 5 JSONB sections for personalized AI analysis.
-   **Skill Framework:** A registry and runtime for AI-powered skills, employing a COMPUTE → CLASSIFY → SYNTHESIZE pattern with a three-tier AI system.
-   **Computed Fields Engine:** Orchestrates batch computations for various scores (e.g., `velocity_score`, `deal_risk`, `engagement_score`). Processes deals in batches of 50 with GC yields between batches. Post-sync compute deferred by 5 seconds to avoid overlap with sync I/O. Composite scoring uses `hasConversations` boolean for correct degradation states (`crm_only`, `no_findings`, `no_conversations`, `full`). Batch risk scores and conversation checks are pre-computed before the deal loop to minimize per-deal queries.
-   **Sync Infrastructure:** Supports scheduled and manual asynchronous data synchronizations.
-   **Agent Runner Framework:** Composes multiple skills into unified briefings, synthesizing outputs into narratives.
-   **Conversational Agent:** Multi-turn AI chat with three-tier routing (heuristic→DeepSeek→Claude), unified orchestrator, thread anchoring, and structured state management. Includes implicit feedback detection and token optimization for efficiency.
-   **Feedback & Learning System:** `workspace_annotations` and `feedback_signals` tables capture entity-level knowledge from user interactions, influencing skill synthesis, chat context, and generating configuration suggestions.
-   **Quota Management System:** Manages per-rep quota targets with period tracking, supporting manual, CSV/Excel, or HubSpot Goals sync.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client and raw SQL for optimal performance and control.
-   **Data Storage:** Raw API data stored within a `source_data JSONB` column in entity tables.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` for efficient data synchronization.
-   **LLM Integration:** Anthropic Claude for reasoning/generation, and Fireworks DeepSeek for extraction/classification, with token guardrails.
-   **Cross-Entity Linker:** Post-sync batch job resolves foreign keys between entities.
-   **ICP Enrichment Pipeline:** 6-step pipeline for closed deal analysis, including Apollo API enrichment and Serper Google search.
-   **Slack App Infrastructure:** Dual-mode `SlackAppClient`, signature verification, API endpoints, thread anchoring, message tracking, and channel configuration.
-   **Scoped Analysis Engine:** AI-powered "ask about this entity" with 4 scope types (deal, account, pipeline, rep), utilizing compact text context compressors and returning structured `AnalysisResult` with confidence and follow-ups.
-   **Dossier Assemblers:** Enhanced deal and account dossiers with enrichment sections, engagement tracking, relationship health metrics, and optional Claude narrative synthesis. Deal narrative context includes conversation signals (keyword hits with points) and summaries from the 3 most recent conversations (HTML-stripped, 1200-char aggregate budget) so Claude can lead with recent call substance rather than defaulting to stall narratives. Deal narratives persist to `deals.narrative`/`narrative_actions`/`narrative_generated_at` columns, surviving page refreshes. Persisted narrative is also injected as "DEAL SUMMARY" context into scoped analysis (Ask about this deal) so follow-up questions are aware of the summary's conclusions.
-   **Entity Q&A History:** `chat_sessions` table with `entity_type`/`entity_id` columns (migration 084) enables persistent per-deal and per-account Q&A history. Messages (including `follow_up_questions` in metadata) persist across page refreshes. Shared `renderMarkdown` utility (`client/src/lib/render-markdown.tsx`) handles bold formatting across AnalysisModal, ScopedAnalysis, AccountDetail, and DealDetail.
-   **Command Center (Backend):** Backend API for findings extraction, dossier assembly, scoped analysis, findings management, pipeline snapshots, and connector status.
-   **Actions Queue:** Manages the full lifecycle of actions with status tracking, approval workflows, CRM write-back, and automatic expiry.
-   **Playbooks System:** Defines skill pipelines, tracks run statistics, and visualizes execution phases.
-   **Command Center (Frontend):** React + TypeScript UI featuring authentication, dashboard with pipeline visualization, entity lists, detail pages, skills management, connectors page, insights feed, and responsive UI elements. Includes demo mode for anonymization of sensitive data.
-   **Consultant Dashboard (Multi-Workspace):** Cross-workspace portfolio view for consultants, providing aggregated pipeline, findings, actions, connectors, and skill run data with urgency indicators. Includes unassigned calls triage.
-   **Consultant Call Intelligence (Frontend):** Connector setup for multi-workspace users to integrate call intelligence platforms like Fireflies.
-   **Push Delivery System:** Manages configurable delivery channels (Slack/Email/Webhook) and rules with various triggers and templates, logging delivery status.
-   **Voice & Tone System:** Per-workspace voice configuration (detail_level, framing, alert_threshold) dynamically injected into skill synthesis prompts.
-   **Brief-First Architecture (Coaching Intelligence V2):** `weekly_briefs` table is the primary surface for the Assistant view. One brief per workspace per day, assembled at 7 AM via cron. Four brief types driven by editorial logic: `monday_setup` (full 5-section), `pulse` (Tue–Thu delta since Monday), `friday_recap` (week summary), `quarter_close` (≤14 days left, attainment-first). `brief-resolver.ts` answers 10 question patterns from cache before any LLM call (0 tokens). Skill routing rebuilt on `answers_questions` registry metadata — `inferPrimarySkill()` scores skills by substring match count, no hardcoded regex. AssistantView redesigned to render brief sections with editorial awareness: `open_sections` auto-expand, `suppress` hides sections entirely, `highlight_reps/deals` surface amber-bordered cards. 8 new frontend components: `BriefSection`, `TheNumberCard`, `WhatChangedCard`, `SegmentsCard`, `RepsCard`, `DealsToWatchCard`, `SendBriefDialog`, `BriefEmptyState`.
-   **WorkbookGenerator:** Provides multi-tab `.xlsx` export services for skill and agent runs.
-   **Monte Carlo Forecast (Pipeline-Aware):** 10,000-iteration probabilistic revenue forecast skill with P10–P90 ranges, quota probability, and variance driver ranking, adaptable per pipeline type.
-   **Editorial Synthesis Engine (Phase 1):** Single Claude call produces holistic briefings with editorial decisions (lead_with, promote_finding, merge_sections, drop_section). Routes via `agent_id` on report templates — with agent → editorial path, without → static section-generator path.
-   **Conversation Detail Page (Executive-First Refactor):** `client/src/pages/ConversationDetail.tsx` restructured into three-tier layout matching Deal Detail: Tier 1 = compact header with participant avatars (color-coded internal/external) + deal context strip + AI Call Intelligence narrative hero (auto-rendered from `conversation.summary` or client-side structured fallback); Tier 2 = tabbed insights — "Deal Impact" (impact cards + engagement snapshot tiles + composite verdict), "Action Items" (interactive checkboxes + priority badges), "Coaching Signals" (retrospective banner + horizontal coaching script card + pattern signals); Tier 3 = collapsed accordions — Stage Journey (moved from tab), Participants + absent contacts (moved from sidebar), Skill Findings (new — previously never rendered), Call Metrics (moved from Coaching tab), Source link. `coaching_mode === 'hidden'` fully hides the Coaching tab. All `colors.background` and `colors.blueSoft` invalid theme tokens removed throughout file.
-   **Win-Pattern Coaching Engine:** Data-driven coaching signals derived from closed-won vs closed-lost deal analysis. `server/coaching/win-pattern-discovery.ts` analyzes 12+ dimensions (sales cycle days, call count, talk ratios, stage regressions, contact count, etc.) across deal-size segments using IQR-based separation scoring. Patterns stored in `win_patterns` table (migration `106_win_patterns.sql`) with supersession support for weekly refresh. `server/coaching/coaching-signals.ts` compares active deal metrics against stored patterns and generates `action`/`positive`/`warning` signals surfaced in the Conversation Detail "Coaching Signals" tab. Discovery triggered via `POST /:workspaceId/actions/discover-win-patterns`. Known data note: Frontera Health has thin conversation-linked data (28 won / 5 lost with conversations vs 107/218 total closed), so conversation-based dimensions (talk ratio, call duration) are skipped in favor of CRM-based patterns (sales_cycle_days is the primary signal with 0.33–0.61 separation scores across 3 size segments). Both query files had two bugs fixed: wrong `from_stage_normalized`/`changed_at` column names (actual schema: `stage_normalized`/`entered_at`/`exited_at`) and invalid `GROUP BY true` syntax.
-   **Agent Templates + Builder (Phase 2):** 5 pre-built briefing templates (Monday Pipeline, Forecast Call Prep, Friday Recap, Board Meeting Prep, QBR) with `AgentBriefingConfig` defining audience, focus_questions, data_window, output_formats, and schedule. Agent Builder UI with template gallery, audience/vocabulary/focus questions/data window/schedule/formats tabs. Editorial synthesizer injects audience role, detail level, vocabulary preferences, focus questions, and data window into Claude prompt.
-   **Self-Reference Memory (Phase 3):** Two-tier bounded memory system (600-1200 tokens fixed ceiling). Tier 1: `AgentRunDigest` — compressed summary of last run (headlines, deals flagged, metrics, actions). Tier 2: `AgentMemory` — rolling patterns across runs (recurring flags capped at 30, deal history capped at 20 with 5 mentions each, metric trends capped at 8 data points per series, predictions capped at 10). Memory injected into editorial synthesis prompt between tuning and evidence. Agent references previous briefings: "I flagged X last week", "This is the 3rd time I've flagged Y", metric trends. Stored in `agent_memory` table + `report_generations.run_digest` column.
-   **Slack Notification Controls:** Centralized notification gateway (`server/notifications/`) with 13 notification categories, per-workspace preferences (stored in `workspaces.settings` JSONB), delivery modes (realtime/digest/smart), quiet hours with timezone support, per-category enable/disable + threshold filters (min_score_change, min_score_tier, max_per_run), pause/resume functionality, and digest queue (`notification_queue` table) with scheduled flushing every 15 min. All major Slack send points (account scorer, skills, agents/runtime, actions, agent channels) route through the `sendNotification` gateway which evaluates preferences before dispatching. Settings UI in the Notifications tab under workspace admin settings.
-   **Named Filters System:** Workspace-scoped business concept definitions (e.g., "MQL", "Expansion Deal", "At Risk") stored in `workspace_config.named_filters`. `FilterResolver` class (`server/tools/filter-resolver.ts`) compiles structured `FilterConditionGroup` conditions to parameterized SQL with cross-object EXISTS subqueries, relative date support, and all operators. 5 default filters (open_pipeline, new_logo, stale_deal, closing_this_quarter, at_risk). Wired into all query tools (deal, contact, account, conversation) via `named_filter`/`named_filters` params in `tool-definitions.ts`. CRUD API (`/filters` endpoints) with preview/resolve and confirm. Evidence contract (`AppliedFilterEvidence`) tracks filter metadata through skill runs. Scope notice injected into Claude synthesis prompts when filters are active. Agent Builder "Scope Filters" tab allows selecting named filters per agent. Usage tracked in `filter_usage_log` table.
-   **Workspace Lens:** Global data filtering via `X-Pandora-Lens` header. Lens middleware (`server/middleware/lens.ts`) reads header and attaches to request. `resolveLens()` in data routes compiles lens filter ID to SQL via FilterResolver and injects as `additionalWhere`/`additionalParams` into deals, contacts, accounts, and conversations list queries. Frontend `LensContext` (`client/src/contexts/LensContext.tsx`) manages active lens state with sessionStorage persistence. `LensDropdown` in TopBar allows selecting named filters as workspace-wide data lens. API client (`client/src/lib/api.ts`) automatically includes lens header on all requests. Core pages (CommandCenter, DealList, AccountList) re-fetch data when lens changes.

-   **Forecast Page:** Longitudinal forecast tracking dashboard at `/forecast`. Header with AI toggle and week counter. 5 metric cards (MC P50, Closed Won, Gap to Quota, MC Range, Pipe Gen) with WoW delta. SVG line chart with 4 toggleable forecast lines (stage-weighted, category-weighted, MC P50, attainment), confidence band (P25-P75), and quota line. Chart insights sidebar for chart-anchored annotations. Rep breakdown table with sortable columns and inline rep annotations. Coverage bars by quarter with 3x target marker. Pipe gen trailing 8-week bar chart. Deal drill-down slide-out panel. Graceful degradation for 0/1/2+ snapshots. Data from `GET /api/workspaces/:id/forecast/snapshots` (extracts from `skill_runs.result` for forecast-rollup). Command Center shows compact AI Alerts (max 3 critical/warning) with "View all insights →" link to Forecast page.
-   **Public Homepage & Waitlist:** Dark-themed landing page (`PandoraHomepage.tsx`) with animated SVG eye logo, hero, stats counters, before/after comparisons, integration flow diagram, cadence grid, practitioner credibility section, and waitlist CTA. Waitlist API (`/api/waitlist`) stores signups in `waitlist` table, adds to Resend audience (if `RESEND_AUDIENCE_ID` configured), and sends welcome email via Resend. Unauthenticated visitors see homepage; `/login` path shows login page; authenticated users see the app.

-   **Coaching Intelligence V2 — Command Center Gap-Fills:**
    - T001: `total_open_deals` unfiltered count added to pipeline snapshot; `openDealsCount` in CommandCenter uses `pipeline?.total_open_deals ?? pipeline?.total_deals`.
    - T002: Unicode en-dash `–` in DealList.tsx pagination fixed (literal `–` char).
    - T003: One-at-a-time Show Math enforcement — `MetricCard` uses `isExpanded`/`onToggle` props; `MetricsRow` forwards `activeMetric`/`onMetricToggle`; `CommandCenter` holds `activeMetric` state.
    - T004: Skill filter pills dynamically fetched from `/api/workspaces/:id/skills`.

-   **Coaching Intelligence V2 — Assistant View:**
    - DB migration `121_view_preference.sql`: adds `workspace_members.preferred_view` and `workspaces.default_view` columns.
    - New route `server/routes/view-preference.ts`: GET/PUT `/view-preference` (per-member) + PUT `/settings/default-view` (workspace-wide).
    - New route `server/routes/briefing.ts`: three endpoints — `/briefing/greeting`, `/briefing/brief`, `/briefing/operators`.
    - New `server/briefing/` module: `greeting-engine.ts` (SQL-only greeting + severity payload), `brief-assembler.ts` (findings → BriefItem[] with operator metadata), `operator-status.ts` (agent run health status).
    - New route `server/routes/conversation-stream.ts`: POST `/conversation/stream` — SSE stream with recruiting events, agent_thinking/found/done, Anthropic synthesis streaming, evidence cards, deliverable options.
    - Sidebar: `mode` + `onModeChange` props; segmented "VIEW" toggle (✦ Assistant / ▦ Command) rendered above collapse button when not collapsed.
    - App.tsx: `activeView` state initialized from localStorage; `handleViewChange` saves to localStorage + calls PUT `/view-preference`; `<Sidebar>` receives mode props; `/` route renders `<AssistantView />` or `<CommandCenter />` based on `activeView`.
    - `client/src/pages/AssistantView.tsx`: home/conversation view state; fetches greeting/brief/operators; renders `<Greeting>`, `<QuickActionPills>`, `<MorningBrief>`, `<OperatorStrip>`, `<StickyInput>`; transitions to `<ConversationView>` on send.
    - `client/src/components/assistant/`: Greeting, QuickActionPills, MorningBrief, OperatorStrip, StickyInput, AgentChip, EvidenceCard, ActionCard, DeliverablePicker, useConversationStream, ConversationView.
    - CommandCenter: slim greeting bar at top (fetches `/briefing/greeting`; shows headline + state_summary + two quick-action buttons that open Ask Pandora drawer).

-   **Autonomous Skill Governance Layer (Phase 2):** Safety system between self-heal suggestions and deployed changes. Five governance agents:
    - **Shape Validator** (`server/governance/shape-validator.ts`): structural/syntax checks per change_type (resolver_pattern, workspace_context, named_filter, skill_definition). Validates regex syntax, test_inputs match, field names against `information_schema`, injection_point values.
    - **Review Agent** (`server/governance/review-agent.ts`): LLM quality review scoring 5 dimensions (specificity, evidence_strength, risk, clarity, reversibility). Auto-rejects if score < 0.3. Direct Anthropic SDK call.
    - **Explainer Agent** (`server/governance/explainer-agent.ts`): plain-English summary for VP Sales-level admin. summary always starts "Pandora will...", rollback_note fixed. Direct Anthropic SDK call.
    - **Comparison Engine** (`server/governance/comparison-engine.ts`): before/after test cases from `test_inputs` + source feedback original_questions. Judges per-case via LLM. Overall improvement score -1 to 1.
    - **Rollback Engine** (`server/governance/rollback-engine.ts`): `applyChange` writes to `context_layer.definitions` (dynamic_resolvers / injected_context / workspace_config.named_filters keys). `rollbackChange` reverts. `checkForAutoRollback` monitors feedback rate degradation.
    - **Pipeline** (`server/governance/pipeline.ts`): orchestrates all 5 agents in sequence; `buildPayloadFromSuggestion` converts raw self-heal suggestions to typed payloads.
    - **DB Helpers** (`server/governance/db.ts`): createGovernanceRecord, getGovernanceRecord, updateStatus (appends to status_history JSONB array), updateShapeValidation, updateReview, updateExplanation, updateComparison, updateSnapshot.
    - **Governance API** (`server/routes/governance.ts`): 8 endpoints — list (with status filter), history, get by id, approve (→ monitoring + 7-day trial), reject, rollback, delete, recompare.
    - **skill_governance table** (migration `124_skill_governance.sql`): full lifecycle tracking with 35+ columns covering all agent outputs, status_history JSONB array, trial/monitoring/rollback state.
    - **Self-heal wiring**: `agent-feedback.ts` review endpoint now fire-and-forgets `processGovernanceProposal` for each suggestion after returning the API response.
    - **Monitoring cron**: `server/index.ts` runs `checkForAutoRollback` every 6 hours across all active workspaces.
    - **Integration test results (2026-03-02):** All 8 routes verified — approve→monitoring→rollback flow end-to-end; review agent correctly rejects low-evidence auto-suggestions (score 0.26 < 0.3 threshold); status_history audit trail confirmed.

-   **Contextual Opening Brief (`server/context/opening-brief.ts`):** Synthesizes role-scoped pipeline data into a Claude-written greeting on every new conversation (no `thread_id` in POST body).
    - `computeTemporalContext(workspaceId)`: fiscal quarter/phase from `configLoader.getQuotaPeriod()`. Derives `weekOfQuarter`, `phase` (early/mid/late/final_week), `isWeekStart`, `isMonthEnd`, `dayOfWeek`.
    - `assembleOpeningBrief(workspaceId, userId)`: 14 parallel queries via `Promise.allSettled()` — workspace name, user name/email, role-scoped headline target, open pipeline totals, deals closing this week/month, new deals this week, period attainment (using actual quota period start), finding counts/top 3 findings, last skill run, movement since anchor (yesterday or last Friday on Mondays), deal stats (avg size/cycle for sales motion), conversation count. Attainment uses `quotaPeriod.start` (not 365-day fallback).
    - `buildDealScopeFilter(workspaceId, pandoraRole, workspaceRole, userEmail)`: CRO/RevOps/admin roles get full visibility; AE role scopes to `rep_name` matched via `sales_reps.rep_email`; null/unknown pandoraRole also gets full visibility.
    - `renderBriefContext()`: fills named template with all assembled data. Returns formatted context string prepended to the user's message.
    - `BRIEF_SYSTEM_PROMPT`: VP Sales-calibrated prompt with sales motion awareness and 1024 token budget.
    - 5-minute in-memory cache keyed by `workspaceId:userId`.
    - Wired into `conversation-stream.ts`: new conversations detected by `!thread_id` → brief assembled, prepended to message, routed directly through Anthropic with `BRIEF_SYSTEM_PROMPT`.

-   **TTE Survival Curve Engine + Monte Carlo Integration (Coaching Intelligence V2):**
    - `server/analysis/survival-curve.ts`: Kaplan-Meier algorithm with Greenwood variance, log-log CI, `conditionalWinProbability`, `expectedValueInWindow`, `getCumulativeWinRateAtDay`, `assessDataTier`, `emptyCurve`.
    - `server/analysis/survival-data.ts`: `fetchDealObservations` (schema-adapted: stage_normalized='closed_won', deal_outcomes JOIN for closed_at, d.owner), `buildSurvivalCurves` with source/owner/size_band/stage_reached segmentation, 6-hour in-memory cache, `invalidateSurvivalCache`.
    - `server/analysis/survival-rendering.ts`: `summarizeCurveForLLM` (~250-token checkpoint string), `buildCohortWinMatrix` with mature/developing cohort logic.
    - Monte Carlo swapped: `stageWinRates`/`BetaDistribution`/`fitStageWinRates` removed; `SimulationInputs.distributions` now uses `survivalCurve` + `stageCurves`; component A uses `conditionalWinProbability(curve, dealAgeDays)`; component B uses `expectedValueInWindow` at age 0.
    - `GET /api/workspaces/:id/survival-curve` endpoint with `requireWorkspaceAccess`; `survival-curve-query` registered in tool manifest with `summarizeCurveForLLM` output gating.
    - Survival curve context block added to forecast-rollup and pipeline-coverage synthesis prompts.
    - `weightedCoverageRatio` added to `RepCoverage`/`CoverageByRep` using `expectedValueInWindow`.

-   **RFM Behavioral Scoring Engine:**
    - `server/analysis/rfm-scoring.ts`: Pure SQL + arithmetic compute module (zero LLM tokens). `assessActivityCoverage` → mode selection (`full_rfm`/`rm_only`/`r_only`). `computeRawRFMValues` with LATERAL joins for recency (activity → conversation → stage_change → record_update priority), frequency (weighted: meeting=10/call=5/email=2 + conversation count), monetary (deal.amount). `computeQuintileBreakpoints` with tercile fallback for <10 deals. `assignRecencyQuintile` (inverted: lower days = better), `assignQuintile` (normal). `assignRFMGrade` (strategic A-F matrix), `assignRFMLabel` (action-oriented: "Big Deal at Risk", "Hot Opportunity", etc.). `computeHistoricalWinRatesByRFM` with T-30 snapshot reconstruction. `testRFMDiscrimination` (A/F lift check). `batchUpdateRFMScores` writes to deals table in 200-record batches. `computeAndStoreRFMScores` orchestrates full cycle. Evidence rendering: `renderRFMScoreCard`, `renderRFMComparison`, `renderRFMMethodology`, `buildRFMContextForLLM`.
    - DB columns added lazily via `ensureRFMColumns()`: `rfm_recency_days/quintile/source`, `rfm_frequency_count/quintile`, `rfm_monetary_quintile`, `rfm_segment`, `rfm_grade`, `rfm_label`, `rfm_mode`, `rfm_scored_at`.
    - Wired into `server/computed-fields/engine.ts`: `computeAndStoreRFMScores` runs after deals/contacts/accounts, non-fatal (logged as warning on failure).
    - `aggregateStaleDeals` now includes `rfmBreakdown` + `hasRFMScores` by grouping stale deals by rfm_grade.
    - `forecastRollup` tool now includes `rfmQuality` (per forecast-category: total/ab_count/ab_value/df_count/df_value + coldCommitPct).
    - Pipeline Hygiene synthesis prompt: RFM stale deal priority block (A/B/C/D/F grade counts + values + action instructions).
    - Forecast Rollup synthesis prompt: Behavioral quality of committed pipeline block (cold commit %, category breakdown).
    - Schema delta applied throughout: `stage_normalized NOT IN ('closed_won', 'closed_lost')` for open deals (no `is_closed` column); `d.owner` (not `owner_email`); activities use `timestamp` column (not `activity_date`); conversations use `call_date`.

-   **UX + Data Fixes (Coaching Intelligence V2):**
    - **Skill Queue**: `runningSkill: string | null` → `runningSkills: Set<string>` + `queuedSkills: string[]`. Skills now queue when one is already running; queued skills show amber "Queued" button state; queue drains sequentially on completion.
    - **Forecast "Go to Skills" button**: Replaced with "Generate First Forecast ▶" that runs `forecast-rollup` then `monte-carlo-forecast` inline, shows live status ("Running Forecast Rollup..." / "Running Monte Carlo Simulation..." / "Done — reloading forecast data..."), and refreshes snapshot data without navigation.
    - **forecastRollup excluded_owners filter**: `byRep` query now applies `excluded_owners` from business context (same pattern as `coverageByRep`), removing admin/test accounts like Jack McArdle and Carter McKay from rep breakdown table.

## TypeScript Health
- **Status (Feb 2026):** 0 non-test server errors maintained. All server files pass `tsc --noEmit`.
- **Remaining:** 4 errors in `server/workflows/__tests__/` test mocks + 1 duplicate property in `server/routes/findings.ts` — all pre-existing, out of scope.
- **Key patterns fixed:** Logger.error signature (LogContext not Error), Express 5 `req.params` cast as string, SkillExecutionContext/WorkspaceConfig interface gaps, SalesforceOpportunityFieldHistory type, duplicate imports (gong/hubspot), pptx-renderer docx type casts, replit_integrations `.js` import extensions, route handler `Request<any>` vs `Request<WorkspaceParams>`.

## Onboarding Interview System (V1)
-   **Architecture:** Hypothesis-first conversational setup at `/onboarding`. Pre-interview runs CRM scanner + Serper company research + inference engine in parallel before Q1.
-   **Backend:** `server/onboarding/` — types, crm-scanner, company-research, document-extractor, response-parser, config-writer, flow-engine, hypotheses/, questions/
-   **API Routes:** `POST/GET /api/workspaces/:id/onboarding/{start,state,answer,upload,skip,resume,complete}` mounted via `server/routes/onboarding.ts`
-   **Questions:** Tier 0 (Q1-Q4 + Q10): motions, calendar, stages, team, delivery. Tier 1 (Q5-Q9): stale thresholds, forecast method, win rate, coverage, required fields. Tier 2-3: scaffolded stubs.
-   **Hypothesis generators:** Each question shows CRM-derived tables (deal counts, amounts, stage distributions) as evidence. Pure functions in `server/onboarding/hypotheses/`.
-   **Config writes:** Q1 → `context_layer` (revenue_motions + onboarding_named_filters). Q2 → cadence config. Q3 → `stage_configs` flags (is_won, is_lost, is_parking_lot, is_stage_0). Q4 → teams config. Q5-Q9 → thresholds/config via context_layer.
-   **File upload:** multer 25MB, extracts PDF (pdf-parse), DOCX (mammoth), XLSX (SheetJS), images (Claude vision), TXT/MD. Parsed by Claude into new hypothesis.
-   **Frontend:** `client/src/pages/OnboardingFlow.tsx` + 6 components in `client/src/components/onboarding/`. Conversational thread UX, TierProgress bar, HypothesisCard with tables, ArtifactPreview.
-   **Integration:** New workspace creation navigates to `/onboarding`. Settings tab has "Re-run Setup Interview". Brief empty state shows setup prompt link.
-   **Not in V1:** Voice input, Google Drive scan, Tier 2-3 trigger wiring, multi-workspace consultant onboarding.

## External Dependencies
-   **PostgreSQL (Neon):** Primary database.
-   **HubSpot API:** CRM data.
-   **Gong API:** Call intelligence.
-   **Fireflies API:** Conversation intelligence.
-   **Monday.com API:** Task management.
-   **Google Drive API:** Document management.
-   **Anthropic AI (Claude):** AI reasoning and generation.
-   **Fireworks AI (DeepSeek V3):** AI classification and extraction.
-   **Apollo API:** Contact and company enrichment.
-   **Serper API:** Google search results for company signal intelligence.