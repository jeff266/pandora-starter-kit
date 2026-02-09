# Pandora Starter Kit - Context for Replit AI

**Purpose**: Bootstrap Pandora (multi-tenant GTM Intelligence Platform) using extracted code from RevOps Copilot.

---

## What is Pandora?

Pandora is a **multi-tenant agent-based platform** that helps RevOps teams analyze their GTM data. It:
- Connects to CRM, call intelligence, task management, and document systems
- Normalizes data into 8 core entities (Deal, Contact, Account, Activity, Call, Conversation, Task, Document)
- Runs AI-powered analyses via modular Skills
- Delivers insights via Slack, dashboards, and chat

**Key Difference from Copilot**: Pandora is multi-workspace (one instance, many clients) vs. Copilot (one instance per client).

---

## What's in the Starter Kit?

```
pandora-starter-kit/
├── CODEBASE_AUDIT.md          # Full analysis of Copilot codebase
├── PORT_MAP.md                # File-by-file port mapping
├── DEPENDENCIES.md            # NPM package requirements
├── REPLIT_CONTEXT.md          # This file
├── ARCHITECTURE.md            # Target Pandora architecture (PROVIDED BY USER)
│
├── connectors/                # 🟢 PRODUCTION-READY
│   ├── _interface.ts          # Standard PandoraConnector interface
│   ├── _types.ts              # Shared error types
│   ├── hubspot/               # Full HubSpot connector
│   │   ├── client.ts          # API client (519 lines)
│   │   ├── sync.ts            # PandoraConnector implementation
│   │   ├── types.ts           # TypeScript interfaces
│   │   └── README.md          # Edge cases, Export API pattern, rate limits
│   ├── gong/                  # Full Gong connector
│   ├── fireflies/             # Full Fireflies connector (uses retry util)
│   ├── monday/                # Note file + README
│   ├── asana/                 # Note file + README
│   └── google-drive/          # Full Google Drive connector
│
├── schemas/                   # 🟢 COMPLETE
│   ├── normalized-entities.ts # 8 entity interfaces
│   ├── computed-fields.ts     # Formulas with configs
│   ├── field-mappings.ts      # Default mappings per source
│   └── connector-schemas.ts   # Raw API response shapes
│
├── analysis/                  # 🟢 REUSABLE FORMULAS
│   ├── pipeline-metrics.ts    # Win rate, coverage, velocity
│   ├── data-collection.ts     # Aggregation patterns
│   └── README.md              # Notes on agent system (REFERENCE)
│
└── utils/                     # 🟢 PRODUCTION-READY
    ├── retry.ts               # Exponential backoff + paginated fetch
    ├── logger.ts              # Structured logging
    ├── date-helpers.ts        # Date manipulation
    ├── llm-client.ts          # DeepSeek + Claude wrappers
    └── data-transforms.ts     # Field extraction, normalization
```

---

## What's Already Built vs. What's New

### ✅ Already Built (Extracted from Copilot)

**Connectors** (6 total):
- HubSpot: OAuth, full CRM sync, custom field discovery, fill rate calculation
- Gong: Call/transcript fetching with speaker attribution
- Fireflies: Paginated fetch with exponential backoff retry
- Google Drive: OAuth, document extraction (Docs→text, Sheets→CSV)
- Monday.com: Task sync (note file points to Copilot source)
- Asana: Task sync (note file, incomplete in Copilot)

**Edge Cases Preserved**:
- HubSpot: Property fill rate with fast path + sample fallback
- Fireflies: Exponential backoff (1s, 2s, 4s), consecutive error limits
- Speaker consolidation in transcripts
- MIME type handling for Google files

**Utilities**:
- Retry logic with exponential backoff
- Rate limiter (basic implementation)
- Structured logger
- LLM clients (DeepSeek, Claude)

**Schemas**:
- 8 normalized entity interfaces
- Field mappings for all sources
- Computed field formulas

### 🔨 New for Pandora (Not in Copilot)

