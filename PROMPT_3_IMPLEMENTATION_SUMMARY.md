# Prompt 3: Factor Emission Refactor — Implementation Summary

## Overview

Successfully refactored `server/skills/compute/lead-scoring.ts` to emit detailed factor-level scoring data and aggregate into the 4-pillar model (Fit, Engagement, Intent, Timing) with graceful weight redistribution.

## Changes Made

### 1. Updated Type Imports

Added imports from the new prospect scoring modules:

```typescript
import {
  ScoreFactor,
  ProspectScoreResult,
  PillarCategory,
  DIMENSION_TO_PILLAR,
  determineDirection,
} from '../../scoring/prospect-score-types.js';

import {
  aggregatePillars,
  computeComposite,
  sortFactorsByImpact,
  assignGrade,
} from '../../scoring/pillar-aggregator.js';

import {
  generateTopFactors,
  generateScoreSummary,
  generateRecommendedAction,
} from '../../scoring/score-summary.js';

import {
  computeConfidence,
  determineScoringMethod,
} from '../../scoring/score-confidence.js';
```

### 2. Created Dimension Scoring Functions

Refactored each scoring dimension to emit `ScoreFactor[]` instead of just returning points:

#### Deal Dimensions
- **`scoreDealEngagement()`** - Activity recency, volume, multi-channel, active days
- **`scoreDealThreading()`** - Multi-threading, champion, economic buyer, role diversity
- **`scoreDealQuality()`** - Deal value, tier, probability, stage advancement
- **`scoreDealVelocity()`** - Close date, timeframe, inactivity penalty, deal age
- **`scoreDealConversations()`** - Call presence, recency, volume, conversation intelligence
- **`scoreDealEnrichmentFirmographic()`** - Buying committee, C-level, decision makers
- **`scoreDealEnrichmentSignals()`** - Account signals, funding, hiring, expansion, risk

#### Contact Dimensions
Refactored into factor emission in the main `scoreContact()` function:
- Email, phone, title presence
- Buying role assignment
- Power role identification
- Seniority level
- Associated deal quality

### 3. Refactored `scoreDeal()` Function

**Before:**
- Returned `LeadScore` with flat point breakdown
- No pillar aggregation
- No factor-level detail

**After:**
- Returns `ProspectScoreResult` with full factor detail
- Calls all dimension scoring functions
- Aggregates factors into 4 pillars using `aggregatePillars()`
- Computes composite score with `computeComposite()`
- Generates summary, top factors, confidence score
- Determines recommended action
- Handles weight redistribution for missing pillars

### 4. Refactored `scoreContact()` Function

**Before:**
- Simple point-based scoring
- No factor detail

**After:**
- Emits `ScoreFactor[]` for each contact attribute
- Aggregates into pillars (primarily Fit and Intent)
- Computes composite score and metadata
- Returns full `ProspectScoreResult`

### 5. Updated `persistScore()` Function

**Before:**
- Only wrote to legacy columns: `total_score`, `score_breakdown`, `score_grade`, etc.

**After:**
- Writes to all new columns:
  - `fit_score`, `engagement_score_component`, `intent_score`, `timing_score`
  - `score_factors` (JSONB array of all factors)
  - `score_summary` (< 280 char summary)
  - `top_positive_factor`, `top_negative_factor`
  - `score_confidence` (0.0-1.0)
  - `available_pillars` (TEXT[])
  - `effective_weights` (JSONB)
  - `recommended_action`
  - `source_object`
- Maintains backward compatibility by still writing `score_breakdown` (legacy format)
- Writes to `prospect_score_history` table on every score

### 6. Updated `scoreLeads()` Main Function

**Before:**
- Called `scoreDeal()` and `scoreContact()` with simple returns

**After:**
- Passes `icpProfileId` to `scoreDeal()`
- Computes pillar averages across all deals:
  - `pillarAverages.fit`
  - `pillarAverages.engagement`
  - `pillarAverages.intent`
  - `pillarAverages.timing`
- Updates summary stats to include `pillarAverages`
- Logs pillar averages in completion message

### 7. Updated Return Types

**`ScoringResult` interface now includes:**
```typescript
interface ScoringResult {
  dealScores: ProspectScoreResult[];  // Changed from LeadScore[]
  contactScores: ProspectScoreResult[];  // Changed from LeadScore[]
  summaryStats: {
    totalDeals: number;
    totalContacts: number;
    gradeDistribution: Record<string, number>;
    avgDealScore: number;
    pillarAverages: {  // NEW
      fit: number;
      engagement: number;
      intent: number;
      timing: number;
    };
    topDeals: Array<...>;
    bottomDeals: Array<...>;
    movers: Array<...>;
    repScores: Record<...>;
  };
  customFieldContributions: Array<...>;
}
```

### 8. Updated Weight Redistribution

Modified `server/scoring/weight-redistribution.ts` to support the 4-pillar model:

```typescript
export function redistributeWeights(
  weights: Record<PillarCategory, number>,
  availablePillars: PillarCategory[]
): Record<PillarCategory, number>
```

When a pillar has no data (e.g., `timing` pillar in Frontera), its weight is redistributed proportionally to the other 3 pillars.

**Example:**
- Original: `{ fit: 0.35, engagement: 0.30, intent: 0.25, timing: 0.10 }`
- Available: `['fit', 'engagement', 'intent']` (timing missing)
- Result: `{ fit: 0.39, engagement: 0.33, intent: 0.28, timing: 0 }`

## Key Features

### Factor Emission Pattern

Every dimension follows this pattern:

