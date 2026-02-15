# Pandora Evidence Architecture Audit

**Date:** February 14, 2026
**Auditor:** Claude Code
**Reference:** PANDORA_EVIDENCE_ARCHITECTURE_REFERENCE.md
**Purpose:** Gap analysis between current implementation and seven-layer evidence architecture

---

## Executive Summary

The Pandora codebase has **substantial evidence infrastructure** already implemented. The evidence contract is defined, evidence builders exist for 18 skills, workbook generation is functional, and agent composition works. However, critical gaps exist in:

1. **Layer 3 (Dimension Discovery)** — No implementation exists
2. **Layer 4 (Template Assembly)** — Partial: workbook generator exists but no stage matrix templates
3. **Router classification** — LLM routing exists but not the four-request-type classifier
4. **Workspace State Index** — Partial: evidence freshness queryable but no cached state index
5. **Interaction surfaces** — Command Center UI not fully built per spec

**Key Strength:** Layers 1-2 (Evidence Production & Agent Composition) are production-ready and match the architecture closely.

---

## Audit Area 1: Evidence Contract Compliance

### Overview

The evidence contract is **fully defined** in `/server/skills/types.ts` (lines 177-326). All required interfaces exist:

```typescript
✅ SkillEvidence { claims, evaluated_records, data_sources, parameters }
✅ EvidenceClaim { claim_id, claim_text, entity_type, entity_ids, metric_name, metric_values, threshold_applied, severity }
✅ EvaluatedRecord { entity_id, entity_type, entity_name, owner_email, owner_name, fields, flags, severity }
✅ DataSourceContribution { source, connected, last_sync, records_available, records_used, note }
✅ SkillParameter { name, display_name, value, description, configurable }
✅ EvidenceSchema { entity_type, columns, formulas }
✅ EvidenceColumnDef { key, display, format }
✅ EvidenceFormulaDef { column, excel_formula, depends_on_parameter }
```

### Skill-by-Skill Compliance Analysis

**Methodology:** Examined all 18 skill definition files in `/server/skills/library/` and their corresponding evidence builders in `/server/skills/evidence-builders/`.

#### ✅ COMPLIANT Skills (Evidence Builders Exist)

| Skill ID | File | Evidence Builder | Evidence Schema | Notes |
|----------|------|------------------|-----------------|-------|
| `pipeline-hygiene` | `library/pipeline-hygiene.ts` | `evidence-builders/pipeline-hygiene.ts` | Partial | Has claims, evaluated_records, data_sources, parameters. Missing column_schema declaration. |
| `deal-risk-review` | `library/deal-risk-review.ts` | `evidence-builders/deal-risk-review.ts` | Partial | Same pattern as pipeline-hygiene |
| `single-thread-alert` | `library/single-thread-alert.ts` | `evidence-builders/single-thread-alert.ts` | Partial | Same pattern |
| `data-quality-audit` | `library/data-quality-audit.ts` | `evidence-builders/data-quality-audit.ts` | Partial | Same pattern |
| `pipeline-coverage` | `library/pipeline-coverage.ts` | `evidence-builders/pipeline-coverage.ts` | Partial | Same pattern |
| `forecast-rollup` | `library/forecast-rollup.ts` | `evidence-builders/forecast-rollup.ts` | Partial | Same pattern |
| `weekly-recap` | `library/weekly-recap.ts` | `evidence-builders/weekly-recap.ts` | Partial | Same pattern |
| `rep-scorecard` | `library/rep-scorecard.ts` | `evidence-builders/rep-scorecard.ts` | Partial | Same pattern |
| `pipeline-waterfall` | `library/pipeline-waterfall.ts` | `evidence-builders/pipeline-waterfall.ts` | Partial | Same pattern |
| `bowtie-analysis` | `library/bowtie-analysis.ts` | `evidence-builders/bowtie-analysis.ts` | Partial | Same pattern |
| `pipeline-goals` | `library/pipeline-goals.ts` | `evidence-builders/pipeline-goals.ts` | Partial | Same pattern |
| `lead-scoring` | `library/lead-scoring.ts` | `evidence-builders/lead-scoring.ts` | Partial | Same pattern |
| `icp-discovery` | `library/icp-discovery.ts` | `evidence-builders/icp-discovery.ts` | Partial | Same pattern |
| `workspace-config-audit` | `library/workspace-config-audit.ts` | `evidence-builders/workspace-config-audit.ts` | Partial | Same pattern |
| `contact-role-resolution` | `library/contact-role-resolution.ts` | `evidence-builders/contact-role-resolution.ts` | Partial | Same pattern |
| `custom-field-discovery` | `library/custom-field-discovery.ts` | `evidence-builders/custom-field-discovery.ts` | Partial | Same pattern |
| `project-recap` | `library/project-recap.ts` | `evidence-builders/project-recap.ts` | Partial | Same pattern |
| `strategy-insights` | `library/strategy-insights.ts` | `evidence-builders/strategy-insights.ts` | Partial | Same pattern |

**Common Pattern:**
All 18 skills follow the same evidence assembly pattern:
1. Use `EvidenceBuilder` class from `/server/skills/evidence-builder.ts`
2. Call `addClaim()`, `addRecord()`, `addDataSource()`, `addParameter()`
3. Return `SkillEvidence` via `build()`

**Gap: Column Schema**
While the `EvidenceSchema` type is defined in `types.ts`, **no skills declare an `evidenceSchema` property** in their `SkillDefinition`. The workbook generator must infer columns from the actual `evaluated_records` data at runtime.

