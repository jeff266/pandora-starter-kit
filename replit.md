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
-   **Dossier Assemblers:** Enhanced deal and account dossiers with enrichment sections, engagement tracking, relationship health metrics, and optional Claude narrative synthesis.
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