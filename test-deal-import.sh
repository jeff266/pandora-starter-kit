#!/bin/bash

WORKSPACE_ID="b5318340-37f0-4815-9a42-d6644b01a298"
API_BASE="http://localhost:3000/api/workspaces/$WORKSPACE_ID"

echo "=== PHASE 3: Deal Import ==="
echo "Test 3.1: Upload opportunities.csv"
echo

curl -X POST "$API_BASE/import/upload?entityType=deal" \
  -F "file=@/Users/jeffignacio/Downloads/opportunities.csv" \
  -o /tmp/deal_upload_response.json \
  -w "\nHTTP Status: %{http_code}\n"

echo
echo "Response saved to: /tmp/deal_upload_response.json"
echo
cat /tmp/deal_upload_response.json | jq '.' 2>/dev/null || cat /tmp/deal_upload_response.json
