-- Migration 188: Report Chart Suggestions
-- AI-suggested charts generated during report orchestration

CREATE TABLE IF NOT EXISTS report_chart_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  report_document_id UUID NOT NULL REFERENCES report_documents(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  chart_type TEXT NOT NULL CHECK (chart_type IN ('bar', 'line', 'pie', 'doughnut', 'horizontalBar')),
  title TEXT NOT NULL,
  data_labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_values JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_chart_suggestions_document ON report_chart_suggestions(report_document_id);
CREATE INDEX idx_report_chart_suggestions_workspace ON report_chart_suggestions(workspace_id);
CREATE INDEX idx_report_chart_suggestions_section ON report_chart_suggestions(section_id);

COMMENT ON TABLE report_chart_suggestions IS 'AI-suggested charts generated during report orchestration';
COMMENT ON COLUMN report_chart_suggestions.reasoning IS 'Why this chart makes sense (shown in UI)';
COMMENT ON COLUMN report_chart_suggestions.priority IS 'Orchestrator-assigned priority for suggested charts';
