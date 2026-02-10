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
-   **Computed Fields Engine:** A batch computation orchestrator calculates various scores (e.g., `velocity_score`, `deal_risk`, `engagement_score`, `health_score`) to enrich entity data. `health_score = 100 - deal_risk` (simple inversion for now; will become composite formula later).
-   **Stage Normalization:** `stage_normalized` column on deals maps raw CRM stages to universal values: `awareness`, `qualification`, `evaluation`, `decision`, `negotiation`, `closed_won`, `closed_lost`. HubSpot defaults hardcoded; per-workspace override via context_layer planned.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client usage with raw SQL for maximum control and performance.
-   **No `raw_records` table:** Raw API data is stored within the `source_data JSONB` column of each entity table.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` is used across all entity tables to efficiently manage data synchronization.
-   **On-Demand Transcript Fetching:** Transcripts for calls are fetched only when needed to optimize data storage and API calls.
-   **API Design:** RESTful API endpoints for managing workspaces, connectors, context layers, and triggering actions.
-   **Sync Infrastructure:** SyncScheduler (node-cron 2 AM UTC daily), sync orchestrator, sync_log table for history tracking. Manual sync via POST returns 202 Accepted and runs async. HubSpot association backfill runs post-sync when `usedExportApi` flag is set in sync_cursor metadata.
-   **Query Layer:** 7 query modules in `server/tools/` (deals, contacts, accounts, activities, conversations, tasks, documents) with dynamic parameterized SQL, workspace scoping, sort whitelisting, and pagination. Barrel-exported from `server/tools/index.ts`. REST endpoints in `server/routes/data.ts` map all query functions to GET endpoints under `/api/workspaces/:id/`.
-   **Slack Output Layer:** General-purpose Slack Block Kit client (`server/connectors/slack/client.ts`) with formatting helpers (header, section, divider, fields, context) and `buildMessage` assembler. Webhook URL stored in `workspace.settings.slack_webhook_url`. Routes: `POST /:id/settings/slack` (save), `POST /:id/settings/slack/test` (test). Skill-specific formatters in `server/skills/formatters/slack-formatter.ts`: `formatForSlack` router dispatches to `formatPipelineHygiene`, `formatWeeklyRecap`, `formatDealRiskReview` based on `skill.slackTemplate`. Pipeline-hygiene template parses Claude markdown into 5 sections with emoji indicators, smart truncation, and 48-block cap. Auto-posts to Slack webhook after skill completion if configured.
-   **Webhook Endpoints:** Inbound n8n webhook routes (`server/routes/webhooks.ts`): `POST /api/webhooks/skills/:skillId/trigger` (queues skill run), `GET /api/webhooks/skills/:skillId/runs/:runId` (run status), `POST /api/webhooks/events` (event ingestion for sync_completed, deal_stage_changed, new_conversation). Skill runtime will pick up queued runs when wired in.

**Skill Framework (Phase 3):**
-   **Registry + Runtime:** `SkillRegistry` singleton manages skill definitions; `SkillRuntime` executes steps in dependency order (topological sort).
-   **Three-Tier AI:** `compute` (deterministic query functions), `deepseek` (Fireworks API, not yet wired), `claude` (Anthropic via Replit AI integration).
-   **Tool Definitions:** 30+ tools in `server/skills/tool-definitions.ts` wrapping query layer + compute functions. `workspaceId` injected from execution context (never in tool params).
-   **Built-in Skills:** `pipeline-hygiene` (pipeline quality analysis), `deal-risk-review` (deal risk assessment), `weekly-recap` (leadership report).
-   **Skill Routes:** `GET /:id/skills` (list), `POST /:id/skills/:skillId/run` (execute), `GET /:id/skills/:skillId/runs` (history), `GET /:id/skills/:skillId/runs/:runId` (detail).
-   **Three-Phase Pattern:** Skills follow COMPUTE → CLASSIFY → SYNTHESIZE. Compute steps pre-aggregate raw data into compact summaries using shared utilities (`server/analysis/aggregations.ts`). Claude receives structured summaries (~4K tokens), never raw arrays.
-   **Aggregation Utilities:** `aggregateBy`, `bucketByThreshold`, `topNWithSummary`, `summarizeDeals` in `server/analysis/aggregations.ts`. Shared across all skills.
-   **Token Guardrails:** Runtime validates input size before Claude/DeepSeek steps — warns >8K tokens, aborts >20K tokens. DeepSeek arrays capped at 30 items.
-   **Prompt Safety:** Template renderer limits arrays to 20 summarized items and truncates objects >8KB as fallback safety net.
-   **Model:** `claude-sonnet-4-5` via Replit AI integration (no date suffix — integration requirement).

**Technology Choices:**
-   **Runtime:** Node.js 20
-   **Language:** TypeScript 5+ (strict mode, ESM)
-   **Framework:** Express.js
-   **Database:** PostgreSQL (Neon) with `pg` client
-   **AI:** LLM Router with capability-based routing: Anthropic Claude (`AI_INTEGRATIONS_ANTHROPIC_API_KEY`) for reason/generate, Fireworks DeepSeek (`FIREWORKS_API_KEY`) for extract/classify
-   **Dev Tools:** tsx, dotenv

## External Dependencies

-   **PostgreSQL (Neon):** Primary database for all application data.
-   **HubSpot API:** Integrated for CRM data, including deals, contacts, and companies. Utilizes OAuth for authentication and handles property discovery and various sync modes.
-   **Gong API:** Integrated for call intelligence, providing conversation metadata and on-demand transcript fetching. Uses Basic Authentication.
-   **Fireflies API:** Integrated for conversation intelligence, offering transcripts and summaries via a GraphQL API. Uses API key authentication.
-   **Monday.com API:** Integrated for task management, enabling reading and writing of tasks.
-   **Google Drive API:** Integrated for document management, supporting content export and extraction. Uses OAuth2.
-   **Anthropic AI (Claude):** Utilized via `@anthropic-ai/sdk` for reasoning and generation within the platform.
-   **Fireworks AI (DeepSeek V3):** Used for classification and extraction via OpenAI-compatible API (`deepseek-v3-0324` model).

## Database Migrations
Eight migrations applied in sequence:
1. `001_initial.sql` — All 8 entity tables, workspaces, connections
2. `002_add_calls_table.sql` — Calls entity
3. `003_context_layer.sql` — Context layer table
4. `004_add_computed_field_columns.sql` — velocity_score, deal_risk, deal_risk_factors on deals
5. `005_sync_log.sql` — Sync log table
6. `006_schema_cleanup.sql` — stage_normalized + health_score on deals, title on conversations
7. `007_skill_runs.sql` — Skill runs table for tracking AI skill executions (status, params, result, token_usage, steps)
8. `008_llm_config.sql` — LLM config table: per-workspace routing, provider config, token budget tracking with monthly reset

## DeepSeek Response Handling
DeepSeek sometimes returns objects instead of arrays (e.g., `{ classifications: [...] }` instead of `[...]`). Two-layer defense:
1. **Runtime normalization** (`runtime.ts`): When `deepseekSchema.type === 'array'` but response is an object, unwraps by selecting the largest array value.
2. **Tool validation** (`tool-definitions.ts`): `calculateOutputBudget` validates classification items have expected fields (`dealName`, `root_cause`, `suggested_action`) before accepting.

## Smoke Test
Run `npm run smoke-test` to validate the full pipeline end-to-end with synthetic data (24 tests covering all query functions, computed fields, and pipeline snapshot). Use `--keep` flag to preserve test data for inspection.