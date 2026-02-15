# Claude Code Prompt: Deal Intelligence Layer — Risk Score, Dossier, Pipeline Risk View

## Context

Pandora has 4 Tier 1 skills running in production: Pipeline Hygiene, Single-Thread Alert, Data Quality Audit, and Pipeline Coverage by Rep. All follow the three-phase pattern (COMPUTE → CLASSIFY → SYNTHESIZE) and persist results to the `skill_runs` table as JSONB in `result_data`.

These skills already produce **claims** — findings with severity, category, entity references, and messages scoped to individual deals. But there's no function that aggregates claims across skills for a single deal, and no function that assembles a complete picture of a deal from all available data sources.

This prompt builds three zero-token query functions that read from existing data. **None of these are skills. None call LLMs. None use DeepSeek or Claude.** They are pure SQL/compute functions that compose existing skill evidence into actionable views.

**Your job:** Build these three functions, wire them to API routes, and make them available as tools in the tool registry so future skills and agents can call them.

---

## Before Starting: Read These Files

1. `server/skills/tool-definitions.ts` — Understand how the 28 existing tools wrap query functions. You're adding 3 more.
2. `server/tools/deal-query.ts` — The existing deal query functions. Your new functions will call some of these.
3. `server/tools/conversation-query.ts` — Conversation query functions. The dossier needs these.
4. `server/tools/contact-query.ts` — Contact query functions. The dossier needs these.
5. `server/linker/entity-linker.ts` — Cross-entity linker. Understand how conversations link to deals.
6. `server/analysis/stage-history-queries.ts` — Stage history query functions. The dossier needs these.
7. Any migration file that creates the `skill_runs` table — understand the schema.
8. Any migration file that creates the `conversations` table — understand available columns including `is_internal`, `deal_id`, `account_id`, `link_method`.
9. `PANDORA_EVIDENCE_ARCHITECTURE_REFERENCE.md` in project files — understand the Claim interface shape.

---

## Build 1: Deal Risk Score (Tool)

### What It Is

A compute function that queries the most recent completed run of every skill, extracts claims referencing a specific deal, and produces a composite risk score with full signal traceability.

This is a **tool** — it wraps a query function, costs zero tokens, and runs on-demand when someone views a deal. It is NOT a skill. It does not run the three-phase pattern.

### File: `server/tools/deal-risk-score.ts`

```typescript
// ============================================================
// DEAL RISK SCORE
// Aggregates skill evidence into a single health score per deal.
// Zero tokens. Pure SQL + compute. Runs on-demand.
// ============================================================

interface DealRiskSignal {
  skill_id: string;              // which skill produced this finding
  skill_name: string;            // human-readable skill name
  severity: 'critical' | 'warning' | 'info';
  category: string;              // stale_deal, single_threaded, data_quality, etc.
  message: string;               // the finding text
  metric_value?: number;         // the number behind it (e.g., days stale)
  found_at: string;              // when the skill run completed (ISO date)
}

interface DealRiskResult {
  deal_id: string;
  deal_name: string;
  score: number;                 // 0-100, higher = healthier
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  signals: DealRiskSignal[];
  signal_counts: {
    critical: number;
    warning: number;
    info: number;
  };
  skills_evaluated: string[];    // which skills had recent runs
  skills_missing: string[];      // which skills haven't run yet
  data_freshness: string;        // oldest skill run timestamp
  scored_at: string;             // ISO timestamp of when score was computed
}

export async function getDealRiskScore(
  workspaceId: string,
  dealId: string
): Promise<DealRiskResult>
```

### Scoring Logic

```
START at 100 (perfect health).

For each claim referencing this deal:
  critical  → subtract 25
  warning   → subtract 10
  info      → subtract 3

Floor at 0. Cap at 100.

Grade mapping:
  90-100 → A (healthy)
  75-89  → B (minor issues)
  50-74  → C (needs attention)
  25-49  → D (at risk)
  0-24   → F (critical)
```

### How to Find Claims for a Deal

Query the most recent completed `skill_runs` for each skill in this workspace:

```sql
-- Get the latest completed run per skill
SELECT DISTINCT ON (skill_id)
  skill_id, result_data, completed_at
FROM skill_runs
WHERE workspace_id = $1
  AND status = 'completed'
ORDER BY skill_id, completed_at DESC
```

