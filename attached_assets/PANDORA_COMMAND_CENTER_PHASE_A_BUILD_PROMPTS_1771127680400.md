# Command Center Phase A — Backend API Build Prompts

## Overview

Four prompts that build the Command Center's data layer. Run them in order.
Each prompt produces testable endpoints before moving to the next.

**Depends on:** Existing normalized entity tables, skill_runs table, cross-entity linker, workspace config loader  
**Track:** Replit (all four), with Claude Code follow-up for narrative synthesis in A3/A4

---

## Prompt A1: Findings Table + Extraction Pipeline

```
Read the existing codebase first:
1. server/skills/runtime.ts — how skills execute and store results
2. server/skills/library/ — scan 3-4 skill files to understand what 
   result_data looks like in their output
3. The skill_runs table schema — what columns exist
4. server/skills/formatters/slack-formatter.ts — how skill output gets 
   structured for Slack (the "claims" and "evidence" pattern)

BUILD THE FINDINGS TABLE:

1. Create a migration that adds the findings table:

CREATE TABLE findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  skill_run_id UUID NOT NULL REFERENCES skill_runs(id),
  skill_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT,
  message TEXT NOT NULL,
  deal_id UUID REFERENCES deals(id),
  account_id UUID REFERENCES accounts(id),
  owner_email TEXT,
  metadata JSONB DEFAULT '{}',
  found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_findings_workspace_severity 
  ON findings(workspace_id, severity, found_at DESC);
CREATE INDEX idx_findings_deal 
  ON findings(deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX idx_findings_account 
  ON findings(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX idx_findings_owner 
  ON findings(workspace_id, owner_email);
CREATE INDEX idx_findings_skill 
  ON findings(workspace_id, skill_id);
CREATE INDEX idx_findings_run 
  ON findings(skill_run_id);

2. BUILD THE EXTRACTION FUNCTION:

Create server/findings/extractor.ts:

This function takes a completed skill run's output and extracts 
structured findings from it. Different skills produce different 
output formats, so the extractor needs to handle multiple patterns.

The key insight: the Slack formatter already structures skill output 
into "claims" with severity indicators. The extractor should work at 
the same level — reading the structured output, not re-parsing 
narrative text.

interface FindingRow {
  workspace_id: string;
  skill_run_id: string;
  skill_id: string;
  severity: string;       // 'act', 'watch', 'notable', 'info'
  category: string;       // 'stale_deal', 'single_threaded', 
                          // 'data_quality', 'coverage_gap', 
                          // 'forecast_risk', 'deal_risk'
  message: string;        // Human-readable finding
  deal_id?: string;       // If finding is about a specific deal
  account_id?: string;    // If finding is about a specific account
  owner_email?: string;   // Rep who owns the entity
  metadata: Record<string, any>;  // Skill-specific context
}

function extractFindings(
  skillId: string,
  runId: string,
  workspaceId: string,
  output: any            // The skill run's result_data
): FindingRow[]

The extraction logic depends on skill output structure. Scan the 
actual skill_runs table to see what real output looks like:

SELECT skill_id, result_data 
FROM skill_runs 
WHERE status = 'completed' 
ORDER BY created_at DESC 
LIMIT 20;

Based on what you find, build extractors for each pattern. Common 
patterns to look for:

Pattern A: Skills that output a "claims" array (from the Slack formatter):
  output.claims = [{ text, severity, evidence: { deals: [...] } }]
  → Each claim becomes a finding. If claim.evidence.deals exists, 
    create one finding per deal.

Pattern B: Skills that output a "findings" or "issues" array:
  output.findings = [{ severity, message, deal_name, deal_id, ... }]
  → Direct mapping.

Pattern C: Skills that output narrative only:
  output.synthesis = "Pipeline is healthy. 3 deals are stale..."
  → Can't extract structured findings from narrative. Skip these 
    for now — they'll need prompt updates to emit structured data.
  → Log a warning: "Skill {id} has no structured findings in output"

For each skill, create a skill-specific extractor function that 
knows the output shape. Register them in a map:

const skillExtractors: Record<string, (output: any) => FindingRow[]> = {
  'pipeline-hygiene': extractPipelineHygieneFindings,
  'single-thread-alert': extractSingleThreadFindings,
  'data-quality-audit': extractDataQualityFindings,
  'forecast-rollup': extractForecastFindings,
  'pipeline-coverage': extractCoverageFindings,
  'rep-scorecard': extractRepScorecardFindings,
  // ... add more as you discover output patterns
};

If a skill doesn't have a registered extractor, fall back to the 
generic Pattern A/B extractor. If that fails, log warning and skip.

3. WIRE INTO SKILL RUNTIME:

After a skill run completes successfully, call the extractor and 
insert findings. Find the point in the skill runtime or skill 
routes where a run is marked as 'completed' and result_data is saved.

Add after that point:

try {
  const findings = extractFindings(skillId, runId, workspaceId, resultData);
  if (findings.length > 0) {
    await insertFindings(findings);
    console.log(`[Findings] Extracted ${findings.length} findings from ${skillId} run ${runId}`);
  }
} catch (err) {
  // Don't fail the skill run if finding extraction fails
  console.error(`[Findings] Extraction failed for ${skillId}:`, err);
}

The insertFindings function should batch insert:

async function insertFindings(findings: FindingRow[]): Promise<void> {
  // Before inserting, mark previous findings from the same 
  // skill+workspace as resolved (superseded by new run):
  await db.query(`
    UPDATE findings 
    SET resolved_at = now() 
    WHERE workspace_id = $1 
      AND skill_id = $2 
      AND resolved_at IS NULL
  `, [findings[0].workspace_id, findings[0].skill_id]);
  
  // Batch insert new findings
  // Use a multi-row INSERT with parameterized values
  // ...
}

This "resolve previous, insert new" pattern means the findings table 
always has the CURRENT set of active findings plus historical resolved 
ones. The Command Center queries active findings (resolved_at IS NULL) 
for the dashboard, and all findings for the timeline.

4. BACKFILL SCRIPT:

Create scripts/backfill-findings.ts:

Read all completed skill_runs, run the extractor on each, insert 
findings. This populates the findings table with historical data.

SELECT id, workspace_id, skill_id, result_data, created_at
FROM skill_runs
WHERE status = 'completed'
  AND result_data IS NOT NULL
ORDER BY created_at ASC;

For each row, call extractFindings and insert with found_at = row.created_at.
Skip runs where extraction returns 0 findings (narrative-only output).

Log: "Backfilled {N} findings from {M} skill runs"

5. VERIFY:

- Run a skill (pipeline-hygiene or single-thread-alert) 
- Check findings table — should have new rows
- Check that previous findings from the same skill are now resolved
- Run the backfill script
- Query: SELECT skill_id, severity, count(*) FROM findings 
  WHERE resolved_at IS NULL GROUP BY skill_id, severity;
  Should show a reasonable distribution.
```

