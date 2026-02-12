# Deal Stage History Tracking

This guide covers the complete implementation of deal stage history tracking in Pandora, which unlocks Pipeline Waterfall analysis and Rep Scorecard features.

## Overview

Deal stage history tracking captures every stage transition for deals in your CRM, allowing you to:

- Analyze pipeline flow and conversion rates between stages
- Identify bottlenecks where deals get stuck
- Calculate time-in-stage metrics for performance analysis
- Build Rep Scorecards showing stage velocity and conversion rates
- Generate Pipeline Waterfall visualizations

## Architecture

### Two Data Sources

1. **Sync Detection** (`source: 'sync_detection'`)
   - Captures stage changes going forward during incremental syncs
   - Compares incoming deal stages to cached previous stages
   - Records transitions in real-time as they're detected

2. **Historical Backfill** (`source: 'hubspot_history'`)
   - Pulls historical stage changes from HubSpot Property History API
   - One-time backfill for deals created before stage tracking was enabled
   - Uses `propertiesWithHistory=dealstage` parameter

### Database Schema

**`deal_stage_history` table:**
```sql
CREATE TABLE deal_stage_history (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  deal_id UUID NOT NULL,
  deal_source_id TEXT NOT NULL,        -- HubSpot/Salesforce ID
  from_stage TEXT,                     -- NULL for first known stage
  from_stage_normalized TEXT,          -- Normalized category
  to_stage TEXT NOT NULL,              -- Raw stage name
  to_stage_normalized TEXT,            -- Normalized category
  changed_at TIMESTAMPTZ NOT NULL,     -- When transition occurred
  duration_in_previous_stage_ms BIGINT, -- Time spent in from_stage
  source TEXT NOT NULL,                -- 'sync_detection' | 'hubspot_history' | ...
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Cached columns on `deals` table:**
```sql
ALTER TABLE deals ADD COLUMN previous_stage TEXT;
ALTER TABLE deals ADD COLUMN stage_changed_at TIMESTAMPTZ;
```

These cached columns enable fast sync detection without querying `deal_stage_history`.

### Key Indexes

```sql
-- Primary query pattern: all transitions for a deal
CREATE INDEX idx_stage_history_deal ON deal_stage_history(deal_id, changed_at);

-- Waterfall query pattern: workspace-wide transitions in time window
CREATE INDEX idx_stage_history_workspace_time ON deal_stage_history(workspace_id, changed_at);

-- Deduplication: prevent duplicate transitions
CREATE UNIQUE INDEX idx_stage_history_unique_transition
  ON deal_stage_history(deal_id, to_stage, changed_at);
```

## Implementation Components

### 1. Stage Tracker (`server/connectors/hubspot/stage-tracker.ts`)

**Sync detection logic:**
- `detectStageChanges()` - Compares incoming deals to existing deals
- `recordStageChanges()` - Writes transitions to database
- `updateDealStageCache()` - Updates cached columns on deals table

**Integration into sync flow:**
```typescript
// 1. BEFORE upserting deals, detect changes
const stageChanges = await detectStageChanges(workspaceId, incomingDeals);

// 2. Record changes (if any)
if (stageChanges.length > 0) {
  await recordStageChanges(stageChanges, 'sync_detection');
}

// 3. THEN upsert deals
await upsertDeals(deals);

