# PANDORA: Forward Deployment Architecture Audit

**Date:** 2026-03-27
**Scope:** Calibration and Context Layer Infrastructure
**Status:** READ-ONLY AUDIT (No code changes)

---

## Executive Summary

This audit documents the existing calibration and context infrastructure in Pandora to inform a redesign of the forward deployment architecture. The system currently has **partial implementations** across multiple concerns:

- ✅ **Document preferences calibration** - Fully implemented (voice, tone, structure)
- ⚠️ **Pipeline/metric calibration** - Interview-based, stored in workspace_config JSONB
- ⚠️ **Business dimensions** - Table exists, partially wired to skills
- ⚠️ **Workspace knowledge** - Auto-extraction pattern matching, not LLM-based
- ❌ **Metric calculation definitions** - NOT stored in data_dictionary (field metadata only)
- ❌ **Readiness checklist** - No unified checklist system
- ❌ **Confirmation loop** - No structured confirmation workflow
- ❌ **Skill config manifests** - Skills don't declare dependencies

---

## Step 1: Schema Audit

### 1.1 `data_dictionary` Table

**Purpose:** Workspace-scoped terminology and field definitions
**Location:** Used extensively, but CREATE TABLE statement not found in migrations 014-137
**Status:** ⚠️ **In use but migration missing** (likely created in unmigrated seed or inline)

**Inferred Schema (from queries in codebase):**

```sql
CREATE TABLE data_dictionary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Core fields
  term TEXT NOT NULL,
  definition TEXT,
  technical_definition TEXT,
  sql_definition TEXT,
  segmentable_by TEXT[],

  -- Source tracking
  source TEXT NOT NULL,           -- 'user' | 'filter' | 'system'
  source_id TEXT,
  created_by TEXT,

  -- Usage tracking
  last_referenced_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, term)
);
```

**Key Findings:**
- ✅ Stores field definitions and business terminology
- ✅ Tracks usage via `last_referenced_at`
- ❌ **Does NOT store metric calculation logic** (no numerator/denominator/unit fields)
- ❌ No confidence scoring
- ❌ No readiness gates

**Sample Use Cases:**
- Terminology consistency ("MRR" vs "Monthly Recurring Revenue")
- Custom field mappings from CRM
- Workspace-specific vocabulary

**Wiring:** Loaded in workspace-context.ts:532-560, injected into agent prompts

---

### 1.2 `workspace_knowledge` Table

**Purpose:** Auto-extracted business context from conversations
**Location:** Used extensively, but CREATE TABLE statement not found in migrations 014-137

**Inferred Schema (from queries in codebase):**

```sql
CREATE TABLE workspace_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Knowledge claim
  key TEXT NOT NULL,              -- e.g. 'our.sales_cycle', 'definition.qualified_lead'
  value TEXT NOT NULL,            -- Original text: "our sales cycle is 45 days"

  -- Source tracking
  source TEXT NOT NULL,           -- 'conversation' | 'document' | 'manual'
  confidence NUMERIC DEFAULT 0.70,

  -- Usage tracking
  used_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, key)
);
```

**Key Findings:**
- ✅ Pattern-based extraction (NO LLM calls) via regex in workspace-knowledge.ts
- ✅ Confidence scoring (incremented on repeated claims)
- ✅ Usage tracking
- ⚠️ **Freeform key-value structure** - no schema enforcement
- ❌ No structured business config fields (GTM motion, CRO goals, etc.)
- ❌ Not tied to readiness checklist

**Extraction Patterns (from workspace-knowledge.ts:24-60):**
1. "our X is Y" → `our.{field}`
2. "we define X as Y" → `definition.{field}`
3. "X because of Y" → `constraint.{field}`
4. "don't count X as Y" → `exclusion.{field}`
5. "X takes Y days" → `cycle_time.{field}`

**Wiring:** Loaded in workspace-context.ts:485-526, top 10 by confidence+usage, min 0.6 confidence

