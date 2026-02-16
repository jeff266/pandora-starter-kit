# PANDORA — Command Center Build Prompts
## Phase A (Backend APIs) + Phase B (Frontend) — Replit Sessions

### How to Use

Each section is a **standalone prompt** you paste into Replit's AI agent.
Do them in order. Each builds on the previous.

Start each session with:
> "Pull latest from GitHub. Read REPLIT_CONTEXT_ADDENDUM.md first, then REPLIT_CONTEXT.md and ARCHITECTURE.md."

**Phase A** (Prompts 1-4): Backend APIs — ~12-16 hours total
**Phase B** (Prompts 5-8): Frontend UI — ~20-24 hours total

---

## PROMPT 1: Findings Table + Migration + Extraction (2-3 hours)

```
Pull latest from GitHub. Read REPLIT_CONTEXT_ADDENDUM.md first, then
REPLIT_CONTEXT.md and ARCHITECTURE.md.

You're building the foundation for the Command Center — a normalized
findings table that extracts skill findings from skill_runs.result_data
into a queryable, indexed table. This table becomes the primary data
source for the Command Center, Insights Feed, and Actions queue.

1. DATABASE MIGRATION

Create the next migration (check migrations/ for the current number):

CREATE TABLE findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_run_id UUID NOT NULL REFERENCES skill_runs(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  severity TEXT NOT NULL,              -- 'critical', 'warning', 'info'
  category TEXT,                       -- 'stale_deal', 'single_threaded', 
                                       -- 'data_quality', 'coverage_gap',
                                       -- 'no_close_date', 'no_amount', etc.
  message TEXT NOT NULL,               -- Human-readable finding text
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  owner_email TEXT,                    -- Rep who owns the entity
  entity_type TEXT,                    -- 'deal', 'account', 'contact', 'rep'
  entity_name TEXT,                    -- Display name for the entity
  metric_value NUMERIC,                -- The number behind the finding (amount, days, etc.)
  metric_context TEXT,                 -- "vs. benchmark of X" or "changed from Y"
  actionability TEXT DEFAULT 'immediate',  -- 'immediate', 'strategic', 'monitor'
  metadata JSONB DEFAULT '{}',         -- Skill-specific context
  found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,             -- null until resolved or next run clears
  snoozed_until TIMESTAMPTZ,           -- null unless user snoozed
  assigned_to TEXT,                    -- email of person assigned to act
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_findings_workspace_severity 
  ON findings(workspace_id, severity, found_at DESC);
CREATE INDEX idx_findings_workspace_active
  ON findings(workspace_id, found_at DESC) 
  WHERE resolved_at IS NULL AND (snoozed_until IS NULL OR snoozed_until < now());
CREATE INDEX idx_findings_deal 
  ON findings(deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX idx_findings_account 
  ON findings(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX idx_findings_owner 
  ON findings(workspace_id, owner_email);
CREATE INDEX idx_findings_skill 
  ON findings(workspace_id, skill_id, found_at DESC);
CREATE INDEX idx_findings_category 
  ON findings(workspace_id, category);

Also add the conversation link confidence column:

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  link_method TEXT;  -- 'crm_metadata', 'participant_email', 'domain_inferred', 'manual', null


2. FINDINGS EXTRACTION SERVICE

Create server/findings/extraction.ts

This service extracts findings from skill run result_data and writes them
to the findings table. Each skill produces structured output — the extractor
normalizes it.

Export these functions:

a. extractAndPersistFindings(workspaceId, skillRunId, skillId, resultData)
   
   The resultData shape varies by skill, but skills that follow the evidence
   contract have a `claims` array. Skills that don't yet will have their
   findings embedded in different structures.
   
   Strategy:
   - If resultData.claims exists (evidence contract compliant):
     Map each claim → finding row. The claim has severity, category, 
     message, entity_type, entity_id, metric_value, metric_context,
     actionability, evidence_record_ids.
   
   - If resultData.claims doesn't exist, use skill-specific extractors:
     
     For pipeline-hygiene: Look in resultData for stale deals, deals 
     without close dates, deals without amounts. Each flagged deal 
     becomes a finding.
     
     For single-thread-alert: Look for deals flagged as single-threaded
     or with missing buying roles.
     
     For data-quality-audit: Look for field completeness issues.
     
     For pipeline-coverage: Look for reps below coverage threshold.
   
   Don't worry about covering every edge case — build the claims path
   first, then add skill-specific extractors for the 4 Tier 1 skills.
   Log a warning for skills with unrecognized output shapes.

b. resolveStaleFindings(workspaceId, skillId, currentFindingDealIds)
   
   After extracting new findings from a skill run, mark old findings from
   the same skill as resolved IF the deal/entity is no longer flagged.
   
   UPDATE findings 
   SET resolved_at = now() 
   WHERE workspace_id = $1 
     AND skill_id = $2 
     AND resolved_at IS NULL
     AND deal_id IS NOT NULL
     AND deal_id NOT IN (... current finding deal IDs ...)

   This keeps the findings table current — resolved findings stay for
   history but don't show in active views.


3. WIRE INTO SKILL RUNTIME

Find where skill runs complete and result_data is persisted (likely in
the skill runner/executor — search for where skill_runs rows are updated
with status = 'completed' and result_data is set).

After the existing persistence logic, add:

  import { extractAndPersistFindings, resolveStaleFindings } from '../findings/extraction';
  
  // After skill run completes successfully:
  const findings = await extractAndPersistFindings(
    workspaceId, skillRunId, skillId, resultData
  );
  
  // Resolve findings from previous runs that are no longer flagged
  const currentDealIds = findings
    .filter(f => f.deal_id)
    .map(f => f.deal_id);
  await resolveStaleFindings(workspaceId, skillId, currentDealIds);

This is non-blocking — if extraction fails, the skill run itself still
succeeds. Wrap in try/catch and log errors.


4. BACKFILL SCRIPT

Create server/findings/backfill.ts

A one-time script that reads all existing skill_runs with status = 'completed'
and extracts findings from their result_data.

  async function backfillFindings(workspaceId?: string)
  
  Query: SELECT id, workspace_id, skill_id, result_data, completed_at
         FROM skill_runs 
         WHERE status = 'completed' 
         AND result_data IS NOT NULL
         ORDER BY completed_at DESC
  
  If workspaceId is provided, filter to that workspace.
  
  For each run, call extractAndPersistFindings. Use found_at = completed_at
  (not now()) so the timeline is accurate.
  
  Skip runs where findings already exist (check by skill_run_id).
  
  Log progress: "Backfilled X findings from Y skill runs"

Add a route to trigger it:
  POST /api/admin/backfill-findings
  Body: { workspaceId?: string }  (optional — all workspaces if omitted)


5. VERIFY

After building:
- Run the migration
- Run the backfill for Imubit workspace (Salesforce data, 247 deals)
- Verify findings appear: SELECT skill_id, severity, count(*) 
  FROM findings WHERE workspace_id = '<imubit>' 
  GROUP BY skill_id, severity
- Run a skill manually and verify new findings are extracted
- Check that old findings get resolved when deals are no longer flagged

Expected: You should see findings from pipeline-hygiene (stale deals,
missing close dates), single-thread-alert (single-threaded deals), 
data-quality-audit (field completeness), and pipeline-coverage 
(under-covered reps).
```

