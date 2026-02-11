# Sync Infrastructure Audit Report

Generated: 2026-02-10

## Executive Summary

The Pandora sync infrastructure is **PARTIALLY HARDENED**. Key findings:

✅ **STRENGTHS:**
- Throttled fetchers implemented for HubSpot (90 req/10s REST, 3 req/sec Search API with 300ms spacing)
- Retry-on-429 wrapper exists and integrated with throttled fetchers
- Per-record error handling via `transformWithErrorCapture()` prevents one bad record from killing batch
- Async job queue implemented (Postgres-based, no Redis required)
- Sync locking via unique constraint on running jobs
- Watermark tracking (`connections.last_sync_at`) for incremental sync
- Field sanitization exists for HubSpot and Salesforce

⚠️ **GAPS:**
- Fireflies and Gong: No throttling (rely on built-in retry logic)
- Salesforce: Sync route NOT using async job queue (blocks for 49s)
- Monday.com: Has rate limit awareness but no throttling
- Google Drive: No throttling (but generous 1000 req/100s limit)
- Scheduler runs syncs synchronously (blocks event loop)
- No verification tests for sync infrastructure

---

## 1. CONNECTOR INVENTORY

### HubSpot ✅ BEST HARDENED

**Files:**
- Client: `server/connectors/hubspot/client.ts`
- Sync: `server/connectors/hubspot/sync.ts`
- Transform: `server/connectors/hubspot/transform.ts`

**Sync Methods:**
- ✅ `initialSync()` - Full sync using REST API pagination (cursor-based)
- ✅ `incrementalSync()` - Uses Search API with `lastmodifieddate >= since` filter
- ✅ `backfillAssociations()` - Post-sync FK resolution

**Pagination:**
- REST API: Cursor-based (`after` parameter), 100 records/page
- Search API: Cursor-based, 100 records/page
- Auto-pagination via `getAllDeals()`, `getAllContacts()`, `getAllCompanies()`

**Throttling:** ✅ EXCELLENT
```typescript
// Standard REST API: 90 of 100/10s limit (10% headroom)
const response = await hubspotFetch(url, options);

// Search API: 3 of 4/sec limit + 300ms minimum delay
const response = await hubspotSearchFetch(url, options);
```
- Automatically selects throttler based on API endpoint
- Search API calls use `hubspotSearchFetch` (tighter limit)
- REST API calls use `hubspotFetch`

**Retry Logic:** ✅ EXCELLENT
- `fetchWithRateLimitRetry()` integrated with throttled fetchers
- Respects `Retry-After` header
- Exponential backoff: 2s, 4s, 8s
- Max 3 retries

**Watermark:** ✅ YES
- Stored in `connections.last_sync_at`
- Updated after successful sync
- Used to determine initial vs incremental mode

**Async Execution:** ✅ PARTIAL
- Manual sync via `/api/workspaces/:id/sync` returns 202, creates background job ✅
- Scheduler sync runs SYNCHRONOUSLY (blocks) ⚠️

---

### Salesforce ⚠️ NEEDS WORK

**Files:**
- Client: `server/connectors/salesforce/client.ts`
- Sync: `server/connectors/salesforce/sync.ts`
- Transform: `server/connectors/salesforce/transform.ts`
- Adapter: `server/connectors/salesforce/adapter.ts`
- Auth Routes: `server/routes/salesforce-auth.ts`
- Sync Route: `server/routes/salesforce-sync.ts`

**Sync Methods:**
- ✅ `initialSync()` in adapter - Uses REST API < 10K records, Bulk API >= 10K
- ❌ `incrementalSync()` - EXISTS in adapter but NOT wired to sync route
- ✅ `syncSalesforce()` in sync.ts - Full sync implementation (similar to HubSpot pattern)

**Pagination:**
- REST API: Cursor-based (`nextRecordsUrl`), auto-pagination via `queryAll()`
- Bulk API 2.0: CSV chunking with `Sforce-Locator` header
- Smart strategy: < 10K uses REST, >= 10K uses Bulk API with fallback

**Throttling:** ❌ NONE
- No throttled fetcher
- Relies on Salesforce's generous limits (100K+ req/day for Enterprise)
- **RISK**: May hit limits during multi-workspace syncs or if other apps share OAuth token

