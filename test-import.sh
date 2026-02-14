#!/bin/bash

WORKSPACE_ID="b5318340-37f0-4815-9a42-d6644b01a298"
API_BASE="http://localhost:3000/api/workspaces/$WORKSPACE_ID"

echo "=== PHASE 1: Account Import ==="
echo "Test 1.1: Upload accounts.csv"
echo

curl -X POST "$API_BASE/import/upload?entityType=account" \
  -F "file=@/Users/jeffignacio/Downloads/accounts.csv" \
  -o /tmp/account_upload_response.json \
  -w "\nHTTP Status: %{http_code}\n"

echo
echo "Response saved to: /tmp/account_upload_response.json"
echo
cat /tmp/account_upload_response.json | jq '.' 2>/dev/null || cat /tmp/account_upload_response.json