---

## PROMPT 2: Findings API + Pipeline Snapshot (2-3 hours)

```
Pull latest from GitHub.

You're building the API layer that the Command Center frontend will
consume. These endpoints power the headline metrics, findings feed,
and annotated pipeline chart.

Read the findings table schema from the migration you just created.
Also read the existing deals, contacts, accounts table schemas.


1. FINDINGS API

Create server/routes/findings.ts (or add to existing routes)

All endpoints are workspace-scoped: /api/workspaces/:workspaceId/findings

a. GET /api/workspaces/:id/findings
   
   Query params:
   - skill_id (string, optional) — filter by skill
   - severity (string, optional) — 'critical', 'warning', 'info'
   - category (string, optional) — 'stale_deal', 'single_threaded', etc.
   - owner_email (string, optional) — filter by rep
   - deal_id (UUID, optional) — findings for a specific deal
   - account_id (UUID, optional) — findings for a specific account
   - status (string, default 'active') — 'active', 'resolved', 'snoozed', 'all'
     - active: resolved_at IS NULL AND (snoozed_until IS NULL OR snoozed_until < now())
     - resolved: resolved_at IS NOT NULL
     - snoozed: snoozed_until IS NOT NULL AND snoozed_until > now()
     - all: no filter
   - since (ISO datetime, optional) — found_at >= since
   - until (ISO datetime, optional) — found_at <= until
   - limit (integer, default 50, max 200)
   - offset (integer, default 0)
   - sort (string, default 'severity_then_recent')
     - severity_then_recent: ORDER BY CASE severity WHEN 'critical' THEN 0 
       WHEN 'warning' THEN 1 ELSE 2 END, found_at DESC
     - recent: ORDER BY found_at DESC
     - oldest: ORDER BY found_at ASC
   
   Returns: {
     findings: [...],
     total: number,
     limit: number,
     offset: number
   }

b. GET /api/workspaces/:id/findings/summary
   
   Returns aggregate counts for the headline metrics:
   
   {
     total_active: number,
     by_severity: { critical: N, warning: N, info: N },
     by_skill: { "pipeline-hygiene": N, "single-thread-alert": N, ... },
     by_category: { "stale_deal": N, "single_threaded": N, ... },
     by_owner: [{ email: "...", count: N }, ...],
     since_last_week: {
       new_findings: N,
       resolved_findings: N,
       net_change: N
     }
   }
   
   Only counts active findings (resolved_at IS NULL, not snoozed).

c. PATCH /api/workspaces/:id/findings/:findingId
   
   Update finding status. Body accepts:
   - resolved_at: ISO datetime (or "now" shorthand)
   - snoozed_until: ISO datetime
   - assigned_to: email string
   
   Returns updated finding.

d. POST /api/workspaces/:id/findings/:findingId/snooze
   Body: { days: number }  (default 7)
   Sets snoozed_until = now() + days
   Returns updated finding.

e. POST /api/workspaces/:id/findings/:findingId/resolve
   Sets resolved_at = now()
   Returns updated finding.


2. PIPELINE SNAPSHOT API

Create server/routes/pipeline.ts (or add to existing routes)

GET /api/workspaces/:id/pipeline/snapshot

This powers the Command Center's headline metrics AND the annotated
pipeline chart. It's a single endpoint that returns everything the
home page needs.

Query params:
- date_range (string, default 'this_month') — 'today', 'this_week', 
  'this_month', 'this_quarter', 'custom'
- from (ISO date, required if date_range = 'custom')
- to (ISO date, required if date_range = 'custom')
- owner_email (string, optional) — filter to one rep

Returns:
{
  headline_metrics: {
    total_pipeline: { value: number, deal_count: number, trend: 'up'|'down'|'flat' },
    weighted_pipeline: { value: number, trend: 'up'|'down'|'flat' },
    coverage_ratio: { 
      value: number, 
      quota: number,    // from context_layer goals
      trend: 'up'|'down'|'flat' 
    },
    win_rate_90d: { value: number, trend: 'up'|'down'|'flat' },
    open_findings: { 
      total: number, 
      critical: number, 
      warning: number, 
      info: number 
    }
  },
  
  by_stage: [
    {
      stage: "Discovery",
      stage_normalized: "discovery",
      deal_count: number,
      total_amount: number,
      weighted_amount: number,
      avg_days_in_stage: number,
      findings: [
        { 
          category: "stale_deal", 
          count: 3, 
          total_amount: 4100000,
          severity: "warning",
          message: "3 deals ($4.1M) stalled 21+ days"
        }
      ]
    },
    // ... per stage
  ],
  
  by_rep: [
    {
      email: "mike@company.com",
      name: "Mike Chen",
      deal_count: number,
      total_pipeline: number,
      quota: number,           // from context_layer if available
      coverage_ratio: number,
      finding_count: number,
      critical_findings: number
    }
  ],
  
  metadata: {
    generated_at: ISO datetime,
    data_freshness: {
      deals_last_synced: ISO datetime,
      last_skill_run: ISO datetime
    }
  }
}

Implementation notes:

- headline_metrics.trend: Compare current period to prior period of same 
  length. "up" if > 5% increase, "down" if > 5% decrease, "flat" otherwise.

- coverage_ratio: Read quota from context_layer.goals_and_targets. If no
  quota configured, return null for quota and coverage_ratio.

- win_rate_90d: COUNT closed-won / COUNT (closed-won + closed-lost) in
  last 90 days. Use stage_normalized or workspace config to identify
  closed-won/lost stages.

- by_stage findings: JOIN findings table to deals, group by stage. 
  Aggregate findings into summary messages per category per stage.

- weighted_pipeline: Use stage probability from workspace config if
  available, otherwise use standard defaults:
  discovery=10%, qualification=20%, evaluation=40%, 
  negotiation=60%, proposal=75%, closing=90%

- by_rep: LEFT JOIN to context_layer for quota data. Not all workspaces
  will have quotas configured.


3. CONNECTOR STATUS API

Add to existing connector routes (or create if missing):

GET /api/workspaces/:id/connectors/status

Returns:
{
  connectors: [
    {
      type: "hubspot",
      status: "connected",        // from connector_configs.status
      last_sync_at: ISO datetime, // from connector_configs.last_sync_at
      record_counts: {
        deals: N,
        contacts: N,
        accounts: N,
        conversations: N          // if Gong/Fireflies
      },
      health: "green"|"yellow"|"red",
      // green: synced within 24h, no errors
      // yellow: synced but > 24h ago, or had non-fatal errors
      // red: sync failed, or never synced
      last_error: string|null
    }
  ]
}


4. VERIFY

Test each endpoint with curl or the API explorer:

- GET /api/workspaces/<imubit>/findings?severity=critical
  Should return critical findings from Imubit's Salesforce data

- GET /api/workspaces/<imubit>/findings/summary
  Should show counts by severity, skill, category

- GET /api/workspaces/<imubit>/pipeline/snapshot
  Should return headline metrics with stage breakdown and per-stage findings

- GET /api/workspaces/<imubit>/connectors/status
  Should show Salesforce connector as connected with record counts

Log all responses. Fix any issues.
```

