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
-   **Conversational Agent:** Multi-turn AI chat for Slack and Command Center with three-tier routing (heuristic→DeepSeek→Claude), unified orchestrator, thread anchoring, and structured state management. Includes implicit feedback detection (confirm/correct/dismiss patterns at zero tokens).
-   **Feedback & Learning System:** `workspace_annotations` and `feedback_signals` tables capture entity-level knowledge from user interactions. Annotations are injected into dossiers ("Team Notes"), skill synthesis prompts, and chat context. Feedback signals (thumbs up/down, confirm, dismiss) drive dismiss velocity analysis that generates ConfigSuggestions. Daily cron expires old annotations. Learning dashboard in Settings shows accumulated knowledge.
-   **Quota Management System:** `quota_periods` and `rep_quotas` tables store per-rep quota targets with period tracking (monthly/quarterly/annual). Sources: manual entry, CSV/Excel upload, or HubSpot Goals sync. HubSpot sync uses preview→confirm pattern storing pending preview in context_layer JSONB. Quotas tab in Settings with import, preview modal, inline edit, period navigation. Contextual banners on Command Center and Deals pages for missing/stale quotas and pending HubSpot goals.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client and raw SQL for optimal performance and control.
-   **Data Storage:** Raw API data stored within a `source_data JSONB` column in entity tables.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` for efficient data synchronization.
-   **LLM Integration:** Anthropic Claude for reasoning/generation, and Fireworks DeepSeek for extraction/classification, with token guardrails.
-   **Cross-Entity Linker:** Post-sync batch job resolves foreign keys between entities.
-   **ICP Enrichment Pipeline:** 6-step pipeline for closed deal analysis, including Apollo API enrichment and Serper Google search.
-   **Token Usage Tracking:** `token_usage` table tracks token consumption.
-   **Slack App Infrastructure:** Dual-mode `SlackAppClient`, signature verification, API endpoints for events and interactions, thread anchoring, message tracking, and channel configuration.
-   **Scoped Analysis Engine:** `server/analysis/scoped-analysis.ts` — AI-powered "ask about this entity" with 4 scope types (deal, account, pipeline, rep). Compact text context compressors (~4K tokens) replace raw JSON dumps. Claude responses parsed for CONFIDENCE (high/medium/low) and FOLLOWUPS. Returns `AnalysisResult` with answer, data_consulted, confidence, suggested_followups, tokens_used, latency_ms. In-memory rate limiter (10 req/min/workspace), 500-char question limit. Pre-built question suggestions per scope via `getAnalysisSuggestions()`.
-   **Dossier Assemblers:** `server/dossiers/` — Enhanced deal and account dossiers with enrichment sections, engagement_level tracking (active/fading/dark), buying_role/seniority on contacts, coverage_gaps with unlinked_calls, relationship_health metrics (conversations_last_30d/90d, coverage_percentage, engagement_trend), metadata with assembly timing, error resilience per sub-query, and optional Claude narrative synthesis via `?narrative=true`.
-   **Command Center (Backend):** Backend API for findings extraction, dossier assembly (deals, accounts), scoped analysis with Claude synthesis, findings snooze/resolve/PATCH endpoints, pipeline snapshot with quota & findings summary, connectors status with health indicators, backfill-findings admin route, and analyze suggestions.
-   **Actions Queue:** Full action lifecycle with status tabs (Pending/Snoozed/Executed/Rejected/Failed), approve/execute/reject/snooze workflows, CRM write-back via playbook executor, operation log display, failed state with retry, action type filters, automatic expiry scheduler (14-day TTL). Routes: `server/routes/action-items.ts`, executor: `server/actions/executor.ts`.
-   **Playbooks System:** Derived playbook groups from cron schedules with stable IDs (SHA-256). Cards show skill pipelines, run stats, and last run status. Detail view with COMPUTE→CLASSIFY→SYNTHESIZE phase visualization, recent findings, run history table. Run Now for skill-based playbooks; agent-only playbooks marked appropriately. Routes: `server/routes/playbooks.ts`, frontend: `client/src/pages/Playbooks.tsx`.
-   **Command Center (Frontend):** React + TypeScript UI with Vite, featuring authentication, home dashboard with Recharts pipeline visualization and finding action buttons (snooze/resolve), deals/accounts lists, detail pages with ask-about-entity and stage history, skills management with run history, connectors page with sync buttons and health indicators, insights feed with finding detail expansion and actionability badges, TopBar with time range selector and refresh button, connector status strip, and settings. Interactive pipeline chart: click stage bars to filter findings feed (with filter chip), click finding badges for inline deal expansion panel, enhanced tooltips with finding summaries. Auto-refresh polling on Command Center (5 min) and Actions (2 min) with visibility-aware refetch and "Updated Xm ago" indicator. SectionErrorBoundary wrapping on all major page sections for graceful degradation. Skeleton loading states with surfaceRaised pulsing animation on all pages.
-   **Demo Mode (Anonymization):** Frontend-only toggle (`client/src/lib/anonymize.ts`, `client/src/contexts/DemoModeContext.tsx`) that replaces all real entity data with realistic fakes for screenshot-safe sharing. Deterministic session-based mappings via seeded hash — same real name always maps to same fake within a session, but different fakes across sessions. Toggle in sidebar footer persists via localStorage. Purple banner when active. Applied to all 9 data pages (CommandCenter, DealList, DealDetail, AccountList, AccountDetail, Actions, Playbooks, InsightsPage, WorkspacePicker). Anonymizes: company names, person names, emails, deal names, dollar amounts, workspace names, and narrative text blocks. Leaves real: stage names, connector types, metric counts.
-   **Consultant Dashboard (Multi-Workspace):** Cross-workspace portfolio view at `/portfolio` for consultants managing multiple clients. Backend endpoint `GET /api/consultant/dashboard` (`server/routes/consultant.ts`) queries all user-accessible workspaces with parallel aggregation of pipeline, findings, actions, connectors, and skill runs. 5-minute in-memory cache. Frontend (`client/src/pages/ConsultantDashboard.tsx`) with greeting header, 4 totals metric cards, workspace cards sorted by urgency (red/yellow/green/gray status dots), data source badges, freshness indicators, skeleton loading, staggered fade-up animation, 5-min auto-refresh. "All Clients" nav item in sidebar when user has multiple workspaces. Fully integrated with Demo Mode. Includes unassigned calls triage section with assign/skip workflows (optimistic updates, card animations, skip reason popover), call distribution stats (expandable breakdown by method), and red notification badge on sidebar nav for unassigned count.
-   **Consultant Call Intelligence (Frontend):** Connector setup section at top of Connectors page (visibility-guarded for multi-workspace users only). Connect Fireflies modal with API key validation, connected card showing sync stats (total/assigned/unassigned counts with percentages), Sync Now with inline spinner, Disconnect with confirmation. Single-workspace users see zero changes. All consultant API calls use raw fetch to `/api/consultant/*` endpoints with Bearer token auth.
-   **Push Delivery System:** `delivery_channels`, `delivery_rules`, `delivery_log` tables. Channels (Slack/Email/Webhook) with test verification, Rules with cron/skill_run/threshold triggers + severity/skill/amount filters + 4 templates (standard/alert/digest/raw_json), Delivery Log with status/rule/time-range filtering and pagination. Backend: `server/routes/push.ts` with cron scheduler and threshold poller. Frontend: `client/src/pages/PushPage.tsx` with 3-tab layout (Channels wizard, Rules wizard, Log), PushBanner on Command Center promoting rule setup. Sidebar nav under OPERATIONS.
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