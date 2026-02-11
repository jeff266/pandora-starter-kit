ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_method text;

CREATE INDEX IF NOT EXISTS idx_conversations_unlinked
  ON conversations (workspace_id)
  WHERE deal_id IS NULL AND account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts (workspace_id, email)
  WHERE email IS NOT NULL;
