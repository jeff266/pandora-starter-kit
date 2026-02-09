# Pandora — REPLIT_CONTEXT Addendum

**Read this BEFORE REPLIT_CONTEXT.md. This document contains decisions made after the starter kit was produced. Where this document and REPLIT_CONTEXT.md conflict, THIS document wins.**

---

## Decision 1: Raw SQL, No ORM

REPLIT_CONTEXT.md says "Database ORM: Your choice (Copilot uses Drizzle)."

**Decision: Use raw SQL with the `pg` client. No ORM.**

Rationale: Pandora's query patterns involve complex joins across 8 entity tables, window functions for scoring, and aggregations for pipeline metrics. ORMs make these awkward. Raw SQL with parameterized queries gives full control and avoids abstraction leaks.

Implementation:
- Use `pg` package (PostgreSQL driver) with a connection pool
- All queries are parameterized (prevent SQL injection)
- SQL migrations live in `migrations/` directory, applied sequentially
- Query functions live in `server/tools/` (organized by entity: deal-query.ts, contact-query.ts, etc.)

---

## Decision 2: No `raw_records` Table — Use `source_data` Column

REPLIT_CONTEXT.md mentions storing raw HubSpot data in a `raw_records` table as an intermediate step.

**Decision: Skip the `raw_records` table. Store raw API responses in a `source_data` JSONB column on each normalized entity table.**

Rationale: A generic `raw_records` table creates a data swamp — you end up querying it by type + source + workspace just to find what you need, then joining to the entity tables anyway. Instead:
- Each entity table (deals, contacts, accounts, etc.) has a `source_data` JSONB column
- Raw API response goes directly into `source_data` during sync
- Normalized fields are extracted and stored in typed columns simultaneously
- No intermediate step, no orphan records, no double storage

The `source_data` column serves two purposes:
1. Debugging — see exactly what the API returned
2. Custom field extraction — when a workspace approves new custom fields, the data is already there in `source_data`

---

## Decision 3: Expanded Phasing — Sessions 0-6 Are Phase 1, Sessions 7-10 Are Phase 2

REPLIT_CONTEXT.md says Phase 1 is "just HubSpot + Slack" and marks conversation/task/document connectors as Phase 2.

**Decision: The build prompts include 11 sessions (0-10). Sessions 0-6 are Phase 1. Sessions 7-10 are Phase 2.**

Phase 1 (Sessions 0-6) — validate on real data:
- Session 0: Scaffolding
- Session 1: Database schema (ALL 8 entity tables created, even if only 3 populated in Phase 1)
- Session 2: Port utilities
- Session 3: Port HubSpot connector (the big one)
- Session 4: Pipeline snapshot → Slack (proof of life)
- Session 5: Context Layer
- Session 6: Computed fields engine

Phase 2 (Sessions 7-10) — expand data sources:
- Session 7: Gong + Fireflies connectors
- Session 8: Monday.com + Google Drive connectors
- Session 9: Sync orchestrator + scheduler
- Session 10: Data query API layer

**Do not start Phase 2 until Phase 1 is working with real HubSpot data flowing to Slack.** The whole point of Phase 1 is to prove the pipe works end to end before adding more inputs.

---

## Decision 4: Computed Fields Are NEW BUILDS

REPLIT_CONTEXT.md references `pandora-starter-kit/schemas/computed-fields.ts` and `analysis/pipeline-metrics.ts` as extracted code.

**Clarification: The computed field formulas for engagement_score, health_score, velocity_score, and deal_risk are NEW designs, not code ported from Copilot.**

The Copilot Codebase Audit (Section 4.2) confirmed:
- `Engagement Score (NOT FOUND)` — no implementation in Copilot
- `Health Score (NOT FOUND)` — no implementation in Copilot  
- `Deal Risk (NOT FOUND as formula)` — computed by AI agents, not stored
- `Pipeline Velocity (NOT FOUND as standalone function)` — computed in agents

What IS ported from Copilot:
- `pipeline_coverage` — partial formula in `analysis/data-collection.ts`
- `win_rate` — formula: `wonDeals / (wonDeals + lostDeals)`
- `fill_rate` — HubSpot property fill rate calculation (fast path + sample fallback)

The `schemas/computed-fields.ts` file contains design specifications (field names, types, config shapes, formula descriptions) created during architecture planning. The actual computation logic needs to be **built from these specs**, not copied from Copilot.

---

## Decision 5: Fathom Status Unknown

REPLIT_CONTEXT.md lists 6 connectors. The architecture mentions Fathom as a conversation intelligence source alongside Gong and Fireflies.

**Status: The Copilot codebase audit found ZERO Fathom code.** It's possible Fathom calls are routed through one of the call adapters, or it was planned but never implemented. 

Action: Skip Fathom for now. If it exists in Copilot, it can be extracted later. Gong + Fireflies cover the conversation intelligence use case.

---

## Decision 6: Entity Tables Created Upfront, Populated Incrementally

Even though Phase 1 only populates Deal, Contact, and Account from HubSpot, **all 8 entity tables should be created in Session 1.** This avoids migration churn when Phase 2 adds connectors that populate Activity, Conversation, Task, and Document tables.

The tables exist but stay empty until their connectors are wired up.

---

## Summary: What the Build Sessions Produce

After Phase 1 (Sessions 0-6):
- ✅ Multi-tenant workspace model
- ✅ All 8 entity tables (3 populated: Deal, Contact, Account)
- ✅ HubSpot connector: initial sync → normalized data
- ✅ Pipeline snapshot posted to Slack
- ✅ Context Layer (business model, goals, definitions)
- ✅ Computed fields (engagement, health, velocity scores on deals)
- ✅ Shared utilities (retry, logger, date helpers, Claude client)

After Phase 2 (Sessions 7-10):
- ✅ Gong + Fireflies → Conversation entity populated
- ✅ Monday.com → Task entity populated
- ✅ Google Drive → Document entity populated
- ✅ Sync orchestrator coordinating all connectors
- ✅ Nightly scheduled sync with backfill
- ✅ Data query API for all entities

Phase 3 (future — Skills + Agents):
- Tool Library wrapping query functions
- Skill definitions (Pipeline Hygiene, Win/Loss Analysis, QBR Builder, etc.)
- Agent runtime with Claude API
- Scheduled skill execution
