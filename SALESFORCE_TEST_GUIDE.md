# Salesforce Integration - Test Guide

## Overview

This guide explains how to set up and run the end-to-end test suite for Salesforce OAuth Hardening (Prompts 1-6).

The test suite validates:
- ✅ Credential storage and OAuth flow
- ✅ Health monitoring with token freshness
- ✅ Schema discovery
- ✅ Initial sync (deals, contacts, accounts, activities, stage history)
- ✅ Incremental sync
- ✅ File import → Salesforce upgrade path
- ✅ Salesforce ID normalization (15-char vs 18-char)
- ✅ Multi-tenant isolation
- ✅ Error handling

---

## Prerequisites

### 1. Two Salesforce Test Orgs

You need **two separate Salesforce organizations** for testing:
- **Org 1**: Primary test org (required)
- **Org 2**: Secondary test org for multi-tenant isolation (optional but recommended)

### 2. Salesforce Connected App

Create a Connected App in each Salesforce org:

**Steps:**
1. Go to **Setup** → **App Manager** → **New Connected App**
2. Fill in basic information:
   - **Connected App Name**: `Pandora Test`
   - **API Name**: `Pandora_Test`
   - **Contact Email**: Your email
3. Enable OAuth Settings:
   - ✅ **Enable OAuth Settings**
   - **Callback URL**: `http://localhost:5000/api/auth/salesforce/callback`
   - **Selected OAuth Scopes**:
     - Full access (full)
     - Perform requests on your behalf at any time (refresh_token, offline_access)
     - Access and manage your data (api)
4. Save and wait 2-10 minutes for propagation
5. Note the **Consumer Key** and **Consumer Secret**

### 3. Get Access and Refresh Tokens

**Option A: Use OAuth Playground**
1. Go to Salesforce OAuth Playground: https://login.salesforce.com/services/oauth2/authorize
2. Build authorization URL with your Consumer Key
3. Authorize and capture the access token and refresh token

**Option B: Manual OAuth Flow**
1. Start Pandora server: `npm run dev`
2. Visit: `http://localhost:5000/api/workspaces/TEST_WS_ID/connectors/salesforce/authorize`
3. Authorize in Salesforce
4. Extract tokens from database after callback:
   ```sql
   SELECT credentials FROM connections WHERE connector_name = 'salesforce';
   ```

### 4. Set Environment Variables

Create a `.env.test` file or export these variables:

```bash
# Database
export DATABASE_URL="postgresql://user:password@localhost:5432/pandora_test"

# Salesforce Org 1 (Required)
export SF_ORG1_ACCESS_TOKEN="00D..."
export SF_ORG1_REFRESH_TOKEN="5Aep..."
export SF_ORG1_INSTANCE_URL="https://your-org.my.salesforce.com"

# Salesforce Org 2 (Optional - for multi-tenant testing)
export SF_ORG2_ACCESS_TOKEN="00D..."
export SF_ORG2_REFRESH_TOKEN="5Aep..."
export SF_ORG2_INSTANCE_URL="https://your-org-2.my.salesforce.com"

# Salesforce Connected App
export SF_CLIENT_ID="3MVG9..."
export SF_CLIENT_SECRET="ABC123..."
```

**Note:** Access tokens expire after ~2 hours. If tests fail with authentication errors, regenerate tokens.

---

## Running the Tests

### Full Test Suite

```bash
# Build TypeScript
npm run build

# Run all tests
node dist/scripts/test-salesforce.js
```

### Partial Tests (Skip Multi-Tenant)

If you only have one Salesforce org:

```bash
# Don't set SF_ORG2_* variables
unset SF_ORG2_ACCESS_TOKEN
unset SF_ORG2_REFRESH_TOKEN
unset SF_ORG2_INSTANCE_URL

# Run tests (will skip multi-tenant test)
node dist/scripts/test-salesforce.js
```

### Expected Runtime

- Full test suite: **~5-10 minutes**
- Initial sync: ~30-60 seconds (depends on data volume)
- Incremental sync: ~15-30 seconds
- Multi-tenant sync: ~30-60 seconds

---

## Test Breakdown

### Test 1: Credential Storage
**What it tests:** Credentials are stored correctly in database with encryption

**Expected result:**
```
✓ PASS: Credentials stored — Found 1 connection record(s)
✓ PASS: Credentials contain required fields — accessToken and instanceUrl present
```

