#!/bin/bash

WORKSPACE_ID="b5318340-37f0-4815-9a42-d6644b01a298"
API_BASE="http://localhost:3000/api/workspaces/$WORKSPACE_ID"
BATCH_ID="9faf28fb-e1aa-4227-b4ce-d9f51484d8de"

echo "=== Test 3.2: Confirm Deal Import ==="
echo "Batch ID: $BATCH_ID"
echo

curl -X POST "$API_BASE/import/confirm" \
  -H "Content-Type: application/json" \
  -d "{\"batchId\": \"$BATCH_ID\", \"strategy\": \"replace\"}" \
  -o /tmp/deal_confirm_response.json \
  -w "\nHTTP Status: %{http_code}\n"

echo
echo "Response saved to: /tmp/deal_confirm_response.json"
echo
cat /tmp/deal_confirm_response.json | jq '.' 2>/dev/null || cat /tmp/deal_confirm_response.json