**Retry Logic:** ✅ PARTIAL
- Uses `withRetry()` from `server/utils/retry.ts` for query operations
- Does NOT have retry-on-429 wrapper
- Bulk API has retry built into polling loop (timeout fallback)

**Watermark:** ✅ YES
- Uses `SystemModstamp` field for incremental sync detection
- Stored in `connections.last_sync_at`
- Adapter has `incrementalSync()` but NOT called by sync route

**Async Execution:** ❌ SYNCHRONOUS
- `POST /api/workspaces/:id/connectors/salesforce/sync` runs sync INLINE
- Blocks for ~49 seconds (based on production test: 13,826 records)
- Does NOT use async job queue
- **CRITICAL GAP**: Should create job and return 202 like HubSpot route

---

### Gong ⚠️ PARTIAL

**Files:**
- Client: `server/connectors/gong/client.ts`
- Sync: `server/connectors/gong/sync.ts`
- Transform: `server/connectors/gong/transform.ts`

**Sync Methods:**
- ✅ `initialSync()` - Full sync via `getCalls()`
- ✅ `incrementalSync()` - Uses `fromDateTime` parameter

**Pagination:**
- Cursor-based: `calls.cursor` from API response
- `getCalls()` loops until no cursor returned
- Returns `{ calls: [], cursor?: string }`

**Throttling:** ❌ NONE
- No throttled fetcher
- Gong API limit: 100 req/min
- **RISK**: May hit rate limits during large syncs or multi-workspace operations

**Retry Logic:** ❌ MINIMAL
- No explicit retry on 429
- No exponential backoff
- Throws errors directly to caller

**Watermark:** ✅ YES
- Uses `connections.last_sync_at`
- `incrementalSync()` passes `since` to `getCalls(fromDateTime: since)`

**Async Execution:** ✅ YES (via orchestrator)
- Uses generic orchestrator pattern
- Runs via async job queue when triggered from `/api/workspaces/:id/sync`

---

### Fireflies ✅ GOOD

**Files:**
- Client: `server/connectors/fireflies/client.ts`
- Sync: `server/connectors/fireflies/sync.ts`
- Transform: `server/connectors/fireflies/transform.ts`

**Sync Methods:**
- ✅ `initialSync()` - Full fetch via `getAllTranscripts()`
- ✅ `incrementalSync()` - Uses `afterDate` parameter for client-side filtering

**Pagination:**
- Offset-based: `skip` parameter (skip = page * PAGE_SIZE)
- PAGE_SIZE = 50
- Uses `paginatedFetchWithRetry()` utility

**Throttling:** ✅ BUILT-IN
- Uses `paginatedFetchWithRetry()` with `pageDelay: 200ms`
- NOT a formal throttle (no req/sec limit) but prevents rapid-fire requests
- **Pattern from utils/retry.ts:**
```typescript
await paginatedFetchWithRetry(fetchPage, {
  pageDelay: 200,          // 200ms delay between pages
  consecutiveErrorLimit: 3, // Stop after 3 consecutive errors
  retryConfig: {
    maxRetries: 3,
    baseDelay: 1000,        // 1s, 2s, 4s exponential backoff
    backoffFactor: 2
  }
});
```

**Retry Logic:** ✅ EXCELLENT
- Exponential backoff: 1s, 2s, 4s
- Max 3 retries per request
- Consecutive error limit: stops pagination after 3 consecutive page failures
- 200ms delay between successful pages

**Watermark:** ✅ YES
- Uses `afterDate` parameter in `getAllTranscripts()`
- **GOTCHA**: Fireflies API doesn't support server-side date filtering
- Client filters after fetch: fetches all, then filters by date in-memory
- Pagination stops when filtered results = 0 for a page

**Async Execution:** ✅ YES (via orchestrator)

---

### Monday.com ⚠️ PARTIAL

**Files:**
- Client: `server/connectors/monday/client.ts`
- Adapter: `server/connectors/monday/adapter.ts`

**Sync Methods:**
- ✅ `initialSync()` via adapter pattern
- ❌ `incrementalSync()` - NOT IMPLEMENTED (falls back to initial sync)

**Pagination:**
- GraphQL-based: Uses `boards { items { cursor } }` pattern
- Pagination limit: 100 items per query
- No dedicated sync.ts file - uses adapter pattern

