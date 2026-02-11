#!/bin/bash
# Setup Q1 2026 Quotas for Frontera Health
# Sara: $800K | Nate: $1M | Carter: $500K | Jack: $500K
# Team total: $2.8M

set -e

WORKSPACE_ID="4160191d-73bc-414b-97dd-5a1853190378"

echo "=================================="
echo "Setting up Q1 2026 Quotas"
echo "=================================="
echo ""

# Create or update Q1 2026 quota period
echo "Creating Q1 2026 quota period (team quota: $2,800,000)..."
PERIOD_ID=$(psql $DATABASE_URL -t -c "
  INSERT INTO quota_periods (workspace_id, name, period_type, start_date, end_date, team_quota)
  VALUES ('$WORKSPACE_ID', 'Q1 2026', 'quarterly', '2026-01-01', '2026-03-31', 2800000)
  ON CONFLICT (workspace_id, start_date, period_type)
  DO UPDATE SET team_quota = 2800000
  RETURNING id;
" | tail -1 | xargs)

echo "✓ Period ID: $PERIOD_ID"
echo ""

# Insert rep quotas
echo "Setting individual rep quotas..."
psql $DATABASE_URL -c "
  INSERT INTO rep_quotas (period_id, rep_name, quota_amount)
  VALUES
    ('$PERIOD_ID', 'Nate Phillips', 1000000),
    ('$PERIOD_ID', 'Sara Bollman', 800000),
    ('$PERIOD_ID', 'Carter McKay', 500000),
    ('$PERIOD_ID', 'Jack McArdle', 500000)
  ON CONFLICT (period_id, rep_name)
  DO UPDATE SET quota_amount = EXCLUDED.quota_amount;
"

echo ""
echo "=================================="
echo "Quota Summary"
echo "=================================="
echo ""

# Show quota breakdown
psql $DATABASE_URL -c "
  SELECT
    rq.rep_name,
    TO_CHAR(rq.quota_amount, 'FM\$999,999,999') as quota,
    TO_CHAR(rq.quota_amount::FLOAT / 2800000 * 100, 'FM990.0') || '%' as pct_of_team
  FROM rep_quotas rq
  WHERE rq.period_id = '$PERIOD_ID'
  ORDER BY rq.quota_amount DESC;
"

echo ""
echo "Team Quota: \$2,800,000"
echo ""

# Show current attainment
echo "=================================="
echo "Current Attainment (Closed Won)"
echo "=================================="
echo ""

psql $DATABASE_URL -c "
  SELECT
    d.owner as rep_name,
    TO_CHAR(SUM(d.amount), 'FM\$999,999,999') as closed_won,
    TO_CHAR(rq.quota_amount, 'FM\$999,999,999') as quota,
    TO_CHAR(SUM(d.amount)::FLOAT / rq.quota_amount * 100, 'FM990.0') || '%' as attainment,
    CASE
      WHEN SUM(d.amount)::FLOAT / rq.quota_amount >= 1.20 THEN 'crushing'
      WHEN SUM(d.amount)::FLOAT / rq.quota_amount >= 0.90 THEN 'on_track'
      WHEN SUM(d.amount)::FLOAT / rq.quota_amount >= 0.70 THEN 'at_risk'
      WHEN SUM(d.amount)::FLOAT / rq.quota_amount >= 0.50 THEN 'behind'
      ELSE 'off_track'
    END as status
  FROM deals d
  JOIN rep_quotas rq ON rq.rep_name = d.owner AND rq.period_id = '$PERIOD_ID'
  WHERE d.workspace_id = '$WORKSPACE_ID'
    AND d.source = 'hubspot'
    AND d.stage_normalized = 'closed_won'
  GROUP BY d.owner, rq.quota_amount
  ORDER BY attainment DESC;
"

echo ""
echo "=================================="
echo "✓ Quotas configured!"
echo "=================================="
echo ""
echo "Next: Re-run forecast-rollup skill to see attainment in narrative"
echo ""
echo "  curl -X POST http://localhost:3000/api/skills/forecast-rollup/run \\"
echo "    -H \"Content-Type: application/json\" \\"
echo "    -d '{\"workspaceId\": \"$WORKSPACE_ID\"}'"
echo ""
