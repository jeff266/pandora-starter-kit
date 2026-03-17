-- Migration 189: Report Charts
-- User-created charts from chart suggestions or custom charts

CREATE TABLE IF NOT EXISTS report_charts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  report_document_id UUID NOT NULL REFERENCES report_documents(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  chart_type TEXT NOT NULL CHECK (chart_type IN ('bar', 'line', 'pie', 'doughnut', 'horizontalBar')),
  title TEXT NOT NULL,
  data_labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_values JSONB NOT NULL DEFAULT '[]'::jsonb,
  chart_options JSONB DEFAULT '{}'::jsonb,  -- Chart.js options object
  chart_png BYTEA,  -- Rendered PNG image data
  position_in_section INTEGER NOT NULL DEFAULT 0,  -- Sort order within section
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_charts_document ON report_charts(report_document_id);
CREATE INDEX idx_report_charts_workspace ON report_charts(workspace_id);
CREATE INDEX idx_report_charts_section ON report_charts(section_id);
CREATE INDEX idx_report_charts_position ON report_charts(report_document_id, section_id, position_in_section);

COMMENT ON TABLE report_charts IS 'User-created charts embedded in report documents';
COMMENT ON COLUMN report_charts.chart_png IS 'Server-rendered PNG image (chartjs-node-canvas)';
COMMENT ON COLUMN report_charts.position_in_section IS 'Display order within section (0 = first)';
COMMENT ON COLUMN report_charts.chart_options IS 'Chart.js configuration options for rendering';
