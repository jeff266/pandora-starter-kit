# Forecast Roll-up Skill - Deployment Guide

**Date:** February 11, 2026
**Status:** Ready to Deploy and Test

---

## What Was Built

### Phase 1: Quota Infrastructure ✅
- **migrations/010_quota_periods.sql** - Time-based quota periods (monthly/quarterly/annual)
- **migrations/011_rep_quotas.sql** - Per-rep quotas within periods
- **API endpoints** - Full CRUD for quotas via context routes

### Phase 2: Forecast Roll-up Skill ✅
- **server/skills/library/forecast-rollup.ts** - Complete skill implementation
- **Registered** - Added to skill registry and index

---

## Deployment Steps on Replit

### Step 1: Pull Latest Code (2 minutes)

```bash
cd ~/workspace
git pull origin main
```

**Expected output:**
```
Updating 4f5eab8..a23baf5
Fast-forward
 migrations/010_quota_periods.sql          | 42 +++++++
 migrations/011_rep_quotas.sql             | 65 ++++++++++
 server/routes/context.ts                  | 169 +++++++++++++++++++++++
 server/skills/library/forecast-rollup.ts  | 210 ++++++++++++++++++++++++++
 server/skills/index.ts                    | 4 +
 5 files changed, 490 insertions(+)
```

### Step 2: Run Migrations (2 minutes)

```bash
# Run quota migrations
psql $DATABASE_URL -f migrations/010_quota_periods.sql
psql $DATABASE_URL -f migrations/011_rep_quotas.sql
```

**Verify migrations worked:**
```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM quota_periods;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM rep_quotas;"
```

**Expected:** Both should return `0` (tables exist but are empty)

### Step 3: Seed Quota Data (Optional - 5 minutes)

**If you want to see quota-based insights,** create a quota period and rep quotas:

```sql
-- Get workspace ID
SELECT id, name FROM workspaces WHERE name ILIKE '%frontera%';

-- Create Q1 2026 quota period (replace <workspace_id>)
INSERT INTO quota_periods (workspace_id, name, period_type, start_date, end_date, team_quota)
VALUES (
  '<workspace_id>',
  'Q1 2026',
  'quarterly',
  '2026-01-01',
  '2026-03-31',
  1000000  -- $1M team quota
)
RETURNING id;

-- Create per-rep quotas (replace <period_id> and rep names)
-- First, find rep names:
SELECT DISTINCT owner, COUNT(*) as deal_count
FROM deals
WHERE workspace_id = '<workspace_id>' AND source = 'hubspot'
  AND stage_normalized NOT IN ('closed_lost', 'closed_won')
GROUP BY owner
ORDER BY deal_count DESC;

-- Then insert quotas for each rep:
INSERT INTO rep_quotas (period_id, rep_name, quota_amount)
VALUES
  ('<period_id>', 'Rep Name 1', 150000),
  ('<period_id>', 'Rep Name 2', 200000),
  ('<period_id>', 'Rep Name 3', 100000);
```

**Without quotas:** Skill will still work but show absolute $ only (no attainment %)

### Step 4: Restart Server (1 minute)

```bash
# Restart to pick up new skill
pm2 restart all
```

**Verify skill is registered:**
```bash
curl http://localhost:3000/api/skills | jq '.[] | select(.id == "forecast-rollup")'
```

**Expected:** Should return forecast-rollup skill definition

### Step 5: Run the Skill (30 seconds)

```bash
# Get workspace ID
WORKSPACE_ID=$(psql $DATABASE_URL -t -c "SELECT id FROM workspaces WHERE name ILIKE '%frontera%' LIMIT 1;" | xargs)

# Run skill
curl -X POST http://localhost:3000/api/skills/forecast-rollup/run \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}"
```

**Expected:** Returns `{ "jobId": "...", "status": "queued" }`

### Step 6: Check Results (1 minute)

```sql
-- Get latest run
SELECT
  id,
  status,
  result,
  output_text,
  created_at,
  completed_at
FROM skill_runs
WHERE workspace_id = '<workspace_id>'
  AND skill_id = 'forecast-rollup'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected status:** `completed`

---

## What the Skill Does

### Step 1: gather-forecast-data (DeepSeek)
**Queries:**
- All open deals (stage != closed_lost)
- Groups by forecast_category
- Aggregates by rep and team

**Calculations:**
- **Team totals:** closedWon, commit, bestCase, pipeline, notForecasted
- **Scenarios:** bearCase, baseCase, bullCase, weighted
- **Rep breakdown:** Per-rep totals + quota + attainment + status
- **Deal counts:** Number of deals in each category

**Output:**
```json
{
  "team": {
    "closedWon": 500000,
    "commit": 100000,
    "bestCase": 200000,
    "pipeline": 300000,
    "weighted": 650000,
    "bearCase": 600000,
    "baseCase": 800000,
    "bullCase": 1100000,
    "teamQuota": 1000000,
    "attainment": 0.60
  },
  "byRep": [...]
}
```

### Step 2: compare-week-over-week (DeepSeek)
**Queries:**
- Previous forecast-rollup run (> 6 days ago)

**Calculations:**
- Delta for each category (closedWon, commit, bestCase, pipeline)
- Percent change from previous week

**Output:**
```json
{
  "available": true,
  "changes": {
    "closedWon": { "from": 480000, "to": 500000, "delta": 20000, "deltaPercent": 4.2 }
  }
}
```

### Step 3: synthesize-narrative (Sonnet)
**Generates:**
- Executive summary (300-400 words)
- Team status vs quota
- Key risks & opportunities
- Week-over-week trends
- 2-3 actionable recommendations

**Output:** Markdown-formatted narrative for Slack/email

---

## Assessment Phase

Once the skill runs successfully, use the assessment tools:

```bash
# Run assessment
./scripts/assess-forecast-rollup.sh > FORECAST_ROLLUP_ASSESSMENT.md

