# Claude Code Prompt: Evidence Population + CWD Compute Functions

## Context

The previous session shipped the evidence declaration layer:
- `SkillEvidence` types in `server/skills/types.ts`
- `evidenceSchema` on all 18 skill definitions (columns + formulas)
- Agent runtime accumulation in `server/agents/runtime.ts`
- `agent_runs.skill_evidence` JSONB column via migration 020

**What's missing:** Skills declare their evidence schema but don't 
yet PRODUCE evidence at runtime. When pipeline-hygiene runs today, 
it still returns `{ narrative: "..." }` without the structured 
`evidence` object. The compute steps produce deal data, the classify 
steps tag severity — but nobody packages that into `evidence.claims`, 
`evidence.evaluated_records`, `evidence.data_sources`, and 
`evidence.parameters` on the way out.

This prompt completes the pipeline: skills produce evidence → agent 
runtime accumulates it → downstream renderers (Slack, spreadsheets, 
Command Center) consume it.

---

## Before Starting

Read these files in order:
1. `server/skills/types.ts` — the evidence types you just added
2. `server/skills/runtime.ts` — how skills execute step by step
3. `server/skills/library/pipeline-hygiene.ts` — reference skill
4. `server/agents/runtime.ts` — the evidence accumulation you just added
5. `server/agents/types.ts` — AgentRunResult with skillEvidence
6. `PANDORA_SKILL_DESIGN_GUIDE.md` — the compute→classify→synthesize pattern
7. Scan ALL files in `server/skills/library/` to understand each skill's 
   compute output shape and classify output shape
8. Check `server/connectors/` or adapter registry to understand which 
   connectors exist and how to query their sync status

---

## TASK 1: Evidence Builder Utility

Create a shared utility that skills call to assemble evidence from 
their compute/classify outputs. This avoids duplicating evidence 
assembly logic across 18 skills.

### File: `server/skills/evidence-builder.ts`

```typescript
import { 
  SkillEvidence, EvidenceClaim, EvaluatedRecord, 
  DataSourceContribution, SkillParameter 
} from './types';

export class EvidenceBuilder {
  private claims: EvidenceClaim[] = [];
  private records: EvaluatedRecord[] = [];
  private dataSources: DataSourceContribution[] = [];
  private parameters: SkillParameter[] = [];

  /**
   * Add a claim that the narrative makes.
   * Call this once per distinct finding (e.g., "stale_deals", "past_due_deals").
   */
  addClaim(claim: EvidenceClaim): this {
    this.claims.push(claim);
    return this;
  }

  /**
   * Add evaluated records — one per entity the skill examined.
   * These become rows in the "Show the Work" spreadsheet.
   * Pass the full dataset from the compute step, not just flagged items.
   */
  addRecords(records: EvaluatedRecord[]): this {
    this.records.push(...records);
    return this;
  }

  /**
   * Add a single evaluated record.
   */
  addRecord(record: EvaluatedRecord): this {
    this.records.push(record);
    return this;
  }

  /**
   * Register a data source that contributed (or didn't) to this skill run.
   * Call once per potential source — including ones that AREN'T connected.
   * The "not connected" sources are critical for trust: the user sees 
   * exactly what Pandora couldn't see.
   */
  addDataSource(source: DataSourceContribution): this {
    this.dataSources.push(source);
    return this;
  }

  /**
   * Register a parameter/threshold the skill used.
   * These become the configurable yellow cells in spreadsheet exports.
   */
  addParameter(param: SkillParameter): this {
    this.parameters.push(param);
    return this;
  }

  /**
   * Build the final evidence object.
   */
  build(): SkillEvidence {
    return {
      claims: this.claims,
      evaluated_records: this.records,
      data_sources: this.dataSources,
      parameters: this.parameters,
    };
  }
}

/**
 * Helper: Build data source contributions from workspace connector state.
 * Queries which connectors are active, when they last synced, and how 
 * many records are available.
 */
export async function buildDataSources(
  workspaceId: string,
  relevantSources: string[]  // e.g. ['hubspot', 'salesforce', 'gong', 'fireflies']
): Promise<DataSourceContribution[]> {
  // Query connector_configs or connections table for this workspace
  // For each relevantSource:
  //   - Is it connected? (status = 'active')
  //   - When did it last sync? (last_sync_at)
  //   - How many records? (query count from relevant normalized tables)
  // 
  // IMPORTANT: Include disconnected sources too, with connected: false
  // and note: "Not connected — [entity] data incomplete"
  //
  // Example output:
  // [
  //   { source: 'hubspot', connected: true, last_sync: '2026-02-14T...', 
  //     records_available: 6062, records_used: 234 },
  //   { source: 'gong', connected: true, last_sync: '2026-02-14T...', 
  //     records_available: 89, records_used: 45 },
  //   { source: 'fireflies', connected: false, last_sync: null, 
  //     records_available: 0, records_used: 0, 
  //     note: 'Not connected — call transcript data incomplete' }
  // ]
  
  // Implementation: query the database for connector status
  // This is workspace-scoped — use the same DB pool the skill runtime uses
}

/**
 * Helper: Convert a deal record from compute output into an EvaluatedRecord.
 * Maps the skill's compute step output shape to the universal evidence shape.
 */
export function dealToEvaluatedRecord(
  deal: any,  // from compute step — shape varies by skill
  fields: Record<string, string | number | boolean | null>,
  flags: Record<string, string>,
  severity: 'critical' | 'warning' | 'healthy'
): EvaluatedRecord {
  return {
    entity_id: deal.id || deal.deal_id,
    entity_type: 'deal',
    entity_name: deal.name || deal.deal_name,
    owner_email: deal.owner_email || deal.ownerEmail,
    owner_name: deal.owner_name || deal.ownerName || deal.owner,
    fields,
    flags,
    severity,
  };
}
```

