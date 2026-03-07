# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant, agent-based Go-To-Market (GTM) intelligence platform designed for RevOps teams. It integrates and normalizes GTM data from various sources such as CRM, call intelligence, task management, and document repositories into eight core entities. The platform leverages AI to generate actionable insights, aiming to enhance decision-making, refine GTM strategies, and improve overall business vision and market potential.

## Security Architecture

### Authentication Model
- **Session JWT** (`Authorization: Bearer <token>`): standard user authentication; subject to full RBAC evaluation.
- **API Key** (`X-API-Key` header): workspace-scoped key for trusted integrations. By design, `requirePermission` skips the permission check when `req.authMethod === 'api_key'`. This is intentional — API keys represent pre-authorized integration contracts, not interactive users. Do not add permission guards specifically to block API key callers.

### Row-Level Security (RLS)
- PostgreSQL role `pandora_rls_user` enforces row-level security policies that restrict data access to the active `workspace_id`.
- Every SQL workspace execution path (both `/sql/execute` and `/sql/saved/:queryId/run`) must call `SET LOCAL ROLE pandora_rls_user` inside the transaction, immediately after setting `statement_timeout`. Omitting this step creates a cross-workspace data leak path.
- Implementation: `server/routes/sql-workspace.ts`.

### RBAC (Role-Based Access Control)
- Permission middleware: `requirePermission(key)` and `requireAnyPermission(keys[])` in `server/middleware/permissions.ts`.
- 33-key permission schema defined in `server/permissions/types.ts`. Three system roles: `admin`, `member`, `viewer`.
- Every mutating route in `workspaceApiRouter` must carry a `requirePermission` guard — workspace membership alone (enforced by `requireWorkspaceAccess`) is not sufficient.
- Role summaries and permission assignments: `server/permissions/system-roles.ts`.

### Prompt Injection Defense
- CRM-sourced strings (deal names, account names, contact names, annotation content, finding messages, conversation titles) must be sanitized before interpolation into AI prompts.
- Utility: `server/utils/sanitize-for-prompt.ts` — exports `sanitizeForPrompt(value: unknown): string`.
- Strips 14 injection patterns (case-insensitive) including `IGNORE PREVIOUS INSTRUCTIONS`, `<system>`, `[INST]`, `YOU ARE NOW`, etc., replacing matched text with `[REDACTED]`.
- Applied at: `server/analysis/scoped-analysis.ts` (deal + account context builders) and `server/agents/runtime.ts` (synthesis template variable substitution).
- Rule: any new code path that reads CRM field values into an AI prompt string must call `sanitizeForPrompt()` on the value.

## Model Management System

### LLM Router (`server/utils/llm-router.ts`)
- **Model catalog** `MODEL_CONTEXT_WINDOWS`: maps all known model IDs to their max context window size. Covers Claude Sonnet/Opus 4 (200K), Gemini 2.5 Pro + GPT-4.1 (1M), Flash (1M), DeepSeek R1/V3/V3.1 (128K), Perplexity Sonar variants (127K).
- **Context guardrail**: workspace-aware — looks up routed model's actual window, only overrides when input genuinely exceeds it. On overflow picks highest-capacity available model (prefers gemini-2.5-pro → claude → gpt-4.1 by window). Logs clearly: model requested, input size, override reason.
- **Google (Gemini)**: OpenAI-compatible via `https://generativelanguage.googleapis.com/v1beta/openai/`. Env var `GOOGLE_API_KEY`, also respects workspace BYOK key.
- **Perplexity**: OpenAI-compatible via `https://api.perplexity.ai`. Env var `PERPLEXITY_API_KEY`, also respects workspace BYOK key.
- **`keySource`**: `'pandora'` (platform key) or `'byok'` (workspace-provided key) — threaded through `TrackingContext` → `TokenRecord` → `token_usage.key_source` column.

### AI Keys Settings (`client/src/components/settings/AIKeysTab.tsx`)
- Provider key cards for Anthropic, OpenAI, Google (Gemini), Fireworks, Perplexity — each with toggle, masked input, Show/Hide, Save button, docs link.
- **Model Routing section**: two capability groups — "Reasoning & Generation" (Claude/Gemini 2.5 Pro/GPT-4.1/DeepSeek R1) and "Extraction & Classification" (DeepSeek V3/GPT-4o-mini/Gemini Flash/Perplexity Sonar). Each model card shows: context window badge, cost tier ($/$$/$$$$), strengths blurb, warning if provider key not connected. Single "Save Routing" button POSTs `{ routing: { reason, generate, extract, classify } }` to `/llm/config`.

## Customer Billing Metering

### Database
- `token_usage.key_source VARCHAR(10) DEFAULT 'pandora'` — added by migration `131_billing_meter.sql`.
- `billing_meter` table: per-workspace monthly aggregates with pandora/byok token splits, markup multiplier, customer charge, invoice workflow (pending → invoiced → paid/waived). Unique constraint on `(workspace_id, billing_period)`.