# Review
cat FORECAST_ROLLUP_ASSESSMENT.md

# Push results
git add FORECAST_ROLLUP_ASSESSMENT.md
git commit -m "Forecast roll-up assessment results"
git push origin main
```

**The assessment will reveal:**
1. **Category distribution** - Are deals spread across commit/best_case/pipeline or lumped?
2. **Scenario spread** - Is bear-bull range meaningful (>10%) or too narrow?
3. **Rep status distribution** - Are all reps same status or good mix?
4. **WoW delta** - Does it detect meaningful changes (first run won't have WoW)?
5. **Narrative quality** - Is Claude synthesis specific and actionable?

---

## Expected Results (Frontera Health)

Based on current data:
- **188 not_forecasted deals** (58%) - Stale/closed-lost deals
- **74 pipeline deals** (23%) - Early/mid-stage
- **1 best_case deal** (0.3%) - Only 1 deal at 60-90% probability!
- **62 closed deals** (19%) - Closed-won
- **0 commit deals** (0%) - No deals at 90%+

**Forecast should show:**
```
Team:
- Closed Won: ~$XXX (from 62 closed deals)
- Commit: $0 (no deals >= 90%)
- Best Case: ~$XXX (from 1 deal)
- Pipeline: ~$XXX (from 74 deals)

Bear Case: Closed only
Base Case: Closed + best case (~same as bear)
Bull Case: Closed + best case + pipeline

Spread: Narrow (bear ≈ base) because only 1 best_case deal
```

**This will reveal threshold tuning is needed:**
- Current: commit >= 90%, best_case >= 60%
- Proposed: commit >= 85%, best_case >= 55%

---

## Threshold Tuning (Post-Assessment)

If assessment shows poor distribution:

```sql
-- Lower thresholds to spread deals better
UPDATE forecast_thresholds
SET commit_threshold = 85, best_case_threshold = 55
WHERE workspace_id = '<workspace_id>';

-- Resync HubSpot to update forecast_category
POST /api/workspaces/<workspace_id>/sync

-- Re-run skill to see improved distribution
POST /api/skills/forecast-rollup/run
```

---

## Troubleshooting

### Issue: Skill not found

**Check registration:**
```bash
grep "forecastRollupSkill" server/skills/index.ts
```

**Expected:** Should see import, export, and register calls

**Fix:** Restart server after pulling latest code

### Issue: No quota data

**Symptom:** Skill output shows "quota not configured"

**Impact:** No attainment percentages, just absolute $

**Fix:** Seed quota data (see Step 3 above)

### Issue: WoW comparison not available

**Symptom:** "Not available (first run)"

**Cause:** Normal for first run

**Fix:** Run skill again next week to enable WoW comparison

### Issue: Skill fails with "deal-query tool not found"

**Symptom:** Step 1 fails

**Cause:** deal-query tool not registered

**Check:**
```bash
curl http://localhost:3000/api/tools | jq '.[] | select(.name == "deal-query")'
```

**Fix:** Ensure deal-query tool is registered in tool-definitions.ts

---

## API Endpoints Reference

### Run Skill
```bash
POST /api/skills/forecast-rollup/run
Body: { "workspaceId": "<id>" }
Response: { "jobId": "...", "status": "queued" }
```

### Get Skill Run Status
```bash
GET /api/skill-runs/<job_id>
Response: { "status": "completed", "result": {...}, "output": "..." }
```

### Quota Management
```bash
# List quota periods
GET /api/workspaces/<id>/quotas/periods

# Create quota period
POST /api/workspaces/<id>/quotas/periods
Body: { "name": "Q1 2026", "period_type": "quarterly", "start_date": "2026-01-01", "end_date": "2026-03-31", "team_quota": 1000000 }

# Get rep quotas for a period
GET /api/workspaces/<id>/quotas/periods/<period_id>/reps

# Set rep quota
PUT /api/workspaces/<id>/quotas/periods/<period_id>/reps/<rep_name>
Body: { "quota_amount": 150000 }
```

---

## Success Criteria

✅ **Skill runs successfully** (status = completed, duration < 60s)
✅ **Result JSON has all expected fields** (team, byRep, dealCount, weekOverWeek)
✅ **Narrative is generated** (output_text is populated with markdown)
✅ **Assessment reveals meaningful insights** or areas for tuning

🟡 **Threshold tuning needed** if:
- 90%+ deals in one category
- Bear ≈ Bull (spread < 10%)
- All reps same status

✅ **Production ready** if:
- Distribution is reasonable
- Scenarios show meaningful spread
- Rep statuses are mixed
- Narrative is specific and actionable

---

**Estimated Total Time:** 15-20 minutes
- Pull + migrations: 4 min
- Seed quotas: 5 min (optional)
- Restart + run: 2 min
- Assessment: 5 min
- Review + tune: 5 min

**Status:** Ready to deploy! 🚀
