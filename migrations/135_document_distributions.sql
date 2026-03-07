CREATE TABLE document_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  document_id UUID NOT NULL,
  channel TEXT NOT NULL,  -- 'slack'|'email'|'drive'|'download'
  recipient TEXT,
  distributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL,   -- 'sent'|'failed'
  error TEXT
);