---

## TASK 2: Wire Evidence into Pipeline Hygiene (Reference Implementation)

This is the template. Every other skill follows this pattern.

### What pipeline-hygiene's compute step currently returns:

Find the compute step output. It likely looks something like:
```typescript
{
  totalDeals: number,
  staleDeals: Deal[],      // deals with no activity > threshold days
  pastDueDeals: Deal[],    // deals with close_date < today
  allDeals: Deal[],        // full dataset evaluated
  metrics: {
    totalPipeline: number,
    stalePipeline: number,
    pastDuePipeline: number,
    // ...
  }
}
```

### What pipeline-hygiene's classify step currently returns:

```typescript
{
  classifications: [
    { dealName, rootCause, confidence, signals, suggestedAction }
  ]
}
```

### Where to add evidence assembly:

In the skill's execution flow, AFTER the compute and classify steps 
complete but BEFORE (or alongside) the Claude synthesis step, 
assemble the evidence:

```typescript
import { EvidenceBuilder, buildDataSources, dealToEvaluatedRecord } from '../evidence-builder';

// After compute + classify, before or alongside synthesis:

const evidenceBuilder = new EvidenceBuilder();

// 1. PARAMETERS — the thresholds this skill used
//    Read from workspace config (same values the compute step used)
const config = await loadWorkspaceConfig(workspaceId);
evidenceBuilder
  .addParameter({
    name: 'stale_threshold_days',
    display_name: 'Stale Threshold (days)',
    value: config.thresholds?.stale_deal_days ?? 30,
    description: 'Days without activity before a deal is flagged as stale',
    configurable: true,
  })
  .addParameter({
    name: 'critical_stale_days',
    display_name: 'Critical Stale Threshold (days)',
    value: config.thresholds?.critical_stale_days ?? 45,
    description: 'Days without activity before severity is critical',
    configurable: true,
  })
  .addParameter({
    name: 'amount_threshold',
    display_name: 'High-Value Deal Threshold ($)',
    value: config.thresholds?.high_value_deal_amount ?? 50000,
    description: 'Amount above which past-due deals are flagged critical',
    configurable: true,
  });

// 2. DATA SOURCES — what contributed and what didn't
const dataSources = await buildDataSources(workspaceId, [
  'hubspot', 'salesforce', 'gong', 'fireflies'
]);
for (const ds of dataSources) {
  evidenceBuilder.addDataSource(ds);
}

// 3. EVALUATED RECORDS — every deal the skill looked at
//    This comes from the compute step's allDeals (or equivalent)
const staleThreshold = config.thresholds?.stale_deal_days ?? 30;
const criticalThreshold = config.thresholds?.critical_stale_days ?? 45;
const amountThreshold = config.thresholds?.high_value_deal_amount ?? 50000;

for (const deal of computeOutput.allDeals) {
  const daysSinceActivity = deal.days_since_activity ?? deal.daysSinceActivity;
  const isPastDue = new Date(deal.close_date) < new Date();
  const isStale = daysSinceActivity >= staleThreshold;
  const isCritical = daysSinceActivity >= criticalThreshold || 
    (isPastDue && deal.amount > amountThreshold);

  evidenceBuilder.addRecord(dealToEvaluatedRecord(
    deal,
    // fields — raw data
    {
      stage: deal.stage_normalized || deal.stage,
      amount: deal.amount,
      created_date: deal.created_at || deal.created_date,
      close_date: deal.close_date,
      last_activity_date: deal.last_activity_date,
      days_since_activity: daysSinceActivity,
      activity_count: deal.activity_count ?? null,
    },
    // flags — computed
    {
      stale_flag: isStale ? 'stale' : 'active',
      close_date_flag: isPastDue ? 'past_due' : 'on_time',
      severity: isCritical ? 'critical' : isStale || isPastDue ? 'warning' : 'healthy',
      recommended_action: isCritical 
        ? (daysSinceActivity >= criticalThreshold 
            ? 'URGENT: Re-engage or close-lost' 
            : 'Update close date — past due with significant value')
        : isStale || isPastDue
          ? (isStale ? 'Schedule follow-up' : 'Update close date')
          : 'No action needed',
    },
    isCritical ? 'critical' : isStale || isPastDue ? 'warning' : 'healthy'
  ));
}

// 4. CLAIMS — each distinct finding the narrative will mention
//    Build from the compute step's aggregated metrics
const staleDeals = computeOutput.staleDeals || 
  computeOutput.allDeals.filter(d => d.days_since_activity >= staleThreshold);
const pastDueDeals = computeOutput.pastDueDeals ||
  computeOutput.allDeals.filter(d => new Date(d.close_date) < new Date());

if (staleDeals.length > 0) {
  evidenceBuilder.addClaim({
    claim_id: 'stale_deals',
    claim_text: `${staleDeals.length} deals worth $${Math.round(
      staleDeals.reduce((sum, d) => sum + (d.amount || 0), 0) / 1000
    )}K are stale (${staleThreshold}+ days, zero activity)`,
    entity_type: 'deal',
    entity_ids: staleDeals.map(d => d.id || d.deal_id),
    metric_name: 'days_since_activity',
    metric_values: staleDeals.map(d => d.days_since_activity ?? d.daysSinceActivity),
    threshold_applied: `${staleThreshold} days`,
    severity: staleDeals.some(d => d.days_since_activity >= criticalThreshold) 
      ? 'critical' : 'warning',
  });
}

if (pastDueDeals.length > 0) {
  evidenceBuilder.addClaim({
    claim_id: 'past_due_close_dates',
    claim_text: `${pastDueDeals.length} deals worth $${Math.round(
      pastDueDeals.reduce((sum, d) => sum + (d.amount || 0), 0) / 1000
    )}K have close dates in the past`,
    entity_type: 'deal',
    entity_ids: pastDueDeals.map(d => d.id || d.deal_id),
    metric_name: 'days_past_close_date',
    metric_values: pastDueDeals.map(d => {
      const diff = Date.now() - new Date(d.close_date).getTime();
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    }),
    threshold_applied: 'close_date < today',
    severity: pastDueDeals.some(d => d.amount > amountThreshold) 
      ? 'critical' : 'warning',
  });
}

// 5. Build and attach to skill output
const evidence = evidenceBuilder.build();

// The skill's return value becomes:
return {
  narrative: claudeOutput,   // unchanged — Claude still produces the narrative
  evidence,                  // NEW — structured evidence for downstream rendering
};
```

