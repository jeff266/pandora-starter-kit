# Pandora Command Center — Phase A: Backend APIs Build Prompt

## For: Replit (with Claude Code assist on A3 dossier logic)
## Estimated effort: 12-16 hours across A1-A4
## Depends on: skill_runs table, normalized entities (deals, contacts, accounts, conversations), cross-entity linker
## Unlocks: Command Center frontend (Phase B), Slack action button wiring, chat-over-data

---

## Why This Matters

Every skill Pandora runs produces findings — stale deals, single-threaded opportunities, data quality gaps, coverage holes. Today those findings live buried inside `skill_runs.result_data` JSONB blobs. To power the Command Center, Slack action buttons, Insights Feed, and the Actions queue, we need findings extracted into a queryable table with proper indexes, then exposed through clean APIs.

Phase A builds four things:
1. **Findings table** — normalized, indexed, queryable findings extracted from skill runs
2. **Findings + Pipeline APIs** — filter, summarize, and snapshot endpoints
3. **Dossier assemblers** — compose deal and account views from multiple tables
4. **Scoped analysis endpoint** — ask natural language questions about specific entities

These APIs power the frontend AND improve Slack output AND enable future chat-over-data experiences. Build them right and every downstream surface benefits.

---

## A1: Findings Table + Migration + Extraction

### Migration

Create the next numbered migration (check current highest migration number and increment):

```sql
-- migrations/0XX_findings_table.sql

CREATE TABLE IF NOT EXISTS findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  skill_run_id UUID NOT NULL REFERENCES skill_runs(id),
  skill_id TEXT NOT NULL,
  
  -- Classification
  severity TEXT NOT NULL,                -- 'critical', 'warning', 'info'
  category TEXT,                         -- 'stale_deal', 'single_threaded', 'data_quality', 
                                         -- 'coverage_gap', 'close_date_issue', 'missing_amount', etc.
  
  -- Content
  message TEXT NOT NULL,                 -- Human-readable finding text
  
  -- Entity references (nullable — not all findings reference a specific entity)
  deal_id UUID REFERENCES deals(id),
  account_id UUID REFERENCES accounts(id),
  contact_id UUID REFERENCES contacts(id),
  owner_email TEXT,                      -- Rep who owns the deal/account
  
  -- Enrichment
  metadata JSONB DEFAULT '{}',           -- Skill-specific context: amount, days_in_stage, 
                                         -- contact_count, field_name, completeness_pct, etc.
  actionability TEXT DEFAULT 'monitor',  -- 'immediate', 'strategic', 'monitor'
  
  -- Lifecycle
  found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,              -- NULL until resolved (user action or next run clears it)
  resolution_method TEXT,               -- 'user_dismissed', 'auto_cleared', 'action_taken'
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Primary query patterns
CREATE INDEX idx_findings_workspace_severity ON findings(workspace_id, severity, found_at DESC);
CREATE INDEX idx_findings_workspace_skill ON findings(workspace_id, skill_id, found_at DESC);
CREATE INDEX idx_findings_workspace_owner ON findings(workspace_id, owner_email, found_at DESC);
CREATE INDEX idx_findings_deal ON findings(deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX idx_findings_account ON findings(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX idx_findings_unresolved ON findings(workspace_id, resolved_at) WHERE resolved_at IS NULL;

-- For deduplication during extraction
CREATE INDEX idx_findings_dedup ON findings(workspace_id, skill_run_id, category, deal_id);
```

Also add conversation link tracking:

```sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  link_method TEXT;  -- 'crm_metadata', 'participant_email', 'domain_inferred', 'manual', null
```

### Extraction Logic

Create `server/findings/extractor.ts`:

The extractor reads `skill_runs.result_data` and normalizes findings into the `findings` table. Each skill may format its output differently, so the extractor needs skill-specific parsing logic.

**Step 1: Audit current skill output shapes.**

Before writing extraction logic, read the actual `result_data` JSONB from existing skill_runs for each of the 4 Tier 1 skills. Run these queries:

```sql
-- Get one sample result_data per skill
SELECT DISTINCT ON (skill_id) skill_id, result_data 
FROM skill_runs 
WHERE status = 'completed' AND result_data IS NOT NULL
ORDER BY skill_id, completed_at DESC;
```

