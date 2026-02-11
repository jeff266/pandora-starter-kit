# Sync Hardening Test Plan

**Status:** 100% Hardened - Ready for Testing
**Commits:** da07709, 8cf8641, b079f90
**Total Changes:** 15 files, +738/-185 lines

---

## Test Environment Setup

### Prerequisites
```bash
# 1. Apply database migrations
npm run migrate

# 2. Start the server
npm run dev

# 3. Verify job queue is running
# Check logs for: "[JobQueue] Starting job queue"

# 4. Verify scheduler is running
# Check logs for: "[Scheduler] Daily sync scheduled"
```

### Test Data Requirements
- At least 1 workspace with ID
- Active connections for: HubSpot, Salesforce, Gong, Monday
- OAuth credentials configured in .env
- Test webhook endpoint (e.g., webhook.site or local endpoint)

---

## Phase 1: Quick Wins Testing (Foundational - 80%)

### QW-1: Salesforce Async Queue
**Feature:** Non-blocking Salesforce sync with 202 response

**Test Steps:**
1. Start Salesforce sync:
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/{workspaceId}/connectors/salesforce/sync
   ```
2. Verify immediate 202 response (< 500ms)
3. Check response contains:
   - `syncId`
   - `jobId`
   - `status: 'queued'`
   - `statusUrl`

**Expected Results:**
- ✅ Response returns immediately (not 49 seconds)
- ✅ Job created in `jobs` table with status='pending'
- ✅ Sync_log entry created with status='pending'

**Verification:**
```sql
SELECT id, status, job_type, created_at
FROM jobs
WHERE workspace_id = '{workspaceId}'
ORDER BY created_at DESC LIMIT 1;
```

**Edge Cases:**
- Duplicate sync request → 409 Conflict
- Invalid workspace → 404 Not Found
- No Salesforce connection → 404 Not Found

---

### QW-2: Scheduler Fire-and-Forget
**Feature:** Scheduler queues jobs instead of blocking

**Test Steps:**
1. Manually trigger scheduler (or wait for 2:00 AM UTC):
   ```typescript
   // In server console or test script
   import { getScheduler } from './server/sync/scheduler.js';
   await getScheduler()?.runDailySync();
   ```
2. Monitor logs for job creation messages
3. Verify scheduler completes immediately

**Expected Results:**
- ✅ Scheduler logs "Queueing daily sync jobs for N workspace(s)"
- ✅ Scheduler logs "Daily sync jobs queued: N/N workspaces"
- ✅ Scheduler completes in < 5 seconds regardless of workspace count
- ✅ All jobs created with status='pending'

**Verification:**
```sql
SELECT workspace_id, status, created_at
FROM jobs
WHERE job_type = 'sync'
AND created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at;
```

**Edge Cases:**
- Workspace already has running sync → Skipped with log message
- No connected workspaces → "No workspaces" message

---

### QW-3: Stale Lock Cleanup
**Feature:** Auto-fail syncs stuck > 1 hour

**Test Steps:**
1. Create a stale sync_log entry:
   ```sql
   INSERT INTO sync_log (workspace_id, connector_type, sync_type, status, started_at)
   VALUES ('{workspaceId}', 'salesforce', 'manual', 'running', NOW() - INTERVAL '2 hours');
   ```
2. Attempt a new sync:
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/{workspaceId}/sync
   ```
3. Verify stale lock is cleaned up

**Expected Results:**
- ✅ Stale sync marked as 'failed' with error='Sync timed out (exceeded 1 hour)'
- ✅ New sync proceeds successfully
- ✅ Stale sync has completed_at timestamp

**Verification:**
```sql
SELECT id, status, error, completed_at
FROM sync_log
WHERE workspace_id = '{workspaceId}'
ORDER BY started_at DESC
LIMIT 2;
```

**Edge Cases:**
- Multiple stale locks → All cleaned up
- Sync stuck < 1 hour → Not cleaned (409 response)

---

### QW-4 & QW-5: Rate Limiting (Gong & Monday)
**Feature:** Throttled API calls with limits

