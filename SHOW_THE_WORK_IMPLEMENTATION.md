# "Show the Work" Evidence Array Implementation Plan

**Status**: Types complete (commit 22cef84), implementation in progress
**Spreadsheet Template**: `pandora_pipeline_hygiene_show_the_work (1).xlsx`

---

## Spreadsheet Formula Architecture (Reference Implementation)

### Tab 1: Summary & Methodology
**Parameter Cells** (user-configurable thresholds):
- `B51` = 30 (Stale Threshold in days)
- `B52` = 45 (Critical Stale Threshold in days)
- `B53` = 50000 (Past-Due Amount Threshold in $)
- `B54` = 90 (Activity Lookback in days)

**Data Source Status**:
- `B45` = "Connected" | "Not Connected" (Gong)
- `B46` = "Connected" | "Not Connected" (Fireflies)
- `B47` = "Connected" | "Not Connected" (HubSpot)

### Tab 2: Data (Deal Records)
**Columns**:
- A: Deal Name
- B: Owner
- C: Stage
- D: Amount ($)
- E: Created Date
- F: Close Date
- G: Last Activity Date
- H: Days Since Activity
- I: Activities (90d)
- **J: Stale Flag** (formula-driven)
- **K: Close Date Flag** (formula-driven)
- **L: Severity** (formula-driven)
- **M: Recommended Action** (formula-driven)

**Key Formulas** (all reference Tab 1 parameters):

**J2 (Stale Flag)**:
```excel
=IF(H2>='Summary & Methodology'!B51,"stale","active")
```

**L2 (Severity)**:
```excel
=IF(
  OR(H2>='Summary & Methodology'!B52, AND(K2="past_due",D2>'Summary & Methodology'!B53)),
  "critical",
  IF(OR(J2="stale",K2="past_due"),"warning","healthy")
)
```

**M2 (Recommended Action)**:
```excel
=IF(L2="critical",
  IF(H2>='Summary & Methodology'!B52,
    "URGENT: Re-engage or close-lost",
    "Update close date — past due with significant value"),
  IF(L2="warning",
    IF(J2="stale",
      "Schedule follow-up — no activity in "&H2&" days",
      "Update close date — currently past due"),
    "No action needed")
)
```

**Conditional Formatting**:
- Entire row (A2:M21) background color driven by Column L value:
  - `critical` → Red background
  - `warning` → Yellow background
  - `healthy` → Green background

**Dynamic Recalculation**:
- Change B51 from 30 to 21 → more deals flagged as "stale"
- Stale deals recalculated → severity recalculated → row colors change
- Recommended actions update based on new severity

---

## Evidence Array Structure (Matches Spreadsheet)

### 1. `evidence.parameters` → Tab 1 Parameter Cells

Maps to cells B51-B54:
```typescript
parameters: [
  {
    name: 'stale_threshold_days',
    display_name: 'Stale Threshold (days)',
    value: 30,  // B51
    description: 'Days without activity before flagged as stale',
    configurable: true
  },
  {
    name: 'critical_stale_days',
    display_name: 'Critical Stale (days)',
    value: 45,  // B52
    description: 'Days without activity before critical severity',
    configurable: true
  },
  {
    name: 'past_due_amount_threshold',
    display_name: 'Past-Due Amount Threshold',
    value: 50000,  // B53
    description: 'Deal value above which past-due is critical',
    configurable: true
  },
  {
    name: 'activity_lookback_days',
    display_name: 'Activity Lookback (days)',
    value: 90,  // B54
    description: 'Window for counting activities',
    configurable: false
  }
]
```

### 2. `evidence.data_sources` → Tab 1 Data Source Status

Maps to cells B45-B47:
```typescript
data_sources: [
  {
    source: 'gong',
    connected: true,  // B45
    last_sync: '2026-02-14T10:30:00Z',
    records_available: 1247,
    records_used: 892,
    note: null
  },
  {
    source: 'fireflies',
    connected: false,  // B46
    last_sync: null,
    records_available: 0,
    records_used: 0,
    note: 'Not connected — call data incomplete'
  },
  {
    source: 'hubspot',
    connected: true,  // B47
    last_sync: '2026-02-14T09:15:00Z',
    records_available: 532,
    records_used: 532,
    note: null
  }
]
```

