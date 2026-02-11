# Pandora Sync Infrastructure Audit Report

**Date:** February 11, 2026
**Audited By:** Claude Sonnet 4.5
**Repository:** pandora-starter-kit

---

## Executive Summary

Pandora has a **mature, production-grade sync infrastructure** with:
- ✅ 4 fully implemented connectors (HubSpot, Gong, Fireflies, Salesforce)
- ✅ Async job queue with polling loop
- ✅ Comprehensive error handling and per-record error capture
- ✅ Rate limiting on HubSpot, Gong, and Monday
- ✅ Retry logic with exponential backoff
- ✅ Incremental sync support on all main connectors
- ✅ Post-sync automation (entity linker, internal filter, skills)
- ✅ Field sanitization utilities for HubSpot (empty string → null)

**Strengths:**
- Well-structured adapter pattern
- Comprehensive error aggregation (no silent failures)
- Job queue with FOR UPDATE SKIP LOCKED for atomic selection
- Throttled fetchers with sliding window rate limiters
- Automatic watermark tracking (last_sync_at + sync_cursor)

**Gaps Identified:**
- Fireflies has no retry logic (relies on fetch errors)
- Salesforce has no rate limiting (relies on governor limits)
- Monday.com and Google Drive are adapter-only (no sync implementation)
- No 429 retry safety net for stragglers that slip through throttling
- Sync locking is basic (query check, not advisory locks)

---

## 1. CONNECTOR INVENTORY

### A. HubSpot (CRM) ✅ Fully Implemented

**Files:**
- Client: `server/connectors/hubspot/client.ts`
- Sync: `server/connectors/hubspot/sync.ts`
- Transform: `server/connectors/hubspot/transform.ts`
- Types: `server/connectors/hubspot/types.ts`

**Sync Capabilities:**
| Feature | Status | Implementation |
|---------|--------|----------------|
| initialSync | ✅ | getAllDeals, getAllContacts, getAllCompanies |
| incrementalSync | ✅ | searchRecentlyModified with cursor pagination |
| backfillSync | ✅ | backfillAssociations for deal-contact-account links |

**Pagination:** Cursor-based (`paging.next.after`)

**Rate Limiting:** ✅ **Excellent**
- REST API: 90/100 per 10 seconds (throttle.ts)
- Search API: 3/4 per second with 300ms minimum delay
- Uses `hubspotFetch` and `hubspotSearchFetch` wrappers

**Retry Logic:** ✅ Exponential backoff
- Default: 3 retries, 1s base delay, 2x backoff
- Uses `withRetry` from utils/retry.ts

**Watermark Tracking:** ✅
- `connections.last_sync_at` (TIMESTAMPTZ)
- `connections.sync_cursor` (JSONB) with:
  - `lastSyncMode` (initial/incremental)
  - `lastSyncAt` (timestamp)
  - `lastSyncRecords` (count)
  - `usedExportApi` (boolean flag for backfill trigger)

**Sync Execution:** Async via Job Queue (fire-and-forget)

**Error Handling:** ✅ **Best-in-class**
- Per-record error capture via `transformWithErrorCapture`
- 500-record batching for upserts
- Transaction per batch (BEGIN/COMMIT/ROLLBACK)
- Logs failure rate and first error for debugging

**Field Sanitization:** ✅
- `hubspot-sanitize.ts` utility
- Handles empty strings → null for dates/numbers
- Applied to all transform functions

---

### B. Gong (Conversations) ✅ Fully Implemented

**Files:**
- Client: `server/connectors/gong/client.ts`
- Sync: `server/connectors/gong/sync.ts`
- Transform: `server/connectors/gong/transform.ts`

**Sync Capabilities:**
| Feature | Status | Implementation |
|---------|--------|----------------|
| initialSync | ✅ | 90-day lookback, getCallsExtensive by tracked user |
| incrementalSync | ✅ | getCallsExtensive with `fromDate` parameter |
| backfillSync | ❌ | Not implemented |

**Pagination:** Offset-based via `getCallsExtensive` (built into client)

**Rate Limiting:** ✅ **Good**
- RateLimiter class: 100 requests per 60 seconds
- Exponential backoff for 429s built into client

**Retry Logic:** ✅ Custom implementation
- `requestWithRetry` with exponential backoff (2^n * 1000ms)
- Respects `Retry-After` header
- Default: 3 retries