Then for each skill run's `result_data` (JSONB), extract claims that reference this deal.

**CRITICAL: The claim structure may vary between skills.** Some skills may store claims in `result_data.claims`, others in `result_data.findings`, others in `result_data.output.claims`. You MUST inspect the actual output shape of each running skill before writing the extraction logic. Check:

- `result_data.claims` — Evidence Architecture standard
- `result_data.findings` — Some skills may use this name
- `result_data.output.claims` — If output is nested
- Look for arrays of objects with `severity` and `entity_id` or `deal_id` fields

For each claim found, check if it references this deal by:
1. `claim.entity_id === dealId` (direct match)
2. `claim.entity_type === 'deal' && claim.entity_id === dealId`
3. `claim.deal_id === dealId` (some skills may use this)
4. The claim's `evidence_record_ids` reference an evaluated_record whose `entity_id === dealId`

If the skill's claims don't have entity references (they're aggregate-level), skip that skill for per-deal scoring. Log which skills couldn't contribute.

### Track What's Missing

Compare the list of registered skills against what actually has recent runs:

```typescript
const ALL_RISK_RELEVANT_SKILLS = [
  'pipeline-hygiene',
  'single-thread-alert', 
  'data-quality-audit',
  'pipeline-coverage-by-rep'
];

// skills_evaluated = skills that had a completed run
// skills_missing = ALL_RISK_RELEVANT_SKILLS minus skills_evaluated
```

Also compute `data_freshness` — the oldest `completed_at` among evaluated skills. If the freshest data is more than 7 days old, note it.

### Batch Variant

Also export a batch function that scores multiple deals efficiently:

```typescript
export async function getBatchDealRiskScores(
  workspaceId: string,
  dealIds?: string[]  // if omitted, score ALL open deals
): Promise<DealRiskResult[]>
```

The batch variant should query skill_runs ONCE and extract claims for all deals in a single pass, NOT call `getDealRiskScore` in a loop. The skill_runs query is the same — you just iterate over more deals when extracting claims.

---

## Build 2: Deal Dossier (Composed Lookup Function)

### What It Is

A function that assembles cross-table context for a single deal. This is a **Layer 2 composed lookup** — it pulls from deals, stage history, contacts, conversations, and the risk score you just built. Zero tokens. Pure SQL joins and aggregation.

This is the function that answers "what should I do about this deal?" by giving the user everything they need to answer that question themselves.

### File: `server/tools/deal-dossier.ts`

```typescript
// ============================================================
// DEAL DOSSIER
// Assembles complete deal context from all available data sources.
// Layer 2 composed lookup — zero tokens, pure SQL.
// ============================================================

interface DealDossier {
  // Core deal data (from deals table)
  deal: {
    id: string;
    name: string;
    amount: number | null;
    stage: string;
    stage_normalized: string;
    close_date: string | null;
    owner: string;                   // owner_email or owner_name
    pipeline: string | null;
    days_in_stage: number | null;
    created_date: string;
    source_id: string;               // CRM deal ID for linking back
  };

  // Stage progression timeline (from deal_stage_history)
  stage_history: {
    from_stage: string;
    to_stage: string;
    changed_at: string;
    days_in_from_stage: number | null; // computed: gap between transitions
  }[];

  // People on the deal (from contacts + deal_contacts if exists)
  contacts: {
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    seniority: string | null;
    buying_role: string | null;      // from deal_contacts if enrichment ran
    role_confidence: number | null;
    last_activity_date: string | null;
    has_been_on_call: boolean;       // true if this contact appears in any linked conversation
  }[];

  // Conversation history (from conversations table via cross-entity linker)
  conversations: {
    id: string;
    title: string;
    started_at: string;
    duration_seconds: number | null;
    source: string;                  // 'gong' | 'fireflies'
    participants: {
      name: string;
      email: string | null;
      is_internal: boolean;
    }[];
    summary: string | null;          // if available from source
    link_method: string;             // 'email_match' | 'crm_native' | 'deal_inference'
  }[];

  // Aggregated risk score (from getDealRiskScore)
  risk: DealRiskResult;

  // Coverage gaps (computed on assembly)
  coverage_gaps: {
    contacts_never_called: {         // CRM contacts with zero conversation matches
      name: string;
      title: string | null;
      email: string | null;
    }[];
    days_since_last_call: number | null;  // null if no conversations linked
    unlinked_calls_at_account: number;    // calls with matching account but no deal link
    total_contacts: number;
    contacts_on_calls: number;
  };

  // Metadata
  data_availability: {
    has_stage_history: boolean;
    has_contacts: boolean;
    has_conversations: boolean;
    has_enrichment: boolean;
    conversation_sources: string[];  // ['gong', 'fireflies'] etc.
  };

  assembled_at: string;              // ISO timestamp
}

export async function getDealDossier(
  workspaceId: string,
  dealId: string
): Promise<DealDossier>
```

### Assembly Steps

Execute these queries in parallel where possible (Promise.all):

**Step 1: Core deal data**
```sql
SELECT id, name, amount, stage, stage_normalized, close_date,
       owner_email, owner_name, pipeline_name, days_in_stage,
       created_date, source_id
FROM deals
WHERE workspace_id = $1 AND id = $2
```

If the deal doesn't exist, throw a clear error: `Deal ${dealId} not found in workspace ${workspaceId}`.

**Step 2: Stage history**
```sql
SELECT from_stage, to_stage, changed_at
FROM deal_stage_history
WHERE workspace_id = $1 AND deal_id = $2
ORDER BY changed_at ASC
```

Compute `days_in_from_stage` for each transition by calculating the gap between consecutive `changed_at` timestamps.

If no `deal_stage_history` table exists (check first), set `stage_history: []` and `data_availability.has_stage_history = false`.

**Step 3: Contacts**

First check if the `deal_contacts` junction table exists. If yes:
```sql
SELECT c.id, c.name, c.title, c.email, c.seniority,
       dc.buying_role, dc.role_confidence
FROM deal_contacts dc
JOIN contacts c ON c.id = dc.contact_id
WHERE dc.workspace_id = $1 AND dc.deal_id = $2
```

If `deal_contacts` doesn't exist, try to find contacts through the account:
```sql
SELECT c.id, c.name, c.title, c.email, c.seniority
FROM contacts c
JOIN deals d ON d.account_id = c.account_id
WHERE d.workspace_id = $1 AND d.id = $2
```

If neither works, set `contacts: []`.

**Step 4: Conversations**
```sql
SELECT id, title, started_at, duration_seconds, source,
       participants, summary, link_method
FROM conversations
WHERE workspace_id = $1
  AND deal_id = $2
  AND is_internal IS NOT TRUE
ORDER BY started_at DESC
```

Parse the `participants` JSONB for each conversation. For each participant, determine `is_internal` by checking if their email domain matches the workspace's internal domain (use the same logic the cross-entity linker uses).

**Step 5: Risk score**

Call `getDealRiskScore(workspaceId, dealId)` from Build 1.

**Step 6: Coverage gaps (computed)**

After Steps 3 and 4 complete:

```typescript
// Which contacts have been on calls?
const contactEmailsOnCalls = new Set<string>();
for (const conv of conversations) {
  for (const p of conv.participants) {
    if (p.email && !p.is_internal) {
      contactEmailsOnCalls.add(p.email.toLowerCase());
    }
  }
}

const contactsNeverCalled = contacts.filter(c => 
  c.email && !contactEmailsOnCalls.has(c.email.toLowerCase())
);

// Days since last call
const lastCallDate = conversations.length > 0 
  ? conversations[0].started_at  // already sorted DESC
  : null;
const daysSinceLastCall = lastCallDate 
  ? Math.floor((Date.now() - new Date(lastCallDate).getTime()) / 86400000)
  : null;

// Unlinked calls at same account (conversations linked to account but not this deal)
const accountId = deal.account_id; // need to include in Step 1 query
const unlinkedAtAccount = accountId ? await db.query(`
  SELECT COUNT(*) FROM conversations
  WHERE workspace_id = $1
    AND account_id = $2
    AND deal_id IS NULL
    AND is_internal IS NOT TRUE
`, [workspaceId, accountId]) : 0;
```

### Handle Missing Tables Gracefully

The dossier MUST work even if some tables don't exist yet. Check for table existence before querying:

```typescript
async function tableExists(tableName: string): Promise<boolean> {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = $1
    )
  `, [tableName]);
  return result.rows[0].exists;
}
```

For each optional table (`deal_contacts`, `deal_stage_history`, `conversations`), check existence and degrade gracefully. Set the corresponding `data_availability` flags.

---

## Build 3: Pipeline Risk Summary (Batch Wrapper)

### What It Is

A batch function that runs the deal risk score across all open deals in a workspace and returns them sorted by health (worst first). Optional rep filter. This directly answers "show me my pipeline" and "which deals are most at risk."

### File: `server/tools/pipeline-risk-summary.ts`

```typescript
// ============================================================
// PIPELINE RISK SUMMARY
// Batch deal risk scores across all open deals.
// Optional rep filter for rep-scoped views.
// Zero tokens. Pure SQL + compute.
// ============================================================

