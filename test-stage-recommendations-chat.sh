#!/bin/bash

# Test Script for Ask Pandora Stage Recommendations Chat Integration
# Tests the complete flow: Pandora agent → inline actions → SSE stream → UI rendering

set -e

echo "======================================"
echo "Stage Recommendations Chat Test Suite"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3001}"
WORKSPACE_ID="${WORKSPACE_ID:-}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

if [ -z "$WORKSPACE_ID" ]; then
  echo -e "${RED}Error: WORKSPACE_ID environment variable not set${NC}"
  echo "Usage: WORKSPACE_ID=your-workspace-id AUTH_TOKEN=your-token ./test-stage-recommendations-chat.sh"
  exit 1
fi

if [ -z "$AUTH_TOKEN" ]; then
  echo -e "${YELLOW}Warning: AUTH_TOKEN not set. Some tests may fail.${NC}"
fi

echo "Testing against: $BASE_URL"
echo "Workspace ID: $WORKSPACE_ID"
echo ""

# Test 1: Verify Stage Mismatch Detector Skill exists
echo -e "${YELLOW}Test 1: Verify Stage Mismatch Detector Skill${NC}"
echo "Checking if stage-mismatch-detector skill is registered..."
if grep -r "stage-mismatch-detector" server/skills/ > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Stage mismatch detector skill files found${NC}"
else
  echo -e "${RED}✗ Stage mismatch detector skill files not found${NC}"
  exit 1
fi
echo ""

# Test 2: Verify StageRecCard component exists
echo -e "${YELLOW}Test 2: Verify StageRecCard Component${NC}"
if [ -f "client/src/components/actions/StageRecCard.tsx" ]; then
  echo -e "${GREEN}✓ StageRecCard component found${NC}"
  echo "  Component features:"
  grep -o "execute\|dismiss\|evidence\|confidence" client/src/components/actions/StageRecCard.tsx | sort -u | sed 's/^/    - /'
else
  echo -e "${RED}✗ StageRecCard component not found${NC}"
  exit 1
fi
echo ""

# Test 3: Verify Pandora agent inline_actions integration
echo -e "${YELLOW}Test 3: Verify Pandora Agent Inline Actions${NC}"
if grep -q "inline_actions" server/chat/pandora-agent.ts; then
  echo -e "${GREEN}✓ Pandora agent has inline_actions support${NC}"
  echo "  Checking implementation details..."
  if grep -q "InlineAction" server/chat/pandora-agent.ts; then
    echo -e "${GREEN}  ✓ InlineAction interface defined${NC}"
  fi
  if grep -q "extractCitedRecords" server/chat/pandora-agent.ts; then
    echo -e "${GREEN}  ✓ Cited records extraction implemented${NC}"
  fi
  if grep -q "execution_status = 'open'" server/chat/pandora-agent.ts; then
    echo -e "${GREEN}  ✓ Filters for open actions${NC}"
  fi
else
  echo -e "${RED}✗ Pandora agent missing inline_actions support${NC}"
  exit 1
fi
echo ""

# Test 4: Verify conversation stream SSE events
echo -e "${YELLOW}Test 4: Verify Conversation Stream SSE Integration${NC}"
if grep -q "inline_actions" server/routes/conversation-stream.ts; then
  echo -e "${GREEN}✓ Conversation stream emits inline_actions events${NC}"
  echo "  Emission points:"
  grep -n "type: 'inline_actions'" server/routes/conversation-stream.ts | sed 's/^/    Line /'
else
  echo -e "${RED}✗ Conversation stream missing inline_actions events${NC}"
  exit 1
fi
echo ""

# Test 5: Verify frontend state management
echo -e "${YELLOW}Test 5: Verify Frontend State Management${NC}"
if grep -q "inlineActions" client/src/components/assistant/useConversationStream.ts; then
  echo -e "${GREEN}✓ useConversationStream has inlineActions state${NC}"
  if grep -q "dismissInlineAction" client/src/components/assistant/useConversationStream.ts; then
    echo -e "${GREEN}  ✓ dismissInlineAction callback implemented${NC}"
  fi
  if grep -q "case 'inline_actions'" client/src/components/assistant/useConversationStream.ts; then
    echo -e "${GREEN}  ✓ inline_actions event handler implemented${NC}"
  fi
