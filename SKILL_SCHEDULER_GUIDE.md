# Skill Scheduler - Implementation Guide

**Date:** February 11, 2026
**Status:** Ready to Deploy

---

## Overview

The skill scheduler enables **autonomous execution** of skills across all connected workspaces. Skills run on cron schedules with intelligent staggering to avoid API rate limits and resource exhaustion.

### Key Features

- ✅ **Cron-based scheduling** - Skills run automatically on defined schedules
- ✅ **Duplicate prevention** - Skips runs if executed within last 6 hours
- ✅ **Pre-skill sync** - Incremental data refresh before each skill
- ✅ **Staggered execution** - 30-second gaps between skills to avoid rate limits
- ✅ **Multi-workspace** - Runs for all workspaces with connected sources
- ✅ **Trigger tracking** - Records whether run was scheduled or manual
- ✅ **Run-all endpoint** - Test scheduled flow on demand

---

## Current Schedule

All 5 production skills run **Monday 8 AM UTC**:

| Skill | Schedule | Cron Expression |
|-------|----------|----------------|
| pipeline-hygiene | Monday 8 AM UTC | `0 8 * * 1` |
| single-thread-alert | Monday 8 AM UTC | `0 8 * * 1` |
| data-quality-audit | Monday 8 AM UTC | `0 8 * * 1` |
| pipeline-coverage | Monday 8 AM UTC | `0 8 * * 1` |
| forecast-rollup | Monday 8 AM UTC | `0 8 * * 1` |

**Execution flow:**
1. Cron triggers at 8:00 AM UTC
2. Find all workspaces with connected sources
3. For each workspace:
   - Run incremental sync (fresh data)
   - Execute skill 1
   - Wait 30 seconds
   - Execute skill 2
   - Wait 30 seconds
   - ... continue for all 5 skills
4. Total execution time: ~5 minutes per workspace

---

## Architecture

### Components

1. **`server/sync/skill-scheduler.ts`** - Core scheduler logic
   - `startSkillScheduler()` - Register cron jobs from skill definitions
   - `stopSkillScheduler()` - Graceful shutdown
   - `runScheduledSkills()` - Execute skills with staggering
   - `executeSkill()` - Single skill execution with sync + logging
   - `hasRecentRun()` - Duplicate detection

2. **`server/routes/skills.ts`** - Added run-all endpoint
   - `POST /api/workspaces/:id/skills/run-all` - Test endpoint

3. **`server/index.ts`** - Server startup integration
   - Calls `startSkillScheduler()` after skill registration
   - Graceful shutdown on SIGTERM/SIGINT

### Database

**Trigger Types:**
- `scheduled` - Cron-triggered automatic execution
- `manual` - Single skill run via API
- `manual_batch` - Multiple skills run via run-all endpoint

The `skill_runs.trigger_type` column already exists (from migration 007).

---

## Execution Logic

### For Each Scheduled Skill Run:

1. **Check for duplicates**
   ```sql
   SELECT id FROM skill_runs
   WHERE skill_id = ? AND workspace_id = ?
     AND started_at > now() - interval '6 hours'
     AND status IN ('running', 'completed')
   ```
   If found → Skip (prevents double-runs on server restart)

2. **Run incremental sync**
   - Calls `syncWorkspace(workspaceId, { mode: 'incremental' })`
   - If sync fails → Continue anyway (stale data better than no data)
   - Logged as: `[Skill Scheduler] Pre-skill sync completed for workspace {id}`

3. **Execute skill**
   - Uses existing `SkillRuntime.executeSkill()` logic
   - Same execution path as manual triggers
   - Slack posting happens automatically if configured

4. **Log to database**
   - Insert into `skill_runs` with `trigger_type = 'scheduled'`
   - Same fields as manual runs (result, output_text, steps, etc.)

5. **Stagger next skill**
   - Wait 30 seconds before next skill (unless last skill)
   - Prevents API rate limits and resource spikes

---

## API Endpoints

### Run All Skills (Testing)

```bash
POST /api/workspaces/:workspaceId/skills/run-all
```

**Body (optional):**
```json
{
  "skills": ["pipeline-hygiene", "forecast-rollup"]  // Filter to specific skills
}
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "total": 5,
    "successful": 5,
    "failed": 0
  },
  "results": [
    {
      "skillId": "pipeline-hygiene",
      "status": "completed",
      "runId": "uuid",
      "duration_ms": 45000,
      "error": null
    },
    // ... 4 more skills
  ]
}
```

**Use case:** Test the Monday morning flow without waiting for Monday.

---

## Deployment

### On Replit

```bash
# 1. Pull latest code
git pull origin main

# 2. Install dependencies (if needed)
npm install

# 3. Restart server (picks up new scheduler)
pm2 restart all

# 4. Check logs for scheduler startup
pm2 logs --lines 50 | grep -i "skill scheduler"

# Expected output:
# [Skill Scheduler] Registered pipeline-hygiene, single-thread-alert, data-quality-audit, pipeline-coverage, forecast-rollup on cron 0 8 * * 1
# [Skill Scheduler] Server timezone: America/Los_Angeles
# [Skill Scheduler] Cron expressions use UTC timezone
# [Skill Scheduler] 1 cron schedule(s) registered
```

### Testing

```bash
# Run test script
./scripts/test-skill-scheduler.sh
```

This will:
1. ✅ Check scheduler logs
2. ✅ Test run-all endpoint
3. ✅ Verify skill_runs records
4. ✅ Show trigger type distribution

---

## Timezone Notes