// 4. AFTER upsert, update cache
if (stageChanges.length > 0) {
  await updateDealStageCache(stageChanges);
}
```

### 2. Historical Backfill (`server/connectors/hubspot/stage-history-backfill.ts`)

**Key functions:**
- `backfillStageHistory(workspaceId, accessToken)` - Main backfill orchestrator
- `getBackfillStats(workspaceId)` - Returns backfill progress statistics

**How it works:**
1. Finds deals without `hubspot_history` source records
2. Batches requests (10 concurrent) to respect API rate limits
3. Fetches from HubSpot Property History API:
   ```
   GET /crm/v3/objects/deals/:dealId?propertiesWithHistory=dealstage
   ```
4. Parses chronological stage transitions
5. Records to database with `source: 'hubspot_history'`

**Stage normalization:**
Maps raw HubSpot stage names to normalized categories:
- `closed_won` - Deal won
- `closed_lost` - Deal lost
- `negotiation` - Contract/negotiation phase
- `proposal` - Proposal/quote sent
- `demo` - Demo/presentation scheduled
- `qualification` - Discovery/qualification
- `pipeline` - Default/other stages

### 3. API Routes (`server/routes/stage-history.ts`)

#### POST `/api/workspaces/:workspaceId/connectors/hubspot/backfill-stage-history`

Triggers historical backfill for a workspace.

**Response (202 Accepted):**
```json
{
  "status": "started",
  "dealsToProcess": 150,
  "message": "Backfill started in background"
}
```

**Background execution:**
- Returns immediately with 202 status
- Runs backfill asynchronously (non-blocking)
- Logs progress and completion to console

#### GET `/api/workspaces/:workspaceId/stage-history/stats`

Returns backfill and usage statistics.

**Response:**
```json
{
  "totalTransitions": 1247,
  "dealsWithHistory": 150,
  "dealsWithoutHistory": 0,
  "oldestTransition": "2023-01-15T10:30:00Z",
  "newestTransition": "2024-02-10T14:22:00Z",
  "sourceBreakdown": {
    "sync_detection": 85,
    "hubspot_history": 1162
  }
}
```

#### GET `/api/workspaces/:workspaceId/deals/:dealId/stage-history`

Returns complete stage journey for a specific deal.

**Response:**
```json
{
  "deal": {
    "id": "uuid",
    "name": "Acme Corp - Enterprise Plan"
  },
  "history": [
    {
      "from_stage": null,
      "to_stage": "appointmentscheduled",
      "to_stage_normalized": "qualification",
      "changed_at": "2024-01-10T09:00:00Z",
      "duration_in_previous_stage_ms": null,
      "source": "hubspot_history"
    },
    {
      "from_stage": "appointmentscheduled",
      "to_stage": "qualifiedtobuy",
      "to_stage_normalized": "qualification",
      "changed_at": "2024-01-15T14:30:00Z",
      "duration_in_previous_stage_ms": 453600000,
      "duration_days": 5.2,
      "source": "hubspot_history"
    }
  ],
  "totalTransitions": 8
}
```

### 4. Query Functions (`server/analysis/stage-history-queries.ts`)

High-level queries for skills and analytics:

- `getDealStageHistory(workspaceId, dealId)` - Complete journey for one deal
- `getStageTransitionsInWindow(workspaceId, startDate, endDate)` - All transitions in time range
- `getStageConversionRates(workspaceId)` - Conversion rates between stages
- `getRepStageMetrics(workspaceId)` - Stage performance by rep
- `getStalledDeals(workspaceId, stage, daysThreshold)` - Deals stuck in a stage
- `getAverageTimeInStage(workspaceId)` - Average duration per stage

**Example: Get conversion rates**
```typescript
import { getStageConversionRates } from './server/analysis/stage-history-queries.js';

const rates = await getStageConversionRates(workspaceId);
// [
//   {
//     from_stage_normalized: 'qualification',
//     to_stage_normalized: 'demo',
//     transition_count: 45,
//     avg_duration_days: 7.2
//   },
//   ...
// ]
```

### 5. Computed Fields (`server/computed-fields/temporal-fields.ts`)

Updated `computed_days_in_stage` to use real stage history:

```typescript
CASE
  WHEN stage_changed_at IS NOT NULL
  THEN FLOOR(EXTRACT(EPOCH FROM (NOW() - stage_changed_at)) / 86400)::integer
  ELSE NULL
END AS computed_days_in_stage
```

This replaces the placeholder logic with accurate calculations based on `deals.stage_changed_at`.

## Usage Guide

### Running the Backfill

**Via API:**
```bash
curl -X POST http://localhost:3000/api/workspaces/{workspace_id}/connectors/hubspot/backfill-stage-history
```

**Via script:**
```bash
npm run backfill-stage-history <workspace_id>
```

The script shows:
- Pre-backfill statistics
- Progress updates every 50 deals
- Final results with error summary
- Post-backfill statistics

**Expected output:**
```
[Backfill] Starting stage history backfill for workspace abc-123

[Backfill] Pre-backfill statistics:
  Total transitions: 0
  Deals with history: 0
  Deals without history: 150

[Backfill] Starting backfill process...
[Stage Backfill] Processing 150 deals for workspace abc-123
[Stage Backfill] Progress: 50/150 deals
[Stage Backfill] Progress: 100/150 deals
[Stage Backfill] Progress: 150/150 deals
[Stage Backfill] Complete: 150 deals, 1247 transitions, 0 errors

[Backfill] Backfill complete!
  Deals processed: 150
  Transitions recorded: 1247
  Errors: 0

[Backfill] Post-backfill statistics:
  Total transitions: 1247
  Deals with history: 150
  Deals without history: 0
  Oldest transition: 2023-01-15T10:30:00.000Z
  Newest transition: 2024-02-10T14:22:00.000Z
```

### Querying Stage History

**In skills:**
```typescript
import { getDealStageHistory } from '../server/analysis/stage-history-queries.js';

const journey = await getDealStageHistory(workspaceId, dealId);

if (journey) {
  console.log(`${journey.deal_name} has ${journey.total_transitions} stage changes`);
  console.log(`Currently in ${journey.current_stage} for ${journey.days_in_current_stage} days`);

  journey.transitions.forEach(t => {
    console.log(`  ${t.changed_at}: ${t.from_stage} → ${t.to_stage} (${t.duration_days} days)`);
  });
}
```

**Finding stalled deals:**
```typescript
import { getStalledDeals } from '../server/analysis/stage-history-queries.js';

