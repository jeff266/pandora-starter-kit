#!/bin/bash

WORKSPACE_ID="b5318340-37f0-4815-9a42-d6644b01a298"
API_BASE="http://localhost:3000/api/workspaces/$WORKSPACE_ID"
BATCH_ID="c61b5501-7617-4ad8-938c-01efdba1fe89"

echo "=== Test 1.2: Confirm Account Import ==="
echo "Batch ID: $BATCH_ID"
echo

curl -X POST "$API_BASE/import/confirm" \
  -H "Content-Type: application/json" \
  -d "{\"batchId\": \"$BATCH_ID\", \"strategy\": \"replace\"}" \
  -o /tmp/account_confirm_response.json \
  -w "\nHTTP Status: %{http_code}\n"

echo
echo "Response saved to: /tmp/account_confirm_response.json"
echo
cat /tmp/account_confirm_response.json | jq '.' 2>/dev/null || cat /tmp/account_confirm_response.json