---

## Prompt A2: Findings API

```
Read the findings table schema and extractor from the previous build.
Read the existing API routes pattern (how other routes handle auth, 
pagination, error responses).

BUILD THE FINDINGS API:

Create server/routes/findings.ts with these endpoints:

1. GET /api/workspaces/:workspaceId/findings

Returns paginated findings with full filter support.

Query params:
  - severity: comma-separated ('act,watch')
  - skill_id: comma-separated ('pipeline-hygiene,single-thread-alert')
  - category: comma-separated ('stale_deal,single_threaded')
  - owner_email: single email filter
  - deal_id: single deal UUID
  - account_id: single account UUID
  - status: 'active' (default) | 'resolved' | 'all'
  - from: ISO date (findings after this date)
  - to: ISO date (findings before this date)
  - sort: 'severity' | 'recency' (default: severity then recency)
  - limit: number (default 50, max 200)
  - offset: number (default 0)

Build the query dynamically based on provided filters. Use 
parameterized queries for all user input. Example:

let conditions = ['f.workspace_id = $1'];
let params = [workspaceId];
let paramIndex = 2;

if (severity) {
  const severities = severity.split(',');
  conditions.push(`f.severity = ANY($${paramIndex})`);
  params.push(severities);
  paramIndex++;
}

if (status === 'active' || !status) {
  conditions.push('f.resolved_at IS NULL');
} else if (status === 'resolved') {
  conditions.push('f.resolved_at IS NOT NULL');
}
// ... more filters

Response shape:
{
  findings: FindingRow[],
  total: number,
  filters_applied: { severity, skill_id, ... },
  pagination: { limit, offset, has_more }
}

2. GET /api/workspaces/:workspaceId/findings/summary

Returns aggregate counts for the Command Center headline metrics.

No pagination — this is a summary endpoint.

Response shape:
{
  total_active: number,
  by_severity: {
    act: number,
    watch: number,
    notable: number,
    info: number
  },
  by_skill: {
    'pipeline-hygiene': { act: N, watch: N, notable: N },
    'single-thread-alert': { act: N, watch: N, notable: N },
    // ...
  },
  by_category: {
    'stale_deal': number,
    'single_threaded': number,
    'data_quality': number,
    // ...
  },
  trend: {
    // Compare active findings count to 7 days ago
    current: number,
    previous_week: number,
    direction: 'up' | 'down' | 'stable'
  }
}

SQL for summary:
SELECT 
  severity, 
  skill_id, 
  category, 
  count(*) as count
FROM findings
WHERE workspace_id = $1 AND resolved_at IS NULL
GROUP BY GROUPING SETS (
  (severity),
  (skill_id, severity),
  (category)
);

For the trend, run a second query:
SELECT count(*) FROM findings
WHERE workspace_id = $1 
  AND found_at < (now() - interval '7 days')
  AND (resolved_at IS NULL OR resolved_at > (now() - interval '7 days'));

3. GET /api/workspaces/:workspaceId/pipeline/snapshot

Returns pipeline data annotated with findings — the core 
Command Center chart data.

Response shape:
{
  total_pipeline: number,
  total_deals: number,
  weighted_pipeline: number,
  by_stage: [
    {
      stage: 'discovery',
      stage_label: 'Discovery',
      deal_count: number,
      total_value: number,
      weighted_value: number,
      findings: {
        act: number,
        watch: number,
        notable: number,
        // Sample findings for tooltip/expansion:
        top_findings: [
          { severity, message, deal_name, deal_id }
        ]
      }
    },
    // ... per stage
  ],
  coverage: {
    ratio: number,
    quota: number,
    pipeline: number
  },
  win_rate: {
    trailing_90d: number,
    trend: 'up' | 'down' | 'stable'
  }
}

This endpoint joins deals data with active findings:

WITH stage_metrics AS (
  SELECT 
    stage_normalized as stage,
    count(*) as deal_count,
    sum(amount) as total_value,
    sum(amount * COALESCE(probability, 0.5)) as weighted_value
  FROM deals
  WHERE workspace_id = $1 
    AND is_open = true
  GROUP BY stage_normalized
),
stage_findings AS (
  SELECT 
    d.stage_normalized as stage,
    f.severity,
    count(*) as finding_count,
    json_agg(json_build_object(
      'severity', f.severity,
      'message', f.message,
      'deal_name', d.name,
      'deal_id', d.id
    ) ORDER BY 
      CASE f.severity 
        WHEN 'act' THEN 1 
        WHEN 'watch' THEN 2 
        ELSE 3 
      END
    ) FILTER (WHERE f.severity IN ('act', 'watch')) as top_findings
  FROM findings f
  JOIN deals d ON f.deal_id = d.id
  WHERE f.workspace_id = $1 
    AND f.resolved_at IS NULL
  GROUP BY d.stage_normalized, f.severity
)
SELECT 
  sm.*,
  sf.severity as finding_severity,
  sf.finding_count,
  sf.top_findings
FROM stage_metrics sm
LEFT JOIN stage_findings sf ON sm.stage = sf.stage;

For coverage and win_rate, use the existing aggregation functions 
or compute inline:

-- Coverage
SELECT 
  COALESCE(sum(d.amount), 0) as pipeline,
  COALESCE(q.target, 0) as quota
FROM deals d
LEFT JOIN quotas q ON q.workspace_id = d.workspace_id 
  AND q.period_start <= now() 
  AND q.period_end >= now()
WHERE d.workspace_id = $1 AND d.is_open = true;

-- Win rate (trailing 90 days)
SELECT 
  count(*) FILTER (WHERE stage_normalized = 'closed_won') as won,
  count(*) FILTER (WHERE stage_normalized IN ('closed_won', 'closed_lost')) as total
FROM deals
WHERE workspace_id = $1
  AND close_date >= (now() - interval '90 days')
  AND stage_normalized IN ('closed_won', 'closed_lost');

4. MOUNT THE ROUTES:

Add to server/index.ts, inside the workspace API router 
(requires workspace auth):

import findingsRouter from './routes/findings';
workspaceApiRouter.use(findingsRouter);

Make sure the route paths are relative:
  router.get('/:workspaceId/findings', ...)
  router.get('/:workspaceId/findings/summary', ...)
  router.get('/:workspaceId/pipeline/snapshot', ...)

5. VERIFY:

Run a few skills to populate findings, then test:

# Get active findings
curl /api/workspaces/{id}/findings \
  -H "Authorization: Bearer {key}"

# Filter by severity
curl /api/workspaces/{id}/findings?severity=act,watch

# Summary for dashboard
curl /api/workspaces/{id}/findings/summary

# Pipeline with annotations
curl /api/workspaces/{id}/pipeline/snapshot

Each endpoint should return data. If findings are empty, 
run the backfill script from A1 first.
```