interface PipelineRiskSummary {
  // Summary stats
  summary: {
    total_deals: number;
    total_value: number;
    avg_health_score: number;
    grade_distribution: {
      A: number;
      B: number;
      C: number;
      D: number;
      F: number;
    };
    critical_signal_count: number;    // total critical signals across all deals
    deals_with_no_signals: number;    // healthy deals with zero findings
  };

  // By stage breakdown
  by_stage: {
    stage: string;
    deal_count: number;
    total_value: number;
    avg_health_score: number;
    critical_count: number;
  }[];

  // All deals sorted by score ascending (worst first)
  deals: {
    deal_id: string;
    deal_name: string;
    amount: number | null;
    stage: string;
    owner: string;
    close_date: string | null;
    days_in_stage: number | null;
    score: number;
    grade: string;
    signal_counts: {
      critical: number;
      warning: number;
      info: number;
    };
    top_signal: string | null;       // most severe finding message
  }[];

  // Filter applied
  filter: {
    rep_email: string | null;
    stages_included: string[];       // which stages are "open"
  };

  computed_at: string;
}

export async function getPipelineRiskSummary(
  workspaceId: string,
  options?: {
    repEmail?: string;               // filter to one rep
    includeStages?: string[];        // override which stages count as "open"
    sortBy?: 'score' | 'amount' | 'close_date';  // default: score ASC
    limit?: number;                  // default: all
  }
): Promise<PipelineRiskSummary>
```

### Implementation

1. Query open deals:
```sql
SELECT id, name, amount, stage, stage_normalized, owner_email,
       owner_name, close_date, days_in_stage