**Watermark Tracking:** ✅
- `connections.last_sync_at`
- Tracked users filter (`getTrackedUsers` per workspace)
- Incremental uses `since: Date` parameter

**Sync Execution:** Async via Job Queue

**Error Handling:** ✅ Per-tracked-user error capture
- Includes `byUser` stats in result
- Aggregates errors across users

---

### C. Fireflies (Conversations) ✅ Implemented

**Files:**
- Client: `server/connectors/fireflies/client.ts`
- Sync: `server/connectors/fireflies/sync.ts`
- Transform: `server/connectors/fireflies/transform.ts`

**Sync Capabilities:**
| Feature | Status | Implementation |
|---------|--------|----------------|
| initialSync | ✅ | 90-day lookback, getTranscriptsByUser by tracked email |
| incrementalSync | ✅ | getTranscriptsByUser with `afterDate` |
| backfillSync | ❌ | Not implemented |

**Pagination:** Date-based filtering + deduplication
- Uses `afterDate` parameter
- `seenIds` Set for deduplication (Fireflies API can return duplicates)

**Rate Limiting:** ⚠️ **None documented**
- No explicit throttle
- Relies on Fireflies API being generous

**Retry Logic:** ❌ **GAP IDENTIFIED**
- No retry logic
- Relies on fetch errors
- Should add retry wrapper

**Watermark Tracking:** ✅
- `connections.last_sync_at`
- Tracked users filter by email
- Date-based incremental

**Sync Execution:** Async via Job Queue

**Error Handling:** ✅ Per-tracked-user error capture
- Deduplication via `seenIds` Set

---

### D. Salesforce (CRM) ✅ Fully Implemented

**Files:**
- Client: `server/connectors/salesforce/client.ts`
- Sync: `server/connectors/salesforce/sync.ts`
- Transform: `server/connectors/salesforce/transform.ts`
- Types: `server/connectors/salesforce/types.ts`

**Sync Capabilities:**
| Feature | Status | Implementation |
|---------|--------|----------------|
| initialSync | ✅ | Full or incremental based on mode parameter |
| incrementalSync | ✅ | SOQL WHERE SystemModstamp >= watermark |
| backfillSync | ❌ | Not implemented |

**Pagination:** SOQL query-based
- Automatic 10k record batching
- Falls back to Bulk API for >10k records
- Manual result pagination

**Rate Limiting:** ⚠️ **None documented**
- Relies on Salesforce API governor limits
- Should add basic throttle to avoid burst issues

**Retry Logic:** ✅ Token refresh
- Automatic retry on `INVALID_SESSION_ID` / `Session expired`
- Includes `refreshToken` for auto-refresh

**Watermark Tracking:** ✅
- `connections.last_sync_at`
- SOQL `WHERE SystemModstamp >= ?`
- Built into Salesforce's change tracking

**Sync Execution:** Async via Job Queue (special handler: `salesforce_sync`)

**Error Handling:** ✅ Per-record transform error capture
- 500-record batching
- Calls `computeFields()` during sync

---

### E. Monday.com (Tasks) ⚠️ Adapter Only

**Files:**
- Client: `server/connectors/monday/client.ts`
- Adapter: `server/connectors/monday/adapter.ts`

**Sync Capabilities:**
| Feature | Status | Implementation |
|---------|--------|----------------|
| initialSync | ❌ | Adapter only, no sync implementation |
| incrementalSync | ❌ | Not implemented |
| backfillSync | ❌ | Not implemented |

**Pagination:** GraphQL cursor-based
- `getBoards`, `getItems` with cursor pagination

**Rate Limiting:** ✅ RateLimiter (60 requests per 60 seconds)

**Retry Logic:** ✅ Exponential backoff for 429s (2^n * 1000ms)

**Watermark Tracking:** ❌ None (adapter only)

**Write Support:** ✅ `supportsWrite = true`
- `createTask`, `updateTask`, `completeTask` implemented

**Status:** **TODO - Implement sync methods**

---

### F. Google Drive (Documents) ⚠️ Adapter Only

**Files:**
- Client: `server/connectors/google-drive/client.ts`
- Adapter: `server/connectors/google-drive/adapter.ts`

**Status:** Adapter only, no sync implementation

---

## 2. SYNC ORCHESTRATION

