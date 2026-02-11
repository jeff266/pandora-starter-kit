# End-to-End Incremental Sync Verification

**Purpose:** Verify that incremental sync actually works in production, not just in unit tests.

**Context:** The verification script (verify-sync-infra.ts) tests the **decision logic** for incremental sync, but doesn't test the **full production flow** including:
- Writing the watermark (last_sync_at) after first sync
- Reading the watermark before second sync
- Actually sending date filters to the API
- Fetching only changed records

---

## The Test Plan

### Phase 1: Baseline (Before Second Sync)

**Run this SQL query:**
```sql
-- Check watermark from first sync
SELECT
  c.source,
  c.last_sync_at,
  (SELECT records_synced FROM sync_log sl
   WHERE sl.workspace_id = c.workspace_id
     AND sl.source = c.source
     AND sl.status = 'synced'
   ORDER BY sl.completed_at DESC
   LIMIT 1) as last_sync_record_count
FROM connections c
WHERE c.source = 'salesforce';
```

**What to look for:**
- ✅ `last_sync_at` should be populated (not NULL)
- ✅ `last_sync_record_count` should be ~13,826 (your full Salesforce sync)

**Red flag:** If `last_sync_at` is NULL after a successful sync, the watermark isn't being written.

---

### Phase 2: Trigger Second Sync

**Trigger another sync:**
```bash
# Via API:
POST /api/workspaces/{workspace_id}/sync

# Via UI:
# Click "Sync Now" button for Salesforce
```

**What should happen:**
1. Orchestrator reads `last_sync_at` from connections table
2. Decides to use `incremental` mode (not `initial`)
3. Passes `since` timestamp to Salesforce connector
4. Connector sends `SystemModstamp >= {since}` filter to Salesforce API
5. Salesforce returns only changed records (should be 0-100, not 13,826)

---

### Phase 3: Verify Incremental Behavior

**Run this SQL query:**
```sql
-- Check if second sync used incremental mode
SELECT
  sl.id,
  sl.source,
  sl.status,
  sl.started_at,
  sl.records_synced,
  sl.metadata->>'mode' as sync_mode,
  sl.metadata->>'since' as incremental_since,
  EXTRACT(EPOCH FROM (sl.completed_at - sl.started_at)) as duration_seconds
FROM sync_log sl
WHERE sl.source = 'salesforce'
  AND sl.status = 'synced'
ORDER BY sl.started_at DESC
LIMIT 2;
```

**What to look for:**

| Metric | First Sync (Initial) | Second Sync (Incremental) | Verification |
|--------|---------------------|---------------------------|--------------|
| `sync_mode` | `initial` | `incremental` | ✅ Mode switched |
| `incremental_since` | NULL | `2026-02-11T...` | ✅ Timestamp passed |
| `records_synced` | ~13,826 | <100 (ideally <10) | ✅ Fetched fewer records |
| `duration_seconds` | ~15s | ~2-5s | ✅ Faster sync |

**Red flags:**
- 🔴 `sync_mode` still shows `initial` on second sync
- 🔴 `incremental_since` is NULL on second sync
- 🔴 `records_synced` is still ~13,826 (full sync, not incremental)
- 🔴 Duration is still ~15s (suggests full sync)

---

### Phase 4: Deep Dive (If Red Flags)

If incremental sync isn't working, check the orchestrator logs:

**Check decision logic:**
```typescript
// server/sync/orchestrator.ts line 59
const mode = options?.mode || (conn.last_sync_at ? 'incremental' : 'initial');
```

**What to log:**
```typescript
console.log('[Orchestrator] Sync decision:', {
  workspaceId,
  source,
  lastSyncAt: conn.last_sync_at,
  decidedMode: mode,
  timestamp: new Date().toISOString(),
});
```

**Check watermark update:**
```typescript
// server/connectors/adapters/credentials.ts line 8
last_sync_at = CASE WHEN $3 = 'synced' THEN NOW() ELSE last_sync_at END
```

**What to verify:**
- Is status = 'synced' being passed correctly?
- Is the UPDATE query actually running?
- Is the transaction committing?

---

## Expected Timeline

**Immediate (after first sync):**
- ✅ `connections.last_sync_at` populated
- ✅ `sync_log.metadata.mode = 'initial'`
- ✅ ~13,826 records synced

**After second sync (within 5 minutes):**
- ✅ `sync_log.metadata.mode = 'incremental'`
- ✅ `sync_log.metadata.since = '2026-02-11T...'`
- ✅ <100 records synced (only changes since first sync)
- ✅ Sync completes in ~2-5s (not 15s)

---

## Quick Verification Commands

**1. Check watermark status:**
```sql
SELECT source, last_sync_at,
       CASE WHEN last_sync_at IS NULL THEN '🔴 No watermark'
            WHEN last_sync_at > NOW() - INTERVAL '1 hour' THEN '🟢 Recent'
            ELSE '🟡 Stale' END as status
FROM connections
WHERE source = 'salesforce';
```

**2. Check last 3 syncs:**
```sql
SELECT
  started_at,
  metadata->>'mode' as mode,
  records_synced,
  status
FROM sync_log
WHERE source = 'salesforce'
ORDER BY started_at DESC
LIMIT 3;
```

