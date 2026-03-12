-- Migration 170: Add priority column to actions table
-- Required by suggested-actions sync endpoint (SuggestedActionsPanel)

ALTER TABLE actions ADD COLUMN IF NOT EXISTS priority TEXT;