---

## Prompt A3: Dossier Assemblers

```
Read the existing codebase first:
1. server/routes/ — find the existing deal and account query endpoints
2. The normalized tables: deals, contacts, accounts, conversations, 
   activities, deal_contacts (junction table)
3. server/analysis/ — any existing aggregation functions
4. The cross-entity linker output — how conversations link to deals/accounts

BUILD THE DOSSIER ASSEMBLERS:

These are functions (not just endpoints) that assemble a complete 
picture of a deal or account from all available data. They're used 
by: Command Center UI, Slack drill-deal handler, scoped analysis 
endpoint, and future chat interface.

1. Create server/dossiers/deal-dossier.ts:

interface DealDossier {
  deal: {
    id: string;
    name: string;
    amount: number;
    stage: string;
    stage_normalized: string;
    close_date: string | null;
    owner_email: string;
    owner_name: string;
    days_in_stage: number;
    days_open: number;
    created_at: string;
    probability: number | null;
    forecast_category: string | null;
    source: string | null;
    pipeline_name: string | null;
  };
  
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    title: string | null;
    role: string | null;        // from contact role resolution
    is_primary: boolean;
    last_activity_date: string | null;
  }>;
  
  conversations: Array<{
    id: string;
    title: string;
    date: string;
    duration_minutes: number | null;
    participants: string[];
    link_method: string;        // how it was linked to this deal
    summary: string | null;     // if available from conversation intelligence
  }>;
  
  activities: Array<{
    id: string;
    type: string;              // email, call, meeting, task
    date: string;
    subject: string | null;
    owner_email: string;
  }>;
  
  stage_history: Array<{
    stage: string;
    entered_at: string;
    exited_at: string | null;
    days_in_stage: number;
  }>;
  
  findings: Array<{
    id: string;
    severity: string;
    category: string;
    message: string;
    skill_id: string;
    found_at: string;
  }>;
  
  health_signals: {
    activity_recency: 'active' | 'cooling' | 'stale';
    threading: 'multi' | 'dual' | 'single';
    stage_velocity: 'fast' | 'normal' | 'slow';
    data_completeness: number;   // 0-100%
  };
}

async function assembleDealDossier(
  workspaceId: string, 
  dealId: string
): Promise<DealDossier>

Implementation: run parallel queries for each section.

Use Promise.all for the independent queries:

const [deal, contacts, conversations, activities, stageHistory, findings] = 
  await Promise.all([
    getDealById(workspaceId, dealId),
    getContactsForDeal(workspaceId, dealId),
    getConversationsForDeal(workspaceId, dealId),
    getActivitiesForDeal(workspaceId, dealId),
    getStageHistoryForDeal(workspaceId, dealId),
    getFindingsForDeal(workspaceId, dealId),
  ]);

Each sub-query:

-- getDealById
SELECT d.*, 
  EXTRACT(day FROM now() - d.stage_entered_at) as days_in_stage,
  EXTRACT(day FROM now() - d.created_at) as days_open
FROM deals d
WHERE d.id = $1 AND d.workspace_id = $2;

-- getContactsForDeal
SELECT c.*, dc.is_primary, dc.role,
  (SELECT max(a.activity_date) FROM activities a 
   WHERE a.contact_id = c.id) as last_activity_date
FROM contacts c
JOIN deal_contacts dc ON dc.contact_id = c.id
WHERE dc.deal_id = $1
ORDER BY dc.is_primary DESC, c.name;

-- getConversationsForDeal
SELECT cv.id, cv.title, cv.date, cv.duration_minutes, 
  cv.participants, cv.link_method, cv.summary
FROM conversations cv
WHERE cv.deal_id = $1 OR cv.account_id = (
  SELECT account_id FROM deals WHERE id = $1
)
ORDER BY cv.date DESC
LIMIT 20;

-- getActivitiesForDeal
SELECT a.id, a.type, a.activity_date as date, 
  a.subject, a.owner_email
FROM activities a
WHERE a.deal_id = $1
ORDER BY a.activity_date DESC
LIMIT 30;

-- getStageHistoryForDeal (from deal_stage_history if it exists)
SELECT stage, entered_at, exited_at,
  EXTRACT(day FROM COALESCE(exited_at, now()) - entered_at) as days_in_stage
FROM deal_stage_history
WHERE deal_id = $1
ORDER BY entered_at ASC;
-- If deal_stage_history doesn't exist, return empty array

-- getFindingsForDeal
SELECT f.id, f.severity, f.category, f.message, f.skill_id, f.found_at
FROM findings f
WHERE f.deal_id = $1 AND f.resolved_at IS NULL
ORDER BY CASE f.severity 
  WHEN 'act' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END;

After assembling, compute health_signals:

function computeHealthSignals(dossier): HealthSignals {
  // Activity recency
  const lastActivity = activities[0]?.date;
  const daysSinceActivity = lastActivity 
    ? daysBetween(new Date(lastActivity), new Date()) 
    : 999;
  const activity_recency = daysSinceActivity <= 7 ? 'active' 
    : daysSinceActivity <= 21 ? 'cooling' : 'stale';
  
  // Threading
  const contactCount = contacts.length;
  const threading = contactCount >= 3 ? 'multi' 
    : contactCount === 2 ? 'dual' : 'single';
  
  // Stage velocity (compare days_in_stage to workspace average)
  // For now, use simple thresholds:
  const stage_velocity = deal.days_in_stage <= 14 ? 'fast'
    : deal.days_in_stage <= 45 ? 'normal' : 'slow';
  
  // Data completeness
  const fields = [deal.amount, deal.close_date, deal.owner_email, 
    deal.stage, deal.source, deal.pipeline_name];
  const filled = fields.filter(f => f != null && f !== '').length;
  const data_completeness = Math.round((filled / fields.length) * 100);
  
  return { activity_recency, threading, stage_velocity, data_completeness };
}

Handle gracefully when tables don't exist or are empty:
- If deal_stage_history doesn't exist → stage_history = []
- If no conversations → conversations = []
- If no activities → activities = [], activity_recency = 'stale'
- If no contacts → contacts = [], threading = 'single'

2. Create server/dossiers/account-dossier.ts:

interface AccountDossier {
  account: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    employee_count: number | null;
    annual_revenue: number | null;
    owner_email: string | null;
  };
  
  deals: Array<{
    id: string;
    name: string;
    amount: number;
    stage: string;
    is_open: boolean;
    close_date: string | null;
    owner_email: string;
  }>;
  
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    title: string | null;
    role: string | null;
  }>;
  
  conversations: Array<{
    id: string;
    title: string;
    date: string;
    duration_minutes: number | null;
    participants: string[];
    linked_deal_name: string | null;
  }>;
  
  relationship_summary: {
    total_deals: number;
    open_deals: number;
    total_value: number;
    open_value: number;
    won_value: number;
    lost_value: number;
    first_interaction: string | null;
    last_interaction: string | null;
    total_conversations: number;
    unique_contacts: number;
  };
  
  findings: Array<{
    id: string;
    severity: string;
    category: string;
    message: string;
    deal_name: string | null;
  }>;
}

Similar parallel query pattern. The relationship_summary is computed 
from the deals array.

3. API ENDPOINTS:

Add to server/routes/dossiers.ts:

GET /api/workspaces/:workspaceId/deals/:dealId/dossier
  - Calls assembleDealDossier()
  - Returns the full DealDossier object
  - Optional query param: ?include_narrative=true
    → If true, run a lightweight Claude synthesis on the dossier
    → Cache the narrative for 1 hour (store in context_layer)
    → Token cost: ~2,000 tokens per narrative

GET /api/workspaces/:workspaceId/accounts/:accountId/dossier
  - Calls assembleAccountDossier()
  - Returns the full AccountDossier object
  - Same optional narrative param

The narrative synthesis is a FUTURE enhancement — for now, return 
the structured data only. The frontend or Slack handler can call 
Claude separately if needed. Just wire the endpoint to return 
?include_narrative=false behavior and log a TODO for the narrative.

4. WIRE THE DOSSIER INTO THE SLACK DRILL-DEAL HANDLER:

If the Slack interactivity build from earlier created a 
handleDrillDeal function, update it to use assembleDealDossier 
instead of whatever lightweight query it does now. Find that 
function and replace the data assembly with:

const dossier = await assembleDealDossier(workspaceId, dealId);

Then format the dossier for Slack blocks. Create a formatter:

function formatDossierForSlack(dossier: DealDossier): Block[] {
  const blocks = [];
  
  // Header
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: dossier.deal.name }
  });
  
  // Key metrics
  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Amount:* $${dossier.deal.amount?.toLocaleString() || 'N/A'}` },
      { type: 'mrkdwn', text: `*Stage:* ${dossier.deal.stage}` },
      { type: 'mrkdwn', text: `*Owner:* ${dossier.deal.owner_name || dossier.deal.owner_email}` },
      { type: 'mrkdwn', text: `*Days in Stage:* ${dossier.deal.days_in_stage}` },
    ]
  });
  
  // Health signals
  const signals = dossier.health_signals;
  const signalText = [
    `Activity: ${signals.activity_recency}`,
    `Threading: ${signals.threading}`,
    `Velocity: ${signals.stage_velocity}`,
    `Data: ${signals.data_completeness}%`,
  ].join(' · ');
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: signalText }]
  });
  
  // Active findings
  if (dossier.findings.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', 
        text: `*Active Findings (${dossier.findings.length})*\n` +
          dossier.findings.slice(0, 3).map(f => 
            `• ${f.severity === 'act' ? '🔴' : '🟡'} ${f.message}`
          ).join('\n')
      }
    });
  }
  
  // Contacts
  if (dossier.contacts.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn',
        text: `*Contacts (${dossier.contacts.length})*\n` +
          dossier.contacts.slice(0, 5).map(c =>
            `• ${c.name}${c.title ? ` — ${c.title}` : ''}${c.role ? ` (${c.role})` : ''}`
          ).join('\n')
      }
    });
  }
  
  // Recent activity
  if (dossier.activities.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn',
        text: `*Recent Activity*\n` +
          dossier.activities.slice(0, 5).map(a =>
            `• ${new Date(a.date).toLocaleDateString()} — ${a.type}: ${a.subject || '(no subject)'}`
          ).join('\n')
      }
    });
  }
  
  return blocks;
}