This tells you the exact shape you're parsing. The evidence architecture spec says skills should produce `claims` arrays, but the Tier 1 skills may use slightly different structures — they may have findings nested under `result_data.synthesis` or `result_data.claims` or a custom shape. **Parse what actually exists, don't assume.**

**Step 2: Build the extractor.**

```typescript
// server/findings/extractor.ts

interface ExtractedFinding {
  skill_id: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  message: string;
  deal_id?: string;
  account_id?: string;
  contact_id?: string;
  owner_email?: string;
  metadata: Record<string, any>;
  actionability: 'immediate' | 'strategic' | 'monitor';
}

export async function extractFindings(
  workspaceId: string,
  skillRunId: string,
  skillId: string,
  resultData: any
): Promise<ExtractedFinding[]> {
  // Route to skill-specific extractor
  switch (skillId) {
    case 'pipeline-hygiene':
      return extractPipelineHygiene(resultData);
    case 'single-thread-alert':
      return extractSingleThread(resultData);
    case 'data-quality-audit':
      return extractDataQuality(resultData);
    case 'pipeline-coverage':
      return extractPipelineCoverage(resultData);
    default:
      return extractGeneric(resultData);
  }
}

// Generic extractor — tries common patterns
function extractGeneric(resultData: any): ExtractedFinding[] {
  // Try: resultData.claims (evidence architecture standard)
  // Try: resultData.synthesis.claims
  // Try: resultData.findings
  // Fallback: scan for arrays of objects with severity/message fields
  // Return empty array if nothing parseable found
}
```

**Each skill-specific extractor should:**
- Parse the actual structure from that skill's result_data
- Map each finding to the ExtractedFinding interface
- Resolve deal_id by looking up deal names/external_ids if the skill output uses names instead of UUIDs
- Set category based on the finding type (e.g., pipeline-hygiene produces 'stale_deal', 'close_date_past', 'missing_amount')
- Set actionability: critical findings → 'immediate', warning → 'strategic', info → 'monitor'

**Step 3: Wire into skill runtime.**

After a skill run completes successfully, call the extractor and insert findings:

```typescript
// In the skill execution path (wherever skill_runs are written)

// After writing to skill_runs table:
const findings = await extractFindings(workspaceId, skillRunId, skillId, resultData);

if (findings.length > 0) {
  // Auto-resolve previous findings from the same skill that are no longer present
  // (e.g., a stale deal that's no longer stale)
  await autoResolveStaleFindings(workspaceId, skillId, findings);
  
  // Insert new findings
  await insertFindings(workspaceId, skillRunId, findings);
}
```

**Auto-resolution logic:**
When a skill reruns, any finding from a previous run of the same skill that ISN'T in the new results should be marked resolved with `resolution_method = 'auto_cleared'`. This keeps the findings table current without manual cleanup.

Compare by: `(workspace_id, skill_id, category, deal_id)` — if a previous finding matches on these fields but isn't in the new extraction, resolve it.

**Step 4: Backfill script.**

Create a one-time script `scripts/backfill-findings.ts` that:
1. Queries all completed skill_runs
2. Runs the extractor on each
3. Inserts findings (skip duplicates)
4. Logs: "Backfilled X findings from Y skill runs"

Run this after deploying the migration. Only needs to run once.

### Testing A1

```bash
# After migration and backfill:
SELECT skill_id, severity, count(*) 
FROM findings 
WHERE workspace_id = '<imubit_workspace_id>' 
GROUP BY skill_id, severity 
ORDER BY skill_id, severity;

# Should show findings broken down by skill and severity
# If empty, check: are there completed skill_runs with result_data?
```

---

## A2: Findings API + Pipeline Snapshot

### Findings Endpoints

Add to `server/routes/findings.ts` (new file):

#### GET /api/workspaces/:workspaceId/findings

Full-featured findings query with filters.

**Query parameters:**
- `skill_id` — filter by skill (e.g., `pipeline-hygiene`)
- `severity` — filter by severity: `critical`, `warning`, `info` (comma-separated for multiple)
- `category` — filter by category (comma-separated)
- `owner` — filter by owner_email
- `deal_id` — filter by specific deal
- `account_id` — filter by specific account
- `resolved` — `true` to include resolved, `false` for unresolved only (default: `false`)
- `since` — ISO datetime, findings found after this date
- `until` — ISO datetime, findings found before this date
- `limit` — pagination (default 50, max 200)
- `offset` — pagination offset
- `sort` — field to sort by: `found_at` (default), `severity`, `owner`
- `order` — `asc` or `desc` (default: `desc`)

