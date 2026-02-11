# HubSpot forecast_category Implementation

**Date:** February 11, 2026
**Status:** Complete and Ready to Deploy

---

## Problem Statement

HubSpot deals had `forecast_category` hardcoded to `null`, making them invisible to skills that filter by forecast category (Single-Thread Alert, Pipeline Coverage, Deal Query Tool).

**Impact:**
- 100% of HubSpot deals missing from commit/best_case/pipeline analysis
- Skills designed for Salesforce wouldn't work for HubSpot customers
- No way to track deal pipeline health for HubSpot workspaces

---

## Solution

Implemented a **fallback strategy** with data lineage tracking:

### 1. Custom Property Detection (Native)
- First checks for HubSpot custom properties: `forecast_category` or `hs_forecast_category`
- If found, normalizes and uses it
- Marks as `forecast_category_source = 'native'`

### 2. Probability Derivation (Fallback)
- If no custom property, derives from `hs_deal_stage_probability`
- Uses workspace-configurable thresholds (default: commit >= 90%, best_case >= 60%)
- Marks as `forecast_category_source = 'derived'`

### 3. Data Lineage Tracking
- New field: `forecast_category_source`
- Values: `'native'` (from CRM property) or `'derived'` (from probability)
- Enables data quality reporting and confidence scoring

---

## Changes Made

### 1. Schema Changes

**Migration 008: forecast_category_source**
```sql
ALTER TABLE deals
ADD COLUMN forecast_category_source TEXT
CHECK (forecast_category_source IN ('native', 'derived', NULL));

-- Backfill Salesforce deals (they use native ForecastCategoryName)
UPDATE deals
SET forecast_category_source = 'native'
WHERE source = 'salesforce' AND forecast_category IS NOT NULL;
```

**Migration 009: forecast_thresholds**
```sql
CREATE TABLE forecast_thresholds (
  workspace_id UUID PRIMARY KEY,
  commit_threshold NUMERIC(5,2) DEFAULT 90.00,
  best_case_threshold NUMERIC(5,2) DEFAULT 60.00,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults for existing workspaces
INSERT INTO forecast_thresholds (workspace_id)
SELECT id FROM workspaces;
```

### 2. HubSpot Client Updates

**File:** `server/connectors/hubspot/client.ts`

```typescript
// Added forecast category properties to fetch list
const coreProperties = [
  ...existing properties...,
  "forecast_category",      // Custom property (may not exist)
  "hs_forecast_category",   // Alternative custom property
];
```

### 3. HubSpot Transform Updates

**File:** `server/connectors/hubspot/transform.ts`

**Added Functions:**
- `normalizeForecastCategory()` - Normalizes custom property values
- `deriveForecastCategoryFromProbability()` - Derives from probability
- `resolveForecastCategory()` - Implements fallback strategy

**Updated Interface:**
```typescript
export interface NormalizedDeal {
  ...
  forecast_category: string | null;
  forecast_category_source: 'native' | 'derived' | null;  // NEW
  ...
}

export interface DealTransformOptions {
  ...
  forecastThresholds?: {
    commit_threshold: number;
    best_case_threshold: number;
  };
}
```

**Updated transformDeal:**
```typescript
// OLD:
forecast_category: null,

// NEW:
const forecastCategoryResolved = resolveForecastCategory(
  props,
  probability,
  options?.forecastThresholds
);
forecast_category: forecastCategoryResolved.category,
forecast_category_source: forecastCategoryResolved.source,
```

### 4. HubSpot Sync Updates

**File:** `server/connectors/hubspot/sync.ts`

**Added Function:**
```typescript
async function getForecastThresholds(workspaceId: string) {
  // Fetches thresholds from forecast_thresholds table
  // Returns { commit_threshold: 90, best_case_threshold: 60 } by default
}
```

**Updated Sync Functions:**
```typescript
// Both initialSync and incrementalSync now fetch and pass thresholds
const [dealOptions, ownerMap, forecastThresholds] = await Promise.all([
  buildStageMaps(client),
  buildOwnerMap(client),
  getForecastThresholds(workspaceId),  // NEW
]);
dealOptions.forecastThresholds = forecastThresholds;
```

### 5. Salesforce Transform Updates

**File:** `server/connectors/salesforce/transform.ts`