**File:** `server/sync/orchestrator.ts`

### Architecture

```typescript
syncWorkspace(workspaceId, options?) → Promise<OrchestratorResult[]>
```

**Execution Flow:**
1. **Sequential connector execution** (for loop over sourceTypes)
   - No parallel execution
   - Continues on per-connector errors

2. **Mode decision logic:**
   ```
   If conn.last_sync_at exists → incrementalSync(since: last_sync_at)
   Else → initialSync()
   Override with options?.mode
   ```

3. **Adapter pattern:**
   - Cast to `SyncCapable`
   - Call appropriate sync method
   - Upsert pattern based on adapter type:
     - TaskAdapter → upsertTasks()
     - DocumentAdapter → upsertDocuments()
     - CRM/Conversation → connector's own upsert methods

4. **Status tracking:**
   - `updateSyncStatus(status: 'syncing'/'synced'/'error')`
   - `updateSyncCursor(lastSyncMode, lastSyncAt, recordCount)`

5. **Post-sync triggers:**
   - `emitSyncCompleted()` for:
     - Entity Linker (if gong/fireflies/hubspot/salesforce synced)
     - Internal Filter (conversation classification)
     - Skill Execution (skills with `schedule?.trigger === 'post_sync'`)
     - Computed Fields (updated during Salesforce sync)

**Error Handling:**
- ✅ Catch per-connector errors
- ✅ Aggregate results
- ✅ Continue to next connector on failure

**Locking:**
- ⚠️ No explicit locking (relies on sync_log status check in scheduler)

---

## 3. SYNC SCHEDULER

**File:** `server/sync/scheduler.ts`

**Schedule Configuration:**
```
Cron: '0 2 * * *' (2:00 AM UTC daily)
Timezone: UTC
```

**Duplicate Run Prevention:**
- ✅ Query `sync_log` for pending/running status before creating job
- ✅ Skip workspace if sync already in progress
- ⚠️ No SKIP LOCKED pattern (basic query check)

**Sync Locking Mechanism:**
- Lightweight: Check `sync_log` status = 'pending'/'running'
- In manual trigger endpoint: Check for stale locks (>1 hour → mark failed)
- Job queue: Uses `FOR UPDATE SKIP LOCKED` for atomic job selection

**Queueing Pattern:**
- Creates `sync_log` entry with status 'pending'
- Creates background job with:
  - Priority 0 (scheduled) or 1 (manual)
  - Payload: { connectorType?, mode?, syncLogId? }
- Fire-and-forget (non-blocking)

**Backfill Logic:**
```typescript
runPostSyncBackfill() called after HubSpot sync if usedExportApi:
├─ Fetch HubSpot connection
├─ Check sync_cursor.usedExportApi flag
└─ Call backfillHubSpotAssociations() for batch deal-contact-account linking
```

---

## 4. SYNC API ROUTES

**File:** `server/routes/sync.ts`

### Endpoints

| Method | Route | Behavior | Response |
|--------|-------|----------|----------|
| POST | `/:id/sync` | Manual trigger | 202 Accepted with statusUrl |
| GET | `/:id/sync/status` | Current sync status | Per-connector status |
| GET | `/:id/sync/jobs/:jobId` | Job status and progress | Job details |
| GET | `/:id/sync/jobs` | Paginated job history | Array of jobs (limit 1-100) |
| GET | `/:id/sync/history` | Sync log entries | With connector filtering |

### Async Behavior

**All endpoints are async/non-blocking:**
- Manual trigger returns **202 (Accepted)** with job ID and `statusUrl`
- Status polling via job API
- No webhook mechanism (but job queue has `notifyCompleted` hooks)

**Conflict Handling:**
- **409** if sync already running
- Stale lock cleanup (1 hour timeout)

**Example Response:**
```json
{
  "syncId": "uuid",
  "jobId": "uuid",
  "status": "pending",
  "statusUrl": "/api/workspaces/:id/sync/jobs/:jobId"
}
```

---

## 5. DATABASE SCHEMA

### connections table (001_initial.sql)

```sql
CREATE TABLE connections (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  connector_name TEXT NOT NULL,
  auth_method TEXT,
  credentials JSONB,
  status TEXT,  -- pending/connected/synced/error/disconnected/healthy/degraded
  last_sync_at TIMESTAMPTZ,
  sync_cursor JSONB,  -- { lastSyncMode, lastSyncAt, lastSyncRecords, usedExportApi }
  error_message TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(workspace_id, connector_name)
);
```

