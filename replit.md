# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant, agent-based Go-To-Market (GTM) intelligence platform for RevOps teams. It integrates and normalizes GTM data from various sources into eight core entities, leveraging AI to generate actionable insights. The platform aims to enhance decision-making, refine GTM strategies, and improve overall business vision and market potential.

## User Preferences
- Raw SQL with parameterized queries — no ORM
- Minimal dependencies — only install what's needed
- Full control over database queries (complex joins, window functions, aggregations)
- Multi-tenant first — every table scoped by `workspace_id`

## System Architecture
Pandora is built on Node.js 20 with TypeScript 5+, utilizing Express.js and PostgreSQL (Neon) via the `pg` client with raw SQL.

**Core Architectural Patterns:**
-   **Multi-Tenancy:** Strict data isolation enforced by `workspace_id` and Row-Level Security (RLS).
-   **Universal Adapter Pattern:** Standardizes data ingestion from diverse connectors.
-   **Data Normalization:** Transforms raw data into 8 core entities: `deals`, `contacts`, `accounts`, `activities`, `conversations`, `tasks`, `calls`, and `documents`.
-   **Context Layer:** A `context_layer` table, unique per workspace, stores business context in JSONB for personalized AI analysis.
-   **Skill Framework:** A registry and runtime for AI-powered skills, employing a COMPUTE → CLASSIFY → SYNTHESIZE pattern with a three-tier AI system.
-   **Computed Fields Engine:** Orchestrates batch computations for various scores (e.g., `velocity_score`, `deal_risk`, `engagement_score`).
-   **Sync Infrastructure:** Supports scheduled and manual asynchronous data synchronizations.
-   **Agent Runner Framework:** Composes multiple skills into unified briefings, synthesizing outputs into narratives.
-   **Conversational Agent:** Multi-turn AI chat with three-tier routing (heuristic→DeepSeek→Claude), unified orchestrator, thread anchoring, and structured state management.
-   **Feedback & Learning System:** `workspace_annotations` and `feedback_signals` tables capture entity-level knowledge from user interactions.
-   **Quota Management System:** Manages per-rep quota targets with period tracking.
-   **Model Management System:** LLM Router for dynamic model selection, context guardrails, and BYOK support.
-   **Customer Billing Metering:** Tracks token usage and generates customer charges based on usage and markup.
-   **Autonomous Skill Governance Layer:** A safety system for self-heal suggestions with validation, review, and rollback agents.
-   **Report Orchestrator:** Generates comprehensive reports by combining insights from multiple skills.