### Modify the Claude synthesis prompt (minimal change)

Add this to the end of the existing Claude prompt template for 
pipeline-hygiene:

```
For each finding you mention, include the claim_id in brackets at the 
start of the relevant paragraph, e.g.:
"[stale_deals] 4 deals worth $380K haven't been touched in 30+ days."
"[past_due_close_dates] 6 deals with close dates in the past need updating."

Available claim_ids: stale_deals, past_due_close_dates
```

This costs ~50 extra tokens. It lets the rendering layer match 
narrative paragraphs to evidence entries for inline deal lists.

---

## TASK 3: Wire Evidence into Remaining Skills

Follow the EXACT same pattern as pipeline-hygiene for each skill. 
The shape differs only in:
- Which parameters to expose
- Which fields go into evaluated_records
- Which claims to build

### Skill-by-Skill Guide

For each skill below, I describe: the compute output to read from, 
the claims to build, and the parameters to expose. The 
evaluated_records pattern is always the same: iterate over the 
compute step's full dataset, map each entity to an EvaluatedRecord 
with fields + flags + severity.

#### deal-risk-review
- **Records:** All deals evaluated for risk
- **Fields:** stage, amount, close_date, days_in_stage, probability, risk_score
- **Flags:** risk_level (high/medium/low), primary_risk_factor
- **Claims:** `high_risk_deals` (deals with high risk score), `stalled_in_stage` (deals exceeding average time in stage)
- **Parameters:** risk_score_threshold, days_in_stage_multiplier
- **Data sources:** CRM + conversations (if connected, risk scoring uses call sentiment)

#### single-thread-alert
- **Records:** All deals evaluated for threading
- **Fields:** stage, amount, contact_count, unique_roles, unique_departments, champion_identified
- **Flags:** threading_status (single_threaded/multi_threaded/no_contacts), has_champion, has_economic_buyer
- **Claims:** `single_threaded_deals` (deals with ≤1 contact), `no_champion_deals` (deals without identified champion), `high_value_single_thread` (single-threaded deals above amount threshold)
- **Parameters:** single_thread_threshold (contact count), high_value_threshold (amount)
- **Data sources:** CRM contacts + conversations (if Gong/Fireflies connected, thread count includes call participants)