const stalled = await getStalledDeals(workspaceId, 'demo', 14);
// Returns deals in 'demo' stage for more than 14 days
```

## Skill Integration Examples

### Pipeline Hygiene

```typescript
import { getStalledDeals, getAverageTimeInStage } from '../server/analysis/stage-history-queries.js';

// Get average time-in-stage benchmarks
const avgTimes = await getAverageTimeInStage(workspaceId);
const demoAvg = avgTimes.find(s => s.stage_normalized === 'demo')?.avg_duration_days || 7;

// Find deals that exceed 2x the average
const stalledDeals = await getStalledDeals(workspaceId, 'demo', demoAvg * 2);

if (stalledDeals.length > 0) {
  // Flag in Slack or create alert
}
```

### Rep Scorecard

```typescript
import { getRepStageMetrics } from '../server/analysis/stage-history-queries.js';

// Get stage velocity metrics per rep
const metrics = await getRepStageMetrics(workspaceId);

// Build scorecard comparing reps
const scorecard = metrics
  .filter(m => m.stage_normalized === 'demo')
  .map(m => ({
    rep: m.rep_name,
    avgDays: m.avg_duration_days,
    dealCount: m.deals_entered,
    velocity: m.deals_entered / m.avg_duration_days // deals per day
  }))
  .sort((a, b) => b.velocity - a.velocity);
```

### Pipeline Waterfall

```typescript
import { getStageTransitionsInWindow } from '../server/analysis/stage-history-queries.js';

// Get all transitions in Q1 2024
const startDate = new Date('2024-01-01');
const endDate = new Date('2024-03-31');
const transitions = await getStageTransitionsInWindow(workspaceId, startDate, endDate);

// Build waterfall showing stage progression
const waterfall = transitions.reduce((acc, t) => {
  const key = `${t.from_stage_normalized} → ${t.to_stage_normalized}`;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
```

## Monitoring and Troubleshooting

### Check backfill status

```bash
curl http://localhost:3000/api/workspaces/{workspace_id}/stage-history/stats
```

Look for:
- `dealsWithoutHistory: 0` - All deals backfilled
- `sourceBreakdown` - Mix of sync_detection and hubspot_history

### Common issues

**"Deals without history" not decreasing:**
- Check HubSpot access token is valid
- Verify deals have `dealstage` property in HubSpot
- Check server logs for API errors

**Duplicate transitions:**
- The unique index prevents duplicates automatically
- `ON CONFLICT DO NOTHING` silently skips duplicates

**Missing stage changes:**
- Ensure sync detection runs BEFORE deal upsert
- Check that `updateDealStageCache()` is called after upsert
- Verify `stage_changed_at` column is populated

### Database queries

**Count transitions per source:**
```sql
SELECT source, COUNT(*)
FROM deal_stage_history
WHERE workspace_id = 'workspace-id'
GROUP BY source;
```

**Find deals with most transitions:**
```sql
SELECT d.name, COUNT(*) as transition_count
FROM deal_stage_history dsh
JOIN deals d ON d.id = dsh.deal_id
WHERE dsh.workspace_id = 'workspace-id'
GROUP BY d.id, d.name
ORDER BY transition_count DESC
LIMIT 10;
```

**Check for deals missing history:**
```sql
SELECT COUNT(*)
FROM deals d
WHERE d.workspace_id = 'workspace-id'
  AND d.source = 'hubspot'
  AND NOT EXISTS (
    SELECT 1 FROM deal_stage_history dsh
    WHERE dsh.deal_id = d.id AND dsh.source = 'hubspot_history'
  );
```

## Future Enhancements

### Salesforce Support

Add Salesforce Field History tracking:

1. Create `server/connectors/salesforce/stage-history-backfill.ts`
2. Query Salesforce Field History API for `StageName` field
3. Record with `source: 'salesforce_history'`
4. Add sync detection to Salesforce connector

### Stage Analytics Dashboard

Build dedicated UI showing:
- Pipeline waterfall visualization
- Stage conversion funnel
- Time-in-stage distributions
- Rep leaderboards

### Predictive Analytics

Use stage history to:
- Predict deal close probability based on stage progression patterns
- Identify at-risk deals with abnormal stage durations
- Recommend next actions based on historical conversion rates

## Migration

The migration is in `migrations/015_deal_stage_history.sql`.

**To apply:**
```bash
npm run migrate
```

**To rollback (if needed):**
```sql
DROP TABLE IF EXISTS deal_stage_history CASCADE;
ALTER TABLE deals DROP COLUMN IF EXISTS previous_stage;
ALTER TABLE deals DROP COLUMN IF EXISTS stage_changed_at;
```

## Summary

Deal stage history tracking provides the foundation for advanced pipeline analytics. The two-pronged approach (sync detection + historical backfill) ensures complete coverage:

- **Going forward:** Sync detection captures changes in real-time
- **Looking back:** Historical backfill populates past transitions

This unlocks Pipeline Waterfall, Rep Scorecard, and other velocity-based insights that drive GTM intelligence.
