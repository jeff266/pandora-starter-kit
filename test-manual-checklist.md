# Manual E2E Test Checklist - Replit

Use this checklist to manually validate all features in Replit.

## Prerequisites

```bash
# Ensure server is running
curl http://localhost:3000/health

# Set workspace ID
WORKSPACE_ID="4160191d-73bc-414b-97dd-5a1853190378"
```

---

## Test 1: Workspace Configuration Layer

### 1A. Get Default Configuration
```bash
curl http://localhost:3000/api/workspaces/$WORKSPACE_ID/workspace-config | jq
```

**Expected:**
- `success: true`
- `is_default: true` (or `false` if already configured)
- `config.thresholds.stale_deal_days: 14` (default)
- `config.thresholds.coverage_target: 3.0` (default)

**✅ Pass if:** JSON returned with workspace config

---

### 1B. Update Configuration
```bash
curl -X PATCH http://localhost:3000/api/workspaces/$WORKSPACE_ID/workspace-config/thresholds \
  -H "Content-Type: application/json" \
  -d '{
    "stale_deal_days": 21,
    "critical_stale_days": 45,
    "coverage_target": 4.0,
    "minimum_contacts_per_deal": 3
  }' | jq
```

**Expected:**
- `success: true`
- `config.thresholds.stale_deal_days: 21`
- `config.thresholds.coverage_target: 4.0`

**✅ Pass if:** Values updated and persisted

---

### 1C. Verify Config Used by Skill
```bash
curl -X POST http://localhost:3000/api/skills/pipeline-coverage/run \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}" | jq .result | grep -i "coverage"
```

**Expected:** Skill output mentions 4.0x coverage target (not 3.0)

**✅ Pass if:** Custom config value visible in skill output

---

## Test 2: Custom Funnel Definitions

### 2A. List Templates
```bash
curl http://localhost:3000/api/funnel/templates | jq
```

**Expected:**
- Array with 5 templates
- Templates: `classic_b2b`, `plg`, `enterprise`, `velocity`, `channel`

**✅ Pass if:** 5 templates returned

---

### 2B. Get Workspace Funnel
```bash
curl http://localhost:3000/api/workspaces/$WORKSPACE_ID/funnel | jq
```

**Expected:**
- Either funnel object OR `null` (if none configured)
- If exists: `model_type`, `stages[]`, `status`

**✅ Pass if:** Valid JSON response

---

### 2C. Run Funnel Discovery (Optional)
```bash
curl -X POST http://localhost:3000/api/workspaces/$WORKSPACE_ID/funnel/discover | jq
```

**Expected:**
- `recommendation.template` (e.g., "classic_b2b")
- `recommendation.confidence` (0.0-1.0)
- `funnel.stages[]` with mapped stages

**✅ Pass if:** Recommendation returned with confidence score

---

### 2D. Test Bowtie Analysis with Funnel
```bash
curl -X POST http://localhost:3000/api/skills/bowtie-analysis/run \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}" | jq .result
```

**Expected:**
- Report uses workspace's actual stage names
- NOT hardcoded "Lead", "MQL", "SQL" unless that's your funnel

**✅ Pass if:** Dynamic stage names in output

---

## Test 3: HubSpot Stage History Backfill

### 3A. Check Current Stats
```bash
curl http://localhost:3000/api/workspaces/$WORKSPACE_ID/stage-history/stats | jq
```

**Expected:**
```json
{
  "totalDeals": 391,
  "dealsWithHistory": 357,
  "totalHistoryEntries": 1503,
  "avgHistoryEntriesPerDeal": 4.2
}
```

**✅ Pass if:**
- `dealsWithHistory > 0`
- Coverage > 80%

---

### 3B. Check Specific Deal Timeline
```bash
# Get a deal ID first
DEAL_ID=$(curl -s "http://localhost:3000/api/workspaces/$WORKSPACE_ID/deals?limit=1" | jq -r '.[0].id')

# Get its stage history
curl "http://localhost:3000/api/workspaces/$WORKSPACE_ID/deals/$DEAL_ID/stage-history" | jq
```

**Expected:**
- Array of stage entries
- Each entry: `stage`, `entered_at`, `exited_at`, `duration_days`

**✅ Pass if:** Complete timeline showing stage progression

---

### 3C. Verify days_in_stage Updated
```bash
curl "http://localhost:3000/api/workspaces/$WORKSPACE_ID/deals?limit=10" | \
  jq '.[] | {name, stage, days_in_stage, stage_changed_at}'
```

**Expected:**
- `days_in_stage` shows realistic values (not all 0-3)
- `stage_changed_at` is not same as `created_date` for older deals

**✅ Pass if:** Real durations visible (weeks/months for old deals)

---

## Test 4: Contact Role Resolution

### 4A. Check Current Coverage
```bash
curl "http://localhost:3000/api/workspaces/$WORKSPACE_ID/contacts?limit=100" | \
  jq '[.[] | select(.custom_fields.buying_role != null)] | length'
```

**Expected:** Number of contacts with roles (e.g., 673)

**✅ Pass if:** >50% of contacts have roles

---

### 4B. Verify Role Quality (SQL)
Run in Replit database:
```sql
SELECT
  dc.buying_role,
  COUNT(*) as count,
  AVG(dc.role_confidence)::numeric(3,2) as avg_confidence,
  dc.role_source
FROM deal_contacts dc
WHERE dc.workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND dc.buying_role IS NOT NULL
GROUP BY dc.buying_role, dc.role_source
ORDER BY count DESC;
```