#### data-quality-audit
- **Records:** All deals evaluated for field completeness
- **Fields:** stage, amount, close_date, field_fill_rate, missing_fields (comma-separated), has_contacts, has_activities
- **Flags:** completeness_grade (A/B/C/D/F), worst_gap (which field is most commonly missing)
- **Claims:** `low_fill_rate_deals` (deals below completeness threshold), `orphaned_deals` (deals with no contacts), `missing_required_fields` (deals missing stage-required fields)
- **Parameters:** completeness_threshold_pct, required_fields_by_stage (if configured)
- **Data sources:** CRM only (this skill doesn't use conversation data)
- **SPECIAL:** If CWD functions exist (Task 4), add `conversations_without_deals` claim

#### pipeline-coverage
- **Records:** One per REP (entity_type: 'rep' — use EvaluatedRecord with entity_type override)
- **Fields:** quota, pipeline_total, commit, best_case, closed_won, remaining, coverage_ratio, gap, deal_count, avg_deal_size
- **Flags:** status (on_track/at_risk/behind), coverage_health (above_target/below_target/critical)
- **Claims:** `reps_below_coverage` (reps under coverage target), `team_coverage_gap` (overall team gap)
- **Parameters:** coverage_target (e.g., 3.0x), quota_period

#### forecast-rollup
- **Records:** All open deals in forecast, one row per deal
- **Fields:** forecast_category, amount, probability, close_date, owner, stage, weighted_amount
- **Flags:** forecast_risk (on_track/at_risk/slipping), category_movement (upgraded/downgraded/stable)
- **Claims:** `landing_zone` (bear/base/bull case range), `pacing_gap` (behind/ahead of linear pace), `concentrated_commit` (if top 3 deals > 60% of commit), `stalled_commits` (commit deals with no activity)
- **Parameters:** bear_case_factor, best_case_factor, pipeline_factor, pace_comparison_period

#### weekly-recap
- **Records:** Deals that changed this week
- **Fields:** deal_name, previous_stage, current_stage, amount, movement_type, days_in_previous_stage
- **Flags:** movement_quality (healthy_advance/stalled_advance/surprise_loss etc.)
- **Claims:** `deals_advanced`, `deals_lost`, `deals_created`, `deals_won`
- **Parameters:** recap_window_days (default 7)

#### rep-scorecard
- **Records:** One per rep
- **Fields:** overall_score, attainment_pct, pipeline_coverage, activity_score, conversion_rate, avg_cycle_days, deal_count
- **Flags:** trend (improving/declining/stable), performance_tier (top/middle/bottom)
- **Claims:** `top_performers`, `needs_coaching`, `improving_reps`
- **Parameters:** All scorecard weight configs (attainment_weight, activity_weight, etc.)

#### pipeline-waterfall
- **Records:** All deals with stage movements in the period
- **Fields:** deal_name, amount, from_stage, to_stage, movement_date, days_in_from_stage
- **Flags:** movement_type (healthy_advance/premature/stalled etc.)
- **Claims:** `stage_bottleneck` (stage with highest stall rate), `premature_advances`, `surprise_losses`
- **Parameters:** analysis_window, avg_time_per_stage thresholds

#### bowtie-analysis
- **Records:** One per stage (entity_type: 'stage')
- **Fields:** stage_name, entry_count, exit_count, conversion_rate, avg_time_in_stage, total_value
- **Flags:** bottleneck (true/false), improvement_trend (improving/declining/stable)
- **Claims:** `conversion_bottleneck` (lowest conversion stage), `slowest_stage`, `leakage_point` (highest drop-off)
- **Parameters:** period_start, period_end, funnel_stages (ordered list)

### Skills with entity_type 'workspace' or 'rep'

For skills where entity_type isn't 'deal' (pipeline-coverage, 
rep-scorecard, bowtie-analysis, project-recap, strategy-insights, 
workspace-config-audit), the EvaluatedRecord.entity_type should 
match what's declared in the skill's evidenceSchema:

```typescript
// For rep-level records:
{
  entity_id: rep.email,  // use email as ID for reps
  entity_type: 'rep',    // matches evidenceSchema
  entity_name: rep.name,
  owner_email: rep.email,
  owner_name: rep.name,
  fields: { ... },
  flags: { ... },
  severity: 'warning',
}
```

### Skills that may not have data (graceful empty evidence)

Some skills may run on workspaces with limited data. If a compute 
step returns zero records, still return evidence — just with empty 
arrays:

```typescript
const evidence = new EvidenceBuilder()
  .addParameter(/* ... */)
  .addDataSource(/* ... */)
  // No addRecord() or addClaim() calls
  .build();

// Result: { claims: [], evaluated_records: [], data_sources: [...], parameters: [...] }
// This is valid. The spreadsheet will have Tab 1 with methodology 
// and "No issues found" but Tab 2 will be empty. That's correct.
```

---

## TASK 4: CWD Compute Functions

These were in the original prompt and haven't been built yet.

### 4a. Create `check-workspace-has-conversations.ts`

Location: `server/skills/tools/check-workspace-has-conversations.ts`

```typescript
interface CheckResult {
  has_conversations: boolean;
  conversation_count: number;
  sources: string[];  // e.g. ['gong'] or ['gong', 'fireflies']
}

export async function checkWorkspaceHasConversations(
  workspaceId: string
): Promise<CheckResult>
```

Implementation:
```sql
SELECT 
  COUNT(*) as count,
  ARRAY_AGG(DISTINCT source) FILTER (WHERE source IS NOT NULL) as sources
FROM conversations 
WHERE workspace_id = $1 
  AND is_internal = FALSE
```

If `conversations` table doesn't have an `is_internal` column, 
just skip that filter. If the table doesn't exist, return 
`{ has_conversations: false, conversation_count: 0, sources: [] }`.

### 4b. Create `audit-conversation-deal-coverage.ts`

