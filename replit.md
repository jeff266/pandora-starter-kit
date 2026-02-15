# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant, agent-based platform providing Go-To-Market (GTM) data analysis for RevOps teams. It integrates and normalizes GTM data from various sources (CRM, call intelligence, task management, document repositories) into eight core entities. The platform then leverages AI to generate actionable insights, aiming to enhance decision-making and GTM strategy, improve business vision, and gain market potential.

## User Preferences
- Raw SQL with parameterized queries — no ORM
- Minimal dependencies — only install what's needed
- Full control over database queries (complex joins, window functions, aggregations)
- Multi-tenant first — every table scoped by `workspace_id`

## System Architecture
Pandora is built on Node.js 20 with TypeScript 5+, utilizing Express.js and PostgreSQL (Neon) via the `pg` client with raw SQL.

**Core Architectural Patterns:**
-   **Multi-Tenancy:** Strict data isolation by `workspace_id`.
-   **Universal Adapter Pattern:** Standardized data ingestion through connectors.
-   **Data Normalization:** Data transformed into 8 core entities: `deals`, `contacts`, `accounts`, `activities`, `conversations`, `tasks`, `calls`, and `documents`.
-   **Context Layer:** A `context_layer` table, unique per workspace, stores business context in 5 JSONB sections for personalized AI analysis.
-   **Quota System:** Manages team and per-rep quotas for attainment calculations.
-   **Computed Fields Engine:** Orchestrates batch computations for scores like `velocity_score`, `deal_risk`, `engagement_score`, and `health_score`.
-   **Stage Normalization:** Maps raw CRM stages to universal values.
-   **Skill Framework:** A registry and runtime for AI-powered skills, employing a COMPUTE → CLASSIFY → SYNTHESIZE pattern with a three-tier AI system (deterministic compute, DeepSeek for classify, Claude for synthesize).
-   **Sync Infrastructure:** Daily SyncScheduler, orchestrator, and support for manual asynchronous syncs.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client and raw SQL for performance and control.
-   **Data Storage:** Raw API data stored in a `source_data JSONB` column within entity tables; no separate `raw_records` table.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` for efficient data synchronization.
-   **On-Demand Transcript Fetching:** Call transcripts fetched only when required.
-   **Two-Step Conversation Connect Flow:** Ensures only relevant calls from tracked reps are synced.
-   **API Design:** RESTful API for managing workspaces, connectors, and actions.
-   **Query Layer:** Seven query modules with dynamic parameterized SQL, workspace scoping, and pagination.
-   **Slack Output Layer:** General-purpose Slack Block Kit client for automated skill result posting.
-   **Webhook Endpoints:** Inbound webhooks for skill triggers, run status, and event ingestion.
-   **Cross-Entity Linker:** Post-sync batch job to resolve foreign keys between conversations, contacts, accounts, and deals using a 3-tier matching process.
-   **Internal Meeting Filter:** Classifies conversations as internal/external post-sync.
-   **CWD (Conversations Without Deals):** Detects external conversations linked to accounts but not deals.
-   **Deal Insights Extraction:** Extracts insights (next_steps, objections, decision_criteria, etc.) from conversation transcripts into a versioned `deal_insights` table, leveraging DeepSeek.
-   **LLM Integration:** Anthropic Claude for reasoning/generation and Fireworks DeepSeek for extraction/classification, with token guardrails.
-   **Tier 2 Schema (ICP/Lead Scoring):** Includes `account_signals`, `icp_profiles`, and `lead_scores`.
-   **File Import Connector:** Manages CSV/Excel uploads, including DeepSeek classification, record tracking, and import strategies.
-   **Association Inference:** Post-import linking engine for accounts, contacts, and deals.
-   **ICP Enrichment Pipeline:** A 6-step pipeline for closed deal analysis, involving contact role resolution, Apollo API enrichment, Serper Google search for signals, and derived feature computation.
-   **Industry Normalization:** Maps various CRM and external data formats to consistent industry values.
-   **Handlebars Template Engine:** Used in the skill runtime for flexible prompt rendering.
-   **Workflow Engine:** Integrates with ActivePieces for workflow automation.
-   **Token Usage Tracking:** `token_usage` table with per-call instrumentation and three API endpoints for summary, detail, and anomaly detection.
-   **Agent Runner Framework:** Composes multiple skills into unified briefings, synthesizing outputs into a narrative for Slack delivery. Includes six built-in agents and a scheduler.
-   **Deal Risk Token Optimization:** Optimized `deal-risk-review` by replacing multi-turn tool conversations with a `summarizeForClaude` compute step, significantly reducing token usage.
-   **Bowtie Stage Discovery:** Detects post-sale/bowtie stages in CRM data via pattern matching.
-   **Bowtie Analysis Skill:** Full-funnel bowtie analysis skill (`bowtie-analysis`) with 7 compute functions following the COMPUTE → CLASSIFY → SYNTHESIZE pattern.
-   **Pipeline Goals Skill:** Reverse-math activity goals skill (`pipeline-goals`) with 5 compute functions, with quota fallback.
-   **Project Updates & Recap:** `project_updates` table and `project-recap` skill for loading and formatting project updates.
-   **Strategy Insights Skill:** Cross-skill pattern analysis (`strategy-insights`) querying `skill_runs` and `agent_runs` for trend analysis and strategic recommendations.
-   **Composition Agents:** Includes `attainment-vs-goal`, `friday-recap`, and `strategy-insights` agents combining multiple skills for specific analyses and reporting.
-   **Workspace Config System:** Config schema, loader, inference engine, instant audit, drift detection, and config suggestions with accept/dismiss workflow.
-   **Workspace Config Audit Skill:** `workspace-config-audit` skill with 8 drift checks, generating config suggestions.
-   **Evidence Infrastructure:** Full evidence population across all skills with `SkillEvidence` type, accumulating `skillEvidence` map in agent runs.
-   **Slack Formatter Upgrade:** `formatWithEvidence()` and `formatAgentWithEvidence()` render structured claim blocks with severity indicators.
-   **WorkbookGenerator (Excel Export):** Multi-tab `.xlsx` export service with summary, methodology, and skill-specific data tabs.
-   **Export API Endpoints:** `GET /api/workspaces/:id/skills/:skillId/runs/:runId/export` and `GET /api/workspaces/:id/agents/:agentId/runs/:runId/export` for `.xlsx` workbook exports.

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