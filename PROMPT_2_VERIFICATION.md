# Prospect Score Consolidation - Prompt 2 Verification

## Implementation Complete

**Status:** ✅ Schema Extension Complete
**Date:** 2026-03-04
**Phase:** Prompt 2 of 4

---

## Files Created

### Migrations (3 files)

1. **`server/migrations/126_prospect_score_columns.sql`**
   - Extends `lead_scores` table with 15 new columns:
     - Component scores: `fit_score`, `engagement_score_component`, `intent_score`, `timing_score`
     - Show-your-math: `score_factors` (JSONB), `score_summary` (TEXT)
     - Segmentation: `segment_id`, `segment_label`, `segment_benchmarks` (JSONB)
     - Actions: `recommended_action`, `top_positive_factor`, `top_negative_factor`
     - Metadata: `score_confidence`, `source_object`
     - Weight tracking: `available_pillars` (TEXT[]), `effective_weights` (JSONB)
   - Creates 3 new indexes:
     - `idx_lead_scores_segment` (for segment queries)
     - `idx_lead_scores_action` (for action recommendations)
     - `idx_lead_scores_components` (for component score queries)

2. **`server/migrations/127_prospect_score_history.sql`**
   - Creates `prospect_score_history` table for time-series tracking
   - Columns: id, workspace_id, entity_type, entity_id, total_score, grade, component scores, segment_id, score_method, scored_at, created_at
   - Creates 3 indexes for efficient querying:
     - `idx_score_history_entity` (entity-based queries)
     - `idx_score_history_workspace_time` (workspace timeline queries)
     - `idx_score_history_workspace_entity` (combined queries)

3. **`server/migrations/128_prospect_tree_models.sql`**
   - Creates `prospect_tree_models` table for Tier 4 recursive tree models (future)
   - Columns: id, workspace_id, tree_json, leaf_count, max_depth, training_deals, outcome_variables, feature_candidates, features_used, build_duration_ms, status, created_at, superseded_at
   - Creates 2 indexes:
     - `idx_tree_models_workspace` (workspace + status)
     - `idx_tree_models_active` (active models only)

### API Routes (1 file)

4. **`server/routes/prospect-scores.ts`**
   - Implements 4 new API endpoints:

   **GET `/:workspaceId/scores/:entityType/:entityId/factors`**
   - Returns score factors JSONB array with full breakdown
   - Response includes: factors[], componentScores, topPositive/NegativeFactor, summary, weights, confidence
   - Purpose: "Show your math" drill-through from UI

   **GET `/:workspaceId/scores/:entityType/:entityId/history`**
   - Returns time-series score history for entity
   - Query params: `?since=ISO_DATE&limit=50` (default limit: 50, max: 200)
   - Purpose: "How has this score changed over time?"

   **GET `/:workspaceId/scores/summary`**
   - Returns workspace-wide scoring statistics
   - Response includes:
     - `totalScored` (count)
     - `gradeDistribution` (A/B/C/D/F counts)
     - `avgScore` (overall average)
     - `pillarAverages` (fit/engagement/intent/timing averages)
     - `scoringMethod` (point_based, etc.)
     - `lastScoredAt` (timestamp)
     - `dataCompleteness` (boolean flags for each pillar)
   - Purpose: Dashboard summary widget

   **GET `/:workspaceId/scores/movers`**
   - Returns prospects with biggest score changes
   - Query params: `?direction=up|down&limit=10&since=ISO_DATE`
   - Sorts by absolute score change
   - Joins with deals/contacts/accounts to include entity names and amounts
   - Purpose: "Who moved this week?" briefing

### Server Integration (1 file modified)

5. **`server/index.ts`**
   - Added import: `import prospectScoresRouter from './routes/prospect-scores.js'`
   - Registered router in workspaceApiRouter: `workspaceApiRouter.use(prospectScoresRouter)`
   - Routes now accessible at: `/api/workspaces/:workspaceId/scores/*`

---

## Verification Checklist

### Schema Changes
- [x] Migration 126 created (lead_scores columns)
- [x] Migration 127 created (prospect_score_history table)
- [x] Migration 128 created (prospect_tree_models table)
- [x] All new columns are nullable (existing data untouched)
- [x] Indexes created for performance