**Cron expressions use UTC timezone:**
- `0 8 * * 1` = Monday 8:00 AM UTC
- In PST: Monday 12:00 AM (midnight)
- In EST: Monday 3:00 AM

**Why UTC?**
- Consistent across deployments
- Matches existing sync scheduler
- Avoids DST complications

**To change schedule:**
Edit skill definition in `server/skills/library/{skill}.ts`:
```typescript
schedule: {
  cron: '0 16 * * 1',  // Monday 4 PM UTC = 8 AM PST
  trigger: 'on_demand',
}
```

---

## Monitoring

### Check Scheduled Runs

```sql
-- Recent scheduled runs
SELECT
  skill_id,
  status,
  trigger_type,
  duration_ms,
  created_at
FROM skill_runs
WHERE trigger_type = 'scheduled'
ORDER BY created_at DESC
LIMIT 20;
```

### Run Counts by Trigger Type

```sql
SELECT
  trigger_type,
  COUNT(*) as total,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
FROM skill_runs
GROUP BY trigger_type;
```

### Find Skipped Runs (Duplicates)

```bash
# Check logs for "Skipping" messages
pm2 logs | grep "Skipping"
```

---

## Troubleshooting

### Issue: Scheduler not starting

**Symptoms:** No "Skill Scheduler" logs on startup

**Check:**
```bash
pm2 logs --lines 100 | grep -i scheduler
```

**Causes:**
- Skills not registered yet → Ensure `registerBuiltInSkills()` runs before `startSkillScheduler()`
- node-cron not installed → Run `npm install`

### Issue: Skills running twice

**Symptoms:** Duplicate skill_runs entries at same timestamp

**Check duplicate detection:**
```sql
SELECT skill_id, workspace_id, COUNT(*) as runs
FROM skill_runs
WHERE created_at > now() - interval '1 hour'
GROUP BY skill_id, workspace_id
HAVING COUNT(*) > 1;
```

**Cause:** Recent run detection failed
**Fix:** 6-hour window should be sufficient; check database clock

### Issue: Skills not running on Monday

**Check cron registration:**
```bash
pm2 logs | grep "Registered.*on cron"
```

**Check timezone:**
```bash
pm2 logs | grep "Server timezone"
```

**Verify next cron trigger:**
- Monday 8 AM UTC
- Use a cron calculator to check your local time

### Issue: Rate limit errors

**Symptoms:** Skills fail with 429 errors from Anthropic/Fireworks

**Fix:** Increase stagger delay in `skill-scheduler.ts`:
```typescript
await new Promise(resolve => setTimeout(resolve, 60_000));  // 60s instead of 30s
```

---

## Future Enhancements

**Not implemented yet (per prompt requirements):**

- ❌ **Per-workspace timezone** - All use server timezone (UTC)
- ❌ **Async job queue** - Sequential execution only
- ❌ **Retry on failure** - Fails fast, logs error, moves on
- ❌ **UI for schedule config** - Hardcoded in skill definitions
- ❌ **Per-workspace enable/disable** - All skills run for all workspaces
- ❌ **Different schedules per skill** - All currently Monday 8 AM

**When these are needed:**
- Timezone: Add `workspace.timezone` column, pass to cron
- Retries: Add retry count to skill execution logic
- UI: Build settings page for cron expressions
- Per-skill schedules: Already supported! Just change `schedule.cron` in skill definition

---

## Success Criteria

✅ **Server startup logs show scheduler registration**
✅ **Run-all endpoint executes all 5 skills**
✅ **skill_runs table has trigger_type = 'manual_batch'**
✅ **Skills execute with 30-second gaps (staggered)**
✅ **Duplicate detection prevents double-runs**
✅ **Pre-skill sync runs before each skill**
✅ **Slack posts received (if webhook configured)**

---

## Example Logs

**Startup:**
```
[server] Registered 7 skills: forecasting(2), pipeline(5)
[Skill Scheduler] Registered pipeline-hygiene, single-thread-alert, data-quality-audit, pipeline-coverage, forecast-rollup on cron 0 8 * * 1
[Skill Scheduler] Server timezone: America/Los_Angeles
[Skill Scheduler] Cron expressions use UTC timezone
[Skill Scheduler] 1 cron schedule(s) registered
```

**Monday 8 AM Execution:**
```
[Skill Scheduler] Cron triggered: 0 8 * * 1 (5 skills)
[Skill Scheduler] Running 5 skills for 1 workspace(s)
[Skill Scheduler] Processing workspace: Frontera Health (4160191d-...)
[Skill Scheduler] Pre-skill sync for workspace 4160191d-...
[Skill Scheduler] Pre-skill sync completed for workspace 4160191d-...
[Skill Scheduler] ✓ pipeline-hygiene completed for workspace 4160191d-... in 23500ms
[Skill Scheduler] Waiting 30s before next skill...
[Skill Scheduler] ✓ single-thread-alert completed for workspace 4160191d-... in 18200ms
[Skill Scheduler] Waiting 30s before next skill...
[Skill Scheduler] ✓ data-quality-audit completed for workspace 4160191d-... in 15700ms
[Skill Scheduler] Waiting 30s before next skill...
[Skill Scheduler] ✓ pipeline-coverage completed for workspace 4160191d-... in 12300ms
[Skill Scheduler] Waiting 30s before next skill...
[Skill Scheduler] ✓ forecast-rollup completed for workspace 4160191d-... in 20100ms
[Skill Scheduler] Cron batch complete: 0 8 * * 1
```

---

**Status:** Production-ready, awaiting first Monday execution! 🚀
