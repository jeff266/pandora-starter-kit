-- Add 'chat_insight' as an explicitly supported memory_type for cross-session chat memory.
-- Adds a CHECK constraint to workspace_memory.memory_type enumerating all allowed values,
-- and a supporting partial index for efficient deduplication lookups.
--
-- All known memory_type values in use are included in the constraint:
--   recurring_finding, strategic_priority, entity_context, data_gap,
--   forecast_accuracy, recommendation_outcome, chat_insight

DO $$
BEGIN
  -- Drop existing constraint if present (allows idempotent re-runs and type additions)
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'workspace_memory'
      AND constraint_name = 'workspace_memory_memory_type_check'
  ) THEN
    ALTER TABLE workspace_memory DROP CONSTRAINT workspace_memory_memory_type_check;
  END IF;

  -- Add updated constraint including all known memory types plus chat_insight
  ALTER TABLE workspace_memory
    ADD CONSTRAINT workspace_memory_memory_type_check
    CHECK (memory_type IN (
      'recurring_finding',
      'strategic_priority',
      'entity_context',
      'data_gap',
      'forecast_accuracy',
      'recommendation_outcome',
      'chat_insight'
    ));
END
$$;

-- Index to speed up chat_insight occurrence-count deduplication queries
CREATE INDEX IF NOT EXISTS workspace_memory_chat_insight_idx
  ON workspace_memory (workspace_id, memory_type, summary)
  WHERE memory_type = 'chat_insight' AND is_resolved = FALSE;
