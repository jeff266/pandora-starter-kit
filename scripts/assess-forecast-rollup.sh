#!/bin/bash
# Forecast Roll-up Skill Assessment Script
# Run this on Replit where DATABASE_URL is available

echo "=========================================="
echo "FORECAST ROLL-UP SKILL ASSESSMENT"
echo "=========================================="
echo ""

# Get workspace ID
echo "## Step 1: Get Workspace ID"
echo ""
WORKSPACE_ID=$(psql $DATABASE_URL -t -c "SELECT id FROM workspaces WHERE name ILIKE '%frontera%' LIMIT 1;")
WORKSPACE_ID=$(echo $WORKSPACE_ID | xargs)  # Trim whitespace
echo "Workspace ID: $WORKSPACE_ID"
echo ""

# 1. Category Distribution
echo "=========================================="
echo "## 1. CATEGORY DISTRIBUTION"
echo "=========================================="
echo ""
psql $DATABASE_URL -c "
SELECT
  forecast_category,
  forecast_category_source,
  COUNT(*) as deal_count,
  COALESCE(SUM(amount), 0) as total_value,
  ROUND(AVG(probability), 3) as avg_probability,
  ROUND(MIN(probability), 3) as min_probability,
  ROUND(MAX(probability), 3) as max_probability
FROM deals
WHERE workspace_id = '$WORKSPACE_ID'
  AND source = 'hubspot'
  AND stage_normalized NOT IN ('closed_won', 'closed_lost')
GROUP BY forecast_category, forecast_category_source
ORDER BY forecast_category;
"
echo ""

# 2. Quota Status
echo "=========================================="
echo "## 2. QUOTA STATUS"
echo "=========================================="
echo ""
echo "Quota Periods:"
psql $DATABASE_URL -c "SELECT COUNT(*) as period_count FROM quota_periods WHERE workspace_id = '$WORKSPACE_ID';"
echo ""
echo "Rep Quotas:"
psql $DATABASE_URL -c "
SELECT COUNT(*) as rep_quota_count
FROM rep_quotas rq
JOIN quota_periods qp ON qp.id = rq.period_id
WHERE qp.workspace_id = '$WORKSPACE_ID';
"
echo ""

# 3. Find Forecast Roll-up Skill
echo "=========================================="
echo "## 3. FORECAST ROLL-UP SKILL INFO"
echo "=========================================="
echo ""
psql $DATABASE_URL -c "
SELECT
  id,
  skill_id,
  status,
  created_at,
  completed_at,
  EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_seconds
FROM skill_runs
WHERE workspace_id = '$WORKSPACE_ID'
  AND skill_id ILIKE '%forecast%'
ORDER BY created_at DESC
LIMIT 5;
"
echo ""

# 4. Get latest skill run result
echo "=========================================="
echo "## 4. LATEST SKILL RUN RESULT"
echo "=========================================="
echo ""
LATEST_RUN_ID=$(psql $DATABASE_URL -t -c "
SELECT id
FROM skill_runs
WHERE workspace_id = '$WORKSPACE_ID'
  AND skill_id ILIKE '%forecast%'
  AND status = 'completed'
ORDER BY completed_at DESC
LIMIT 1;
")
LATEST_RUN_ID=$(echo $LATEST_RUN_ID | xargs)

if [ -z "$LATEST_RUN_ID" ]; then
  echo "No completed forecast skill runs found."
else
  echo "Latest Run ID: $LATEST_RUN_ID"
  echo ""
  echo "Result JSON:"
  psql $DATABASE_URL -t -c "SELECT result FROM skill_runs WHERE id = '$LATEST_RUN_ID';" | jq '.' 2>/dev/null || psql $DATABASE_URL -t -c "SELECT result FROM skill_runs WHERE id = '$LATEST_RUN_ID';"
  echo ""
  echo "Output Text:"
  psql $DATABASE_URL -t -c "SELECT output_text FROM skill_runs WHERE id = '$LATEST_RUN_ID';"
fi

echo ""
echo "=========================================="
echo "ASSESSMENT COMPLETE"
echo "=========================================="
