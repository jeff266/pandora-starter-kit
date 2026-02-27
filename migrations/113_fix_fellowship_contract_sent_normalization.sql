-- Fix deal_stage_history records for Fellowship Pipeline "Contract Sent (Fellow)" stage
-- (stage_id 1169886067) that were normalized to 'qualification' instead of 'negotiation'.
--
-- Root cause: these records were backfilled before stage_configs contained the
-- 1169886067 → "Contract Sent (Fellow)" mapping, so normalizeStage received the
-- raw numeric ID and fell back to 'qualification'. Now that stage_configs has the
-- correct entry, we can resolve and correct the normalization.

UPDATE deal_stage_history
SET stage_normalized = 'negotiation'
WHERE stage = '1169886067'
  AND stage_normalized = 'qualification';

-- Also correct deals.stage_normalized for any deal currently sitting in
-- "Contract Sent (Fellow)" that was incorrectly recorded as 'qualification'.
UPDATE deals
SET stage_normalized = 'negotiation'
WHERE stage = '1169886067'
  AND stage_normalized = 'qualification';
