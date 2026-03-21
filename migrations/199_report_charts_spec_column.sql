-- Add chart_spec column to report_charts for storing full ChartSpec JSON
-- This allows interactive charts to be stored directly in TipTap documents

-- Drop the old chart_type constraint (if it exists)
ALTER TABLE report_charts DROP CONSTRAINT IF EXISTS report_charts_chart_type_check;

-- Add chart_spec column (JSONB for full ChartSpec object)
ALTER TABLE report_charts ADD COLUMN IF NOT EXISTS chart_spec JSONB;

-- Backfill from existing chart_type for backwards compatibility
-- Existing rows will have minimal spec with just the type field
UPDATE report_charts
SET chart_spec = jsonb_build_object('type', chart_type)
WHERE chart_spec IS NULL AND chart_type IS NOT NULL;
