# Pandora — Multi-Tenant GTM Intelligence Platform

## Overview
Pandora is a multi-tenant agent-based platform that helps RevOps teams analyze their GTM (Go-To-Market) data. It connects to CRM, call intelligence, task management, and document systems, normalizes data into 8 core entities, and runs AI-powered analyses.

**Current State**: Session 4 — Pipeline snapshot → Slack. Full end-to-end data pipeline: HubSpot → PostgreSQL → metrics → Slack. Query normalized deals, calculate pipeline metrics, format as Block Kit, post via webhook.

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
      hubspot.ts          # HubSpot connector API routes (connect, sync, health, discover-schema)
    connectors/
      _interface.ts       # PandoraConnector interface + shared types (Connection, SyncResult, etc.)
      hubspot/
        index.ts          # HubSpotConnector class implementing PandoraConnector
        client.ts         # HubSpot API client (pagination, fill rate, property discovery)
        types.ts          # HubSpot API response interfaces
        transform.ts      # HubSpot → normalized DB records (deals, contacts, accounts)
        sync.ts           # initialSync, incrementalSync, backfillSync with DB upserts
        schema-discovery.ts # Property enumeration, pipeline discovery, metadata storage
    schemas/              # Will hold entity definitions
    analysis/
      pipeline-snapshot.ts # Pipeline metrics from normalized deals (SQL queries)
    utils/
      index.ts            # Barrel export for all utilities
      retry.ts            # Exponential backoff, paginated fetch, rate limiter
      logger.ts           # Structured logger with context and prefix
      date-helpers.ts     # Date manipulation (daysBetween, startOfWeek, etc.)
      data-transforms.ts  # Field extraction, normalization, parsing helpers
      llm-client.ts       # Claude API client via @anthropic-ai/sdk
  migrations/
    001_initial.sql       # Initial schema: workspaces, connections, 7 entity tables
    002_add_calls_table.sql # Adds calls table (8th entity)
```

## Database Schema
All tables use UUID primary keys and include `workspace_id` for multi-tenant isolation.

**Core tables**:
- `workspaces` — tenant isolation
- `connections` — workspace-scoped connector credentials (status, credentials JSONB, sync_cursor JSONB, last_sync_at)

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
- Upsert pattern: ON CONFLICT DO UPDATE overwrites source_data + all normalized fields + updated_at

## HubSpot Connector

**Architecture**:
- `client.ts` — Low-level API client with OAuth Bearer auth, pagination, property discovery, fill rate calculation (fast path via HAS_PROPERTY + sample fallback)
- `transform.ts` — Maps HubSpot fields to normalized schema (dealname→name, dealstage→stage, etc.), handles "everything is a string" pattern via parseNumber/parseDate, extracts custom fields into custom_fields JSONB
- `sync.ts` — Three sync modes:
  - `initialSync` — Fetches all deals, contacts, companies in parallel with pagination
  - `incrementalSync` — Uses Search API with lastmodifieddate >= since filter
  - `backfillSync` — Fetches deal→contact and deal→company associations individually
- `schema-discovery.ts` — Enumerates all properties and pipelines, stores in connections.sync_cursor

**Edge cases preserved**:
- HubSpot returns all values as strings — parseNumber/parseDate handle conversion
- Pagination via cursor-based `after` parameter
- Property fill rate: fast path (HAS_PROPERTY filter) with sample-based fallback
- Custom properties discovered dynamically when includeAllProperties=true
- Association backfill for deals missing contact/company links
- Rate limit awareness: 100 requests per 10 seconds for OAuth apps

## API Endpoints
- `GET /` — Server info (name, version, description)
- `GET /health` — Health check with DB verification (status, timestamp, version)
- `GET /api/workspaces` — Workspace CRUD (placeholder)
- `GET /api/connectors` — Connector management (placeholder)
- `POST /api/workspaces/:id/connectors/hubspot/connect` — Connect HubSpot with OAuth credentials
- `POST /api/workspaces/:id/connectors/hubspot/sync` — Trigger sync (mode: initial/incremental/backfill)
- `GET /api/workspaces/:id/connectors/hubspot/health` — Check connector health
- `POST /api/workspaces/:id/connectors/hubspot/discover-schema` — Discover HubSpot schema
- `POST /api/workspaces/:id/actions/pipeline-snapshot` — Generate pipeline metrics, optionally post to Slack

## Scripts
- `npm run dev` — Start dev server with hot reload (tsx watch)
- `npm run build` — Compile TypeScript to dist/
- `npm start` — Run compiled production server
- `npm run migrate` — Apply pending SQL migrations

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (auto-set by Replit)
- `PORT` — Server port (default: 3000)

## Build Sessions (Roadmap)
- **Session 0**: Scaffolding (DONE)
- **Session 1**: Database schema refinement + seed data (DONE)
- **Session 2**: Port utilities (DONE)
- **Session 3**: Port HubSpot connector (DONE)
- **Session 4**: Pipeline snapshot → Slack (DONE)
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