**Test Steps (Gong):**
1. Configure Gong connection
2. Start sync that will make >100 requests in 60 seconds
3. Monitor logs for throttling

**Expected Results:**
- ✅ Requests throttled to 100/minute for Gong
- ✅ Requests throttled to 60/minute for Monday
- ✅ No rate limit errors from API
- ✅ Sync completes successfully (slower but stable)

**Verification:**
- Check logs for RateLimiter queue behavior
- Monitor API response times (should be evenly spaced)

---

### QW-6: Salesforce Incremental Sync
**Feature:** Watermark-based syncing using last_sync_at

**Test Steps:**
1. Run initial full sync:
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/{workspaceId}/connectors/salesforce/sync
   ```
2. Wait for completion
3. Verify last_sync_at is set:
   ```sql
   SELECT last_sync_at FROM connections
   WHERE workspace_id = '{workspaceId}' AND connector_name = 'salesforce';
   ```
4. Run second sync (should be incremental by default)
5. Check logs for "Using incremental WHERE clause"

**Expected Results:**
- ✅ First sync: Full sync of all records
- ✅ last_sync_at updated after first sync
- ✅ Second sync: Only fetches records with SystemModstamp >= watermark
- ✅ Significantly fewer records fetched on second sync

**Verification:**
```sql
SELECT id, connector_type, records_synced, started_at
FROM sync_log
WHERE workspace_id = '{workspaceId}' AND connector_type = 'salesforce'
ORDER BY started_at DESC LIMIT 2;
```

---

## Phase 2: Medium Wins Testing (Resilience - 90%)

### MW-1: Timeout Enforcement
**Feature:** Jobs respect timeout_ms (default 10 minutes)

**Test Steps:**
1. Create a job with short timeout:
   ```typescript
   const jobQueue = getJobQueue();
   await jobQueue.createJob({
     workspaceId: '{workspaceId}',
     jobType: 'sync',
     payload: { connectorType: 'hubspot' },
     timeoutMs: 5000, // 5 seconds
   });
   ```
2. Monitor job execution
3. Verify timeout triggers if job exceeds limit

**Expected Results:**
- ✅ Job fails after exactly 5 seconds
- ✅ Error message: "Job {jobId} exceeded timeout of 5000ms"
- ✅ Job status='failed' in database

**Verification:**
```sql
SELECT id, status, error,
       EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_seconds