---

## PROMPT 3: Dossier Assemblers (4-6 hours)

```
Pull latest from GitHub.

You're building the dossier assemblers — functions that pull together
cross-table context for a single deal or account. These power the
drill-through detail pages in Command Center.

Read:
- The deals, contacts, accounts, conversations table schemas
- The findings table you just created
- The deal_stage_history table (if it exists — check migrations)
- The deal_contacts table (if it exists from ICP enrichment)
- The cross-entity linker (server/linker/entity-linker.ts)


1. DEAL DOSSIER ASSEMBLER

Create server/dossiers/deal-dossier.ts

Export:

async function assembleDealDossier(
  workspaceId: string, 
  dealId: string,
  options?: { includeNarrative?: boolean }
): Promise<DealDossier>

The DealDossier type:

interface DealDossier {
  deal: {
    id: string;
    name: string;
    amount: number | null;
    stage: string;
    stage_normalized: string | null;
    close_date: string | null;
    owner_email: string | null;
    owner_name: string | null;
    pipeline: string | null;
    days_in_stage: number | null;
    created_at: string;
    source: string;           // 'hubspot', 'salesforce'
    source_id: string;
    source_url: string | null; // Link back to CRM record
    custom_fields: Record<string, any>;
  };
  
  stage_history: Array<{
    from_stage: string | null;
    to_stage: string;
    changed_at: string;
    days_in_previous: number | null;
  }>;
  
  contacts: Array<{
    id: string;
    name: string;
    title: string | null;
    email: string;
    seniority: string | null;
    buying_role: string | null;
    role_confidence: number | null;
    last_activity_date: string | null;
    engagement_level: 'active' | 'fading' | 'dark';
  }>;
  
  conversations: Array<{
    id: string;
    title: string;
    started_at: string;
    duration_seconds: number | null;
    participants: string[];
    summary: string | null;
    link_method: string | null;  // How this conversation was linked
    source: string;              // 'gong', 'fireflies'
  }>;
  
  findings: Array<{
    id: string;
    skill_id: string;
    severity: string;
    category: string | null;
    message: string;
    found_at: string;
    resolved_at: string | null;
    actionability: string;
  }>;
  
  enrichment: {
    buying_committee_size: number;
    roles_identified: string[];
    icp_fit_score: number | null;
    account_signals: any[];
  } | null;
  
  coverage_gaps: {
    contacts_never_called: Array<{ name: string; email: string; title: string | null }>;
    days_since_last_call: number | null;
    unlinked_calls: number;    // Calls with matching domain but not confirmed linked
  };
  
  narrative: string | null;     // Claude-generated summary (if requested)
  
  metadata: {
    assembled_at: string;
    data_sources_consulted: string[];
    assembly_duration_ms: number;
  };
}

Implementation:

Run all queries in parallel where possible:

  const [deal, stageHistory, contacts, conversations, findings, enrichment] = 
    await Promise.all([
      getDealById(workspaceId, dealId),
      getStageHistory(workspaceId, dealId),
      getDealContacts(workspaceId, dealId),
      getDealConversations(workspaceId, dealId),
      getDealFindings(workspaceId, dealId),
      getDealEnrichment(workspaceId, dealId),
    ]);

For contacts:
- Check deal_contacts table first (buying roles from enrichment).
- If deal_contacts doesn't exist or is empty, fall back to contact
  associations from the CRM sync (contacts linked via deal associations).
- Compute engagement_level:
  - active: activity within 14 days
  - fading: activity within 14-30 days
  - dark: no activity in 30+ days (or never)

For conversations:
- Query conversations table where deal_id matches
- OR where account_id matches the deal's account
- Include link_method so the UI can show confidence
- Sort by started_at DESC

For coverage_gaps:
- contacts_never_called: Contacts linked to this deal who don't appear
  as participants in any conversation
- days_since_last_call: Days since most recent conversation
- unlinked_calls: Count conversations where participant domain matches
  deal's account domain but conversation isn't linked to this deal.
  This requires joining on the account's domain.

For narrative (optional, only if includeNarrative = true):
- Assemble a compact context (~2K tokens max) from the dossier
- Call Claude with a synthesis prompt that produces a 2-4 sentence summary
- The summary should highlight: deal status, recent activity/inactivity,
  relationship health, and any critical findings
- Cache the narrative result (store on the response, let the caller cache
  as needed — we'll add TTL caching later)

If any query fails, log the error and return null/empty for that section.
Never fail the whole dossier because one section errored.


2. ACCOUNT DOSSIER ASSEMBLER

Create server/dossiers/account-dossier.ts

Export:

async function assembleAccountDossier(
  workspaceId: string, 
  accountId: string,
  options?: { includeNarrative?: boolean }
): Promise<AccountDossier>

The AccountDossier type:

interface AccountDossier {
  account: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    employee_count: number | null;
    annual_revenue: number | null;
    owner_email: string | null;
    source: string;
    source_id: string;
    source_url: string | null;
  };
  
  deals: Array<{
    id: string;
    name: string;
    amount: number | null;
    stage: string;
    stage_normalized: string | null;
    close_date: string | null;
    owner_email: string | null;
    days_in_stage: number | null;
    finding_count: number;
    critical_findings: number;
  }>;
  
  contacts: Array<{
    id: string;
    name: string;
    title: string | null;
    email: string;
    seniority: string | null;
    buying_role: string | null;
    last_activity_date: string | null;
    conversation_count: number;
    engagement_level: 'active' | 'fading' | 'dark';
  }>;
  
  conversations: Array<{
    id: string;
    title: string;
    started_at: string;
    duration_seconds: number | null;
    participants: string[];
    summary: string | null;
    linked_deal_name: string | null;
    link_method: string | null;
    source: string;
  }>;
  
  findings: Array<{
    id: string;
    skill_id: string;
    severity: string;
    category: string | null;
    message: string;
    deal_name: string | null;
    found_at: string;
  }>;
  
  relationship_health: {
    overall: 'healthy' | 'at_risk' | 'declining' | 'cold';
    engagement_trend: 'increasing' | 'stable' | 'decreasing' | 'no_data';
    total_conversations: number;
    conversations_last_30d: number;
    conversations_last_90d: number;
    unique_contacts_engaged: number;
    total_contacts_known: number;
    coverage_percentage: number;      // contacts_engaged / total_contacts
    days_since_last_interaction: number | null;
  };
  
  narrative: string | null;
  
  metadata: {
    assembled_at: string;
    data_sources_consulted: string[];
    assembly_duration_ms: number;
  };
}

For relationship_health:
- healthy: engagement_trend is stable or increasing AND 
  coverage > 50% AND days_since_last < 14
- at_risk: engagement_trend decreasing OR coverage < 30%
- declining: engagement_trend decreasing AND days_since_last > 30
- cold: no conversations in 60+ days

For engagement_trend: compare conversations_last_30d to the 30d before that.
If current > prior by 20%+, increasing. If lower by 20%+, decreasing. Else stable.


3. DOSSIER API ENDPOINTS

Create server/routes/dossiers.ts

GET /api/workspaces/:id/deals/:dealId/dossier
  Optional header: X-Include-Narrative: true
  Returns: DealDossier JSON

GET /api/workspaces/:id/accounts/:accountId/dossier
  Optional header: X-Include-Narrative: true
  Returns: AccountDossier JSON

Both endpoints should:
- Return 404 if the deal/account doesn't exist in this workspace
- Log assembly duration
- Set Cache-Control: private, max-age=300 (5 min browser cache)


4. VERIFY

Test with Imubit data:

- Pick a deal with activity — GET its dossier
  Verify: deal data, contacts, findings, coverage_gaps all populated

- Pick an account — GET its dossier  
  Verify: account data, deals list, relationship_health calculated

- Test narrative generation (add X-Include-Narrative: true header)
  Verify: Claude produces a concise, accurate summary

- Test a deal with no conversations
  Verify: conversations = [], coverage_gaps shows all contacts as never_called

- Test error resilience: temporarily break one sub-query
  Verify: dossier still returns with that section as null/empty

Log all responses and fix issues.
```

