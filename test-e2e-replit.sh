#!/usr/bin/env bash
set -euo pipefail

BASE="http://localhost:5000"
WS="4160191d-73bc-414b-97dd-5a1853190378"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
RESULTS=()

pass() {
  PASS=$((PASS + 1))
  RESULTS+=("${GREEN}PASS${NC}  $1")
  echo -e "  ${GREEN}✓${NC} $1"
}

fail() {
  FAIL=$((FAIL + 1))
  RESULTS+=("${RED}FAIL${NC}  $1 — $2")
  echo -e "  ${RED}✗${NC} $1 — $2"
}

warn() {
  WARN=$((WARN + 1))
  RESULTS+=("${YELLOW}WARN${NC}  $1 — $2")
  echo -e "  ${YELLOW}⚠${NC} $1 — $2"
}

section() {
  echo ""
  echo -e "${CYAN}${BOLD}── $1 ──${NC}"
}

json_field() {
  node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>{try{const o=JSON.parse(d.join(''));const v=$1;console.log(v===undefined?'':v)}catch{console.log('')}})"
}

echo -e "${BOLD}Pandora E2E Test Suite${NC}"
echo "Target: $BASE"
echo "Workspace: $WS"
echo ""

section "1. Server Health"

RESP=$(curl -sf "$BASE/" 2>/dev/null || echo "FAIL")
if echo "$RESP" | grep -qi "pandora\|running\|ok\|api\|version"; then
  pass "Server is running"
else
  fail "Server is running" "No response from $BASE/"
fi

section "2. Workspace Config CRUD"

CONFIG_GET=$(curl -sf "$BASE/api/workspaces/$WS/workspace-config" 2>/dev/null || echo "FAIL")
if echo "$CONFIG_GET" | grep -q '"success":true'; then
  pass "GET workspace config"
else
  fail "GET workspace config" "Unexpected response"
fi

CONFIG_PUT=$(curl -sf -X PUT "$BASE/api/workspaces/$WS/workspace-config" \
  -H "Content-Type: application/json" \
  -d '{"fiscal_year_start":"january","default_currency":"USD","confirmed":true}' 2>/dev/null || echo "FAIL")
if echo "$CONFIG_PUT" | grep -q '"success":true'; then
  pass "PUT workspace config"
else
  fail "PUT workspace config" "Update failed"
fi

CONFIG_VERIFY=$(curl -sf "$BASE/api/workspaces/$WS/workspace-config" 2>/dev/null || echo "FAIL")
if echo "$CONFIG_VERIFY" | grep -q '"confirmed":true'; then
  pass "Config persisted after update"
else
  fail "Config persisted after update" "confirmed flag not set"
fi

section "3. Funnel Templates & Discovery"

TEMPLATES=$(curl -sf "$BASE/api/funnel/templates" 2>/dev/null || echo "[]")
TEMPLATE_COUNT=$(echo "$TEMPLATES" | json_field "(o.templates||o).length")
if [ "${TEMPLATE_COUNT:-0}" -ge 3 ]; then
  pass "Funnel templates available ($TEMPLATE_COUNT found)"
else
  fail "Funnel templates available" "Expected >=3, got ${TEMPLATE_COUNT:-0}"
fi

FUNNEL_GET=$(curl -sf "$BASE/api/workspaces/$WS/funnel" 2>/dev/null || echo "FAIL")
if echo "$FUNNEL_GET" | grep -q "stages\|funnel\|name"; then
  pass "GET workspace funnel definition"
else
  warn "GET workspace funnel definition" "No funnel configured yet"
fi

section "4. Stage History Coverage"

ENTRY_COUNT=$(psql "$DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM deal_stage_history WHERE workspace_id = '$WS'" 2>/dev/null || echo "0")
if [ "${ENTRY_COUNT:-0}" -ge 1000 ]; then
  pass "Stage history entries ($ENTRY_COUNT found, target >=1000)"