**Key Design Decisions:**
-   **No ORM:** Direct `pg` client and raw SQL for optimal performance and control.
-   **Data Storage:** Raw API data stored within a `source_data JSONB` column in entity tables.
-   **Upsert Pattern:** `ON CONFLICT DO UPDATE` for efficient data synchronization.
-   **LLM Integration:** Anthropic Claude for reasoning/generation, and Fireworks DeepSeek for extraction/classification, with token guardrails and prompt injection defense.
-   **Cross-Entity Linker:** Post-sync batch job resolves foreign keys between entities.
-   **ICP Enrichment Pipeline:** 6-step pipeline for closed deal analysis, including Apollo API enrichment and Serper Google search.
-   **Slack App Infrastructure:** Dual-mode `SlackAppClient`, signature verification, API endpoints, thread anchoring, message tracking, and channel configuration.
-   **Scoped Analysis Engine:** AI-powered "ask about this entity" with 4 scope types, utilizing compact text context compressors.
-   **Dossier Assemblers:** Enhanced deal and account dossiers with enrichment sections, engagement tracking, relationship health metrics, and Claude narrative synthesis.
-   **Entity Q&A History:** `chat_sessions` table with `entity_type`/`entity_id` for persistent per-deal and per-account Q&A history.
-   **Command Center (Backend & Frontend):** Backend API for findings, dossiers, analysis, pipeline snapshots, and connectors. Frontend UI with dashboards, entity lists, detail pages, and skills management.
-   **Actions Queue:** Manages the lifecycle of actions with status tracking, approval workflows, and CRM write-back.
-   **Playbooks System:** Defines skill pipelines, tracks run statistics, and visualizes execution phases.
-   **Consultant Dashboard (Multi-Workspace):** Cross-workspace portfolio view for consultants.
-   **Push Delivery System:** Manages configurable delivery channels (Slack/Email/Webhook) and rules with various triggers and templates.
-   **Outbound Webhook Infrastructure:** Multi-endpoint `webhook_endpoints` table with HMAC-signed payloads and retry mechanisms.
-   **Voice & Tone System:** Per-workspace voice configuration dynamically injected into skill synthesis prompts.
-   **Brief-First Architecture (Coaching Intelligence V2):** `weekly_briefs` table as the primary surface for the Assistant view, assembled via cron.
-   **WorkbookGenerator:** Provides multi-tab `.xlsx` export services for skill and agent runs.
-   **Monte Carlo Forecast (Pipeline-Aware):** 10,000-iteration probabilistic revenue forecast skill.
-   **Editorial Synthesis Engine:** Produces holistic briefings with editorial decisions.
-   **Conversation Detail Page:** Restructured with AI Call Intelligence narrative hero, tabbed insights, and coaching signals.
-   **Win-Pattern Coaching Engine:** Data-driven coaching signals derived from closed-won vs closed-lost deal analysis.
-   **Agent Templates + Builder:** Pre-built briefing templates and UI for customization.
-   **Ask Pandora → Agent (Conversational Creation Path):** Allows saving conversational goals as agents.
-   **Agent Run History + Diff View:** Tracks agent runs and provides side-by-side comparison of synthesis outputs.
-   **Self-Reference Memory:** Two-tier bounded memory system for agents to reference previous runs.
-   **Slack Notification Controls:** Centralized notification gateway with per-workspace preferences and smart delivery.
-   **Named Filters System:** Workspace-scoped business concept definitions for data filtering.
-   **Workspace Lens:** Global data filtering via `X-Pandora-Lens` header.
-   **Forecast Page:** Longitudinal forecast tracking dashboard with AI toggle and probabilistic forecast.
-   **Public Homepage & Waitlist:** Dark-themed landing page with waitlist functionality.
-   **Enterprise RFM Account Segmentation:** Account-level behavioral segmentation.
-   **Prospects Page — Tier 1 Point-Based Prospect Scoring:** Scores contacts based on Fit/Engagement/Intent/Timing.
-   **Coaching Intelligence V2 — Assistant View:** Introduces Assistant View with greetings, quick action pills, and morning briefs.
-   **Activity Signals Extraction Layer:** Two-pass extraction pipeline for activity signals from emails.
-   **Contextual Opening Brief:** Synthesizes role-scoped pipeline data into a Claude-written greeting for new conversations.
-   **TTE Survival Curve Engine + Monte Carlo Integration:** Kaplan-Meier algorithm for probabilistic forecasting.
-   **RFM Behavioral Scoring Engine:** Pure SQL + arithmetic compute module for deal scoring.
-   **Investigation Pipeline Delta Detection:** Compares investigation runs to detect new and improved deals.
-   **Onboarding Interview System:** Hypothesis-first conversational setup for new workspaces, including CRM scanning and document extraction.
-   **Lead & Contact Querying:** Comprehensive query layers for leads and contacts, with AI agent tools.
-   **Pandora Assistant Intelligence Layer:** Chart infrastructure for various chart types, live deal trust layer, and event-driven brief freshness.
-   **Session Context Object:** Manages active scope, cache, and session-specific data.
-   **Cross-Session Workspace Memory:** Persists memory across sessions for recurring patterns.
-   **Document Accumulator:** Accumulates findings and charts into various document templates.
-   **Narrative Synthesis at Render Time:** Synthesizes documents using Claude with compact context.
-   **Cross-Signal Analysis Engine:** Detects patterns across multiple finding categories.
-   **Action Judgment Layer:** Judges actions based on risk and intent (autonomous/approval/escalate).
-   **Document Distribution + Human-in-the-Loop Review:** Manages distribution to Slack, Email, Google Drive with review gates.
-   **Strategic Reasoning Layer:** Classifies and answers strategic business questions.
-   **Slack Draft Queue:** Generates and manages Slack DM drafts for agents.
-   **Closed-Loop Recommendation Tracking:** Persists and tracks outcomes of agent recommendations.
-   **Prior Document Comparison:** Compares current brief with previous ones to show changes.
-   **Forecast Accuracy Memory:** Stores and retrieves historical forecast accuracy for agents.
-   **Voice Model System:** Configurable voice profiles for AI agents, impacting tone and style.
-   **Document Feedback, Calibration + Persistent Learning:** Captures edits, implicit signals, and calibration sessions to improve document generation.
-   **Slack Conversational Interface:** Full conversational mode in Slack with slash commands, brief rendering, and DM bot.
-   **Sankey Pipeline Funnel Visualization:** Interactive SVG Sankey diagram for stage-by-stage deal flow.
-   **Pipeline Page, Winning Paths & Assistant Chart Intelligence:** Dedicated pipeline page, winning path analysis, and AI-driven chart generation in conversations.
-   **Pipeline Resolution System:** Workspace-aware pipeline name resolution and intent classification.
-   **Fine-Tuning Pipeline + LLM Router Integration:** Manages training, deployment, and confidence-gated routing of fine-tuned LLMs.
-   **Assistant Live Query Architecture:** Fetches live data for briefs with fingerprinting, rate limiting, and prompt caching.
-   **Chart Intelligence, Clarifying Questions, Dimension Builder & Data Dictionary:** Automatically generates charts, detects ambiguity, allows dimension building, and provides a data dictionary.
-   **Quarterly Retrospective Intelligence:** Diagnoses quarterly performance using a three-phase architecture (evidence harvest, hypothesis formation, targeted synthesis).
-   **Behavioral Winning Path — v2 Discovery-First Implementation:** Quarterly cron for discovering behavioral milestones from transcripts.
-   **`openAskPandora` Universal Utility:** Standardized way to open the chat panel with structured context.
-   **Forecast Bearing Calibration:** Weights forecast triangulation bearings by historical accuracy.
-   **Standing Hypotheses — Locked Conventions:** Strict conventions for storing ratios and units.
-   **Report Orchestrator — End-to-End Validation:** Fully validated pipeline for report generation.
-   **QuestionTree + Chart Suggestions:** Generates reasoning trees and chart suggestions for reports.
-   **Ask Pandora → Inline Chart Pipeline ("Chart Intelligence"):** Automatically generates and attaches conclusion-first charts to AI responses.
-   **Report Renderer Polish:** Improved PDF, DOCX, and HTML rendering for reports.
-   **MCP Server:** Exposes Pandora as a Model Context Protocol server for direct tool calls from compatible clients.

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
-   **Resend:** Email delivery.
-   **QuickChart:** Chart rendering.