---

## PROMPT 4: Scoped Analysis Endpoint (3-4 hours)

```
Pull latest from GitHub.

You're building the natural language analysis endpoint — the "ask about
this deal/account/pipeline" feature. This lets users type questions in
the Command Center and get AI-generated answers scoped to their data.

Read:
- server/dossiers/deal-dossier.ts (just built)
- server/dossiers/account-dossier.ts (just built)
- server/context/index.ts (context layer functions)
- server/llm/ or wherever the LLM provider adapter / Claude calls live
- The existing chat router if one exists (server/chat/ directory)


1. SCOPED ANALYSIS SERVICE

Create server/analysis/scoped-analysis.ts

Export:

async function analyzeQuestion(
  workspaceId: string,
  question: string,
  scope: AnalysisScope
): Promise<AnalysisResult>

interface AnalysisScope {
  type: 'deal' | 'account' | 'pipeline' | 'rep';
  entity_id?: string;       // Required for deal, account
  entity_name?: string;     // Optional, for display
  date_range?: { from: string; to: string };
  filters?: {
    stage?: string;
    owner_email?: string;
    severity?: string;
  };
}

interface AnalysisResult {
  answer: string;                    // Claude's narrative response
  data_consulted: {
    deals: number;
    contacts: number;
    conversations: number;
    findings: number;
    date_range: { from: string; to: string } | null;
  };
  confidence: 'high' | 'medium' | 'low';
  suggested_followups: string[];     // 2-3 follow-up questions
  tokens_used: number;
  latency_ms: number;
}

Implementation:

Step 1: Gather context based on scope type

  switch (scope.type) {
    case 'deal':
      // Use assembleDealDossier(workspaceId, scope.entity_id)
      // This gives us everything about the deal
      break;
    
    case 'account':
      // Use assembleAccountDossier(workspaceId, scope.entity_id)
      break;
    
    case 'pipeline':
      // Query pipeline snapshot data:
      // - Total pipeline by stage
      // - Active findings summary
      // - Stage movement trends
      // - Rep breakdown
      // Apply date_range and filters if provided
      break;
    
    case 'rep':
      // Query deals owned by this rep
      // Their findings
      // Their pipeline metrics
      // Their conversation activity
      break;
  }

Step 2: Compress the context

The assembled data could be large. Compress it to fit within ~4K tokens
of Claude input:

  - For deals: Include deal data, stage history (last 5 moves), 
    top 5 contacts by activity, top 5 conversations by recency,
    all active findings
  - For accounts: Same compression but across all account deals
  - For pipeline: Include stage summaries, top findings by severity,
    rep breakdown (top 10 reps)
  - For rep: Their deals summary, their findings, activity metrics

Step 3: Build the Claude prompt

const prompt = `You are a RevOps analyst answering a question about 
${scope.type === 'deal' ? 'a specific deal' : scope.type === 'account' ? 'a specific account' : scope.type === 'pipeline' ? 'the pipeline' : 'a sales rep'}.