### 3. `evidence.evaluated_records` → Tab 2 Data Rows

Each row in Tab 2:
```typescript
evaluated_records: [
  {
    entity_id: '123e4567-e89b-12d3-a456-426614174000',
    entity_type: 'deal',
    entity_name: 'Acme Corp',  // Column A
    owner_email: 'sarah.chen@company.com',
    owner_name: 'Sarah Chen',  // Column B
    fields: {
      stage: 'Proposal',  // Column C
      amount: 125000,  // Column D
      created_date: '2025-11-15',  // Column E
      close_date: '2026-01-31',  // Column F
      last_activity_date: '2025-12-10',  // Column G
      days_since_activity: 65,  // Column H
      activity_count_90d: 1  // Column I
    },
    flags: {
      stale_flag: 'stale',  // Column J (formula result)
      close_date_flag: 'past_due',  // Column K (formula result)
      severity: 'critical',  // Column L (formula result)
      recommended_action: 'URGENT: Re-engage or close-lost'  // Column M (formula result)
    },
    severity: 'critical'  // Drives row color
  },
  // ... more deals
]
```

### 4. `evidence.claims` → Summary Statistics

References specific entity_ids:
```typescript
claims: [
  {
    claim_id: 'stale_deals',
    claim_text: '4 deals worth $380K are stale',
    entity_type: 'deal',
    entity_ids: ['uuid1', 'uuid2', 'uuid3', 'uuid4'],
    metric_name: 'days_since_activity',
    metric_values: [41, 34, 67, 28],
    threshold_applied: '30 days',  // References parameters[0].value
    severity: 'warning'
  },
  {
    claim_id: 'critical_stale_deals',
    claim_text: '2 deals worth $245K are critically stale (45+ days)',
    entity_type: 'deal',
    entity_ids: ['uuid5', 'uuid6'],
    metric_name: 'days_since_activity',
    metric_values: [67, 52],
    threshold_applied: '45 days',  // References parameters[1].value
    severity: 'critical'
  },
  {
    claim_id: 'past_due_high_value',
    claim_text: '1 deal worth $125K is past due with significant value',
    entity_type: 'deal',
    entity_ids: ['uuid1'],
    metric_name: 'amount',
    metric_values: [125000],
    threshold_applied: '>$50,000',  // References parameters[2].value
    severity: 'critical'
  }
]
```

---

## Implementation Steps

### Step 1: Create Evidence Assembler Utility
**File**: `server/skills/evidence-assembler.ts`

```typescript
import type {
  SkillEvidence,
  EvidenceClaim,
  EvaluatedRecord,
  DataSourceContribution,
  SkillParameter
} from './types.js';

interface AssembleEvidenceInput {
  workspaceId: string;
  skillId: string;
  stepResults: Record<string, any>;
  businessContext: Record<string, any>;
}

export async function assembleEvidence(input: AssembleEvidenceInput): Promise<SkillEvidence> {
  // 1. Extract parameters from skill config + runtime overrides
  const parameters = extractParameters(input.skillId, input.stepResults);

  // 2. Query workspace connections for data_sources
  const data_sources = await getDataSources(input.workspaceId);

  // 3. Transform compute step results into evaluated_records
  const evaluated_records = buildEvaluatedRecords(input.stepResults, input.skillId);

  // 4. Extract claims from classify step + synthesis
  const claims = extractClaims(input.stepResults, parameters);

  return {
    claims,
    evaluated_records,
    data_sources,
    parameters
  };
}
```

### Step 2: Wire into Pipeline-Hygiene Skill

**Modify**: `server/skills/runtime.ts` (skill execution engine)