### Backend
- **`server/billing/meter.ts`**: `rollupBillingPeriod`, `rollupCurrentMonth`, `rollupAllWorkspaces`, `getAllWorkspaceMeter`. Upsert computes `customer_charge_usd = pandora_cost_usd * markup_multiplier`. Only updates rows with `invoice_status = 'pending'`.
- **`server/routes/billing-admin.ts`**: mounted at `app.use('/api/admin', requireAdmin, billingAdminRouter)`. Endpoints: `GET /billing`, `POST /billing/rollup`, `POST /billing/:id/invoice`, `POST /billing/:id/paid`, `POST /billing/:id/waive`, `POST /billing/:id/markup`, `GET /billing/export` (CSV).

### Admin UI (`client/src/pages/admin/BillingMeterPage.tsx`)
- Route: `/admin/billing`.
- Period picker (last 12 months), summary bar (8 KPI cards), workspace table with inline markup editing.
- Per-row action buttons: Invoice (opens modal for reference + notes), Mark Paid, Waive — contextual by status.
- Export CSV hits `/api/admin/billing/export?period=YYYY-MM`.

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
-   **Outbound Webhook Infrastructure:** Multi-endpoint `webhook_endpoints` table (migration 129) with per-endpoint 32-byte hex secrets, `enabled`/circuit-breaker state, and `event_types` filter. Delivery engine (`server/webhooks/delivery.ts`) posts HMAC-signed payloads via `signPayload` (from `push/formatters/webhook-formatter.ts`), with 3-attempt in-process retry (0/60s/300s delays), circuit breaker disabling endpoint at 10 consecutive failures, and full delivery logging to `webhook_endpoint_deliveries`. Service layer (`server/webhooks/service.ts`) handles CRUD with secret returned exactly once on creation. REST API at `/:workspaceId/webhook-endpoints` (5 routes). Retention cron deletes rows older than 30 days daily at 3 AM. Settings UI: Webhooks tab in admin settings (`/settings/webhooks`) with endpoint list, deliveries panel, add-form, and secret-reveal modal with copy-confirm flow. Six event types supported: `prospect.scored` (fires from `scoreLeads` for |scoreChange| ≥ 5, `server/webhooks/prospect-score-events.ts`), `deal.stage_changed` (fires from HubSpot + Salesforce sync after `recordStageChanges`, `server/webhooks/deal-events.ts`), `deal.flagged` (fires from skill runtime after `insertFindings` for severity `act`/`watch` with a deal_id, `server/webhooks/deal-events.ts`), `action.created` (fires from skill runtime after `insertExtractedActions`, `server/webhooks/action-events.ts`), `action.completed` (fires from `executeAction` in executor.ts when all CRM writes succeed, `server/webhooks/action-events.ts`), `action.expired` (fires from hourly expiry scheduler after batch UPDATE, `server/webhooks/action-events.ts`). All emitters are fire-and-forget dynamic imports — never block the calling path.
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

-   **Enterprise RFM Account Segmentation:** Account-level behavioral segmentation using three real-data dimensions: R (recency of last engagement, days since last activity or conversation), F (frequency = count of distinct contacts engaged in last 90 days), M (monetary = sum of open deal value vs workspace median). Each account is classified into one of 8 named segments: Champions, Going Dark, Underleveraged, Sleeping Giant, Single-Threaded Risk, Early Stage, Fading Interest, Dead Zone. Segment lookup table (`server/analysis/account-rfm.ts`) maps R×F×M → segment with action directive, signals text, playbook steps, emoji icon, priority, and color key. Migration `125_account_rfm_columns.sql` adds 8 new columns to `account_scores`. RFM is computed live in `GET /:id/accounts/:accountId/scores` (data.ts) and persisted async. Frontend: `AccountRFMSegment.tsx` card with left-border color, dimension badges (R↑/R↓), signals text, expandable playbook. Card renders at the top of `AccountScorecard.tsx`. `useScores.ts` extended with `rfmSegment` field. `AccountDetail.tsx` now includes `AccountScorecard` in the right sidebar column.

-   **Prospects Page — Tier 1 Point-Based Prospect Scoring:** `/prospects` (sidebar INTELLIGENCE section). Scores all workspace contacts using Fit/Engagement/Intent/Timing components (weights: 35/30/25/10). Fit = industry match (15), seniority (12), company size (10), department (8); Engagement = meeting activity (10), recency (10), CRM engagement score (10); Intent = has open deal (15), deal stage depth (10), buying role (8), multi-thread (5); Timing = account signal score (10), funding stage (5), hiring signals (5). Composite grade A=80+/B=60–79/C=40–59/D=20–39/F<20. Each factor emits contribution pts, direction, max_possible, category, explanation, and population/won-deal benchmarks (computed in a second pass across all scored contacts). Recommended actions: prospect/multi_thread/reengage/nurture/disqualify. `server/scoring/prospect-scorer.ts` → `runProspectScoring(workspaceId)`. DB: migration `126_prospect_score_extensions.sql` extends `lead_scores` with 14 new columns + creates `prospect_tree_models` and `prospect_score_history` tables. API: `server/routes/prospect-scores.ts` → `GET /:id/prospect-scores` (paginated, grade/action/search/sort filters, returns grade_distribution + stats), `POST /:id/prospect-scores/run`. Frontend: `client/src/pages/ProspectsPage.tsx` — ScoreRing (SVG arc), ComponentBar, FactorRow (benchmark row), ProspectRow, ProspectDetail with segment benchmarks + "Show Your Math" factor breakdown.

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

