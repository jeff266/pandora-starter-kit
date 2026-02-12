# Pipeline Waterfall & Rep Scorecard - Test Plan

This test plan covers both new Tier 1 skills built on the stage history tracking system.

## Pre-Test Verification

### 1. Confirm Stage History is Working

**Check the database:**
```sql
-- Should show 1,481 transitions for Frontera
SELECT COUNT(*) as transition_count,
       source,
       COUNT(DISTINCT deal_id) as unique_deals
FROM deal_stage_history
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
GROUP BY source;
```

**Expected output:**
- `hubspot_history`: 1,481 transitions across 386 deals
- `sync_detection`: May have some transitions if syncs ran after backfill

### 2. Confirm Skills Are Registered

```bash
# Check server logs for registration messages
grep "Registered.*skills" logs/server.log
```

**Expected output:**
```
[SkillRegistry] Registered pipeline skill: pipeline-waterfall
[SkillRegistry] Registered reporting skill: rep-scorecard
[Skills] Registered all built-in skills
```

### 3. List Available Skills

**API call:**
```bash
curl http://localhost:3000/api/skills | jq '.skills[] | select(.id | contains("waterfall") or contains("scorecard"))'
```

**Expected output:**
- `pipeline-waterfall` skill definition
- `rep-scorecard` skill definition

---

## Test 1: Pipeline Waterfall (Manual Run)

### Trigger the Skill

```bash
curl -X POST http://localhost:3000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/skills/pipeline-waterfall/run \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "timeConfig": {
        "analysisWindow": "trailing_90d"
      }
    }
  }'
```

**Why trailing_90d?** Frontera's backfill data is historical (no recent stage changes from syncs yet). A 90-day window ensures we have transitions to analyze.

### Expected Behavior

**Step execution (watch logs):**
1. ✅ `resolve-time-windows` - Calculates period boundaries
2. ✅ `gather-current-waterfall` - Queries stage flow for current period
3. ✅ `gather-previous-waterfall` - Queries stage flow for previous period
4. ✅ `compute-waterfall-deltas` - Compares periods, identifies anomalies
5. ✅ `gather-top-deals-in-motion` - Top 10 advanced, fell out, new deals
6. ✅ `gather-velocity-benchmarks` - Average time-in-stage per stage
7. ✅ `classify-movement-patterns` (DeepSeek) - Classifies deals and anomalies
8. ✅ `synthesize-waterfall-report` (Claude) - Generates narrative

**Success criteria:**
- Status: `completed`
- Output: Markdown report with:
  - **Pipeline summary**: New deals created, closed won/lost, net change
  - **Stage-by-stage flow**: For each stage, entered/advanced/fell out counts
  - **Biggest leakage**: Stage with most closed-lost deals
  - **Biggest bottleneck**: Stage with lowest advance rate
  - **Top deals**: Specific deal names and amounts
  - **Actions**: 2-3 specific recommendations

**Token budget:**
- Total: <12,000 tokens
- Claude step: ~4,000-6,000 tokens (depending on data volume)

### Validation Queries

**Check stage ordering is correct:**
```sql
SELECT DISTINCT stage_normalized
FROM deal_stage_history
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
ORDER BY stage_normalized;
```

**Count transitions by stage:**
```sql
SELECT
  from_stage_normalized,
  to_stage_normalized,
  COUNT(*) as transition_count
FROM deal_stage_history
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND changed_at > NOW() - INTERVAL '90 days'
GROUP BY from_stage_normalized, to_stage_normalized
ORDER BY transition_count DESC
LIMIT 20;
```

### Common Issues & Fixes

**Issue: "No stage history data available"**
- **Cause**: Stage history table empty
- **Fix**: Run backfill script (already done, but verify count)

**Issue: "time_windows not found in context"**
- **Cause**: Step dependency issue
- **Fix**: Check that `resolve-time-windows` completed successfully

**Issue: All stages show 0 movement**
- **Cause**: Time window too narrow (no transitions in last 7 days)
- **Solution**: Use `trailing_90d` window for historical data

