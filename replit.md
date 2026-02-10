# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant, agent-based platform designed to empower RevOps teams with comprehensive GTM (Go-To-Market) data analysis. It integrates with various systems like CRM, call intelligence, task management, and document repositories, normalizing diverse data into eight core entities. The platform then leverages AI-powered analyses to provide actionable insights. Its primary purpose is to streamline GTM operations by centralizing and intelligently processing disparate data sources.

## User Preferences
- Raw SQL with parameterized queries — no ORM
- Minimal dependencies — only install what's needed
- Full control over database queries (complex joins, window functions, aggregations)
- Multi-tenant first — every table scoped by `workspace_id`

## System Architecture

Pandora is built on Node.js 20 with TypeScript 5+, utilizing Express.js for its server and PostgreSQL (Neon) via the `pg` client for its database, exclusively using raw SQL.

**Core Architectural Patterns:**
-   **Multi-Tenancy:** All data is strictly isolated by `workspace_id`, ensuring tenant separation.
-   **Universal Adapter Pattern:** Connectors for various platforms (CRM, Conversation, Task, Document) adhere to a universal adapter interface, managed by an `AdapterRegistry` singleton. This allows for standardized data ingestion and processing.
-   **Data Normalization:** Data from all sources is normalized into 8 core entities: `deals`, `contacts`, `accounts`, `activities`, `conversations`, `tasks`, `calls`, and `documents`.
-   **Context Layer:** A `context_layer` table, unique per workspace, stores critical business context in 5 JSONB sections, allowing for personalized AI analysis.
-   **Computed Fields Engine:** A batch computation orchestrator calculates various scores (e.g., `velocity_score`, `deal_risk`, `engagement_score`, `health_score`) to enrich entity data.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client usage with raw SQL for maximum control and performance.
-   **No `raw_records` table:** Raw API data is stored within the `source_data JSONB` column of each entity table.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` is used across all entity tables to efficiently manage data synchronization.
-   **On-Demand Transcript Fetching:** Transcripts for calls are fetched only when needed to optimize data storage and API calls.
-   **API Design:** RESTful API endpoints for managing workspaces, connectors, context layers, and triggering actions.
-   **Sync Infrastructure:** SyncScheduler (node-cron 2 AM UTC daily), sync orchestrator, sync_log table for history tracking. Manual sync via POST returns 202 Accepted and runs async. HubSpot association backfill runs post-sync when `usedExportApi` flag is set in sync_cursor metadata.
-   **Query Layer:** 7 query modules in `server/tools/` (deals, contacts, accounts, activities, conversations, tasks, documents) with dynamic parameterized SQL, workspace scoping, sort whitelisting, and pagination. Barrel-exported from `server/tools/index.ts`. REST endpoints in `server/routes/data.ts` map all query functions to GET endpoints under `/api/workspaces/:id/`.

**Technology Choices:**
-   **Runtime:** Node.js 20
-   **Language:** TypeScript 5+ (strict mode, ESM)
-   **Framework:** Express.js
-   **Database:** PostgreSQL (Neon) with `pg` client
-   **Dev Tools:** tsx, dotenv

## External Dependencies

-   **PostgreSQL (Neon):** Primary database for all application data.
-   **HubSpot API:** Integrated for CRM data, including deals, contacts, and companies. Utilizes OAuth for authentication and handles property discovery and various sync modes.
-   **Gong API:** Integrated for call intelligence, providing conversation metadata and on-demand transcript fetching. Uses Basic Authentication.
-   **Fireflies API:** Integrated for conversation intelligence, offering transcripts and summaries via a GraphQL API. Uses API key authentication.
-   **Monday.com API:** Integrated for task management, enabling reading and writing of tasks.
-   **Google Drive API:** Integrated for document management, supporting content export and extraction. Uses OAuth2.
-   **Anthropic AI (Claude):** Utilized via `@anthropic-ai/sdk` for LLM-based analyses within the platform.