---

### 1.3 `workspace_config` (Column, not Table)

**Purpose:** Centralized workspace settings
**Location:** JSONB column on `workspaces` table
**Migration:** `207_workspace_config_column.sql` (per Explore agent, but file doesn't exist in 014-137)

**Structure (from types/workspace-config.ts):**

```typescript
interface WorkspaceConfig {
  workspace_id: string;

  // Core business config
  pipelines: PipelineConfig[];
  win_rate: WinRateConfig;
  teams: TeamConfig;
  activities: ActivityConfig;
  cadence: CadenceConfig;
  thresholds: ThresholdConfig;
  scoring: ScoringConfig;

  // Document generation
  document_profile?: WorkspaceDocumentProfile;
  voice: VoiceConfig & VoiceModifierConfig;

  // Tool filters
  tool_filters?: ToolFiltersConfig;
  named_filters?: NamedFilter[];

  // Methodology
  methodology?: {
    framework_id: string;      // e.g. 'meddic', 'spiced'
    confidence: number;
    source: string;
  };

  // Calibration state
  calibration?: {
    interview_state?: {
      current_step: InterviewStep;
      completed_steps: InterviewStep[];
      started_at: string;
      last_updated_at: string;
    };
  };

  confirmed: boolean;
  updated_at: Date;
}
```

**Key Findings:**
- ✅ Comprehensive business config structure
- ✅ Loaded via workspace-config-loader.ts with 15-minute cache
- ⚠️ **Partially populated** - many workspaces missing config fields
- ⚠️ **No validation layer** - JSONB allows any structure
- ❌ No readiness checklist tying config completeness to skill availability
- ❌ Skills don't declare which config fields they require

**Calibration Interview Steps (from calibration-interview.ts:17-26):**
1. `stage_mapping` - Map CRM stages to normalized labels
2. `active_pipeline` - Define what counts as "active"
3. `pipeline_coverage` - Expected coverage ratio
4. `win_rate` - Benchmark win rate
5. `at_risk` - At-risk deal definition
6. `commit` - Forecast commit criteria
7. `forecast_rollup` - Rollup method
8. `complete` - Interview done

**Storage:** Stored in `workspaces.workspace_config` JSONB column

---

### 1.4 `standing_hypotheses` Table

**Purpose:** GTM intelligence loop - track hypotheses and alert thresholds
**Location:** Used in deliberation-engine.ts and seed-frontera-hypotheses.sql

**Schema (inferred from seed file):**

```sql
CREATE TABLE standing_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Hypothesis definition
  hypothesis TEXT NOT NULL,
  hypothesis_text TEXT NOT NULL,
  metric TEXT NOT NULL,
  metric_key TEXT,

  -- Current state
  current_value NUMERIC,
  confidence NUMERIC,          -- 0.0 to 1.0

  -- Alert thresholds
  threshold NUMERIC,
  alert_threshold NUMERIC,
  alert_direction TEXT DEFAULT 'below',  -- 'above' | 'below'
  unit TEXT NOT NULL,          -- '$' | '%' | 'x' | 'days'

  -- Status
  status TEXT DEFAULT 'active',  -- 'active' | 'resolved' | 'invalidated'
  source TEXT NOT NULL,          -- 'user_confirmed' | 'plan_stress_test' | 'auto_generated'

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Key Findings:**
- ✅ Supports GTM intelligence loop
- ✅ Confidence scoring
- ✅ Alert thresholds with direction
- ✅ Unit tracking ($, %, x, days)
- ⚠️ **Hypothesis vs metric separation unclear** - both hypothesis and hypothesis_text fields
- ❌ No numerator/denominator fields for metric calculation
- ❌ Not wired to readiness checklist
- ❌ No automatic metric computation linkage

**Related Table:** `hypothesis_drafts` (migration 136) - review queue for auto-generated hypotheses

---

### 1.5 `confirmed_dimensions` (Virtual - actually `business_dimensions`)

**Purpose:** Workspace-specific segmentation and filtering dimensions
**Location:** Queried as `WHERE confirmed = TRUE` from `business_dimensions` table

**Schema (from data-dictionary.ts queries):**

```sql
CREATE TABLE business_dimensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Dimension definition
  dimension_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,

  -- Filter logic
  filter_definition JSONB NOT NULL,
  value_field TEXT,
  value_field_label TEXT,
  value_field_type TEXT,
  value_transform TEXT,

  -- Quota/target association
  quota_source TEXT,           -- 'workspace_quota' | 'custom_field' | 'manual' | 'none'
  quota_field TEXT,
  quota_value NUMERIC,
  quota_period TEXT DEFAULT 'quarterly',

  -- Benchmarks
  target_coverage_ratio NUMERIC,
  target_win_rate NUMERIC,
  target_avg_sales_cycle NUMERIC,
  target_avg_deal_size NUMERIC,

  -- Hierarchy
  exclusivity TEXT DEFAULT 'overlapping',  -- 'exclusive' | 'overlapping'
  exclusivity_group TEXT,
  parent_dimension TEXT,
  child_dimensions JSONB,

  -- Confirmation state
  confirmed BOOLEAN DEFAULT FALSE,
  confirmed_at TIMESTAMPTZ,
  confirmed_value NUMERIC,
  confirmed_deal_count INTEGER,

  -- Source tracking
  calibration_source TEXT,
  calibration_notes TEXT,
  display_order INTEGER DEFAULT 0,
  is_default BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, dimension_key)
);
```

**Key Findings:**
- ✅ Rich dimension schema with quota/target linkage
- ✅ Confirmation workflow (confirmed + confirmed_at)
- ✅ Hierarchical dimensions (parent/child)
- ✅ Benchmark targets per dimension
- ⚠️ **"Confirmed dimensions" is a query pattern, not a separate table**
- ⚠️ Partially wired to skills via skill-dimension-resolver.ts
- ❌ No readiness checklist integration
- ❌ Skills don't declare dimension dependencies

**Wiring:** Loaded in workspace-context.ts:454-479, filtered by `confirmed = TRUE`

---

### 1.6 `targets` Table

**Purpose:** Company-level revenue targets for gap analysis
**Location:** Migration 064_targets.sql

**Schema:**

```sql
CREATE TABLE targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Metric definition
  metric TEXT NOT NULL,        -- 'revenue' | 'arr' | 'mrr' | 'tcv' | 'acv' | 'gmv' | 'bookings'

  -- Period
  period_type TEXT NOT NULL,   -- 'annual' | 'quarterly' | 'monthly'
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_label TEXT NOT NULL,  -- 'FY2026' | 'Q1 2026' | 'Jan 2026'

  -- Target amount
  amount NUMERIC NOT NULL,

  -- Metadata
  set_by TEXT,                 -- user email
  set_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Revision tracking
  supersedes_id UUID REFERENCES targets(id),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_targets_workspace_period
  ON targets(workspace_id, period_start, period_end, is_active);