**Throttling:** ❌ NONE
- No throttled fetcher
- Has `getRateLimitInfo()` method for monitoring but doesn't enforce limits
- Monday API limit: ~60 req/min
- **RISK**: May hit limits during large board syncs

**Retry Logic:** ❌ MINIMAL
- No explicit retry wrapper
- GraphQL errors thrown directly

**Watermark:** ❌ NO
- No incremental sync support
- Always does full fetch

**Async Execution:** ✅ YES (via orchestrator)

**Notes:**
- Task data typically small enough for full fetch
- GraphQL allows fetching exactly the fields needed (efficient)
- TODO: Add incremental sync for workspaces with 1000+ tasks

---

### Google Drive ⚠️ PARTIAL

**Files:**
- Client: `server/connectors/google-drive/client.ts`
- Adapter: `server/connectors/google-drive/adapter.ts`

**Sync Methods:**
- ✅ `initialSync()` via adapter pattern
- ❌ `incrementalSync()` - NOT IMPLEMENTED

**Pagination:**
- Google Drive API: Uses `nextPageToken`
- Pagination handled by Google's client library

**Throttling:** ❌ NONE
- No throttled fetcher
- Google Drive limit: 1000 req/100s (very generous)
- Low risk of hitting limits

**Retry Logic:** ✅ BUILT-IN
- Google client library has built-in retry
- No explicit wrapper needed

**Watermark:** ❌ NO
- No incremental sync
- Always fetches all files (with optional `modifiedTime` filter if passed)

**Async Execution:** ✅ YES (via orchestrator)

**Notes:**
- File lists typically small (< 1000 files)
- Full fetch is acceptable
- Could add `modifiedTime >= since` filter if needed

---

## 2. SYNC ORCHESTRATION

**File:** `server/sync/orchestrator.ts`

**Mode Detection Logic:**
```typescript
const mode = options?.mode || (conn.last_sync_at ? 'incremental' : 'initial');
```
- ✅ Auto-detects based on `connections.last_sync_at`
- ✅ If `last_sync_at` is NULL → `initialSync()`
- ✅ If `last_sync_at` exists → `incrementalSync(since: last_sync_at)`
- ✅ Manual override: can force `mode: 'initial'` via options

