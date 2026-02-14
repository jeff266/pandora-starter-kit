#!/bin/bash

WORKSPACE_ID="b5318340-37f0-4815-9a42-d6644b01a298"
API_BASE="http://localhost:3000/api/workspaces/$WORKSPACE_ID"

echo "=== PHASE 2: Contact Import ==="
echo "Test 2.1: Upload contacts.csv"
echo

curl -X POST "$API_BASE/import/upload?entityType=contact" \
  -F "file=@/Users/jeffignacio/Downloads/contacts.csv" \
  -o /tmp/contact_upload_response.json \
  -w "\nHTTP Status: %{http_code}\n"

echo
echo "Response saved to: /tmp/contact_upload_response.json"
echo
cat /tmp/contact_upload_response.json | jq '.' 2>/dev/null || cat /tmp/contact_upload_response.json