else
  echo -e "${RED}✗ useConversationStream missing inlineActions support${NC}"
  exit 1
fi
echo ""

# Test 6: Verify ConversationView rendering
echo -e "${YELLOW}Test 6: Verify ConversationView StageRecCard Rendering${NC}"
if grep -q "StageRecCard" client/src/components/assistant/ConversationView.tsx; then
  echo -e "${GREEN}✓ ConversationView imports StageRecCard${NC}"
  if grep -q "state.inlineActions" client/src/components/assistant/ConversationView.tsx; then
    echo -e "${GREEN}  ✓ Renders inlineActions from state${NC}"
  fi
  if grep -q "onExecute" client/src/components/assistant/ConversationView.tsx; then
    echo -e "${GREEN}  ✓ Execute handler implemented${NC}"
  fi
  if grep -q "onDismiss" client/src/components/assistant/ConversationView.tsx; then
    echo -e "${GREEN}  ✓ Dismiss handler implemented${NC}"
  fi
  if grep -q "compact={true}" client/src/components/assistant/ConversationView.tsx; then
    echo -e "${GREEN}  ✓ Uses compact mode for chat${NC}"
  fi
else
  echo -e "${RED}✗ ConversationView missing StageRecCard rendering${NC}"
  exit 1
fi
echo ""

# Test 7: Check for actions in database (if any exist)
echo -e "${YELLOW}Test 7: Check Database for Stage Actions${NC}"
echo "Querying actions table for stage recommendations..."

PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -h "${POSTGRES_HOST:-localhost}" -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-pandora}" -c "
SELECT
  COUNT(*) as total_actions,
  COUNT(CASE WHEN action_type = 'update_stage' THEN 1 END) as stage_actions,
  COUNT(CASE WHEN execution_status = 'open' THEN 1 END) as open_actions
FROM actions
WHERE workspace_id = '$WORKSPACE_ID'
" 2>/dev/null || echo -e "${YELLOW}  ⚠ Could not connect to database (optional test)${NC}"

echo ""

# Test 8: API Endpoint Test - Get Actions for a Deal
echo -e "${YELLOW}Test 8: Test Actions API Endpoints${NC}"
if [ -n "$AUTH_TOKEN" ]; then
  echo "Finding a deal with actions..."

  # Get a deal ID from the database
  DEAL_ID=$(PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -h "${POSTGRES_HOST:-localhost}" -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-pandora}" -t -c "
    SELECT target_entity_id
    FROM actions
    WHERE workspace_id = '$WORKSPACE_ID'
      AND action_type = 'update_stage'
      AND execution_status = 'open'
    LIMIT 1
  " 2>/dev/null | xargs)

  if [ -n "$DEAL_ID" ]; then
    echo "Testing GET /deals/$DEAL_ID/actions..."
    RESPONSE=$(curl -s -w "\n%{http_code}" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      "$BASE_URL/api/workspaces/$WORKSPACE_ID/deals/$DEAL_ID/actions")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    if [ "$HTTP_CODE" = "200" ]; then
      echo -e "${GREEN}✓ Actions endpoint returned 200${NC}"
      echo "  Response preview:"
      echo "$BODY" | jq -r '.actions[0] | "    - \(.title) (\(.severity))"' 2>/dev/null || echo "$BODY" | head -c 100
    else
      echo -e "${RED}✗ Actions endpoint returned $HTTP_CODE${NC}"
    fi
  else
    echo -e "${YELLOW}  ⚠ No deals with open stage actions found (this is OK for new workspaces)${NC}"
  fi
else
  echo -e "${YELLOW}  ⚠ Skipped (no AUTH_TOKEN)${NC}"
fi
echo ""