**Issue: Stage ordering is alphabetical (not pipeline order)**
- **Cause**: HubSpot connector config metadata not available
- **Impact**: Acceptable fallback - waterfall still works, just order may be suboptimal

---

## Test 2: Rep Scorecard (Manual Run)

### Trigger the Skill

```bash
curl -X POST http://localhost:3000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/skills/rep-scorecard/run \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Default windows:**
- Analysis: Current quarter (for results metrics)
- Change: Last 7 days (for activity trends)

### Expected Behavior

**Step execution (watch logs):**
1. ✅ `resolve-time-windows` - Quarter boundaries + last 7 days
2. ✅ `check-data-availability` - Determines tier (Tier 0-4)
3. ✅ `compute-scorecard` - Gathers all rep metrics, calculates composite scores
4. ✅ `classify-coaching-needs` (DeepSeek) - Classifies bottom performers
5. ✅ `synthesize-scorecard-report` (Claude) - Manager-facing weekly summary

**Expected Frontera tier:**
- **Tier 2**: Deals + Quotas + Stage History
- Activities: Likely missing (unless HubSpot activities synced)
- Conversations: Likely missing (Fireflies not connected)

**Success criteria:**
- Status: `completed`
- Logs show: `[Rep Scorecard] Operating at Tier 2 (Deals + Quotas + History)`
- Output: Markdown report with:
  - **Team Pulse**: Overall health, quota pacing
  - **Standout Performers**: Top 3 reps with specific behaviors
  - **Coaching Priorities**: Bottom 3 reps with gap analysis
  - **Manager Actions**: 3-5 specific, actionable steps

**Composite score validation:**
- Nate Phillips (69% of revenue, 76% of pipeline) → Should score high (80-95)
- Sara Bollman (78 deals, $6.7K avg) → High deal count, lower deal size → ~60-75
- All reps should have scores between 0-100

### Expected Frontera Data

**Reps with quotas:**
- Nate Phillips: $1,000,000 quota
- Sara Bollman: $800,000 quota
- Others: $500,000 each

**Data availability:**
```
hasQuotas: true (3 reps)
hasActivities: false (unless HubSpot synced)
hasConversations: false (unless Fireflies connected)
hasStageHistory: true (1,481 transitions)
```

### Validation Queries

**Check rep metrics:**
```sql
SELECT
  owner,
  COUNT(*) as total_deals,
  COUNT(CASE WHEN stage_normalized = 'closed_won' THEN 1 END) as won,
  COUNT(CASE WHEN stage_normalized = 'closed_lost' THEN 1 END) as lost,
  SUM(CASE WHEN stage_normalized = 'closed_won' THEN amount ELSE 0 END) as revenue,
  SUM(CASE WHEN stage_normalized NOT IN ('closed_won', 'closed_lost') THEN amount ELSE 0 END) as pipeline
FROM deals
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND owner IS NOT NULL
GROUP BY owner
ORDER BY revenue DESC;
```

**Check quota configuration:**
```sql
SELECT
  rq.rep_name,
  rq.quota_amount,
  qp.name as period_name