**Response:**
```json
{
  "findings": [
    {
      "id": "uuid",
      "skill_id": "pipeline-hygiene",
      "severity": "critical",
      "category": "stale_deal",
      "message": "Acme Corp ($220K) has had no activity for 45 days in Decision stage",
      "deal_id": "uuid",
      "deal_name": "Acme Corp",
      "account_id": "uuid",
      "account_name": "Acme Corp",
      "owner_email": "sarah@company.com",
      "metadata": { "amount": 220000, "days_since_activity": 45, "stage": "Decision" },
      "actionability": "immediate",
      "found_at": "2025-02-15T08:00:00Z",
      "resolved_at": null
    }
  ],
  "total": 142,
  "limit": 50,
  "offset": 0
}
```

**Implementation note:** Join with `deals` and `accounts` tables to include `deal_name` and `account_name` in the response. Don't make the frontend do a second lookup.

#### GET /api/workspaces/:workspaceId/findings/summary

Headline counts for the Command Center top bar.

**Response:**
```json
{
  "total_unresolved": 142,
  "by_severity": {
    "critical": 12,
    "warning": 47,
    "info": 83
  },
  "by_skill": {
    "pipeline-hygiene": { "critical": 5, "warning": 18, "info": 30 },
    "single-thread-alert": { "critical": 3, "warning": 15, "info": 22 },
    "data-quality-audit": { "critical": 2, "warning": 8, "info": 25 },
    "pipeline-coverage": { "critical": 2, "warning": 6, "info": 6 }
  },
  "by_owner": {
    "sarah@company.com": { "critical": 4, "warning": 12, "info": 15 },
    "mike@company.com": { "critical": 3, "warning": 10, "info": 20 }
  },
  "trend": {
    "vs_last_week": { "critical": "+2", "warning": "-3", "info": "+5" }
  }
}
```

The `trend` field compares current unresolved counts to the same point last week (findings that existed 7 days ago). This powers the ↑/↓/→ trend indicators in the Command Center.

### Pipeline Snapshot Endpoint

#### GET /api/workspaces/:workspaceId/pipeline/snapshot

Aggregated pipeline view with findings annotated per stage.

**Query parameters:**
- `owner` — filter by rep
- `date` — snapshot date (default: now)

**Response:**
```json
{
  "summary": {
    "total_pipeline": 8400000,
    "deal_count": 247,
    "weighted_pipeline": 4200000,
    "coverage_ratio": 3.2,
    "win_rate_90d": 0.28,
    "avg_deal_size": 34000,
    "avg_days_to_close": 62
  },
  "by_stage": [
    {
      "stage": "Qualification",
      "deal_count": 45,
      "total_amount": 1200000,
      "weighted_amount": 240000,
      "avg_days_in_stage": 12,
      "findings": {
        "critical": 2,
        "warning": 8,
        "top_findings": [
          "5 deals missing amount",
          "2 deals stale > 30 days"
        ]
      }
    },
    {
      "stage": "Evaluation",
      "deal_count": 38,
      "total_amount": 2100000,
      "weighted_amount": 840000,
      "avg_days_in_stage": 22,
      "findings": {
        "critical": 4,
        "warning": 12,
        "top_findings": [
          "3 deals single-threaded",
          "4 deals with close date in the past"
        ]
      }
    }
  ],
  "generated_at": "2025-02-15T14:30:00Z"
}
```

**Implementation:**
1. Query `deals` table grouped by `stage`, filtered by `is_closed = false` (open pipeline only)
2. Calculate weighted amounts using stage probability (if available in workspace config, otherwise use simple stage-based weighting: early stages lower, late stages higher)
3. Query `findings` table grouped by the deals in each stage to get per-stage finding counts
4. Summarize top findings per stage (group by category, take top 2-3 by count)
5. Win rate: query deals closed in last 90 days, count won vs total closed
6. Coverage ratio: total_pipeline / workspace quota (from quotas table, sum current period)

**Stage ordering:** Use the workspace's stage configuration if available (from workspace config inference). Otherwise, use the order deals naturally appear in the CRM data, or alphabetical as fallback. This is important — stages should render in funnel order, not random.

### PATCH /api/workspaces/:workspaceId/findings/:findingId/resolve

