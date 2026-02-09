# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant agent-based platform that helps RevOps teams analyze their GTM (Go-To-Market) data. It connects to CRM, call intelligence, task management, and document systems, normalizes data into 8 core entities, and runs AI-powered analyses.

**Current State**: Session 0 — Scaffolding complete. Express API server running with PostgreSQL database, all entity tables created, health endpoint working.

**Version**: 0.1.0

## Tech Stack
- **Runtime**: Node.js 20 (native fetch)
- **Language**: TypeScript 5+ (strict mode, ESM)
- **Framework**: Express.js
- **Database**: PostgreSQL (Neon) via `pg` client — raw SQL, no ORM
- **Dev Tools**: tsx (TypeScript execution), dotenv

## Project Architecture

```
pandora/
  server/
    index.ts              # Express server entry point (port 3000)
    db.ts                 # PostgreSQL connection pool (pg client)
    migrate.ts            # Migration runner
    routes/
      health.ts           # GET /health — health check
      workspaces.ts       # Workspace CRUD (placeholder)
      connectors.ts       # Connector management (placeholder)
    connectors/           # Will hold ported connectors (HubSpot, Gong, etc.)
    schemas/              # Will hold entity definitions
    analysis/             # Will hold analysis tools
    utils/                # Will hold shared utilities
  migrations/
    001_initial.sql       # Initial schema: workspaces, connections, 7 entity tables
    002_add_calls_table.sql # Adds calls table (8th entity)
```

## Database Schema
All tables use UUID primary keys and include `workspace_id` for multi-tenant isolation.

**Core tables**:
- `workspaces` — tenant isolation
- `connections` — workspace-scoped connector credentials

**8 Entity tables** (all have `workspace_id`, `source`, `source_id`, `source_data JSONB`, `custom_fields JSONB`):
- `deals` — CRM deals with amount, stage, pipeline, probability
- `contacts` — people with email, title, seniority, engagement_score
- `accounts` — companies with domain, industry, revenue, health_score
- `activities` — emails, calls, meetings, notes (type + timestamp + associations)
- `conversations` — call transcripts with sentiment, talk/listen ratio, objections
- `tasks` — from Monday/Asana with status, priority, assignee, due date
- `calls` — call records with direction, duration, recording_url, participants
- `documents` — from Google Drive with content_text, doc_type, summary

**Key design decisions**:
- No `raw_records` table — raw API data stored in `source_data` JSONB on each entity
- All 8 tables created upfront, populated incrementally as connectors are built
- Unique constraint on (workspace_id, source, source_id) for upsert support

## Scripts
- `npm run dev` — Start dev server with hot reload (tsx watch)
- `npm run build` — Compile TypeScript to dist/
- `npm start` — Run compiled production server
- `npm run migrate` — Apply pending SQL migrations

## API Endpoints
- `GET /` — Server info (name, version, description)
- `GET /health` — Health check with DB verification (status, timestamp, version)
- `GET /api/workspaces` — Workspace CRUD (placeholder)
- `GET /api/connectors` — Connector management (placeholder)

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (auto-set by Replit)
- `PORT` — Server port (default: 3000)

## Build Sessions (Roadmap)
- **Session 0**: Scaffolding (DONE)
- **Session 1**: Database schema refinement + seed data
- **Session 2**: Port utilities (retry, logger, date helpers, LLM client)
- **Session 3**: Port HubSpot connector
- **Session 4**: Pipeline snapshot → Slack
- **Session 5**: Context Layer
- **Session 6**: Computed fields engine
- **Sessions 7-10**: Phase 2 (expanded connectors, sync orchestrator, query API)

## Key Reference Documents
- `REPLIT_CONTEXT.md` — Full project context and phase planning
- `REPLIT_CONTEXT_ADDENDUM.md` — Decision overrides (raw SQL, no raw_records table, etc.)
- `ARCHITECTURE.md` — Visual architecture overview with phase diagram

## User Preferences
- Raw SQL with parameterized queries — no ORM
- Minimal dependencies — only install what's needed
- Full control over database queries (complex joins, window functions, aggregations)
- Multi-tenant first — every table scoped by workspace_id