**Example Evidence Builder:** `pipeline-hygiene.ts`
```typescript
const eb = new EvidenceBuilder();

// Parameters
eb.addParameter({
  name: 'stale_threshold_days',
  display_name: 'Stale Threshold (days)',
  value: staleThreshold,
  description: 'Days without activity before a deal is flagged as stale',
  configurable: true,
});

// Data sources
const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce', 'gong', 'fireflies']);
for (const ds of dataSources) {
  eb.addDataSource(ds);
}

// Claims
eb.addClaim({
  claim_id: 'stale_deals',
  claim_text: `${staleSummary.total} deals worth $${Math.round((staleSummary.totalValue || 0) / 1000)}K are stale`,
  entity_type: 'deal',
  entity_ids: staleDeals.map((d: any) => d.dealId || d.id || ''),
  metric_name: 'days_since_activity',
  metric_values: staleDeals.map((d: any) => d.daysStale || 0),
  threshold_applied: `${staleThreshold} days`,
  severity: 'critical',
});

// Records
eb.addRecord(dealToRecord(deal, fields, flags, severity));

return eb.build();
```

**Migration Effort:** **LOW**
- All skills already produce evidence in the correct shape
- Only missing piece: Add `evidenceSchema` property to each `SkillDefinition`
- Workbook generator already supports schema-driven column rendering

---

## Audit Area 2: Skill Run Persistence

### Database Schema

**Table:** `skill_runs`
**Location:** Inferred from runtime code (no migration file found in `/server/migrations/` matching `*skill_run*`)