Mark a finding as resolved (user action from Command Center or Slack button).

**Body:**
```json
{
  "resolution_method": "user_dismissed"  // or "action_taken"
}
```

**Response:**
```json
{
  "id": "uuid",
  "resolved_at": "2025-02-15T14:35:00Z",
  "resolution_method": "user_dismissed"
}
```

This is critical for the Slack action buttons Jeff is wiring tonight — "Dismiss" button on a finding calls this endpoint.

---

## A3: Dossier Assemblers

Dossiers compose data from multiple tables into a single view for a deal or account. These are Layer 2 queries — no AI rerun, just database composition with optional Claude narrative synthesis.

### Deal Dossier

Create `server/dossiers/deal-dossier.ts`:

#### Function: assembleDealDossier(workspaceId, dealId, options?)

**Queries to run (parallel where possible):**

1. **Deal record** — `SELECT * FROM deals WHERE id = :dealId AND workspace_id = :workspaceId`
2. **Contacts** — `SELECT c.* FROM contacts c JOIN deal_contacts dc ON dc.contact_id = c.id WHERE dc.deal_id = :dealId` (if deal_contacts table exists) OR `SELECT * FROM contacts WHERE associated_deal_ids @> ARRAY[:dealId]` (depends on schema)
3. **Account** — `SELECT * FROM accounts WHERE id = deal.account_id`
4. **Conversations** — `SELECT * FROM conversations WHERE deal_id = :dealId OR account_id = deal.account_id ORDER BY date DESC`
5. **Findings** — `SELECT * FROM findings WHERE deal_id = :dealId AND resolved_at IS NULL ORDER BY severity, found_at DESC`
6. **Stage history** — `SELECT * FROM deal_stage_history WHERE deal_id = :dealId ORDER BY changed_at` (if table exists)
7. **Activities** — `SELECT * FROM activities WHERE deal_id = :dealId ORDER BY date DESC LIMIT 20` (if table exists)

**Response shape:**
```typescript
interface DealDossier {
  deal: {
    id: string;
    name: string;
    amount: number;
    stage: string;
    close_date: string;
    owner_email: string;
    owner_name: string;
    created_at: string;
    days_in_current_stage: number;
    days_since_last_activity: number;
    probability: number;
    source: string;
    // ... other deal fields
  };
  
  account: {
    id: string;
    name: string;
    domain: string;
    industry: string;
    employee_count: number;
    other_open_deals: number;  // count of other open deals at this account
  } | null;
  
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    title: string;
    role: string;        // from deal_contacts if available
    last_activity: string;
    engagement_status: 'active' | 'dark' | 'unknown';  // based on recent activity/conversations
  }>;
  
  conversations: Array<{
    id: string;
    title: string;
    date: string;
    duration_minutes: number;
    participants: string[];
    link_method: string;
    summary: string;     // if available from conversation intelligence
  }>;
  
  findings: Array<{
    id: string;
    severity: string;
    category: string;
    message: string;
    found_at: string;
    actionability: string;
  }>;
  
  stage_history: Array<{
    from_stage: string;
    to_stage: string;
    changed_at: string;
    days_in_stage: number;
  }>;
  
  recent_activities: Array<{
    type: string;
    date: string;
    subject: string;
    contact_name: string;
  }>;
  
  // Computed health indicators
  health: {
    threading_status: 'multi-threaded' | 'single-threaded' | 'no-contacts';
    contact_count: number;
    unique_roles: number;
    activity_recency: 'active' | 'cooling' | 'dark';  // based on days since last activity
    stage_velocity: 'on-track' | 'slow' | 'stalled';  // based on days in stage vs average
    finding_count: { critical: number; warning: number; info: number };
    overall: 'healthy' | 'at-risk' | 'critical';      // composite assessment
  };
  
  // Optional Claude narrative (only if requested)
  narrative?: string;
  
  metadata: {
    generated_at: string;
    data_sources: string[];   // which tables had data
    missing_data: string[];   // which tables were empty (e.g., "no conversations linked")
  };
}
```

**Health computation logic:**
- `threading_status`: 0 contacts = 'no-contacts', 1 = 'single-threaded', 2+ = 'multi-threaded'
- `activity_recency`: < 7 days = 'active', 7-21 days = 'cooling', > 21 days = 'dark'
- `stage_velocity`: compare days in current stage to average days in that stage across all deals. > 2x average = 'stalled', > 1.5x = 'slow', else 'on-track'
- `overall`: any critical finding OR (dark + stalled) = 'critical'. Any warning OR (cooling + slow) = 'at-risk'. Otherwise 'healthy'.

