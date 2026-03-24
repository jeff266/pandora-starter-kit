-- Migration 206: Report document reads tracking + created_by
-- Enables per-user unread count badge and creator-based delete access

-- Add created_by to report_documents (nullable for backward compatibility)
ALTER TABLE report_documents
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_report_documents_created_by ON report_documents(created_by);

-- Track which users have opened which report documents
CREATE TABLE IF NOT EXISTS report_document_reads (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_document_id UUID        NOT NULL REFERENCES report_documents(id) ON DELETE CASCADE,
  workspace_id       UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  read_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_report_document_reads UNIQUE (user_id, report_document_id)
);

CREATE INDEX IF NOT EXISTS idx_report_document_reads_user_ws
  ON report_document_reads(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_report_document_reads_document
  ON report_document_reads(report_document_id);

COMMENT ON TABLE report_document_reads IS 'Tracks which users have opened each report document for unread badge count';
COMMENT ON COLUMN report_documents.created_by IS 'User who triggered report generation; NULL for scheduled or pre-migration reports';