### Test 2: Health Endpoint
**What it tests:** `/health` endpoint returns status, token freshness, API limits

**Expected result:**
```
✓ PASS: Health endpoint returns healthy status — healthy: true
✓ PASS: Health includes token status — tokenStatus: fresh
✓ PASS: Health includes API limits — API limits: 150/15000
```

**Token status values:**
- `fresh`: < 90 minutes old
- `stale`: 90-120 minutes old (needs refresh)
- `expired`: > 120 minutes old

### Test 3: Schema Discovery
**What it tests:** `/discover-schema` endpoint returns custom fields

**Expected result:**
```
✓ PASS: Schema discovery returns custom fields — Found 25 custom fields
✓ PASS: Custom fields include deal fields — Deal fields: 15
```

### Test 4: Initial Sync
**What it tests:** First sync pulls all opportunities, contacts, accounts

**Expected result:**
```
✓ PASS: Initial sync triggered — Sync initiated
✓ PASS: Deals synced — 617 deals synced
✓ PASS: Contacts synced — 1,234 contacts synced
✓ PASS: Accounts synced — 456 accounts synced
```

**Note:** Counts vary by org size

### Test 5: Activities Sync
**What it tests:** Tasks and Events are synced with 6-month filter

**Expected result:**
```
✓ PASS: Activities synced — 2,543 activities synced
✓ PASS: Activity types include tasks or calls — Types: task, call, email
```

### Test 6: Stage History Sync
**What it tests:** OpportunityFieldHistory → deal_stage_history

**Expected result (if Field History Tracking enabled):**
```
✓ PASS: Stage history synced — 1,234 stage transitions synced
✓ PASS: Stage history has valid transitions — Latest: Prospecting → Qualified
```

**Expected result (if Field History Tracking disabled):**
```
✓ PASS: Stage history synced — No stage history (Field History Tracking may not be enabled)
```

**To enable Field History Tracking:**
1. Setup → Object Manager → Opportunity → Fields & Relationships
2. Click on "Stage" field → Set History Tracking
3. ✅ Enable "Track Field History"
4. Select "Stage" in tracked fields
5. Save and wait ~24 hours for historical data

### Test 7: Deal-Contact Associations
**What it tests:** OpportunityContactRole creates deal_contacts records

**Expected result:**
```
✓ PASS: Deal-contact associations synced — 856 associations synced
✓ PASS: Associations link valid deals and contacts — Sample: Acme Deal ↔ john@acme.com
```

### Test 8: Incremental Sync
**What it tests:** Subsequent syncs only pull modified records

**Expected result:**
```
✓ PASS: Incremental sync triggered — Sync initiated
✓ PASS: Incremental sync completed — Deals: 617 → 617 (or 618 if new deal)
```

### Test 9: File Import → Salesforce Upgrade
**What it tests:** CSV-imported deals match Salesforce deals by external_id

**Expected result:**
```
✓ PASS: Upgrade status endpoint accessible — hasTransitioned: false
✓ PASS: Upgrade marked as transitioned — Transition recorded: 2026-02-13T10:30:00Z
✓ PASS: File-imported deal handled — Deal source: salesforce (matched and upgraded)
```

**Or (if no match):**
```
✓ PASS: File-imported deal handled — Deal source: csv_import (orphaned)
```

### Test 10: Salesforce ID Normalization
**What it tests:** 15-char CSV IDs match 18-char API IDs

**Expected result:**
```
✓ PASS: 15-char and 18-char IDs normalize to same value — 006Dn00000A1bcd === 006Dn00000A1bcd
✓ PASS: Stored source_id is 15 or 18 characters — source_id length: 18
```

### Test 11: Multi-Tenant Isolation
**What it tests:** Two orgs don't see each other's data

**Expected result:**
```
✓ PASS: Workspace 1 has deals — WS1 has deals
✓ PASS: Workspace 2 has deals — WS2 has deals
✓ PASS: Workspaces have different data (no cross-tenant leakage) — source_id values differ
✓ PASS: Workspace isolation maintained — WS1: 617 deals, WS2: 423 deals
```

### Test 12: Error Handling
**What it tests:** Invalid credentials fail gracefully

**Expected result:**
```
✓ PASS: Health endpoint handles invalid credentials — Error message present: true
✓ PASS: Error handling for invalid credentials — Request failed as expected
```