**Narrative synthesis (optional):**

If the request includes `X-Include-Narrative: true` header (or `?narrative=true` query param), make a lightweight Claude call:

```
Given this deal data, write a 2-3 sentence executive summary of the deal's current state.
Focus on: what stage it's in, what's going well, what's at risk, and what the next action should be.

Deal: {deal.name} — ${deal.amount} — {deal.stage}
Contacts: {contacts.length} ({health.threading_status})
Last activity: {deal.days_since_last_activity} days ago
Findings: {findings.length} ({health.finding_count.critical} critical)
Stage velocity: {health.stage_velocity}
```

Keep this under 500 tokens input, ~200 tokens output. Track token usage in response metadata.

### Account Dossier

Create `server/dossiers/account-dossier.ts`:

#### Function: assembleAccountDossier(workspaceId, accountId, options?)

Similar pattern but account-scoped:

1. **Account record** — from accounts table
2. **All deals at account** — `SELECT * FROM deals WHERE account_id = :accountId AND workspace_id = :workspaceId`
3. **All contacts at account** — contacts linked to the account or to deals at the account
4. **All conversations** — conversations linked to the account or its deals
5. **All findings** — findings referencing any deal at this account OR the account directly
6. **Account signals** — from `account_signals` table if populated (from enrichment pipeline)

**Response shape:**
```typescript
interface AccountDossier {
  account: {
    id: string;
    name: string;
    domain: string;
    industry: string;
    employee_count: number;
    annual_revenue: number;
    owner_email: string;
    created_at: string;
  };
  
  deals: Array<{
    id: string;
    name: string;
    amount: number;
    stage: string;
    close_date: string;
    owner_email: string;
    is_closed: boolean;
    is_won: boolean;
    health_status: 'healthy' | 'at-risk' | 'critical';
  }>;
  
  deal_summary: {
    open_count: number;
    open_pipeline: number;
    won_count: number;
    won_revenue: number;
    lost_count: number;
    avg_deal_size: number;
  };
  
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    title: string;
    role: string;
    deals_associated: string[];    // deal names this contact is on
    last_conversation: string;     // date of most recent call
    engagement_status: 'active' | 'dark' | 'unknown';
  }>;
  
  contact_map: {
    total: number;
    by_seniority: Record<string, number>;  // 'executive': 2, 'manager': 3, etc.
    by_role: Record<string, number>;       // 'champion': 1, 'decision_maker': 2, etc.
    engaged: number;     // contacts with recent conversation
    dark: number;        // contacts with no recent conversation
  };
  
  conversations: Array<{
    id: string;
    title: string;
    date: string;
    participants: string[];
    deal_name: string;
    link_method: string;
  }>;
  
  findings: Array<{
    id: string;
    severity: string;
    category: string;
    message: string;
    deal_name: string;
    found_at: string;
  }>;
  
  signals: Array<{
    type: string;
    description: string;
    signal_score: number;
    detected_at: string;
    source: string;
  }>;
  
  relationship_health: {
    engagement_trend: 'increasing' | 'stable' | 'declining' | 'unknown';
    coverage_gaps: string[];           // "No executive contacts", "No recent calls"
    unlinked_conversations: number;    // calls with matching domain but not linked
    overall: 'strong' | 'moderate' | 'weak' | 'unknown';
  };
  
  narrative?: string;
  
  metadata: {
    generated_at: string;
    data_sources: string[];
    missing_data: string[];
  };
}
```

### Dossier API Routes

Add to `server/routes/dossiers.ts` (new file):

```
GET /api/workspaces/:workspaceId/deals/:dealId/dossier
  Query: ?narrative=true (optional)
  Returns: DealDossier

GET /api/workspaces/:workspaceId/accounts/:accountId/dossier
  Query: ?narrative=true (optional)
  Returns: AccountDossier
```

**Caching strategy:** Cache assembled dossiers in memory (or Redis if available) with a 1-hour TTL. Invalidate when:
- A skill run completes that touches this deal/account
- A sync completes for the workspace
- User explicitly requests fresh data (`?refresh=true`)