-   **Activity Signals Extraction Layer (Coaching Intelligence V2 — Phase 2):**
    - Two-pass extraction pipeline: Pass 1 = zero-cost email header parsing (untracked CC/BCC contacts); Pass 2 = DeepSeek V3.1 via Fireworks body classification (~$0.21/MTok blended).
    - `server/utils/activity-text.ts`: preprocessing utilities — `stripHtml` (block elements → space, entity decode), `stripReplyThreads` (removes `<blockquote>`, "On X wrote:" chains, `-----Original Message-----`), `parseEmailHeaders` (parses HubSpot-injected `To:/CC:/BCC:/Subject:/Body:` header block using `[^\S\n]*` regex to prevent cross-line capture), `classifyEmailParticipants` (inbound/outbound direction from To: domain), `cleanActivityBody`, `activityPreview`.
    - `server/signals/extract-activity-signals.ts`: `extractActivitySignals(workspaceId, { limit, force })` — batch processing, MEDDIC/BANT/SPICED framework awareness, DeepSeek prompt with signal schema, `maxTokens: 2000`, JSON parse guard (`Array.isArray(parsed.signals)`), writes to `activity_signals` + `activity_signal_runs` tables.
    - `server/signals/query-activity-signals.ts`: `queryActivitySignals(workspaceId, filters)` — filters by `deal_id`, `signal_type`, `framework_field`, `speaker_type`, `min_confidence`, `limit`; returns signals with activity metadata.
    - `activity_signals` table: one row per signal per activity. Columns: `signal_type` (framework_signal|notable_quote|blocker_mention|buyer_signal|timeline_mention|stakeholder_mention|untracked_participant), `framework_field` (MEDDIC/BANT/SPICED field name), `source_quote`, `speaker_type` (prospect|rep|unknown), `speaker_confidence`, `verbatim` bool, `confidence`, `extraction_method` (header_parse|deepseek).
    - `activity_signal_runs` table: one row per activity with `status` (completed|skipped|failed), `signals_extracted`, `tokens_used`, `skip_reason`. ON CONFLICT (activity_id) DO UPDATE.
    - `server/chat/data-tools.ts`: `query_activity_signals` chat tool wired to `queryActivitySignals`.
    - Bug fixes: `getRepDomain` changed from `users.workspace_id` (column doesn't exist) to `sales_reps.rep_email` with `user_workspaces JOIN users` fallback.
    - Operational scripts: `server/bulk-extract-signals.ts` (batch extraction for all workspaces), `server/retry-failed-signals.ts` (retry DeepSeek JSON failures after code fix).
    - Verification scripts: `server/test-activity-text.ts` (34/34), `server/test-signal-extraction.ts`, `server/test-query-signals.ts`, `server/test-t006-chat-integration.ts` (8/8).
    - Production state: ~7,000+ signals across email workspace deals; MPC deal has 206 framework signals, 69 timeline signals, 48 blockers, 26 notable quotes; bulk extraction ongoing.

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
    - `GET /api/workspaces/:id/survival-curve` endpoint with `requireWorkspaceAccess`; `survivalCurveQuery` tool registered in toolRegistry; returns `summarizeCurveForLLM` output (never raw step arrays).
    - Survival curve context block added to forecast-rollup and pipeline-coverage synthesis prompts.
    - `weightedCoverageRatio` added to `RepCoverage`/`CoverageByRep` using `expectedValueInWindow`.
    - **forecastRollup** bear/base/bull now TTE-derived: opens deals are fetched with `created_at`, `conditionalWinProbability` CI bounds compute `bearCase`/`bullCase`, `expectedValueInWindow` computes `baseCase`; CRM category sums retained as `crmBearCase`/`crmBaseCase`/`crmBullCase`.
    - **fmBuildForecastModel** static multipliers (0.7/0.5/1.2) replaced with survival curve CI bounds; `fmScoreOpenDeals` now includes `created_at` in scored deal output so `dealAgeDays` is available.
    - **Cache pre-warming**: both `handleSyncJob` and `handleSalesforceSyncJob` in `server/jobs/queue.ts` call `prewarmSurvivalCache()` after sync completes (fire-and-forget); pre-warms 4 segmentations: none, stage_reached, source, owner.

-   **RFM Behavioral Scoring Engine:**
    - `server/analysis/rfm-scoring.ts`: Pure SQL + arithmetic compute module (zero LLM tokens). `assessActivityCoverage` → mode selection (`full_rfm`/`rm_only`/`r_only`). `computeRawRFMValues` with LATERAL joins for recency (activity → conversation → stage_change → record_update priority), frequency (weighted: meeting=10/call=5/email=2 + conversation count), monetary (deal.amount). `computeQuintileBreakpoints` with tercile fallback for <10 deals. `assignRecencyQuintile` (inverted: lower days = better), `assignQuintile` (normal). `assignRFMGrade` (strategic A-F matrix), `assignRFMLabel` (action-oriented: "Big Deal at Risk", "Hot Opportunity", etc.). `computeHistoricalWinRatesByRFM` with T-30 snapshot reconstruction. `testRFMDiscrimination` (A/F lift check). `batchUpdateRFMScores` writes to deals table in 200-record batches. `computeAndStoreRFMScores` orchestrates full cycle. Evidence rendering: `renderRFMScoreCard`, `renderRFMComparison`, `renderRFMMethodology`, `buildRFMContextForLLM`.
    - DB columns added lazily via `ensureRFMColumns()`: `rfm_recency_days/quintile/source`, `rfm_frequency_count/quintile`, `rfm_monetary_quintile`, `rfm_segment`, `rfm_grade`, `rfm_label`, `rfm_mode`, `rfm_scored_at`.
    - Wired into `server/computed-fields/engine.ts`: `computeAndStoreRFMScores` runs after deals/contacts/accounts, non-fatal (logged as warning on failure).
    - `aggregateStaleDeals` now includes `rfmBreakdown` + `hasRFMScores` by grouping stale deals by rfm_grade.
    - `forecastRollup` tool now includes `rfmQuality` (per forecast-category: total/ab_count/ab_value/df_count/df_value + coldCommitPct).
    - Pipeline Hygiene synthesis prompt: RFM stale deal priority block (A/B/C/D/F grade counts + values + action instructions).
    - Forecast Rollup synthesis prompt: Behavioral quality of committed pipeline block (cold commit %, category breakdown).
    - Schema delta applied throughout: `stage_normalized NOT IN ('closed_won', 'closed_lost')` for open deals (no `is_closed` column); `d.owner` (not `owner_email`); activities use `timestamp` column (not `activity_date`); conversations use `call_date`.

-   **Investigation Pipeline Delta Detection (Coaching Intelligence V2):**
    - `server/briefing/investigation-delta.ts`: `compareInvestigationRuns` compares most-recent vs previous completed `skill_runs` for `deal-risk-review`, `data-quality-audit`, `forecast-rollup`. Fields: `d.severity === 'warning'|'critical'` (not risk_score), `d.entity_name` (not deal_name), `d.fields?.amount` (not d.amount). Returns `currentFindings`, `previousFindings`, `deltaFindings`, `newHighRiskDeals[]`, `improvedDeals[]`.
    - `server/briefing/greeting-engine.ts`: Computes `total_at_risk = sum(d.currentFindings)` across all deltas. `deltas` block now only emits when `total_at_risk > 0` (not just `deltas.length > 0`). `total_at_risk` added to the returned `deltas` object alongside `new_critical_count`, `improved_count`, `since_label`.
    - `client/src/components/assistant/ProactiveBriefing.tsx`: Delta card condition changed to `new_critical_count > 0 || total_at_risk > 0`. Card shows "X new issues detected" (with 🆕) when truly new deals appear, or "X deals at risk" (with ⚠️) for persistent at-risk deals. `total_at_risk` added to `ProactiveBriefingData.deltas` interface.
    - `client/src/components/assistant/InvestigationResults.tsx`: `useEffect` now guards `if (!workspace?.id) return` before fetching — prevents `/api/workspaces/undefined/...` URL (which caused 404 and "No findings available"). Added `response.ok` check + console.log of fetch URL. HTTP errors set `results.error` with status code.

-   **UX + Data Fixes (Coaching Intelligence V2):**
    - **Skill Queue**: `runningSkill: string | null` → `runningSkills: Set<string>` + `queuedSkills: string[]`. Skills now queue when one is already running; queued skills show amber "Queued" button state; queue drains sequentially on completion.
    - **Forecast "Go to Skills" button**: Replaced with "Generate First Forecast ▶" that runs `forecast-rollup` then `monte-carlo-forecast` inline, shows live status ("Running Forecast Rollup..." / "Running Monte Carlo Simulation..." / "Done — reloading forecast data..."), and refreshes snapshot data without navigation.
    - **forecastRollup excluded_owners filter**: `byRep` query now applies `excluded_owners` from business context (same pattern as `coverageByRep`), removing admin/test accounts like Jack McArdle and Carter McKay from rep breakdown table.

## Week 4: Investigation History (Frontend Complete)

-   **New Pages/Components:**
    - `client/src/pages/InvestigationHistoryPage.tsx`: Full audit-trail page at `/investigation/history`. Filters bar (skill, status, date range), timeline chart when skill selected, sortable history table, modal for viewing individual run results. Back button, dark theme.
    - `client/src/components/investigation/InvestigationTimelineChart.tsx`: Recharts `LineChart` with 4 series (atRisk/critical/warning/healthy). Trend badge (📉 Improving / 📈 Worsening / ➡️ Stable). Run summary. Loading/empty states.
    - `client/src/components/investigation/InvestigationHistoryTable.tsx`: Sortable 7-column table. Color-coded status + at-risk badges. CSV/XLSX export buttons (calls `POST /investigation/export` + opens download URL). Row click fires modal callback. Previous/Next pagination with "Showing X–Y of Z".

-   **New Hooks:**
    - `client/src/hooks/useInvestigationHistory.ts`: `useInvestigationHistory(filters, limit)` — fetches `/investigation/history` with full filter support (skillId, status, fromDate, toDate), pagination, refetch. `useInvestigationTimeline(skillId, days)` — fetches `/investigation/timeline` for chart data.

-   **Format Utility:** `formatDuration(ms)` added to `client/src/lib/format.ts` — converts milliseconds to `--`, `< 1s`, `23s`, `1m 45s`.

-   **Routing + Nav:**
    - `App.tsx`: Route `<Route path="/investigation/history" element={<InvestigationHistoryPage />} />` registered.
    - `ProactiveBriefing.tsx`: "View full history →" link added below investigation paths section, navigates to `/investigation/history`.

-   **Test Script:** `test-week4-replit.cjs` — 16-test API suite covering history list (pagination + filtering), timeline (30d/7d), deal timeline, export (CSV/XLSX + error handling). Run with `PANDORA_TEST_TOKEN=<token> node test-week4-replit.cjs`. Passes 15/16 (timeline cold-start timing note only).

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
## Security Hardening (March 2026)

### S001: IDOR Fix in `requireWorkspaceAccess`
- **Root cause**: Middleware ran before Express parsed `:workspaceId` param; `req.params.workspaceId` was always `undefined`
- **Fix**: `extractWorkspaceId()` helper — checks `req.params.workspaceId` first, then falls back to UUID regex on `req.path`
- **Also added**: UUID format validation before any DB query; invalid UUIDs return 400
- **File**: `server/middleware/auth.ts`

### S002: Credential Migration Script
- **Tool**: `server/lib/migrate-credentials.ts` — encrypts plaintext JSONB credentials to AES-256-GCM (`enc:` prefix)
- **Admin endpoint**: `POST /api/admin/migrate-credentials` (requires `PANDORA_ADMIN_KEY`)
- **Auto-run**: Set `AUTO_MIGRATE_CREDENTIALS=true` env var to run on startup
- **Note**: All credentials were already in encrypted/legacy-base64 format; script is idempotent

### S003: LLM Cost Amplification Protection
- Added `chatLimiter`: 20 LLM calls/minute per workspace (per-workspace key, not per-IP)
- Applied via `workspaceApiRouter.use('/:workspaceId/chat', chatLimiter)` before chat router
- **File**: `server/index.ts`

### S004: Session Rotation
- Already correctly implemented: `revokeRefreshToken` + new `generateRefreshToken` + new `generateAccessToken` (JWT, different `iat`) on every `/auth/refresh` call
- No change needed

### S005: UUID Validation in SQL Workspace
- Added `UUID_RE.test(workspaceId)` check at top of both `/sql/execute` and `/sql/saved/:queryId/run` handlers
- Converted `SET LOCAL app.current_workspace_id = '${workspaceId}'` string interpolation to parameterized `SET LOCAL ... = $1`
- **File**: `server/routes/sql-workspace.ts`

### S006: Auth on `/api/agents` Public Routes
- Added `requireAdmin` middleware to `GET /agents` and `GET /agents/:agentId` — no longer publicly readable
- **File**: `server/routes/agents.ts`

### S007: Prompt Injection Guard
- Added `## Data Integrity Guard` section to `PANDORA_SYSTEM_PROMPT`
- Added rule 24 (LEADS) clarifying HubSpot vs Salesforce lead tools
- **File**: `server/chat/pandora-agent.ts`

## Lead & Contact Querying (March 2026)

### Q001: `lifecycle_stage` Filter Added to Contacts
- **`server/tools/contact-query.ts`**: Added `lifecycleStage?: string | string[]` to `ContactFilters`; single value or array (`ANY($N::text[])`) support
- **`server/routes/data.ts`**: `GET /:id/contacts` now accepts `lifecycle_stage` query param (comma-separated for arrays)
- **`server/chat/data-tools.ts`**: `query_contacts` tool now filters by `lifecycle_stage`, `seniority`, `department`
- **`server/chat/pandora-agent.ts`**: `query_contacts` tool definition extended with all three new params

### Q002: `server/tools/lead-query.ts` — New Full Query Layer
- Exports: `Lead` interface, `LeadFilters`, `queryLeads()`, `getLead()`, `getLeadsForAccount()`, `getLeadFromConvertedContact()`
- Filters: `status`, `isConverted`, `leadSource`, `ownerId`, `ownerEmail`, `company` (ILIKE), `search`, `createdAfter`, `lastModifiedAfter`, `sortBy`, `sortDir`, `limit`, `offset`
- All queries scoped to `workspace_id = $1`

### Q003: Leads REST Routes
Added to `server/routes/data.ts`:
- `GET /:id/leads` — list with all filters
- `GET /:id/leads/:leadId` — single lead detail
- `GET /:id/accounts/:accountId/leads` — leads linked to an account
- `GET /:id/contacts/:contactId/converted-from` — lead this contact was converted from

### Q004: `query_leads` AI Agent Tool
- Added `query_leads` tool to `server/chat/data-tools.ts` (function `queryLeadsAI`)
- Registered in `case` switch alongside `query_deals`, `query_contacts`
- Added to `PANDORA_TOOLS` array and both system prompt tool lists
- Differentiates HubSpot leads (use `query_contacts` with `lifecycle_stage="lead"`) vs Salesforce leads (use `query_leads`)

## Pandora Assistant Intelligence Layer (March 2026)

### Chart Infrastructure (T001–T005)
- **`server/renderers/types.ts`**: Added `ChartType`, `ChartDataPoint`, `ChartSpec`, `ChartBlock` types + `validateChartSpec()` function
- **`client/src/types/chart-types.ts`**: Mirror types for frontend consumption
- **`client/src/components/shared/ChartRenderer.tsx`**: Full Recharts component supporting 6 chart types: bar, horizontal_bar, line, stacked_bar, waterfall, donut. Compact mode, annotation line, colorMap, referenceValue support.
- **`server/chat/pandora-agent.ts`**: `detectVisualizationHint()`, `parseChartSpecs()` added; `PandoraResponse` extended with `chart_specs?: ChartSpec[]`; chart system prompt injection when viz hint detected
- **`server/routes/conversation-stream.ts`**: Emits `chart_specs` SSE event before `synthesis_done` for all `runPandoraAgent` call sites
- **`client/src/components/assistant/useConversationStream.ts`**: `chartSpecs: ChartSpec[]` in `ConversationState`; `chart_specs` SSE event handled; reset on new message
- **`client/src/components/assistant/ConversationView.tsx`**: Chart block rendered above synthesis text when `chartSpecs.length > 0`
- **`server/briefing/brief-assembler.ts`**: Generates `chart_spec` on `TheNumber` (attainment pacing line), `WhatChanged` (pipeline waterfall), `Reps` (rep coverage horizontal_bar)
- **`server/briefing/brief-types.ts`**: `chart_spec?: any` added to `TheNumber`, `WhatChanged`, `Reps` interfaces
- **`client/src/components/assistant/TheNumberCard.tsx`**: Renders `n.chart_spec` via ChartRenderer above table
- **`client/src/components/assistant/WhatChangedCard.tsx`**: Renders `wc.chart_spec` via ChartRenderer above table
- **`client/src/components/assistant/RepsCard.tsx`**: Renders `reps.chart_spec` via ChartRenderer above rep list

### Live Deal Trust Layer (T006–T007)
- **`server/chat/deal-lookup.ts`**: `lookupLiveDeal()`, `detectDealMentions()`, `buildLiveDealFactsBlock()`, `detectContradiction()` — forces live DB values over stale brief context
- **`server/chat/pandora-agent.ts`**: Live deal injection + contradiction handling integrated into `runPandoraAgent`; deal mentions detected before tool loop; contradiction triggers mandatory re-query instruction

### Event-Driven Brief Freshness (T008–T009)
- **`server/briefing/brief-reassembly-trigger.ts`**: `triggerBriefReassembly(workspaceId, reason, materialChanges)` — non-blocking, fires `assembleBrief(force: true)` via `setImmediate`
- **`server/jobs/queue.ts`**: `handleHubSpotSyncJob` now queries for recent Closed Won deals + triggers brief reassembly if records updated; fully non-blocking
- **`server/routes/briefs.ts`**: `GET /:workspaceId/brief` now returns `metadata: { assembled_at, last_sync_at, is_potentially_stale, stale_reason }` by querying `connections` table
- **`client/src/pages/AssistantView.tsx`**: Stores `briefMetadata` state; passes to `ProactiveBriefing` with `onRefreshBrief` callback
- **`client/src/components/assistant/ProactiveBriefing.tsx`**: Assembly time line ("As of X:XX AM"), staleness banner (amber), clickable ↻ refresh button that calls `onRefreshBrief`

### Immediate ACES ABA Fix
- Frontera workspace brief force-reassembled on March 7, 2026 at 02:00 UTC
- Corrected attainment: **112%** (was 20.7%), Won: **$392,100** (was $72,480, ACES ABA $315K now included)

## Pandora V2 Intelligence Layer (March 2026 — T10–T16+T19)

### T010: Session Context Object
- **`server/agents/session-context.ts`** (new): Full `SessionContext` type with `activeScope`, `computedThisSession` cache (TTL-aware), `dealsLookedUp`, `conversationHistory`, `sessionFindings`, `sessionCharts`, `sessionTables`, `sessionRecommendations`, `accumulatedDocument`
- Helper functions: `createSessionContext()`, `getOrCreateSessionContext()`, `updateSessionScope()`, `cacheComputation()`, `getCachedComputation()`, `addSessionFinding()`, `addSessionChart()`, `addSessionRecommendation()`
- **`server/chat/conversation-state.ts`**: Extended `ConversationContext` to include `sessionContext` JSONB field
- **`server/chat/pandora-agent.ts`**: Session context passed in/out; scope inheritance via LLM `<scope_change>` tags; `compute_metric` cache-before-query; finding/chart extraction into session context
- **`server/routes/conversation-stream.ts`**: Session context loaded from conversation state at stream start, saved after agent response

### T019: Cross-Session Workspace Memory
- **`migrations/134_workspace_memory.sql`** (new, applied): `workspace_memory` table with memory_type, entity linkage, period scoping, occurrence_count, source tracking, resolution status + 4 performance indexes
- **`server/memory/workspace-memory.ts`** (new): `writeMemoryFromSkillRun()`, `writeMemoryFromBriefAssembly()`, `getRelevantMemories()`, `resolveMemory()`, `buildMemoryContextBlock()` — formats memory as `<workspace_memory>` block injected into agent system prompt
- **`server/findings/persistence-engine.ts`**: Calls `writeMemoryFromSkillRun` after every skill run
- **`server/briefing/brief-assembler.ts`**: Calls `writeMemoryFromBriefAssembly` after brief assembly

### T011: Document Accumulator
- **`server/documents/types.ts`** (new): `DocumentTemplateType`, `DocumentSection`, `DocumentContribution`, `AccumulatedDocument`, `TEMPLATE_CONFIGS` for WBR/QBR/BOARD_DECK/FORECAST_MEMO/DEAL_REVIEW
- **`client/src/types/document-types.ts`** (new): Client-side mirror of document types
- **`server/documents/accumulator.ts`** (new): `createAccumulatedDocument()`, `autoSlotContribution()`, `addContribution()`, `getAccumulatorState()`, `overrideSection()`, `removeContribution()`
- **`server/agents/session-context.ts`**: Extended with `accumulatedDocument` field
- **`server/chat/pandora-agent.ts`**: Auto-adds extracted findings and charts as document contributions
- **`server/routes/sessions.ts`** (new): `GET /api/workspaces/:id/sessions/:threadId/document` + `POST .../contribution/:id/move`
- **`server/index.ts`**: Registered sessions routes
- **`client/src/components/assistant/DocumentPill.tsx`** (new): Persistent floating pill at bottom of chat; expands to section outline with contribution counts; "Render →" button; per-contribution move/remove controls
- **`client/src/pages/AssistantView.tsx`**: DocumentPill rendered when `threadId` is available

### T012: Narrative Synthesis at Render Time
- **`server/documents/synthesizer.ts`** (new): `synthesizeDocument(input: SynthesisInput)` — Claude call with compact context (<3K tokens); produces `executiveSummary`, `sectionBridges`, `documentThroughline`, `lowConfidenceFlags`
- Token budget enforcement: summarizes to top 2 findings per section if over budget
- Low-confidence detection: small record counts, contradiction-flagged values, stale brief values
- **`server/routes/sessions.ts`**: Added `POST .../document/synthesize` endpoint
- **`client/src/components/assistant/DocumentPill.tsx`**: Calls synthesize API before render; injects throughline into document header

### T014: Cross-Signal Analysis Engine
- **`server/skills/cross-signal-analyzer.ts`** (new): 4 pattern definitions (pricing_friction_to_conversion_drop, single_thread_to_deal_risk, icp_mismatch_to_churn_signal, data_quality_to_forecast_risk); `runCrossSignalAnalysis(input)` → `CrossSignalFinding[]`; entity overlap detection
- **`server/chat/pandora-agent.ts`**: Cross-signal analysis runs post-tool-loop when ≥2 finding categories present; results appended to sessionContext with `category: 'cross_signal'`
- **`server/routes/conversation-stream.ts`**: Emits `cross_signal_findings` SSE event
- **`client/src/components/assistant/useConversationStream.ts`**: Handles `cross_signal_findings` event
- **`client/src/components/assistant/ConversationView.tsx`**: Renders "🔗 Connected Intelligence" block with root cause + recommendation

### T016: Action Judgment Layer
- **`server/actions/judgment.ts`** (new): `judgeAction()` with 3 modes (autonomous/approval/escalate); full JUDGMENT_RULES matching spec — autonomous for low-risk tasks, approval for CRM writes and rep DMs, escalate for bulk updates/territory/quota/forecast-override
- **`server/actions/executor.ts`**: System-triggered actions require `autonomous` mode; user-triggered actions bypass judgment check
- **`server/chat/pandora-agent.ts`**: Extracts actions from response, judges each, emits `actions_judged` SSE event
- **`client/src/components/assistant/useConversationStream.ts`**: Handles `actions_judged` event
- **`client/src/components/assistant/ActionCard.tsx`**: Extended with 3 modes — autonomous notification chip, approval card (Approve/Edit/Skip), escalation card with "Show me the scenarios →"
- **`client/src/components/assistant/ConversationView.tsx`**: Renders "Recommended Actions" section in chat feed

## Pandora V2 Continuation Layer (March 2026 — T013, T015, T017, T018, T020, T021)

### T013: Document Distribution + Human-in-the-Loop Review
- **`migrations/135_document_distributions.sql`** (new, applied): `document_distributions` table (workspace_id, document_id, channel, recipient, distributed_at, status, error)
- **`server/documents/distributor.ts`** (new): `distributeDocument()` routing to Slack (summary block + download link), Email (Resend, PDF attachment, executive summary body), Google Drive (save + shareable link); writes to document_distributions after each distribution
- **`server/routes/sessions.ts`**: Added `/remove` (remove contribution) and `/distribute` (trigger distribution) endpoints
- **`client/src/components/assistant/DocumentPill.tsx`**: Review gate — when `lowConfidenceFlags.length > 0`, shows modal with ⚠ items, [Confirm]/[Remove] per item, "Continue to render →" activates only when all resolved; Distribution panel: Slack / Email / Drive / Download buttons after review passes

### T015: Strategic Reasoning Layer
- **`server/skills/strategic-reasoner.ts`** (new): `classifyStrategicQuestion()` detects "why do we keep...", "should we...", "root cause", etc.; `runStrategicReasoning()` — Claude structured prompt (HYPOTHESIS / SUPPORTING EVIDENCE / CONTRADICTING EVIDENCE / RECOMMENDATION / TRADEOFFS / WATCH FOR); opens with recurrence context when workspace_memory occurrence_count ≥ 3
- **`server/chat/pandora-agent.ts`**: Pre-tool-loop strategic question check; if detected, runs strategic reasoner and bypasses normal tool loop; emits `strategic_reasoning` SSE event; integrates output into accumulatedDocument
- **`client/src/components/assistant/StrategicCard.tsx`** (new): 🧠 header, labeled sections (Hypothesis, Supporting Evidence, What doesn't fit, Recommendation, What you give up, Watch for, Confidence)
- **`client/src/components/assistant/useConversationStream.ts`**: Handles `strategic_reasoning` event
- **`client/src/components/assistant/ConversationView.tsx`**: Renders StrategicCard in feed

### T017: Slack Draft Queue
- **`migrations/136_slack_drafts.sql`** (new, applied): `slack_drafts` table (workspace_id, source_action_id, recipient_slack_id, recipient_name, draft_message, edited_message, context, status, approved_by, sent_at, dismissed_at)
- **`server/actions/slack-draft.ts`** (new): `generateSlackDraft()` — Claude call with rep-voice prompt, 2-4 sentences, collegial, no mention of Pandora; `createSlackDraft()`, `sendSlackDraft()`, `dismissSlackDraft()`
- **`server/actions/judgment.ts`**: slack_dm action type triggers `generateSlackDraft`; draft attached to ActionJudgment result
- **`client/src/components/assistant/ActionCard.tsx`**: slack_dm renders "📨 Draft Slack DM → {name}" with inline draft text; [Send as-is] [Edit & Send] [Dismiss]; Edit & Send opens inline textarea
- `server/routes/actions.ts`: Added `POST /slack-drafts/:draftId/send` and `/dismiss` endpoints

### T018: Closed-Loop Recommendation Tracking
- **`migrations/137_recommendations.sql`** (new, applied): `recommendations` table (workspace_id, session_id, deal_id, deal_name, action, category, urgency, status, outcome, was_actioned, recommendation_correct, resolved_at)
- **`server/documents/recommendation-tracker.ts`** (new): `persistRecommendation()`, `updateRecommendationStatus()`, `evaluateRecommendationOutcomes()` (called post-sync for material changes), `resolveRecommendation()` (updates DB + writes to workspace_memory), `writeRecommendationOutcomeMemory()`, `getOutcomeSummaryForBrief()`
- **`server/jobs/queue.ts`**: Calls `evaluateRecommendationOutcomes()` after HubSpot sync with material changes
- **`server/chat/pandora-agent.ts`**: Persists recommendations extracted from agent response via `persistRecommendation()`
- **`server/briefing/brief-assembler.ts`**: Injects outcome summaries ("✓ Behavioral Framework closed...") into executive summary section

### T020: Prior Document Comparison
- **`server/documents/comparator.ts`** (new): `buildComparison()` queries prior weekly_brief, matches findings by (category, entity_id), classifies resolved/persisted/new, compares metrics (attainment, coverage, days_remaining); `formatComparisonBlock()` with icon legend (✓ ↑ → ↓ ⚡); consecutive weeks from workspace_memory occurrence_count
- **`server/briefing/brief-assembler.ts`**: Calls `buildComparison()` post-assembly; stores `comparison_block` (HTML) and `comparison_data` (JSON) in weekly_briefs table
- **`server/briefing/brief-types.ts`**: Added `comparison_block` and `comparison_data` fields
- **`client/src/components/assistant/ComparisonBlock.tsx`** (new): "Since last week" section with color-coded rows (green ✓, teal ↑, amber →, coral ↓/⚡), metric delta badges
- **`client/src/components/assistant/ProactiveBriefing.tsx`**: Renders ComparisonBlock between narrative and metrics strip when comparison data is available

### T021: Forecast Accuracy Memory
- **`server/memory/workspace-memory.ts`**: Added `ForecastAccuracyMemory` interface; `writeQuarterlyForecastAccuracy()` computes per-rep accuracy from closed deals vs forecast calls, writes to workspace_memory with memory_type='forecast_accuracy'; `getForecastAccuracyContext()` + `buildAccuracyContextString()` for last 3 periods
- **`server/chat/pandora-agent.ts`**: Injects `<forecast_accuracy_history>` context block when message contains forecast/commit/attainment keywords
- **`server/briefing/brief-assembler.ts`**: Calls `writeQuarterlyForecastAccuracy()` on assembly; fetches accuracy context and stores as `forecast_accuracy_note` in weekly_briefs
- **`client/src/components/assistant/TheNumberCard.tsx`**: Shows `forecast_accuracy_note` as muted italic text below metrics strip when present

### All V2 Tasks Complete
T010–T021 are all built and running. Migration tracker updated with 134–137. No regressions on T001–T009.