Location: `server/skills/tools/audit-conversation-deal-coverage.ts`

```typescript
interface CWDStepOutput {
  has_conversation_data: boolean;
  summary: {
    total_cwd: number;
    by_rep: Record<string, number>;
    by_severity: { high: number; medium: number; low: number };
    estimated_pipeline_gap: string;
  } | null;
  top_examples: ConversationWithoutDeal[];
}

interface ConversationWithoutDeal {
  conversation_id: string;
  title: string;
  account_name: string;
  account_id: string;
  rep_name: string;
  rep_email: string;
  started_at: string;
  duration_seconds: number;
  participant_count: number;
  days_since_call: number;
  severity: 'high' | 'medium' | 'low';
  likely_cause: string;
}
```

Implementation:
- Query conversations WHERE deal_id IS NULL AND is_internal = FALSE
- Join to accounts for account_name
- Classify severity:
  - HIGH: demo/product call (title contains 'demo', 'product', 'discovery', 
    'proposal', 'pricing'), 7+ days old, account has no open deals
  - MEDIUM: recent call (<7 days) OR account has other open deals
  - LOW: short call (<10 min), or very old (>90 days)
- Infer likely cause:
  - `deal_not_created`: account has no deals at all, call was 15+ min
  - `deal_linking_gap`: account HAS deals but linker couldn't match
  - `disqualified_unlogged`: short call + no follow-up calls at same account
  - `early_stage`: call < 3 days old
- Return top 5 by severity

### 4c. Register both in tool registry

Find the tool registry file and add both new tools.

### 4d. Wire CWD into data-quality-audit evidence

If the data-quality-audit skill has CWD steps that reference these 
functions, make sure they connect. If CWD is step 2.5/3/4 in the 
skill definition, verify those steps now call the new functions.

Add a CWD evidence claim to data-quality-audit:

```typescript
if (cwdOutput.has_conversation_data && cwdOutput.summary) {
  evidenceBuilder.addClaim({
    claim_id: 'conversations_without_deals',
    claim_text: `${cwdOutput.summary.total_cwd} conversations have no linked deal`,
    entity_type: 'conversation',
    entity_ids: cwdOutput.top_examples.map(c => c.conversation_id),
    metric_name: 'days_since_call',
    metric_values: cwdOutput.top_examples.map(c => c.days_since_call),
    threshold_applied: 'deal_id IS NULL',
    severity: cwdOutput.summary.by_severity.high > 0 ? 'critical' : 'warning',
  });
}
```

---

## TASK 5: Gong/Fireflies Adapter Registration

Server logs show adapters exist but aren't registered:
```
[AdapterRegistry] Registered tasks adapter: monday
[AdapterRegistry] Registered documents adapter: google-drive
[AdapterRegistry] Registered crm adapter: salesforce
```

Gong and Fireflies connector code exists but isn't wired into the 
adapter registry. Find the registration file (likely 
`server/connectors/registry.ts` or `server/adapters/index.ts`) 
and add:

```typescript
adapterRegistry.register('conversations', 'gong', gongAdapter);
adapterRegistry.register('conversations', 'fireflies', firefliesAdapter);
```

This enables `buildDataSources()` to detect whether Gong/Fireflies 
are connected for a workspace.

---

## TASK 6: Template Seeding Fix

Server logs show:
```
[TemplateSeed] Failed to seed template {} (×5)
```

Find the template seeding code and fix whatever's causing the empty 
object failures. Likely a missing field or malformed seed data file.

---

## TASK 7: Skill Runtime — Store Evidence in skill_runs

The skill runtime writes results to the `skill_runs` table. Make 
sure the evidence object gets included in `result_data` JSONB.

Find where skill results are stored (likely in `runtime.ts` or 
wherever `skill_runs` INSERT happens). The evidence is already 
part of the return value from Task 2/3. Just verify it flows 
through to storage:

```typescript
// In the skill runtime, when logging the completed run:
await db.query(`
  UPDATE skill_runs SET 
    status = 'completed',
    result_data = $1,
    completed_at = now(),
    duration_ms = $2
  WHERE id = $3
`, [
  JSON.stringify({
    narrative: result.narrative,
    evidence: result.evidence,  // ← make sure this is included
  }),
  durationMs,
  runId,
]);
```

Add the same 5MB safety truncation the agent runtime uses:

```typescript
if (result.evidence) {
  const evidenceSize = JSON.stringify(result.evidence).length;
  if (evidenceSize > 5_000_000) {
    result.evidence.evaluated_records = 
      result.evidence.evaluated_records.slice(0, 500);
    result.evidence._truncated = true;
    console.warn(
      `[SkillRuntime] Evidence truncated for ${skillId} ` +
      `(${evidenceSize} bytes → 500 records)`
    );
  }
}
```

---

## Execution Order

1. **Read + understand** existing skill runtime, compute outputs, 
   classify outputs (~30 min)
2. **Task 1:** Evidence builder utility (~1 hr)
3. **Task 2:** Pipeline-hygiene evidence (reference impl) (~1.5 hrs)
4. **Task 7:** Verify skill runtime stores evidence (~30 min)
5. **TEST:** Run pipeline-hygiene against Frontera, verify evidence 
   in skill_runs.result_data
