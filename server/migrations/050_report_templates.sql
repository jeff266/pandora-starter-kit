-- Migration 050: Report Templates and Generations
-- Enables users to design recurring reports with custom sections, scheduling, and delivery

-- Report Templates - User-designed report configurations
CREATE TABLE IF NOT EXISTS report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Definition
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sections JSONB NOT NULL DEFAULT '[]',        -- Array of ReportSection objects

  -- Schedule
  cadence VARCHAR(20) NOT NULL DEFAULT 'manual',  -- manual, daily, weekly, biweekly, monthly, quarterly
  schedule_day INTEGER,                         -- 0=Sun, 1=Mon, ... 6=Sat (for weekly/biweekly)
  schedule_time TIME DEFAULT '07:00',           -- In workspace timezone
  schedule_day_of_month INTEGER,                -- 1-28 (for monthly)
  timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',

  -- Format + Delivery
  formats JSONB NOT NULL DEFAULT '["pdf"]',     -- Array: ["pdf", "docx", "pptx"]
  delivery_channels JSONB NOT NULL DEFAULT '[]', -- Array of DeliveryChannel configs
  recipients JSONB DEFAULT '[]',                -- Email addresses for delivery

  -- Branding (overrides workspace default)
  branding_override JSONB,                      -- Null = use workspace branding

  -- Voice
  voice_config JSONB DEFAULT '{"detail_level": "manager", "framing": "direct"}',

  -- State
  is_active BOOLEAN DEFAULT true,
  last_generated_at TIMESTAMPTZ,
  last_generation_status VARCHAR(20),           -- success, failed, partial
  last_generation_error TEXT,
  next_due_at TIMESTAMPTZ,                      -- Computed next generation time

  -- Meta
  created_from_template VARCHAR(100),           -- e.g., "monday-pipeline-briefing"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_cadence CHECK (cadence IN ('manual', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly')),
  CONSTRAINT valid_schedule_day CHECK (schedule_day IS NULL OR (schedule_day >= 0 AND schedule_day <= 6)),
  CONSTRAINT valid_day_of_month CHECK (schedule_day_of_month IS NULL OR (schedule_day_of_month >= 1 AND schedule_day_of_month <= 28))
);

CREATE INDEX IF NOT EXISTS idx_report_templates_workspace ON report_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_report_templates_active_schedule
  ON report_templates(is_active, cadence, next_due_at)
  WHERE is_active = true AND cadence != 'manual';

COMMENT ON TABLE report_templates IS 'User-designed recurring report templates';
COMMENT ON COLUMN report_templates.sections IS 'Array of ReportSection objects with skill mappings and config';
COMMENT ON COLUMN report_templates.delivery_channels IS 'Array of delivery channel configs (email, google_drive, slack, download_only)';
COMMENT ON COLUMN report_templates.next_due_at IS 'Next scheduled generation time (computed from cadence + schedule fields)';

-- Generated Report History
CREATE TABLE IF NOT EXISTS report_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_template_id UUID NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Output
  formats_generated JSONB NOT NULL,             -- { "pdf": { filepath, size_bytes, download_url }, "docx": {...}, "pptx": {...} }
  delivery_status JSONB NOT NULL DEFAULT '{}',  -- { "email": "sent", "google_drive": "uploaded", "slack": "posted" }

  -- Content snapshot (for reproducibility)
  sections_snapshot JSONB NOT NULL,             -- Snapshot of sections config at generation time

  -- Performance
  skills_run JSONB,                             -- Which skills contributed: ["forecast-rollup", "pipeline-hygiene", ...]
  total_tokens INTEGER DEFAULT 0,
  generation_duration_ms INTEGER,
  render_duration_ms INTEGER,

  -- Metadata
  triggered_by VARCHAR(20) DEFAULT 'schedule',  -- schedule, manual, api
  data_as_of TIMESTAMPTZ DEFAULT NOW(),         -- Timestamp of underlying data
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_generations_template ON report_generations(report_template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_generations_workspace ON report_generations(workspace_id, created_at DESC);

COMMENT ON TABLE report_generations IS 'History of generated reports with download links and delivery status';
COMMENT ON COLUMN report_generations.formats_generated IS 'Generated files with download URLs and metadata';
COMMENT ON COLUMN report_generations.sections_snapshot IS 'Snapshot of sections config to ensure reproducible rendering';