**Expected:**
- Multiple roles: `decision_maker`, `champion`, `influencer`, etc.
- Avg confidence: 0.6-0.9
- Source: `hubspot` or `inferred`

**✅ Pass if:** Roles distributed across 4-6 types

---

## Test 5: Skill Performance

### 5A. Pipeline Goals (Fixed Activities Column)
```bash
time curl -X POST http://localhost:3000/api/skills/pipeline-goals/run \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}" | jq .metadata
```

**Expected:**
- `status: "completed"`
- Rep breakdown shows 4+ reps (not 0)
- Duration: <30s

**✅ Pass if:** Reps detected correctly

---

### 5B. Deal Risk Review (Latency)
```bash
time curl -X POST http://localhost:3000/api/skills/deal-risk-review/run \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}" | jq '{status, duration_ms, metadata}'
```

**Expected:**
- `status: "completed"`
- Total duration: <60s (41s is Claude API time)
- Analyzes 10 deals (not 20)

**✅ Pass if:** Completes in <60s

---

## Test 6: Skill Output Caching

### 6A. First Run (Fresh Execution)
```bash
echo "First run:"
time curl -X POST http://localhost:3000/api/skills/pipeline-coverage/run \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}" | jq .status
```

Note the time (e.g., 12s)

---

### 6B. Second Run (Should Cache)
```bash
echo "Second run (within 30min):"
time curl -X POST http://localhost:3000/api/skills/pipeline-coverage/run \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}" | jq .status
```

**Expected:**
- Time: <1s (near-instant)
- Check server logs for: `"output reused from cache (30min TTL)"`

**✅ Pass if:** Second run is 10x+ faster

---

### 6C. Cache Stats (SQL)
```sql
SELECT
  skill_id,
  COUNT(*) FILTER (WHERE status = 'completed') as fresh_runs,
  COUNT(*) FILTER (WHERE status = 'cached') as cache_hits,
  AVG(duration_ms) FILTER (WHERE status = 'completed') as avg_fresh_ms,
  AVG(duration_ms) FILTER (WHERE status = 'cached') as avg_cached_ms
FROM agent_skill_results
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY skill_id;
```

**Expected:** Cache hits show ~100x faster than fresh runs

**✅ Pass if:** Cache hits present in last hour

---

## Test 7: Agent Execution

### 7A. Run Attainment vs Goal Agent
```bash
time curl -X POST http://localhost:3000/api/agents/attainment-vs-goal/run \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}" | jq
```

**Expected:**
- `status: "completed"`
- Multiple skills executed (4+)
- Total duration: <90s
- Output contains analysis

**✅ Pass if:** Agent completes all skills successfully

---

### 7B. Check Skill Results
```bash
curl "http://localhost:3000/api/agents/attainment-vs-goal/run?workspaceId=$WORKSPACE_ID" | \
  jq '.skills[] | {id, status, duration_ms}'
```

**Expected:**
- All skills show `status: "completed"` or `status: "cached"`
- No errors

**✅ Pass if:** All skills succeeded

---

## Test 8: Database Validation

Run these SQL queries to verify data integrity:

### 8A. Stage History Coverage
```sql
SELECT
  COUNT(DISTINCT d.id) as total_deals,
  COUNT(DISTINCT dsh.deal_id) as deals_with_history,
  ROUND(100.0 * COUNT(DISTINCT dsh.deal_id) / NULLIF(COUNT(DISTINCT d.id), 0), 1) as coverage_pct
FROM deals d
LEFT JOIN deal_stage_history dsh ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
WHERE d.workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';
```

**Expected:** >80% coverage

---

### 8B. Contact Role Distribution
```sql
SELECT
  COALESCE(dc.buying_role, 'no_role') as role,
  COUNT(*) as count,
  ROUND(AVG(dc.role_confidence)::numeric, 2) as avg_confidence
FROM deal_contacts dc
WHERE dc.workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
GROUP BY dc.buying_role
ORDER BY count DESC;
```

**Expected:** Multiple roles with confidence 0.6-0.9

---

### 8C. Workspace Config Existence
```sql
SELECT
  workspace_id,
  value->'thresholds'->>'stale_deal_days' as stale_days,
  value->'thresholds'->>'coverage_target' as coverage,
  value->>'confirmed' as confirmed
FROM context_layer
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND category = 'settings'
  AND key = 'workspace_config';
```

**Expected:** Row exists with custom values (21 days, 4.0 coverage)

---

## Final Checklist

- [ ] Workspace config CRUD works
- [ ] Config values used by skills
- [ ] Funnel templates accessible
- [ ] Funnel discovery runs
- [ ] Bowtie analysis uses dynamic stages
- [ ] Stage history >80% coverage
- [ ] Contact roles >50% coverage
- [ ] Pipeline goals detects reps (not 0)
- [ ] Deal risk <60s duration
- [ ] Skill caching reduces latency 10x+
- [ ] Agent runs complete successfully
- [ ] Database integrity validated

---

## Success Criteria

**All features working if:**
- ✅ 12/12 checklist items pass
- ✅ No critical errors in logs
- ✅ Agent runs complete in <90s
- ✅ Stage history >80% backfilled
- ✅ Contact roles >50% inferred
- ✅ Skills use workspace config (not hardcoded values)

**Ready for production!** 🚀
