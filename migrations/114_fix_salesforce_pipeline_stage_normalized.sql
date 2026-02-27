-- Fix deal_stage_history and deals records where stage_normalized = 'pipeline'.
-- This is not a valid Pandora taxonomy stage. It was produced by the fallback return
-- value in normalizeSalesforceStageName() when no pattern matched. The correct
-- fallback for an unknown/early-funnel Salesforce stage is 'awareness'.

UPDATE deal_stage_history
SET stage_normalized = 'awareness'
WHERE stage_normalized = 'pipeline';

UPDATE deals
SET stage_normalized = 'awareness'
WHERE stage_normalized = 'pipeline';