BUSINESS CONTEXT:
${businessContext}

DATA:
${compressedContext}

QUESTION: ${question}

Answer the question directly and specifically using the data provided.
Reference specific deals, amounts, dates, and people by name.
If the data doesn't fully answer the question, say what you can answer
and what additional data would be needed.

Keep your answer to 2-4 paragraphs. Be specific, not generic.
Use numbers and names from the data.

After your answer, suggest 2-3 natural follow-up questions the user
might want to ask next. Format as a JSON array at the end:
FOLLOWUPS: ["question 1", "question 2", "question 3"]`;

Step 4: Call Claude

Use the existing LLM provider adapter. Use the synthesis model
(Claude, not DeepSeek — this is strategic analysis, not classification).

Track tokens and latency.

Step 5: Parse the response

Extract the answer text and the FOLLOWUPS JSON array.
If FOLLOWUPS parsing fails, return empty array.

Assess confidence:
- high: scope was narrow (single deal/account) and data was rich
- medium: scope was broader (pipeline/rep) or data was sparse
- low: question seems to require data we don't have


2. ANALYSIS API ENDPOINT

POST /api/workspaces/:id/analyze

Body: {
  question: string,           // Required
  scope: {
    type: 'deal' | 'account' | 'pipeline' | 'rep',
    entity_id?: string,
    date_range?: { from: string, to: string },
    filters?: { stage?: string, owner_email?: string }
  }
}

Returns: AnalysisResult

Validations:
- question is required and max 500 characters
- scope.type is required
- entity_id is required for deal and account scopes
- Rate limit: max 10 requests per workspace per minute
  (simple in-memory counter is fine for now)


3. QUESTION SUGGESTIONS

GET /api/workspaces/:id/analyze/suggestions

Returns pre-built question suggestions based on workspace data:

{
  pipeline: [
    "What's the biggest risk to this quarter's number?",
    "Which deals are most likely to slip?",
    "Where is pipeline concentrated?"
  ],
  deal: [
    "What happened with this deal recently?",
    "Who are we talking to and who's missing?",
    "What are the blockers?"
  ],
  account: [
    "How is our relationship health?",
    "Which contacts are going dark?",
    "What's the full history with this account?"
  ]
}

These are static for v1. Later they'll be dynamic based on actual findings.


4. VERIFY

Test with Imubit data:

- POST /analyze with scope = deal, pick a deal with findings
  Question: "What's going on with this deal?"
  Verify: Answer references specific data from the dossier

- POST /analyze with scope = pipeline
  Question: "What's our biggest risk?"
  Verify: Answer references real pipeline data and findings

- POST /analyze with scope = account
  Question: "How is our relationship with this account?"
  Verify: Answer uses conversation and contact data

- Test rate limiting: fire 15 requests quickly
  Verify: requests 11+ return 429

- Test bad input: missing question, invalid scope type
  Verify: proper 400 error responses

Log all responses and fix issues.
```

---

## PROMPT 5: Command Center Shell + Navigation (4-6 hours)

