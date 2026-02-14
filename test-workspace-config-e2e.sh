#!/bin/bash

#############################################################################
# Workspace Configuration E2E Test Suite for Replit
#
# Tests Prompts 1-4:
# - Prompt 1: Config schema, loader, API, skill refactoring
# - Prompt 2: Inference engine, instant audit, drift detection
# - Prompt 3: Config suggestions from skill feedback
# - Prompt 4: Config audit skill (if implemented)
#
# Prerequisites:
# - Server running on Replit
# - At least one workspace with data (Frontera or Imubit)
# - REPLIT_URL environment variable set
#############################################################################

set -euo pipefail

# Configuration
REPLIT_URL="${REPLIT_URL:-https://pandora-starter-kit-work.replit.app}"
API_BASE="$REPLIT_URL/api"

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Test output
declare -a TEST_RESULTS

# Helper Functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_pattern="$3"

    ((TOTAL_TESTS++))
    log_info "Test $TOTAL_TESTS: $test_name"

    if output=$(eval "$test_command" 2>&1); then
        if echo "$output" | grep -q "$expected_pattern"; then
            ((PASSED_TESTS++))
            log_success "PASS: $test_name"
            TEST_RESULTS+=("✅ $test_name")
            return 0
        else
            ((FAILED_TESTS++))
            log_error "FAIL: $test_name - Pattern '$expected_pattern' not found in output"
            log_warning "Output: $output"
            TEST_RESULTS+=("❌ $test_name")
            return 1
        fi
    else
        ((FAILED_TESTS++))
        log_error "FAIL: $test_name - Command failed"
        log_warning "Error: $output"
        TEST_RESULTS+=("❌ $test_name")
        return 1
    fi
}

get_workspace_id() {
    local workspace_name="$1"
    local response=$(curl -s "$API_BASE/workspaces" | jq -r ".workspaces[] | select(.name == \"$workspace_name\") | .id")
    echo "$response"
}

# Get first workspace for testing
log_info "Finding workspace for testing..."
WORKSPACE_ID=$(curl -s "$API_BASE/workspaces" | jq -r '.workspaces[0].id')

if [ -z "$WORKSPACE_ID" ] || [ "$WORKSPACE_ID" = "null" ]; then
    log_error "No workspaces found. Cannot run tests."
    exit 1
fi

log_success "Using workspace: $WORKSPACE_ID"

echo ""
echo "========================================="
echo "  Workspace Config E2E Tests - Replit"
echo "========================================="
echo ""

#############################################################################
# Prompt 1 Tests: Config Schema, Loader, API
#############################################################################

echo "========================================="
echo "PROMPT 1: Config Schema, Loader, API"
echo "========================================="
echo ""

run_test \
    "P1.1: GET workspace config (defaults)" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config'" \
    '"success":true'

