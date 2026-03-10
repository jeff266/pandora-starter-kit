#!/bin/bash
#
# Quick curl-based test for role-based data scoping
#
# Usage:
#   ./server/scripts/test-data-scoping-curl.sh
#
# Prerequisites:
#   - Server running on localhost:3001
#   - Valid JWT tokens for admin and non-admin users
#   - At least one workspace with deals

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "=== Role-Based Data Scoping Test (curl) ==="
echo ""

# Configuration - UPDATE THESE VALUES
API_BASE="http://localhost:3001/api"
WORKSPACE_ID="${WORKSPACE_ID:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
REP_TOKEN="${REP_TOKEN:-}"

# Prompt for missing values
if [ -z "$WORKSPACE_ID" ]; then
    echo -n "Enter workspace_id: "
    read WORKSPACE_ID
fi

if [ -z "$ADMIN_TOKEN" ]; then
    echo ""
    echo "To get admin JWT token:"
    echo "  1. Log in to Pandora as an admin"
    echo "  2. Open browser DevTools → Application → Local Storage"
    echo "  3. Copy the 'pandora_auth_token' value"
    echo ""
    echo -n "Enter admin JWT token: "
    read ADMIN_TOKEN
fi

if [ -z "$REP_TOKEN" ]; then
    echo ""
    echo "To get rep/viewer JWT token:"
    echo "  1. Log in to Pandora as a rep/viewer (non-admin)"
    echo "  2. Open browser DevTools → Application → Local Storage"
    echo "  3. Copy the 'pandora_auth_token' value"
    echo ""
    echo -n "Enter rep/viewer JWT token: "
    read REP_TOKEN
fi

echo ""
echo "Configuration:"
echo "  Workspace: $WORKSPACE_ID"
echo "  API Base:  $API_BASE"
echo ""

# Test 1: Admin user - should see all deals
echo "----------------------------------------"
echo "Test 1: Admin user (should see all deals)"
echo "----------------------------------------"
echo ""

ADMIN_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$API_BASE/workspaces/$WORKSPACE_ID/deals?limit=5")

ADMIN_HTTP_CODE=$(echo "$ADMIN_RESPONSE" | tail -n1)
ADMIN_BODY=$(echo "$ADMIN_RESPONSE" | sed '$d')

if [ "$ADMIN_HTTP_CODE" == "200" ]; then
    ADMIN_TOTAL=$(echo "$ADMIN_BODY" | grep -o '"total":[0-9]*' | grep -o '[0-9]*')
    ADMIN_COUNT=$(echo "$ADMIN_BODY" | grep -o '"data":\[' | wc -l)

    echo -e "${GREEN}✅ Admin request succeeded${NC}"
    echo "   HTTP Status: $ADMIN_HTTP_CODE"
    echo "   Total deals: $ADMIN_TOTAL"
    echo "   Deals returned: $(echo "$ADMIN_BODY" | grep -o '"id":' | wc -l)"
    echo ""

    # Show first deal owner
    FIRST_OWNER=$(echo "$ADMIN_BODY" | grep -o '"owner":"[^"]*"' | head -1 | cut -d'"' -f4)
    FIRST_OWNER_EMAIL=$(echo "$ADMIN_BODY" | grep -o '"owner_email":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "   Sample deal owner: $FIRST_OWNER ($FIRST_OWNER_EMAIL)"
else
    echo -e "${RED}❌ Admin request failed${NC}"
    echo "   HTTP Status: $ADMIN_HTTP_CODE"
    echo "   Response: $ADMIN_BODY"
fi

echo ""

# Test 2: Rep/Viewer user - should see only own deals
echo "----------------------------------------"
echo "Test 2: Rep/Viewer user (should see only own deals)"
echo "----------------------------------------"
echo ""

REP_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $REP_TOKEN" \
    "$API_BASE/workspaces/$WORKSPACE_ID/deals?limit=100")

REP_HTTP_CODE=$(echo "$REP_RESPONSE" | tail -n1)
REP_BODY=$(echo "$REP_RESPONSE" | sed '$d')

if [ "$REP_HTTP_CODE" == "200" ]; then
    REP_TOTAL=$(echo "$REP_BODY" | grep -o '"total":[0-9]*' | grep -o '[0-9]*')

    echo -e "${GREEN}✅ Rep request succeeded${NC}"
    echo "   HTTP Status: $REP_HTTP_CODE"
    echo "   Total deals: $REP_TOTAL"
    echo "   Deals returned: $(echo "$REP_BODY" | grep -o '"id":' | wc -l)"
    echo ""

    # Get unique owners from response
    UNIQUE_OWNERS=$(echo "$REP_BODY" | grep -o '"owner_email":"[^"]*"' | cut -d'"' -f4 | sort -u)
    OWNER_COUNT=$(echo "$UNIQUE_OWNERS" | grep -v '^$' | wc -l)

    echo "   Unique owner_email values: $OWNER_COUNT"
    if [ "$OWNER_COUNT" -eq 1 ]; then
        echo -e "   ${GREEN}✅ Only one owner (correct)${NC}"
        echo "   Owner: $UNIQUE_OWNERS"
    elif [ "$OWNER_COUNT" -gt 1 ]; then
        echo -e "   ${RED}❌ Multiple owners found (scoping not working)${NC}"
        echo "   Owners: $UNIQUE_OWNERS"
    else
        echo -e "   ${YELLOW}⚠️  No owner_email values (check if deals have owner_email populated)${NC}"
    fi
else
    echo -e "${RED}❌ Rep request failed${NC}"
    echo "   HTTP Status: $REP_HTTP_CODE"
    echo "   Response: $REP_BODY"
fi

echo ""

# Comparison
echo "========================================="
echo "Comparison:"
echo "========================================="
echo ""

if [ "$ADMIN_HTTP_CODE" == "200" ] && [ "$REP_HTTP_CODE" == "200" ]; then
    echo "  Admin sees:      $ADMIN_TOTAL deals"
    echo "  Rep/Viewer sees: $REP_TOTAL deals"
    echo ""

    if [ "$ADMIN_TOTAL" -gt "$REP_TOTAL" ]; then
        echo -e "${GREEN}✅ PASS: Admin sees more deals than rep (scoping working)${NC}"
    elif [ "$ADMIN_TOTAL" -eq "$REP_TOTAL" ] && [ "$ADMIN_TOTAL" -gt 0 ]; then
        echo -e "${YELLOW}⚠️  WARNING: Admin and rep see same number of deals${NC}"
        echo "   This might be correct if:"
        echo "   - Rep owns all deals in workspace"
        echo "   - Rep has admin-level permissions (data.deals_view = true)"
    elif [ "$ADMIN_TOTAL" -eq 0 ]; then
        echo -e "${YELLOW}⚠️  No deals in workspace${NC}"
    else
        echo -e "${RED}❌ FAIL: Unexpected counts${NC}"
    fi
else
    echo -e "${RED}❌ Cannot compare: One or both requests failed${NC}"
fi

echo ""
echo "========================================="
echo ""

# Next steps
echo "Next steps:"
echo "  1. Run full test suite:"
echo "     npx tsx server/scripts/test-data-scoping.ts $WORKSPACE_ID"
echo ""
echo "  2. Test impersonation (admin viewing as rep):"
echo "     GET /api/auth/impersonate/:userId"
echo ""
echo "  3. Check email consistency:"
echo "     npx tsx server/scripts/check-email-consistency.ts $WORKSPACE_ID"
echo ""
