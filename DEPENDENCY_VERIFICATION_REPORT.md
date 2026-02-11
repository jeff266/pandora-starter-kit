# Dependency Verification Report

**Date:** February 11, 2026
**Purpose:** Verify critical data dependencies for pipeline intelligence features

---

## Executive Summary

| Dependency | Status | Impact | Action Required |
|------------|--------|--------|-----------------|
| `forecast_category` on deals | 🔴 **MISSING** for HubSpot | HIGH - Blocks commit/best_case/pipeline bucketing | Map from probability |
| `forecast_thresholds` context layer | 🔴 **MISSING** | MEDIUM - Blocks crushing/at_risk bucketing | Create context table |
| `quotas` context layer | 🔴 **MISSING** | HIGH - Blocks attainment calculations | Create context table |
| `skill_runs` table | ✅ **EXISTS** | N/A | None |

---

## 1. forecast_category on Deals

### Status: 🔴 MISSING for HubSpot (works for Salesforce)

**Schema:** ✅ Column exists
```sql
-- migrations/001_initial.sql:41
CREATE TABLE deals (
  ...
  forecast_category TEXT,
  ...
);
```

**Salesforce:** ✅ Maps correctly
```typescript
// server/connectors/salesforce/transform.ts:315
forecast_category: forecastCategory,  // Mapped from ForecastCategoryName

// Lines 248-266: Normalization logic
switch (opp.ForecastCategoryName) {
  case 'Omitted':
  case 'Pipeline':
    forecastCategory = 'pipeline';
    break;
  case 'Best Case':
    forecastCategory = 'best_case';
    break;
  case 'Commit':
    forecastCategory = 'commit';
    break;
  case 'Closed':
    forecastCategory = 'closed';
    break;
}
```

**HubSpot:** 🔴 Hardcoded to null
```typescript
// server/connectors/hubspot/transform.ts:195
forecast_category: null,  // ❌ NOT MAPPED
```

**Root Cause:**
- HubSpot API fetch does NOT include any forecast category field (client.ts:66-71)
- HubSpot doesn't have native "forecast_category" like Salesforce
- Must be derived from deal stage probability or custom property

### Impact

**Critical for:**
- ✅ **Single-Thread Alert** - Filters by `forecast_category = 'commit'`
- ✅ **Pipeline Coverage** - Buckets deals by forecast category
- ✅ **Deal Query Tool** - Allows filtering by forecast_category

**Current Behavior:**
- All HubSpot deals have `forecast_category = null`
- Skills that filter by forecast_category will miss 100% of HubSpot deals
- Pipeline coverage calculations will be incomplete

### Solution: Derive from Probability

HubSpot provides `hs_deal_stage_probability` (0-100). Map to forecast categories:

```typescript
// Proposed mapping:
function deriveForecastCategory(probability: number | null, isClosed: boolean, isWon: boolean): string | null {
  if (isClosed && isWon) return 'closed';
  if (isClosed && !isWon) return 'closed';
  if (probability === null) return 'pipeline';

  // Standard HubSpot probability thresholds:
  if (probability >= 90) return 'commit';      // 90-100%
  if (probability >= 60) return 'best_case';   // 60-89%
  return 'pipeline';                            // 0-59%
}
```

**Alternative:** Check for custom property
```typescript
// If customer has a custom "forecast_category" property in HubSpot
const customForecastCategory = props.forecast_category || props.hs_forecast_category;
if (customForecastCategory) {
  forecast_category = normalizeForecastCategory(customForecastCategory);
} else {
  forecast_category = deriveForecastCategory(probability, isClosed, isWon);
}
```

---

## 2. forecast_thresholds Context Layer

### Status: 🔴 DOES NOT EXIST

**Search Results:**
```bash
$ grep -r "forecast_threshold" server/
# No results found
```

**What's Missing:**
- No `forecast_thresholds` table in migrations
- No API endpoint to manage thresholds
- No context layer for crushing/on_track/at_risk/behind cutoffs

### Purpose

Define thresholds for forecast health bucketing:

```typescript
interface ForecastThresholds {
  workspace_id: string;
  crushing: number;     // e.g., 1.2 (120% of quota)
  on_track: number;     // e.g., 0.9 (90% of quota)
  at_risk: number;      // e.g., 0.7 (70% of quota)
  behind: number;       // e.g., 0.5 (50% of quota)
  // Everything below "behind" is considered critical
}
```

**Usage:**
```typescript
// In Pipeline Coverage skill:
const commitTotal = deals.filter(d => d.forecast_category === 'commit').sum('amount');
const quota = getQuota(rep, period);
const attainment = commitTotal / quota;

if (attainment >= thresholds.crushing) return 'crushing';
if (attainment >= thresholds.on_track) return 'on_track';
if (attainment >= thresholds.at_risk) return 'at_risk';
if (attainment >= thresholds.behind) return 'behind';
return 'critical';
```