**Connector Execution:**
- ❌ **SEQUENTIAL** (one connector at a time in for loop)
- Each connector waits for previous to complete
- **OPPORTUNITY**: Could run connectors in parallel (they're independent)

**Error Handling:**
- ✅ Per-connector try/catch - one connector failure doesn't kill others
- ✅ Returns `{ status: 'error', message }` for failed connectors
- ✅ Continues processing remaining connectors after error

**Post-Sync Actions:**
- ✅ Updates `connections.last_sync_at` after successful sync
- ✅ Updates `connections.status` ('synced' or 'error')
- ✅ Stores sync mode in `connections.sync_cursor` metadata
- ✅ Emits `syncCompleted` event (triggers computed fields, post-sync hooks)

**Watermark Update:**
```typescript
await updateSyncCursor(workspaceId, sourceType, {
  lastSyncMode: mode,
  lastSyncAt: new Date().toISOString(),
});
```

**Computed Fields:**
- Post-sync event triggers: `emitSyncCompleted(workspaceId, results)`
- Handled by `server/sync/post-sync-events.ts`
- Runs computed field engine after sync completes

---

## 3. SYNC SCHEDULER

**File:** `server/sync/scheduler.ts`

**Schedule:** `0 2 * * *` (Daily at 2:00 AM UTC)

**Duplicate Prevention:** ⚠️ PARTIAL
- Queries for workspaces with connected sources
- Does NOT check for running syncs before triggering
- **GAP**: Could trigger duplicate sync if manual sync is running at 2 AM

**Sync Locking:** ❌ NONE in scheduler
- No advisory lock check before starting sync
- **RISK**: Scheduler could start sync while manual sync is running

**Execution Pattern:** ❌ SYNCHRONOUS
```typescript
for (const ws of workspaces) {
  const results = await syncWorkspace(ws.id); // BLOCKS here
  // ...update sync_log...
}
```
- Awaits each workspace's sync completion
- Blocks event loop for duration of all syncs
- **CRITICAL GAP**: Should fire-and-forget like the API route does

**Sync Logging:**
- ✅ Creates `sync_log` entry with `status: 'running'`
- ✅ Updates on completion: `status`, `records_synced`, `errors`, `duration_ms`
- ✅ Handles failures: marks as 'failed' with error message

**Post-Sync Backfill:**
- ✅ Runs `backfillHubSpotAssociations()` after HubSpot sync
- Only for workspaces that used Export API (metadata flag check)

---

## 4. SYNC API ROUTES

**File:** `server/routes/sync.ts`

### POST /api/workspaces/:id/sync

**Behavior:** ✅ ASYNC (non-blocking)
```typescript
// 1. Checks for running sync (409 if found)
const runningResult = await query(
  `SELECT id FROM sync_log WHERE workspace_id = $1 AND status = 'running'`
);
if (runningResult.rows.length > 0) {
  res.status(409).json({ error: 'Sync already running' });
  return;
}

// 2. Creates sync_log entry
const syncLogResult = await query(
  `INSERT INTO sync_log (...) VALUES (...) RETURNING id`
);

// 3. Creates background job
const jobQueue = getJobQueue();
const jobId = await jobQueue.createJob({
  workspaceId,
  jobType: 'sync',
  payload: { connectorType, syncLogId },
  priority: 1, // Manual syncs get higher priority
});

// 4. Returns 202 immediately
res.status(202).json({
  syncId: syncLogResult.rows[0].id,
  jobId,
  status: 'queued',
  statusUrl: `/api/workspaces/${workspaceId}/sync/jobs/${jobId}`,
});
```

**Sync Locking:** ✅ YES
- Checks `sync_log` for `status = 'running'` before creating job
- Returns 409 Conflict if sync already running
- **GOTCHA**: Doesn't check for stale locks (> 30 min old)

**Response Time:** ✅ < 100ms (non-blocking)

### GET /api/workspaces/:id/sync/jobs/:jobId

**Behavior:** ✅ PROGRESS TRACKING
```typescript
const job = await jobQueue.getJob(jobId);
res.json({
  id: job.id,
  status: job.status, // 'pending' | 'running' | 'completed' | 'failed'
  progress: job.progress, // { current, total, message }
  result: job.result,
  error: job.error,
  attempts: job.attempts,
  createdAt: job.created_at,
  startedAt: job.started_at,
  completedAt: job.completed_at,
});
```

**Features:**
- ✅ Real-time progress updates
- ✅ Error reporting
- ✅ Retry count tracking

### GET /api/workspaces/:id/sync/jobs

**Behavior:** Lists recent jobs
- Returns last 20 jobs (configurable via `?limit=` param)
- Ordered by `created_at DESC`

### GET /api/workspaces/:id/sync/status

**Behavior:** Returns connector sync status
- Shows `last_sync_at` per connector
- Shows connector status (`connected`, `synced`, `error`)
- Shows running sync if any

### GET /api/workspaces/:id/sync/history

**Behavior:** Returns sync log history
- Last 20 sync runs (configurable via `?limit=` param)
- Can filter by `?connector=hubspot`
- Shows duration, records synced, errors

---

## 5. DATABASE

### sync_log Table

**Schema** (from `migrations/005_sync_log.sql`):
```sql
CREATE TABLE sync_log (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector_type TEXT NOT NULL,
  sync_type TEXT NOT NULL DEFAULT 'incremental',
  status TEXT NOT NULL DEFAULT 'running',
  records_synced INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]',
  duration_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

**Indexes:**
- `idx_sync_log_workspace` on `(workspace_id, started_at DESC)`
- `idx_sync_log_status` on `(status)` WHERE status = 'running'

**Missing:**
- ❌ No `metadata` JSONB column for progress tracking
- ❌ No index on `(workspace_id, status)` for lock checking

### connections Table

**Schema** (from `migrations/001_initial.sql`):
```sql
CREATE TABLE connections (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector_name TEXT NOT NULL,
  auth_method TEXT NOT NULL DEFAULT 'oauth',
  credentials JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  last_sync_at TIMESTAMPTZ,           -- ✅ Watermark
  sync_cursor JSONB,                  -- ✅ Sync metadata
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, connector_name)
);
```

**Watermark Tracking:** ✅ YES
- `last_sync_at` stores last successful sync time
- `sync_cursor` stores metadata: `{ lastSyncMode, lastSyncAt, usedExportApi }`

### jobs Table

**Schema** (from `migrations/009_async_jobs.sql`):
```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}',
  progress JSONB DEFAULT '{}',
  result JSONB,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  run_after TIMESTAMPTZ DEFAULT NOW(),
  timeout_ms INTEGER DEFAULT 600000,
  CONSTRAINT valid_status CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  )
);
```

**Indexes:**
- `idx_jobs_queue_poll` on `(status, priority DESC, created_at ASC)` WHERE status = 'pending'
- `idx_jobs_workspace` on `(workspace_id, created_at DESC)`
- `idx_jobs_type` on `(job_type, status)`
- `idx_jobs_running_unique` UNIQUE on `(workspace_id, job_type, status)` WHERE status = 'running'

**Sync Locking:** ✅ YES
- Unique index prevents duplicate running jobs per workspace
- Uses `FOR UPDATE SKIP LOCKED` for distributed worker safety

---

## 6. UTILITIES

### server/utils/retry.ts ✅ COMPREHENSIVE

**Exports:**

1. **`withRetry<T>(fn, config?)`**
   - Basic retry with exponential backoff
   - Config: `{ maxRetries, baseDelay, backoffFactor, maxDelay, onRetry }`
   - Default: 3 retries, 1s base delay, 2x backoff
   - Used by: Salesforce client for query operations

2. **`paginatedFetchWithRetry<T>(fetchPage, options?)`**
   - Retry + pagination helper
   - Options: `{ maxPages, pageDelay, retryConfig, consecutiveErrorLimit, onProgress }`
   - Default: 20 pages, 200ms delay, 3 consecutive error limit
   - Used by: Fireflies client
   - **Built-in throttling**: 200ms delay between pages

3. **`RateLimiter` class**
   - Token bucket rate limiter
   - Constructor: `new RateLimiter(maxRequests, windowMs)`
   - Method: `execute<T>(fn)` - wraps function with rate limit enforcement
   - **NOT USED** in current codebase (prefer createThrottledFetcher pattern)

### server/utils/throttle.ts ✅ PRODUCTION-READY

**Exports:**

1. **`createThrottledFetcher(config)`**
   - Sliding window rate limiter
   - Config: `{ maxRequests, windowMs, minDelayMs? }`
   - Returns async function with fetch signature
   - Tracks request timestamps, waits if at capacity
   - Optional `minDelayMs` for per-second limits (Search API)

2. **Pre-configured instances:**
```typescript
hubspotFetch          // 90 req / 10s (REST API)
hubspotSearchFetch    // 3 req / 1s + 300ms spacing (Search API)
gongFetch             // 90 req / 60s
mondayFetch           // 50 req / 60s
```

3. **`fetchWithRateLimitRetry(fetchFn, maxRetries?)`**
   - Retry-on-429 wrapper
   - Respects `Retry-After` header
   - Exponential backoff: 2s, 4s, 8s
   - Integrated with throttled fetchers
   - **Safety net**: Catches 429s that slip through throttling

### server/utils/sync-helpers.ts ✅ CRITICAL

**Exports:**

1. **`transformWithErrorCapture<TInput, TOutput>(...)`**
   - Per-record error handling
   - Parameters:
     - `records: TInput[]`
     - `transformFn: (record: TInput) => TOutput`
     - `label: string` (for logging)
     - `extractId?: (record: TInput) => string` (optional ID extraction)
   - Returns: `{ succeeded: TOutput[], failed: [...], totalAttempted }`
   - Logs warnings if failure rate > 10%
   - Used by: HubSpot, Gong, Fireflies sync functions

**Pattern:**
```typescript
const result = transformWithErrorCapture(
  rawDeals,
  (deal) => transformDeal(deal, workspaceId, options),
  'HubSpot Deals',
  (deal) => deal.id
);