**sync_cursor JSONB structure:**
```json
{
  "lastSyncMode": "incremental",
  "lastSyncAt": "2026-02-11T10:00:00Z",
  "lastSyncRecords": 1250,
  "usedExportApi": true
}
```

---

### sync_log table (005_sync_log.sql)

```sql
CREATE TABLE sync_log (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  connector_type TEXT,      -- 'all', 'hubspot', 'gong', etc.
  sync_type TEXT,           -- 'incremental', 'scheduled', 'manual'
  status TEXT,              -- 'pending', 'running', 'completed', 'completed_with_errors', 'failed'
  records_synced INTEGER,
  errors JSONB,             -- array of error strings
  duration_ms INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_sync_log_workspace ON sync_log(workspace_id, started_at DESC);
CREATE INDEX idx_sync_log_status ON sync_log(status) WHERE status = 'running';
```

---

### jobs table (009_async_jobs.sql)

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  job_type TEXT,            -- 'sync', 'salesforce_sync', 'export', 'skill_run'
  status TEXT,              -- 'pending', 'running', 'completed', 'failed', 'cancelled'
  priority INTEGER,
  payload JSONB,            -- { connectorType?, mode?, syncLogId?, credentials? }
  progress JSONB,           -- { current, total, message }
  result JSONB,
  error TEXT,
  attempts INTEGER,
  max_attempts INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  run_after TIMESTAMPTZ,
  timeout_ms INTEGER        -- default 600000 (10 minutes)
);

CREATE INDEX idx_jobs_queue_poll ON jobs(status, priority DESC, run_after ASC, created_at ASC)
  WHERE status = 'pending';

CREATE UNIQUE INDEX idx_jobs_running_unique ON jobs(workspace_id, job_type, status)
  WHERE status = 'running';
```

**Job Polling Pattern:**
- Uses `FOR UPDATE SKIP LOCKED` for atomic selection
- Prevents duplicate job execution
- Respects `run_after` for delayed jobs

---

## 6. UTILITIES

### retry.ts

```typescript
withRetry<T>(fn: () => Promise<T>, config?: RetryConfig): Promise<T>
  // Exponential backoff (default: 3 retries, 1s base, 2x factor)

paginatedFetchWithRetry<T>(fetchPage: (cursor?) => Promise<Page<T>>): Promise<T[]>
  // Pagination helper with retry per page

class RateLimiter {
  execute<T>(fn: () => Promise<T>): Promise<T>
  // Token bucket: respects max requests per window
}
```

---

### throttle.ts ✅ **Production-Ready**

```typescript
createThrottledFetcher(config: ThrottleConfig): typeof fetch
  // Sliding window rate limiter
  // config: { maxRequests, windowMs, minDelayMs? }

// Pre-configured fetchers:
hubspotFetch: 90/100 per 10s (10% headroom)
hubspotSearchFetch: 3/sec with 300ms min delay
gongFetch: 90/60s (1 minute window)
mondayFetch: 50/60s

fetchWithRateLimitRetry(fetchFn, maxRetries): Promise<Response>
  // 429 handling with exponential backoff
  // Respects Retry-After header
```

**Implementation:**
- Sliding window (prunes timestamps older than windowMs)
- Calculates wait time if at capacity
- Ensures minDelayMs gap between requests
- Wraps with 429 retry safety net

---

### sync-helpers.ts ✅ **Best Practice**

```typescript
transformWithErrorCapture<T>(
  records: any[],
  transformFn: (record) => T,
  label: string,
  extractId?: (record) => string
): SyncResult<T>
  // Returns: { succeeded: T[], failed: ErrorRecord[] }
  // Per-record error capture
  // Logs failure rate and first error

processWithErrorCapture<T>(
  records: T[],
  processFn: (record) => Promise<void>,
  label: string,
  extractId?: (record) => string
): Promise<ProcessResult>
  // Async variant for database operations

transformAndProcess<T>(
  records: any[],
  transformFn: (record) => T,
  processFn: (records: T[]) => Promise<void>,
  options: { label, extractId?, batchSize? }
): Promise<TransformAndProcessResult>
  // Combines both with error tracking at each stage

