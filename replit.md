# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant, agent-based platform providing GTM (Go-To-Market) data analysis for RevOps teams. It integrates and normalizes data from various sources (CRM, call intelligence, task management, document repositories) into eight core entities. The platform then uses AI to generate actionable insights, aiming to centralize and intelligently process disparate GTM data.

## User Preferences
- Raw SQL with parameterized queries — no ORM
- Minimal dependencies — only install what's needed
- Full control over database queries (complex joins, window functions, aggregations)
- Multi-tenant first — every table scoped by `workspace_id`

## System Architecture

Pandora is built on Node.js 20 with TypeScript 5+, using Express.js and PostgreSQL (Neon) via the `pg` client with raw SQL.

**Core Architectural Patterns:**
-   **Multi-Tenancy:** Data is strictly isolated by `workspace_id`.
-   **Universal Adapter Pattern:** Standardized data ingestion via connectors adhering to a universal adapter interface.
-   **Data Normalization:** Data is transformed into 8 core entities: `deals`, `contacts`, `accounts`, `activities`, `conversations`, `tasks`, `calls`, and `documents`.
-   **Context Layer:** A `context_layer` table, unique per workspace, stores business context in 5 JSONB sections for personalized AI analysis.
-   **Computed Fields Engine:** Orchestrates batch computations for scores like `velocity_score`, `deal_risk`, `engagement_score`, and `health_score`.
-   **Stage Normalization:** `stage_normalized` column maps raw CRM stages to universal values (awareness, qualification, etc.) with specific transforms for HubSpot and Salesforce.
-   **Skill Framework:** Features a registry and runtime for AI-powered skills following a COMPUTE → CLASSIFY → SYNTHESIZE pattern, utilizing a three-tier AI system (deterministic compute, DeepSeek for classify, Claude for synthesize).
-   **Sync Infrastructure:** Includes a daily SyncScheduler, orchestrator, `sync_log` table, and supports manual asynchronous syncs.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client and raw SQL for performance and control.
-   **No `raw_records` table:** Raw API data is stored in a `source_data JSONB` column within entity tables.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` is used for efficient data synchronization.
-   **On-Demand Transcript Fetching:** Call transcripts are fetched only when required to optimize storage.
-   **API Design:** RESTful API for managing workspaces, connectors, and triggering actions.
-   **Query Layer:** Seven query modules with dynamic parameterized SQL, workspace scoping, and pagination, exposed via REST endpoints.
-   **Slack Output Layer:** General-purpose Slack Block Kit client with formatting helpers and skill-specific formatters for automated skill result posting.
-   **Webhook Endpoints:** Inbound webhooks for skill triggers, run status, and event ingestion.
-   **LLM Integration:** Utilizes Anthropic Claude via Replit AI for reasoning/generation and Fireworks DeepSeek for extraction/classification, with token guardrails and prompt safety mechanisms.

## External Dependencies

-   **PostgreSQL (Neon):** Primary database.
-   **HubSpot API:** CRM data integration.
-   **Gong API:** Call intelligence.
-   **Fireflies API:** Conversation intelligence.
-   **Monday.com API:** Task management.
-   **Google Drive API:** Document management.
-   **Anthropic AI (Claude):** For reasoning and generation tasks.
-   **Fireworks AI (DeepSeek V3):** For classification and extraction tasks.