#!/bin/bash
# Test script for Forecast Roll-up Skill on Replit
# Run this on Replit after pulling latest code

set -e  # Exit on error

echo "=================================="
echo "Forecast Roll-up Deployment Test"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Pull latest code
echo -e "${YELLOW}[Step 1/8] Pulling latest code...${NC}"
git pull origin main
echo -e "${GREEN}✓ Code updated${NC}"
echo ""

# Step 2: Run quota migrations
echo -e "${YELLOW}[Step 2/8] Running quota migrations...${NC}"
psql $DATABASE_URL -f migrations/010_quota_periods.sql
psql $DATABASE_URL -f migrations/011_rep_quotas.sql
echo -e "${GREEN}✓ Migrations complete${NC}"
echo ""

# Step 3: Verify tables exist
echo -e "${YELLOW}[Step 3/8] Verifying quota tables...${NC}"
QUOTA_PERIODS=$(psql $DATABASE_URL -t -c "SELECT COUNT(*) FROM quota_periods;" | xargs)
REP_QUOTAS=$(psql $DATABASE_URL -t -c "SELECT COUNT(*) FROM rep_quotas;" | xargs)
echo "  quota_periods: $QUOTA_PERIODS rows"
echo "  rep_quotas: $REP_QUOTAS rows"
echo -e "${GREEN}✓ Tables verified${NC}"
echo ""

# Step 4: Get workspace ID
echo -e "${YELLOW}[Step 4/8] Finding workspace...${NC}"
WORKSPACE_ID=$(psql $DATABASE_URL -t -c "SELECT id FROM workspaces WHERE name ILIKE '%frontera%' LIMIT 1;" | xargs)
if [ -z "$WORKSPACE_ID" ]; then
  echo -e "${RED}✗ No workspace found${NC}"
  exit 1
fi
echo "  Workspace ID: $WORKSPACE_ID"
echo -e "${GREEN}✓ Workspace found${NC}"
echo ""

