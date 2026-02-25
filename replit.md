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
-   **Computed Fields Engine:** Orchestrates batch computations for various scores (e.g., `velocity_score`, `deal_risk`, `engagement_score`).
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
-   **Dossier Assemblers:** Enhanced deal and account dossiers with enrichment sections, engagement tracking, relationship health metrics, and optional Claude narrative synthesis. Deal narrative context includes conversation signals (keyword hits with points) and summaries from the 3 most recent conversations (HTML-stripped, 1200-char aggregate budget) so Claude can lead with recent call substance rather than defaulting to stall narratives.
-   **Command Center (Backend):** Backend API for findings extraction, dossier assembly, scoped analysis, findings management, pipeline snapshots, and connector status.
-   **Actions Queue:** Manages the full lifecycle of actions with status tracking, approval workflows, CRM write-back, and automatic expiry.
-   **Playbooks System:** Defines skill pipelines, tracks run statistics, and visualizes execution phases.
-   **Command Center (Frontend):** React + TypeScript UI featuring authentication, dashboard with pipeline visualization, entity lists, detail pages, skills management, connectors page, insights feed, and responsive UI elements. Includes demo mode for anonymization of sensitive data.
-   **Consultant Dashboard (Multi-Workspace):** Cross-workspace portfolio view for consultants, providing aggregated pipeline, findings, actions, connectors, and skill run data with urgency indicators. Includes unassigned calls triage.
-   **Consultant Call Intelligence (Frontend):** Connector setup for multi-workspace users to integrate call intelligence platforms like Fireflies.
-   **Push Delivery System:** Manages configurable delivery channels (Slack/Email/Webhook) and rules with various triggers and templates, logging delivery status.
-   **Voice & Tone System:** Per-workspace voice configuration (detail_level, framing, alert_threshold) dynamically injected into skill synthesis prompts.
-   **WorkbookGenerator:** Provides multi-tab `.xlsx` export services for skill and agent runs.
-   **Monte Carlo Forecast (Pipeline-Aware):** 10,000-iteration probabilistic revenue forecast skill with P10–P90 ranges, quota probability, and variance driver ranking, adaptable per pipeline type.
-   **Editorial Synthesis Engine (Phase 1):** Single Claude call produces holistic briefings with editorial decisions (lead_with, promote_finding, merge_sections, drop_section). Routes via `agent_id` on report templates — with agent → editorial path, without → static section-generator path.
-   **Agent Templates + Builder (Phase 2):** 5 pre-built briefing templates (Monday Pipeline, Forecast Call Prep, Friday Recap, Board Meeting Prep, QBR) with `AgentBriefingConfig` defining audience, focus_questions, data_window, output_formats, and schedule. Agent Builder UI with template gallery, audience/vocabulary/focus questions/data window/schedule/formats tabs. Editorial synthesizer injects audience role, detail level, vocabulary preferences, focus questions, and data window into Claude prompt.
-   **Self-Reference Memory (Phase 3):** Two-tier bounded memory system (600-1200 tokens fixed ceiling). Tier 1: `AgentRunDigest` — compressed summary of last run (headlines, deals flagged, metrics, actions). Tier 2: `AgentMemory` — rolling patterns across runs (recurring flags capped at 30, deal history capped at 20 with 5 mentions each, metric trends capped at 8 data points per series, predictions capped at 10). Memory injected into editorial synthesis prompt between tuning and evidence. Agent references previous briefings: "I flagged X last week", "This is the 3rd time I've flagged Y", metric trends. Stored in `agent_memory` table + `report_generations.run_digest` column.
-   **Slack Notification Controls:** Centralized notification gateway (`server/notifications/`) with 13 notification categories, per-workspace preferences (stored in `workspaces.settings` JSONB), delivery modes (realtime/digest/smart), quiet hours with timezone support, per-category enable/disable + threshold filters (min_score_change, min_score_tier, max_per_run), pause/resume functionality, and digest queue (`notification_queue` table) with scheduled flushing every 15 min. All major Slack send points (account scorer, skills, agents/runtime, actions, agent channels) route through the `sendNotification` gateway which evaluates preferences before dispatching. Settings UI in the Notifications tab under workspace admin settings.
-   **Named Filters System:** Workspace-scoped business concept definitions (e.g., "MQL", "Expansion Deal", "At Risk") stored in `workspace_config.named_filters`. `FilterResolver` class (`server/tools/filter-resolver.ts`) compiles structured `FilterConditionGroup` conditions to parameterized SQL with cross-object EXISTS subqueries, relative date support, and all operators. 5 default filters (open_pipeline, new_logo, stale_deal, closing_this_quarter, at_risk). Wired into all query tools (deal, contact, account, conversation) via `named_filter`/`named_filters` params in `tool-definitions.ts`. CRUD API (`/filters` endpoints) with preview/resolve and confirm. Evidence contract (`AppliedFilterEvidence`) tracks filter metadata through skill runs. Scope notice injected into Claude synthesis prompts when filters are active. Agent Builder "Scope Filters" tab allows selecting named filters per agent. Usage tracked in `filter_usage_log` table.
-   **Workspace Lens:** Global data filtering via `X-Pandora-Lens` header. Lens middleware (`server/middleware/lens.ts`) reads header and attaches to request. `resolveLens()` in data routes compiles lens filter ID to SQL via FilterResolver and injects as `additionalWhere`/`additionalParams` into deals, contacts, accounts, and conversations list queries. Frontend `LensContext` (`client/src/contexts/LensContext.tsx`) manages active lens state with sessionStorage persistence. `LensDropdown` in TopBar allows selecting named filters as workspace-wide data lens. API client (`client/src/lib/api.ts`) automatically includes lens header on all requests. Core pages (CommandCenter, DealList, AccountList) re-fetch data when lens changes.

-   **Forecast Page:** Longitudinal forecast tracking dashboard at `/forecast`. Header with AI toggle and week counter. 5 metric cards (MC P50, Closed Won, Gap to Quota, MC Range, Pipe Gen) with WoW delta. SVG line chart with 4 toggleable forecast lines (stage-weighted, category-weighted, MC P50, attainment), confidence band (P25-P75), and quota line. Chart insights sidebar for chart-anchored annotations. Rep breakdown table with sortable columns and inline rep annotations. Coverage bars by quarter with 3x target marker. Pipe gen trailing 8-week bar chart. Deal drill-down slide-out panel. Graceful degradation for 0/1/2+ snapshots. Data from `GET /api/workspaces/:id/forecast/snapshots` (extracts from `skill_runs.result` for forecast-rollup). Command Center shows compact AI Alerts (max 3 critical/warning) with "View all insights →" link to Forecast page.
-   **Public Homepage & Waitlist:** Dark-themed landing page (`PandoraHomepage.tsx`) with animated SVG eye logo, hero, stats counters, before/after comparisons, integration flow diagram, cadence grid, practitioner credibility section, and waitlist CTA. Waitlist API (`/api/waitlist`) stores signups in `waitlist` table, adds to Resend audience (if `RESEND_AUDIENCE_ID` configured), and sends welcome email via Resend. Unauthenticated visitors see homepage; `/login` path shows login page; authenticated users see the app.

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