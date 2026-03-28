# WorkspaceIntelligence Build Log

**Started:** 2026-03-27
**Spec:** PANDORA_WORKSPACE_INTELLIGENCE_SPEC.md
**Build Environment:** Claude Code (backend) → Replit (schema verification + frontend)

---

## Build Progress

### ✅ Phase 1: Schema Migrations (COMPLETE)

Created 3 SQL migration files following naming convention:

**217_workspace_intelligence_extend_tables.sql**
- Extends workspace_knowledge: adds `domain` column + `structured_ref` UUID
- Extends business_dimensions: adds `entity`, `crm_field`, `crm_values` columns
- Extends data_dictionary: adds trust scoring (`completion_rate`, `trust_score`, `trust_reason`, `last_audited`, `is_trusted_for_reporting`)
- Extends standing_hypotheses: adds `metric_definition_id` FK placeholder
- Extends targets: adds `segment_scope`, `deal_type_scope` columns

**218_metric_definitions.sql**
- Creates metric_definitions table with:
  - Identity: metric_key, label, description
  - Calculation: numerator (JSONB), denominator (JSONB), aggregation_method, unit
  - Segmentation: segmentation_defaults array
  - Confirmation: confidence, confirmed_by, confirmed_at, confirmed_value, last_computed_value
  - Source tracking: SYSTEM | FORWARD_DEPLOY | INFERRED | USER
- Adds FK from standing_hypotheses.metric_definition_id → metric_definitions.id
- Uses DROP TABLE CASCADE then CREATE TABLE (no IF NOT EXISTS) per user instructions

**219_calibration_checklist.sql**
- Creates calibration_checklist table with:
  - Question identity: question_id, domain, question
  - Answer: answer (JSONB), answer_source, status, confidence
  - Dependencies: depends_on array, skill_dependencies array
  - Confirmation loop: pandora_computed_answer, human_confirmed, confirmed_by, confirmed_at
- Indexes: workspace, domain, status, skill_dependencies (GIN)

**Status:** ⚠️ **READY FOR REPLIT VERIFICATION** before running migrations
- Migration numbers updated to 217-219 (highest existing migration is 216)
- Migration 117 fixed with DO block to check workspace existence before INSERT
- All new columns have COMMENT documentation
- Ratio convention: stored as 0-1 (display multiplies ×100)
- All constraints use CHECK and FK appropriately

---

### ✅ Phase 2: TypeScript Interfaces (COMPLETE)

**server/types/workspace-intelligence.ts** (NEW FILE — 550+ lines)

---

### ✅ Phase 3: Resolver (COMPLETE)

**server/lib/workspace-intelligence.ts** (NEW FILE — 625 lines)

---

### ✅ Phase 5: Standard Metrics Library + Seeder (COMPLETE)

**server/lib/standard-metrics.ts** (NEW FILE — 450+ lines)

**15 Standard Metrics Defined:**
1. **win_rate** - Closed won / (won + lost), ratio metric with numerator/denominator queries
2. **pipeline_coverage** - Pipeline / quota_remaining, auto-segments when coverage_requires_segmentation=true
3. **attainment** - Closed won amount, segmented by owner by default
4. **average_deal_size** - AVG(amount) for closed won deals
5. **sales_cycle** - AVG days from create to close for won deals
6. **expansion_rate** - Closed won from expand deal types (uses taxonomy.expand_values)
7. **pipeline_created** - Total pipeline created in current period
8. **pipeline_velocity** - Derived metric (pipeline × win_rate × avg_deal_size / sales_cycle), sentinel QueryDefinition
9. **stage_conversion** - Deal progression rate between stages (requires per-stage config)
10. **mql_to_sql** - Marketing to Sales qualified lead conversion (contact-based)
11. **quota_remaining** - Quota minus closed won (requires targets table)
12. **calls_per_meeting** - Activity efficiency metric (call count / meeting count)
13. **attainment_distribution** - % of reps hitting quota thresholds (derived metric, sentinel QueryDefinition)
14. **nrr** - Net Revenue Retention (multi-component, requires ARR decomposition)
15. **pipeline_at_risk** - Pipeline with no activity in 30 days