**Updated Interface:**
```typescript
export interface NormalizedDeal {
  ...
  forecast_category: string | null;
  forecast_category_source: 'native' | 'derived' | null;  // NEW
  ...
}
```

**Updated transformOpportunity:**
```typescript
forecast_category: forecastCategory,
forecast_category_source: forecastCategory ? 'native' : null,  // NEW
// Salesforce always uses native ForecastCategoryName
```

### 6. API Endpoints

**File:** `server/routes/context.ts`

**New Endpoints:**
```typescript
GET  /api/workspaces/:workspaceId/forecast-thresholds
// Returns: { commit_threshold: 90, best_case_threshold: 60 }

PUT  /api/workspaces/:workspaceId/forecast-thresholds
// Body: { commit_threshold: 90, best_case_threshold: 60 }
// Validates: 0-100 range, commit >= best_case
```

---

## Derivation Logic

### Probability Mapping

```typescript
function deriveForecastCategoryFromProbability(probability, thresholds) {
  if (probability === null) return 'pipeline';
  if (probability >= thresholds.commit_threshold) return 'commit';       // Default: 90%
  if (probability >= thresholds.best_case_threshold) return 'best_case';  // Default: 60%
  return 'pipeline';                                                      // 0-59%
}
```

### Fallback Strategy

```typescript
function resolveForecastCategory(props, probability, thresholds) {
  // 1. Check for custom property (native)
  const customValue = props.forecast_category || props.hs_forecast_category;
  if (customValue) {
    return {
      category: normalizeForecastCategory(customValue),
      source: 'native'
    };
  }

  // 2. Derive from probability (fallback)
  return {
    category: deriveForecastCategoryFromProbability(probability, thresholds),
    source: 'derived'
  };
}
```

### Normalization

```typescript
function normalizeForecastCategory(value: string): string | null {
  const normalized = value.toLowerCase().trim();

  switch (normalized) {
    case 'commit':
    case 'committed':
      return 'commit';
    case 'best case':
    case 'bestcase':
    case 'best_case':
      return 'best_case';
    case 'pipeline':
    case 'omitted':
      return 'pipeline';
    case 'closed':
    case 'closed won':
    case 'closedwon':
      return 'closed';
    default:
      return /^[a-z_]+$/.test(normalized) ? normalized : null;
  }
}
```

---

## Default Thresholds

| Category | Probability Range | Default Threshold |
|----------|-------------------|-------------------|
| Commit | >= 90% | 90% (configurable) |
| Best Case | 60-89% | 60% (configurable) |
| Pipeline | 0-59% | N/A |

**Customization Example:**
```bash
# Make commit more aggressive (85% instead of 90%)
PUT /api/workspaces/{id}/forecast-thresholds
{
  "commit_threshold": 85,
  "best_case_threshold": 60
}
```

---

## Data Quality Reporting

### Query: Native vs Derived Breakdown

```sql
SELECT
  source,
  forecast_category,
  forecast_category_source,
  COUNT(*) as deal_count,
  ROUND(AVG(probability), 1) as avg_probability
FROM deals
WHERE workspace_id = 'your-workspace-id'
  AND forecast_category IS NOT NULL
GROUP BY source, forecast_category, forecast_category_source
ORDER BY source, forecast_category;
```

**Expected Output:**
```
source     | forecast_category | source   | deal_count | avg_probability
-----------|-------------------|----------|------------|----------------
hubspot    | commit            | derived  | 45         | 93.2
hubspot    | best_case         | derived  | 78         | 72.5
hubspot    | pipeline          | derived  | 234        | 31.8
salesforce | commit            | native   | 23         | 95.0
salesforce | best_case         | native   | 34         | 75.0
salesforce | pipeline          | native   | 145        | 25.0
```

### Query: Data Quality Score

```sql
SELECT
  workspace_id,
  COUNT(*) as total_deals,
  COUNT(*) FILTER (WHERE forecast_category_source = 'native') as native_count,
  COUNT(*) FILTER (WHERE forecast_category_source = 'derived') as derived_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE forecast_category_source = 'native') / COUNT(*),
    1
  ) as native_percentage
FROM deals
WHERE forecast_category IS NOT NULL
GROUP BY workspace_id;
```

**Interpretation:**
- `native_percentage > 80%`: High confidence (most data from CRM properties)
- `native_percentage 50-80%`: Medium confidence (mixed)
- `native_percentage < 50%`: Low confidence (mostly derived)

---

## Testing