FROM rep_quotas rq
JOIN quota_periods qp ON qp.id = rq.period_id
WHERE qp.workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
ORDER BY rq.quota_amount DESC;
```

### Adaptive Weighting Verification

**Tier 2 weights (Deals + Quotas + Stage History):**
- Quota Attainment: ~38% (boosted)
- Coverage Ratio: ~25%
- Win Rate: ~19%
- Pipeline Gen: ~13%
- Velocity: ~5% (if stage history available)
- Activity: 0% (missing)
- Conversation Quality: 0% (missing)

**Check the score breakdown in output:**
Each rep should have a `scoreBreakdown` object showing which components contributed:
```json
{
  "quotaAttainment": { "score": 75, "weight": 0.38, "contribution": 28 },
  "coverageRatio": { "score": 60, "weight": 0.25, "contribution": 15 },
  "winRate": { "score": 80, "weight": 0.19, "contribution": 15 },
  "pipelineGen": { "score": 50, "weight": 0.13, "contribution": 7 }
}
```

### Common Issues & Fixes

**Issue: "No reps found"**
- **Cause**: deals.owner column is NULL for all deals
- **Fix**: Check if owner field is populated in HubSpot sync

**Issue: All composite scores are 0**
- **Cause**: No quotas configured
- **Fix**: Quotas should already be seeded (verify with SQL above)

**Issue: Rep has quota but quotaAttainment is null**
- **Cause**: No closed deals in the current quarter
- **Impact**: Normal for early quarter - scorecard should still work

**Issue: Coaching classification is empty**
- **Cause**: DeepSeek step failed or no bottom performers (single rep team)
- **Fix**: Check logs for DeepSeek API errors

**Issue: "Insufficient data for scoring"**
- **Cause**: Rep has 0 deals (new hire, reassignment)
- **Impact**: Acceptable - rep excluded from ranking

---

## Test 3: Cron Scheduler (Automated Runs)

### Verify Cron Expressions

**Check scheduler logs on startup:**
```bash
grep "Skill Scheduler" logs/server.log
```

**Expected output:**
```
[Skill Scheduler] Registered pipeline-waterfall on cron 0 8 * * 1
[Skill Scheduler] Registered rep-scorecard on cron 0 16 * * 5
[Skill Scheduler] 2 cron schedule(s) registered
```

### Manual Cron Trigger Test

**Trigger all skills for Frontera workspace:**
```bash
curl -X POST http://localhost:3000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/skills/run-all \
  -H "Content-Type: application/json" \
  -d '{
    "skills": ["pipeline-waterfall", "rep-scorecard"]
  }'
```

**Expected behavior:**
1. Pre-skill sync runs for each skill (HubSpot incremental)
2. Pipeline Waterfall executes
3. 30-second wait
4. Rep Scorecard executes
5. Both recorded in `skill_runs` table with `trigger_type: 'manual_batch'`

### Verify Skill Run Records

```sql
SELECT
  skill_id,
  status,
  trigger_type,
  duration_ms,
  token_usage,
  started_at
FROM skill_runs
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND skill_id IN ('pipeline-waterfall', 'rep-scorecard')
ORDER BY started_at DESC
LIMIT 5;
```

---

## Test 4: End-to-End Integration

### Full Workflow Test

1. **Backfill stage history** (already done)
   ```bash
   npm run backfill-stage-history 4160191d-73bc-414b-97dd-5a1853190378
   ```

2. **Run Pipeline Waterfall**
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/skills/pipeline-waterfall/run \
     -H "Content-Type: application/json" \
     -d '{"params": {"timeConfig": {"analysisWindow": "trailing_90d"}}}'
   ```

3. **Run Rep Scorecard**
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/skills/rep-scorecard/run
   ```

4. **Verify outputs**
   - Both skills should complete successfully
   - Outputs should reference specific deals, reps, stages
   - Token usage should be reasonable (<15K total per skill)

### Cross-Skill Consistency Check

**Pipeline Waterfall should show:**
- X deals closed won in period
- Y deals closed lost in period

**Rep Scorecard should show:**
- Sum of all rep closed won = X (approximately, may differ by time window)
- Rep rankings that align with pipeline ownership

### Performance Benchmarks

**Pipeline Waterfall:**
- Duration: 30-60 seconds
- Token usage: 8,000-12,000 tokens
- Steps: All 8 complete

**Rep Scorecard:**
- Duration: 45-75 seconds
- Token usage: 6,000-10,000 tokens
- Steps: All 5 complete

---

## Troubleshooting Guide

### Skill Execution Fails

**Check skill_runs table for errors:**
```sql
SELECT skill_id, status, error, steps
FROM skill_runs
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND status IN ('failed', 'partial')
ORDER BY started_at DESC
LIMIT 5;
```

**Common errors:**

| Error | Cause | Fix |
|-------|-------|-----|
| "time_windows not found in context" | Step dependency issue | Verify `resolve-time-windows` step completed |
| "No stage history data" | Backfill not run | Run backfill script |
| "tool not found: waterfallAnalysis" | Tool not registered | Check tool-definitions.ts has new tools |
| "DeepSeek API error" | LLM service down | Check LLM router configuration |
| "Token limit exceeded" | Too much data in prompt | Reduce time window or deal count |

### Data Quality Issues

**Missing stage transitions:**
```sql
-- Check if deals have any stage history
SELECT
  d.id,
  d.name,
  d.stage,
  COUNT(dsh.id) as transition_count