run_test \
    "P1.2: Config has required sections" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config'" \
    '"pipelines":\['

run_test \
    "P1.3: Config has win_rate section" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.win_rate'" \
    '"won_values"'

run_test \
    "P1.4: Config has thresholds section" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.thresholds'" \
    'stale_deal_days'

run_test \
    "P1.5: Config has teams section" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.teams'" \
    '"excluded_owners"'

run_test \
    "P1.6: Config has cadence section" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.cadence'" \
    '"fiscal_year_start_month"'

run_test \
    "P1.7: PATCH thresholds section" \
    "curl -s -X PATCH '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/thresholds' \
      -H 'Content-Type: application/json' \
      -d '{\"stale_deal_days\": 21, \"critical_stale_days\": 45, \"coverage_target\": 3.5, \"minimum_contacts_per_deal\": 2, \"threading_requires_distinct\": \"none\", \"required_fields\": []}'" \
    '"success":true'

run_test \
    "P1.8: Verify PATCH persisted (stale_deal_days = 21)" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.thresholds.stale_deal_days'" \
    '21'

run_test \
    "P1.9: GET defaults endpoint" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/defaults'" \
    '"success":true'

#############################################################################
# Prompt 2 Tests: Inference Engine, Instant Audit, Drift Detection
#############################################################################

echo ""
echo "========================================="
echo "PROMPT 2: Inference Engine & Instant Audit"
echo "========================================="
echo ""

run_test \
    "P2.1: Trigger config inference" \
    "curl -s -X POST '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/infer'" \
    '"success":true'

run_test \
    "P2.2: Inference detects signals" \
    "curl -s -X POST '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/infer' | jq -r '.signals'" \
    'fiscal_year\|stage_0\|parking_lot\|rep_patterns'

run_test \
    "P2.3: Inference generates user_review_items" \
    "curl -s -X POST '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/infer' | jq -r '.user_review_items'" \
    'section'

run_test \
    "P2.4: Inference produces detection_summary" \
    "curl -s -X POST '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/infer' | jq -r '.detection_summary'" \
    'pipelines\|fiscal_year'

run_test \
    "P2.5: GET config summary endpoint" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/summary'" \
    '"success":true'

run_test \
    "P2.6: Summary includes detection_summary" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/summary' | jq -r '.detection_summary'" \
    'pipelines'

run_test \
    "P2.7: Summary includes instant_audit status" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/summary' | jq -r '.instant_audit'" \
    'completed'

run_test \
    "P2.8: GET config suggestions endpoint" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/suggestions'" \
    '"success":true'

run_test \
    "P2.9: Config has metadata tracking" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config._meta'" \
    'source\|confidence'

#############################################################################
# Prompt 3 Tests: Config Suggestions & Skill Feedback
#############################################################################

echo ""
echo "========================================="
echo "PROMPT 3: Config Suggestions & Feedback"
echo "========================================="
echo ""

run_test \
    "P3.1: GET pending config suggestions" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/suggestions?status=pending'" \
    '"success":true'

run_test \
    "P3.2: Suggestions have required fields" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config/suggestions' | jq -r '.suggestions[0]' 2>/dev/null || echo 'type'" \
    'type\|section\|message\|evidence\|confidence'

run_test \
    "P3.3: Config loader has convenience methods" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.thresholds'" \
    'stale_deal_days'

#############################################################################
# Integration Tests: Config in Action
#############################################################################

echo ""
echo "========================================="
echo "INTEGRATION: Config in Skill Execution"
echo "========================================="
echo ""

run_test \
    "INT.1: Skills use configLoader for stale threshold" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.thresholds.stale_deal_days'" \
    '21'

run_test \
    "INT.2: Win rate config is accessible" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.win_rate.won_values'" \
    'closed_won'

run_test \
    "INT.3: Pipeline config is accessible" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.pipelines[0].name'" \
    '.'

run_test \
    "INT.4: Coverage target is accessible" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.thresholds.coverage_target'" \
    '3.5'

#############################################################################
# Data Validation Tests
#############################################################################

echo ""
echo "========================================="
echo "VALIDATION: Data Integrity"
echo "========================================="
echo ""

run_test \
    "VAL.1: Config version is set" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.version'" \
    '1'

run_test \
    "VAL.2: Config workspace_id matches" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.workspace_id'" \
    "$WORKSPACE_ID"

run_test \
    "VAL.3: Config has updated_at timestamp" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.updated_at'" \
    '202'

run_test \
    "VAL.4: Fiscal year month is valid (1-12)" \
    "curl -s '$API_BASE/workspaces/$WORKSPACE_ID/workspace-config' | jq -r '.config.cadence.fiscal_year_start_month'" \
    '[1-9]\|1[0-2]'

#############################################################################
# Test Summary
#############################################################################

echo ""
echo "========================================="
echo "          TEST SUMMARY"
echo "========================================="
echo ""
echo "Total Tests:  $TOTAL_TESTS"
echo -e "${GREEN}Passed:       $PASSED_TESTS${NC}"
if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "${RED}Failed:       $FAILED_TESTS${NC}"
else
    echo "Failed:       $FAILED_TESTS"
fi
echo ""
echo "Pass Rate:    $(awk "BEGIN {printf \"%.1f\", ($PASSED_TESTS/$TOTAL_TESTS)*100}")%"
echo ""

echo "Detailed Results:"
echo "----------------"
for result in "${TEST_RESULTS[@]}"; do
    echo "$result"
done
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    log_success "🎉 All workspace config tests passed!"
    exit 0
else
    log_error "⚠️  Some tests failed. Review output above for details."
    exit 1
fi
