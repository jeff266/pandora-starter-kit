#!/bin/bash

WORKSPACE_ID="b5318340-37f0-4815-9a42-d6644b01a298"
API_BASE="http://localhost:3000/api/workspaces/$WORKSPACE_ID"
BATCH_ID="6f434ab9-56cd-439e-aac1-9d4b49b023f1"

echo "=== Test 2.2: Confirm Contact Import ==="
echo "Batch ID: $BATCH_ID"
echo

curl -X POST "$API_BASE/import/confirm" \
  -H "Content-Type: application/json" \
  -d "{\"batchId\": \"$BATCH_ID\", \"strategy\": \"replace\"}" \
  -o /tmp/contact_confirm_response.json \
  -w "\nHTTP Status: %{http_code}\n"

echo
echo "Response saved to: /tmp/contact_confirm_response.json"
echo
cat /tmp/contact_confirm_response.json | jq '.' 2>/dev/null || cat /tmp/contact_confirm_response.json