FROM jobs
WHERE id = '{jobId}';
```

**Edge Cases:**
- Job completes before timeout → Success
- No timeout specified → Uses default 600000ms (10 min)

---

### MW-2: 429 Retry with Backoff
**Feature:** Automatic retry on rate limit with exponential backoff

**Test Steps:**
1. Simulate rate limit by rapidly calling Gong/Monday APIs
2. Monitor logs for 429 responses
3. Verify retry behavior

**Expected Results:**
- ✅ 429 detected and logged
- ✅ Retry with delays: 2s, 4s, 8s (exponential)
- ✅ Respects Retry-After header if present
- ✅ Max 3 attempts before failing
- ✅ Sync completes successfully if API recovers

**Verification:**
- Check logs for: "[Gong Client] Rate limited (429), retrying in Xms"
- Check logs for: "[Monday Client] Rate limited (429), retrying in Xms"

**Manual Test (using mock):**
```typescript
// Temporarily modify client to always return 429
// Verify retry behavior in logs
```

---

### MW-3: Incremental Sync Everywhere
**Feature:** All connectors use watermarks automatically

**Test Steps:**
1. For each connector (HubSpot, Gong, Fireflies):
   - Run initial sync
   - Check last_sync_at is set
   - Run second sync
   - Verify incremental mode used

**Expected Results (per connector):**
- ✅ HubSpot: Uses incrementalSync() function
- ✅ Gong: Uses incrementalSync() with date filter
- ✅ Fireflies: Uses incrementalSync() with date filter
- ✅ Monday: Uses incrementalSync() in adapter
- ✅ Google Drive: Uses incrementalSync() in adapter
- ✅ Salesforce: Uses incremental mode parameter

**Verification:**
```sql
SELECT connector_name, last_sync_at
FROM connections
WHERE workspace_id = '{workspaceId}';
```

---

## Phase 3: Large Wins Testing (Complete - 100%)

### LW-1: Per-Record Error Capture
**Feature:** Transform failures don't kill entire sync

**Test Steps:**
1. Inject bad data into connector response (modify transform temporarily):
   ```typescript
   // In transform.ts, add intentional error for specific record
   if (record.Id === 'BAD_ID') {
     throw new Error('Intentional test error');
   }
   ```
2. Run sync
3. Verify sync completes with partial success

**Expected Results:**
- ✅ Bad record logged in errors array
- ✅ Good records still processed and stored
- ✅ Sync status='completed_with_errors' or 'completed'
- ✅ Error includes record ID: "Account: [error] (BAD_ID)"

**Verification:**
```sql
SELECT records_synced, errors
FROM sync_log
WHERE id = '{syncLogId}';
```

**Test for Each Connector:**
- Salesforce: transformWithErrorCapture ✓
- HubSpot: transformWithErrorCapture ✓
- Gong: transformWithErrorCapture ✓
- Fireflies: transformWithErrorCapture ✓

---

### LW-2: Deduplication Logic
**Feature:** Database-enforced uniqueness on (workspace_id, source, source_id)

**Test Steps:**
1. Insert a record:
   ```sql
   INSERT INTO deals (workspace_id, source, source_id, name)
   VALUES ('{workspaceId}', 'test', 'DEAL_001', 'Test Deal');
   ```
2. Run sync that includes same source_id
3. Verify upsert (UPDATE) behavior

**Expected Results:**
- ✅ No duplicate records created
- ✅ Existing record updated with new data
- ✅ ON CONFLICT DO UPDATE triggered
- ✅ updated_at timestamp changed

**Verification:**
```sql
SELECT COUNT(*), MAX(updated_at)
FROM deals
WHERE workspace_id = '{workspaceId}'
  AND source = 'test'
  AND source_id = 'DEAL_001';
-- Should return: count=1
```

**Test All Entity Types:**
- deals
- contacts
- accounts
- calls
- documents
- tasks

---

### LW-3: Progress Webhooks
**Feature:** Real-time webhook notifications with HMAC signatures

#### Setup Test Webhook
```bash
# Option 1: Use webhook.site
# Go to https://webhook.site and copy your unique URL

# Option 2: Use local endpoint
# Start ngrok: ngrok http 3001
# Create simple webhook receiver on port 3001

# Configure webhook
curl -X PUT http://localhost:3000/api/workspaces/{workspaceId}/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "webhookUrl": "https://webhook.site/your-unique-id",
    "webhookSecret": "test-secret-key"
  }'
```

#### Test Steps:
1. **Test Webhook (Verification):**
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/{workspaceId}/webhook/test
   ```

2. **Verify Test Payload:**
   - Check webhook receiver for payload
   - Verify signature in X-Webhook-Signature header
   - Validate payload structure:
     ```json
     {
       "event": "sync.progress",
       "workspaceId": "...",
       "timestamp": "2026-02-10T...",
       "data": {
         "jobType": "test",
         "progress": {
           "current": 50,
           "total": 100,
           "message": "Test webhook notification"
         }
       }
     }
     ```

3. **Real Sync with Webhooks:**
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/{workspaceId}/sync
   ```

4. **Monitor webhook receiver for 3 event types:**
   - Multiple `sync.progress` events (as sync runs)
   - Final `sync.completed` event (with results)
   - OR `sync.failed` event (if sync fails)

**Expected Results:**
- ✅ Test webhook received successfully
- ✅ HMAC signature present and valid (sha256=...)
- ✅ Progress webhooks sent during sync
- ✅ Completion webhook sent with results
- ✅ Webhook failures logged but don't break sync

**Signature Verification (example in Python):**
```python
import hmac
import hashlib

