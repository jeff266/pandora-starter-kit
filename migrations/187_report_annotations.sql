-- Migration 187: Report Annotations
-- Enables paragraph-level annotations on report documents
-- Supports note/override/flag types for editorial review

CREATE TABLE IF NOT EXISTS report_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id)
    ON DELETE CASCADE,
  report_document_id UUID NOT NULL
    REFERENCES report_documents(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  paragraph_index INTEGER NOT NULL DEFAULT 0,
  annotation_type TEXT NOT NULL
    CHECK (annotation_type IN ('note', 'override', 'flag')),
  content TEXT NOT NULL DEFAULT '',
  original_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_annotations_report
  ON report_annotations(report_document_id);

CREATE INDEX IF NOT EXISTS idx_report_annotations_workspace
  ON report_annotations(workspace_id);

CREATE INDEX IF NOT EXISTS idx_report_annotations_section
  ON report_annotations(report_document_id, section_id, paragraph_index);
