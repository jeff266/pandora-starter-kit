-- Migration 194: Performance Indexes
-- Adds missing indexes for common BI query patterns and skill/chart lookups.

-- Close date range queries for BI
-- Used by: "deals closing this quarter", "pipeline by close date bucket"
CREATE INDEX IF NOT EXISTS
  idx_deals_close_date
  ON deals(workspace_id, close_date)
  WHERE close_date IS NOT NULL;

-- Pipeline + stage composite for Fellowship exclusion
-- Used by: getForecastPipelines() scoping
CREATE INDEX IF NOT EXISTS
  idx_deals_pipeline_stage
  ON deals(workspace_id, pipeline, stage_normalized)
  WHERE amount > 0;

-- Amount range for deal value queries
-- Used by: "show me deals over $100K", "pipeline by deal size bucket"
CREATE INDEX IF NOT EXISTS
  idx_deals_amount
  ON deals(workspace_id, amount DESC)
  WHERE amount > 0;

-- Last activity date for staleness queries
-- Used by: "deals dark 30+ days", chart intelligence stale deal extraction
CREATE INDEX IF NOT EXISTS
  idx_deals_last_activity
  ON deals(workspace_id, last_activity_date)
  WHERE last_activity_date IS NOT NULL;

-- skill_runs: completed-only lookup for summarizer
-- Supplements existing workspace_skill_created index with status filter
CREATE INDEX IF NOT EXISTS
  idx_skill_runs_workspace_skill_status
  ON skill_runs(workspace_id, skill_id, status, created_at DESC)
  WHERE status = 'completed';

-- report_charts: workspace + section lookup for data picker
-- Supplements existing idx_report_charts_document
CREATE INDEX IF NOT EXISTS
  idx_report_charts_workspace_section
  ON report_charts(workspace_id, section_id, created_at DESC);
