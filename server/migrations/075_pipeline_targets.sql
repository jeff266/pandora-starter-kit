-- Migration: Pipeline-Specific Targets
-- Adds pipeline_id column to targets table to support pipeline-specific targets
-- Null pipeline_id = workspace-wide target (all pipelines combined)

ALTER TABLE targets
  ADD COLUMN pipeline_id TEXT,
  ADD COLUMN pipeline_name TEXT;

-- Index for pipeline-specific target lookups
CREATE INDEX idx_targets_pipeline ON targets(workspace_id, pipeline_id, period_start, is_active);

COMMENT ON COLUMN targets.pipeline_id IS 'Optional pipeline ID - null means workspace-wide target across all pipelines';
COMMENT ON COLUMN targets.pipeline_name IS 'Pipeline name snapshot (denormalized for display)';

-- Update existing targets to be workspace-wide (pipeline_id = null)
-- No action needed - new column defaults to null
