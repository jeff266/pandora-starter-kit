-- Migration 213: Add assumptions column to findings table
-- The insertFindings function has always tried to persist FindingFinding.assumptions
-- (calibration UI overlays) but the column was never added to the table.
-- This caused every insertFindings() call to fail silently, resulting in 0 findings
-- for any workspace whose skill runs postdate the assumptions logic being added.
ALTER TABLE findings ADD COLUMN IF NOT EXISTS assumptions JSONB;
