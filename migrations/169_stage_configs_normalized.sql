-- Add stage_normalized classification column to stage_configs
ALTER TABLE stage_configs
  ADD COLUMN IF NOT EXISTS stage_normalized TEXT
  CHECK (stage_normalized IN ('open', 'won', 'lost', 'parking_lot', 'excluded'));

-- Populate based on stage name patterns (applies to all workspaces)
UPDATE stage_configs SET stage_normalized = CASE
  -- Won
  WHEN TRIM(stage_name) ILIKE 'closed won%'                          THEN 'won'
  WHEN TRIM(stage_name) ILIKE '%fellow contract signed%'             THEN 'won'
  WHEN TRIM(stage_name) ILIKE 'pilot won%'                          THEN 'won'
  -- Lost
  WHEN TRIM(stage_name) ILIKE 'closed lost%'                        THEN 'lost'
  WHEN TRIM(stage_name) ILIKE '%not selected%(closed-lost)%'        THEN 'lost'
  WHEN TRIM(stage_name) ILIKE '%redirect to core sales%(closed-lost)%' THEN 'lost'
  WHEN TRIM(stage_name) ILIKE '%fellow closed-lost%'                THEN 'lost'
  WHEN TRIM(stage_name) ILIKE '%pilot lost%'                        THEN 'lost'
  WHEN TRIM(stage_name) ILIKE '%never activated%lost%'              THEN 'lost'
  WHEN TRIM(stage_name) ILIKE '%| lost'                             THEN 'lost'
  -- Parking lot
  WHEN TRIM(stage_name) ILIKE '%deferred%'                          THEN 'parking_lot'
  -- Excluded (stage-0 / pre-opportunity)
  WHEN TRIM(stage_name) ILIKE 'new lead%'                           THEN 'excluded'
  -- Everything else is open
  ELSE 'open'
END
WHERE stage_normalized IS NULL;