FROM deals d
LEFT JOIN deal_stage_history dsh ON dsh.deal_id = d.id
WHERE d.workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND d.source = 'hubspot'
GROUP BY d.id, d.name, d.stage
HAVING COUNT(dsh.id) = 0
LIMIT 10;
```

**Stale stage history (no recent transitions):**
```sql
SELECT
  MAX(changed_at) as most_recent_transition,
  AGE(NOW(), MAX(changed_at)) as age
FROM deal_stage_history
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';
```

If `age > 30 days`, you may need to widen the analysis window for waterfall.

---

## Success Criteria Checklist

### Pipeline Waterfall
- [ ] Skill registered and visible in API
- [ ] Manual run completes successfully
- [ ] Output shows stage-by-stage flow
- [ ] Identifies biggest leakage and bottleneck
- [ ] Lists top deals by name and amount
- [ ] Provides 2-3 specific actions
- [ ] Token usage < 12,000
- [ ] Duration < 60 seconds

### Rep Scorecard
- [ ] Skill registered and visible in API
- [ ] Manual run completes successfully
- [ ] Data availability check shows correct tier
- [ ] All reps have composite scores (0-100)
- [ ] Top 3 and bottom 3 identified correctly
- [ ] Coaching classifications are specific and actionable
- [ ] Adaptive weighting works (missing data gracefully handled)
- [ ] Token usage < 10,000
- [ ] Duration < 75 seconds

### Integration
- [ ] Both skills can run back-to-back
- [ ] Cron scheduler registers both skills
- [ ] Run-all endpoint executes both with staggering
- [ ] Stage history data used by both skills
- [ ] Outputs are consistent across skills
- [ ] No cross-contamination (workspace isolation works)

---

## Next Steps After Testing

### If Tests Pass:
1. Monitor first automated runs (Monday 8 AM for Waterfall, Friday 4 PM for Scorecard)
2. Validate Slack output formatting (if Slack configured)
3. Add more workspaces to test multi-tenant behavior
4. Consider adjusting time windows based on data patterns

### If Tests Fail:
1. Check server logs for stack traces
2. Verify tool registrations in tool-definitions.ts
3. Confirm stage history backfill completed
4. Test with wider time windows (trailing_90d or trailing_180d)
5. Validate skill step dependencies

### Future Enhancements:
- **Salesforce support**: Add stage history backfill for Salesforce
- **Waterfall visualization**: ASCII chart in Slack output
- **Historical comparison**: Compare to previous quarter (not just previous week)
- **Rep scorecard trends**: Week-over-week rank changes
- **Custom stage ordering**: UI to configure pipeline stage order

---

## Quick Reference

### Frontera Workspace ID
```
4160191d-73bc-414b-97dd-5a1853190378
```

### API Endpoints
```
POST /api/workspaces/:workspaceId/skills/pipeline-waterfall/run
POST /api/workspaces/:workspaceId/skills/rep-scorecard/run
POST /api/workspaces/:workspaceId/skills/run-all
GET  /api/workspaces/:workspaceId/stage-history/stats
GET  /api/workspaces/:workspaceId/deals/:dealId/stage-history
```

### Key Tables
```sql
deal_stage_history  -- Stage transitions
rep_quotas          -- Rep quota targets
quota_periods       -- Quota periods
skill_runs          -- Skill execution history
deals               -- Pipeline data
```

### Logs to Watch
```
[Skill Runtime] Executing step: ...
[Skill Scheduler] Running ... skills for ... workspace(s)
[Stage Backfill] Processing ... deals
[Rep Scorecard] Operating at Tier ...
```

---

**Ready to test!** Start with Test 1 (Pipeline Waterfall manual run) and work through the checklist.