### Test 1: Custom Property (Native)

**Setup:** HubSpot workspace with `forecast_category` custom property

**Trigger Sync:**
```bash
POST /api/workspaces/{id}/sync
```

**Verify:**
```sql
SELECT
  name,
  forecast_category,
  forecast_category_source,
  probability
FROM deals
WHERE workspace_id = '{id}' AND source = 'hubspot'
LIMIT 5;
```

**Expected:**
- `forecast_category` matches custom property value (normalized)
- `forecast_category_source = 'native'`

### Test 2: Derived from Probability

**Setup:** HubSpot workspace WITHOUT custom `forecast_category` property

**Trigger Sync:**
```bash
POST /api/workspaces/{id}/sync
```

**Verify:**
```sql
SELECT
  name,
  forecast_category,
  forecast_category_source,
  probability
FROM deals
WHERE workspace_id = '{id}' AND source = 'hubspot'
ORDER BY probability DESC
LIMIT 10;
```

**Expected:**
- Probability >= 90: `forecast_category = 'commit'`, `source = 'derived'`
- Probability 60-89: `forecast_category = 'best_case'`, `source = 'derived'`
- Probability 0-59: `forecast_category = 'pipeline'`, `source = 'derived'`

### Test 3: Custom Thresholds

**Setup:** Change thresholds

```bash
PUT /api/workspaces/{id}/forecast-thresholds
{
  "commit_threshold": 85,
  "best_case_threshold": 55
}
```

**Trigger Sync:**
```bash
POST /api/workspaces/{id}/sync
```

**Verify:**
```sql
SELECT
  COUNT(*) FILTER (WHERE forecast_category = 'commit' AND probability >= 85) as commit_count,
  COUNT(*) FILTER (WHERE forecast_category = 'best_case' AND probability BETWEEN 55 AND 84) as best_case_count
FROM deals
WHERE workspace_id = '{id}' AND source = 'hubspot';
```

**Expected:**
- Commit threshold moved from 90 → 85
- Best case threshold moved from 60 → 55
- More deals categorized as commit/best_case

### Test 4: Salesforce Backfill

**Verify Salesforce deals backfilled correctly:**
```sql
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE forecast_category_source = 'native') as native_count,
  COUNT(*) FILTER (WHERE forecast_category_source IS NULL) as null_count
FROM deals
WHERE source = 'salesforce';
```

**Expected:**
- `native_count` = all Salesforce deals with forecast_category set
- `null_count` = 0 (all should be backfilled)

---

## Skills Impact

### Single-Thread Alert

**Before:**
```sql
SELECT * FROM deals
WHERE forecast_category = 'commit'  -- Returns 0 HubSpot deals
```

**After:**
```sql
SELECT * FROM deals
WHERE forecast_category = 'commit'  -- Returns HubSpot + Salesforce deals
```

### Pipeline Coverage

**Before:**
- Commit total: Salesforce only
- Best Case total: Salesforce only
- Pipeline total: Salesforce only

**After:**
- Commit total: HubSpot (derived) + Salesforce (native)
- Best Case total: HubSpot (derived) + Salesforce (native)
- Pipeline total: HubSpot (derived) + Salesforce (native)

### Deal Query Tool

**Before:**
```typescript
DealQuery.run({
  filters: { forecast_category: ['commit'] }
})
// Returns: Only Salesforce deals
```

**After:**
```typescript
DealQuery.run({
  filters: { forecast_category: ['commit'] }
})
// Returns: HubSpot + Salesforce deals
```

---

## Migration Checklist

- [x] Create migration 008_forecast_category_source.sql
- [x] Create migration 009_forecast_thresholds.sql
- [x] Update HubSpot client to fetch custom properties
- [x] Update HubSpot transform with fallback logic
- [x] Update HubSpot sync to fetch and pass thresholds
- [x] Update Salesforce transform to set forecast_category_source
- [x] Add API endpoints for forecast_thresholds
- [ ] Run migrations on production database
- [ ] Trigger resync for HubSpot workspaces
- [ ] Verify data quality with SQL queries
- [ ] Monitor skill runs for improved coverage

---

## Rollout Plan

### Phase 1: Deploy (Estimated: 10 minutes)

1. **Run migrations:**
   ```bash
   psql -d production -f migrations/008_forecast_category_source.sql
   psql -d production -f migrations/009_forecast_thresholds.sql
   ```

