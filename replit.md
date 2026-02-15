# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant, agent-based platform designed to provide Go-To-Market (GTM) data analysis for RevOps teams. It integrates and normalizes GTM data from various sources such as CRM, call intelligence, task management, and document repositories into eight core entities. The platform then utilizes AI to generate actionable insights, with the goal of enhancing decision-making, refining GTM strategies, and improving overall business vision and market potential.

## User Preferences
- Raw SQL with parameterized queries — no ORM
- Minimal dependencies — only install what's needed
- Full control over database queries (complex joins, window functions, aggregations)
- Multi-tenant first — every table scoped by `workspace_id`

## System Architecture
Pandora is built on Node.js 20 with TypeScript 5+, using Express.js and PostgreSQL (Neon) via the `pg` client with raw SQL.

**Core Architectural Patterns:**
-   **Multi-Tenancy:** Achieves strict data isolation using `workspace_id`.
-   **Universal Adapter Pattern:** Standardizes data ingestion from diverse connectors.
-   **Data Normalization:** Transforms raw data into 8 core entities: `deals`, `contacts`, `accounts`, `activities`, `conversations`, `tasks`, `calls`, and `documents`.
-   **Context Layer:** A `context_layer` table, unique per workspace, stores business context in 5 JSONB sections for personalized AI analysis.
-   **Quota System:** Manages team and per-rep quotas.
-   **Computed Fields Engine:** Orchestrates batch computations for various scores (e.g., `velocity_score`, `deal_risk`, `engagement_score`).
-   **Stage Normalization:** Maps raw CRM stages to universal values.
-   **Skill Framework:** A registry and runtime for AI-powered skills, employing a COMPUTE → CLASSIFY → SYNTHESIZE pattern with a three-tier AI system.
-   **Sync Infrastructure:** Supports scheduled and manual asynchronous data synchronizations.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client and raw SQL are used for optimal performance and control.
-   **Data Storage:** Raw API data is stored within a `source_data JSONB` column in entity tables.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` is used for efficient data synchronization.
-   **On-Demand Transcript Fetching:** Call transcripts are fetched only when required.
-   **Two-Step Conversation Connect Flow:** Ensures only relevant calls from tracked representatives are synced.
-   **API Design:** RESTful API for managing workspaces, connectors, and actions.
-   **Query Layer:** Seven query modules with dynamic parameterized SQL, workspace scoping, and pagination.
-   **Slack Output Layer:** General-purpose Slack Block Kit client for automated skill result posting.
-   **Webhook Endpoints:** Inbound webhooks for skill triggers, run status, and event ingestion.
-   **Cross-Entity Linker:** A post-sync batch job resolves foreign keys between entities using a 3-tier matching process.
-   **Internal Meeting Filter:** Classifies conversations as internal/external post-sync.
-   **Deal Insights Extraction:** Extracts insights (next steps, objections, decision criteria) from conversation transcripts into a versioned `deal_insights` table using DeepSeek.
-   **LLM Integration:** Anthropic Claude is used for reasoning/generation, and Fireworks DeepSeek for extraction/classification, with token guardrails.
-   **Tier 2 Schema:** Includes `account_signals`, `icp_profiles`, and `lead_scores`.
-   **File Import Connector:** Manages CSV/Excel uploads, including DeepSeek classification and association inference.
-   **ICP Enrichment Pipeline:** A 6-step pipeline for closed deal analysis, involving contact role resolution, Apollo API enrichment, Serper Google search, and derived feature computation.
-   **Industry Normalization:** Maps various data formats to consistent industry values.
-   **Handlebars Template Engine:** Used in the skill runtime for flexible prompt rendering.
-   **Workflow Engine:** Integrates with ActivePieces for workflow automation.
-   **Token Usage Tracking:** A `token_usage` table tracks token consumption with API endpoints for summary, detail, and anomaly detection.
-   **Agent Runner Framework:** Composes multiple skills into unified briefings, synthesizing outputs into narratives for Slack delivery, with built-in agents and a scheduler.
-   **Deal Risk Token Optimization:** Optimized `deal-risk-review` by replacing multi-turn tool conversations with a `summarizeForClaude` compute step.
-   **Bowtie Stage Discovery:** Detects post-sale/bowtie stages in CRM data via pattern matching.
-   **Bowtie Analysis Skill:** Full-funnel bowtie analysis skill (`bowtie-analysis`) with 7 compute functions.
-   **Pipeline Goals Skill:** Reverse-math activity goals skill (`pipeline-goals`) with 5 compute functions.
-   **Project Updates & Recap:** `project_updates` table and `project-recap` skill for loading and formatting project updates.
-   **Strategy Insights Skill:** Cross-skill pattern analysis (`strategy-insights`) queries `skill_runs` and `agent_runs` for trend analysis.
-   **Composition Agents:** Includes `attainment-vs-goal`, `friday-recap`, and `strategy-insights` agents for specific analyses and reporting.
-   **Workspace Config System:** Provides config schema, loader, inference engine, instant audit, drift detection, and config suggestions.
-   **Workspace Config Audit Skill:** `workspace-config-audit` skill performs 8 drift checks and generates config suggestions.
-   **Evidence Infrastructure:** Full evidence population across all skills with `SkillEvidence` type, accumulating `skillEvidence` map in agent runs.
-   **Slack Formatter Upgrade:** `formatWithEvidence()` and `formatAgentWithEvidence()` render structured claim blocks with severity indicators.
-   **WorkbookGenerator (Excel Export):** Provides multi-tab `.xlsx` export services.
-   **Export API Endpoints:** `GET /api/workspaces/:id/skills/:skillId/runs/:runId/export` and `GET /api/workspaces/:id/agents/:agentId/runs/:runId/export` for `.xlsx` workbook exports.
-   **Voice & Tone System:** Per-workspace voice configuration with 3 axes (detail_level, framing, alert_threshold) dynamically injected into skill synthesis prompts via Handlebars.
-   **Prompt Voice Rewrites:** All 6 high-priority skill prompts rewritten for a professional, non-alarmist tone.
-   **Previous Run Comparison:** `getPreviousRun()` utility fetches last completed skill_run for delta analysis.
-   **Severity Classification:** Reusable severity utilities provide consistent severity handling.
-   **Slack App Infrastructure:** Dual-mode `SlackAppClient`, signature verification, API endpoints for events and interactions, thread anchoring, message tracking, channel configuration, and snooze functionality. Action buttons (Reviewed/Snooze/Drill/Execute/Dismiss/View) are dynamically appended.
-   **Shared Currency Formatting:** `formatCurrency()` utility handles M/K thresholds across the application.
-   **Command Center Phase A (Backend):** Backend API for findings extraction, dossier assembly, and scoped analysis.
    -   **Findings Infrastructure:** `findings` table with 7 per-skill extractors, auto-extraction, backfill script, and API endpoints for findings, summary, and pipeline snapshot.
    -   **Dossier Assemblers:** `assembleDealDossier()` and `assembleAccountDossier()` with parallel queries and health signal computation. API endpoints for deal and account dossiers.
    -   **Scoped Analysis Engine:** `POST /analyze` endpoint with 5 scope types, Claude synthesis, rate limiting, and token usage tracking.
-   **Command Center Phase B (Frontend):** React + TypeScript frontend providing a UI for all Phase A APIs.
    -   **Stack:** Vite 7 + React 19 + TypeScript, `react-router-dom`. Dark theme.
    -   **Dual Server Setup:** Vite dev server on port 5000, Express API on port 3001.
    -   **Authentication:** Magic link email auth with session tokens, role-based access, and member management.
    -   **Command Center Home:** Displays headline metrics, annotated pipeline bar chart, active findings feed, and connector status.
    -   **Detail Pages (Deal/Account):** Full dossier display with health signals, findings, contacts, timelines, and "Ask Pandora" integration.
    -   **Skills Page:** Skills registry, last run status, manual trigger, and run history.
    -   **Connectors Page:** Connector list with sync status and record counts.
    -   **Insights Feed:** Chronological findings list with filtering and pagination.
    -   **Error Boundary:** Global `ErrorBoundary` for crash recovery.
    -   **Design System:** Defined color scheme, skeleton loading, and consistent components.
-   **Deal Intelligence Tools:** Zero-token compute tools for risk scoring. `getDealRiskScore` computes 0-100 health score from active findings (act=-25, watch=-10, notable=-3, info=-1). `getBatchDealRiskScores` queries once and partitions in memory. `getPipelineRiskSummary` batch-scores all open deals with stage breakdown and grade distribution. API endpoints: `GET /:workspaceId/deals/:dealId/risk-score` and `GET /:workspaceId/pipeline/risk-summary`.
-   **Enhanced Deal Dossier:** `assembleDealDossier` now includes `coverage_gaps` (contacts never on calls, days since last call), `risk_score` (score/grade/signal_counts), and `data_availability` flags.
-   **Startup Optimization:** Express starts immediately, readiness probe, parallelized registration steps, and migration/template seeding via `system_settings` table.
-   **System Settings Table:** Stores server-level configuration like template seed version hash.

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