**Query Definition Structure:**
- All metrics use ConditionSource types: `literal`, `config_ref`, `metric_ref`, `date_scope`
- Config refs resolve from WorkspaceIntelligence paths (e.g., `pipeline.active_stages`, `taxonomy.expand_values`)
- Date scopes: `current_period`, `prior_period`, `rolling_30/60/90`, `ytd`, `custom`
- All metrics include detailed descriptions noting dependencies and limitations

**server/lib/metric-seeder.ts** (NEW FILE — 120 lines)

**Seeding Functions:**
- `seedStandardMetrics(workspaceId)` - Idempotent seeding for single workspace
  - Checks existence before insert (never overwrites)
  - Inserts with `source='SYSTEM'`, `confidence='INFERRED'`
  - Numerator/denominator stored as JSONB
  - Catches per-row errors (one failure doesn't abort rest)
  - Invalidates WorkspaceIntelligence cache after inserts
  - Returns SeedResult with inserted/skipped/errors arrays

- `seedAllWorkspaces()` - Bulk seeding for all workspaces
  - Queries all workspace IDs
  - Calls seedStandardMetrics for each
  - Logs summary statistics

**Test Script:** `server/scripts/test-metric-seeder.ts`
- Tests first seed (15 inserted, 0 skipped)
- Tests second seed (0 inserted, 15 skipped - idempotency)
- Tests WorkspaceIntelligence resolution (15 metrics present)
- Tests win_rate structure (confidence=INFERRED, numerator/denominator correct)

**Local Test Results:**
- ✓ Compiles without TypeScript errors
- ✓ All 15 metrics defined with non-empty descriptions
- ⏳ Data testing requires Replit (migrations 217-219 present)

---

### ⏳ Phase 4: Query Compiler (COMPLETE - BUILT ON REPLIT)

**server/lib/query-compiler.ts** (438 lines) - pulled from origin/main

**Core Resolver:**
- `resolveWorkspaceIntelligence(workspaceId)` — Main async function that resolves all 7 domains in parallel
- Returns complete `WorkspaceIntelligence` object with 5-minute cache TTL
- All domain resolvers use try/catch with graceful fallback to empty/null states
- 5-minute in-memory Map cache with expiry timestamps

**Domain Resolvers (Private Functions):**
1. `resolveBusiness` — Queries `workspaces.workspace_config.business`, returns all fields or null defaults
2. `resolveMetrics` — Queries `metric_definitions`, builds map keyed by metric_key
3. `resolveSegmentation` — Queries `business_dimensions`, builds dimensions map + default_dimensions array (confirmed=true)
4. `resolveTaxonomy` — Queries `workspace_config.pipelines[0].taxonomy` + `workspace_knowledge` (domain='taxonomy' for custom_aliases)
5. `resolvePipeline` — Queries `workspace_config.pipelines[0]` + `targets` table, builds active_stages + coverage_targets map
6. `resolveDataQuality` — Queries `data_dictionary` (completion_rate, trust_score, etc.) + checks `deal_stage_history` existence
7. `resolveKnowledge` — Queries `workspace_knowledge` (confidence >= 0.6), groups by domain
8. `resolveReadiness` — Queries `calibration_checklist`, calculates domain scores (confirmed/total), identifies blocking_gaps

**Caching:**
- Map-based cache with 5-minute TTL
- `invalidateWorkspaceIntelligence(workspaceId)` — Export for cache invalidation
- Cache hit: 0ms response time
- Cache miss: ~50ms response time (7 parallel queries)

**Error Handling:**
- Every domain resolver has try/catch wrapping all queries
- Logs errors with `workspaceId` and domain name
- Returns safe zero/empty/null state on error (never throws)
- Missing tables/columns handled gracefully (returns defaults)

**Test Results (Frontera workspace):**
- ✓ First call: 52ms (DB queries)
- ✓ Second call: 0ms (cache hit)
- ✓ Cache verification: resolved_at timestamps match
- ✓ All domains return valid structure (empty due to local DB not having migrations)
- ✓ Error handling working: 4 domains logged missing table/column errors but returned defaults

**Files Created:**
- `server/lib/workspace-intelligence.ts` — Core resolver
- `server/scripts/test-workspace-intelligence.ts` — Phase 3 test script

---

### ✅ Phase 2: TypeScript Interfaces (COMPLETE - MOVED)

**Query Definition Types:**
- `AggregationFn` — COUNT | SUM | AVG | MIN | MAX | COUNT_DISTINCT
- `ConditionSource` — literal | config_ref | metric_ref | date_scope
- `DateScope` — current_period | prior_period | rolling_30/60/90 | ytd | custom
- `ConditionOperator` — eq | neq | in | not_in | gt | lt | gte | lte | is_null | not_null
- `Condition` — field, operator, value (ConditionSource)
- `JoinDefinition` — entity, on, type
- `QueryDefinition` — entity, aggregation, conditions, joins, date_scope, group_by

**Compiled Query Types:**
- `ConfidenceLevel` — CONFIRMED | INFERRED | UNKNOWN
- `CompiledQuery` — sql, params, confidence, unresolved_refs, fallback_used, warnings

**WorkspaceIntelligence Interface:**
- `business` — gtm_motion, growth_stage, revenue_model, board_metrics, cro_primary_concern, sells_multiple_products, products, forecast_methodology, quota_currency, multi_year_reporting, nrr_tracked
- `metrics` — map of metric_key → { id, label, numerator, denominator, aggregation_method, unit, segmentation_defaults, confidence, confirmed_value, last_computed_value }
- `segmentation` — default_dimensions array, dimensions map with crm_field/entity/values/confirmed
- `taxonomy` — land_field/values, expand_field/values, renew_field/values, custom_aliases
- `pipeline` — active_stages, excluded_stages, coverage_targets (by segment), weighted, coverage_requires_segmentation
- `data_quality` — fields map with completion_rate/trust_score/is_trusted_for_reporting/last_audited, stage_history_available, close_dates_reliable
- `knowledge` — grouped by domain with key/value/source/confidence
- `readiness` — overall_score (0-100), by_domain scores, blocking_gaps array, skill_gates map

**Skill Manifest Types:**
- `SkillManifest` — skill_id, required_checklist_items, preferred_checklist_items, required_metric_keys, fallback_behavior
- `SkillGateResult` — gate (LIVE/DRAFT/BLOCKED), missing_required, missing_preferred, warnings

**Database Row Types:**
- `MetricDefinitionRow` — fully typed from schema
- `CalibrationChecklistRow` — fully typed from schema
- `BusinessDimensionRow` — fully typed with new columns
- `WorkspaceKnowledgeRow` — fully typed with new columns
- `DataDictionaryRow` — fully typed with new columns
- `TargetRow` — fully typed with new columns
- `CalibrationQuestion` — for 100-question bank

**server/types/workspace-config.ts** (EXTENDED)

Added to `WorkspaceConfig` interface:
```typescript
business?: BusinessConfig;
```

Added `BusinessConfig` interface:
- gtm_motion, growth_stage, revenue_model
- board_metrics, cro_primary_concern
- sells_multiple_products, products
- forecast_methodology, quota_currency
- multi_year_reporting, nrr_tracked

---

## Next Steps (Remaining Phases)

### Phase 3: Resolver (NOT STARTED)
Build `server/lib/workspace-intelligence.ts`:
- `resolveWorkspaceIntelligence(workspaceId): Promise<WorkspaceIntelligence>`
- Resolution logic per domain (business, metrics, segmentation, taxonomy, pipeline, data_quality, knowledge, readiness)
- Readiness computation with domain scores
- 5-minute in-memory cache per workspace
- `invalidateWorkspaceIntelligence(workspaceId): void` export

### Phase 4: Query Compiler (NOT STARTED)
Build `server/lib/query-compiler.ts`:
- `compileQuery(definition: QueryDefinition, wi: WorkspaceIntelligence): CompiledQuery`
- Config ref resolution from WorkspaceIntelligence paths
- Metric ref resolution from last_computed_value
- Date scope resolution to actual date ranges
- Confidence propagation (lowest of any resolved ref)
- Auto-inject company join when coverage_requires_segmentation = true (Frontera fix)

### Phase 5: Standard Metric Library (NOT STARTED)
Build `server/lib/standard-metrics.ts`:
- `STANDARD_METRIC_LIBRARY` — 15 standard metrics with QueryDefinition structures
  - win_rate, pipeline_coverage, attainment, average_deal_size, sales_cycle
  - expansion_rate, pipeline_created, pipeline_velocity, stage_conversion
  - mql_to_sql, quota_remaining, calls_per_meeting, attainment_distribution
  - nrr, pipeline_at_risk
- `seedStandardMetrics(workspaceId): Promise<void>` — idempotent seeder

### Phase 6: Skill Manifests (NOT STARTED)
Build `server/lib/skill-manifests.ts`:
- `SKILL_MANIFESTS: Record<string, SkillManifest>` — all 16 live skills
- Priority manifests: pipeline_waterfall, rep_scorecard, forecast_rollup, pipeline_coverage
- `getSkillManifest(skillId): SkillManifest | null` export

### Phase 7: Calibration Questions (NOT STARTED)
Build `server/lib/calibration-questions.ts`:
- `STANDARD_CHECKLIST_QUESTIONS` — 100-question bank across 6 domains
- Priority questions (Frontera/GrowthX/GrowthBook bugs):
  - pipeline_active_stages, pipeline_coverage_target, coverage_target_by_segment
  - coverage_requires_segmentation, segmentation_field, segmentation_values, segmentation_entity
  - land_motion_field/values, expand_motion_field/values
  - win_rate_denominator, attainment_method, arr_field, arr_decomposed
  - gtm_motion, forecast_methodology, forecast_categories
- Exports: STANDARD_CHECKLIST_QUESTIONS, getChecklistByDomain, getSkillBlockingQuestions

### Phase 8: Forward Deploy Seeder (NOT STARTED)
Build `server/lib/forward-deploy-seeder.ts`:
- `seedWorkspaceForForwardDeploy(workspaceId): Promise<SeedResult>`
- Seeds metric_definitions from STANDARD_METRIC_LIBRARY
- Inserts calibration_checklist questions for workspace
- Pre-populates from existing workspace_config, business_dimensions, workspace_knowledge
- Returns SeedResult with counts
- Endpoint: `POST /api/admin/forward-deploy/seed/:workspaceId` (admin only, idempotent)

### Phase 9: Skill Integration (NOT STARTED) — **RISKIEST**
Modify existing skills:
1. Add gate check at top of compute function
2. Replace hardcoded values with WorkspaceIntelligence refs
3. Tag synthesis output with confidence level

Priority skills to update:
- pipeline_waterfall — use wi.pipeline.active_stages, wi.segmentation
- pipeline_coverage — use wi.pipeline.coverage_targets, wi.pipeline.coverage_requires_segmentation
- rep_scorecard — use wi.metrics.attainment, wi.taxonomy
- forecast_rollup — use wi.business.forecast_methodology, wi.metrics.quota_remaining

**DO NOT START PHASE 9 UNTIL PHASES 1-8 ARE VERIFIED WORKING**

### Phase 10: API Endpoints (NOT STARTED)
Build `server/routes/forward-deploy.ts`:
- GET `/api/workspaces/:id/intelligence` — full WorkspaceIntelligence object
- GET `/api/workspaces/:id/calibration` — calibration_checklist grouped by domain
- PATCH `/api/workspaces/:id/calibration/:questionId` — update answer + status
- GET `/api/workspaces/:id/metrics` — all metric_definitions
- PATCH `/api/workspaces/:id/metrics/:metricKey` — update metric definition
- POST `/api/workspaces/:id/metrics/:metricKey/confirm` — confirmation loop
- POST `/api/admin/forward-deploy/seed/:workspaceId` — run seeder

**CRITICAL:** Every route must import and call `requirePermission` or server crashes

---

## Files Created

### New Files:
- ✅ `migrations/217_workspace_intelligence_extend_tables.sql`
- ✅ `migrations/218_metric_definitions.sql`
- ✅ `migrations/219_calibration_checklist.sql`
- ✅ `server/types/workspace-intelligence.ts`
- ✅ `server/lib/workspace-intelligence.ts` — Phase 3 resolver
- ✅ `server/scripts/test-workspace-intelligence.ts` — Phase 3 test script
- ✅ `server/lib/query-compiler.ts` — Phase 4 compiler (built on Replit)
- ✅ `server/lib/standard-metrics.ts` — Phase 5 metric library (15 metrics)
- ✅ `server/lib/metric-seeder.ts` — Phase 5 seeder (idempotent)
- ✅ `server/scripts/test-metric-seeder.ts` — Phase 5 test script

### Modified Files:
- ✅ `server/types/workspace-config.ts` — added BusinessConfig interface
- ✅ `migrations/117_imubit_historical_stage_configs.sql` — wrapped INSERT in DO block with workspace existence check

### Pending Files (Phase 6-10):
- ⏳ `server/lib/skill-manifests.ts`
- ⏳ `server/lib/calibration-questions.ts`
- ⏳ `server/lib/forward-deploy-seeder.ts`
- ⏳ `server/routes/forward-deploy.ts`
- ⏳ 16 skill files (gate checks + WI refs)

---

## Critical Constraints Status

- ✅ **Read before writing** — All files read before modification
- ⏳ **Replit verifies schema first** — PENDING: Must verify actual column names in Neon before running migrations
- ✅ **No regressions** — Migrations are additive (ALTER TABLE ADD COLUMN IF NOT EXISTS)
- ⏳ **requirePermission imports** — Will be enforced in Phase 10 route creation
- ✅ **Ratio storage 0-1** — Documented in migration comments
- ✅ **TypeScript interfaces first** — Phase 2 complete before Phase 3 implementation
- ✅ **One migration per phase** — 3 separate migration files for Phase 1

---

## Acceptance Criteria Checklist

### Schema (Phase 1)
- [✅] All 3 migrations run without error on Neon (user confirmed: "Clean. All three migrations passed")
- [✅] Replit confirms actual column names match spec before migrations run
- [✅] No existing data lost in existing tables (all ALTER TABLE ADD COLUMN IF NOT EXISTS)

### Resolver (Phase 3) — COMPLETE
- [✅] `resolveWorkspaceIntelligence('frontera-workspace-id')` returns valid WorkspaceIntelligence object
- [✅] Cache works: first call 52ms, second call 0ms (cache hit)
- [✅] Error handling works: missing tables/columns return safe defaults with logged errors
- [✅] All 7 domain resolvers implemented and tested
- [⏳] Frontera-specific data verification (requires Replit test with actual data after migrations)
- [⏳] Cache invalidation test (requires write route integration in Phase 10)

### Compiler (Phase 4) — NOT STARTED
- [ ] `compileQuery(pipeline_coverage_numerator, frontera_wi)` returns SQL with company JOIN and GROUP BY segment
- [ ] `compileQuery(metric_with_unknown_ref, partial_wi)` returns `confidence: 'UNKNOWN'` and populates `unresolved_refs`
- [ ] All compiled queries include `workspace_id = $1` as first param

### Skill gates (Phase 9) — NOT STARTED
- [ ] Pipeline waterfall for Frontera returns `gate: 'DRAFT'` if `segmentation_field` is UNKNOWN
- [ ] Pipeline waterfall for Frontera returns `gate: 'LIVE'` after `segmentation_field` is CONFIRMED
- [ ] No existing skills are broken — all 16 run without errors (gate check is additive)

### Migration seeder (Phase 8) — NOT STARTED
- [ ] Seed runs for all 4 existing workspaces without error
- [ ] Frontera workspace has `coverage_requires_segmentation` checklist question pre-populated from existing config
- [ ] Standard metrics seeded for all workspaces with INFERRED confidence

---

## Recommended Next Steps for Continuation

1. **Replit Schema Verification:** Verify migrations 217-219 against actual Neon schema before running
2. **Run Migrations:** Execute all 3 migrations (217, 218, 219) on Neon database
3. **Build Phase 3 (Resolver):** Core WorkspaceIntelligence resolution logic
4. **Build Phase 4 (Query Compiler):** QueryDefinition → SQL compilation
5. **Build Phase 5 (Standard Metrics):** 15 standard metric definitions + seeder
6. **Build Phase 6 (Skill Manifests):** Dependency declarations for all 16 skills
7. **Build Phase 7 (Calibration Questions):** 100-question bank with skill dependencies
8. **Build Phase 8 (Seeder):** Forward deploy migration for existing clients
9. **Test Phases 1-8:** Full integration test before touching skills
10. **Build Phase 9 (Skill Integration):** Add gate checks to skills (RISKIEST)
11. **Build Phase 10 (API Endpoints):** REST API for WorkspaceIntelligence + calibration

---

**Status:** Phases 1-2 complete (schema + types). Ready for Replit verification and Phase 3 implementation.
