-- Migration: Add internal meeting filter columns
-- Spec: PANDORA_INTERNAL_FILTER_AND_CWD_SPEC.md

-- Add is_internal flag to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS internal_classification_reason TEXT;

-- Create index for filtering out internal meetings in analysis queries
CREATE INDEX IF NOT EXISTS idx_conversations_internal
  ON conversations(workspace_id, is_internal)
  WHERE is_internal = FALSE;

-- Add comment for documentation
COMMENT ON COLUMN conversations.is_internal IS 'True if conversation is classified as internal meeting (all participants from workspace domain)';
COMMENT ON COLUMN conversations.internal_classification_reason IS 'Reason for internal classification: all_participants_internal | all_internal_with_title_match';
COMMENT ON INDEX idx_conversations_internal IS 'Optimizes queries that exclude internal meetings from ICP analysis';
