-- Migration 138: WorkspaceIntelligence — Extend Existing Tables
-- Adds domain typing, CRM field mapping, trust scoring, and segment scoping
-- Part of Phase 1 of WorkspaceIntelligence architecture

-- workspace_knowledge: add domain typing for resolution
ALTER TABLE workspace_knowledge
  ADD COLUMN IF NOT EXISTS domain TEXT CHECK (domain IN (
    'business', 'metrics', 'taxonomy', 'pipeline', 'segmentation', 'data_quality', 'general'
  )),
  ADD COLUMN IF NOT EXISTS structured_ref UUID; -- FK to metric_definitions or calibration_checklist

COMMENT ON COLUMN workspace_knowledge.domain IS 'Domain classification for WorkspaceIntelligence resolution: business | metrics | taxonomy | pipeline | segmentation | data_quality | general';
COMMENT ON COLUMN workspace_knowledge.structured_ref IS 'Optional FK to metric_definitions.id or calibration_checklist.id for structured references';

-- business_dimensions: add CRM field mapping
ALTER TABLE business_dimensions
  ADD COLUMN IF NOT EXISTS entity TEXT CHECK (entity IN ('deal', 'company', 'contact')) DEFAULT 'deal',
  ADD COLUMN IF NOT EXISTS crm_field TEXT, -- actual field name in CRM e.g. 'hs_custom_segment'
  ADD COLUMN IF NOT EXISTS crm_values TEXT[]; -- confirmed values e.g. ARRAY['SMB', 'MM', 'ENT', 'Strategic']

COMMENT ON COLUMN business_dimensions.entity IS 'Entity where this dimension field lives: deal | company | contact';
COMMENT ON COLUMN business_dimensions.crm_field IS 'Actual CRM field name (e.g. hs_custom_segment, deal_type__c)';
COMMENT ON COLUMN business_dimensions.crm_values IS 'Confirmed enum values for this dimension field';

-- data_dictionary: add trust scoring
ALTER TABLE data_dictionary
  ADD COLUMN IF NOT EXISTS completion_rate NUMERIC CHECK (completion_rate >= 0 AND completion_rate <= 1),
  ADD COLUMN IF NOT EXISTS trust_score TEXT CHECK (trust_score IN ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')) DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS trust_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_audited TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_trusted_for_reporting BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN data_dictionary.completion_rate IS 'Field completion rate (0-1) computed from actual deal data';
COMMENT ON COLUMN data_dictionary.trust_score IS 'Field trust level: HIGH (>90% complete, validated) | MEDIUM (60-90%) | LOW (<60%) | UNKNOWN';
COMMENT ON COLUMN data_dictionary.trust_reason IS 'Human-readable reason for trust score (e.g. "84% completion rate, no validation errors")';
COMMENT ON COLUMN data_dictionary.last_audited IS 'Last time this field was audited for trust/completion';
COMMENT ON COLUMN data_dictionary.is_trusted_for_reporting IS 'Whether this field can be used in live skills without draft mode warning';

-- standing_hypotheses: link to metric definitions (FK added after metric_definitions table created in 139)
ALTER TABLE standing_hypotheses
  ADD COLUMN IF NOT EXISTS metric_definition_id UUID;

COMMENT ON COLUMN standing_hypotheses.metric_definition_id IS 'FK to metric_definitions.id — which metric definition this hypothesis monitors';

-- targets: add segment scoping
ALTER TABLE targets
  ADD COLUMN IF NOT EXISTS segment_scope TEXT, -- NULL means all segments, 'SMB' means SMB only
  ADD COLUMN IF NOT EXISTS deal_type_scope TEXT; -- NULL means all types, 'New Business' means land only

COMMENT ON COLUMN targets.segment_scope IS 'Segment this target applies to (NULL = all segments, else specific segment like "ENT")';
COMMENT ON COLUMN targets.deal_type_scope IS 'Deal type this target applies to (NULL = all types, else specific type like "New Business")';
