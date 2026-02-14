# Workspace Configuration Refactoring Pattern

This document outlines the pattern for refactoring skills to use the workspace configuration loader instead of hardcoded values.

## Completed Refactors

### 1. pipeline-hygiene (via aggregateStaleDeals)
**Before:**
```typescript
const staleDays = params.staleDays || 14;
```

**After:**
```typescript
const staleThreshold = await configLoader.getStaleThreshold(context.workspaceId);
const staleDays = params.staleDays || staleThreshold.warning;
```

### 2. single-thread-alert (via dealThreadingAnalysis)
**Before:**
```typescript
const singleThreaded = deals.filter(d => d.contactCount <= 1);
const doubleThreaded = deals.filter(d => d.contactCount === 2);
const multiThreaded = deals.filter(d => d.contactCount >= 3);
```

**After:**
```typescript
const minContacts = await configLoader.getMinimumContactsPerDeal(workspaceId);
const singleThreaded = deals.filter(d => d.contactCount < minContacts);
const doubleThreaded = deals.filter(d => d.contactCount === minContacts);
const multiThreaded = deals.filter(d => d.contactCount > minContacts);
```

### 3. pipeline-coverage (via coverageByRep)
**Before:**
```typescript
export async function coverageByRep(
  workspaceId: string,
  quarterStart: Date,
  quarterEnd: Date,
  quotas?: { team?: number; byRep?: Record<string, number> },
  coverageTarget: number = 3.0,
  excludedOwners?: string[]
): Promise<CoverageByRep> {
  // ... hardcoded INTERVAL '14 days' in SQL
```

**After:**
```typescript
export async function coverageByRep(
  workspaceId: string,
  quarterStart: Date,
  quarterEnd: Date,
  quotas?: { team?: number; byRep?: Record<string, number> },
  coverageTarget?: number,
  excludedOwners?: string[]
): Promise<CoverageByRep> {
  const configCoverageTarget = coverageTarget ?? await configLoader.getCoverageTarget(workspaceId);
  const staleThreshold = await configLoader.getStaleThreshold(workspaceId);

  // In SQL:
  // WHERE last_activity_date < NOW() - INTERVAL '${staleThreshold.warning} days'
```

## Pattern for Remaining Skills

### General Pattern

1. **Import configLoader** in the compute function file:
   ```typescript
   import { configLoader } from '../config/workspace-config-loader.js';
   ```

2. **Replace hardcoded values** with config loader calls:
   - Stale thresholds: `await configLoader.getStaleThreshold(workspaceId)`
   - Coverage targets: `await configLoader.getCoverageTarget(workspaceId)`
   - Minimum contacts: `await configLoader.getMinimumContactsPerDeal(workspaceId)`
   - Pipeline scope: `await configLoader.getPipelineScopeFilter(workspaceId)`
   - Win rate: `await configLoader.getWinRate(workspaceId, options)`
   - Rep lists: `await configLoader.getReps(workspaceId, role)`
   - Activity weights: `await configLoader.getActivityWeights(workspaceId)`

3. **Update tool wrappers** (in tool-definitions.ts) to remove hardcoded defaults:
   - Replace `|| 14` with `|| await configLoader.getStaleThreshold(context.workspaceId).warning`
   - Replace `?? 3.0` with `?? await configLoader.getCoverageTarget(context.workspaceId)`

## Remaining Skills to Refactor

### Skills Using Stale Thresholds
- **deal-risk-score** - Uses 14/30 day thresholds
- **rep-scorecard** - Uses stale deal metrics
- **velocity-alerts** - Uses expected days in stage

### Skills Using Pipeline Scope
- **forecast-review** - Needs pipeline filtering
- **waterfall-analysis** - Needs pipeline scope
- **win-rate-analysis** - Needs pipeline + win rate config

### Skills Using Win Rate Config
- **win-rate-analysis** - Replace hardcoded won/lost values
- **rep-scorecard** - Replace hardcoded lookback period

### Skills Using Team/Rep Config
- **rep-scorecard** - Replace excluded owners
- **activity-benchmark** - Replace activity weights
- **conversation-coverage** - Replace rep roster

### Skills Using Activity Config
- **activity-benchmark** - Replace hardcoded activity weights
- **engagement-score** - Replace activity weights

### Skills Using Required Fields
- **data-quality-audit** - Replace hardcoded required fields list

### Skills Using Quota/Cadence
- **quota-tracking** - Replace fiscal year logic
- **pipeline-goals** - Replace quota period calculation

## Config Loader Methods Reference

```typescript
// Coverage & Thresholds
await configLoader.getCoverageTarget(workspaceId, pipeline?)
await configLoader.getStaleThreshold(workspaceId, pipeline?)

// Pipeline Scope
await configLoader.getActivePipelines(workspaceId)
await configLoader.getPipelineScopeFilter(workspaceId, pipeline?)

// Win Rate
await configLoader.getWinRate(workspaceId, { pipeline?, period_months? })

// Team & Reps
await configLoader.getReps(workspaceId, role?)
await configLoader.getRepField(workspaceId)

// Activities
await configLoader.getActivityWeights(workspaceId)
await configLoader.getMinimumActivitiesForActive(workspaceId)

// Required Fields
await configLoader.getRequiredFields(workspaceId, object, pipeline?, stage?)

// Threading
await configLoader.getMinimumContactsPerDeal(workspaceId)
await configLoader.getThreadingDistinctRule(workspaceId)

// Quota Period
await configLoader.getQuotaPeriod(workspaceId)
```

## Migration Notes

- All config methods return sensible defaults if no workspace config exists
- Skills degrade gracefully without configuration
- Explicit parameter overrides still work (e.g., passing coverageTarget to a function)
- Cache is per-skill-run to avoid repeated DB queries

## Testing

After refactoring each skill:
1. Run the skill on a workspace with default config
2. Run the skill on a workspace with custom config
3. Verify the skill uses the custom values
4. Verify backward compatibility with existing skill parameters