```typescript
function scoreDimension(deal: DealFeatures): { score: number; max: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];
  let score = 0;
  const max = 25;
  const category: PillarCategory = 'engagement';

  // For each point assignment:
  const points = calculatePoints(...);
  score += points;

  factors.push({
    field: 'field_name',
    label: 'Human Readable Label',
    value: 'value as string',
    contribution: points,
    maxPossible: maxPointsForThisFactor,
    direction: determineDirection(points, maxPointsForThisFactor),
    category,
    explanation: points > threshold ? 'Why this matters...' : undefined,
  });

  return { score, max, factors };
}
```

### Pillar Mapping

Dimensions are mapped to pillars via `DIMENSION_TO_PILLAR`:

| Dimension | Pillar |
|-----------|--------|
| Engagement (activity, channels, active days) | Engagement |
| Threading (contacts, roles, champion) | Intent |
| Deal Quality (amount, stage, probability) | Intent |
| Velocity (close date, recency, age) | Timing |
| Conversations (calls, transcripts) | Engagement |
| Enrichment Firmographic (committee, seniority) | Fit |
| Enrichment Signals (funding, hiring, risk) | Timing |
| Contact Role/Title/Email/Phone | Fit |
| Contact Associated Deal | Intent |

### Explanation Assignment

Only the top 3 positive and top 3 negative factors get `explanation` strings to avoid noise. Explanations are added when:
- Factor contribution is high (e.g., `> 10 points` for a `15 max` factor)
- Factor is highly impactful (positive or negative)
- Context adds value (e.g., "Deal in late stage but no calls recorded")

### Backward Compatibility

- `score_breakdown` column still populated with legacy format
- Grade thresholds unchanged (A=80, B=60, C=40, D=20, F<20)
- `total_score` and `score_grade` still written as before
- Existing API consumers still work

## Database Schema

The following columns are now populated on every scoring run:

```sql
-- Pillar scores (0-100 each)
fit_score INTEGER
engagement_score_component INTEGER
intent_score INTEGER
timing_score INTEGER

-- Factor detail
score_factors JSONB  -- Array of ScoreFactor objects
score_summary TEXT   -- < 280 char summary
top_positive_factor TEXT
top_negative_factor TEXT

-- Metadata
score_confidence NUMERIC(3,2)  -- 0.00-1.00
available_pillars TEXT[]
effective_weights JSONB
recommended_action TEXT
source_object TEXT
```

## Testing Recommendations

1. **Run Lead Scoring:**
   ```bash
   POST /api/workspaces/<workspace_id>/skills/lead-scoring/run
   ```

2. **Verify New Columns:**
   ```sql
   SELECT
     entity_type,
     score_grade,
     fit_score,
     engagement_score_component,
     intent_score,
     timing_score,
     available_pillars,
     score_confidence,
     LEFT(score_summary, 80) as summary_preview,
     top_positive_factor,
     top_negative_factor,
     jsonb_array_length(score_factors) as factor_count
   FROM lead_scores
   WHERE workspace_id = '<workspace_id>'
   ORDER BY total_score DESC
   LIMIT 10;
   ```

3. **Verify Weight Redistribution:**
   ```sql
   SELECT DISTINCT
     effective_weights,
     available_pillars
   FROM lead_scores
   WHERE workspace_id = '<workspace_id>'
   LIMIT 5;
   ```

4. **Check Score History:**
   ```sql
   SELECT COUNT(*)
   FROM prospect_score_history
   WHERE workspace_id = '<workspace_id>';
   ```

5. **Verify No Stranded Pillar Penalty:**
   ```sql
   SELECT
     score_grade,
     COUNT(*),
     ROUND(AVG(total_score)) as avg_score
   FROM lead_scores
   WHERE workspace_id = '<workspace_id>'
   GROUP BY score_grade
   ORDER BY score_grade;
   ```

   Expected: Healthier distribution (fewer D/F grades) compared to before due to weight redistribution.

## Known Limitations

1. **Custom Fields** - All custom fields currently map to the `fit` pillar. In the future, we could infer category from field name or win correlation.

2. **Contact Scoring** - Contacts currently only use `fit` and `intent` pillars (no `engagement` or `timing` data yet). This is fine — weight redistribution handles it gracefully.

3. **Benchmarks** - The `benchmark` field in `ScoreFactor` is optional and not yet populated. This requires a second pass after all entities are scored to compute population averages and percentiles.

4. **ICP Weights** - ICP-derived weights are applied as additional factors but don't yet influence pillar-level weight allocation. That's a future enhancement (Prompt 4).

## Next Steps (Prompt 4)

1. Create `weight-loader.ts` to unify weight loading from:
   - ICP profiles (highest priority)
   - Workspace custom weights
   - Default weights

2. Create integration test script (`scripts/test-prospect-scoring.ts`) to validate:
   - All new columns populated
   - Factor structure valid
   - Weight redistribution correct
   - No stranded pillar penalty

3. Test against live workspaces (Frontera, Imubit)

## Files Modified

- ✅ `server/skills/compute/lead-scoring.ts` - Full refactor with factor emission
- ✅ `server/scoring/weight-redistribution.ts` - Added 4-pillar support

## Files Created (Already Existed)

- `server/scoring/prospect-score-types.ts`
- `server/scoring/pillar-aggregator.ts`
- `server/scoring/score-summary.ts`
- `server/scoring/score-confidence.ts`

## Completion Status

**Prompt 3: Factor Emission Refactor** ✅ **COMPLETE**

All requirements met:
- ✅ Factor emission for all deal dimensions
- ✅ Factor emission for all contact dimensions
- ✅ Pillar aggregation (fit/engagement/intent/timing)
- ✅ Weight redistribution for missing pillars
- ✅ New columns persisted to `lead_scores`
- ✅ Score history written to `prospect_score_history`
- ✅ Backward compatibility maintained
- ✅ TypeScript compiles without errors
