# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant, agent-based platform designed to provide Go-To-Market (GTM) data analysis for RevOps teams. It centralizes and intelligently processes disparate GTM data by integrating and normalizing information from various sources (CRM, call intelligence, task management, document repositories) into eight core entities. The platform then leverages AI to generate actionable insights, aiming to enhance decision-making and GTM strategy.

## User Preferences
- Raw SQL with parameterized queries — no ORM
- Minimal dependencies — only install what's needed
- Full control over database queries (complex joins, window functions, aggregations)
- Multi-tenant first — every table scoped by `workspace_id`

## System Architecture

Pandora is built on Node.js 20 with TypeScript 5+, utilizing Express.js and PostgreSQL (Neon) via the `pg` client with raw SQL.

**Core Architectural Patterns:**
-   **Multi-Tenancy:** Strict data isolation by `workspace_id`.
-   **Universal Adapter Pattern:** Standardized data ingestion through connectors with a universal interface.
-   **Data Normalization:** Data is transformed into 8 core entities: `deals`, `contacts`, `accounts`, `activities`, `conversations`, `tasks`, `calls`, and `documents`.
-   **Context Layer:** A `context_layer` table, unique per workspace, stores business context in 5 JSONB sections for personalized AI analysis.
-   **Quota System:** Manages team and per-rep quotas, feeding into the forecast skill for attainment calculations.
-   **Computed Fields Engine:** Orchestrates batch computations for various scores like `velocity_score`, `deal_risk`, `engagement_score`, and `health_score`.
-   **Stage Normalization:** Maps raw CRM stages to universal values.
-   **Skill Framework:** A registry and runtime for AI-powered skills, employing a COMPUTE → CLASSIFY → SYNTHESIZE pattern with a three-tier AI system (deterministic compute, DeepSeek for classify, Claude for synthesize).
-   **Sync Infrastructure:** Includes a daily SyncScheduler, orchestrator, and support for manual asynchronous syncs.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client and raw SQL for performance and control.
-   **No `raw_records` table:** Raw API data is stored in a `source_data JSONB` column within entity tables.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` for efficient data synchronization.
-   **On-Demand Transcript Fetching:** Call transcripts are fetched only when required.
-   **Two-Step Conversation Connect Flow:** Ensures only relevant calls from tracked reps are synced.
-   **Tracked Users in `connections.metadata`:** User directories and tracked user selections are stored within the `connections` table.
-   **Per-User Filtered Sync:** Specific filters (`primaryUserId`, `organizer_email`) are used for conversation platforms to manage rate limits and relevance.
-   **Unified Sales Roster:** Aggregates tracked users across conversation connectors for rep-level analysis.
-   **API Design:** RESTful API for managing workspaces, connectors, and actions.
-   **Query Layer:** Seven query modules with dynamic parameterized SQL, workspace scoping, and pagination.
-   **Slack Output Layer:** General-purpose Slack Block Kit client for automated skill result posting.
-   **Webhook Endpoints:** Inbound webhooks for skill triggers, run status, and event ingestion.
-   **Cross-Entity Linker:** Post-sync batch job to resolve foreign keys between conversations, contacts, accounts, and deals using a 3-tier matching process.
-   **Internal Meeting Filter:** Classifies conversations as internal/external post-sync to focus on external interactions.
-   **CWD (Conversations Without Deals):** Detects external conversations linked to accounts but not deals, with severity classification and rep attribution.
-   **Deal Insights Extraction:** Extracts insights (next_steps, objections, decision_criteria, etc.) from conversation transcripts into a versioned `deal_insights` table, leveraging DeepSeek.
-   **LLM Integration:** Utilizes Anthropic Claude for reasoning/generation and Fireworks DeepSeek for extraction/classification, with token guardrails.
-   **Tier 2 Schema (ICP/Lead Scoring):** Includes `account_signals`, `icp_profiles`, and `lead_scores` for advanced analytics.
-   **File Import Connector:** Manages CSV/Excel uploads, including DeepSeek classification, record tracking, and import strategies (replace, merge, append).
-   **Association Inference:** Post-import linking engine for accounts, contacts, and deals.
-   **HubSpot Association-Based Deal Contacts:** Populates deal contacts from HubSpot associations.
-   **ICP Enrichment Pipeline:** A 6-step pipeline for closed deal analysis, involving contact role resolution, Apollo API enrichment, Serper Google search for signals, and derived feature computation.
-   **ICP Discovery Validated:** End-to-end execution validated ICP report generation and signal-based lift analysis.
-   **Industry Normalization:** Maps various CRM and external data formats to consistent industry values.
-   **Handlebars Template Engine:** Used in the skill runtime for flexible prompt rendering.
-   **Workflow Engine:** Integrates with ActivePieces for workflow automation, including definition management, execution tracking, templates, and a connector registry.
-   **Token Usage Tracking:** `token_usage` table with per-call instrumentation (workspace, skill, run, phase, step, provider, model, input/output tokens, cost, latency, payload diagnostics). Three API endpoints: summary (by skill/provider/phase), skill detail (last 10 runs with phase breakdown), anomalies (stddev-based outlier detection). Integrated into LLM router and skill runtime for automatic capture.
-   **Agent Runner Framework:** Composes multiple skills into unified briefings. Agents run skills sequentially, collect outputs keyed by `outputKey`, synthesize via Claude into a narrative, and deliver to Slack. Registry (`server/agents/registry.ts`), runtime (`server/agents/runtime.ts`), types (`server/agents/types.ts`), DB table (`agent_runs`). Six built-in agents: `pipeline-state` (Monday 7 AM cron), `forecast-call-prep` (manual trigger), `bowtie-review` (Monday 7 AM cron), `attainment-vs-goal` (Mon/Thu 7 AM cron), `friday-recap` (Friday 4 PM cron), and `strategy-insights` (Wednesday 9 AM cron). API: `GET /api/agents`, `POST /api/agents/:id/run`, `GET /api/agents/:id/runs`. Scheduler integration in `skill-scheduler.ts`.
-   **Deal Risk Token Optimization:** Replaced `claudeTools` + `maxToolCalls` pattern in `deal-risk-review` with a `summarizeForClaude` compute step that batch-fetches activities and contacts for all 20 deals in 2 SQL queries. Eliminates multi-turn tool conversations (83K→<10K tokens, ~90% reduction).
-   **Bowtie Stage Discovery:** Detects post-sale/bowtie stages (onboarding, adoption, expansion, renewal, churned) in CRM data via pattern matching. Results stored in `context_layer.definitions.bowtie_discovery`. API: `POST /api/workspaces/:id/bowtie/discover`, `GET /api/workspaces/:id/bowtie`. Located in `server/analysis/bowtie-discovery.ts`.
-   **Bowtie Analysis Skill:** Full-funnel bowtie analysis skill (`bowtie-analysis`) with 7 compute functions: loadBowtieMapping, computeLeftSideFunnel, computeConversionRates, computeRightSideFunnel, computeBottlenecks, computeActivityCorrelation, prepareBowtieSummary. Follows COMPUTE → CLASSIFY → SYNTHESIZE pattern. Located in `server/skills/compute/bowtie-analysis.ts` and `server/skills/library/bowtie-analysis.ts`.
-   **Pipeline Goals Skill:** Reverse-math activity goals skill (`pipeline-goals`) with 5 compute functions: loadTargetsAndActuals, calculateHistoricalRates, computeReverseMath, computeRepBreakdown, preparePipelineGoalsSummary. Quota fallback to trailing 3-month average. Located in `server/skills/compute/pipeline-goals.ts` and `server/skills/library/pipeline-goals.ts`.
-   **Project Updates & Recap:** `project_updates` table (workspace-scoped, weekly upsert) with REST API (`POST/GET /api/workspaces/:id/project-updates`, `GET .../latest`). `project-recap` skill (compute-only) loads and formats project updates with cross-workspace summary for the Friday Recap agent.
-   **Strategy Insights Skill:** Cross-skill pattern analysis (`strategy-insights`) that queries `skill_runs` and `agent_runs` for the last 14 days, gathers cross-workspace metrics (deals, ICP profiles, lead scores), and trend analysis (stage movement). Claude synthesizes patterns, contradictions, and strategic recommendations.
-   **Attainment vs Goal Agent:** Composition agent (`attainment-vs-goal`) combining pipeline-goals + forecast-rollup + pipeline-coverage + rep-scorecard. Mon/Thu 7 AM cron. Makes a clear call: "will we hit the number or not?"
-   **Friday Recap Agent:** Composition agent (`friday-recap`) combining weekly-recap + project-recap + pipeline-goals. Friday 4 PM cron. Produces a two-half email: pipeline results + RevOps team accomplishments.
-   **Strategy & Insights Agent:** Capstone agent (`strategy-insights`) combining strategy-insights skill + pipeline-hygiene + bowtie-analysis. Wednesday 9 AM cron. Identifies cross-cutting patterns across all skill outputs.

## Recent Changes (Feb 14, 2026)
-   **Workspace Config Audit Skill (Prompt 4):** New `workspace-config-audit` skill with 8 drift checks (roster, stages, velocity, win rate, segmentation, coverage target, stale threshold, field fill rates). Follows COMPUTE → CLASSIFY → SYNTHESIZE pattern. Biweekly schedule (1st/15th at 7 AM). Generates config suggestions as side effects. Located in `server/skills/compute/workspace-config-audit.ts` and `server/skills/library/workspace-config-audit.ts`. API: `GET /api/workspaces/:id/config-audit/history`.
-   **Workspace Config System (Prompts 1-3):** Config schema (7 sections), loader with 12+ convenience methods, inference engine (8 sources), instant audit, drift detection, config suggestions with accept/dismiss workflow. Files in `server/config/`, `server/types/workspace-config.ts`, `server/routes/workspace-config.ts`.
-   **Deal Stage History Schema Migration:** Migrated all stage history queries from old schema (`from_stage/to_stage/changed_at/duration_in_previous_stage_ms`) to new residency-based schema (`stage/entered_at/exited_at/duration_days`). Updated `stage-history-queries.ts`, `rep-scorecard-analysis.ts`, `stage-tracker.ts`, `snapshot-diff.ts`. Uses LAG window functions for backward-compatible transition views.
-   **Activities Column Fix:** Fixed `pipeline-goals.ts` `computeRepBreakdown` to use `actor` column instead of non-existent `owner` in activities table. Rep breakdown now returns correct count (4 reps).
-   **Deal Contacts Source Constraint:** Fixed `contact-role-resolution.ts` UPSERT to include `source` column matching the `(workspace_id, deal_id, contact_id, source)` unique constraint.
-   **Agent-Level Skill Caching Validated:** Confirmed 30-min TTL cache works correctly in agent runtime (not direct skill API). Verified with attainment-vs-goal agent reusing pipeline-goals output.

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