FROM deals
WHERE workspace_id = $1
  AND stage_normalized NOT IN ('closed_won', 'closed_lost')
  ${repEmail ? 'AND owner_email = $2' : ''}
ORDER BY amount DESC NULLS LAST
```

2. Call `getBatchDealRiskScores(workspaceId, dealIds)` from Build 1.

3. Merge deal metadata with risk scores.

4. Compute the summary stats and by-stage breakdown from the merged results.

5. Sort by the requested field (default: score ascending = worst first).

6. Return the full `PipelineRiskSummary`.

**Performance consideration:** For workspaces with 500+ open deals, the batch risk score should still be fast because it queries `skill_runs` once (not per deal). The per-deal claim extraction is in-memory iteration over the JSONB results. Target: < 500ms for 500 deals.

---

## Wiring: API Routes

Add to `server/routes/` (either new file or extend existing deal routes):

```
GET /api/workspaces/:workspaceId/deals/:dealId/risk-score
  → getDealRiskScore(workspaceId, dealId)

GET /api/workspaces/:workspaceId/deals/:dealId/dossier
  → getDealDossier(workspaceId, dealId)

GET /api/workspaces/:workspaceId/pipeline/risk-summary
  Query params: rep_email, sort_by, limit
  → getPipelineRiskSummary(workspaceId, { repEmail, sortBy, limit })