```
Pull latest from GitHub.

You're building the Command Center frontend shell — the navigation 
structure, workspace selector, route scaffolding, and basic layout
that all Command Center pages live inside.

This is desktop-first (RevOps operators use desktop). No mobile
responsive layout needed yet.

Read:
- The existing frontend code — find the current React app entry point,
  routing setup, and any existing layout components
- The pandora-platform.jsx mockup in project knowledge (if accessible)
  for the sidebar navigation design


1. NAVIGATION SIDEBAR

The sidebar has these sections and items:

Command Center (home icon) — the main dashboard, route: /command-center

Intelligence section:
  - Agents — route: /agents
  - Agent Builder — route: /agents/builder (indent, show as sub-item)
  - Skills — route: /skills, badge showing active skill count
  - Tools — route: /tools

Operations section:
  - Playbooks — route: /playbooks, badge showing playbook count
  - Insights Feed — route: /insights
  - Actions — route: /actions, badge showing pending action count

Data section:
  - Connectors — route: /connectors, badge showing connected count
  - Connector Health — route: /connectors/health
  - Data Dictionary — route: /data-dictionary

Admin section:
  - Users & Teams — route: /admin/users
  - Settings — route: /admin/settings

Design:
- Dark sidebar (not white — match the mockup tone)
- Active item highlighted with accent color
- Section labels are muted text, not clickable
- Badges are small pill indicators (number)
- Sidebar width: ~220px, collapsible to icons only
- Top of sidebar: workspace selector dropdown

For Phase B, only Command Center, Insights Feed, Connectors, and
Skills will have real content. All other routes show a clean 
"Coming Soon" placeholder with the feature name and a brief description.


2. WORKSPACE SELECTOR

At the top of the sidebar:
- Shows current workspace name with a small icon/avatar
- Dropdown to switch workspaces
- Fetches workspace list from GET /api/workspaces (or wherever 
  the workspace list endpoint is)
- Switching workspace updates the context for all API calls


3. TOP BAR

Above the main content area:
- Page title (dynamic based on current route)
- Time range selector: Today | This Week | This Month | This Quarter | Custom
  - Custom shows date picker
  - Selection persists across pages via URL params or context
- Last refreshed timestamp (from pipeline/snapshot metadata)
- Refresh button (manual refresh of current page data)


4. ROUTE SCAFFOLDING

Set up React Router (or whatever routing the existing app uses):

/command-center          → CommandCenterPage (build in Prompt 6)
/command-center/deal/:id → DealDetailPage (build in Prompt 7)
/command-center/account/:id → AccountDetailPage (build in Prompt 7)
/insights               → InsightsFeedPage (build in Prompt 8)
/skills                 → SkillsPage (build in Prompt 8)
/connectors             → ConnectorsPage (build in Prompt 8)
/connectors/health      → ConnectorHealthPage (build in Prompt 8)

All other routes → ComingSoonPage component


5. GLOBAL STATE

Set up workspace context that all pages consume:
- Current workspace ID
- Current time range selection
- Optional owner filter (filter entire view to one rep)

Use React Context or whatever state management the existing app uses.
Keep it simple — no Redux unless it's already in the project.


6. VERIFY

After building:
- App loads with sidebar visible
- All navigation items render correctly
- Clicking items navigates to correct routes
- Coming Soon pages show for unbuilt routes
- Workspace selector dropdown works
- Time range selector changes state
- Sidebar collapse/expand works
- Active item highlighting works on navigation

Take a screenshot and confirm the layout matches expectations.
```

---

## PROMPT 6: Command Center Home Page (6-8 hours)

```
Pull latest from GitHub.

You're building the Command Center home page — the first thing users
see when they log in. This is NOT a passive dashboard of charts. 
It's an opinionated command center showing what needs attention.

Read the API endpoints you built:
- GET /api/workspaces/:id/pipeline/snapshot
- GET /api/workspaces/:id/findings
- GET /api/workspaces/:id/findings/summary
- GET /api/workspaces/:id/connectors/status

Install Recharts for the pipeline chart: npm install recharts


1. HEADLINE METRICS ROW

Across the top of the page, 5 metric cards:

a. Total Pipeline: "$X.XM (N deals)" with trend arrow
b. Weighted Pipeline: "$X.XM" with trend arrow
c. Coverage Ratio: "X.Xx" with trend arrow (color: green if >= 3x,
   yellow if 2-3x, red if < 2x). Show "vs $X quota" subtitle.
   If no quota configured, show "No quota set" in muted text.
d. Win Rate (90d): "XX%" with trend arrow
e. Open Findings: "N total" with severity breakdown 
   (N critical · N warning · N info), critical count in red

Each card:
- Large number as primary display
- Subtitle with context
- Trend indicator: ↑ green, ↓ red, → gray
- Clickable — clicking a metric scrolls to or filters the relevant section

Data source: pipeline/snapshot endpoint → headline_metrics


2. ANNOTATED PIPELINE CHART

Below the metrics row. This is the differentiator.

A horizontal bar chart showing pipeline by stage. Each bar represents
a stage with deal count and total amount.

Annotations (the key feature):
- Overlay finding badges on each stage bar
- Example: on the "Negotiation" bar, show a yellow badge 
  "3 deals ($4.1M) stalled 21+ days"
- Example: on the "Evaluation" bar, show an orange badge
  "Single-threaded: 2 deals"

Use the by_stage data from pipeline/snapshot. Each stage has a
findings array with category, count, amount, severity, message.

Interactions:
- Hover on a stage bar → tooltip with deal count, amount, avg days
- Click a finding badge → filter the findings feed below to that 
  category and stage
- Click a stage bar → filter findings feed to that stage

Chart library: Recharts BarChart with custom annotation overlays.
Use ReferenceLine or custom SVG elements for the finding badges.

If Recharts annotations are too complex, use a simpler approach:
render the chart, and below each bar show the finding badges as
styled HTML elements aligned to the chart bars.


3. SKILL FINDINGS FEED

Below the pipeline chart. The main content area.

A vertical feed of finding cards, sorted by severity then recency.

Each finding card shows:
- Severity indicator (red dot for critical, yellow for warning, blue for info)
- Skill icon/name (small, muted)
- Finding message (the main text)
- Entity name + link (deal name clickable → deal detail page)
- Owner name/email (who's responsible)
- Timestamp (relative: "2 hours ago", "3 days ago")
- Action buttons (right side): 
  - Snooze (dropdown: 1 day, 3 days, 1 week, 2 weeks)
  - Assign (text input for email)
  - Resolve (checkmark)
  - View Details (→ deal/account dossier page)

Filter bar above the feed:
- Skill filter: dropdown with all skill names
- Severity filter: Critical / Warning / Info (toggleable chips)
- Rep filter: dropdown with rep names
- Search: text search across finding messages

Pagination: Load 50 findings initially, "Load More" button at bottom.

Data source: findings endpoint with filters applied.


4. CONNECTOR STATUS STRIP

Below the findings feed (or as a footer bar).

Horizontal row of connector status indicators:
- Each connected source shows: icon, name, last sync time, status dot
- Green dot: synced within 24h, no errors
- Yellow dot: synced but stale (> 24h)
- Red dot: sync error

Click → navigates to /connectors/health

Data source: connectors/status endpoint.


5. RIGHT SIDEBAR: QUICK ACTIONS

Narrow right panel (or collapsible panel):
- "Run Pipeline Hygiene Now" button → calls skill execution endpoint
- "View Unlinked Calls (N)" if orphaned conversations exist
- Link to most recent full Slack briefing
- "Ask a question" text input → opens scoped analysis modal
  with pipeline scope pre-selected

The "Ask a question" input should open a modal/drawer with:
- Text input for the question
- Scope pre-set to "pipeline" (changeable)
- Submit → calls POST /analyze → displays result
- Shows suggested follow-up questions as clickable chips


6. DATA LOADING AND STATE

On page load:
- Fetch pipeline/snapshot, findings (first 50), findings/summary,
  connectors/status in parallel
- Show skeleton/loading state while fetching
- Error state if API fails (show friendly message + retry button)

On filter change:
- Re-fetch findings with new filters
- Don't re-fetch pipeline snapshot (it's filter-independent unless
  rep filter changes)

On time range change (from top bar):
- Re-fetch everything with new date range

Auto-refresh:
- Poll pipeline/snapshot every 5 minutes
- Update "last refreshed" timestamp


7. EMPTY STATES

Handle gracefully:
- No findings: "No issues found — your pipeline is looking clean! 🎯"
- No deals: "Connect your CRM to see pipeline data"
- No skills have run: "Run your first skill to generate insights"
- No connectors: "Get started by connecting HubSpot or Salesforce"


8. VERIFY

Load the Command Center for the Imubit workspace:
- Headline metrics should show real pipeline values
- Pipeline chart should show stages with finding annotations
- Findings feed should show actual findings from skill runs
- Connector status should show Salesforce as connected
- Clicking a finding should navigate to the deal detail page
- Filters should work (try filtering by severity = critical)
- Time range change should update metrics

Log any API errors or rendering issues and fix them.
```

