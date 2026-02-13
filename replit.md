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
-   **Quota System:** `quota_periods` and `rep_quotas` tables store team and per-rep quotas by period. `checkQuotaConfig` queries active period (date-bounded) first, falls back to context layer `goals_and_targets`. Quota data flows into forecast skill for attainment calculations.
-   **Computed Fields Engine:** Orchestrates batch computations for scores like `velocity_score`, `deal_risk`, `engagement_score`, and `health_score`.
-   **Stage Normalization:** `stage_normalized` column maps raw CRM stages to universal values (awareness, qualification, etc.) with specific transforms for HubSpot and Salesforce.
-   **Skill Framework:** Features a registry and runtime for AI-powered skills following a COMPUTE → CLASSIFY → SYNTHESIZE pattern, utilizing a three-tier AI system (deterministic compute, DeepSeek for classify, Claude for synthesize).
-   **Sync Infrastructure:** Includes a daily SyncScheduler, orchestrator, `sync_log` table, and supports manual asynchronous syncs.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client and raw SQL for performance and control.
-   **No `raw_records` table:** Raw API data is stored in a `source_data JSONB` column within entity tables.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` is used for efficient data synchronization.
-   **On-Demand Transcript Fetching:** Call transcripts are fetched only when required to optimize storage.
-   **Two-Step Conversation Connect Flow:** Connect credentials → fetch user directory → user selects tracked reps → sync ONLY their calls. Prevents ingesting irrelevant conversations (engineering standups, HR 1:1s).
-   **Tracked Users in `connections.metadata`:** User directories and tracked user selections stored in `metadata JSONB` column on `connections` table. No new tables needed.
-   **Per-User Filtered Sync:** Gong uses `primaryUserId` filter on `/v2/calls/extensive`, Fireflies uses `organizer_email` filter. Sequential per-user fetching respects rate limits.
-   **Unified Sales Roster:** `GET /api/workspaces/:id/sales-roster` merges tracked users across all conversation connectors by email, used by skills for rep-level analysis.
-   **API Design:** RESTful API for managing workspaces, connectors, and triggering actions.
-   **Query Layer:** Seven query modules with dynamic parameterized SQL, workspace scoping, and pagination, exposed via REST endpoints.
-   **Slack Output Layer:** General-purpose Slack Block Kit client with formatting helpers and skill-specific formatters for automated skill result posting.
-   **Webhook Endpoints:** Inbound webhooks for skill triggers, run status, and event ingestion.
-   **Cross-Entity Linker:** Post-sync batch job resolving conversation→contact→account→deal foreign keys via 3-tier matching (email match, CRM native IDs, single-deal inference). Idempotent, auditable via `link_method` column, fires automatically after Gong/Fireflies/HubSpot/Salesforce syncs.
-   **Internal Meeting Filter:** Post-sync classification of conversations as internal/external using dual-layer detection (participant domain check + title heuristics). Persists `is_internal` and `internal_classification_reason` on conversations table. Runs automatically after linker in post-sync flow.
-   **CWD (Conversations Without Deals):** Detects external conversations linked to accounts but not deals, with severity classification, account enrichment, and rep attribution. Exposed via `GET /api/workspaces/:id/conversations-without-deals` and integrated into Data Quality Audit skill.
-   **LLM Integration:** Utilizes Anthropic Claude via Replit AI for reasoning/generation and Fireworks DeepSeek for extraction/classification, with token guardrails and prompt safety mechanisms.
-   **Tier 2 Schema (ICP/Lead Scoring):** `account_signals` (company enrichment), `icp_profiles` (ICP model output with personas/weights), `lead_scores` (per-entity scores with grade/breakdown). `deal_contacts` extended with enrichment columns (apollo_data, linkedin_data, buying_role, enrichment_status, etc.). Custom Field Discovery skill (compute-only, on-demand) analyzes custom_fields JSONB across deals/accounts/contacts/leads for ICP relevance scoring.
-   **Lead Sync:** 5,565 Salesforce leads synced with custom field discovery, FK resolution (converted_contact/account/deal), cohort analysis ready (4,484 converted, 1,081 unconverted).
-   **File Import Connector:** `import_batches` table tracks CSV/Excel uploads with status lifecycle (pending → confirmed → applied → rolled_back), DeepSeek classification results, and per-record insert/update/skip counts. `stage_mappings` table persists workspace-level stage normalization rules per source (csv_import, hubspot, salesforce) with unique constraint on (workspace_id, source, raw_stage). Entity tables already have `source`, `source_id`, `source_data` columns. `csv_import` accepted as connector_name in connections table (no constraint). Migration: `server/migrations/016_file_import_schema.sql`.
-   **Association Inference (Prompt 6):** Post-import linking engine: `buildAccountIndex` creates normalized company name + domain index for O(1) lookups. `linkAllUnlinkedDeals/Contacts` re-link ALL workspace entities (not just newly imported) after account import. `inferContactDealLinks` supports explicit deal-name matching from `associated_deals` column + single-deal-per-account inference for contacts sharing an account with exactly one deal. `relinkAll` runs all linking idempotently (ON CONFLICT DO NOTHING). Route: `POST /import/relink`. Import order warnings alert when importing contacts/deals before accounts exist. AI classifier and heuristic mapper detect `associated_deals` column on contact CSVs.
-   **HubSpot Association-Based Deal Contacts:** `populateDealContactsFromAssociations()` runs during initial sync; `populateDealContactsFromSourceData()` backfills from stored `source_data.associations`. Uses `source = 'hubspot_association'` and `role_source = 'crm_association'`. Unique constraint on `(workspace_id, deal_id, contact_id, source)` allows multiple sources per deal-contact pair. Route: `POST /:workspaceId/connectors/hubspot/populate-deal-contacts` for one-time backfill.

## External Dependencies

-   **PostgreSQL (Neon):** Primary database.
-   **HubSpot API:** CRM data integration.
-   **Gong API:** Call intelligence.
-   **Fireflies API:** Conversation intelligence.
-   **Monday.com API:** Task management.
-   **Google Drive API:** Document management.
-   **Anthropic AI (Claude):** For reasoning and generation tasks.
-   **Fireworks AI (DeepSeek V3):** For classification and extraction tasks.