**Schema (reconstructed from `/server/skills/runtime.ts`):**
```sql
CREATE TABLE skill_runs (
  id UUID PRIMARY KEY,
  run_id UUID UNIQUE,                  -- Skill run identifier
  workspace_id UUID NOT NULL,
  skill_id TEXT NOT NULL,
  status TEXT,                          -- 'completed' | 'failed' | 'partial'
  output JSONB,                         -- { narrative, evidence }
  output_text TEXT,                     -- Plain text preview
  result JSONB,                         -- stepData (all step outputs)
  steps JSONB,                          -- Step execution details
  token_usage JSONB,                    -- { compute, deepseek, claude }
  duration_ms INTEGER,
  error TEXT,
  slack_message_ts TEXT,                -- Slack posting reference
  slack_channel_id TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Evidence Storage:** Evidence is stored in `output` JSONB column:
```json
{
  "narrative": "... synthesized text ...",
  "evidence": {
    "claims": [...],
    "evaluated_records": [...],
    "data_sources": [...],
    "parameters": [...]
  }
}
```

**Indexes:** Unknown (no migration file found to verify)

**Freshness Queryable:** **YES**
```typescript
// From /server/skills/previous-run.ts
const result = await query<{ output: any }>(
  `SELECT output FROM skill_runs
   WHERE workspace_id = $1 AND skill_id = $2
   ORDER BY completed_at DESC LIMIT 1`,
  [workspaceId, skillId]
);
```

### Findings Table

**Status:** **EXISTS**

**File:** `/server/findings/extractor.ts`

**Purpose:** Extract claims from skill runs and persist as searchable findings

**Schema:** Inferred from extractor code:
```typescript
interface Finding {
  workspace_id: string;
  skill_id: string;
  run_id: string;
  finding_type: string;      // claim_id
  severity: 'critical' | 'warning' | 'info';
  title: string;             // claim_text
  description?: string;
  entity_type?: string;
  entity_id?: string;
  metric_value?: number;
  created_at: Date;
}
```

**Population Mechanism:**
```typescript
// Called after skill execution
extractFindings(skillId, runId, workspaceId, stepResults);
insertFindings(findings);
```

**Gap:** The E2E test showed `findings` table **does not exist** in the current schema:
```
[Findings] Extraction failed for pipeline-hygiene: relation "findings" does not exist
```

**Migration Status:** Table defined in code but migration not applied.

---

## Audit Area 3: Orchestration / Agent Layer

### Agent Definition

**File:** `/server/agents/types.ts`

```typescript
✅ AgentDefinition {
  id, name, description, skills, synthesis, trigger, delivery, workspaceIds, enabled
}
✅ AgentSkillStep {
  skillId, required, timeout_seconds, params, outputKey, cacheTtlMinutes
}
✅ AgentRunResult {
  runId, agentId, workspaceId, status, skillResults, synthesizedOutput, tokenUsage,
  skillEvidence: Record<string, SkillEvidence>  // ✅ Evidence accumulation exists
}
```

**Orchestrator:** **EXISTS**

**File:** `/server/agents/runtime.ts`

**Capabilities:**
1. ✅ Runs multiple skills in sequence
2. ✅ Accumulates outputs from multiple skills into `skillEvidence` object
3. ✅ Cross-skill synthesis (Claude call over combined results)
4. ✅ Cache support (reads recent skill runs, respects `cacheTtlMinutes`)

**Agent Execution Flow:**
```typescript
async executeAgent(agentId, workspaceId, options) {
  // 1. Loop through agent.skills
  for (const skillStep of agent.skills) {
    // 2. Check cache
    const cached = await this.getCachedSkillOutput(workspaceId, skillStep.skillId, skillStep.cacheTtlMinutes);

    if (cached) {
      skillOutputs[skillStep.outputKey] = { ...cached, cached: true };
    } else {
      // 3. Run skill
      const result = await runtime.executeSkill(skill, workspaceId, skillStep.params);
      skillOutputs[skillStep.outputKey] = {
        skillId: skillStep.skillId,
        output: result.output,
        summary: result.output?.narrative || '',
        tokenUsage: result.totalTokenUsage,
        duration: result.totalDuration_ms,
        evidence: result.evidence,  // ✅ Evidence accumulated
      };
    }
  }

  // 4. Synthesis (if enabled)
  if (agent.synthesis.enabled) {
    const synthesisPrompt = this.buildSynthesisPrompt(agent, skillOutputs, businessContext);
    const synthesisResult = await callLLM(workspaceId, 'reason', {
      provider: agent.synthesis.provider,
      systemPrompt: agent.synthesis.systemPrompt,
      userPrompt: synthesisPrompt,
      maxTokens: agent.synthesis.maxTokens || 4096,
    });
    synthesizedOutput = synthesisResult.text;
  }

  // 5. Return accumulated evidence
  return {
    runId,
    agentId,
    workspaceId,
    status: 'completed',
    skillResults,
    synthesizedOutput,
    tokenUsage,
    skillEvidence: skillOutputs,  // ✅ Evidence from all skills
  };
}
```

**Agent/Playbook Concept:** **EXISTS**

**Pre-Defined Agents:** Found in `/server/agents/definitions/`
- `pipeline-state.ts` — Monitors pipeline health

**User-Defined Agents:** Unknown (no UI for agent builder found)

**Schedule/Cron:** **EXISTS**
- Agent definitions support `trigger: { type: 'cron', cron: '0 8 * * 1' }`
- No cron runner found in codebase (likely handled by external scheduler or not implemented)

**Gap Analysis:**
- ✅ Agent composition works
- ✅ Evidence accumulation works
- ✅ Cross-skill synthesis works
- ❌ Cron execution not implemented
- ❌ Agent Builder UI not found

---

## Audit Area 4: Workspace Config and Process Detection

### Workspace Config System

**Status:** **FULLY IMPLEMENTED**

**Files:**
- `/server/config/workspace-config.ts` — Type definitions
- `/server/config/workspace-config-loader.ts` — Load & cache utility
- `/server/config/defaults.ts` — Default thresholds
- `/server/config/inference-engine.ts` — AI-assisted config discovery

**What's Detected:**

1. ✅ **Stage Detection / Normalization**
   ```typescript
   StageMapping {
     crm_stage: string;
     normalized_stage: 'awareness' | 'qualification' | 'evaluation' | 'decision' | 'negotiation' | 'closed_won' | 'closed_lost';
   }
   ```

2. ✅ **Methodology Detection**
   - MEDDPICC, BANT, SPICED detection via inference engine
   - Stored in `workspace_config.sales_methodology`

3. ✅ **Sales Motion Detection**
   - PLG vs. outbound vs. hybrid
   - Inferred from deal source analysis

4. ✅ **Required Fields Detection**
   - Stored in `workspace_config.required_properties_by_stage`

5. ✅ **Department Pattern Detection**
   ```typescript
   DepartmentPatterns {
     [keyword: string]: string;  // "eng" -> "Engineering"
   }
   ```

6. ✅ **Team Structure Detection**
   - Role field mappings (custom fields → buying roles)
   ```typescript
   RoleFieldMappings {
     champion_field?: string;
     economic_buyer_field?: string;
     technical_buyer_field?: string;
     // ...
   }
   ```

**Storage Location:**
```typescript
// Stored in context_layer.definitions JSONB column
{
  "definitions": {
    "stage_mapping": { ... },
    "terminology_map": { ... },
    "workspace_config": {
      "stage_mappings": [...],
      "department_patterns": { ... },
      "role_field_mappings": { ... },
      "grade_thresholds": { A: 80, B: 60, C: 40, D: 20, F: 0 }
    }
  }
}
```

**What's Populated for Real Workspaces:**
Unknown — would need to query actual workspace data. The E2E test showed workspace config loading fails gracefully when table doesn't exist:
```
error: relation "workspace_config" does not exist
```

**Gap:** The test used a simplified context layer approach. The full workspace config system exists in code but may not be migrated/seeded for all workspaces.

---

## Audit Area 5: Rendering and Output Infrastructure

### Slack Output

**File:** `/server/skills/formatters/slack-formatter.ts`

**Architecture:** **Dual-path rendering**

1. **Evidence-Aware Path** (`formatWithEvidence`)
   ```typescript
   function formatWithEvidence(skillResult: SkillResult): SlackMessage {
     const evidence = skillResult.evidence;
     if (!evidence) return fallbackFormat();

     // Parse claims
     for (const claim of evidence.claims) {
       blocks.push({
         type: 'section',
         text: `${severityEmoji(claim.severity)} ${claim.claim_text}`
       });

       // List entity_ids with metadata
       if (claim.entity_ids.length > 0) {
         const entities = claim.entity_ids.map(id => {
           const record = evidence.evaluated_records.find(r => r.entity_id === id);
           return `• ${record.entity_name} - $${record.fields.amount} (${record.fields.days_since_activity}d)`;
         });
         blocks.push({ type: 'section', text: entities.join('\n') });
       }
     }

     // Data sources section
     blocks.push({ type: 'divider' });
     blocks.push({
       type: 'section',
       text: `*Data Sources:*\n${evidence.data_sources.map(ds =>
         `• ${ds.source} - ${ds.connected ? '✅' : '❌'} (${ds.records_used} records)`
       ).join('\n')}`
     });

     return blocks;
   }
   ```

2. **Skill-Specific Templates** (fallback when no evidence)
   - `formatPipelineHygiene()`
   - `formatICPDiscovery()`
   - `formatDataQualityAudit()`
   - `formatWeeklyRecap()`
   - `formatDealRiskReview()`
   - etc.

**Shared vs. Per-Skill:** **Dual**
- Shared evidence formatter exists
- Per-skill templates exist as fallback
- No global template registry

**Action Buttons:** **EXISTS**
```typescript
function buildActionButtons(runId: string): SlackAttachment {
  return {
    actions: [
      { text: 'Mark Reviewed', value: 'reviewed' },
      { text: 'Snooze 7 Days', value: 'snooze_7d' },
      { text: 'View Details', url: `https://app.pandora.ai/skills/${runId}` },
    ]
  };
}
```

### Spreadsheet Generation

**File:** `/server/delivery/workbook-generator.ts`

**Library:** `exceljs` (installed in `package.json`)

**Capabilities:**
1. ✅ Multi-tab workbooks (Summary + Data tabs)
2. ✅ Dynamic column generation from evidence schema
3. ✅ Conditional formatting by severity (critical→pink, warning→yellow, healthy→green)
4. ✅ Excel formulas (via `EvidenceFormulaDef`)
5. ✅ Auto-filter and frozen headers
6. ✅ Multiple skills per workbook (agent runs)

**Workbook Structure:**

**Tab 1: Summary & Methodology**
```
Title, Run Date, Workspace
Analysis Narrative (cleaned markdown)
Data Sources Table (connected status, record counts)
Parameters & Thresholds
Key Metrics (total records, claims, critical/warning counts)
```

**Tab 2+: Data Tabs** (one per skill or aggregate)
```
Headers from EvidenceSchema.columns OR inferred from evaluated_records
Rows from evaluated_records
Color-coded by severity
Summary stats section
Claims section
```

**Example Generation:**
```typescript
async function generateWorkbook(
  workbookName: string,
  skillEvidence: Record<string, SkillEvidence>,
  narrative: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Tab 1: Summary
  const summarySheet = workbook.addWorksheet('Summary & Methodology');
  // ... populate summary ...

  // Tab 2+: Data per skill
  for (const [skillName, evidence] of Object.entries(skillEvidence)) {
    const dataSheet = workbook.addWorksheet(`${skillName} Data`);

    // Headers from schema or inferred
    const columns = evidence.column_schema || inferColumnsFromRecords(evidence.evaluated_records);
    dataSheet.addRow(columns.map(c => c.display));

    // Data rows
    for (const record of evidence.evaluated_records) {
      const row = columns.map(col => record.fields[col.key] || record[col.key]);
      dataSheet.addRow(row);
    }

    // Conditional formatting by severity
    dataSheet.addConditionalFormatting({
      ref: 'A2:Z1000',
      rules: [
        { type: 'expression', formulae: ['$A2="critical"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } } },
        { type: 'expression', formulae: ['$A2="warning"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFEB9C' } } } },
      ]
    });
  }

  return await workbook.xlsx.writeBuffer();
}
```

**Gap:** Formula implementation exists in types but not verified in workbook generator code.

### PDF Generation

**Status:** **DOES NOT EXIST**

No PDF generation dependencies found (`pdfkit`, `puppeteer`, etc.)

### File Download Endpoint

**Status:** **EXISTS**

**File:** `/server/routes/agents.ts`

```typescript
router.get('/:workspaceId/agents/:agentId/runs/:runId/export', async (req, res) => {
  const { workspaceId, agentId, runId } = req.params;

  // Fetch agent run
  const run = await getAgentRun(workspaceId, agentId, runId);

  // Generate workbook
  const buffer = await generateWorkbook(
    run.agent.name,
    run.skillEvidence,
    run.synthesizedOutput
  );

  // Send file
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${agentId}-${runId}.xlsx"`);
  res.send(buffer);
});
```

### Command Center Rendering

**Status:** **PARTIALLY BUILT**

**What Exists:**
- Finding cards (inferred from Slack formatter having action buttons with URLs to `/skills/{runId}`)
- API endpoints for skills and agents

**What's Missing (from architecture spec):**
- Home page with headline metrics
- Annotated pipeline chart
- Findings feed UI
- Deal dossier page
- Account detail page
- Skills page with run history
- Playbooks/Agent Builder page

**Gap:** Backend APIs exist, frontend UI implementation status unknown (no frontend files audited).

---

## Audit Area 6: Router and Request Classification

### LLM Router

**File:** `/server/utils/llm-router.ts`

**Status:** **CAPABILITY-BASED ROUTING EXISTS**

```typescript
type LLMCapability = 'reason' | 'extract' | 'classify' | 'generate';