```

**Key Findings:**
- ✅ Supports revision history (supersedes_id)
- ✅ Active/inactive status
- ✅ Flexible metric types
- ❌ **No segment scoping** - targets are workspace-level only (no region/segment breakdown)
- ❌ No confidence or source tracking
- ❌ Not integrated with business_dimensions for segment targets

**Related Table:** `quotas` (migration 064) - rep-level quota assignment

---

### 1.7 Other Workspace-Scoped Tables

**`workspace_memory`** (Migration 132):
- Purpose: Cross-session memory for recurring findings, strategic context
- Structure: Flexible JSONB content with entity linkage
- Status: Implemented but usage unclear

**`brief_recommendations`** (Referenced in deliberation-engine.ts):
- Purpose: Check-in reminders for briefings
- Status: Table exists, used for 7-day follow-ups

**`hypothesis_drafts`** (Migration 136):
- Purpose: Review queue for auto-generated hypotheses
- Status: Fully implemented, promotes to standing_hypotheses on approval

---

## Step 2: Calibration Audit

### 2.1 Current Calibration Systems

Pandora has **two separate calibration flows:**

#### A. **Document Preferences Calibration** (documents/calibration.ts)

**Purpose:** Tune document generation style (voice, tone, structure)
**Trigger:**
1. After 3+ documents generated
2. Average edit distance > 0.4
3. Quarterly refresh

**Questions (6 total):**
1. Executive Summary lead-in (deal_count | revenue_gap | pacing_status | risk_narrative)
2. Rep naming in risks (full_name | last_name | rep_role | anonymous)
3. Comparison baseline (pacing_to_quota | week_over_week | quarter_over_quarter)
4. Recommendation style (prescriptive | suggestive | coaching_questions)
5. Primary audience (cro | vpsales | front_line_manager | ops)
6. Executive summary max paragraphs (1 | 2 | 3)

**Storage:** `workspaces.workspace_config.document_profile.calibration.answers`

**Wiring:** ✅ Fully integrated with document generation skills

---

#### B. **Pipeline/Metric Calibration Interview** (calibration-interview.ts)

**Purpose:** Define pipeline stages, active pipeline, forecast categories
**Trigger:** Initiated manually or during onboarding

**Steps (7 total):**
1. **Stage mapping** - Map CRM stages to normalized labels (awareness, evaluation, qualification, decision, negotiation, closed_won, closed_lost)
2. **Active pipeline** - Define filter for "active" deals
3. **Pipeline coverage** - Expected coverage ratio (e.g. 3.0x)
4. **Win rate** - Benchmark win rate %
5. **At-risk** - Define at-risk criteria (e.g. 30+ days since activity)
6. **Commit** - Forecast commit category definition
7. **Forecast rollup** - Rollup method

**Storage:** `workspaces.workspace_config.calibration.interview_state`

**Wiring:** ⚠️ Partially wired
- Stage mapping: Used in stage-normalization throughout skills
- Active pipeline/at-risk/commit: Stored as named filters in workspace_config
- Win rate/coverage: Referenced in some skills, but not universally

---

### 2.2 What's Missing

❌ **Unified calibration checklist** - No single source of truth for "workspace readiness"

❌ **Metric definitions calibration** - No structured flow to define:
- Numerator/denominator for calculated metrics
- Unit conventions (K, M, %, x)
- Exclusion rules (test deals, etc.)
- Confidence thresholds

❌ **Business config calibration** - No guided flow for:
- GTM motion (PLG, outbound, channel, etc.)
- CRO goals and priorities
- Team structure and territories
- Deal taxonomy and lifecycle

❌ **Confirmation loop** - No workflow to:
- Review auto-inferred dimensions
- Approve/reject auto-generated hypotheses
- Validate metric calculations against manual counts

❌ **Field trust scores** - data_dictionary doesn't track:
- Completion rates by field
- Confidence in field accuracy
- Last validated timestamp

---

## Step 3: Gap Analysis

### 3.1 Business Config

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| Growth motion (PLG/outbound/channel) | ⚠️ Partial | `workspace_config.business_model.gtm_motion` | Stored but not universally used |
| CRO goals | ❌ Missing | N/A | No structured storage |
| Segment | ⚠️ Partial | `workspace_config.business_model.segment` | Stored but not validated |
| Industry | ⚠️ Partial | `workspace_config.business_model.industry` | Stored but not validated |
| Sales cycle days | ⚠️ Computed | Calculated from deal history | Not configured, only observed |
| Team structure | ⚠️ Partial | `workspace_config.teams` | Defined in schema, rarely populated |

**Gap:** No guided onboarding to capture business model, CRO priorities, growth motion

---

### 3.2 Metric Definitions

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| Numerator/denominator | ❌ Missing | N/A | Not stored anywhere |
| Unit convention | ⚠️ Partial | `standing_hypotheses.unit` | Only for hypotheses, not general metrics |
| Calculation logic | ❌ Missing | N/A | Hardcoded in skill compute functions |
| Metric aliases | ⚠️ Partial | `data_dictionary.term` | Terminology only, no calculation |
| Exclusion rules | ⚠️ Partial | `workspace_config.tool_filters` | Exists but not tied to metric definitions |

**Gap:** Metric calculation definitions are **hardcoded in TypeScript skill functions**, not stored as data

**Critical Finding:** `data_dictionary` does NOT store metric calculation logic - only field metadata

**Example:** Win rate calculation is in `server/analysis/win-rate.ts`, not in database

---

### 3.3 Dialect Config

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| Deal taxonomy (stages) | ✅ Complete | `workspace_config.calibration.stage_mappings` | Interview-based |
| Segmentation defaults | ⚠️ Partial | `business_dimensions` WHERE `is_default = TRUE` | Defined but not always confirmed |
| Pipeline rules (active/at-risk) | ✅ Complete | `workspace_config.named_filters` | Interview-based |
| Metric aliases | ⚠️ Partial | `data_dictionary.term` | Terminology only |
| Forecast categories | ✅ Complete | `workspace_config.named_filters.commit` | Interview-based |

**Gap:** Segmentation dimensions are defined but not universally confirmed by users

---

### 3.4 Field Trust Scores

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| Completion rate | ❌ Missing | N/A | Not tracked |
| Accuracy confidence | ❌ Missing | N/A | Not tracked |
| Last validated timestamp | ⚠️ Partial | `data_dictionary.last_referenced_at` | Usage tracking, not validation |
| Field source | ⚠️ Partial | `data_dictionary.source` | 'user' | 'filter' | 'system' |

**Gap:** No structured field quality/trust scoring system

---

### 3.5 Readiness Checklist

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| Unified checklist | ❌ Missing | N/A | No single source of truth |
| Skill-specific requirements | ❌ Missing | N/A | Skills don't declare dependencies |
| Gating logic | ❌ Missing | N/A | Skills don't check prerequisites |
| Progress tracking | ❌ Missing | N/A | No calibration progress UI |

**Gap:** No readiness gates preventing skills from running with incomplete config

**Example:** Forecast rollup skill could run without confirmed forecast categories

---

### 3.6 Confirmation Loop

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| Dimension approval | ⚠️ Partial | `business_dimensions.confirmed` | Boolean flag exists, workflow unclear |
| Hypothesis approval | ✅ Complete | `hypothesis_drafts` → `standing_hypotheses` | Approval workflow exists |
| Metric validation | ❌ Missing | N/A | No validation flow |
| Config review UI | ❌ Missing | N/A | No unified review interface |

**Gap:** Confirmation workflows exist for hypotheses but not for dimensions/metrics/business config

---

### 3.7 Skill Config Manifests

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| Required config declaration | ❌ Missing | N/A | Skills don't declare dependencies |
| Required tools declaration | ⚠️ Partial | Skill definitions have `requiredTools` | Only for compute tools |
| Required context declaration | ⚠️ Partial | Some skills have `requiredContext` | Not enforced |
| Pre-run validation | ❌ Missing | N/A | No validation before skill execution |

**Gap:** Skills don't declare what config/context they need, no enforcement

**Example:** `pipeline-waterfall` skill has `requiredContext: ['goals_and_targets']` but doesn't validate it

---

### 3.8 Ingestion Pipeline

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| Transcript ingestion | ⚠️ Partial | Conversation enrichment job exists | Not documented as ingestion pipeline |
| Document upload | ⚠️ Partial | File import schema exists | Not tied to calibration |
| CRM sync | ✅ Complete | Sync adapters for HubSpot/Salesforce | Operational, not calibration-focused |
| Knowledge extraction | ⚠️ Partial | Pattern matching in workspace-knowledge.ts | Regex-based, not LLM |

**Gap:** No structured ingestion pipeline for calibration documents (PDFs, decks, transcripts)

---

## Step 4: Wiring Audit - Data Dictionary

### 4.1 Current Wiring

**data_dictionary table is wired to:**

1. **Agent context injection** (workspace-context.ts:532-560)
   - Loads top 30 terms by `last_referenced_at`
   - Injected into agent system prompt
   - 15-minute cache

2. **Dictionary routes** (routes/data-dictionary.ts)
   - CRUD operations for terms
   - Reference count tracking via filter_usage_log and tool_call_logs

3. **Dictionary seeder** (dictionary/dictionary-seeder.ts)
   - Auto-populates from CRM schema discovery
   - Creates entries for custom fields

4. **Action approver** (workflow/action-approver.ts)
   - Writes dictionary entries when HITL actions are approved

---

### 4.2 What data_dictionary Does NOT Store

❌ **Metric calculation logic** - No numerator/denominator/formula fields

**Evidence:**
- Queried fields: `term, definition, technical_definition, sql_definition, segmentable_by`
- No `numerator`, `denominator`, `unit`, `calculation_method` fields
- SQL definitions are stored as freeform text, not structured formulas

**Sample Entry (inferred structure):**

```json
{
  "term": "Win Rate",
  "definition": "Percentage of qualified opportunities that close as won",
  "technical_definition": "count(closed_won) / count(closed_won + closed_lost)",
  "sql_definition": "SELECT COUNT(*) FILTER (WHERE stage = 'closed_won') * 100.0 / NULLIF(COUNT(*) FILTER (WHERE stage IN ('closed_won', 'closed_lost')), 0) FROM deals",
  "source": "system",
  "segmentable_by": ["owner", "region", "deal_type"]
}
```

**Problem:** SQL definition is **freeform text**, not parseable. Cannot:
- Extract dependencies automatically
- Validate against schema
- Compose metrics programmatically
- Generate dynamic queries

---

### 4.3 Where Metric Logic Lives Today

**Actual metric calculations are hardcoded in TypeScript:**

1. `server/analysis/win-rate.ts` - Win rate calculation
2. `server/analysis/pipeline-coverage.ts` - Pipeline coverage
3. `server/analysis/forecast-rollup.ts` - Forecast summation
4. `server/skills/compute/*.ts` - Skill-specific computations

**Example from codebase (conceptual):**

```typescript
// Win rate is computed, not retrieved from data_dictionary
async function computeWinRate(workspaceId: string) {
  const result = await query(`
    SELECT
      COUNT(*) FILTER (WHERE stage = 'closed_won') AS won,
      COUNT(*) FILTER (WHERE stage IN ('closed_won', 'closed_lost')) AS total
    FROM deals
    WHERE workspace_id = $1
  `, [workspaceId]);

  const won = result.rows[0].won;
  const total = result.rows[0].total;
  return total > 0 ? (won / total) * 100 : null;
}
```

---

### 4.4 Is This a Table Problem or Wiring Problem?

**Answer: Both.**

**Table Problem:**
- `data_dictionary` schema doesn't have fields for structured metric definitions
- Need: `numerator_query`, `denominator_query`, `unit`, `aggregation_method`, `filters`

**Wiring Problem:**
- Skills don't query `data_dictionary` for metric logic
- Skills hardcode calculations in TypeScript
- No abstraction layer for "get metric definition"

**Recommendation:**
- **Short-term:** Add `metric_definition` JSONB column to `data_dictionary` with structured schema
- **Long-term:** New `metric_definitions` table with proper normalization

---

## Recommendations

### 1. Unified Calibration Checklist

Create `calibration_checklist` table:

```sql
CREATE TABLE calibration_checklist (
  workspace_id UUID PRIMARY KEY,

  -- Business config
  gtm_motion_set BOOLEAN DEFAULT FALSE,
  cro_goals_set BOOLEAN DEFAULT FALSE,
  team_structure_set BOOLEAN DEFAULT FALSE,

  -- Pipeline config
  stage_mapping_complete BOOLEAN DEFAULT FALSE,
  active_pipeline_defined BOOLEAN DEFAULT FALSE,
  forecast_categories_defined BOOLEAN DEFAULT FALSE,

  -- Metric definitions
  win_rate_defined BOOLEAN DEFAULT FALSE,
  pipeline_coverage_defined BOOLEAN DEFAULT FALSE,

  -- Dimensions
  dimensions_confirmed_count INTEGER DEFAULT 0,
  dimensions_pending_count INTEGER DEFAULT 0,

  -- Overall progress
  calibration_score NUMERIC,  -- 0.0 to 1.0
  last_updated TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Metric Definitions Table

Extend `data_dictionary` or create new `metric_definitions` table:

```sql
CREATE TABLE metric_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,

  metric_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,

  -- Calculation
  numerator_query TEXT NOT NULL,
  denominator_query TEXT,
  aggregation_method TEXT,  -- 'sum', 'count', 'avg', 'ratio'
  unit TEXT NOT NULL,       -- '$', '%', 'x', 'days', 'count'

  -- Filters
  exclusion_filters JSONB,

  -- Validation
  confidence NUMERIC DEFAULT 0.7,
  last_validated TIMESTAMPTZ,
  sample_value NUMERIC,

  UNIQUE (workspace_id, metric_key)
);
```

### 3. Skill Config Manifests

Add to skill definitions:

```typescript
interface SkillDefinition {
  // ... existing fields

  requiredConfig: {
    business_model?: ['gtm_motion', 'segment'],
    pipelines?: ['stage_mapping', 'active_pipeline'],
    metrics?: ['win_rate', 'pipeline_coverage'],
    dimensions?: ['region', 'deal_type'],
  };

  preRunValidation: (config: WorkspaceConfig) => ValidationResult;
}
```

### 4. Field Trust Scores

Extend `data_dictionary`:

```sql
ALTER TABLE data_dictionary ADD COLUMN completion_rate NUMERIC;
ALTER TABLE data_dictionary ADD COLUMN trust_score NUMERIC DEFAULT 0.7;
ALTER TABLE data_dictionary ADD COLUMN last_validated TIMESTAMPTZ;
ALTER TABLE data_dictionary ADD COLUMN sample_values JSONB;
```

### 5. Confirmation Loop UI

Build unified review interface:
1. Pending dimensions (from `business_dimensions WHERE confirmed = FALSE`)
2. Pending hypotheses (from `hypothesis_drafts WHERE status = 'pending_review'`)
3. Pending metric validations
4. Incomplete config sections

---

## Conclusion

**Current State:**
- ✅ Document calibration: Fully implemented
- ⚠️ Pipeline calibration: Partial (interview-based, JSONB storage)
- ⚠️ Business config: Schema exists, rarely populated
- ❌ Metric definitions: Hardcoded in TypeScript, not stored as data
- ❌ Readiness checklist: No unified system
- ❌ Skill manifests: Skills don't declare dependencies

**Critical Gaps:**
1. No structured metric calculation definitions
2. No unified calibration progress tracking
3. Skills don't validate prerequisites before running
4. No confirmation loop for dimensions/metrics
5. Field trust/quality not tracked

**Next Steps:**
1. Design unified calibration schema (checklist + metric definitions)
2. Build confirmation loop UI (dimensions, hypotheses, metrics)
3. Add skill config manifests with dependency declarations
4. Implement pre-run validation gates
5. Build ingestion pipeline for calibration documents

---

**End of Audit Report**
