-- Migration: Chat Sessions for Ask Pandora
-- Persisted conversation history with role-based access

-- Chat sessions: one row per conversation thread
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,             -- Auto-set from first user message, max 80 chars
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0
);

-- Chat messages: individual turns within a session
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,  -- Denormalized for query efficiency
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',  -- Store: router_decision, tokens_used, tool_calls, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_user
  ON chat_sessions(workspace_id, user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace
  ON chat_sessions(workspace_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON chat_messages(session_id, created_at ASC);

-- Manager reporting: who reports to whom
-- Stub table for future Manager role (Phase 2)
CREATE TABLE IF NOT EXISTS user_reporting_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, manager_id, report_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reporting_lines_manager
  ON user_reporting_lines(workspace_id, manager_id);

COMMENT ON TABLE chat_sessions IS 'Ask Pandora conversation sessions';
COMMENT ON TABLE chat_messages IS 'Individual messages within Ask Pandora sessions';
COMMENT ON TABLE user_reporting_lines IS 'Manager-report relationships for access control';
COMMENT ON COLUMN chat_sessions.title IS 'Auto-generated from first message (max 80 chars)';
COMMENT ON COLUMN chat_messages.metadata IS 'AI response metadata: router_decision, tokens, tool_calls, etc.';
