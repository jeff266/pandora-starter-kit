# Salesforce OAuth + Sync Orchestrator - Test Plan (Prompt 1)

This test plan validates the OAuth flow and sync orchestrator wiring built in Prompt 1.

---

## Pre-Test Setup

### 1. Verify Environment Variables

Check Replit Secrets:

```bash
echo $SALESFORCE_CLIENT_ID
echo $SALESFORCE_CLIENT_SECRET
echo $SALESFORCE_CALLBACK_URL
```

**Expected:** All three should return values (not empty)

**Callback URL format:** `https://<your-replit-app>.replit.app/api/auth/salesforce/callback`

### 2. Verify Salesforce Adapter is Registered

Check server startup logs for:

```
[AdapterRegistry] Registered salesforce adapter
```

Or query at runtime:

```bash
curl http://localhost:3000/api/connectors | jq '.connectors[] | select(.name == "salesforce")'
```

**Expected:** Salesforce adapter listed with `name: "salesforce"`

### 3. Prepare Test Workspace

Create a test workspace (or use existing):

```sql
-- Get workspace ID
SELECT id, name FROM workspaces LIMIT 1;
```

**Note the workspace ID** - you'll use it throughout testing.

**For these tests, use:**
- Workspace ID: `<your-test-workspace-id>`

---

## Test 1: OAuth Authorization Flow

### Goal
Verify the OAuth flow redirects to Salesforce and handles state correctly.

### Steps

1. **Trigger authorization:**
   ```
   https://<your-replit-app>.replit.app/api/auth/salesforce/authorize?workspaceId=<workspace-id>
   ```

2. **Expected behavior:**
   - Browser redirects to `https://login.salesforce.com/services/oauth2/authorize`
   - URL includes parameters:
     - `client_id=<your-consumer-key>`
     - `redirect_uri=<your-callback-url>`
     - `response_type=code`
     - `scope=api refresh_token offline_access id`
     - `state=<base64-encoded-signed-state>`
     - `prompt=login consent`

3. **Verify state parameter:**
   - Copy the `state` value from the URL
   - It should be in format: `<base64>.<signature>`
   - The base64 part, when decoded, should contain: `{"workspaceId":"<workspace-id>"}`

### Validation

- [ ] Redirects to `login.salesforce.com` (NOT `test.salesforce.com`)
- [ ] All OAuth parameters present
- [ ] State is signed (contains a dot separator)
- [ ] Decoded state contains correct workspace ID

### Troubleshooting

**Issue:** 400 "workspaceId required"
- **Fix:** Add `?workspaceId=<id>` to the URL

**Issue:** 500 error before redirect
- **Fix:** Check that env vars are set

**Issue:** Redirects to `test.salesforce.com`
- **Fix:** Verify code uses `login.salesforce.com` (not configurable)

---

## Test 2: OAuth Callback (Happy Path)

### Goal
Complete the OAuth flow and store credentials.

### Steps

1. **Log in to Salesforce:**
   - Use the authorization URL from Test 1
   - Log in to one of your production orgs
   - Grant permissions