6. **Task 3:** Remaining skills — prioritize by which agents run most:
   - deal-risk-review (~45 min)
   - single-thread-alert (~45 min)
   - pipeline-coverage (~45 min)
   - forecast-rollup (~45 min)
   - data-quality-audit (~45 min)
   - weekly-recap (~30 min)
   - rep-scorecard (~30 min)
   - pipeline-waterfall (~30 min)
   - bowtie-analysis (~30 min)
7. **Task 4:** CWD compute functions + data-quality-audit integration (~2 hrs)
8. **Task 5:** Gong/Fireflies adapter registration (~30 min)
9. **Task 6:** Template seeding fix (~30 min)

**Total estimate: ~10-12 hours**

---

## Test Expectations

### After pipeline-hygiene (Task 2 + 7):
```
POST /api/workspaces/<frontera_id>/skills/pipeline-hygiene/run
```

Query `skill_runs` for the new run. `result_data` JSONB should contain:

```json
{
  "narrative": "...[stale_deals] 4 deals worth...",
  "evidence": {
    "claims": [
      {
        "claim_id": "stale_deals",
        "claim_text": "4 deals worth $380K are stale...",
        "entity_type": "deal",
        "entity_ids": ["uuid1", "uuid2", "uuid3", "uuid4"],
        "metric_name": "days_since_activity",
        "metric_values": [41, 34, 67, 28],
        "threshold_applied": "30 days",
        "severity": "critical"
      }
    ],
    "evaluated_records": [
      {
        "entity_id": "...",
        "entity_type": "deal",
        "entity_name": "Acme Corp",
        "owner_email": "sarah@company.com",
        "owner_name": "Sarah",
        "fields": {
          "stage": "Negotiation",
          "amount": 140000,
          "days_since_activity": 41
        },
        "flags": {
          "stale_flag": "stale",
          "severity": "critical"
        },
        "severity": "critical"
      }
    ],
    "data_sources": [
      {
        "source": "hubspot",
        "connected": true,
        "last_sync": "2026-02-14T...",
        "records_available": 6062,
        "records_used": 234
      }
    ],
    "parameters": [
      {
        "name": "stale_threshold_days",
        "display_name": "Stale Threshold (days)",
        "value": 30,
        "configurable": true
      }
    ]
  }
}
```

### After all skills (Task 3):
Run the Pipeline State agent:
```
POST /api/workspaces/<frontera_id>/agents/pipeline-state/run
```

Query `agent_runs` for the new run. `skill_evidence` JSONB should 
contain evidence from each skill that ran:

```json
{
  "hygiene": { "claims": [...], "evaluated_records": [...], ... },
  "threading": { "claims": [...], "evaluated_records": [...], ... },
  "risks": { "claims": [...], "evaluated_records": [...], ... }
}
```

### After CWD (Task 4):
Run data-quality-audit against Frontera:
```
POST /api/workspaces/<frontera_id>/skills/data-quality-audit/run
```

If Gong conversations exist:
- `evidence.claims` should include `conversations_without_deals`
- `evidence.data_sources` should show Gong as connected

If no conversations exist:
- CWD claim should be absent (graceful skip)
- `evidence.data_sources` should show conversation sources as 
  not connected

---

## TASK 8: End-to-End Verification Test

After all tasks are complete, write and run a test script that 
validates the entire evidence pipeline works. This is not optional — 
run this before considering the work done.

### File: `server/tests/evidence-e2e.test.ts`

