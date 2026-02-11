# Background Job Queue

Postgres-based async job queue with progress tracking and retry logic. No Redis required.

## Features

- ✅ **Async execution**: Long-running syncs don't block API responses
- ✅ **Progress tracking**: Real-time progress updates via polling endpoint
- ✅ **Automatic retries**: Exponential backoff with configurable max attempts
- ✅ **Priority queue**: Higher priority jobs run first
- ✅ **Job scheduling**: Delay job execution with `run_after`
- ✅ **Timeout protection**: Jobs timeout after configurable duration (default 10 min)
- ✅ **Concurrency control**: Prevents duplicate jobs for same workspace

## Architecture

### Database Table: `jobs`

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  workspace_id UUID,
  job_type TEXT,                    -- 'sync', 'export', 'skill_run'
  status TEXT,                      -- 'pending', 'running', 'completed', 'failed'
  priority INTEGER,                 -- Higher = runs first
  payload JSONB,                    -- Job configuration
  progress JSONB,                   -- { current: 10, total: 100, message: "..." }
  result JSONB,                     -- Stored on completion
  error TEXT,                       -- Error message if failed
  attempts INTEGER,                 -- Current attempt count
  max_attempts INTEGER,             -- Max retries (default: 3)
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  run_after TIMESTAMPTZ,           -- For delayed jobs
  timeout_ms INTEGER               -- Job timeout (default: 600000 = 10 min)
);
```

### Queue Manager: `JobQueue`

Located in `server/jobs/queue.ts`. Polls database every 2 seconds for pending jobs.

## Usage

### 1. Creating a Job

```typescript
import { getJobQueue } from './server/jobs/queue.js';

const queue = getJobQueue();
const jobId = await queue.createJob({
  workspaceId: 'workspace-uuid',
  jobType: 'sync',
  payload: {
    connectorType: 'hubspot',
    mode: 'incremental',
  },
  priority: 1,        // Optional (default: 0)
  maxAttempts: 3,     // Optional (default: 3)
  runAfter: new Date(), // Optional (default: now)
  timeoutMs: 600000,  // Optional (default: 10 min)
});

console.log(`Job created: ${jobId}`);
```

### 2. Checking Job Status

```typescript
const job = await queue.getJob(jobId);

console.log({
  status: job.status,           // 'pending' | 'running' | 'completed' | 'failed'
  progress: job.progress,       // { current: 50, total: 100, message: "..." }
  result: job.result,           // Job result (if completed)
  error: job.error,             // Error message (if failed)
  attempts: job.attempts,       // Current attempt count
});
```

### 3. Progress Updates (Inside Job Handler)

```typescript
// Update progress during job execution
await queue.updateProgress(jobId, {
  current: 50,
  total: 100,
  message: 'Processing contacts (page 5 of 10)...',
});
```

### 4. API Endpoints

**POST /api/workspaces/:id/sync**
- Creates a background sync job
- Returns 202 Accepted with job ID
- Response includes `statusUrl` for polling

**GET /api/workspaces/:id/sync/jobs/:jobId**
- Get status of a specific job
- Includes progress, result, error

**GET /api/workspaces/:id/sync/jobs**
- List recent jobs for workspace
- Optional `?limit=20` parameter

## Job Types

### `sync`

Runs workspace sync (initial or incremental).

**Payload:**
```json
{
  "connectorType": "hubspot",  // Optional: specific connector
  "mode": "incremental",       // Optional: 'initial' | 'incremental'
  "syncLogId": "uuid"         // Sync log entry ID
}
```

**Result:**
```json
{
  "results": [...],            // Sync results per connector
  "totalRecords": 1234,       // Total records synced
  "errors": []                // Array of error messages
}
```

## Adding New Job Types

1. **Add job handler to `JobQueue.runJobHandler()`:**

```typescript
private async runJobHandler(job: Job): Promise<any> {
  switch (job.job_type) {
    case 'sync':
      return await this.handleSyncJob(job);
    case 'export':  // NEW
      return await this.handleExportJob(job);
    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

private async handleExportJob(job: Job): Promise<any> {
  // Your export logic here
  await this.updateProgress(job.id, {
    current: 0,
    total: 100,
    message: 'Starting export...',
  });

  // ... do work ...

  return { exportUrl: 'https://...' };
}
```

2. **Create job via API or code:**

```typescript
await queue.createJob({
  workspaceId: 'uuid',
  jobType: 'export',
  payload: { format: 'csv' },
});
```

## Retry Logic

Jobs automatically retry with exponential backoff using the `p-retry` package:

- **Default**: 3 attempts total (1 initial + 2 retries)
- **Backoff**: 2^attempt seconds (2s, 4s, 8s...)
- **Configurable**: Set `max_attempts` when creating job

Retry is triggered on:
- Thrown errors from job handler
- Unhandled promise rejections

## Monitoring

### Check Queue Health

```typescript
import { getJobQueue } from './server/jobs/queue.js';

const queue = getJobQueue();
const jobs = await queue.getJobsByWorkspace(workspaceId);

console.log(`Pending: ${jobs.filter(j => j.status === 'pending').length}`);
console.log(`Running: ${jobs.filter(j => j.status === 'running').length}`);
console.log(`Failed: ${jobs.filter(j => j.status === 'failed').length}`);
```

### View Job Logs

```sql
-- Recent failed jobs
SELECT id, job_type, error, attempts, created_at
FROM jobs
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 20;

-- Long-running jobs
SELECT id, job_type, started_at,
       EXTRACT(EPOCH FROM (NOW() - started_at)) as seconds_running
FROM jobs
WHERE status = 'running'
ORDER BY started_at;
```

## Production Considerations

### Scaling

- **Single worker**: Default queue manager processes one job at a time
- **Multiple workers**: Run multiple instances with `FOR UPDATE SKIP LOCKED` (already implemented)
- **Horizontal scaling**: Deploy multiple Pandora instances - jobs distribute automatically

### Cleanup

Completed jobs accumulate over time. Add a cleanup job:

```sql
-- Delete jobs older than 30 days
DELETE FROM jobs
WHERE status IN ('completed', 'failed', 'cancelled')
  AND completed_at < NOW() - INTERVAL '30 days';
```

### Monitoring Alerts

Set up alerts for:
- Jobs stuck in `running` status > 15 minutes
- High failure rate (> 20% failures in last hour)
- Queue backlog (> 100 pending jobs)

## Troubleshooting

### Job stuck in "running" status

Jobs may get stuck if worker crashes. Recovery:

```sql
-- Find stuck jobs (running > 1 hour)
SELECT id, job_type, workspace_id, started_at
FROM jobs
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '1 hour';

-- Reset to pending (will be retried)
UPDATE jobs
SET status = 'pending', started_at = NULL
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '1 hour';
```

### High failure rate

Check `jobs.error` and `jobs.last_error` columns for patterns:
- Auth errors → refresh credentials
- Timeout errors → increase `timeout_ms` or optimize job
- API rate limits → verify throttling is enabled

### Job queue not processing

```typescript
// Check if queue is running
import { getJobQueue } from './server/jobs/queue.js';
const queue = getJobQueue();
queue.start();  // Start if not running
```

Verify in server startup logs:
```
[JobQueue] Starting job queue (polling every 2000ms)
```