---

## Troubleshooting

### "Missing Credentials" Error

**Problem:** Environment variables not set

**Solution:**
```bash
# Check if variables are set
echo $SF_ORG1_ACCESS_TOKEN
echo $SF_ORG1_INSTANCE_URL

# If empty, source your .env file
source .env.test
```

### "Authentication Failed" Error

**Problem:** Access token expired (tokens expire after ~2 hours)

**Solution:** Regenerate access tokens using OAuth flow or refresh token

### "No deals synced" Error

**Problem:** Salesforce org has no data

**Solution:**
- Create test opportunities in Salesforce
- Or use a demo org with sample data

### "Stage history not synced" Warning

**Problem:** Field History Tracking not enabled for Opportunity.Stage

**Solution:**
1. Setup → Object Manager → Opportunity → Fields
2. Click "Stage" → Set History Tracking
3. ✅ Enable tracking
4. Wait 24 hours for historical data to populate

### "Connection timeout" Error

**Problem:** Salesforce API rate limits or network issues

**Solution:**
- Check API usage: Setup → System Overview → API Usage
- Wait and retry if rate limited
- Check network connectivity to Salesforce

### "Multi-tenant test skipped"

**Problem:** Org 2 credentials not provided

**Solution:**
- Set `SF_ORG2_*` environment variables
- Or accept that multi-tenant test will be skipped (non-critical)

---

## Test Output

### Console Output

```
╔════════════════════════════════════════════════════════════════╗
║   SALESFORCE INTEGRATION - END-TO-END TEST SUITE              ║
╚════════════════════════════════════════════════════════════════╝

🧹 Cleaning up previous test data...
  Cleanup complete.

📦 Setting up test workspaces...
  Workspaces created.

━━━ Test 1: Credential Storage ━━━
  ✓ PASS: Credentials stored — Found 1 connection record(s)
  ✓ PASS: Credentials contain required fields — accessToken and instanceUrl present

━━━ Test 2: Health Endpoint ━━━
  ✓ PASS: Health endpoint returns healthy status — healthy: true
  ✓ PASS: Health includes token status — tokenStatus: fresh
  ✓ PASS: Health includes API limits — API limits: 150/15000

...

╔════════════════════════════════════════════════════════════════╗
║   TEST SUMMARY                                                ║
╚════════════════════════════════════════════════════════════════╝

  ✓ PASSED: 28
  ✗ FAILED: 0
  TOTAL:   28

📄 Detailed results saved to: salesforce-test-results.json
```

### JSON Results File

`salesforce-test-results.json`:
```json
{
  "passed": 28,
  "failed": 0,
  "total": 28,
  "results": [
    {
      "test": "Credentials stored",
      "status": "PASS",
      "detail": "Found 1 connection record(s)"
    },
    ...
  ]
}
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Salesforce Integration Tests

on: [push, pull_request]

jobs:
  test-salesforce:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Build
        run: npm run build

      - name: Run migrations
        run: npm run migrate
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/pandora_test

      - name: Run Salesforce tests
        run: node dist/scripts/test-salesforce.js
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/pandora_test
          SF_ORG1_ACCESS_TOKEN: ${{ secrets.SF_ORG1_ACCESS_TOKEN }}
          SF_ORG1_REFRESH_TOKEN: ${{ secrets.SF_ORG1_REFRESH_TOKEN }}
          SF_ORG1_INSTANCE_URL: ${{ secrets.SF_ORG1_INSTANCE_URL }}
          SF_CLIENT_ID: ${{ secrets.SF_CLIENT_ID }}
          SF_CLIENT_SECRET: ${{ secrets.SF_CLIENT_SECRET }}
```

---

## Summary

The Salesforce test suite provides comprehensive validation of:
- OAuth flow and credential management
- Health monitoring with token freshness tracking
- Schema discovery with custom field detection
- Complete data sync (opportunities, contacts, accounts, activities)
- Stage history backfill from OpportunityFieldHistory
- Deal-contact associations via OpportunityContactRole
- Incremental sync with SystemModstamp filtering
- File import → Salesforce upgrade with ID normalization
- Multi-tenant data isolation
- Graceful error handling

**Total test coverage:** 12 test groups, ~28 individual assertions

**Runtime:** ~5-10 minutes for full suite

**Exit code:** 0 if all tests pass, 1 if any test fails (CI/CD friendly)
