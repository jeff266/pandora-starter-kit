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