ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS entity_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_entity_check'
  ) THEN
    ALTER TABLE chat_sessions ADD CONSTRAINT chat_sessions_entity_check
      CHECK ((entity_type IS NULL AND entity_id IS NULL) OR (entity_type IS NOT NULL AND entity_id IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_entity
  ON chat_sessions(workspace_id, entity_type, entity_id)
  WHERE entity_type IS NOT NULL;
