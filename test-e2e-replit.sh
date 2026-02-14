#!/bin/bash
# End-to-End Test Suite for Pandora Starter Kit
# Run in Replit to validate all features

set -e  # Exit on error

# Configuration
WORKSPACE_ID="4160191d-73bc-414b-97dd-5a1853190378"  # Frontera
BASE_URL="http://localhost:3000"
RESULTS_FILE="/tmp/test-results.txt"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_test() {
    echo -e "\n${YELLOW}=== TEST: $1 ===${NC}"
}

log_pass() {
    echo -e "${GREEN}✓ PASS: $1${NC}"
    echo "PASS: $1" >> $RESULTS_FILE
}

log_fail() {
    echo -e "${RED}✗ FAIL: $1${NC}"
    echo "FAIL: $1" >> $RESULTS_FILE
}

check_json() {
    if echo "$1" | jq . > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Initialize
echo "Starting E2E Test Suite" > $RESULTS_FILE
echo "Workspace: $WORKSPACE_ID" >> $RESULTS_FILE
echo "Started at: $(date)" >> $RESULTS_FILE
echo ""

# =============================================================================
# TEST 1: WORKSPACE CONFIGURATION LAYER
# =============================================================================
log_test "1. Workspace Configuration - Get Default Config"

response=$(curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/workspace-config")
if check_json "$response" && echo "$response" | jq -e '.success == true' > /dev/null; then
    is_default=$(echo "$response" | jq -r '.is_default')
    coverage_target=$(echo "$response" | jq -r '.config.thresholds.coverage_target')
    stale_days=$(echo "$response" | jq -r '.config.thresholds.stale_deal_days')

    log_pass "Get config (is_default=$is_default, coverage=$coverage_target, stale=$stale_days days)"
else
    log_fail "Get config - Invalid response"
fi

# Test 1B: Update Config
log_test "1B. Update Workspace Config (coverage 4.0, stale 21 days)"

update_response=$(curl -s -X PATCH "$BASE_URL/api/workspaces/$WORKSPACE_ID/workspace-config/thresholds" \
  -H "Content-Type: application/json" \
  -d '{
    "stale_deal_days": 21,
    "critical_stale_days": 45,
    "coverage_target": 4.0,
    "minimum_contacts_per_deal": 3
  }')

if check_json "$update_response" && echo "$update_response" | jq -e '.success == true' > /dev/null; then
    new_stale=$(echo "$update_response" | jq -r '.config.thresholds.stale_deal_days')
    new_coverage=$(echo "$update_response" | jq -r '.config.thresholds.coverage_target')

    if [ "$new_stale" = "21" ] && [ "$new_coverage" = "4" ]; then
        log_pass "Update config - Values updated correctly"
    else
        log_fail "Update config - Values not persisted (stale=$new_stale, coverage=$new_coverage)"
    fi
else
    log_fail "Update config - Request failed"
fi

# =============================================================================
# TEST 2: CUSTOM FUNNEL DEFINITIONS
# =============================================================================
log_test "2. Funnel Definitions - List Templates"

templates=$(curl -s "$BASE_URL/api/funnel/templates")
if check_json "$templates"; then
    template_count=$(echo "$templates" | jq '. | length')

    if [ "$template_count" -ge 5 ]; then
        log_pass "List templates - Found $template_count templates"
    else
        log_fail "List templates - Expected 5+, got $template_count"
    fi
else
    log_fail "List templates - Invalid JSON response"
fi

# Test 2B: Get Current Funnel
log_test "2B. Get Workspace Funnel"

funnel=$(curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/funnel")
if check_json "$funnel"; then
    if echo "$funnel" | jq -e 'has("id")' > /dev/null; then
        model_type=$(echo "$funnel" | jq -r '.model_type')
        stage_count=$(echo "$funnel" | jq '.stages | length')
        status=$(echo "$funnel" | jq -r '.status')

        log_pass "Get funnel - $model_type with $stage_count stages (status: $status)"
    else
        log_pass "Get funnel - No funnel defined yet (expected for new workspace)"
    fi
else
    log_fail "Get funnel - Invalid response"
fi

# =============================================================================
# TEST 3: STAGE HISTORY BACKFILL
# =============================================================================
log_test "3. Stage History - Check Stats"

stats=$(curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/stage-history/stats")
if check_json "$stats"; then
    total_deals=$(echo "$stats" | jq -r '.totalDeals')
    deals_with_history=$(echo "$stats" | jq -r '.dealsWithHistory')
    total_entries=$(echo "$stats" | jq -r '.totalHistoryEntries')

    if [ "$total_deals" -gt 0 ]; then
        coverage_pct=$((deals_with_history * 100 / total_deals))
        log_pass "Stage history stats - $deals_with_history/$total_deals deals ($coverage_pct%), $total_entries entries"
    else
        log_fail "Stage history stats - No deals found"
    fi
else
    log_fail "Stage history stats - Invalid response"
fi

# =============================================================================
# TEST 4: CONTACT ROLE RESOLUTION
# =============================================================================
log_test "4. Contact Role Resolution - Check Coverage"

# Query database for role statistics
role_stats=$(curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/contacts?limit=100" | \
    jq '[.[] | select(.custom_fields.buying_role != null)] | length')

if [ -n "$role_stats" ] && [ "$role_stats" -gt 0 ]; then
    log_pass "Contact roles - $role_stats contacts have inferred roles"
else
    log_fail "Contact roles - No roles found or query failed"
fi

# =============================================================================
# TEST 5: SKILL EXECUTION
# =============================================================================
log_test "5A. Pipeline Goals Skill"

skill_start=$(date +%s)
pipeline_result=$(curl -s -X POST "$BASE_URL/api/skills/pipeline-goals/run" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}")

skill_end=$(date +%s)
skill_duration=$((skill_end - skill_start))

if check_json "$pipeline_result"; then
    status=$(echo "$pipeline_result" | jq -r '.status')

    if [ "$status" = "completed" ]; then
        log_pass "Pipeline goals - Completed in ${skill_duration}s"
    else
        log_fail "Pipeline goals - Status: $status"
    fi
else
    log_fail "Pipeline goals - Invalid response"
fi

# Test 5B: Deal Risk Review (Latency Test)
log_test "5B. Deal Risk Review (Latency)"

risk_start=$(date +%s)
risk_result=$(curl -s -X POST "$BASE_URL/api/skills/deal-risk-review/run" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}")

risk_end=$(date +%s)
risk_duration=$((risk_end - risk_start))

if check_json "$risk_result"; then
    status=$(echo "$risk_result" | jq -r '.status')

    if [ "$status" = "completed" ]; then
        if [ "$risk_duration" -lt 60 ]; then
            log_pass "Deal risk review - Completed in ${risk_duration}s (target <60s)"
        else
            log_fail "Deal risk review - Took ${risk_duration}s (exceeds 60s target)"
        fi
    else
        log_fail "Deal risk review - Status: $status"
    fi
else
    log_fail "Deal risk review - Invalid response"
fi

# =============================================================================
# TEST 6: SKILL CACHING
# =============================================================================
log_test "6. Skill Caching - Run Twice"

# First run (should execute)
cache_start1=$(date +%s)
cache_result1=$(curl -s -X POST "$BASE_URL/api/skills/pipeline-coverage/run" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}")
cache_end1=$(date +%s)
cache_duration1=$((cache_end1 - cache_start1))

# Second run (should cache)
sleep 2
cache_start2=$(date +%s)
cache_result2=$(curl -s -X POST "$BASE_URL/api/skills/pipeline-coverage/run" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}")
cache_end2=$(date +%s)
cache_duration2=$((cache_end2 - cache_start2))

if [ "$cache_duration2" -lt "$((cache_duration1 / 2))" ]; then
    log_pass "Skill caching - Second run cached (${cache_duration1}s → ${cache_duration2}s)"
else
    log_fail "Skill caching - Second run not cached (${cache_duration1}s → ${cache_duration2}s)"
fi

# =============================================================================
# TEST 7: AGENT RUN
# =============================================================================
log_test "7. Agent Run - Attainment vs Goal"

agent_start=$(date +%s)
agent_result=$(curl -s -X POST "$BASE_URL/api/agents/attainment-vs-goal/run" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\": \"$WORKSPACE_ID\"}")

agent_end=$(date +%s)
agent_duration=$((agent_end - agent_start))

if check_json "$agent_result"; then
    status=$(echo "$agent_result" | jq -r '.status')

    if [ "$status" = "completed" ]; then
        skill_count=$(echo "$agent_result" | jq '.skills | length')
        log_pass "Agent run - Completed $skill_count skills in ${agent_duration}s"
    else
        log_fail "Agent run - Status: $status"
    fi
else
    log_fail "Agent run - Invalid response"
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "========================================"
echo "           TEST SUMMARY"
echo "========================================"
echo ""

total_tests=$(grep -c "^PASS:\|^FAIL:" $RESULTS_FILE)
passed_tests=$(grep -c "^PASS:" $RESULTS_FILE)
failed_tests=$(grep -c "^FAIL:" $RESULTS_FILE)

echo "Total Tests: $total_tests"
echo -e "${GREEN}Passed: $passed_tests${NC}"
echo -e "${RED}Failed: $failed_tests${NC}"
echo ""

if [ $failed_tests -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    echo ""
    echo "Failed tests:"
    grep "^FAIL:" $RESULTS_FILE
    exit 1
fi