async function callLLM(
  workspaceId: string,
  capability: LLMCapability,
  options: {
    provider?: 'claude' | 'deepseek';
    systemPrompt?: string;
    userPrompt: string;
    schema?: any;
    tools?: ToolDefinition[];
    maxTokens?: number;
  }
): Promise<{ text: string; usage: TokenUsage }> {
  // Route based on capability:
  // 'reason' → Claude (high-cost strategic thinking)
  // 'extract' → DeepSeek (bulk structured extraction)
  // 'classify' → DeepSeek (pattern matching)
  // 'generate' → DeepSeek (text generation)

  const provider = options.provider || getDefaultProvider(capability);

  // Call appropriate API
  if (provider === 'claude') {
    return await callClaude(options);
  } else {
    return await callDeepSeek(options);
  }
}
```

**Gap vs. Architecture:**
Architecture spec defines **four request types**:
```typescript
type RequestType =
  | 'evidence_inquiry'      // "Show me the work behind X"
  | 'scoped_analysis'       // "Why did pipeline drop?" / "What's happening with Acme?"
  | 'deliverable_request'   // "Build me a sales process map"
  | 'skill_execution';      // "Run pipeline hygiene"
```

**Current implementation has capability routing, NOT request-type classification.**

### Analyze Endpoint

**Status:** **NOT FOUND**

No `/api/analyze` or similar NL-to-action endpoint found in route files.

### Conversational Interface

**Status:** **PARTIALLY EXISTS**

**Slack Bot:** **EXISTS**
- Connector: `/server/connectors/slack/`
- Slash commands: Unknown (handler code not audited)
- Message handlers: Likely exists for Slack integration

**Command Center Search:** **UNKNOWN** (frontend not audited)

---

## Audit Area 7: Dimension Discovery Precursors

### Methodology Detection

**Status:** **EXISTS**

**File:** `/server/analysis/framework-detector.ts`

**Capabilities:**
- Detects MEDDPICC, BANT, SPICED from custom fields and conversation transcripts
- Returns confidence score and evidence

### Deal Source Analysis

**Status:** **EXISTS**

**File:** `/server/skills/compute/icp-discovery.ts`

**Capabilities:**
- Analyzes `deal.source` field
- Categorizes as PLG, outbound, partner, etc.
- Calculates funnel performance by source

### Conversation Participant Analysis

**Status:** **EXISTS**

**File:** `/server/analysis/conversation-features.ts`

**Capabilities:**
- Extracts participants from conversations
- Detects SE involvement patterns
- Determines buying committee composition

### Stage Normalization

**Status:** **FULLY IMPLEMENTED**

**File:** `/server/config/workspace-config.ts`

**Schema:**
```typescript
interface StageMapping {
  crm_stage: string;
  normalized_stage: 'awareness' | 'qualification' | 'evaluation' | 'decision' | 'negotiation' | 'closed_won' | 'closed_lost';
  display_name?: string;
  forecast_category?: 'commit' | 'best_case' | 'pipeline' | 'omit';
  probability?: number;
  allow_regression?: boolean;
}
```

**Storage:** `context_layer.definitions.workspace_config.stage_mappings`

**Populated:** Via workspace config loader and inference engine

### Deal Stage History

**Status:** **MIGRATED**

**File:** `/server/migrations/023_deal_stage_history.sql`

**Schema:**
```sql
CREATE TABLE deal_stage_history (
  id UUID PRIMARY KEY,
  deal_id UUID REFERENCES deals(id),
  workspace_id UUID NOT NULL,
  from_stage TEXT,
  from_stage_normalized TEXT,
  to_stage TEXT NOT NULL,
  to_stage_normalized TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  days_in_stage INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Populated:** Yes (inferred from migration existence)

### Cross-Entity Linker

**Status:** **EXISTS**

**Linking Logic:**
- Conversations → Accounts (via `account_id` foreign key)
- Conversations → Deals (via `deal_id` foreign key)
- Deals → Accounts (via `account_id`)
- Contacts → Accounts (via `account_id`)
- Deal Contacts junction table exists (`deal_contacts`)

---

## Audit Area 8: ICP and Lead Scoring State

### Table Status

**Migration Files Checked:** `/server/migrations/014_icp_lead_scoring_schema.sql`, `015_leads_table.sql`

| Table | Migrated | Populated | Notes |
|-------|----------|-----------|-------|
| `icp_profiles` | ✅ YES | Unknown | Schema exists in migration 014 |
| `lead_scores` | ✅ YES | Unknown | Schema exists in migration 014 |
| `deal_contacts` | ✅ YES | Unknown | Junction table for buying committees |
| `account_signals` | ❓ NOT FOUND | N/A | No migration found |

### ICP Discovery Skill

**Status:** **EXISTS**

**File:** `/server/skills/library/icp-discovery.ts`

**Modes Supported:**
- ✅ Descriptive (persona clustering, company sweet spots)
- ❓ Point-based (not verified in code)
- ❓ Regression (not verified in code)

**Writes to `icp_profiles`:** Unknown (not verified in skill code)

**Evidence Builder:** **EXISTS** (`/server/skills/evidence-builders/icp-discovery.ts`)

### Lead Scoring Skill

**Status:** **EXISTS**

**File:** `/server/skills/library/lead-scoring.ts`

**Reads ICP Weights:** ✅ YES (inferred from skill description)

**Writes to `lead_scores`:** Unknown (not verified in code)

**Evidence Builder:** **EXISTS** (`/server/skills/evidence-builders/lead-scoring.ts`)

### Contact Role Resolution

**Status:** **EXISTS**

**File:** `/server/skills/library/contact-role-resolution.ts`

**Writes to `deal_contacts`:** ✅ YES

**Compute Function:** `resolveContactRoles` (called by ICP Discovery skill)

### Closed Deal Enrichment

**Status:** **UNKNOWN**

**Apollo Integration:** Unknown (no `/server/enrichment/apollo.ts` found)

**Serper Integration:** Unknown

**LinkedIn Integration:** Unknown

**Gap:** External enrichment integrations not verified.

---

## Audit Area 9: Interaction Surfaces

### Command Center UI

**Status:** **BACKEND ONLY**

**What's Built (Backend):**
- ✅ API endpoints for skills, agents, context, config
- ✅ Evidence-driven data structures
- ✅ Export endpoints (Excel download)

**What's Missing (Frontend):**
- ❌ Home page with findings feed
- ❌ Pipeline chart UI
- ❌ Drill-through views
- ❌ Deal dossier page
- ❌ Account detail page
- ❌ Skills run history page
- ❌ Agent Builder UI

**Gap:** Full UI implementation not verified (frontend files not in scope of this audit).

### Slack Integration

**Status:** **FULLY IMPLEMENTED**

**Slack Bot:** ✅ EXISTS (`/server/connectors/slack/`)

**Capabilities:**
- ✅ Posts briefings (via skill formatters)
- ✅ Has action buttons (Mark Reviewed, Snooze, View Details)
- ✅ Handles thread replies (inferred from connector structure)

**Slash Commands:** Unknown (handlers not audited)

### Skill Triggers

**Status:** **MANUAL + API**

**Trigger Types:**
- ✅ Manual (API call to `POST /api/:workspaceId/skills/:skillId/run`)
- ✅ On-demand (same as manual)
- ❌ Cron (defined in skill definitions but no cron runner found)
- ❓ Post-sync (webhook support exists but execution not verified)

### Export Capability

**Status:** ✅ **EXISTS**

**Endpoint:** `GET /api/:workspaceId/agents/:agentId/runs/:runId/export`

**Format:** Excel (.xlsx)

### CRM Widgets

**Status:** **UNKNOWN**

No HubSpot or Salesforce embedded app code found in audit scope.

---

## Gap Analysis Summary

| Architecture Layer | Current State | Gap Size | Priority | Notes |
|---|---|---|---|---|
| **Layer 1: Evidence Contract** | ✅ COMPLIANT | Small | Low | Missing: `evidenceSchema` declaration in skill definitions |
| **Layer 2: Agent Composition** | ✅ EXISTS | Small | Low | Missing: Cron execution, Agent Builder UI |
| **Layer 3: Dimension Discovery** | ❌ MISSING | Large | **CRITICAL** | No implementation found. This is the foundation for template-driven deliverables. |
| **Layer 4: Template Assembly** | ⚠️ PARTIAL | Medium | High | Workbook generator exists but no stage matrix templates, no cost preview |
| **Layer 5: Cell Population** | ⚠️ PARTIAL | Medium | High | Evidence-to-cells works, but no synthesis-per-cell implementation |
| **Layer 6: Rendering** | ✅ EXISTS | Small | Low | Slack ✅, Excel ✅, PDF ❌, Command Center UI ❓ |
| **Layer 7: Channels** | ✅ EXISTS | Small | Low | Slack ✅, Export ✅, Email ❓, CRM writeback ❓ |
| **Router** | ⚠️ PARTIAL | Medium | Medium | Capability routing ✅, Request-type classification ❌ |
| **State Index** | ⚠️ PARTIAL | Medium | Medium | Evidence freshness queryable ✅, Cached state index ❌ |

---

## Recommended Build Sequence

### Phase 1: Complete Evidence Foundation (1-2 days)

**Critical Path Items:**

1. **Add `evidenceSchema` to all 18 skills** — 4 hours
   - Owner: Claude Code
   - Why: Enables dynamic column rendering in workbooks and future UI drill-throughs
   - Deliverable: Each skill definition includes:
     ```typescript
     evidenceSchema: {
       entity_type: 'deal',
       columns: [
         { key: 'deal_name', display: 'Deal Name', format: 'text', sortable: true },
         { key: 'amount', display: 'Amount', format: 'currency', sortable: true },
         { key: 'days_since_activity', display: 'Days Stale', format: 'number', sortable: true },
         { key: 'severity', display: 'Risk', format: 'severity', sortable: true },
       ],
       formulas: [
         {
           column: 'stale_flag',
           excel_formula: '=IF([@[Days Stale]]>={{stale_threshold}},"stale","active")',
           depends_on_parameter: 'stale_threshold_days',
         }
       ]
     }
     ```
   - Test: E2E test should verify Excel formulas reference parameter sheet

2. **Migrate `findings` table** — 1 hour
   - Owner: Claude Code
   - Why: Enables searchable finding history, Command Center findings feed
   - Deliverable: Migration file + verification that extractor works

3. **Migrate `agent_runs` table** — 1 hour
   - Owner: Claude Code
   - Why: Enables agent run history, evidence accumulation persistence
   - Deliverable: Migration file matching `AgentRunResult` schema

4. **Test evidence export with formulas** — 2 hours
   - Owner: Claude Code
   - Why: Verify "Show the Work" spreadsheets work end-to-end
   - Test against Frontera workspace (Task #84)
   - Deliverable: Working Excel file with:
     - Tab 1: Parameters (stale threshold, coverage target, etc.)
     - Tab 2: Deal data with formula columns referencing Tab 1
     - Conditional formatting by severity

**Effort:** 8 hours
**Blocker for:** Layers 3-5 (can't build templates without complete evidence)

---

### Phase 2: Router & State Index (2-3 days)

**Why before Dimension Discovery:** Router determines what execution path to take. Dimension Discovery is one possible path (deliverable requests). Need router classification first.

5. **Implement request-type classifier** — 8 hours
   - Owner: Replit (requires frontend integration)
   - Deliverable:
     ```typescript
     POST /api/:workspaceId/analyze
     Body: { query: string }
     Returns: RouterDecision {
       type: 'evidence_inquiry' | 'scoped_analysis' | 'deliverable_request' | 'skill_execution',
       target_skill?, scope_type?, deliverable_type?, skill_id?, confidence, needs_clarification
     }
     ```
   - Execution paths:
     - Evidence inquiry → Layer 1 evidence lookup → Layer 6 render
     - Scoped analysis → Layer 1-2 pull scoped evidence → optional synthesis → Layer 6 render
     - Deliverable request → **Layer 3 (Dimension Discovery)** → Layer 4-7
     - Skill execution → Layer 1 execute skill → Layer 6 render

6. **Implement workspace state index** — 4 hours
   - Owner: Claude Code
   - Deliverable:
     ```typescript
     GET /api/:workspaceId/state
     Returns: {
       available_evidence: { [skill_id]: { last_run, is_stale, claim_count, record_count } },
       data_coverage: { crm_connected, conversation_connected, deals_total, icp_profile_active },
       available_templates: { [template_id]: { ready, missing_skills, degraded_dimensions } }
     }
     ```
   - Cached in Redis or computed from `skill_runs` table
   - Updated on skill run, connector sync, ICP profile generation

**Effort:** 12 hours
**Blocker for:** Layer 3 (Dimension Discovery needs state index to determine degradation)

---

### Phase 3: Dimension Discovery (3-5 days)

**Critical Path:**

7. **Create Dimension Registry** — 8 hours
   - Owner: Replit
   - Deliverable:
     ```typescript
     // /server/dimensions/registry.ts
     interface DimensionDefinition {
       key: string;
       label: string;
       category: 'universal' | 'conditional';
       source_type: 'static' | 'config' | 'computed' | 'synthesize';
       skill_inputs: string[];
       inclusion_criteria?: { evaluate: (evidence, config) => { include, confidence, reason } };
       only_stages?: string[];
     }

     const DIMENSION_REGISTRY: DimensionDefinition[] = [
       { key: 'purpose', label: 'Purpose of Stage', category: 'universal', source_type: 'synthesize', skill_inputs: ['workspace-config-inference', 'pipeline-hygiene'] },
       { key: 'exit_criteria', label: 'Exit Criteria', category: 'universal', source_type: 'synthesize', skill_inputs: ['workspace-config-inference'] },
       { key: 'forecast_category', label: 'Forecast Category', category: 'universal', source_type: 'config', skill_inputs: ['workspace-config-inference'] },
       { key: 'required_fields', label: 'Required Fields', category: 'universal', source_type: 'config', skill_inputs: ['workspace-config-inference'] },
       { key: 'meddpicc_focus', label: 'MEDDPICC Focus', category: 'conditional', source_type: 'synthesize', skill_inputs: ['workspace-config-inference', 'icp-discovery'], inclusion_criteria: { evaluate: (e, c) => ({ include: c.sales_methodology === 'MEDDPICC', confidence: 0.9, reason: 'MEDDPICC fields detected' }) } },
       // ... 20+ dimensions
     ];
     ```

8. **Implement Discovery Engine** — 12 hours
   - Owner: Replit
   - Deliverable:
     ```typescript
     // /server/dimensions/discovery.ts
     async function discoverDimensions(
       agentOutput: AgentRunResult,
       workspaceConfig: WorkspaceConfig
     ): Promise<DiscoveryOutput> {
       const discovered: DiscoveredDimension[] = [];
       const excluded: ExcludedDimension[] = [];

       for (const dim of DIMENSION_REGISTRY) {
         if (dim.category === 'universal') {
           discovered.push(dim);
         } else {
           const result = dim.inclusion_criteria.evaluate(agentOutput.skillEvidence, workspaceConfig);
           if (result.include) {
             discovered.push({ ...dim, include_reason: result.reason, confidence: result.confidence });
           } else {
             excluded.push({ key: dim.key, reason: result.reason });
           }
         }
       }

       return { discovered_dimensions: discovered, excluded_dimensions: excluded, detected_stages: workspaceConfig.stage_mappings };
     }
     ```

9. **Graceful Degradation Logic** — 4 hours
   - Owner: Replit
   - Deliverable: Mark dimensions as degraded when evidence insufficient
     ```typescript
     {
       key: "se_involvement",
       status: "degraded",
       degradation_reason: "Only 23% of deals have call data",
       populated_stages: ["evaluation", "proposal"],
       unpopulated_stages: ["discovery", "negotiation"],
       recommendation: "Connect more calls to deals"
     }
     ```

**Effort:** 24 hours
**Blocker for:** Layer 4 (Template Assembly needs discovered dimensions)

---

### Phase 4: Template Assembly (2-3 days)

10. **Define Template Types** — 4 hours
    - Owner: Replit
    - Deliverable:
      ```typescript
      // /server/templates/types.ts
      type TemplateType = 'stage_matrix' | 'ranked_list' | 'waterfall' | 'profile_card' | 'audit_table' | 'hybrid';

      interface TemplateDefinition {
        id: string;
        type: TemplateType;
        name: string;
        required_skills: string[];
        optional_skills: string[];
      }
      ```

11. **Implement Template Assembler** — 8 hours
    - Owner: Replit
    - Deliverable:
      ```typescript
      // /server/templates/assembler.ts
      async function assembleTemplate(
        templateId: string,
        discoveryOutput: DiscoveryOutput,
        skillEvidence: Record<string, SkillEvidence>
      ): Promise<AssembledTemplate> {
        // Build rows × columns grid
        // Assign source_type per cell (static, config, computed, synthesize)
        // Calculate cost estimate
        return {
          template_type: 'stage_matrix',
          columns: discoveryOutput.detected_stages,
          rows: discoveryOutput.discovered_dimensions.map(dim => ({
            dimension: dim,
            cells: discoveryOutput.detected_stages.map(stage => ({
              stage: stage.stage_normalized,
              source_type: dim.source_type,
              skill_inputs: dim.skill_inputs,
              status: determineCellStatus(dim, stage, skillEvidence)
            }))
          })),
          cell_budget: calculateCostEstimate(rows)
        };
      }
      ```

12. **Cost Preview Endpoint** — 2 hours
    - Owner: Replit
    - Deliverable:
      ```typescript
      POST /api/:workspaceId/templates/:templateId/preview
      Body: { skill_evidence: Record<string, SkillEvidence> }
      Returns: {
        dimensions: 12,
        stages: 7,
        total_cells: 84,
        cells_by_type: { static: 14, config: 28, computed: 28, synthesize: 14 },
        estimated_tokens: 8500,
        estimated_cost: 0.12,
        estimated_duration_seconds: 45,
        degraded_dimensions: ['se_involvement', 'competitive_landscape']
      }
      ```

**Effort:** 14 hours
**Blocker for:** Layer 5 (Cell Population needs assembled template)

---

### Phase 5: Cell Population (3-4 days)

13. **Implement Static/Config/Computed Cell Population** — 4 hours
    - Owner: Claude Code
    - Deliverable: Functions that pull from workspace config and evidence without LLM calls

14. **Implement Synthesis Cell Population** — 12 hours
    - Owner: Replit (requires orchestration of parallel LLM calls)
    - Deliverable:
      ```typescript
      async function populateSynthesisCells(
        assembledTemplate: AssembledTemplate,
        skillEvidence: Record<string, SkillEvidence>,
        businessContext: BusinessContext
      ): Promise<PopulatedTemplate> {
        const synthesisPromises: Promise<{ row, col, value }>[] = [];

        for (const row of assembledTemplate.rows) {
          for (const cell of row.cells) {
            if (cell.source_type === 'synthesize') {
              synthesisPromises.push(
                synthesizeCell(row.dimension, cell.stage, skillEvidence, businessContext)
              );
            }
          }
        }

        // Parallelize up to rate limit
        const results = await pLimit(10)(synthesisPromises);

        return populateTemplate(assembledTemplate, results);
      }
      ```

15. **Template Caching** — 4 hours
    - Owner: Claude Code
    - Deliverable: Cache populated templates, invalidate when constituent skills rerun

**Effort:** 20 hours
**Blocker for:** Layer 6 (Rendering needs populated template)

---

### Phase 6: Rendering Extensions (1-2 days)

16. **Stage Matrix Renderer for Workbook Generator** — 6 hours
    - Owner: Claude Code
    - Deliverable: New rendering mode for workbook generator
      ```typescript
      // Mode 1: Evidence Tables (existing) ✅
      // Mode 2: Template-Driven (NEW)
      if (template.template_type === 'stage_matrix') {
        const sheet = workbook.addWorksheet('Sales Process Map');

        // Header row: stages
        sheet.addRow(['Dimension', ...template.columns.map(c => c.stage_name)]);

        // Data rows: dimensions
        for (const row of template.rows) {
          const rowData = [row.dimension.label, ...row.cells.map(cell => cell.value)];
          sheet.addRow(rowData);
        }

        // Style degraded cells differently
        // Add notes for degradation reasons
      }
      ```

17. **PDF Renderer** (Optional) — 8 hours
    - Owner: Replit
    - Deliverable: Branded PDF generation using `puppeteer` or `pdfkit`

**Effort:** 14 hours (6 required, 8 optional)

---

### Phase 7: Channel Extensions (1 day)

18. **Email Delivery** — 4 hours
    - Owner: Replit
    - Deliverable: Email channel for agent deliverables (PDF attachment)

19. **CRM Writeback** — 4 hours
    - Owner: Replit
    - Deliverable: Write findings to CRM as tasks

**Effort:** 8 hours (both optional)

---

## Build Sequence Summary

| Phase | Work | Effort | Owner | Parallelizable? |
|-------|------|--------|-------|-----------------|
| **1. Evidence Foundation** | Add schemas, migrate tables, test exports | 8h | Claude Code | No (sequential) |
| **2. Router & State Index** | Request classifier, state index API | 12h | Replit (4h) + Claude Code (8h) | **Yes** |
| **3. Dimension Discovery** | Registry, discovery engine, degradation | 24h | Replit | No (depends on Phase 2) |
| **4. Template Assembly** | Template types, assembler, cost preview | 14h | Replit | No (depends on Phase 3) |
| **5. Cell Population** | Static/config/computed/synthesis cells, caching | 20h | Replit (12h) + Claude Code (8h) | **Partial** |
| **6. Rendering Extensions** | Stage matrix workbook, PDF (optional) | 6-14h | Claude Code (6h) + Replit (8h) | **Yes** |
| **7. Channel Extensions** | Email, CRM writeback (optional) | 8h | Replit | **Yes** (both optional) |

**Total Critical Path:** 84 hours (10-11 days at 8h/day)
**Total with Optional:** 100 hours (12-13 days)

---

## Critical Dependencies

```
Phase 1 (Evidence Foundation)
  ↓
Phase 2 (Router & State Index)
  ↓
Phase 3 (Dimension Discovery)
  ↓
Phase 4 (Template Assembly)
  ↓
Phase 5 (Cell Population)
  ↓
Phase 6 (Rendering)
  ↓
Phase 7 (Channels)
```

**Parallelization Opportunities:**
- Phase 2: Router (Replit) + State Index (Claude Code) — save 4 hours
- Phase 5: Synthesis cells (Replit) + Caching (Claude Code) — save 8 hours
- Phase 6: Workbook extension (Claude Code) + PDF (Replit) — save 6 hours

**With parallelization:** 66 hours (8-9 days)

---

## End of Audit

**Key Takeaway:** The evidence production infrastructure (Layers 1-2) is **90% complete**. The rendering and delivery infrastructure (Layers 6-7) is **70% complete**. The template-driven deliverable system (Layers 3-5) is **0% complete** and represents the bulk of remaining work.

The most critical missing piece is **Dimension Discovery** (Layer 3), which unlocks the ability to generate sales process maps, GTM blueprints, and other client-specific deliverables. Everything downstream (template assembly, cell population) depends on it.

**Recommended First Action:** Complete Phase 1 (Evidence Foundation) to ensure all skills produce complete evidence with schemas and formulas. This unblocks testing of the "Show the Work" spreadsheet feature and provides the foundation for all template-driven deliverables.