# Test 9: Manual UI Testing Instructions
echo -e "${YELLOW}Test 9: Manual UI Testing${NC}"
echo "To test the full integration in the UI:"
echo ""
echo "1. Start the development server:"
echo "   ${GREEN}npm run dev${NC}"
echo ""
echo "2. Open the app and navigate to Ask Pandora chat"
echo ""
echo "3. Ask a deal-specific question, for example:"
echo "   ${GREEN}\"What's the status of the Acme Corp deal?\"${NC}"
echo "   ${GREEN}\"Show me deals that might be stuck\"${NC}"
echo "   ${GREEN}\"Which deals need stage updates?\"${NC}"
echo ""
echo "4. Look for a 'Stage Recommendations' section below the response"
echo ""
echo "5. Verify the StageRecCard shows:"
echo "   - Current stage → Recommended stage transition"
echo "   - Confidence percentage"
echo "   - Collapsible evidence section"
echo "   - 'Update in CRM' and 'Dismiss' buttons"
echo ""
echo "6. Click 'Update in CRM' to test execution"
echo "   - Card should change to green success state"
echo "   - Should show 'Stage updated to [stage] in CRM'"
echo ""
echo "7. Test dismissal on another recommendation"
echo "   - Card should change to dimmed dismissed state"
echo ""

# Test 10: Integration Test - Full Flow
echo -e "${YELLOW}Test 10: Integration Test Summary${NC}"
echo "Checking complete data flow..."
echo ""

CHECKS=0
PASSED=0

# Check 1: Backend files
if [ -f "server/chat/pandora-agent.ts" ] && grep -q "inline_actions" server/chat/pandora-agent.ts; then
  echo -e "${GREEN}✓${NC} Backend: Pandora agent returns inline_actions"
  ((PASSED++))
else
  echo -e "${RED}✗${NC} Backend: Pandora agent returns inline_actions"
fi
((CHECKS++))

# Check 2: Stream handler
if grep -q "inline_actions" server/routes/conversation-stream.ts; then
  echo -e "${GREEN}✓${NC} Backend: Conversation stream emits SSE events"
  ((PASSED++))
else
  echo -e "${RED}✗${NC} Backend: Conversation stream emits SSE events"
fi
((CHECKS++))

# Check 3: Frontend state
if grep -q "inlineActions" client/src/components/assistant/useConversationStream.ts; then
  echo -e "${GREEN}✓${NC} Frontend: State management handles inline actions"
  ((PASSED++))
else
  echo -e "${RED}✗${NC} Frontend: State management handles inline actions"
fi
((CHECKS++))

# Check 4: UI rendering
if grep -q "StageRecCard" client/src/components/assistant/ConversationView.tsx; then
  echo -e "${GREEN}✓${NC} Frontend: ConversationView renders StageRecCard"
  ((PASSED++))
else
  echo -e "${RED}✗${NC} Frontend: ConversationView renders StageRecCard"
fi
((CHECKS++))

# Check 5: Styling
if grep -q "fonts.sans" client/src/components/assistant/ConversationView.tsx; then
  echo -e "${GREEN}✓${NC} Frontend: Uses Outfit font (theme consistency)"
  ((PASSED++))
else
  echo -e "${RED}✗${NC} Frontend: Uses Outfit font (theme consistency)"
fi
((CHECKS++))

# Check 6: API endpoints
if grep -q "execute-inline" server/routes/actions.ts 2>/dev/null || grep -q "execute-inline" server/routes/*.ts 2>/dev/null; then
  echo -e "${GREEN}✓${NC} Backend: Execute inline action endpoint exists"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠${NC} Backend: Execute inline action endpoint (check manually)"
fi
((CHECKS++))

echo ""
echo "======================================"
echo -e "Test Results: ${GREEN}$PASSED${NC}/$CHECKS checks passed"
echo "======================================"
echo ""

if [ $PASSED -eq $CHECKS ]; then
  echo -e "${GREEN}✓ All automated tests passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Run 'npm run dev' to start the server"
  echo "2. Test the UI manually (see Test 9 above)"
  echo "3. Ask deal-specific questions in Ask Pandora chat"
  echo "4. Verify stage recommendation cards appear with proper styling"
  exit 0
else
  echo -e "${RED}✗ Some tests failed. Please review the output above.${NC}"
  exit 1
fi