# Step 5: Seed quota data (optional but recommended)
echo -e "${YELLOW}[Step 5/8] Seeding quota data...${NC}"
read -p "Do you want to seed Q1 2026 quota data? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  # Create Q1 2026 quota period
  PERIOD_ID=$(psql $DATABASE_URL -t -c "
    INSERT INTO quota_periods (workspace_id, name, period_type, start_date, end_date, team_quota)
    VALUES ('$WORKSPACE_ID', 'Q1 2026', 'quarterly', '2026-01-01', '2026-03-31', 1000000)
    ON CONFLICT (workspace_id, start_date, period_type) DO UPDATE SET team_quota = 1000000
    RETURNING id;
  " | tail -1 | xargs)

  echo "  Created period: $PERIOD_ID"

  # Get top reps and insert quotas
  echo "  Top reps by deal count:"
  psql $DATABASE_URL -c "
    SELECT DISTINCT owner, COUNT(*) as deal_count
    FROM deals
    WHERE workspace_id = '$WORKSPACE_ID'
      AND source = 'hubspot'
      AND stage_normalized NOT IN ('closed_lost', 'closed_won')
    GROUP BY owner
    ORDER BY deal_count DESC
    LIMIT 5;
  "

  echo ""
  echo "  Inserting rep quotas (150K each for top 3 reps)..."
  psql $DATABASE_URL -c "
    INSERT INTO rep_quotas (period_id, rep_name, quota_amount)
    SELECT '$PERIOD_ID', owner, 150000
    FROM (
      SELECT DISTINCT owner
      FROM deals
      WHERE workspace_id = '$WORKSPACE_ID'
        AND source = 'hubspot'
        AND stage_normalized NOT IN ('closed_lost', 'closed_won')
        AND owner IS NOT NULL
      ORDER BY owner
      LIMIT 3
    ) t
    ON CONFLICT (period_id, rep_name) DO UPDATE SET quota_amount = 150000;
  "
  echo -e "${GREEN}✓ Quota data seeded${NC}"
else
  echo -e "${YELLOW}⊘ Skipped quota seeding (skill will work but show no attainment %)${NC}"
fi
echo ""

# Step 6: Restart server
echo -e "${YELLOW}[Step 6/8] Restarting server...${NC}"
pm2 restart all
sleep 3
echo -e "${GREEN}✓ Server restarted${NC}"
echo ""

# Step 7: Verify skill is registered
echo -e "${YELLOW}[Step 7/8] Verifying skill registration...${NC}"
SKILL_CHECK=$(curl -s http://localhost:3000/api/skills | jq '.[] | select(.id == "forecast-rollup")')
if [ -z "$SKILL_CHECK" ]; then
  echo -e "${RED}✗ Forecast-rollup skill not found${NC}"
  echo "Available skills:"
  curl -s http://localhost:3000/api/skills | jq '.[].id'
  exit 1
fi
echo "  Skill definition:"
echo "$SKILL_CHECK" | jq '{id, name, description, steps: (.steps | length)}'
echo -e "${GREEN}✓ Skill registered${NC}"
echo ""

# Step 8: Run the skill
echo -e "${YELLOW}[Step 8/8] Running forecast-rollup skill...${NC}"
RUN_RESPONSE=$(curl -s -X POST http://localhost:3000/api/skills/forecast-rollup/run \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}")

JOB_ID=$(echo "$RUN_RESPONSE" | jq -r '.jobId')
STATUS=$(echo "$RUN_RESPONSE" | jq -r '.status')

if [ -z "$JOB_ID" ] || [ "$JOB_ID" == "null" ]; then
  echo -e "${RED}✗ Failed to start skill${NC}"
  echo "$RUN_RESPONSE" | jq '.'
  exit 1
fi

echo "  Job ID: $JOB_ID"
echo "  Status: $STATUS"
echo ""

# Wait for completion
echo "  Waiting for skill to complete..."
for i in {1..60}; do
  sleep 2
  SKILL_RUN=$(psql $DATABASE_URL -t -c "
    SELECT status FROM skill_runs WHERE id = '$JOB_ID';
  " | xargs)

  if [ "$SKILL_RUN" == "completed" ]; then
    echo -e "${GREEN}✓ Skill completed successfully${NC}"
    break
  elif [ "$SKILL_RUN" == "failed" ]; then
    echo -e "${RED}✗ Skill failed${NC}"
    break
  fi

  echo -n "."
done
echo ""
echo ""

# Step 9: Show results
echo "=================================="
echo "Results"
echo "=================================="
echo ""

echo -e "${YELLOW}Skill Run Summary:${NC}"
psql $DATABASE_URL -c "
  SELECT
    id,
    skill_id,
    status,
    EXTRACT(EPOCH FROM (completed_at - created_at))::INTEGER as duration_seconds,
    created_at,
    completed_at
  FROM skill_runs
  WHERE id = '$JOB_ID';
"
echo ""

echo -e "${YELLOW}Forecast Data (JSON Result):${NC}"
psql $DATABASE_URL -c "
  SELECT result
  FROM skill_runs
  WHERE id = '$JOB_ID';
" | head -20
echo ""

echo -e "${YELLOW}Narrative Output (first 500 chars):${NC}"
psql $DATABASE_URL -t -c "
  SELECT LEFT(output_text, 500)
  FROM skill_runs
  WHERE id = '$JOB_ID';
"
echo ""
echo ""

# Show assessment summary
echo "=================================="
echo "Quick Assessment"
echo "=================================="
echo ""

echo -e "${YELLOW}Category Distribution:${NC}"
psql $DATABASE_URL -c "
  SELECT
    forecast_category,
    COUNT(*) as deal_count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percent,
    TO_CHAR(SUM(amount), '999,999,999') as total_amount
  FROM deals
  WHERE workspace_id = '$WORKSPACE_ID'
    AND source = 'hubspot'
    AND stage_normalized NOT IN ('closed_lost')
  GROUP BY forecast_category
  ORDER BY COUNT(*) DESC;
"
echo ""

echo -e "${YELLOW}Forecast Category Source:${NC}"
psql $DATABASE_URL -c "
  SELECT
    forecast_category_source,
    COUNT(*) as deals
  FROM deals
  WHERE workspace_id = '$WORKSPACE_ID'
    AND source = 'hubspot'
    AND stage_normalized NOT IN ('closed_lost')
    AND forecast_category IS NOT NULL
  GROUP BY forecast_category_source;
"
echo ""

echo "=================================="
echo -e "${GREEN}✓ Deployment test complete!${NC}"
echo "=================================="
echo ""
echo "Next steps:"
echo "  1. Review the narrative output above"
echo "  2. Check category distribution (should not be 90%+ in one bucket)"
echo "  3. Run full assessment: ./scripts/assess-forecast-rollup.sh"
echo "  4. Tune thresholds if needed: PUT /api/workspaces/$WORKSPACE_ID/forecast-thresholds"
echo ""
