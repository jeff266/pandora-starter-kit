#!/bin/bash

# Quick API Test Script for Stage Recommendations
# Tests the key API endpoints

set -e

echo "Quick API Test - Stage Recommendations"
echo "======================================="
echo ""

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3001}"
WORKSPACE_ID="${WORKSPACE_ID:-}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

if [ -z "$WORKSPACE_ID" ] || [ -z "$AUTH_TOKEN" ]; then
  echo "Error: Missing required environment variables"
  echo ""
  echo "Usage:"
  echo "  WORKSPACE_ID=your-workspace-id AUTH_TOKEN=your-token ./test-api-quick.sh"
  echo ""
  echo "To get your auth token:"
  echo "  1. Log into the app in your browser"
  echo "  2. Open DevTools → Application → Local Storage"
  echo "  3. Copy the 'auth_token' value"
  exit 1
fi

echo "Testing: $BASE_URL"
echo "Workspace: $WORKSPACE_ID"
echo ""

# Helper function to make API calls
api_test() {
  local METHOD=$1
  local ENDPOINT=$2
  local DESCRIPTION=$3
  local DATA=$4

  echo "Testing: $DESCRIPTION"
  echo "  $METHOD $ENDPOINT"

  if [ -n "$DATA" ]; then
    RESPONSE=$(curl -s -w "\n%{http_code}" -X "$METHOD" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$DATA" \
      "$BASE_URL$ENDPOINT")
  else
    RESPONSE=$(curl -s -w "\n%{http_code}" -X "$METHOD" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      "$BASE_URL$ENDPOINT")
  fi

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "  ✓ Success ($HTTP_CODE)"
    return 0
  else
    echo "  ✗ Failed ($HTTP_CODE)"
    echo "  Response: $BODY"
    return 1
  fi
}

# Test 1: Get actions summary by deal
echo "Test 1: Get Actions Summary by Deal"
echo "------------------------------------"
api_test "GET" "/api/workspaces/$WORKSPACE_ID/actions/summary-by-deal" "Actions summary endpoint"
echo ""

# Test 2: Get actions for a specific deal (if we can find one)
echo "Test 2: Get Actions for Specific Deal"
echo "--------------------------------------"
echo "Finding a deal with actions..."

# Try to get a deal ID from the summary response
DEAL_ID=$(curl -s \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/workspaces/$WORKSPACE_ID/actions/summary-by-deal" \
  | jq -r '.[0].deal_id' 2>/dev/null)

if [ -n "$DEAL_ID" ] && [ "$DEAL_ID" != "null" ]; then
  echo "Testing with deal: $DEAL_ID"
  api_test "GET" "/api/workspaces/$WORKSPACE_ID/deals/$DEAL_ID/actions" "Get deal actions"
else
  echo "  ⚠ No deals with actions found - skipping"
fi
echo ""

# Test 3: Test chat endpoint (simulate a deal-specific question)
echo "Test 3: Ask Pandora Chat with Deal Query"
echo "----------------------------------------"
CHAT_DATA='{
  "message": "Show me deals that need stage updates",
  "thread_id": "test_'$(date +%s)'"
}'

CHAT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$CHAT_DATA" \
  "$BASE_URL/api/workspaces/$WORKSPACE_ID/chat")

CHAT_HTTP_CODE=$(echo "$CHAT_RESPONSE" | tail -n1)
CHAT_BODY=$(echo "$CHAT_RESPONSE" | sed '$d')

if [ "$CHAT_HTTP_CODE" = "200" ]; then
  echo "  ✓ Chat request successful ($CHAT_HTTP_CODE)"

  # Check if inline_actions are in the response
  HAS_INLINE_ACTIONS=$(echo "$CHAT_BODY" | jq 'has("inline_actions")' 2>/dev/null)

  if [ "$HAS_INLINE_ACTIONS" = "true" ]; then
    ACTION_COUNT=$(echo "$CHAT_BODY" | jq '.inline_actions | length' 2>/dev/null)
    echo "  ✓ Response includes inline_actions field"
    echo "  ✓ Found $ACTION_COUNT inline action(s)"

    # Show first action details
    echo ""
    echo "  First action preview:"
    echo "$CHAT_BODY" | jq -r '.inline_actions[0] | "    Title: \(.title)\n    Severity: \(.severity)\n    From: \(.from_value)\n    To: \(.to_value)\n    Confidence: \(.confidence)%"' 2>/dev/null || echo "    (Could not parse action details)"
  else
    echo "  ⚠ Response does not include inline_actions"
    echo "    This is OK if no deals have open stage recommendations"
  fi
else
  echo "  ✗ Chat request failed ($CHAT_HTTP_CODE)"
  echo "  Response: $CHAT_BODY"
fi
echo ""

# Test 4: Execute inline action (if we have an action ID)
echo "Test 4: Execute Inline Action"
echo "------------------------------"

if [ -n "$DEAL_ID" ] && [ "$DEAL_ID" != "null" ]; then
  # Get an action ID for this deal
  ACTION_ID=$(curl -s \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    "$BASE_URL/api/workspaces/$WORKSPACE_ID/deals/$DEAL_ID/actions" \
    | jq -r '.actions[0].id' 2>/dev/null)

  if [ -n "$ACTION_ID" ] && [ "$ACTION_ID" != "null" ]; then
    echo "Testing execute with action: $ACTION_ID"

    EXECUTE_DATA='{"override_value": null}'
    EXECUTE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$EXECUTE_DATA" \
      "$BASE_URL/api/workspaces/$WORKSPACE_ID/actions/$ACTION_ID/execute-inline")

    EXECUTE_HTTP_CODE=$(echo "$EXECUTE_RESPONSE" | tail -n1)

    if [ "$EXECUTE_HTTP_CODE" = "200" ]; then
      echo "  ✓ Execute endpoint works ($EXECUTE_HTTP_CODE)"
    else
      echo "  ✗ Execute failed ($EXECUTE_HTTP_CODE)"
    fi
  else
    echo "  ⚠ No action ID found - skipping execute test"
  fi
else
  echo "  ⚠ No deal ID available - skipping execute test"
fi
echo ""

# Test 5: Dismiss action
echo "Test 5: Dismiss Action"
echo "----------------------"

if [ -n "$DEAL_ID" ] && [ "$DEAL_ID" != "null" ]; then
  # Get a different action ID for dismissal test
  ACTION_ID_2=$(curl -s \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    "$BASE_URL/api/workspaces/$WORKSPACE_ID/deals/$DEAL_ID/actions" \
    | jq -r '.actions[1].id' 2>/dev/null)

  if [ -n "$ACTION_ID_2" ] && [ "$ACTION_ID_2" != "null" ]; then
    echo "Testing dismiss with action: $ACTION_ID_2"

    DISMISS_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      "$BASE_URL/api/workspaces/$WORKSPACE_ID/actions/$ACTION_ID_2/dismiss")

    DISMISS_HTTP_CODE=$(echo "$DISMISS_RESPONSE" | tail -n1)

    if [ "$DISMISS_HTTP_CODE" = "200" ]; then
      echo "  ✓ Dismiss endpoint works ($DISMISS_HTTP_CODE)"
    else
      echo "  ✗ Dismiss failed ($DISMISS_HTTP_CODE)"
    fi
  else
    echo "  ⚠ No second action found - skipping dismiss test"
  fi
else
  echo "  ⚠ No deal ID available - skipping dismiss test"
fi
echo ""

echo "======================================"
echo "API Tests Complete"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Review any failed tests above"
echo "2. Run the full test suite: ./test-stage-recommendations-chat.sh"
echo "3. Test the UI manually using TEST_GUIDE.md"