**Multi-Tenancy**:
- `workspace_id` scoping for ALL data
- Workspace-level connector credentials
- Per-workspace field mapping approval
- Per-workspace computed field configuration

**Normalization Pipeline**:
- RawRecord → Field Mapping → Normalized Entities
- 8-entity model (Copilot has fragmented schema)
- Unified Task entity (Copilot has separate action items + external tasks)
- Unified Document entity (Copilot has consultant + client docs separately)

**Incremental Sync**:
- Watermark-based incremental sync (NOT in Copilot)
- HubSpot: Use Search API with `lastmodifieddate >= since`
- Gong/Fireflies: Date filtering on sync

**Skills Framework** (Phase 3+):
- Agent YAML definitions
- Skill library (Win/Loss Analysis, Pipeline Review, QBR Builder, etc.)
- Tool library (query, analysis, action, output tools)
- NOT in starter kit - design from Copilot agent patterns

---

## Tech Stack

**Core**:
- Node.js 18+ (for native `fetch`)
- TypeScript 5.6+
- PostgreSQL (Neon recommended)

**APIs**:
- Anthropic Claude API (synthesis, strategic analysis)
- Fireworks API (DeepSeek v3 for bulk extraction)

**Deployment**: Replit

**Database ORM**: Your choice (Copilot uses Drizzle)

---

## Phase 1 Scope (Start Here)

**Goal**: HubSpot → Slack pipeline (proof that pipes work)

### What to Build

1. **Workspace Model** (database):
   - `workspaces` table (id, name, created_at)
   - `connections` table (workspace_id, connector_name, credentials, status)

2. **HubSpot Connector Integration**:
   - Use `connectors/hubspot/sync.ts` (already extracted)
   - Implement TODOs: `storage.createConnection()`, `storage.storeRawRecords()`
   - Store raw HubSpot data in `raw_records` table

3. **Basic Normalization** (Phase 1 limited scope):
   - Deal → Normalized Deal (just core fields, no custom fields yet)
   - Contact → Normalized Contact
   - Company → Normalized Account
   - Store in `deals`, `contacts`, `accounts` tables

4. **Simple Analysis**:
   - Use `analysis/pipeline-metrics.ts`
   - Calculate: pipeline coverage, win rate, new deals this week

5. **Slack Output**:
   - Weekly pipeline snapshot
   - Format: "Pipeline: $500K (2.5x coverage), Win Rate: 35%, 3 new deals this week"
   - Send via Slack webhook

### What NOT to Build Yet

- ❌ Skills framework (Phase 3)
- ❌ Agent orchestration (Phase 4)
- ❌ Chat UI (Phase 5)
- ❌ Custom field mapping approval (Phase 2)
- ❌ Conversation + Task + Document connectors (Phase 2)

---

## Connector Interface Contract

Every connector implements `PandoraConnector`:

```typescript
interface PandoraConnector {
  name: string;
  category: 'crm' | 'conversations' | 'operations' | 'documents';
  authMethod: 'oauth' | 'api_key';

  testConnection(credentials): Promise<TestResult>
  connect(credentials, workspaceId): Promise<Connection>
  disconnect(workspaceId): Promise<void>

  discoverSchema?(connection): Promise<SourceSchema>
  proposeMapping?(schema): Promise<FieldMapping[]>

  initialSync(connection, workspaceId): Promise<RawRecord[]>
  incrementalSync(connection, workspaceId, since): Promise<RawRecord[]>
  backfillSync?(connection, workspaceId): Promise<RawRecord[]>

  health(workspaceId): Promise<ConnectorHealth>
}
```

**Data Flow**:
```
Connector.sync() → RawRecords[]
  → Field Mapping (per workspace, user-approved)
  → Normalization
  → 8 Normalized Entities
  → Pandora Storage
```

---

## The 8 Normalized Entities

All entities have: `id`, `source`, `source_id`, `workspace_id`, `created_at`, `updated_at`, `custom_fields` (JSONB)

