# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant, agent-based platform providing Go-To-Market (GTM) data analysis for RevOps teams. It integrates and normalizes GTM data from various sources (CRM, call intelligence, task management, document repositories) into eight core entities. The platform utilizes AI to generate actionable insights, aiming to enhance decision-making, refine GTM strategies, and improve overall business vision and market potential.

## User Preferences
- Raw SQL with parameterized queries — no ORM
- Minimal dependencies — only install what's needed
- Full control over database queries (complex joins, window functions, aggregations)
- Multi-tenant first — every table scoped by `workspace_id`

## System Architecture
Pandora is built on Node.js 20 with TypeScript 5+, using Express.js and PostgreSQL (Neon) via the `pg` client with raw SQL.

**Core Architectural Patterns:**
-   **Multi-Tenancy:** Strict data isolation using `workspace_id`.
-   **Universal Adapter Pattern:** Standardizes data ingestion from diverse connectors.
-   **Data Normalization:** Transforms raw data into 8 core entities: `deals`, `contacts`, `accounts`, `activities`, `conversations`, `tasks`, `calls`, and `documents`.
-   **Context Layer:** A `context_layer` table, unique per workspace, stores business context in 5 JSONB sections for personalized AI analysis.
-   **Skill Framework:** A registry and runtime for AI-powered skills, employing a COMPUTE → CLASSIFY → SYNTHESIZE pattern with a three-tier AI system.
-   **Computed Fields Engine:** Orchestrates batch computations for various scores (e.g., `velocity_score`, `deal_risk`, `engagement_score`).
-   **Sync Infrastructure:** Supports scheduled and manual asynchronous data synchronizations.
-   **Agent Runner Framework:** Composes multiple skills into unified briefings, synthesizing outputs into narratives for Slack delivery, with built-in agents and a scheduler.
-   **Conversational Agent:** Multi-turn AI chat for Slack and Command Center with intent classification and dynamic reply/question handlers.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client and raw SQL for optimal performance and control.
-   **Data Storage:** Raw API data stored within a `source_data JSONB` column in entity tables.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` for efficient data synchronization.
-   **LLM Integration:** Anthropic Claude for reasoning/generation, and Fireworks DeepSeek for extraction/classification, with token guardrails.
-   **Cross-Entity Linker:** Post-sync batch job resolves foreign keys between entities.
-   **ICP Enrichment Pipeline:** 6-step pipeline for closed deal analysis, including Apollo API enrichment and Serper Google search.
-   **Token Usage Tracking:** `token_usage` table tracks token consumption.
-   **Slack App Infrastructure:** Dual-mode `SlackAppClient`, signature verification, API endpoints for events and interactions, thread anchoring, message tracking, and channel configuration.
-   **Command Center (Backend):** Backend API for findings extraction, dossier assembly (deals, accounts), and scoped analysis with Claude synthesis.
-   **Command Center (Frontend):** React + TypeScript UI with Vite, featuring authentication, home dashboard, deals/accounts lists, detail pages, skills management, connectors health, insights feed, and settings.
-   **Voice & Tone System:** Per-workspace voice configuration (detail_level, framing, alert_threshold) dynamically injected into skill synthesis prompts via Handlebars.
-   **WorkbookGenerator:** Provides multi-tab `.xlsx` export services for skill and agent runs.

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