After Claude synthesis step completes:
```typescript
// After step 'synthesize-hygiene-report' completes
const evidence = await assembleEvidence({
  workspaceId: context.workspaceId,
  skillId: skill.id,
  stepResults: context.stepResults,
  businessContext: context.businessContext
});

// Attach to result
result.evidence = evidence;
```

**Add to Claude prompt** (pipeline-hygiene.ts line 298):
```handlebars
For each finding you mention, include the claim_id in brackets, e.g.:
"[stale_deals] 4 deals worth $380K haven't been touched in 30+ days."
"[critical_stale_deals] 2 deals worth $245K are critically stale (45+ days)."

Available claim_ids:
- stale_deals: Deals stale but not critical
- critical_stale_deals: Deals stale 45+ days or past-due >$50K
- past_due_high_value: Past-due deals above amount threshold
- closing_this_month: Deals closing in 30 days
- at_risk_close_dates: Deals with timing/readiness issues
```

### Step 3: Parameter Extraction Logic

**Pipeline-Hygiene Parameters** (maps to B51-B54):
```typescript
function extractPipelineHygieneParameters(stepResults: any): SkillParameter[] {
  const stale_threshold = stepResults.stale_deals_agg?.staleThreshold || 30;
  const critical_threshold = 45;  // Could come from workspace config
  const amount_threshold = 50000;  // Could come from workspace config
  const activity_lookback = 90;

  return [
    {
      name: 'stale_threshold_days',
      display_name: 'Stale Threshold (days)',
      value: stale_threshold,
      description: 'Days without activity before flagged as stale',
      configurable: true
    },
    {
      name: 'critical_stale_days',
      display_name: 'Critical Stale (days)',
      value: critical_threshold,
      description: 'Days without activity before critical severity',
      configurable: true
    },
    {
      name: 'past_due_amount_threshold',
      display_name: 'Past-Due Amount Threshold',
      value: amount_threshold,
      description: 'Deal value above which past-due is critical',
      configurable: true
    },
    {
      name: 'activity_lookback_days',
      display_name: 'Activity Lookback (days)',
      value: activity_lookback,
      description: 'Window for counting activities',
      configurable: false
    }
  ];
}
```

### Step 4: Evaluated Records Extraction

**From**: `stale_deals_agg.topDeals` and `closing_soon_agg.topDeals`

```typescript
function buildEvaluatedRecords(stepResults: any): EvaluatedRecord[] {
  const records: EvaluatedRecord[] = [];

  // Stale deals
  for (const deal of stepResults.stale_deals_agg?.topDeals || []) {
    records.push({
      entity_id: deal.id,
      entity_type: 'deal',
      entity_name: deal.name,
      owner_email: deal.owner_email,
      owner_name: deal.owner_name,
      fields: {
        stage: deal.stage,
        amount: deal.amount,
        created_date: deal.created_date,
        close_date: deal.close_date,
        last_activity_date: deal.last_activity_date,
        days_since_activity: deal.days_since_activity,
        activity_count_90d: deal.activity_count
      },
      flags: {
        stale_flag: deal.days_since_activity >= 30 ? 'stale' : 'active',
        close_date_flag: deal.is_past_due ? 'past_due' : 'not_past_due',
        severity: calculateSeverity(deal),
        recommended_action: getRecommendedAction(deal)
      },
      severity: calculateSeverity(deal)
    });
  }

  // Closing soon deals (similar logic)

  return records;
}

function calculateSeverity(deal: any): 'critical' | 'warning' | 'healthy' {
  if (deal.days_since_activity >= 45) return 'critical';
  if (deal.is_past_due && deal.amount > 50000) return 'critical';
  if (deal.days_since_activity >= 30 || deal.is_past_due) return 'warning';
  return 'healthy';
}
```

### Step 5: Claims Extraction

**From**: `deal_classifications` (DeepSeek output)