### Impact

**Blocks:**
- Rep health scoring (crushing vs at risk vs behind)
- Automated alerts ("Team is at risk of missing quota")
- Skill outputs like "You're on track to hit 105% of quota"

**Current Workaround:**
- Skills use hardcoded thresholds (not visible to users)
- Example: Pipeline Coverage uses `pipeline_coverage_target: 3` from context

### Solution: Create Context Table

```sql
CREATE TABLE forecast_thresholds (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  crushing NUMERIC(3,2) NOT NULL DEFAULT 1.20,    -- 120%
  on_track NUMERIC(3,2) NOT NULL DEFAULT 0.90,    -- 90%
  at_risk NUMERIC(3,2) NOT NULL DEFAULT 0.70,     -- 70%
  behind NUMERIC(3,2) NOT NULL DEFAULT 0.50,      -- 50%
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with defaults for existing workspaces
INSERT INTO forecast_thresholds (workspace_id)
SELECT id FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;
```

**API Endpoints:**
```typescript
GET  /api/workspaces/:id/context/forecast-thresholds
PUT  /api/workspaces/:id/context/forecast-thresholds
```

---

## 3. quotas Context Layer

### Status: 🔴 DOES NOT EXIST

**Search Results:**
```bash
$ grep -r "CREATE TABLE.*quota" migrations/
# No results found
```

**What's Missing:**
- No `quotas` table in migrations
- No API endpoint to manage quotas
- No context layer for team + per-rep quotas

**Context Layer Reference:**
```typescript
// server/routes/context.ts:157
pipeline_coverage_target: 'number (multiple of quota, e.g. 3)',
revenue_target: 'number',
```

These are workspace-level, but don't support per-rep quotas or time periods.

### Purpose

Store team and per-rep quotas for attainment calculations:

```typescript
interface Quota {
  id: string;
  workspace_id: string;
  period_type: 'monthly' | 'quarterly' | 'annual';
  period_start: Date;
  period_end: Date;
  team_quota: number;      // e.g., $1,000,000 for the team
  rep_quotas: {            // Per-rep breakdown
    [rep_name: string]: number;  // e.g., { "John Doe": 100000, "Jane Smith": 150000 }
  };
  created_at: Date;
  updated_at: Date;
}
```

**Usage:**
```typescript
// In Pipeline Coverage skill:
const quota = await getQuota(workspace_id, rep_name, period);
const commitTotal = deals.filter(d => d.owner === rep_name && d.forecast_category === 'commit').sum('amount');
const attainment = commitTotal / quota.amount;
// "John is at 85% attainment ($850K of $1M quota)"
```

### Impact

**Blocks:**
- Rep-level attainment calculations
- Team vs individual quota tracking
- Week-over-week quota progress
- Skills like "Pipeline Coverage" need per-rep quotas to calculate coverage ratios