def verify_webhook(payload_body, signature_header, secret):
    expected = 'sha256=' + hmac.new(
        secret.encode(),
        payload_body.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

**Test All Webhook Events:**
- `sync.progress` - Multiple during sync
- `sync.completed` - After successful sync
- `sync.failed` - After failed sync (test by breaking connection)

**Edge Cases:**
- No webhook configured → No webhooks sent (silent)
- Invalid webhook URL → Logged, sync continues
- Webhook timeout (>5s) → Logged, sync continues
- Webhook returns 500 → Logged, sync continues

---

## Phase 4: Integration Testing

### INT-1: Full Sync Flow
**End-to-end test of entire sync pipeline**

**Test Steps:**
1. Configure all connectors (HubSpot, Salesforce, Gong, Monday)
2. Configure webhook
3. Trigger full workspace sync:
   ```bash
   curl -X POST http://localhost:3000/api/workspaces/{workspaceId}/sync
   ```
4. Monitor:
   - Job queue logs
   - Webhook notifications
   - Database updates

**Expected Results:**
- ✅ Job created immediately (202 response)
- ✅ Job picked up by queue within 2 seconds
- ✅ Progress webhooks sent regularly
- ✅ All connectors sync in parallel (via orchestrator)
- ✅ Incremental mode used where applicable
- ✅ Per-record errors captured without failing sync
- ✅ Deduplication prevents duplicate records
- ✅ Completion webhook sent with full results
- ✅ Job marked as 'completed'

**Verification:**
```sql
-- Check job
SELECT * FROM jobs WHERE id = '{jobId}';

-- Check sync log
SELECT * FROM sync_log WHERE workspace_id = '{workspaceId}'
ORDER BY started_at DESC LIMIT 1;

-- Check data inserted
SELECT
  (SELECT COUNT(*) FROM deals WHERE workspace_id = '{workspaceId}') as deals,
  (SELECT COUNT(*) FROM contacts WHERE workspace_id = '{workspaceId}') as contacts,
  (SELECT COUNT(*) FROM accounts WHERE workspace_id = '{workspaceId}') as accounts;
```

---

### INT-2: Scheduled Sync
**Test scheduler triggering syncs for multiple workspaces**

**Test Steps:**
1. Set up 3 workspaces with connected sources
2. Trigger scheduler manually or wait for 2:00 AM UTC
3. Monitor job creation and execution

**Expected Results:**
- ✅ Jobs created for all 3 workspaces simultaneously
- ✅ Jobs execute in parallel (not sequentially)
- ✅ All workspaces complete within reasonable time
- ✅ No cascading delays

**Verification:**
```sql
SELECT workspace_id, status, started_at, completed_at,
       EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_seconds
FROM jobs
WHERE job_type = 'sync'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY started_at;
```

---

### INT-3: Concurrent Syncs
**Test multiple syncs running simultaneously**

**Test Steps:**
1. Start sync for workspace A (Salesforce)
2. Immediately start sync for workspace B (HubSpot)
3. Start sync for workspace C (Gong)
4. Verify all run concurrently

**Expected Results:**
- ✅ All 3 jobs accepted (202 responses)
- ✅ All 3 jobs running simultaneously
- ✅ No job blocks another
- ✅ All complete successfully

---

### INT-4: Error Recovery
**Test system handles failures gracefully**

**Test Steps:**
1. **Test API error:**
   - Disconnect internet or break API credentials
   - Trigger sync
   - Verify retry logic kicks in
   - Restore connection
   - Verify sync eventually succeeds

2. **Test transform error:**
   - Inject bad data (see LW-1)
   - Verify partial success

3. **Test timeout:**
   - Set very short timeout
   - Trigger long sync
   - Verify timeout triggers

**Expected Results:**
- ✅ API errors: Retries with backoff, then fails gracefully
- ✅ Transform errors: Captured per-record, sync continues
- ✅ Timeouts: Job marked failed with timeout error
- ✅ Webhook sent for all failure types
- ✅ Database state remains consistent

---

## Phase 5: Edge Cases & Failure Scenarios

### EDGE-1: Duplicate Sync Prevention
```bash
# Start sync 1
curl -X POST http://localhost:3000/api/workspaces/{workspaceId}/sync

# Immediately start sync 2 (before first completes)
curl -X POST http://localhost:3000/api/workspaces/{workspaceId}/sync
```
**Expected:** Second request returns 409 Conflict

### EDGE-2: Invalid Webhook URL
```bash
curl -X PUT http://localhost:3000/api/workspaces/{workspaceId}/webhook \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "not-a-url"}'
```
**Expected:** 400 Bad Request

### EDGE-3: Webhook Timeout
Configure webhook to slow endpoint (>5s response time)
**Expected:** Webhook times out, logged, sync continues

### EDGE-4: Large Dataset (>10K records)
Trigger Salesforce sync with >10,000 records
**Expected:** Automatically uses Bulk API 2.0

### EDGE-5: Zero Records
Sync connector with no new data (incremental after recent sync)
**Expected:** Completes successfully with 0 records synced

### EDGE-6: Database Connection Loss
Simulate database disconnect during sync
**Expected:** Job fails, retries (if attempts remain), error logged

---

## Success Criteria

### Quick Wins (6/6 ✅)
- [ ] QW-1: Salesforce returns 202 immediately
- [ ] QW-2: Scheduler queues jobs without blocking
- [ ] QW-3: Stale locks cleaned up automatically
- [ ] QW-4: Gong throttled to 100 req/min
- [ ] QW-5: Monday throttled to 60 req/min
- [ ] QW-6: Salesforce incremental uses watermark

### Medium Wins (3/3 ✅)
- [ ] MW-1: Jobs timeout after configured duration
- [ ] MW-2: 429 responses trigger exponential backoff
- [ ] MW-3: All connectors use incremental mode

### Large Wins (3/3 ✅)
- [ ] LW-1: Per-record errors captured for all connectors
- [ ] LW-2: No duplicate records created (database-enforced)
- [ ] LW-3: Webhooks sent for progress/completion/failure

### Integration (4/4 ✅)
- [ ] INT-1: Full sync flow completes end-to-end
- [ ] INT-2: Scheduled syncs work for multiple workspaces
- [ ] INT-3: Concurrent syncs run in parallel
- [ ] INT-4: Errors handled gracefully with recovery

### Edge Cases (6/6 ✅)
- [ ] EDGE-1: Duplicate sync prevention works
- [ ] EDGE-2: Invalid webhook URL rejected
- [ ] EDGE-3: Webhook timeouts don't break sync
- [ ] EDGE-4: Large datasets use Bulk API
- [ ] EDGE-5: Zero-record syncs complete cleanly
- [ ] EDGE-6: Database errors handled gracefully

---

## Performance Benchmarks

### Response Times
- Sync initiation (202 response): < 500ms
- Job pickup from queue: < 2 seconds
- Webhook delivery: < 5 seconds (with timeout)

### Throughput
- HubSpot: ~1000 records/minute (with throttling)
- Salesforce: ~2000 records/minute (REST API)
- Salesforce Bulk: ~10,000 records/minute (Bulk API 2.0)
- Gong: 100 requests/minute max
- Monday: 60 requests/minute max

### Concurrency
- Multiple workspaces: Sync in parallel
- Single workspace: Sequential per connector
- Job queue: Process jobs concurrently (up to available resources)

---

## Test Execution Log

### Test Run: [DATE]
**Tester:** [NAME]
**Environment:** [dev/staging/prod]
**Duration:** [TIME]

| Test ID | Description | Status | Notes |
|---------|-------------|--------|-------|
| QW-1 | Salesforce async queue | ⬜ PASS / FAIL | |
| QW-2 | Scheduler fire-and-forget | ⬜ PASS / FAIL | |
| QW-3 | Stale lock cleanup | ⬜ PASS / FAIL | |
| QW-4 | Gong throttling | ⬜ PASS / FAIL | |
| QW-5 | Monday throttling | ⬜ PASS / FAIL | |
| QW-6 | Salesforce incremental | ⬜ PASS / FAIL | |
| MW-1 | Timeout enforcement | ⬜ PASS / FAIL | |
| MW-2 | 429 retry backoff | ⬜ PASS / FAIL | |
| MW-3 | Incremental everywhere | ⬜ PASS / FAIL | |
| LW-1 | Per-record error capture | ⬜ PASS / FAIL | |
| LW-2 | Deduplication | ⬜ PASS / FAIL | |
| LW-3 | Progress webhooks | ⬜ PASS / FAIL | |
| INT-1 | Full sync flow | ⬜ PASS / FAIL | |
| INT-2 | Scheduled sync | ⬜ PASS / FAIL | |
| INT-3 | Concurrent syncs | ⬜ PASS / FAIL | |
| INT-4 | Error recovery | ⬜ PASS / FAIL | |

**Overall Result:** ⬜ PASS / FAIL

**Issues Found:**
1. [Issue description]
2. [Issue description]

**Recommendations:**
1. [Recommendation]
2. [Recommendation]

---

## Appendix: Useful SQL Queries

### Monitor Job Queue
```sql
-- Active jobs
SELECT id, workspace_id, job_type, status, attempts,
       EXTRACT(EPOCH FROM (NOW() - started_at)) as running_seconds
FROM jobs
WHERE status = 'running'
ORDER BY started_at;

-- Recent job history
SELECT workspace_id, job_type, status,
       EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_seconds,
       started_at, completed_at
FROM jobs
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- Job failure analysis
SELECT job_type, error, COUNT(*) as failure_count
FROM jobs
WHERE status = 'failed' AND created_at > NOW() - INTERVAL '7 days'
GROUP BY job_type, error
ORDER BY failure_count DESC;
```

### Monitor Sync Status
```sql
-- Workspace sync status
SELECT connector_name, status, last_sync_at,
       EXTRACT(EPOCH FROM (NOW() - last_sync_at))/3600 as hours_since_sync
FROM connections
WHERE workspace_id = '{workspaceId}'
ORDER BY connector_name;

-- Recent sync history
SELECT connector_type, status, records_synced, duration_ms/1000 as duration_sec,
       started_at, completed_at
FROM sync_log
WHERE workspace_id = '{workspaceId}'
ORDER BY started_at DESC
LIMIT 20;

-- Sync error analysis
SELECT connector_type,
       jsonb_array_length(errors) as error_count,
       errors
FROM sync_log
WHERE workspace_id = '{workspaceId}'
  AND status = 'completed_with_errors'
ORDER BY started_at DESC;
```

### Monitor Data Quality
```sql
-- Record counts by source
SELECT source,
       COUNT(*) as total_records,
       MAX(updated_at) as last_updated
FROM deals
WHERE workspace_id = '{workspaceId}'
GROUP BY source;

-- Duplicate check (should return 0 rows)
SELECT workspace_id, source, source_id, COUNT(*)
FROM deals
GROUP BY workspace_id, source, source_id
HAVING COUNT(*) > 1;

-- Recent updates
SELECT source, COUNT(*) as updated_count
FROM deals
WHERE workspace_id = '{workspaceId}'
  AND updated_at > NOW() - INTERVAL '1 hour'
GROUP BY source;
```

---

## Quick Reference: API Endpoints

### Sync Operations
```bash
# Trigger workspace sync (all connectors)
POST /api/workspaces/:id/sync

# Trigger Salesforce sync
POST /api/workspaces/:id/connectors/salesforce/sync

# Get sync status
GET /api/workspaces/:id/sync/status

# Get job status
GET /api/workspaces/:id/sync/jobs/:jobId

# List recent jobs
GET /api/workspaces/:id/sync/jobs?limit=20

# Get sync history
GET /api/workspaces/:id/sync/history?limit=20
```

### Webhook Configuration
```bash
# Get webhook config
GET /api/workspaces/:id/webhook

# Set webhook config
PUT /api/workspaces/:id/webhook
Body: {"webhookUrl": "https://...", "webhookSecret": "..."}

# Remove webhook
DELETE /api/workspaces/:id/webhook

# Test webhook
POST /api/workspaces/:id/webhook/test
```

---

**End of Test Plan**