For v1, if no cache layer is available, just assemble on every request — the queries are fast (all indexed).

---

## A4: Scoped Analysis Endpoint

The "ask about your data" endpoint. User submits a natural language question with a scope, Pandora pulls relevant data and sends a focused prompt to Claude.

### POST /api/workspaces/:workspaceId/analyze

**Request body:**
```json
{
  "question": "Why did Enterprise pipeline drop last month?",
  "scope": {
    "type": "pipeline",
    "date_range": {
      "from": "2025-01-01",
      "to": "2025-01-31"
    },
    "filters": {
      "stage": "Enterprise",
      "owner": "sarah@company.com"
    }
  }
}
```

**Scope types and data pulls:**

| Scope Type | What Gets Pulled | Max Records |
|---|---|---|
| `deal` | Single deal dossier (reuse assembleDealDossier) | 1 deal + related |
| `account` | Single account dossier (reuse assembleAccountDossier) | 1 account + related |
| `pipeline` | Deals matching filters + findings + stage distribution | 100 deals max |
| `rep` | All deals for a rep + findings + performance metrics | 100 deals max |

**Implementation:**

```typescript
// server/analysis/scoped-analyzer.ts

export async function analyzeScoped(
  workspaceId: string,
  question: string,
  scope: AnalysisScope
): Promise<AnalysisResult> {
  const startTime = Date.now();
  
  // Step 1: Pull relevant data based on scope
  const context = await pullScopedData(workspaceId, scope);
  
  // Step 2: Build focused Claude prompt
  const prompt = buildAnalysisPrompt(question, scope, context);
  
  // Step 3: Call Claude (use workspace LLM config for model/provider selection)
  const llmConfig = await getWorkspaceLLMConfig(workspaceId);
  const response = await callClaude(prompt, llmConfig);
  
  // Step 4: Track usage
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
  await trackTokenUsage(workspaceId, 'scoped_analysis', tokensUsed);
  
  return {
    answer: response.content,
    data_consulted: {
      deals: context.dealCount,
      contacts: context.contactCount,
      conversations: context.conversationCount,
      findings: context.findingCount,
      date_range: scope.date_range || null
    },
    tokens_used: tokensUsed,
    latency_ms: Date.now() - startTime
  };
}
```

**Prompt construction:**

```typescript
function buildAnalysisPrompt(question: string, scope: AnalysisScope, context: ScopedData): string {
  return `You are a revenue operations analyst for a B2B SaaS company. 
Answer the following question using ONLY the data provided below. 
Be specific — reference actual deal names, amounts, rep names, and dates.
If the data doesn't contain enough information to answer fully, say what's missing.

QUESTION: ${question}

SCOPE: ${scope.type}${scope.entity_id ? ` (${scope.entity_id})` : ''}
${scope.date_range ? `DATE RANGE: ${scope.date_range.from} to ${scope.date_range.to}` : ''}

DATA:
${formatContextForPrompt(context)}

Respond in 2-4 concise paragraphs. Lead with the direct answer, then supporting evidence.`;
}
```

**Context formatting:** Summarize the pulled data into a compact text representation. Don't dump raw JSON — structure it as a readable summary:

```
PIPELINE SUMMARY:
- 45 open deals, $8.4M total pipeline
- Stage distribution: Qualification (12), Evaluation (15), Decision (10), Negotiation (8)
- 5 deals moved backward this month

TOP FINDINGS (12 critical, 18 warning):
- 3 deals stale > 30 days in Decision ($1.2M combined)
- 5 deals single-threaded in late stages
- 2 reps below 2x coverage

DEALS IN SCOPE:
[Top 20 deals by amount, with stage, days_in_stage, last_activity, finding_count]
```

Keep the total prompt under 4,000 tokens. If the data exceeds this, prioritize: findings first, then deal summaries, then activity data.

**Response:**
```json
{
  "answer": "Enterprise pipeline dropped $3.2M in January, driven primarily by three factors...",
  "data_consulted": {
    "deals": 45,
    "contacts": 120,
    "conversations": 8,
    "findings": 30,
    "date_range": { "from": "2025-01-01", "to": "2025-01-31" }
  },
  "tokens_used": 3847,
  "latency_ms": 2340
}
```

**Rate limiting:** Max 10 analysis requests per workspace per hour. Return 429 if exceeded. This prevents runaway token costs.

### Analysis Route