**Current Workaround:**
- Skills use `revenue_target` from workspace context (team-level only)
- No per-rep granularity
- No time period support (can't track Q1 vs Q2 separately)

### Solution: Create Context Tables

```sql
-- Quota periods (one per time period)
CREATE TABLE quota_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,  -- e.g., "Q1 2026", "Jan 2026"
  period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'annual')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  team_quota NUMERIC(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, start_date, period_type)
);

-- Per-rep quotas
CREATE TABLE rep_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES quota_periods(id) ON DELETE CASCADE,
  rep_name TEXT NOT NULL,  -- Or rep_owner_id if you have user IDs
  quota_amount NUMERIC(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(period_id, rep_name)
);

CREATE INDEX idx_quota_periods_workspace_date
  ON quota_periods(workspace_id, start_date DESC);

CREATE INDEX idx_rep_quotas_period
  ON rep_quotas(period_id);
```

**API Endpoints:**
```typescript
GET    /api/workspaces/:id/quotas/periods
POST   /api/workspaces/:id/quotas/periods
PUT    /api/workspaces/:id/quotas/periods/:period_id
DELETE /api/workspaces/:id/quotas/periods/:period_id

GET    /api/workspaces/:id/quotas/periods/:period_id/reps
PUT    /api/workspaces/:id/quotas/periods/:period_id/reps/:rep_name
```

**Helper Function:**
```typescript
async function getQuota(
  workspaceId: string,
  repName: string,
  date: Date = new Date()
): Promise<{ amount: number; periodName: string } | null> {
  const result = await query(`
    SELECT qp.name, qp.team_quota, rq.quota_amount
    FROM quota_periods qp
    LEFT JOIN rep_quotas rq ON rq.period_id = qp.id AND rq.rep_name = $2
    WHERE qp.workspace_id = $1
      AND qp.start_date <= $3
      AND qp.end_date >= $3
    LIMIT 1
  `, [workspaceId, repName, date]);

  if (!result.rows[0]) return null;

  return {
    amount: result.rows[0].quota_amount || result.rows[0].team_quota,
    periodName: result.rows[0].name,
  };
}
```

---

## 4. skill_runs Table

### Status: ✅ EXISTS

**Schema:** ✅ Confirmed
```sql
-- migrations/007_skill_runs.sql
CREATE TABLE IF NOT EXISTS skill_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger_type TEXT,
  params JSONB NOT NULL DEFAULT '{}',
  result JSONB,                    -- ✅ Stores skill output
  output_text TEXT,
  steps JSONB NOT NULL DEFAULT '[]',
  token_usage JSONB NOT NULL DEFAULT '{"compute": 0, "deepseek": 0, "claude": 0}',
  duration_ms INTEGER,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Indexes:** ✅ Optimized for queries
```sql
CREATE INDEX idx_skill_runs_workspace_skill_created
  ON skill_runs (workspace_id, skill_id, created_at DESC);

CREATE INDEX idx_skill_runs_workspace_status
  ON skill_runs (workspace_id, status);

CREATE INDEX idx_skill_runs_skill_created
  ON skill_runs (skill_id, created_at DESC);
```

**Usage:** ✅ Week-over-week comparison supported
```typescript
// Get current week's run
const currentRun = await query(`
  SELECT result FROM skill_runs
  WHERE workspace_id = $1 AND skill_id = 'pipeline-coverage'
    AND status = 'completed'
  ORDER BY created_at DESC
  LIMIT 1
`, [workspaceId]);

// Get previous week's run
const previousRun = await query(`
  SELECT result FROM skill_runs
  WHERE workspace_id = $1 AND skill_id = 'pipeline-coverage'
    AND status = 'completed'
    AND created_at < $2 - INTERVAL '7 days'
  ORDER BY created_at DESC
  LIMIT 1
`, [workspaceId, currentRun.created_at]);

// Compare
const currentCommit = currentRun.result.commit_total;
const previousCommit = previousRun.result.commit_total;
const deltaPercent = ((currentCommit - previousCommit) / previousCommit) * 100;
// "Commit deals increased 12% week-over-week"
```

**Verification:** ✅ No issues

---

## Priority Action Items

### HIGH Priority (Blocks Skills)

**1. Fix HubSpot forecast_category mapping**
- **Effort:** 1-2 hours
- **Impact:** Unblocks commit/best_case/pipeline bucketing for HubSpot deals
- **Blocks:** Single-Thread Alert, Pipeline Coverage, Deal Query filtering
- **Action:**
  1. Fetch `hs_deal_stage_probability` from HubSpot (already done, line 69)
  2. Add closed deal detection (check stage name or custom property)
  3. Implement `deriveForecastCategory()` logic in transform.ts
  4. Update line 195 to use derived value instead of null

**2. Create quotas context layer**
- **Effort:** 2-3 hours
- **Impact:** Enables attainment calculations for all skills
- **Blocks:** Rep health scoring, attainment tracking, quota-based alerts
- **Action:**
  1. Create migration: `008_quotas.sql`
  2. Add API endpoints: GET/PUT `/api/workspaces/:id/quotas/...`
  3. Seed with defaults for existing workspaces
  4. Update Pipeline Coverage skill to use per-rep quotas

### MEDIUM Priority (Improves UX)

**3. Create forecast_thresholds context layer**
- **Effort:** 1-2 hours
- **Impact:** Enables configurable health buckets (crushing/on_track/at_risk/behind)
- **Blocks:** User-configurable thresholds (currently hardcoded)
- **Action:**
  1. Create migration: `009_forecast_thresholds.sql`
  2. Add API endpoints: GET/PUT `/api/workspaces/:id/context/forecast-thresholds`
  3. Update skills to use configurable thresholds instead of hardcoded values

---

## Summary

| Dependency | Exists? | Working? | Priority | Effort |
|------------|---------|----------|----------|--------|
| forecast_category (Salesforce) | ✅ | ✅ | N/A | N/A |
| forecast_category (HubSpot) | ✅ Schema | ❌ Always null | 🔴 HIGH | 1-2h |
| forecast_thresholds | ❌ | ❌ | 🟡 MEDIUM | 1-2h |
| quotas | ❌ | ❌ | 🔴 HIGH | 2-3h |
| skill_runs | ✅ | ✅ | N/A | N/A |

**Total Effort to Unblock:** 3-5 hours

**Critical Path:**
1. Fix HubSpot forecast_category (1-2h) → Unblocks Single-Thread Alert, Pipeline Coverage
2. Create quotas layer (2-3h) → Unblocks attainment calculations

**Nice to Have:**
3. Create forecast_thresholds (1-2h) → Makes thresholds user-configurable instead of hardcoded
