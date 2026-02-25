/**
 * Chat Sessions and Messages
 *
 * Stores persistent conversation history for Ask Pandora and entity-scoped Q&A.
 * Supports workspace-wide chat and entity-specific conversations (deals, accounts, etc.)
 */

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Entity scoping (null for workspace-wide chat)
  entity_type TEXT,  -- 'deal', 'account', 'forecast', etc.
  entity_id TEXT,    -- ID of the entity

  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  message_count INT NOT NULL DEFAULT 0,

  CONSTRAINT chat_sessions_entity_check
    CHECK ((entity_type IS NULL AND entity_id IS NULL) OR (entity_type IS NOT NULL AND entity_id IS NOT NULL))
);

CREATE INDEX idx_chat_sessions_workspace ON chat_sessions(workspace_id, last_message_at DESC NULLS LAST);
CREATE INDEX idx_chat_sessions_user ON chat_sessions(workspace_id, user_id, last_message_at DESC NULLS LAST);
CREATE INDEX idx_chat_sessions_entity ON chat_sessions(workspace_id, entity_type, entity_id) WHERE entity_type IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_session_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session ON chat_session_messages(session_id, created_at ASC);
CREATE INDEX idx_chat_messages_workspace ON chat_session_messages(workspace_id, created_at DESC);

COMMENT ON TABLE chat_sessions IS 'Persistent conversation history for Ask Pandora and entity-scoped Q&A';
COMMENT ON COLUMN chat_sessions.entity_type IS 'Type of entity this session is scoped to (null for workspace-wide chat)';
COMMENT ON COLUMN chat_sessions.entity_id IS 'ID of the entity (deal.id, account.id, etc.)';