5. VERIFY:

# Deal dossier
curl /api/workspaces/{id}/deals/{dealId}/dossier \
  -H "Authorization: Bearer {key}"

# Account dossier  
curl /api/workspaces/{id}/accounts/{accountId}/dossier \
  -H "Authorization: Bearer {key}"

Both should return structured data with all sections populated 
(or empty arrays where data isn't available).
```

---

## Prompt A4: Scoped Analysis Endpoint

```
Read the existing codebase first:
1. server/dossiers/ — the deal and account dossier assemblers from A3
2. server/skills/runtime.ts — how Claude is called with tools
3. server/config/voice-prompt-block.ts — the voice configuration system
4. The LLM client (server/utils/llm-client.ts or similar)

BUILD THE SCOPED ANALYSIS ENDPOINT:

This is Pandora's "chat over data" capability. A user asks a natural 
language question scoped to a specific context (deal, account, pipeline, 
rep), and Pandora pulls relevant data, sends it to Claude with the 
question, and returns a focused answer.

Used by: Command Center chat input, Slack Level 2 thread replies, 
Slack Level 3 conversational interface, and future API consumers.

1. Create server/analysis/scoped-analysis.ts:

interface AnalysisRequest {
  workspace_id: string;
  question: string;
  scope: {
    type: 'deal' | 'account' | 'pipeline' | 'rep' | 'workspace';
    entity_id?: string;           // deal or account ID
    rep_email?: string;           // for rep-scoped questions
    date_range?: {
      from: string;
      to: string;
    };
    filters?: Record<string, any>;
    // Optional: include data from a specific skill run
    skill_run_id?: string;
    skill_run_context?: any;
  };
  format?: 'text' | 'slack';      // Output format
  max_tokens?: number;             // Default 2000
}

interface AnalysisResponse {
  answer: string;                  // Claude's narrative response
  blocks?: Block[];                // Slack blocks (if format = 'slack')
  data_consulted: {
    deals: number;
    contacts: number;
    conversations: number;
    findings: number;
    date_range: { from: string; to: string } | null;
  };
  tokens_used: number;
  latency_ms: number;
}

async function runScopedAnalysis(
  request: AnalysisRequest
): Promise<AnalysisResponse>

2. IMPLEMENTATION:

The function has three steps:

Step 1: Assemble context based on scope

async function assembleContext(request: AnalysisRequest): Promise<{
  data: any;
  data_consulted: AnalysisResponse['data_consulted'];
}> {
  switch (request.scope.type) {
    case 'deal': {
      const dossier = await assembleDealDossier(
        request.workspace_id, 
        request.scope.entity_id!
      );
      return {
        data: dossier,
        data_consulted: {
          deals: 1,
          contacts: dossier.contacts.length,
          conversations: dossier.conversations.length,
          findings: dossier.findings.length,
          date_range: null,
        },
      };
    }
    
    case 'account': {
      const dossier = await assembleAccountDossier(
        request.workspace_id,
        request.scope.entity_id!
      );
      return {
        data: dossier,
        data_consulted: {
          deals: dossier.deals.length,
          contacts: dossier.contacts.length,
          conversations: dossier.conversations.length,
          findings: dossier.findings.length,
          date_range: null,
        },
      };
    }
    
    case 'rep': {
      // Pull rep's deals, coverage, activity, findings
      const [deals, findings, activities] = await Promise.all([
        getDealsForRep(request.workspace_id, request.scope.rep_email!),
        getFindingsForOwner(request.workspace_id, request.scope.rep_email!),
        getActivitiesForRep(request.workspace_id, request.scope.rep_email!),
      ]);
      return {
        data: { rep_email: request.scope.rep_email, deals, findings, activities },
        data_consulted: {
          deals: deals.length,
          contacts: 0,
          conversations: 0,
          findings: findings.length,
          date_range: null,
        },
      };
    }
    
    case 'pipeline': {
      // Full pipeline snapshot with findings
      const snapshot = await getPipelineSnapshot(request.workspace_id);
      const findings = await getActiveFindings(request.workspace_id);
      return {
        data: { snapshot, findings },
        data_consulted: {
          deals: snapshot.total_deals,
          contacts: 0,
          conversations: 0,
          findings: findings.length,
          date_range: null,
        },
      };
    }
    
    case 'workspace': {
      // Broad context — recent findings, pipeline summary, key metrics
      const [summary, findings, snapshot] = await Promise.all([
        getFindingsSummary(request.workspace_id),
        getActiveFindings(request.workspace_id, { limit: 20 }),
        getPipelineSnapshot(request.workspace_id),
      ]);
      return {
        data: { summary, findings, snapshot },
        data_consulted: {
          deals: snapshot.total_deals,
          contacts: 0,
          conversations: 0,
          findings: findings.length,
          date_range: null,
        },
      };
    }
  }
}

Step 2: Build prompt and call Claude

async function synthesizeAnswer(
  question: string,
  context: any,
  scope: AnalysisRequest['scope'],
  workspaceId: string,
  maxTokens: number
): Promise<{ answer: string; tokens_used: number }> {
  // Get voice config for this workspace
  const voiceConfig = await configLoader.getVoiceConfig(workspaceId);
  
  const systemPrompt = `You are a senior RevOps analyst answering a specific question.

CONTEXT DATA:
${JSON.stringify(context, null, 2)}

SCOPE: ${scope.type}${scope.entity_id ? ` (ID: ${scope.entity_id})` : ''}

RULES:
- Answer the question directly. No preamble.
- Use specific numbers and deal names from the context.
- If the data doesn't contain enough information to answer, 
  say what's missing and what data would be needed.
- Keep the answer under ${maxTokens < 1500 ? '150' : '300'} words.
- Do not speculate beyond what the data shows.

${voiceConfig.promptBlock}`;

  const response = await claude.chat({
    system: systemPrompt,
    messages: [{ role: 'user', content: question }],
    max_tokens: maxTokens,
  });
  
  return {
    answer: response.text,
    tokens_used: response.usage?.total_tokens || 0,
  };
}

Step 3: If skill_run_context is provided, include it

If the request comes from a Slack thread reply (Level 2), the 
scope.skill_run_context contains the original skill output. 
Append it to the context:

if (request.scope.skill_run_context) {
  context.data.original_skill_output = request.scope.skill_run_context;
}

3. API ENDPOINT:

Add to server/routes/analysis.ts:

POST /api/workspaces/:workspaceId/analyze

Body: AnalysisRequest (minus workspace_id, which comes from URL)

Response: AnalysisResponse

Rate limit: 10 requests per minute per workspace (this hits Claude).

Add to the heavy operations rate limiter:

const analysisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.params.workspaceId,
  message: { error: 'Analysis rate limit exceeded. Try again in a minute.' },
});