**3. Compare initial vs incremental:**
```sql
SELECT
  metadata->>'mode' as mode,
  COUNT(*) as sync_count,
  ROUND(AVG(records_synced)) as avg_records,
  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))) as avg_duration_sec
FROM sync_log
WHERE source = 'salesforce' AND status = 'synced'
GROUP BY metadata->>'mode';
```

**Expected output:**
```
mode         | sync_count | avg_records | avg_duration_sec
-------------|------------|-------------|------------------
initial      | 1          | 13826       | 15
incremental  | 3          | 47          | 3
```

---

## Connector-Specific Verification

### Salesforce
**API filter used:**
```soql
SELECT Id, Name, Amount, ... FROM Opportunity
WHERE SystemModstamp >= 2026-02-11T10:00:00Z
```

**How to verify:**
- Check Salesforce API logs (Setup → API Usage)
- Look for SOQL queries with `SystemModstamp >=` filter
- First sync: No filter (fetches all)
- Second+ sync: Filter present (fetches only changes)

### HubSpot
**API filter used:**
```json
POST /crm/v3/objects/deals/search
{
  "filterGroups": [{
    "filters": [{
      "propertyName": "hs_lastmodifieddate",
      "operator": "GTE",
      "value": "1707649200000"
    }]
  }]
}
```

**How to verify:**
- Check HubSpot API logs (Settings → Integrations → API Key)
- Look for search API calls with `hs_lastmodifieddate` filter
- First sync: Uses GET /crm/v3/objects/deals (no filter)
- Second+ sync: Uses POST .../search with filter

### Gong
**API filter used:**
```
GET /v2/calls?fromDateTime=2026-02-11T10:00:00Z
```

**How to verify:**
- Check Gong API request logs
- Look for `fromDateTime` query parameter
- First sync: No `fromDateTime` (fetches all)
- Second+ sync: `fromDateTime` present (fetches only new calls)

### Fireflies
**API filter used:**
```graphql
query {
  transcripts(afterDate: "2026-02-11T10:00:00Z") {
    id
    title
    ...
  }
}
```

**How to verify:**
- Check GraphQL query logs
- Look for `afterDate` parameter
- First sync: No `afterDate` (fetches all)
- Second+ sync: `afterDate` present (fetches only new transcripts)

---

## What Success Looks Like

**Healthy Incremental Sync Pattern:**

```
Sync 1 (Initial):
- Mode: initial
- Records: 13,826
- Duration: 15s
- Watermark written: 2026-02-11 10:00:00

Sync 2 (Incremental, 2 hours later):
- Mode: incremental
- Since: 2026-02-11 10:00:00
- Records: 12 (only changes in 2 hours)
- Duration: 2s
- Watermark written: 2026-02-11 12:00:00

Sync 3 (Incremental, 1 day later):
- Mode: incremental
- Since: 2026-02-11 12:00:00
- Records: 247 (changes in 1 day)
- Duration: 4s
- Watermark written: 2026-02-12 12:00:00
```

**Key indicators:**
- ✅ Mode switches from `initial` → `incremental` after first sync
- ✅ Record count drops dramatically (90%+ reduction)
- ✅ Duration drops proportionally to record count
- ✅ Watermark advances after each sync
- ✅ `since` timestamp in metadata matches previous watermark

---

## Troubleshooting

### Issue: Mode stays 'initial' on second sync

**Root cause:** `last_sync_at` not being written

**Check:**
```sql
-- Verify watermark update query runs
SELECT * FROM connections WHERE source = 'salesforce';
-- If last_sync_at is NULL, watermark isn't being written
```

**Fix:**
- Check `updateSyncStatus` is called with status='synced'
- Verify SQL transaction commits
- Check for DB connection issues during watermark update

---

### Issue: Mode is 'incremental' but records_synced is still high

**Root cause:** API filter not being applied

**Check:**
```typescript
// In connector code, verify filter is being built:
console.log('[Salesforce] Incremental sync filter:', {
  since: options.since,
  soqlFilter: `SystemModstamp >= ${options.since}`,
});
```

**Fix:**
- Verify `options.since` is being passed to connector
- Check connector builds filter correctly
- Verify API accepts the filter (check API logs)

---

### Issue: Watermark doesn't advance after successful sync

**Root cause:** Status not set to 'synced', or UPDATE not running

**Check:**
```typescript
// Verify status is being set correctly:
await updateSyncStatus(workspaceId, source, 'synced', syncLog);
```

**Fix:**
- Ensure status = 'synced' (not 'completed' or 'finished')
- Check for DB transaction rollback
- Verify no errors between sync completion and watermark update

---

## Summary

**Unit tests verify:** Decision logic works (if last_sync_at exists, choose incremental)

**E2E verification confirms:**
1. Watermark is written after first sync
2. Watermark is read before second sync
3. Incremental mode is chosen for second sync
4. API filter is applied correctly
5. Only changed records are fetched
6. Performance improves (90%+ faster)

**Run the verification:**
```bash
# 1. Check current state
psql -f scripts/verify-incremental-sync-e2e.sql

# 2. Trigger second sync
curl -X POST http://localhost:3000/api/workspaces/{id}/sync

# 3. Wait for completion (2-5 seconds)

# 4. Re-run verification
psql -f scripts/verify-incremental-sync-e2e.sql

# 5. Compare results (should see incremental mode + fewer records)
```

**If all checks pass:** ✅ Incremental sync is working end-to-end in production

**If any check fails:** Use the troubleshooting section to identify the root cause