---

## PROMPT 7: Deal + Account Detail Pages (6-8 hours)

```
Pull latest from GitHub.

You're building the drill-through detail pages for deals and accounts.
These are the pages users land on when they click a deal name or 
finding in the Command Center.

Read:
- The dossier API endpoints (GET /deals/:id/dossier, /accounts/:id/dossier)
- The scoped analysis endpoint (POST /analyze)


1. DEAL DETAIL PAGE (/command-center/deal/:dealId)

Layout: Full-width with sections stacked vertically.

a. HEADER
   - Deal name (large)
   - Amount badge: "$X.XM" (green if > median, gray otherwise)
   - Stage badge: colored by stage type (discovery=blue, negotiation=orange, etc.)
   - Owner name
   - Days in stage: "X days" (red if > 21 days, yellow if > 14)
   - Close date: formatted, with "X days away" or "X days overdue" indicator
   - CRM link button: "View in Salesforce/HubSpot" → opens source_url
   - Back button: ← Back to Command Center

b. FINDINGS PANEL (top, prominent)
   - Active findings for this deal, same card style as Command Center feed
   - Sorted by severity
   - Action buttons: Snooze, Resolve, Assign
   - If no findings: "No active issues with this deal ✓"

c. STAGE HISTORY TIMELINE
   - Visual timeline showing stage progression
   - Each node: stage name, date entered, days spent
   - Highlight current stage
   - Show regressions (backward moves) in red
   - If deal_stage_history table doesn't exist or is empty, show
     "Stage history not available" with explanation

d. CONTACTS TABLE
   - Table with columns: Name, Title, Email, Role, Engagement, Last Activity
   - Role column: buying_role badge (Champion=green, Decision Maker=blue, etc.)
   - Engagement column: colored indicator (active=green, fading=yellow, dark=red)
   - Clicking a contact → could link to CRM contact (future), for now just
     highlight their conversations below
   - Below table: Coverage summary — "X of Y contacts have been on calls"

e. CONVERSATIONS TIMELINE
   - Chronological list of conversations linked to this deal
   - Each entry: title, date, duration, participants, summary snippet
   - Link confidence indicator: solid icon for confirmed, dotted for inferred
   - "No conversations linked" empty state with explanation

f. ASK ABOUT THIS DEAL
   - Text input: "Ask about this deal..."
   - Pre-scoped to this deal (scope.type = 'deal', scope.entity_id = dealId)
   - Submit → call /analyze → display result inline below the input
   - Suggested questions as clickable chips below input:
     "What's blocking this deal?"
     "Who should we engage next?"
     "How does this compare to similar deals?"
   - After getting a response, show follow-up suggestions from the API


2. ACCOUNT DETAIL PAGE (/command-center/account/:accountId)

Layout: Similar structure to deal detail but account-focused.

a. HEADER
   - Account name (large)
   - Domain
   - Industry badge
   - Employee count + Annual revenue (if available)
   - Owner name
   - Relationship health indicator: colored badge 
     (Healthy=green, At Risk=yellow, Declining=orange, Cold=red)
   - CRM link button

b. RELATIONSHIP HEALTH CARD
   - Overall status with explanation
   - Engagement trend: "Increasing / Stable / Decreasing" with sparkline
   - Key stats: total conversations, last 30d, last 90d
   - Contact coverage: "X of Y contacts engaged (XX%)" with progress bar

c. DEALS TABLE
   - All deals for this account
   - Columns: Name, Amount, Stage, Close Date, Owner, Days in Stage, Findings
   - Findings column: severity dots (●●○ = 2 critical, 1 warning)
   - Click deal name → navigate to deal detail page
   - Sort by amount desc by default

d. CONTACTS MAP
   - Visual display of contacts grouped by seniority/role
   - Each contact card: name, title, engagement indicator
   - Highlight contacts who've been on calls vs. those who haven't
   - Could be a simple grouped list or a hierarchical view

e. CONVERSATION TIMELINE
   - All conversations for this account (across all deals)
   - Group or filter by deal if multiple deals exist
   - Each entry shows which deal it's linked to (if any)
   - Unlinked conversations shown separately with "Link to Deal" prompt

f. FINDINGS PANEL
   - All findings touching this account's deals
   - Group by deal name

g. ASK ABOUT THIS ACCOUNT
   - Same pattern as deal page but scoped to account
   - Suggested questions:
     "How is our relationship?"
     "Who have we actually talked to?"
     "What's at risk?"


3. NAVIGATION INTEGRATION

- Finding cards in Command Center → clicking deal name navigates to deal detail
- Finding cards → clicking account name navigates to account detail
- Deal detail → clicking account name navigates to account detail
- Account detail → clicking deal name navigates to deal detail
- Breadcrumb trail: Command Center > Deal Name or Command Center > Account Name


4. LOADING AND ERROR STATES

- Skeleton loading while dossier assembles (can take 2-3 seconds with narrative)
- If dossier fails, show error with retry button
- If narrative generation is slow, show the dossier immediately and 
  lazy-load the narrative (show a loading spinner in the narrative section)
- If specific sections fail, show "Unable to load [section]" inline
  while displaying the rest of the dossier


5. VERIFY

Test with Imubit data:

- Navigate to a deal with findings → verify all sections populate
- Navigate to a deal with no conversations → verify graceful empty state
- Navigate to an account → verify deals table and relationship health
- Use the "Ask" feature on a deal → verify scoped analysis works
- Click between deals and accounts → verify navigation works
- Verify back button returns to Command Center with scroll position preserved

Fix any rendering issues.
```