```typescript
function extractClaims(stepResults: any, parameters: SkillParameter[]): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  const classifications = stepResults.deal_classifications || [];

  // Group by category
  const staleDeals = classifications.filter(c => c.category === 'stale');
  const criticalStale = staleDeals.filter(d =>
    d.signals.includes('45+ days') || d.root_cause === 'high_fit_stale'
  );
  const closingSoon = classifications.filter(c => c.category === 'closing_soon');

  // Claim: Stale deals
  if (staleDeals.length > 0) {
    const totalValue = staleDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
    claims.push({
      claim_id: 'stale_deals',
      claim_text: `${staleDeals.length} deals worth $${(totalValue/1000).toFixed(0)}K are stale`,
      entity_type: 'deal',
      entity_ids: staleDeals.map(d => d.dealId),
      metric_name: 'days_since_activity',
      metric_values: staleDeals.map(d => d.days_since_activity),
      threshold_applied: `${parameters[0].value} days`,
      severity: 'warning'
    });
  }

  // Claim: Critical stale deals
  if (criticalStale.length > 0) {
    claims.push({
      claim_id: 'critical_stale_deals',
      claim_text: `${criticalStale.length} deals are critically stale (45+ days)`,
      entity_type: 'deal',
      entity_ids: criticalStale.map(d => d.dealId),
      metric_name: 'days_since_activity',
      metric_values: criticalStale.map(d => d.days_since_activity),
      threshold_applied: `${parameters[1].value} days`,
      severity: 'critical'
    });
  }

  return claims;
}
```

### Step 6: Data Sources Query

**From**: Workspace connections table

```typescript
async function getDataSources(workspaceId: string): Promise<DataSourceContribution[]> {
  const connections = await query(
    `SELECT
       connector_name,
       status,
       last_sync_at,
       sync_cursor
     FROM connections
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const sources: DataSourceContribution[] = [];

  for (const conn of connections.rows) {
    const recordsAvailable = conn.sync_cursor?.lastSyncRecords || 0;

    sources.push({
      source: conn.connector_name,
      connected: conn.status === 'healthy',
      last_sync: conn.last_sync_at?.toISOString() || null,
      records_available: recordsAvailable,
      records_used: recordsAvailable,  // Assume all used for now
      note: conn.status !== 'healthy' ? 'Not connected — data incomplete' : null
    });
  }

  return sources;
}
```

---

## Testing Plan

### Test 1: Run pipeline-hygiene with evidence
```bash
curl -X POST http://localhost:3000/api/workspaces/{WORKSPACE_ID}/skills/pipeline-hygiene/run
```

**Expected output**:
```json
{
  "runId": "...",
  "output": {
    "narrative": "[stale_deals] 4 deals worth $380K are stale...",
    "evidence": {
      "claims": [...],
      "evaluated_records": [...],
      "data_sources": [...],
      "parameters": [...]
    }
  }
}
```

### Test 2: Generate spreadsheet
Create export endpoint that:
1. Reads `evidence` from skill_run
2. Creates Tab 1 with parameters (B51-B54) and data sources (B45-B47)
3. Creates Tab 2 with evaluated_records
4. Adds formulas to Tab 2 columns J, L, M referencing Tab 1 cells
5. Applies conditional formatting based on Column L

### Test 3: Dynamic recalculation
1. Download spreadsheet
2. Change B51 from 30 to 21
3. Verify:
   - More deals in Column J show "stale"
   - Column L severity recalculates
   - Row colors change
   - Column M recommended actions update

---

## Next Skills to Wire (Priority Order)

1. ✅ **pipeline-hygiene** (this document)
2. **data-quality-audit** — field completeness + CWD claims
3. **single-thread-alert** — contact threading claims
4. **pipeline-coverage** — coverage ratio claims
5. **forecast-rollup** — forecast category claims
6. **deal-risk-review** — risk factor claims
7. **rep-scorecard** — per-rep metric claims

---

## Estimated Effort

- Step 1-2 (Evidence assembler + runtime integration): 2-3 hours
- Step 3-6 (Parameter/record/claim extraction logic): 2-3 hours
- Testing + spreadsheet export endpoint: 2-3 hours
- Remaining 6 skills: 1 hour each = 6 hours

**Total**: ~12-15 hours for complete implementation