Write a test script (can be a simple .ts file you run with tsx/ts-node, 
doesn't need a test framework) that does the following:

```typescript
/**
 * Evidence Architecture E2E Verification
 * 
 * Run with: npx tsx server/tests/evidence-e2e.test.ts
 * 
 * Requires: DATABASE_URL, ANTHROPIC_API_KEY, FIREWORKS_API_KEY in env
 * 
 * Tests against the first active workspace found in the database.
 * Does NOT modify any data — only reads + runs skills.
 */

// ============================================================
// PHASE 1: Structural Validation (no skill execution needed)
// ============================================================

// Test 1.1: Evidence types are importable and well-formed
// Import SkillEvidence, EvidenceClaim, EvaluatedRecord, 
// DataSourceContribution, SkillParameter from server/skills/types.ts
// PASS if all types import without error

// Test 1.2: EvidenceBuilder utility works
// Import EvidenceBuilder from server/skills/evidence-builder.ts
// Create a builder, add a claim, add a record, add a data source, 
// add a parameter, call .build()
// PASS if result has all 4 arrays with correct lengths

// Test 1.3: All skill definitions have evidenceSchema
// Import all skills from the registry
// For each skill:
//   - Assert skill.evidenceSchema exists
//   - Assert skill.evidenceSchema.entity_type is one of: 
//     'deal', 'rep', 'stage', 'contact', 'workspace'
//   - Assert skill.evidenceSchema.columns is array with length > 0
//   - Assert every column has key, display_name, format
//   - Log: "[PASS] {skillId}: {columnCount} columns, entity_type={entityType}"
// FAIL if any skill is missing evidenceSchema

// Test 1.4: Agent runtime has evidence accumulation
// Import agent runtime or types
// Verify AgentRunResult type includes skillEvidence field
// PASS if field exists

// Test 1.5: agent_runs table has skill_evidence column
// Run: SELECT column_name FROM information_schema.columns 
//      WHERE table_name = 'agent_runs' AND column_name = 'skill_evidence'
// PASS if row returned

// Test 1.6: CWD functions exist and are importable
// Import checkWorkspaceHasConversations from tools
// Import auditConversationDealCoverage from tools
// PASS if both import without error

// Test 1.7: buildDataSources helper exists and is callable
// Import buildDataSources from evidence-builder
// PASS if function exists

// ============================================================
// PHASE 2: Runtime Validation (requires database + workspace)
// ============================================================

// Find the first active workspace with connected sources:
// SELECT w.id, w.name FROM workspaces w 
// JOIN connector_configs cc ON cc.workspace_id = w.id 
// WHERE cc.status = 'active' 
// LIMIT 1
//
// If no workspace found, log warning and skip Phase 2.

// Test 2.1: buildDataSources returns valid structure
// Call buildDataSources(workspaceId, ['hubspot','salesforce','gong','fireflies'])
// Assert result is array
// Assert each element has: source (string), connected (boolean), 
//   last_sync (string|null), records_available (number), records_used (number)
// Log each source: "[INFO] {source}: connected={connected}, records={records_available}"
// PASS if structure is valid (doesn't matter if sources are connected or not)

// Test 2.2: CWD check-workspace-has-conversations runs
// Call checkWorkspaceHasConversations(workspaceId)
// Assert result has: has_conversations (boolean), conversation_count (number), sources (array)
// Log: "[INFO] Conversations: {conversation_count} from sources: {sources}"
// PASS if returns valid structure (even if count is 0)

// ============================================================
// PHASE 3: Skill Execution (requires LLM keys)
// ============================================================

// Test 3.1: Run pipeline-hygiene and verify evidence
// POST /api/workspaces/{workspaceId}/skills/pipeline-hygiene/run
// (or call the skill runtime directly)
//
// Capture the result. Assert ALL of the following:
//
// a) result.narrative exists and is a non-empty string
//    PASS/FAIL: "narrative exists: {boolean}, length: {length}"
//
// b) result.evidence exists and is an object
//    PASS/FAIL: "evidence object exists: {boolean}"
//
// c) result.evidence.claims is an array with length >= 0
//    For each claim, assert:
//      - claim_id is a non-empty string
//      - claim_text is a non-empty string
//      - entity_type is one of: 'deal', 'contact', 'account', 'conversation'
//      - entity_ids is an array (can be empty if no issues found)
//      - metric_name is a non-empty string
//      - severity is one of: 'critical', 'warning', 'info'
//    PASS/FAIL: "claims: {count} valid claims"
//    Log each claim: "[CLAIM] {claim_id}: {claim_text} (severity={severity}, entities={entity_ids.length})"
//
// d) result.evidence.evaluated_records is an array
//    Assert length > 0 (pipeline-hygiene should always have deals to evaluate)
//    For the first 3 records, assert:
//      - entity_id is a non-empty string
//      - entity_type === 'deal'
//      - entity_name is a non-empty string
//      - fields is an object with at least: stage, amount
//      - flags is an object with at least: stale_flag, severity
//      - severity is one of: 'critical', 'warning', 'healthy'
//    PASS/FAIL: "evaluated_records: {count} records"
//    Log: "[RECORDS] {count} deals evaluated. Severities: {critical} critical, {warning} warning, {healthy} healthy"
//
// e) result.evidence.data_sources is an array with length >= 1
//    Assert at least one source has connected === true
//    For each source, assert: source (string), connected (boolean)
//    PASS/FAIL: "data_sources: {count} sources ({connected_count} connected)"
//    Log each: "[SOURCE] {source}: connected={connected}, records={records_available}"
//
// f) result.evidence.parameters is an array with length >= 1
//    Assert at least one parameter has name 'stale_threshold_days'
//    For each parameter, assert: name (string), display_name (string), 
//      value (number|string), configurable (boolean)
//    PASS/FAIL: "parameters: {count} parameters"
//    Log each: "[PARAM] {display_name}: {value} (configurable={configurable})"
//
// g) Cross-reference: claim entity_ids should be a subset of 
//    evaluated_records entity_ids
//    Collect all entity_ids from claims (flatten)
//    Collect all entity_ids from evaluated_records
//    Assert every claim entity_id exists in evaluated_records
//    PASS/FAIL: "cross-reference: {matched}/{total} claim entities found in records"

// Test 3.2: Verify evidence persisted in skill_runs
// Query: SELECT result_data FROM skill_runs 
//        WHERE skill_id = 'pipeline-hygiene' AND workspace_id = $1
//        ORDER BY started_at DESC LIMIT 1
// Parse result_data JSONB
// Assert result_data.evidence exists
// Assert result_data.evidence.claims is array
// Assert result_data.evidence.evaluated_records is array
// PASS/FAIL: "skill_runs persistence: evidence found in DB"

// Test 3.3: Run a second skill (single-thread-alert) and verify evidence
// Same assertions as 3.1 but for single-thread-alert
// Key differences to verify:
//   - evaluated_records should have fields: contact_count, unique_roles
//   - claims should include claim_ids like: single_threaded_deals
//   - parameters should include: single_thread_threshold
// PASS/FAIL with same detail logging

// Test 3.4: Run a rep-level skill (pipeline-coverage) and verify evidence
// Same assertions as 3.1 but for pipeline-coverage  
// Key differences:
//   - evaluated_records.entity_type should be 'rep' (not 'deal')
//   - entity_id should be rep email
//   - fields should include: quota, pipeline_total, coverage_ratio
// PASS/FAIL: confirms non-deal entity types work

// ============================================================
// PHASE 4: Agent-Level Evidence (requires multiple skills to pass)
// ============================================================

// Only run Phase 4 if Phase 3 tests 3.1 and 3.3 passed.

// Test 4.1: Run the pipeline-state agent
// POST /api/workspaces/{workspaceId}/agents/pipeline-state/run
// (or call agent runtime directly)
//
// Capture the agent result. Assert:
//
// a) result.synthesized_output exists (the combined narrative)
//    PASS/FAIL: "agent narrative: {length} chars"
//
// b) result.skillEvidence exists and is an object
//    PASS/FAIL: "agent skillEvidence exists: {boolean}"
//
// c) result.skillEvidence has keys matching the agent's skill outputKeys
//    (e.g., 'hygiene', 'threading', 'risks')
//    For each key, assert the value is a valid SkillEvidence object
//    (has claims, evaluated_records, data_sources, parameters arrays)
//    PASS/FAIL: "agent evidence: {keyCount} skills with evidence"
//    Log: "[AGENT] Skill '{key}': {claims.length} claims, {evaluated_records.length} records"
//
// d) Verify agent_runs storage:
//    SELECT skill_evidence FROM agent_runs 
//    WHERE agent_id = 'pipeline-state' AND workspace_id = $1
//    ORDER BY started_at DESC LIMIT 1
//    Parse skill_evidence JSONB
//    Assert it has the same keys as result.skillEvidence
//    PASS/FAIL: "agent_runs persistence: evidence found in DB"

// ============================================================
// PHASE 5: Edge Cases
// ============================================================

// Test 5.1: Evidence builder handles empty data gracefully
// Create EvidenceBuilder, add only parameters and data sources (no claims, no records)
// Call .build()
// Assert claims = [], evaluated_records = [], but data_sources and parameters populated
// PASS/FAIL: "empty evidence: valid structure with no claims/records"

// Test 5.2: 5MB truncation safety
// Create an EvidenceBuilder
// Add 1000 fake evaluated_records (each ~1KB → ~1MB total, under limit)
// Build and check all 1000 present
// Now test the truncation logic in skill runtime:
//   Create evidence with evaluated_records that would exceed 5MB
//   Run through the truncation logic
//   Assert records truncated to 500
//   Assert _truncated flag is true
// PASS/FAIL: "truncation: records capped at 500 when over 5MB"

// ============================================================
// SUMMARY
// ============================================================

// Print a summary table:
//
// ┌──────────────────────────────────────────────────────┐
// │  Evidence Architecture E2E Results                   │
// ├──────────────────────────────────────────────────────┤
// │  Phase 1 (Structure):     X/7  passed                │
// │  Phase 2 (Data Sources):  X/2  passed                │
// │  Phase 3 (Skills):        X/4  passed                │
// │  Phase 4 (Agents):        X/1  passed                │
// │  Phase 5 (Edge Cases):    X/2  passed                │
// ├──────────────────────────────────────────────────────┤
// │  TOTAL:                   X/16 passed                │
// │  Status:                  PASS ✅ / FAIL ❌          │
// └──────────────────────────────────────────────────────┘
//
// If any Phase 3+ test fails, log the full error and the 
// skill's result object (truncated to 2000 chars) for debugging.
//
// Exit code 0 if all pass, exit code 1 if any fail.
```

### Running the test:

After completing Tasks 1-7:

```bash
npx tsx server/tests/evidence-e2e.test.ts
```

If Phase 1 fails → structural problem, types or builder broken.
If Phase 2 fails → database connectivity or missing tables.
If Phase 3 fails → evidence not being assembled in skill execution.
If Phase 4 fails → agent runtime not accumulating evidence.
If Phase 5 fails → edge case handling broken.

**Fix any failures before considering this work complete.**

---

## DO NOT

- Modify compute steps — they already produce the right data
- Modify classify steps — they already tag severity
- Send evidence to Claude or DeepSeek — too many tokens
- Create new skills
- Change database schemas for deals/contacts/accounts
- Modify agent synthesis prompts (except adding claim_id instruction)
- Exceed token budgets: warning at 8K, abort at 20K per step
- Break existing skill behavior — evidence is additive
- Hard-code workspace-specific values
