#!/bin/bash
# Test Skill Scheduler
# Tests the run-all endpoint and verifies skill scheduling

set -e

echo "===================================="
echo "Skill Scheduler Test"
echo "===================================="
echo ""

# Get Frontera workspace
WORKSPACE_ID=$(psql $DATABASE_URL -t -c "SELECT id FROM workspaces WHERE name ILIKE '%frontera%' LIMIT 1;" | xargs)

if [ -z "$WORKSPACE_ID" ]; then
  echo "❌ No Frontera workspace found"
  exit 1
fi

echo "✓ Found workspace: $WORKSPACE_ID"
echo ""

# Check server logs for scheduler startup
echo "===================================="
echo "Checking Server Logs"
echo "===================================="
pm2 logs --nostream --lines 50 | grep -i "skill scheduler" || echo "No scheduler logs found"
echo ""

# Test run-all endpoint
echo "===================================="
echo "Testing Run-All Endpoint"
echo "===================================="
echo ""
echo "Running all scheduled skills for workspace..."
echo ""

RESPONSE=$(curl -s -X POST "http://localhost:3000/api/workspaces/$WORKSPACE_ID/skills/run-all" \
  -H "Content-Type: application/json" \
  -d '{}')

echo "$RESPONSE" | jq '.'

SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
TOTAL=$(echo "$RESPONSE" | jq -r '.summary.total')
SUCCESSFUL=$(echo "$RESPONSE" | jq -r '.summary.successful')
FAILED=$(echo "$RESPONSE" | jq -r '.summary.failed')

if [ "$SUCCESS" == "true" ]; then
  echo ""
  echo "✓ Run-all completed successfully"
  echo "  Total: $TOTAL"
  echo "  Successful: $SUCCESSFUL"
  echo "  Failed: $FAILED"
else
  echo ""
  echo "❌ Run-all failed"
  exit 1
fi

echo ""
echo "===================================="
echo "Verifying Skill Runs in Database"
echo "===================================="
echo ""

psql $DATABASE_URL -c "
  SELECT
    skill_id,
    status,
    trigger_type,
    duration_ms,
    DATE_TRUNC('second', created_at) as created_at
  FROM skill_runs
  WHERE workspace_id = '$WORKSPACE_ID'
    AND trigger_type = 'manual_batch'
  ORDER BY created_at DESC
  LIMIT 10;
"

echo ""
echo "===================================="
echo "Skill Runs by Trigger Type"
echo "===================================="
echo ""

psql $DATABASE_URL -c "
  SELECT
    trigger_type,
    COUNT(*) as run_count,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
  FROM skill_runs
  WHERE workspace_id = '$WORKSPACE_ID'
  GROUP BY trigger_type
  ORDER BY trigger_type;
"

echo ""
echo "===================================="
echo "✓ Test Complete"
echo "===================================="
echo ""
echo "Next: Check Monday 8 AM UTC for automatic execution"
echo "  - All 5 skills should run automatically"
echo "  - trigger_type will be 'scheduled'"
echo "  - 30-second stagger between skills"
echo ""