2. **Deploy code:**
   ```bash
   git pull origin main
   npm run build  # If needed
   pm2 restart pandora-server  # Or your process manager
   ```

### Phase 2: Backfill (Estimated: 5 minutes)

3. **Trigger HubSpot resyncs:**
   ```bash
   # For each HubSpot workspace
   POST /api/workspaces/{id}/sync
   ```

4. **Monitor sync logs:**
   ```sql
   SELECT
     workspace_id,
     status,
     records_synced,
     started_at,
     completed_at
   FROM sync_log
   WHERE source = 'hubspot'
   ORDER BY started_at DESC
   LIMIT 10;
   ```

### Phase 3: Verify (Estimated: 5 minutes)

5. **Check data quality:**
   ```sql
   -- Should see forecast_category populated for HubSpot deals
   SELECT
     COUNT(*) as total_deals,
     COUNT(*) FILTER (WHERE forecast_category IS NOT NULL) as with_category,
     COUNT(*) FILTER (WHERE forecast_category_source = 'derived') as derived,
     COUNT(*) FILTER (WHERE forecast_category_source = 'native') as native
   FROM deals
   WHERE source = 'hubspot';
   ```

6. **Test skills:**
   - Run Single-Thread Alert skill
   - Run Pipeline Coverage skill
   - Verify HubSpot deals appear in results

---

## Success Criteria

✅ **Schema Changes:**
- `forecast_category_source` column exists in deals table
- `forecast_thresholds` table exists and seeded with defaults

✅ **Data Quality:**
- 100% of HubSpot deals have `forecast_category` populated (not null)
- 100% of HubSpot deals have `forecast_category_source = 'derived'` (unless custom property exists)
- 100% of Salesforce deals have `forecast_category_source = 'native'`

✅ **API Endpoints:**
- `GET /api/workspaces/:id/forecast-thresholds` returns defaults or custom values
- `PUT /api/workspaces/:id/forecast-thresholds` updates and validates thresholds

✅ **Skills:**
- Single-Thread Alert includes HubSpot deals in commit filter
- Pipeline Coverage shows HubSpot + Salesforce deal totals
- Deal Query Tool filters HubSpot deals by forecast_category

---

## Troubleshooting

### Issue: HubSpot deals still have null forecast_category

**Check:**
```sql
SELECT * FROM deals
WHERE source = 'hubspot' AND forecast_category IS NULL
LIMIT 5;
```

**Possible Causes:**
1. Sync hasn't run yet (trigger sync)
2. Probability is null (check `hs_deal_stage_probability`)
3. Code not deployed (restart server)

**Fix:**
```bash
# Trigger resync
POST /api/workspaces/{id}/sync
```

### Issue: Thresholds not applied correctly

**Check:**
```sql
SELECT * FROM forecast_thresholds
WHERE workspace_id = '{id}';
```

**Possible Causes:**
1. Thresholds not seeded (run migration 009)
2. Sync used default thresholds before custom ones set

**Fix:**
```sql
-- Seed missing thresholds
INSERT INTO forecast_thresholds (workspace_id)
SELECT id FROM workspaces
ON CONFLICT DO NOTHING;
```

### Issue: Custom property not detected

**Check HubSpot:**
- Go to HubSpot → Settings → Properties → Deals
- Look for property named `forecast_category` or `hs_forecast_category`
- Check if property is synced to API

**Check Sync Logs:**
```bash
# Look for warnings about missing properties
grep "forecast_category" /var/log/pandora-sync.log
```

---

## Future Enhancements

### 1. Closed Deal Detection
Currently, pipeline/commit/best_case are derived from probability. Could improve:
```typescript
if (isClosedWon) return { category: 'closed', source: 'derived' };
if (isClosedLost) return { category: 'closed', source: 'derived' };
```

### 2. Machine Learning Thresholds
Analyze historical win rates to suggest optimal thresholds:
```sql
-- Find probability threshold where win rate is 90%
SELECT
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY probability)
FROM deals
WHERE stage_normalized = 'closed_won';
```

### 3. Confidence Scoring
Add confidence field based on data source:
```typescript
confidence: source === 'native' ? 1.0 : 0.8  // Native = 100% confident, derived = 80%
```

---

**Status:** ✅ Complete and ready to deploy

**Estimated Total Effort:** 20 minutes (10 min deploy + 5 min backfill + 5 min verify)