calculateSuccessRate(result: { succeeded, failed }): number
isSyncAcceptable(result, threshold: number = 95): boolean
```

---

### hubspot-sanitize.ts ✅ **Field Sanitization**

```typescript
sanitizeDate(value: any): string | null
  // "" → null, invalid dates → null

sanitizeNumber(value: any): number | null
  // "" → null, NaN → null

sanitizeBoolean(value: any): boolean | null
  // "" → null, "true" → true

sanitizeText(value: any, convertEmpty?: boolean): string | null
  // "" → null (if convertEmpty), else ""

sanitizeForDb(props: Record<string, any>): Record<string, string | null>
  // Bulk conversion for all properties
```

**Applied to:**
- All HubSpot transform functions
- Prevents PostgreSQL errors on empty string inserts to date/numeric columns

---

## 7. SUMMARY TABLE: SYNC CAPABILITIES BY CONNECTOR

| Connector | initialSync | incrementalSync | backfillSync | Pagination | Rate Limit | Retry | Watermark | Sanitization |
|-----------|-------------|-----------------|--------------|------------|-----------|-------|-----------|--------------|
| **HubSpot** | ✅ | ✅ (cursor) | ✅ (assoc) | Cursor | ✅ 90/10s REST<br>✅ 3/s Search | ✅ Exponential | ✅ last_sync_at<br>✅ sync_cursor | ✅ |
| **Gong** | ✅ (90d) | ✅ (fromDate) | ❌ | Offset | ✅ 100/60s | ✅ Exponential | ✅ last_sync_at<br>✅ tracked_users | ❌ |
| **Fireflies** | ✅ (90d) | ✅ (afterDate) | ❌ | Date+dedup | ⚠️ None | ⚠️ None | ✅ last_sync_at<br>✅ tracked_users | ❌ |
| **Salesforce** | ✅ | ✅ (SOQL) | ❌ | SOQL/Bulk | ⚠️ None | ✅ Token refresh | ✅ last_sync_at<br>✅ SystemModstamp | ❌ |
| **Monday** | ❌ | ❌ | ❌ | GraphQL cursor | ✅ 60/60s | ✅ Exponential | ❌ None | N/A |
| **Google Drive** | ❌ | ❌ | ❌ | N/A | N/A | N/A | ❌ None | N/A |

---

## 8. GAPS & RECOMMENDATIONS

### Critical Gaps

1. **Fireflies: No retry logic** ⚠️
   - Currently relies on fetch errors
   - Should add retry wrapper with exponential backoff
   - **Impact:** Failed fetches could lose data

2. **Salesforce: No rate limiting** ⚠️
   - Relies on Salesforce governor limits
   - Could hit burst limits
   - **Impact:** Sync failures on large workspaces

3. **No 429 safety net** ⚠️
   - Throttling prevents most 429s
   - No retry for stragglers that slip through
   - **Impact:** Occasional sync failures

### Medium Gaps

4. **Sync locking is basic**
   - Query check, not advisory locks
   - Could have race conditions under heavy load
   - **Impact:** Rare duplicate syncs

5. **No field sanitization for Salesforce/Gong/Fireflies**
   - Only HubSpot has sanitize utilities
   - Empty strings could cause DB errors
   - **Impact:** Sync failures on bad data

6. **Monday.com and Google Drive: No sync implementation**
   - Adapter-only
   - **Impact:** No automated sync for tasks/documents

### Recommendations

**Immediate (Prompts 2-3):**
1. Add 429 retry wrapper to all throttled fetchers ✅ **DONE**
2. Add retry logic to Fireflies connector
3. Add basic throttle to Salesforce (100/60s)

**Short-term (Prompts 4-6):**
4. Generalize field sanitization for all connectors
5. Implement Monday.com sync methods
6. Add advisory locks for sync (pg_advisory_lock)

**Long-term:**
7. Implement Google Drive sync
8. Add webhook support for real-time updates
9. Implement backfill for Gong/Fireflies (historical data)

---

## Conclusion

Pandora has a **robust, production-grade sync infrastructure** with comprehensive error handling, rate limiting, retry logic, and async execution. The main gaps are around retry logic for Fireflies and rate limiting for Salesforce, plus generalizing field sanitization beyond HubSpot.

The prompts that follow will address these gaps systematically.
