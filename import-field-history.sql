-- PHASE 5: Deal Field History Import
-- Import opportunity field history.csv into deal_stage_history table

-- 1. Create temp table
CREATE TEMP TABLE temp_stage_history (
  opportunity_owner TEXT,
  edited_by TEXT,
  field_event TEXT,
  old_value TEXT,
  new_value TEXT,
  edit_date TEXT,
  opportunity_name TEXT
);

-- 2. Import CSV data
\copy temp_stage_history FROM '/Users/jeffignacio/Downloads/opportunity field history.csv' WITH (FORMAT csv, HEADER true, DELIMITER ',', QUOTE '"');

-- 3. Insert stage history entries
-- For each stage change event, create a history entry
INSERT INTO deal_stage_history (
  workspace_id, deal_id, stage, stage_normalized,
  entered_at, source, source_user
)
SELECT
  'b5318340-37f0-4815-9a42-d6644b01a298'::uuid,
  d.id as deal_id,
  t.new_value as stage,
  d.stage_normalized,  -- Use normalized stage from deal
  TO_TIMESTAMP(t.edit_date, 'MM/DD/YYYY, HH12:MI AM') as entered_at,
  'csv_import_history',
  t.edited_by
FROM temp_stage_history t
JOIN deals d ON d.name = t.opportunity_name
  AND d.workspace_id = 'b5318340-37f0-4815-9a42-d6644b01a298'::uuid
WHERE t.field_event = 'Stage'
  AND t.new_value IS NOT NULL
  AND t.new_value != ''
ORDER BY d.id, TO_TIMESTAMP(t.edit_date, 'MM/DD/YYYY, HH12:MI AM')
ON CONFLICT (deal_id, stage, entered_at) DO NOTHING;

-- 4. Update exited_at timestamps by looking at next stage entry
UPDATE deal_stage_history h1
SET exited_at = h2.entered_at,
    duration_days = EXTRACT(EPOCH FROM (h2.entered_at - h1.entered_at)) / 86400
FROM deal_stage_history h2
WHERE h1.deal_id = h2.deal_id
  AND h1.workspace_id = 'b5318340-37f0-4815-9a42-d6644b01a298'::uuid
  AND h2.workspace_id = 'b5318340-37f0-4815-9a42-d6644b01a298'::uuid
  AND h1.exited_at IS NULL
  AND h2.entered_at > h1.entered_at
  AND NOT EXISTS (
    SELECT 1 FROM deal_stage_history h3
    WHERE h3.deal_id = h1.deal_id
      AND h3.entered_at > h1.entered_at
      AND h3.entered_at < h2.entered_at
  );

-- 5. Show import results
SELECT
  COUNT(*) as total_stage_changes,
  COUNT(DISTINCT deal_id) as deals_with_history,
  COUNT(*) FILTER (WHERE exited_at IS NOT NULL) as completed_stages,
  COUNT(*) FILTER (WHERE exited_at IS NULL) as current_stages,
  ROUND(AVG(duration_days), 1) as avg_stage_duration_days
FROM deal_stage_history
WHERE workspace_id = 'b5318340-37f0-4815-9a42-d6644b01a298';

-- 6. Sample stage progression for a few deals
SELECT
  d.name as deal_name,
  h.stage,
  h.entered_at,
  h.exited_at,
  h.duration_days,
  h.source_user
FROM deal_stage_history h
JOIN deals d ON h.deal_id = d.id
WHERE h.workspace_id = 'b5318340-37f0-4815-9a42-d6644b01a298'
ORDER BY d.name, h.entered_at
LIMIT 30;