Add to `server/routes/analysis.ts` (new file):

```
POST /api/workspaces/:workspaceId/analyze
  Body: { question, scope }
  Returns: AnalysisResult
  Rate limit: 10/hour per workspace
```

---

## Route Registration

Register all new routes in the main app:

```typescript
// In server/index.ts or wherever routes are registered
import findingsRoutes from './routes/findings';
import dossierRoutes from './routes/dossiers';
import analysisRoutes from './routes/analysis';

app.use(findingsRoutes);
app.use(dossierRoutes);
app.use(analysisRoutes);
```

All routes should use the existing workspace auth middleware (whatever pattern the existing routes use for verifying workspace access).

---

## File Structure

```
server/
├── findings/
│   ├── extractor.ts              # A1: Skill-specific finding extraction
│   ├── auto-resolver.ts          # A1: Resolve stale findings on rerun
│   └── types.ts                  # Shared finding interfaces
├── dossiers/
│   ├── deal-dossier.ts           # A3: Deal dossier assembler
│   ├── account-dossier.ts        # A3: Account dossier assembler
│   └── types.ts                  # Dossier interfaces
├── analysis/
│   ├── scoped-analyzer.ts        # A4: Question → data pull → Claude → answer
│   ├── prompt-builder.ts         # A4: Context formatting for Claude prompt
│   └── types.ts                  # Analysis interfaces
├── routes/
│   ├── findings.ts               # A2: Findings API endpoints
│   ├── dossiers.ts               # A3: Dossier API endpoints
│   └── analysis.ts               # A4: Scoped analysis endpoint
├── migrations/
│   └── 0XX_findings_table.sql    # A1: Findings table + conversation link_method
└── scripts/
    └── backfill-findings.ts      # A1: One-time backfill from existing skill_runs
```

---

## Build Order

Build sequentially — each task depends on the previous:

1. **A1** — Migration + extractor + backfill (2-3 hours)
2. **A2** — Findings API + pipeline snapshot (2-3 hours)  
3. **A3** — Dossier assemblers + API routes (4-6 hours)
4. **A4** — Scoped analysis endpoint (3-4 hours)

### Verification Checklist

After each task, verify:

**A1:**
- [ ] Migration runs cleanly
- [ ] `findings` table exists with correct indexes
- [ ] Backfill script produces findings from existing skill_runs
- [ ] `SELECT count(*) FROM findings` returns > 0
- [ ] New skill run automatically extracts findings (trigger a manual skill run)

**A2:**
- [ ] `GET /findings` returns paginated findings with correct filters
- [ ] `GET /findings/summary` returns severity counts that match direct SQL
- [ ] `GET /pipeline/snapshot` returns stage breakdown with finding annotations
- [ ] `PATCH /findings/:id/resolve` marks finding as resolved

**A3:**
- [ ] `GET /deals/:id/dossier` returns full deal dossier with health indicators
- [ ] `GET /accounts/:id/dossier` returns full account dossier with contact map
- [ ] `?narrative=true` triggers Claude synthesis and returns narrative
- [ ] Missing data surfaces in `metadata.missing_data` array

**A4:**
- [ ] `POST /analyze` with deal scope returns focused narrative
- [ ] `POST /analyze` with pipeline scope returns pipeline-wide analysis
- [ ] Token usage is tracked
- [ ] Rate limiting works (11th request in an hour returns 429)

---

## What NOT to Build

- **Frontend components** — Phase B. APIs only.
- **WebSocket subscriptions** — Polling is fine for v1.
- **Complex caching layers** — In-memory or none. Redis comes later.
- **RBAC on findings** — Single workspace admin for now.
- **Finding assignment** — Findings are read-only + resolvable. Assignment comes with Actions queue in Phase C.
- **Cross-workspace analysis** — Scoped to single workspace always.

---

## Tonight: Slack Action Button Wiring

After A2 ships (especially the `PATCH /findings/:id/resolve` endpoint), Jeff will wire Slack action buttons. The buttons on skill briefing messages will call:

- **"Dismiss"** → `PATCH /findings/:id/resolve` with `resolution_method: 'user_dismissed'`
- **"View in Pandora"** → Deep link to Command Center (Phase B, placeholder URL for now)
- **"View Deal"** → Deep link to deal dossier page (Phase B, placeholder URL for now)

The resolve endpoint is the critical path for tonight's Slack work.