1. **Deal**: name, amount, stage, close_date, owner, account, probability, forecast_category, custom_fields
2. **Contact**: email, name, title, seniority, department, account, lifecycle_stage, engagement_score
3. **Account**: name, domain, industry, employee_count, revenue, health_score, open_deal_count
4. **Activity**: type (email/call/meeting/note/task), timestamp, actor, content, associations
5. **Call**: (may merge with Activity) call_date, duration, direction, participants, recording_url
6. **Conversation**: transcript, summary, action_items, objections, sentiment, talk_listen_ratio
7. **Task**: title, status, assignee, due_date, priority, project, deal/account linkage
8. **Document**: title, doc_type, content_text, summary, deal/account linkage

---

## Copilot Patterns to Reference (Not Port)

**Agent Orchestration** (see `PORT_MAP.md` - REFERENCE section):
- Multi-agent synthesis: Analyst 1 → Analyst 2 → Manager
- Context injection pattern: docs + data + pending questions
- Watermark tracking for incremental processing
- Question chaining: extract follow-ups, address next run

**Discovery Analyses** (Copilot has 8 types):
- Document Intelligence, Customer Profiling, Lifecycle Analysis
- Pipeline Analysis, CRM Field Audit, Win/Loss Intelligence
- Segmentation Discovery, Data Quality Audit

**Operating Rhythm Analyses**:
- Performance Analysis, Call Intelligence, Deal Risk Assessment
- Prep Brief Generation (Monday preps, Friday recaps)

**For Pandora**: These become Skills (Phase 3+) using similar patterns but adapted to Pandora's architecture.

---

## Quick Start Commands

```bash
# 1. Set up project
npm init -y
npm install date-fns zod

# 2. Set up database (PostgreSQL)
# Create tables: workspaces, connections, raw_records, deals, contacts, accounts

# 3. Test HubSpot connector
node -e "
import { hubspotConnector } from './connectors/hubspot/sync.js';
const test = await hubspotConnector.testConnection({ accessToken: 'YOUR_TOKEN' });
console.log(test);
"

# 4. Run initial sync
# (implement sync endpoint that calls hubspotConnector.initialSync())

# 5. Calculate metrics
# (implement analysis endpoint that uses analysis/pipeline-metrics.ts)

# 6. Send to Slack
# (implement Slack webhook post)
```

---

## Key Files to Read First

1. **CODEBASE_AUDIT.md** - Understand what was in Copilot
2. **ARCHITECTURE.md** - Understand target Pandora architecture
3. **connectors/hubspot/README.md** - Understand HubSpot connector edge cases
4. **schemas/normalized-entities.ts** - Understand data model
5. **PORT_MAP.md** - Understand what's PORT vs. REFERENCE

---

## Success Criteria for Phase 1

✅ Workspace created in database
✅ HubSpot connected via OAuth (workspace-scoped credentials)
✅ Initial sync fetches all deals, contacts, companies
✅ Raw data stored in `raw_records` table
✅ Basic normalization to Deal, Contact, Account entities
✅ Pipeline metrics calculated (coverage, win rate)
✅ Weekly snapshot posted to Slack channel

**Deliverable**: "Proof that the pipes work" - live HubSpot data → Pandora → Slack

---

## Notes for Replit Agent

- **Start small**: Phase 1 is just HubSpot + Slack (no Skills, no agents, no chat UI)
- **Use extracted code**: Don't rewrite connectors - use what's in `connectors/`
- **Multi-tenancy first**: Every table needs `workspace_id`
- **TODOs are clear**: Search for `// TODO:` in connector files - those are storage integration points
- **Edge cases matter**: Read connector READMEs - they document real-world problems and solutions
- **Incremental is Phase 2**: Initial sync only for Phase 1, incremental sync comes later

**Questions?** Review `CODEBASE_AUDIT.md` Section 2 (Integration Inventory) for deep dives on each connector.

---

**Ready to build!** 🚀