```

Each route:
- Validates workspaceId exists
- Returns proper error codes (404 for missing deal, 400 for bad params)
- Wraps response in `{ success: true, data: ... }` envelope matching existing API patterns

---

## Wiring: Tool Registration

Add these three functions to `server/skills/tool-definitions.ts` so skills and agents can call them:

```typescript
{
  name: 'getDealRiskScore',
  description: 'Get composite health score for a single deal, aggregating findings from all skills',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'The deal ID to score' }
    },
    required: ['dealId']
  },
  handler: (workspaceId, params) => getDealRiskScore(workspaceId, params.dealId)
},
{
  name: 'getDealDossier',
  description: 'Assemble complete deal context: CRM data, stage history, contacts, conversations, risk score, and coverage gaps',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'The deal ID to build dossier for' }
    },
    required: ['dealId']
  },
  handler: (workspaceId, params) => getDealDossier(workspaceId, params.dealId)
},
{
  name: 'getPipelineRiskSummary',
  description: 'Get health scores for all open deals sorted by risk. Answers: which deals are most at risk?',
  parameters: {
    type: 'object',
    properties: {
      repEmail: { type: 'string', description: 'Optional: filter to one rep' },
      sortBy: { type: 'string', enum: ['score', 'amount', 'close_date'] },
      limit: { type: 'number', description: 'Max deals to return' }
    }
  },
  handler: (workspaceId, params) => getPipelineRiskSummary(workspaceId, params)
}
```

---

## Testing

After building, test against real workspace data. Use Imubit (Salesforce) or Frontera (HubSpot) — whichever has recent skill runs.

### Test 1: Single Deal Risk Score
```bash
curl http://localhost:3001/api/workspaces/{WS_ID}/deals/{DEAL_ID}/risk-score
```

Expected: 
- Score between 0-100
- `signals` array with findings from at least 1-2 skills
- `skills_evaluated` lists skills that had recent runs
- `skills_missing` lists any skills without runs
- If no skill runs exist for this workspace, score should be 100 with `skills_missing` listing all 4 skills

### Test 2: Deal Dossier
```bash
curl http://localhost:3001/api/workspaces/{WS_ID}/deals/{DEAL_ID}/dossier
```

Expected:
- Deal data populated from deals table
- `data_availability` accurately reflects what tables exist and have data
- If conversations exist and are linked, `conversations` array is populated
- If no conversations table, `data_availability.has_conversations = false` and `conversations = []`
- Coverage gaps computed correctly (contacts_never_called should be contacts minus those who appear in conversation participants)

### Test 3: Pipeline Risk Summary
```bash
curl "http://localhost:3001/api/workspaces/{WS_ID}/pipeline/risk-summary"
curl "http://localhost:3001/api/workspaces/{WS_ID}/pipeline/risk-summary?rep_email=jane@company.com"
```

Expected:
- All open deals returned, sorted by score ascending
- Summary stats add up (grade distribution counts = total_deals)
- By-stage breakdown covers all unique stages in the open deals
- Rep filter returns only that rep's deals
- Response time < 1 second for Imubit's ~247 deals

### Test 4: Empty State
Test against a workspace with no skill runs. Expected:
- Risk score = 100, signals = [], skills_missing = all 4
- Dossier populates deal data but risk section shows no findings
- Pipeline summary shows all deals at 100 with zero signals

### Test 5: Missing Tables
If `deal_contacts` or `deal_stage_history` don't exist in a workspace, the dossier should not crash. It should return empty arrays and set the corresponding `data_availability` flags to false.

---

## What NOT to Build

- **No UI.** This is the data layer. The Command Center build (separate prompt) will consume these endpoints.
- **No LLM calls.** These functions are pure compute. The optional narrative synthesis for deal dossiers is a separate, future addition.
- **No new database tables.** These functions read from existing tables only.
- **No new skills.** These are tools — query functions that wrap SQL and compute logic.
- **No caching layer yet.** Premature. If performance becomes an issue with 1000+ deals, add caching then.
- **No Slack formatting.** These are API endpoints and tools. Slack rendering is the renderer layer's job.

---

## Architecture Compliance

These builds align with the evidence architecture:

- **Layer 1 (Skills):** Not touched. Skills continue producing claims as they do today.
- **Layer 2 (Composed Lookups):** The deal dossier is a canonical Layer 2 function — it composes data from multiple sources without rerunning anything.
- **Tools:** The risk score and pipeline summary are tools — query functions that agents and skills can call, also exposed as API endpoints for the Command Center.
- **Zero tokens:** No LLM involvement. Pure SQL and in-memory computation.
- **Evidence traceability:** Every signal in the risk score traces back to a specific skill run with a timestamp. Users can "double-click" on any finding to see where it came from.

---

## Sequence for Building

1. **Deal Risk Score** first (Build 1) — the dossier depends on it
2. **Deal Dossier** second (Build 2) — calls the risk score
3. **Pipeline Risk Summary** third (Build 3) — calls the batch risk score
4. **API routes** — wire all three to Express
5. **Tool registration** — add to tool-definitions.ts
6. **Test** — hit all endpoints against real data