elif [ "${ENTRY_COUNT:-0}" -ge 500 ]; then
  warn "Stage history entries" "$ENTRY_COUNT found, target >=1000"
else
  fail "Stage history entries" "Only $ENTRY_COUNT found"
fi

DEAL_COVERAGE=$(psql "$DATABASE_URL" -t -A -c "
  SELECT ROUND(100.0 * COUNT(DISTINCT dsh.deal_id) / NULLIF(COUNT(DISTINCT d.id), 0))
  FROM deals d
  LEFT JOIN deal_stage_history dsh ON dsh.deal_id = d.id AND dsh.workspace_id = d.workspace_id
  WHERE d.workspace_id = '$WS'
" 2>/dev/null || echo "0")
if [ "${DEAL_COVERAGE:-0}" -ge 80 ]; then
  pass "Stage history deal coverage (${DEAL_COVERAGE}%, target >=80%)"
else
  warn "Stage history deal coverage" "${DEAL_COVERAGE}%, target >=80%"
fi

section "5. Contact Role Inference"

ROLE_RESP=$(curl -sf --max-time 120 -X POST "$BASE/api/workspaces/$WS/connectors/hubspot/resolve-contact-roles" 2>/dev/null || echo "FAIL")
ROLE_TOTAL=$(echo "$ROLE_RESP" | json_field "o.total")
if [ "${ROLE_TOTAL:-0}" -ge 100 ]; then
  pass "Contact role inference ($ROLE_TOTAL contacts processed)"
else
  fail "Contact role inference" "Only ${ROLE_TOTAL:-0} contacts processed"
fi

ROLE_COVERAGE=$(psql "$DATABASE_URL" -t -A -c "
  SELECT COUNT(*) FROM deal_contacts
  WHERE workspace_id = '$WS' AND role_source = 'inferred'
" 2>/dev/null || echo "0")
if [ "${ROLE_COVERAGE:-0}" -ge 100 ]; then
  pass "Inferred roles stored in DB ($ROLE_COVERAGE rows)"
else
  fail "Inferred roles stored in DB" "Only $ROLE_COVERAGE rows"
fi

section "6. Pipeline Goals (Rep Detection)"

echo -e "  ${YELLOW}…${NC} Running pipeline-goals skill (takes ~20-25s)..."
GOALS_START=$(date +%s)
GOALS_RESP=$(curl -sf --max-time 60 -X POST "$BASE/api/skills/pipeline-goals/run" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WS\"}" 2>/dev/null || echo "FAIL")
GOALS_END=$(date +%s)
GOALS_DUR=$((GOALS_END - GOALS_START))

GOALS_STATUS=$(echo "$GOALS_RESP" | json_field "o.status")
if [ "$GOALS_STATUS" = "completed" ]; then
  pass "Pipeline-goals skill completed (${GOALS_DUR}s)"
else
  fail "Pipeline-goals skill" "Status: $GOALS_STATUS"
fi

REP_COUNT=$(psql "$DATABASE_URL" -t -A -c "
  SELECT COUNT(DISTINCT d.owner)
  FROM deals d
  JOIN activities a ON a.deal_id = d.id AND a.workspace_id = d.workspace_id
  WHERE d.workspace_id = '$WS'
    AND d.owner IS NOT NULL
    AND a.timestamp >= DATE_TRUNC('month', NOW())
" 2>/dev/null || echo "0")
if [ "${REP_COUNT:-0}" -ge 1 ]; then
  pass "Active reps with deals ($REP_COUNT found)"
else
  warn "Active reps detection" "Got ${REP_COUNT:-0} reps with recent activity"
fi

section "7. Deal-Risk Latency"

echo -e "  ${YELLOW}…${NC} Running deal-risk-review skill (takes ~40-60s)..."
RISK_START=$(date +%s)
RISK_RESP=$(curl -sf --max-time 120 -X POST "$BASE/api/skills/deal-risk-review/run" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WS\"}" 2>/dev/null || echo "FAIL")
RISK_END=$(date +%s)
RISK_DUR=$((RISK_END - RISK_START))

RISK_STATUS=$(echo "$RISK_RESP" | json_field "o.status")
if [ "$RISK_STATUS" = "completed" ]; then
  pass "Deal-risk-review completed (${RISK_DUR}s)"
else
  fail "Deal-risk-review" "Status: $RISK_STATUS"
fi

if [ "$RISK_DUR" -le 90 ]; then
  pass "Deal-risk latency under 90s (${RISK_DUR}s)"
else
  warn "Deal-risk latency" "${RISK_DUR}s exceeds 90s target"
fi

section "8. Skill Caching Infrastructure"

echo -e "  ${YELLOW}…${NC} Running pipeline-coverage to test cache storage..."
RUN1_START=$(date +%s)
RUN1=$(curl -sf --max-time 60 -X POST "$BASE/api/skills/pipeline-coverage/run" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WS\"}" 2>/dev/null || echo "FAIL")
RUN1_END=$(date +%s)
RUN1_DUR=$((RUN1_END - RUN1_START))

RUN1_STATUS=$(echo "$RUN1" | json_field "o.status")
if [ "$RUN1_STATUS" = "completed" ]; then
  pass "Skill run completed (${RUN1_DUR}s)"
else
  fail "Skill run" "Status: $RUN1_STATUS"
fi

CACHE_CHECK=$(psql "$DATABASE_URL" -t -A -c "
  SELECT COUNT(*) FROM skill_runs
  WHERE workspace_id = '$WS'
    AND skill_id = 'pipeline-coverage'
    AND status = 'completed'
    AND started_at >= NOW() - INTERVAL '30 minutes'
" 2>/dev/null || echo "0")
if [ "${CACHE_CHECK:-0}" -ge 1 ]; then
  pass "Skill run stored for cache ($CACHE_CHECK recent runs)"
else
  warn "Skill run cache storage" "No recent completed runs found"
fi

CACHE_INFRA=$(psql "$DATABASE_URL" -t -A -c "
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_name = 'skill_runs' AND column_name IN ('status', 'started_at', 'output_text', 'result')
" 2>/dev/null || echo "0")
if [ "${CACHE_INFRA:-0}" -ge 4 ]; then
  pass "Cache infrastructure columns present"
else
  warn "Cache infrastructure" "Missing expected columns in skill_runs"
fi

section "9. Agent Execution"

AGENTS_LIST=$(curl -sf "$BASE/api/agents" 2>/dev/null || echo "[]")
AGENT_COUNT=$(echo "$AGENTS_LIST" | json_field "(o.agents||o).length")
if [ "${AGENT_COUNT:-0}" -ge 4 ]; then
  pass "Agent registry ($AGENT_COUNT agents registered)"
else
  fail "Agent registry" "Only ${AGENT_COUNT:-0} agents"
fi

RECENT_AGENT=$(psql "$DATABASE_URL" -t -A -c "
  SELECT COUNT(*) FROM agent_runs
  WHERE workspace_id = '$WS'
    AND status = 'completed'
    AND started_at >= NOW() - INTERVAL '24 hours'
" 2>/dev/null || echo "0")
if [ "${RECENT_AGENT:-0}" -ge 1 ]; then
  pass "Recent agent runs completed ($RECENT_AGENT in last 24h)"
else
  warn "Recent agent runs" "None completed in last 24h"
fi

echo ""
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo -e "${BOLD}  Test Results Summary${NC}"
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo ""
for r in "${RESULTS[@]}"; do
  echo -e "  $r"
done
echo ""
TOTAL=$((PASS + FAIL + WARN))
echo -e "  ${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}  ${YELLOW}Warnings: $WARN${NC}  Total: $TOTAL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}All critical tests passed.${NC}"
  exit 0
else
  echo -e "  ${RED}${BOLD}$FAIL test(s) failed.${NC}"
  exit 1
fi