router.post('/:workspaceId/analyze', analysisLimiter, async (req, res) => {
  const start = Date.now();
  const { question, scope, format, max_tokens } = req.body;
  
  if (!question || !scope?.type) {
    return res.status(400).json({ 
      error: 'question and scope.type are required' 
    });
  }
  
  try {
    const result = await runScopedAnalysis({
      workspace_id: req.params.workspaceId,
      question,
      scope,
      format: format || 'text',
      max_tokens: max_tokens || 2000,
    });
    
    result.latency_ms = Date.now() - start;
    
    // Log for token tracking
    console.log(`[Analysis] ${scope.type} question: ${result.tokens_used} tokens, ${result.latency_ms}ms`);
    
    // Track token usage against workspace budget
    // (use existing token tracking if available)
    
    res.json(result);
  } catch (err) {
    console.error('[Analysis] Error:', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

4. WIRE INTO SLACK LEVEL 2 (if built):

If the Slack threaded reply handler exists (from the Slack 
Interactivity build), update the handleQuestion function to 
use runScopedAnalysis:

async function handleQuestion(run, message, event) {
  const result = await runScopedAnalysis({
    workspace_id: run.workspace_id,
    question: message,
    scope: {
      type: 'pipeline',  // default scope for skill thread questions
      skill_run_id: run.id,
      skill_run_context: run.output?.summary,
    },
    format: 'slack',
    max_tokens: 1500,
  });
  
  await postReply(run.workspace_id, event, result.answer);
}

5. TOKEN BUDGET TRACKING:

Add the analysis token usage to the existing workspace token 
tracking (if it exists). If not, create a simple tracking table:

CREATE TABLE IF NOT EXISTS token_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source TEXT NOT NULL,        -- 'skill_run', 'analysis', 'dossier_narrative'
  model TEXT,                  -- 'claude-sonnet-4-20250514', 'deepseek', etc.
  tokens_used INTEGER NOT NULL,
  cost_cents NUMERIC(10,4),   -- estimated cost
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_token_usage_workspace_month 
  ON token_usage(workspace_id, created_at);

After each analysis call:
INSERT INTO token_usage (workspace_id, source, model, tokens_used, cost_cents)
VALUES ($1, 'analysis', 'claude-sonnet', $2, $3);

Cost estimation: ~$3 per million input tokens, ~$15 per million 
output tokens for Claude Sonnet. Rough: tokens_used * 0.001 cents.

6. VERIFY:

# Simple pipeline question
curl -X POST /api/workspaces/{id}/analyze \
  -H "Authorization: Bearer {key}" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Which deals are most at risk this week?",
    "scope": { "type": "pipeline" }
  }'

# Deal-specific question
curl -X POST /api/workspaces/{id}/analyze \
  -H "Authorization: Bearer {key}" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is the status of this deal and what should I do next?",
    "scope": { "type": "deal", "entity_id": "{dealId}" }
  }'

# Rep question
curl -X POST /api/workspaces/{id}/analyze \
  -H "Authorization: Bearer {key}" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "How is this rep tracking against quota?",
    "scope": { "type": "rep", "rep_email": "sara@example.com" }
  }'

Each should return a focused narrative answer with data_consulted 
and token usage. The answer should reference specific deals and 
numbers from the context, not generic advice.
```

---

## Build Order

```
A1 (Findings table + extraction)     → foundation, no dependencies
  ↓
A2 (Findings API)                    → depends on A1
  ↓
A3 (Dossier assemblers)              → depends on A1 (for findings in dossier)
  ↓
A4 (Scoped analysis)                 → depends on A3 (for context assembly)
```

A1 and A2 can be done in one Replit session (~4-5 hours).
A3 and A4 can be done in a second session (~6-8 hours).

After Phase A: every API endpoint the Command Center frontend 
needs is available. Phase B (frontend) can build entirely against 
these APIs.