2. **Salesforce redirects to callback:**
   - URL will be: `https://<your-app>/api/auth/salesforce/callback?code=...&state=...`
   - This happens automatically (you don't call it manually)

3. **Expected behavior:**
   - Callback exchanges `code` for tokens
   - Stores credentials in `connector_configs` table
   - Redirects to app: `/?workspace=<workspace-id>&connected=salesforce`

4. **Verify credentials stored:**
   ```sql
   SELECT
     workspace_id,
     connector_name,
     status,
     credentials->>'access_token' as has_access_token,
     credentials->>'refresh_token' as has_refresh_token,
     credentials->>'instance_url' as instance_url,
     credentials->>'org_id' as org_id,
     credentials->>'connected_by' as connected_by,
     created_at
   FROM connector_configs
   WHERE workspace_id = '<workspace-id>' AND connector_name = 'salesforce';
   ```

### Validation

- [ ] Record exists in `connector_configs`
- [ ] `status = 'connected'`
- [ ] `access_token` is present (long string starting with `00D...`)
- [ ] `refresh_token` is present (starts with `5Aep...` or similar)
- [ ] `instance_url` is an HTTPS URL (e.g., `https://na139.salesforce.com`)
- [ ] `org_id` is present (15-character Salesforce ID)
- [ ] `connected_by` is the email of the user who authorized
- [ ] Browser redirected to app with `?connected=salesforce`

### Troubleshooting

**Issue:** "Invalid state signature"
- **Cause:** State verification failed (CSRF protection)
- **Fix:** Check that `SESSION_SECRET` env var is consistent

**Issue:** Token exchange fails (500 error)
- **Cause:** Invalid client credentials
- **Fix:** Verify `SALESFORCE_CLIENT_ID` and `SALESFORCE_CLIENT_SECRET`

**Issue:** Callback returns 400 "Missing code or state"
- **Cause:** Salesforce didn't redirect properly
- **Fix:** Verify callback URL matches Connected App exactly

**Issue:** Credentials not stored
- **Cause:** Database insert failed
- **Fix:** Check server logs for SQL errors

---

## Test 3: OAuth Callback (User Denial)

### Goal
Verify graceful handling when user denies consent.

### Steps

1. **Trigger authorization flow** (Test 1)
2. **In Salesforce consent screen, click "Deny"**
3. **Expected behavior:**
   - Salesforce redirects to callback with `?error=access_denied`
   - Callback redirects to app: `/?error=salesforce_denied`
   - No credentials stored

### Validation

- [ ] Browser shows error message (not a 500 error)
- [ ] No new record in `connector_configs`
- [ ] Error is user-friendly

---

## Test 4: OAuth Re-Authorization (Update Credentials)

### Goal
Verify re-auth updates existing credentials instead of creating duplicates.

### Steps

1. **Complete OAuth flow once** (Test 2)
2. **Trigger authorization flow again** (same workspace)
3. **Log in to Salesforce and grant permissions**
4. **Check database:**
   ```sql
   SELECT COUNT(*) as record_count
   FROM connector_configs
   WHERE workspace_id = '<workspace-id>' AND connector_name = 'salesforce';
   ```

### Validation

- [ ] `record_count = 1` (not 2 or more)
- [ ] `updated_at` timestamp is recent
- [ ] `access_token` changed (re-auth issued new token)
- [ ] `refresh_token` may be the same (Salesforce reuses it)

---

## Test 5: Connection Test Endpoint

### Goal
Verify the test endpoint can query Salesforce.

### Steps

1. **Call test endpoint:**
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/<workspace-id>/connectors/salesforce/test \
     -H "Content-Type: application/json"
   ```

2. **Expected response:**
   ```json
   {
     "success": true,
     "orgName": "Your Org Name",
     "orgId": "00D...",
     "userName": "user@example.com",
     "instanceUrl": "https://na139.salesforce.com"
   }
   ```

### Validation

- [ ] Response status: 200
- [ ] `success: true`
- [ ] `orgName` matches the Salesforce org you connected
- [ ] `orgId` is a 15-character Salesforce ID
- [ ] `userName` matches the user who authorized
- [ ] `instanceUrl` is a valid HTTPS URL

### Troubleshooting

**Issue:** 404 "Salesforce not connected"
- **Fix:** Complete OAuth flow first (Test 2)

**Issue:** 500 error with 401 response from Salesforce
- **Cause:** Access token expired or invalid
- **Fix:** Re-run OAuth flow to get fresh token (Test 4)

**Issue:** Response times out
- **Cause:** `instance_url` incorrect or Salesforce unreachable
- **Fix:** Check `instance_url` in `connector_configs`

---

## Test 6: Schema Discovery Endpoint

### Goal
Verify schema discovery returns Salesforce metadata.

### Steps

1. **Call discover-schema endpoint:**
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/<workspace-id>/connectors/salesforce/discover-schema \
     -H "Content-Type: application/json"
   ```

2. **Expected response:**
   ```json
   {
     "objects": [
       { "name": "Account", "label": "Account", "custom": false, "queryable": true },
       { "name": "Opportunity", "label": "Opportunity", "custom": false, "queryable": true },
       { "name": "Contact", "label": "Contact", "custom": false, "queryable": true },
       ...
     ],
     "totalObjects": 500,
     "customObjects": 50
   }
   ```

### Validation

- [ ] Response status: 200
- [ ] `totalObjects` > 0 (typically 400-700 for production orgs)
- [ ] `objects` array includes "Account", "Opportunity", "Contact"
- [ ] `customObjects` count makes sense (depends on org)
- [ ] Custom objects have `custom: true`

### Notes

- Standard objects: `Account`, `Contact`, `Opportunity`, `Lead`, `Case`, `Task`, `Event`
- Custom objects: End with `__c` (e.g., `CustomObject__c`)

---

## Test 7: Initial Sync

### Goal
Run the first sync and populate deals, contacts, accounts.

### Steps

1. **Trigger initial sync:**
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/<workspace-id>/connectors/salesforce/sync \
     -H "Content-Type: application/json"
   ```

2. **Expected behavior:**
   - Sync runs for 30-120 seconds (depends on data volume)
   - Returns sync result with record counts

3. **Check sync_log table:**
   ```sql
   SELECT
     id,
     workspace_id,
     connector_name,
     status,
     records_synced,
     started_at,
     completed_at,
     error
   FROM sync_logs
   WHERE workspace_id = '<workspace-id>' AND connector_name = 'salesforce'
   ORDER BY started_at DESC
   LIMIT 1;
   ```

4. **Check normalized data:**
   ```sql
   -- Deals (Opportunities)
   SELECT source, COUNT(*) as count, SUM(amount) as total_amount
   FROM deals
   WHERE workspace_id = '<workspace-id>'
   GROUP BY source;

   -- Contacts
   SELECT source, COUNT(*) as count
   FROM contacts
   WHERE workspace_id = '<workspace-id>'
   GROUP BY source;

   -- Accounts
   SELECT source, COUNT(*) as count
   FROM accounts
   WHERE workspace_id = '<workspace-id>'
   GROUP BY source;
   ```

5. **Spot check 3 deals:**
   ```sql
   SELECT
     id,
     name,
     source,
     source_id,
     amount,
     stage,
     stage_normalized,
     close_date,
     owner,
     created_date
   FROM deals
   WHERE workspace_id = '<workspace-id>' AND source = 'salesforce'
   LIMIT 3;
   ```

### Validation

- [ ] `sync_log` record created with `status = 'completed'`
- [ ] `records_synced` > 0
- [ ] No errors in `sync_log.error`
- [ ] Deals table has records with `source = 'salesforce'`
- [ ] Contacts table has records
- [ ] Accounts table has records
- [ ] Spot check: `amount` is numeric (not null for real deals)
- [ ] Spot check: `stage` is populated
- [ ] Spot check: `stage_normalized` is set (stage mapping worked)
- [ ] Spot check: `source_id` starts with `006` (Salesforce Opportunity ID format)
- [ ] Spot check: `close_date` is a valid date
- [ ] No empty string issues: `SELECT COUNT(*) FROM deals WHERE amount::text = ''` returns 0

### Expected Data Volume

Typical production org:
- Opportunities: 500-5,000
- Contacts: 1,000-10,000
- Accounts: 500-2,000

If your test org has different volumes, that's fine — just verify data was synced.

### Troubleshooting

**Issue:** Sync times out after 60 seconds
- **Cause:** Large data volume, slow Salesforce API
- **Fix:** Increase timeout, or check if Bulk API fallback is working

**Issue:** `status = 'failed'` in sync_log
- **Cause:** API error or transform error
- **Fix:** Check `sync_log.error` for details, check server logs

**Issue:** Deals synced but amount is null for all
- **Cause:** Salesforce `Amount` field is null (allowed in Salesforce)
- **Impact:** Normal for some orgs — opportunities can exist without amounts

**Issue:** Deals synced but stage_normalized is null
- **Cause:** Stage mapping failed or stage value not recognized
- **Fix:** Check transform logic for stage normalization

**Issue:** source_id doesn't start with 006
- **Cause:** Different object type synced, or ID format changed
- **Impact:** If it's a valid 15 or 18-character Salesforce ID, it's fine

---

## Test 8: Incremental Sync

### Goal
Verify incremental sync fetches only changes since last sync.

### Steps

1. **Note current record count:**
   ```sql
   SELECT COUNT(*) as count FROM deals WHERE workspace_id = '<workspace-id>' AND source = 'salesforce';
   ```

2. **Wait 5 seconds** (or modify a record in Salesforce if testing manually)

3. **Trigger incremental sync:**
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/<workspace-id>/connectors/salesforce/sync \
     -H "Content-Type: application/json"
   ```

4. **Check sync behavior:**
   - Should complete faster than initial sync (only fetching changes)
   - May sync 0 records if nothing changed

5. **Verify no duplicates:**
   ```sql
   -- Check for duplicate source_ids
   SELECT source_id, COUNT(*) as dup_count
   FROM deals
   WHERE workspace_id = '<workspace-id>' AND source = 'salesforce'
   GROUP BY source_id
   HAVING COUNT(*) > 1;
   ```

### Validation

- [ ] Sync completes (even if 0 records changed)
- [ ] Duration < initial sync duration
- [ ] No duplicate records created
- [ ] `last_sync_at` updated in `connector_configs`

### Notes

If testing manually by modifying a Salesforce record:
- Update an Opportunity's `Stage` or `Amount`
- Run incremental sync
- Verify the deal was updated in Pandora

---

## Test 9: Health Check Endpoint

### Goal
Verify health endpoint returns connection status.

### Steps

1. **Call health endpoint:**
   ```bash
   curl http://localhost:3000/api/workspaces/<workspace-id>/connectors/salesforce/health
   ```

2. **Expected response:**
   ```json
   {
     "status": "connected",
     "lastSync": "2026-02-11T18:30:00.000Z",
     "tokenAge": "valid",
     "recordCounts": {
       "deals": 1200,
       "contacts": 3500,
       "accounts": 800
     },
     "lastError": null,
     "orgId": "00D...",
     "instanceUrl": "https://na139.salesforce.com"
   }
   ```

### Validation

- [ ] Response status: 200
- [ ] `status = 'connected'`
- [ ] `lastSync` is recent (within last hour if you just synced)
- [ ] `tokenAge` is one of: 'valid', 'expiring_soon', 'expired'
- [ ] `recordCounts` matches database counts
- [ ] `lastError` is null (or contains useful error if previous sync failed)
- [ ] `orgId` matches org you connected
- [ ] `instanceUrl` is valid HTTPS URL

---

## Test 10: Disconnect Endpoint

### Goal
Verify disconnect removes credentials but keeps data.

### Steps

1. **Note current record count:**
   ```sql
   SELECT
     (SELECT COUNT(*) FROM deals WHERE workspace_id = '<workspace-id>' AND source = 'salesforce') as deals,
     (SELECT COUNT(*) FROM contacts WHERE workspace_id = '<workspace-id>' AND source = 'salesforce') as contacts,
     (SELECT COUNT(*) FROM accounts WHERE workspace_id = '<workspace-id>' AND source = 'salesforce') as accounts;
   ```

2. **Disconnect:**
   ```bash
   curl -X DELETE http://localhost:3000/api/workspaces/<workspace-id>/connectors/salesforce/disconnect
   ```

3. **Expected response:**
   ```json
   { "success": true }
   ```

4. **Verify credentials removed:**
   ```sql
   SELECT status, credentials
   FROM connector_configs
   WHERE workspace_id = '<workspace-id>' AND connector_name = 'salesforce';
   ```

5. **Verify data still exists:**
   ```sql
   SELECT
     (SELECT COUNT(*) FROM deals WHERE workspace_id = '<workspace-id>' AND source = 'salesforce') as deals,
     (SELECT COUNT(*) FROM contacts WHERE workspace_id = '<workspace-id>' AND source = 'salesforce') as contacts,
     (SELECT COUNT(*) FROM accounts WHERE workspace_id = '<workspace-id>' AND source = 'salesforce') as accounts;
   ```

### Validation

- [ ] Response status: 200
- [ ] `status = 'disconnected'` in `connector_configs`
- [ ] `credentials` is NULL
- [ ] Record counts unchanged (data preserved)
- [ ] Test endpoint now returns 404 (not connected)

### Cleanup

If you want to reconnect after testing disconnect:
- Run OAuth flow again (Test 2)
- Credentials will be restored
- Run incremental sync to resume syncing

---

## Test 11: Sync Orchestrator Integration

### Goal
Verify sync orchestrator can discover and run Salesforce adapter.

### Steps

1. **Reconnect Salesforce** (if disconnected in Test 10):
   - Run OAuth flow
   - Verify `status = 'connected'`

2. **Trigger workspace sync via orchestrator:**
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/<workspace-id>/sync \
     -H "Content-Type: application/json"
   ```

3. **Expected behavior:**
   - Orchestrator discovers Salesforce connector
   - Runs Salesforce sync
   - Also runs HubSpot sync if connected
   - Returns combined results

### Validation

- [ ] Orchestrator runs Salesforce sync
- [ ] No errors in logs
- [ ] `last_sync_at` updated
- [ ] If multiple connectors connected, all run successfully

### Troubleshooting

**Issue:** Orchestrator skips Salesforce
- **Cause:** Adapter not registered or status not 'connected'
- **Fix:** Verify adapter registration and connector status

---

## Test 12: Multi-Tenant Isolation (Second Org)

### Goal
Verify workspaces are isolated — connecting a second org to a different workspace doesn't leak data.

### Steps

1. **Create a second workspace** (or use existing):
   ```sql
   INSERT INTO workspaces (name, created_by_email)
   VALUES ('Salesforce Test Org 2', 'test@example.com')
   RETURNING id;
   ```

2. **Connect second Salesforce org to second workspace:**
   - Run OAuth flow with `workspaceId=<workspace-2-id>`
   - Log in to the SECOND Salesforce production org

3. **Verify credentials stored separately:**
   ```sql
   SELECT workspace_id, credentials->>'org_id' as org_id
   FROM connector_configs
   WHERE connector_name = 'salesforce'
   ORDER BY created_at;
   ```

4. **Sync second workspace:**
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/<workspace-2-id>/connectors/salesforce/sync
   ```

5. **Verify data isolation:**
   ```sql
   -- Workspace 1 deals should have org 1 data
   SELECT COUNT(*), MIN(source_id), MAX(source_id)
   FROM deals
   WHERE workspace_id = '<workspace-1-id>' AND source = 'salesforce';

   -- Workspace 2 deals should have org 2 data
   SELECT COUNT(*), MIN(source_id), MAX(source_id)
   FROM deals
   WHERE workspace_id = '<workspace-2-id>' AND source = 'salesforce';

   -- NO overlap in source_ids (different orgs = different IDs)
   SELECT d1.source_id
   FROM deals d1
   WHERE d1.workspace_id = '<workspace-1-id>' AND d1.source = 'salesforce'
     AND EXISTS (
       SELECT 1 FROM deals d2
       WHERE d2.workspace_id = '<workspace-2-id>' AND d2.source = 'salesforce'
         AND d2.source_id = d1.source_id
     );
   -- Should return 0 rows
   ```

### Validation

- [ ] Both workspaces have separate `connector_configs` records
- [ ] `org_id` is different for each
- [ ] Each workspace has deals from its respective org
- [ ] No source_id overlap (0 rows in isolation check)
- [ ] Record counts differ (orgs have different data)

---

## Test 13: Nightly Sync Scheduler (Dry Run)

### Goal
Verify Salesforce is included in nightly sync schedule.

### Steps

1. **Check scheduler code:**
   - Open `server/sync/scheduler.ts`
   - Verify it queries for both `hubspot` AND `salesforce` connectors

2. **Manually trigger scheduler logic:**
   ```sql
   -- This is what the scheduler should query
   SELECT DISTINCT workspace_id, connector_name
   FROM connector_configs
   WHERE status = 'connected' AND connector_name IN ('hubspot', 'salesforce');
   ```

3. **Expected result:**
   - Both HubSpot and Salesforce workspaces listed

### Validation

- [ ] Scheduler code includes `'salesforce'` in query
- [ ] SQL returns both connector types
- [ ] No hardcoded HubSpot-only logic

### Note

Actual cron execution test requires waiting for the scheduled time or manually invoking the cron job. For now, verify the code is correct.

---

## Success Criteria Checklist

### OAuth Flow
- [ ] Authorization redirects to Salesforce login
- [ ] Callback stores credentials in database
- [ ] Re-auth updates existing record (no duplicates)
- [ ] User denial handled gracefully

### API Endpoints
- [ ] Test endpoint returns org details
- [ ] Discover-schema endpoint returns metadata
- [ ] Health endpoint returns connection status
- [ ] Disconnect removes credentials but keeps data

### Sync
- [ ] Initial sync populates deals, contacts, accounts
- [ ] Data normalized correctly (stage mapping, amounts, dates)
- [ ] Incremental sync fetches only changes
- [ ] No duplicate records created
- [ ] `last_sync_at` updated after sync

### Integration
- [ ] Adapter registered in registry
- [ ] Orchestrator discovers and runs Salesforce sync
- [ ] Nightly scheduler includes Salesforce

### Multi-Tenant
- [ ] Two orgs connected to two workspaces
- [ ] Data isolated (no cross-contamination)
- [ ] Different org_ids stored

---

## Known Limitations (Prompt 1 Only)

At this stage, the following are NOT implemented:

- ❌ **Token refresh:** Access tokens expire after ~2 hours. Syncs will fail until Prompt 4.
- ❌ **Stage history:** No `deal_stage_history` records yet. Prompt 2 adds this.
- ❌ **Contact roles:** No `deal_contacts` records yet. Prompt 3 adds this.
- ❌ **Activities:** No `activities` records yet. Prompt 3 adds this.

**Workaround for token expiry:** Re-run OAuth flow to get fresh tokens.

---

## Next Steps

After all tests pass, move to:
- **Prompt 2:** OpportunityFieldHistory → Stage History (Claude Code)
- **Prompt 3:** OpportunityContactRole + Activity Sync (Claude Code)
- **Prompt 4:** Token Refresh + Scheduling (Replit)

---

## Troubleshooting Quick Reference

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| OAuth redirect fails | Missing env vars | Check `SALESFORCE_CLIENT_ID`, etc. |
| Callback 400 "state" | State verification failed | Check `SESSION_SECRET` consistency |
| Token exchange 400 | Wrong client credentials | Verify client ID/secret match Connected App |
| Test endpoint 401 | Token expired | Re-run OAuth flow (token refresh not built yet) |
| Sync fails with 404 | Wrong instance URL | Check `instance_url` in credentials |
| Sync times out | Large data volume | Expected for large orgs — wait longer |
| Duplicate records | Incremental sync logic error | Check ON CONFLICT in upsert logic |
| No deals synced | No Opportunities in org | Verify org has data in Salesforce |
| Stage normalized is null | Stage mapping failed | Check transform logic for stage normalization |
| Multi-tenant leakage | Missing workspace_id filter | Check all queries include `workspace_id = $1` |

---

**Ready to test!** Start with Test 1 (OAuth flow) and work through each test sequentially.