---

## PROMPT 8: Supporting Pages — Insights Feed, Skills, Connectors (4-6 hours)

```
Pull latest from GitHub.

You're building the three supporting pages that give depth to the
Command Center. These are simpler than the home page but essential
for daily workflow.


1. INSIGHTS FEED PAGE (/insights)

A chronological stream of ALL findings across all skills.
Think of it as an activity feed for your pipeline.

Layout:
- Filter bar at top: skill, severity, rep, category, date range
- Infinite scroll feed of finding cards
- Each card: same design as Command Center findings, but with 
  additional context (skill run timestamp, skill version)
- Group by date: "Today", "Yesterday", "This Week", "Older"
- Toggle: "Show resolved" (off by default)

New feature: Finding detail expansion
- Click a finding card → expand inline to show:
  - Full finding details
  - Link to deal/account dossier
  - Skill run context (when the skill ran, what data it processed)
  - History: previous occurrences of this finding category for the
    same entity (was this deal flagged before? when?)

Data source: GET /findings with sort=recent, paginated


2. SKILLS PAGE (/skills)

Shows all available skills, their run status, and allows manual execution.

Layout:
- Grid or list of skill cards, one per skill
- Each skill card:
  - Skill name + icon
  - Description (1 sentence)
  - Status: "Last run 2 hours ago" or "Never run" or "Running..."
  - Result summary: "Found 12 issues (3 critical)" from last run
  - "Run Now" button
  - "View History" expandable section

Skill run history:
- Click "View History" → expand to show last 10 runs
- Each run: timestamp, duration, findings count, status (success/failed)
- Click a run → show findings from that specific run

"Run Now" button:
- Triggers skill execution via POST /api/workspaces/:id/skills/:skillId/run
  (find the existing skill execution endpoint)
- Shows loading state while running
- On completion, refresh the skill card with new results

Data sources:
- GET /api/workspaces/:id/skills (skill definitions)
- GET /api/workspaces/:id/skills/:id/runs (run history)
- Or search for equivalent existing endpoints


3. CONNECTORS PAGE (/connectors)

Shows connected data sources and their health.

Layout:
- Grid of connector cards
- Each card:
  - Connector icon + name (HubSpot, Salesforce, Gong, Fireflies)
  - Status: Connected (green) / Disconnected (gray) / Error (red)
  - Last sync timestamp
  - Record counts: "2,451 deals · 8,293 contacts · 1,203 companies"
  - Sync button: "Sync Now" for connected connectors
  - Connect button: for disconnected connectors (link to setup flow)

Connector health detail (/connectors/health):
- More detailed view per connector:
  - Sync history (last 10 syncs with duration, records synced, errors)
  - Field mapping status (which CRM fields are mapped)
  - Data freshness by entity type (deals last synced X ago, contacts Y ago)
  - Error log: recent sync errors with timestamps

Data source: GET /connectors/status + existing connector management endpoints


4. VERIFY

For each page:
- Load with Imubit workspace
- Verify data populates correctly
- Verify filters work
- Verify pagination/scroll works
- Verify actions (Run Now, Sync Now) trigger correctly
- Verify loading and empty states

Fix any issues.
```

---

## POST-BUILD: Integration Checklist

After all 8 prompts are complete, verify end-to-end:

```
1. Navigation works across all pages without 404s
2. Workspace context persists across navigation
3. Time range filter affects all data-fetching pages
4. Clicking a finding → deal detail → asking a question → 
   getting answer — full flow works
5. Running a skill from Skills page → new findings appear in 
   Command Center and Insights Feed
6. Connector status reflects actual sync state
7. Pipeline chart annotations match the findings feed
8. Dossier narratives generate without errors
9. Rate limiting on /analyze works
10. No console errors, no unhandled promise rejections
```

---

## PHASE C (Future — Not for Today)

These are post-launch refinements, captured here for reference:

- Playbooks page (skill sequence configuration UI)
- Actions queue page (approve/reject recommended actions)
- Data Dictionary page
- Chart annotation click → expand → drill into deal
- Keyboard shortcuts (j/k navigate findings, r resolve, s snooze)
- Loading state polish (skeleton screens, progressive loading)
- Error boundary components
- Bulk actions on findings (multi-select + resolve/snooze/assign)
- Export findings to CSV
- Notification badges in sidebar (real-time from WebSocket, later)
