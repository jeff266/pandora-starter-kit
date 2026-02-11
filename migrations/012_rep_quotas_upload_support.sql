-- Extend rep_quotas table to support Excel upload feature
-- Adds email matching, source tracking, and batch management

-- Add new columns to rep_quotas
ALTER TABLE rep_quotas
ADD COLUMN IF NOT EXISTS rep_email TEXT,
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS upload_batch_id UUID;

-- Add index for email-based lookup
CREATE INDEX IF NOT EXISTS idx_rep_quotas_email
  ON rep_quotas(period_id, rep_email)
  WHERE rep_email IS NOT NULL;

-- Add index for batch operations
CREATE INDEX IF NOT EXISTS idx_rep_quotas_batch
  ON rep_quotas(upload_batch_id)
  WHERE upload_batch_id IS NOT NULL;

-- Add constraint for source values
ALTER TABLE rep_quotas
DROP CONSTRAINT IF EXISTS rep_quotas_source_check;

ALTER TABLE rep_quotas
ADD CONSTRAINT rep_quotas_source_check
  CHECK (source IN ('manual', 'excel_upload', 'csv_upload', 'hubspot', 'salesforce'));

-- Update unique constraint to prefer email over name
-- Drop old constraint
ALTER TABLE rep_quotas
DROP CONSTRAINT IF EXISTS rep_quotas_period_id_rep_name_key;

-- Add new unique constraint on email+period (when email exists)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_quotas_unique_email_period
  ON rep_quotas(period_id, rep_email)
  WHERE rep_email IS NOT NULL;

-- Keep name+period unique only when email is null (fallback)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_quotas_unique_name_period
  ON rep_quotas(period_id, rep_name)
  WHERE rep_email IS NULL;

-- Add comments
COMMENT ON COLUMN rep_quotas.rep_email IS
  'Email address from quota upload. Note: deals table only has owner name, not email, so matching is by name only.';

COMMENT ON COLUMN rep_quotas.source IS
  'Source of quota data: manual (UI), excel_upload, csv_upload, hubspot (Goals API), salesforce (Quota object)';

COMMENT ON COLUMN rep_quotas.upload_batch_id IS
  'Groups quotas from the same upload for batch operations (e.g., undo upload)';

-- Helper function to match rep to deals by name
-- Note: deals table only has 'owner' (name), no owner_email column
CREATE OR REPLACE FUNCTION match_rep_to_deals(
  p_workspace_id UUID,
  p_rep_email TEXT,  -- Not used (kept for compatibility)
  p_rep_name TEXT
)
RETURNS TABLE (
  matched_email TEXT,
  matched_name TEXT,
  deal_count INTEGER
) AS $$
BEGIN
  -- Match by name only (deals table has no owner_email column)
  RETURN QUERY
  SELECT
    NULL::TEXT as matched_email,  -- No email in deals table
    owner as matched_name,
    COUNT(*)::INTEGER as deal_count
  FROM deals
  WHERE workspace_id = p_workspace_id
    AND LOWER(owner) = LOWER(p_rep_name)
  GROUP BY owner
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION match_rep_to_deals IS
  'Match uploaded rep to existing deal owners by name (deals table has no owner_email)';
