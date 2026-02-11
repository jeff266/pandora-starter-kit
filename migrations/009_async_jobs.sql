-- Migration 009: Background Jobs Queue
-- Enables async execution of long-running syncs with progress tracking

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL, -- 'sync', 'export', 'skill_run', etc.
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
  priority INTEGER DEFAULT 0, -- Higher = runs first

  -- Job configuration
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Progress tracking
  progress JSONB DEFAULT '{}'::jsonb, -- { current: 10, total: 100, message: "Processing deals..." }

  -- Results
  result JSONB, -- Stored on completion
  error TEXT,

  -- Retry management
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Execution metadata
  run_after TIMESTAMPTZ DEFAULT NOW(), -- For delayed jobs
  timeout_ms INTEGER DEFAULT 600000, -- 10 minutes default

  -- Index hints
  CONSTRAINT valid_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);

-- Index for job queue polling (get next pending job)
CREATE INDEX IF NOT EXISTS idx_jobs_queue_poll ON jobs(status, priority DESC, created_at ASC)
  WHERE status = 'pending' AND run_after <= NOW();

-- Index for workspace job history
CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON jobs(workspace_id, created_at DESC);

-- Index for job type filtering
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type, status);

-- Prevent concurrent execution of same job
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_running_unique ON jobs(workspace_id, job_type, status)
  WHERE status = 'running';

COMMENT ON TABLE jobs IS 'Background job queue for async operations (syncs, exports, skill runs)';
COMMENT ON COLUMN jobs.payload IS 'Job configuration (e.g., { connectorType: "hubspot", mode: "incremental" })';
COMMENT ON COLUMN jobs.progress IS 'Real-time progress updates (e.g., { current: 50, total: 100, message: "Syncing contacts..." })';
COMMENT ON COLUMN jobs.result IS 'Job results stored on completion';
COMMENT ON COLUMN jobs.run_after IS 'Allows scheduling jobs for future execution';