### API Routes
- [x] Factors endpoint created
- [x] History endpoint created
- [x] Summary endpoint created
- [x] Movers endpoint created
- [x] All endpoints handle entityType validation
- [x] All endpoints return proper error codes (400, 404, 500)
- [x] Query parameter limits enforced (max 200 for history/factors, max 50 for movers)

### Integration
- [x] Router imported in server/index.ts
- [x] Router registered in workspaceApiRouter
- [x] Routes follow existing patterns (requireWorkspaceAccess middleware inherited)
- [x] Routes use workspace-scoped paths

---

## Testing Instructions

### 1. Run Migrations

```bash
# In Replit shell or local environment
psql $DATABASE_URL -f server/migrations/126_prospect_score_columns.sql
psql $DATABASE_URL -f server/migrations/127_prospect_score_history.sql
psql $DATABASE_URL -f server/migrations/128_prospect_tree_models.sql
```

### 2. Verify Schema

```sql
-- Check new columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'lead_scores'
  AND column_name IN (
    'fit_score', 'engagement_score_component', 'intent_score', 'timing_score',
    'score_factors', 'score_summary', 'top_positive_factor', 'top_negative_factor',
    'segment_id', 'segment_label', 'segment_benchmarks',
    'recommended_action', 'score_confidence', 'source_object',
    'available_pillars', 'effective_weights'
  )
ORDER BY ordinal_position;

-- Check new tables exist
SELECT COUNT(*) FROM prospect_score_history;  -- should be 0
SELECT COUNT(*) FROM prospect_tree_models;     -- should be 0

-- Verify existing data untouched
SELECT COUNT(*), entity_type, score_grade
FROM lead_scores
GROUP BY entity_type, score_grade;
```

### 3. Test API Endpoints

```bash
# Replace with actual workspace_id, entity_type, entity_id

# Test factors endpoint
curl http://localhost:3000/api/workspaces/{workspace_id}/scores/deal/{deal_id}/factors

# Test history endpoint
curl http://localhost:3000/api/workspaces/{workspace_id}/scores/deal/{deal_id}/history?limit=10

# Test summary endpoint
curl http://localhost:3000/api/workspaces/{workspace_id}/scores/summary

# Test movers endpoint
curl "http://localhost:3000/api/workspaces/{workspace_id}/scores/movers?direction=up&limit=10"
```

### 4. Expected Responses (Pre-Prompt 3)

**Factors endpoint:** Should return 404 or empty factors array (score_factors not yet populated by Prompt 3)

**History endpoint:** Should return empty array (history table empty until Prompt 3)

**Summary endpoint:** Should return current scores with:
- `pillarAverages` all NULL (not yet populated)
- `dataCompleteness` all false (not yet populated)
- `totalScored` matching existing lead_scores count
- `gradeDistribution` matching existing grades

**Movers endpoint:** Should return entities with non-null `score_change` (from existing Lead Scoring v1)

---

## Next Steps

✅ **Prompt 2 Complete:** Schema extension and API routes ready

⏭️ **Prompt 3 (Claude Code, ~1 week):** Factor Emission Refactor
- Define ScoreFactor, PillarResult, ProspectScoreResult types
- Refactor every Lead Scoring dimension to emit factors[]
- Implement pillar aggregation with weight redistribution
- Generate score summaries and top factors
- Compute confidence scores
- Persist new columns and write history
- Compute population benchmarks

⏭️ **Prompt 4 (Split, ~2 days):** Weight Hierarchy + Integration Test
- Create unified weight-loader.ts
- Build end-to-end test script
- Mark deprecated files with deletion dates
- Verify no stranded-pillar penalty

---

## Notes

- All migrations use `IF NOT EXISTS` clauses for safety
- All new columns are nullable to avoid breaking existing queries
- API routes follow existing authentication/authorization patterns
- No UI components created (out of scope for Prompt 2)
- No scorer logic modified (Prompt 3 handles that)
- No webhooks or CRM writeback (post-consolidation feature)

---

**Generated:** 2026-03-04
**Implementation:** Claude Sonnet 4.5
**Project:** Pandora Prospect Score Consolidation