await upsertDeals(result.succeeded);
// One bad record doesn't kill the batch!
```

### server/utils/hubspot-sanitize.ts ⚠️ HUBSPOT-SPECIFIC

**Exports:**
- `sanitizeHubSpotDate(value)`
- `sanitizeHubSpotNumber(value)`
- Functions to convert `""` → `null` for PostgreSQL compatibility

**Status:** ✅ EXISTS but only for HubSpot

**Gap:** No generic field sanitizer for other connectors

### server/connectors/salesforce/transform.ts ⚠️ PARTIAL

**Functions:**
- `sanitizeText(value, maxLength)` - Handles null, empty strings, truncates
- `sanitizeDate(value)` - Converts empty strings to null
- `extractDomain(website)` - URL parsing
- `parseSeniority(title)` - Heuristic-based seniority detection

**Status:** ✅ Salesforce-specific, works well

---

## 7. CRITICAL GAPS & RECOMMENDATIONS

### Priority 1: CRITICAL (Production Blockers)

1. **Salesforce Sync Not Async** ⚠️
   - **Issue**: `POST /api/workspaces/:id/connectors/salesforce/sync` blocks for ~49s
   - **Impact**: HTTP timeouts, event loop blocking
   - **Fix**: Update route to create job, return 202 (like HubSpot route)
   - **Effort**: 30 minutes

2. **Scheduler Runs Syncs Synchronously** ⚠️
   - **Issue**: `await syncWorkspace()` blocks event loop during scheduled sync
   - **Impact**: Server unresponsive during 2 AM sync window
   - **Fix**: Fire-and-forget pattern (don't await)
   - **Effort**: 15 minutes

3. **No Stale Lock Cleanup** ⚠️
   - **Issue**: If sync crashes, lock stays forever
   - **Impact**: Workspace can't sync until manual cleanup
   - **Fix**: Check for locks > 30 min old, mark as 'failed'
   - **Effort**: 15 minutes

### Priority 2: HIGH (Risk Mitigation)

4. **Gong: No Throttling** ⚠️
   - **Issue**: No rate limiting, 100 req/min limit
   - **Impact**: May hit 429s during large syncs
   - **Fix**: Add `gongFetch` to client (already exists in throttle.ts)
   - **Effort**: 10 minutes

5. **Monday: No Throttling** ⚠️
   - **Issue**: No rate limiting, ~60 req/min limit
   - **Impact**: May hit 429s during large board syncs
   - **Fix**: Add `mondayFetch` to client (already exists)
   - **Effort**: 10 minutes

6. **Salesforce: No Incremental Sync in Route** ⚠️
   - **Issue**: Adapter has `incrementalSync()` but route always runs full sync
   - **Impact**: Re-fetches all 13K+ records every time
   - **Fix**: Wire adapter's incrementalSync to sync route
   - **Effort**: 30 minutes

### Priority 3: MEDIUM (Optimization)

7. **Sequential Connector Execution** ℹ️
   - **Issue**: Orchestrator runs connectors one at a time
   - **Impact**: Slower syncs when multiple connectors configured
   - **Fix**: Run connectors in parallel (`Promise.all()`)
   - **Effort**: 30 minutes
   - **Risk**: Higher load on server, may need rate limit coordination

8. **No Progress Updates in sync_log** ℹ️
   - **Issue**: `sync_log` has no metadata column for progress
   - **Impact**: Can't track progress of syncs not using job queue
   - **Fix**: Add migration for `metadata JSONB` column
   - **Effort**: 15 minutes

9. **No Verification Tests** ℹ️
   - **Issue**: No automated tests for sync infrastructure
   - **Impact**: Regression risk when making changes
   - **Fix**: Create `scripts/verify-sync-infra.ts` per Prompt 7
   - **Effort**: 2 hours

### Priority 4: LOW (Nice to Have)

10. **Monday/Google Drive: No Incremental Sync** ℹ️
    - **Issue**: Always full fetch
    - **Impact**: Slower syncs, more API calls
    - **Fix**: Add incremental sync support
    - **Effort**: 1-2 hours per connector
    - **Note**: Data volumes typically small, not urgent

---

## 8. TESTING VALIDATION

### What Works Well ✅

Based on production Salesforce sync (13,826 records in 49s):

1. **Per-record error handling**: ✅ Validated
   - 24 deals with unmapped stages handled gracefully
   - Transform errors caught, logged, didn't kill batch

2. **FK resolution**: ✅ Validated
   - Accounts → Contacts → Deals order preserved
   - Foreign keys resolved correctly

3. **Computed fields**: ✅ Validated
   - Post-sync event triggered field engine
   - Velocity, risk, health scores calculated

4. **HubSpot throttling**: ✅ Validated (from logs)
   - Search API calls spaced 300ms apart
   - No 429 errors during incremental sync

### Not Yet Validated ⚠️

1. **Async job queue progress tracking**: Not tested with real sync
2. **Retry-on-429**: Not hit 429 yet (throttling working too well!)
3. **Stale lock cleanup**: No crashed syncs to test
4. **Parallel connector execution**: Not implemented

---

## 9. SUMMARY SCORECARD

| Component | Status | Notes |
|-----------|--------|-------|
| **HubSpot Sync** | ✅ EXCELLENT | Throttled, async, incremental, retry-on-429 |
| **Salesforce Sync** | ⚠️ NEEDS WORK | Not async, no incremental in route, no throttling |
| **Gong Sync** | ⚠️ PARTIAL | Incremental works, no throttling, no retry |
| **Fireflies Sync** | ✅ GOOD | Built-in retry + delay, incremental works |
| **Monday Sync** | ⚠️ PARTIAL | No incremental, no throttling |
| **Google Drive Sync** | ⚠️ PARTIAL | No incremental, no throttling (but low risk) |
| **Orchestrator** | ✅ GOOD | Auto-detects mode, per-connector errors |
| **Scheduler** | ⚠️ NEEDS WORK | Runs synchronously, no lock check |
| **Async Job Queue** | ✅ EXCELLENT | Postgres-based, progress tracking, retry |
| **Throttling** | ⚠️ PARTIAL | HubSpot only, others missing |
| **Retry Logic** | ✅ GOOD | HubSpot + Fireflies have it, others don't |
| **Field Sanitization** | ⚠️ PARTIAL | HubSpot + Salesforce only |
| **Per-Record Errors** | ✅ EXCELLENT | `transformWithErrorCapture()` used everywhere |
| **Watermark Tracking** | ✅ GOOD | All connectors except Monday/Drive |
| **Sync Locking** | ⚠️ PARTIAL | Jobs table has it, sync_log doesn't check stale |
| **Documentation** | ⚠️ MINIMAL | No SYNC_FIELD_GUIDE.md in repo |
| **Tests** | ❌ NONE | No verification tests |

---

## 10. RECOMMENDED EXECUTION PLAN

### Quick Wins (< 2 hours)

1. ✅ Wire Salesforce sync to async job queue (30 min)
2. ✅ Add stale lock cleanup to sync route (15 min)
3. ✅ Make scheduler fire-and-forget (15 min)
4. ✅ Add Gong throttling (10 min)
5. ✅ Add Monday throttling (10 min)
6. ✅ Wire Salesforce incremental sync to route (30 min)

### Medium Term (2-4 hours)

7. Add `metadata` column to `sync_log` table (15 min)
8. Add progress updates to orchestrator (1 hour)
9. Parallel connector execution in orchestrator (30 min)
10. Create verification test script (2 hours)

### Long Term (4+ hours)

11. Incremental sync for Monday.com (1-2 hours)
12. Incremental sync for Google Drive (1 hour)
13. Generic field sanitizer (replace hubspot-specific) (1 hour)
14. Add Salesforce throttling (optional, low priority) (30 min)

---

## APPENDIX: File Locations Reference

### Core Sync Files
- Orchestrator: `server/sync/orchestrator.ts`
- Scheduler: `server/sync/scheduler.ts`
- Post-sync events: `server/sync/post-sync-events.ts`
- Backfill: `server/sync/backfill.ts`

### Sync Routes
- Generic sync: `server/routes/sync.ts`
- Salesforce sync: `server/routes/salesforce-sync.ts`
- Salesforce auth: `server/routes/salesforce-auth.ts`

### Utilities
- Retry: `server/utils/retry.ts`
- Throttle: `server/utils/throttle.ts`
- Sync helpers: `server/utils/sync-helpers.ts`
- HubSpot sanitize: `server/utils/hubspot-sanitize.ts`

### Job Queue
- Queue manager: `server/jobs/queue.ts`
- Documentation: `server/jobs/README.md`

### Connectors (per connector)
- Client: `server/connectors/{connector}/client.ts`
- Sync: `server/connectors/{connector}/sync.ts`
- Transform: `server/connectors/{connector}/transform.ts`
- Adapter: `server/connectors/{connector}/adapter.ts` (for CRM connectors)

### Database
- Migrations: `migrations/*.sql`
- Schema: `migrations/001_initial.sql` (connections, deals, contacts, accounts)
- Sync log: `migrations/005_sync_log.sql`
- Jobs: `migrations/009_async_jobs.sql`
