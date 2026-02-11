-- Forecast Roll-up Skill Assessment Queries
-- Run these manually if you prefer step-by-step execution

-- =============================================================================
-- STEP 1: Get Workspace ID
-- =============================================================================

SELECT id, name
FROM workspaces
WHERE name ILIKE '%frontera%';

-- Copy the workspace ID from above and use it in queries below
-- Replace <WORKSPACE_ID> with actual ID

-- =============================================================================
-- QUERY 1: Category Distribution (Open Deals Only)
-- =============================================================================

SELECT
  forecast_category,
  forecast_category_source,
  COUNT(*) as deal_count,
  COALESCE(SUM(amount), 0) as total_value,
  ROUND(AVG(probability), 3) as avg_probability,
  ROUND(MIN(probability), 3) as min_probability,
  ROUND(MAX(probability), 3) as max_probability
FROM deals
WHERE workspace_id = '<WORKSPACE_ID>'
  AND source = 'hubspot'
  AND stage_normalized NOT IN ('closed_won', 'closed_lost')
GROUP BY forecast_category, forecast_category_source
ORDER BY forecast_category;

-- =============================================================================
-- QUERY 2: Category Distribution (All Deals for Context)
-- =============================================================================

SELECT
  forecast_category,
  forecast_category_source,
  stage_normalized,
  COUNT(*) as deal_count,
  COALESCE(SUM(amount), 0) as total_value
FROM deals
WHERE workspace_id = '<WORKSPACE_ID>'
  AND source = 'hubspot'
GROUP BY forecast_category, forecast_category_source, stage_normalized
ORDER BY forecast_category, stage_normalized;

-- =============================================================================
-- QUERY 3: Quota Status
-- =============================================================================

-- Check if quota periods exist
SELECT
  id,
  name,
  period_type,
  start_date,
  end_date,
  team_quota
FROM quota_periods
WHERE workspace_id = '<WORKSPACE_ID>';

-- Check if rep quotas exist
SELECT
  qp.name as period_name,
  rq.rep_name,
  rq.quota_amount
FROM rep_quotas rq
JOIN quota_periods qp ON qp.id = rq.period_id
WHERE qp.workspace_id = '<WORKSPACE_ID>';

-- =============================================================================
-- QUERY 4: Find Forecast Roll-up Skill Runs
-- =============================================================================

SELECT
  id,
  skill_id,
  status,
  created_at,
  completed_at,
  EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_seconds,
  token_usage
FROM skill_runs
WHERE workspace_id = '<WORKSPACE_ID>'
  AND (skill_id ILIKE '%forecast%' OR skill_id ILIKE '%roll%')
ORDER BY created_at DESC
LIMIT 10;

-- =============================================================================
-- QUERY 5: Get Latest Completed Skill Run (Copy the ID from above)
-- =============================================================================

SELECT
  id,
  skill_id,
  status,
  result,
  output_text,
  created_at,
  completed_at
FROM skill_runs
WHERE id = '<LATEST_RUN_ID>';

-- Alternative: Get latest by query
SELECT
  id,
  skill_id,
  status,
  result,
  output_text,
  created_at,
  completed_at
FROM skill_runs
WHERE workspace_id = '<WORKSPACE_ID>'
  AND (skill_id ILIKE '%forecast%' OR skill_id ILIKE '%roll%')
  AND status = 'completed'
ORDER BY completed_at DESC
LIMIT 1;

-- =============================================================================
-- QUERY 6: Previous Week's Run (for WoW Comparison)
-- =============================================================================

SELECT
  id,
  skill_id,
  status,
  result->>'commit' as previous_commit,
  result->>'bestCase' as previous_best_case,
  result->>'pipeline' as previous_pipeline,
  created_at
FROM skill_runs
WHERE workspace_id = '<WORKSPACE_ID>'
  AND (skill_id ILIKE '%forecast%' OR skill_id ILIKE '%roll%')
  AND status = 'completed'
  AND created_at < NOW() - INTERVAL '6 days'
ORDER BY completed_at DESC
LIMIT 1;

-- =============================================================================
-- QUERY 7: Deal Owner Breakdown
-- =============================================================================

SELECT
  owner,
  COUNT(*) as deal_count,
  COALESCE(SUM(amount), 0) as total_value,
  COUNT(*) FILTER (WHERE forecast_category = 'commit') as commit_count,
  COUNT(*) FILTER (WHERE forecast_category = 'best_case') as best_case_count,
  COUNT(*) FILTER (WHERE forecast_category = 'pipeline') as pipeline_count,
  COUNT(*) FILTER (WHERE forecast_category = 'not_forecasted') as not_forecasted_count
FROM deals
WHERE workspace_id = '<WORKSPACE_ID>'
  AND source = 'hubspot'
  AND stage_normalized NOT IN ('closed_won', 'closed_lost')
GROUP BY owner
ORDER BY total_value DESC;
