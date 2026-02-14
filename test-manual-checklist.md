# Manual E2E Test Checklist

Use this checklist to manually validate all 6 features in Replit.

## Prerequisites

- Server running on port 5000 (`Pandora API` workflow active)
- Database accessible via `$DATABASE_URL`
- Workspace ID: `4160191d-73bc-414b-97dd-5a1853190378`

---

## 1. Workspace Config — GET

```bash
curl -s http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/workspace-config | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d.join('')),null,2)))"
```

**Expected:** `{ "success": true, "config": { ... }, "is_default": false }`
**Pass criteria:** Response contains `success: true` and a `config` object

- [ ] PASS / FAIL

---

## 2. Workspace Config — PUT

```bash
curl -s -X PUT http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/workspace-config \
  -H "Content-Type: application/json" \
  -d '{"fiscal_year_start":"january","default_currency":"USD","confirmed":true}' | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d.join('')),null,2)))"
```

**Expected:** `{ "success": true, ... }`
**Pass criteria:** Update succeeds and subsequent GET shows `confirmed: true`

- [ ] PASS / FAIL

---

## 3. Funnel Templates

```bash
curl -s http://localhost:5000/api/funnel/templates | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>{const r=JSON.parse(d.join(''));const t=r.templates||r;console.log(t.length+' templates:');t.forEach(x=>console.log(' -',x.model_label||x.name||x.id))})"
```

**Expected:** `{ "success": true, "templates": [ ... ] }` with 5+ templates listed
**Pass criteria:** At least 3 funnel templates available

- [ ] PASS / FAIL

---

## 4. Funnel Definition

```bash
curl -s http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/funnel | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d.join('')),null,2)))"
```

**Expected:** JSON with funnel stages
**Pass criteria:** Response contains stage definitions

- [ ] PASS / FAIL

---

## 5. Stage History Coverage

```sql
-- Run in database console
SELECT
  COUNT(DISTINCT dsh.deal_id) AS deals_with_history,
  COUNT(DISTINCT d.id) AS total_deals,
  ROUND(100.0 * COUNT(DISTINCT dsh.deal_id) / NULLIF(COUNT(DISTINCT d.id), 0), 1) AS coverage_pct,
  (SELECT COUNT(*) FROM deal_stage_history WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378') AS total_entries
FROM deals d
LEFT JOIN deal_stage_history dsh ON dsh.deal_id = d.id AND dsh.workspace_id = d.workspace_id
WHERE d.workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';
```

**Expected:** coverage_pct >= 80%, total_entries >= 1000
**Pass criteria:** At least 80% of deals have stage history

- [ ] PASS / FAIL

---

## 6. Contact Role Inference

```bash
curl -s -X POST http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/connectors/hubspot/resolve-contact-roles | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d.join('')),null,2)))"
```

**Expected:** `{ "success": true, "created": N, "updated": N, "total": 689 }`
**Pass criteria:** total >= 100

**SQL Verification:**
```sql
SELECT buying_role, COUNT(*), ROUND(AVG(role_confidence), 2) AS avg_conf
FROM deal_contacts
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378' AND role_source = 'inferred'
GROUP BY buying_role ORDER BY count DESC;
```

- [ ] PASS / FAIL

---

## 7. Pipeline Goals Skill

```bash
curl -s --max-time 60 -X POST http://localhost:5000/api/skills/pipeline-goals/run \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"4160191d-73bc-414b-97dd-5a1853190378"}' | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>{const j=JSON.parse(d.join(''));console.log('Status:',j.status);console.log('Output preview:',j.result?.substring(0,200))})"
```

**Expected:** Status: completed
**Pass criteria:** Skill completes and returns a result

**Rep detection verification (check logs):**
Look for `repCount: 4` in server logs (not `repCount: 0`)

- [ ] PASS / FAIL

---

## 8. Deal-Risk Latency

```bash
START=$(date +%s) && curl -s --max-time 120 -X POST http://localhost:5000/api/skills/deal-risk-review/run \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"4160191d-73bc-414b-97dd-5a1853190378"}' | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>{const j=JSON.parse(d.join(''));console.log('Status:',j.status)})" && END=$(date +%s) && echo "Duration: $((END-START))s"
```

**Expected:** Status: completed, Duration < 90s
**Pass criteria:** Skill completes within 90 seconds

- [ ] PASS / FAIL

---

## 9. Skill Caching — Run Storage

```bash
curl -s --max-time 60 -X POST http://localhost:5000/api/skills/pipeline-coverage/run \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"4160191d-73bc-414b-97dd-5a1853190378"}' | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>console.log('Status:',JSON.parse(d.join('')).status))"
```

**SQL Verification (cache storage):**
```sql
SELECT COUNT(*) AS recent_cacheable_runs
FROM skill_runs
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND skill_id = 'pipeline-coverage'
  AND status = 'completed'
  AND started_at >= NOW() - INTERVAL '30 minutes';
```

**Pass criteria:** At least 1 recent completed run stored

- [ ] PASS / FAIL

---

## 10. Skill Caching — Agent-Level Cache Hit

Run pipeline-goals directly, then run attainment-vs-goal agent. Check logs for cache message.

```bash
curl -s --max-time 60 -X POST http://localhost:5000/api/skills/pipeline-goals/run \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"4160191d-73bc-414b-97dd-5a1853190378"}' > /dev/null

# Then run the agent (takes 2-4 minutes)
curl -s --max-time 300 -X POST http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/agents/attainment-vs-goal/run > /dev/null
```

**Expected log message:** `[Agent attainment-vs-goal] Skill pipeline-goals output reused from cache (30min TTL)`
**Pass criteria:** Cache hit appears in server logs

- [ ] PASS / FAIL

---

## 11. Agent Registry

```bash
curl -s http://localhost:5000/api/agents | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>{const r=JSON.parse(d.join(''));const a=r.agents||r;console.log(a.length+' agents:');a.forEach(x=>console.log(' -',x.id,'-',x.name))})"
```

**Expected:** `{ "agents": [ ... ] }` with 6 agents listed
**Pass criteria:** At least 4 agents registered

- [ ] PASS / FAIL

---

## 12. Agent Run History

```sql
SELECT agent_id, status, started_at
FROM agent_runs
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
ORDER BY started_at DESC
LIMIT 5;
```

**Expected:** At least 1 completed agent run
**Pass criteria:** Recent agent_runs with status = 'completed'

- [ ] PASS / FAIL

---

## Summary

| # | Test | Status |
|---|------|--------|
| 1 | Workspace Config GET | |
| 2 | Workspace Config PUT | |
| 3 | Funnel Templates | |
| 4 | Funnel Definition | |
| 5 | Stage History Coverage | |
| 6 | Contact Role Inference | |
| 7 | Pipeline Goals | |
| 8 | Deal-Risk Latency | |
| 9 | Skill Cache Storage | |
| 10 | Agent Cache Hit | |
| 11 | Agent Registry | |
| 12 | Agent Run History | |

**Target: 12/12 PASS (warnings acceptable for coverage targets)**
