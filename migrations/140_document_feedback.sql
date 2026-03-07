UPDATE context_layer
SET definitions = jsonb_set(
    definitions,
    '{workspace_config,document_profile}',
    '{
        "version": 1,
        "sectionPreferences": {},
        "distributionPatterns": {
            "mostUsedChannels": [],
            "channelByTemplate": {},
            "averageTimeToDistribute": 0,
            "averageTimeToFirstAction": 0,
            "slackEngagementByTemplate": {}
        },
        "calibration": {
            "completedAt": null,
            "completedSessions": 0,
            "nextScheduledAt": null,
            "answers": null
        },
        "qualityScores": {
            "overall": 50,
            "byTemplate": {},
            "trend": "stable",
            "derivedFrom": {
                "editRateWeight": 0.4,
                "actionRateWeight": 0.4,
                "distributionRateWeight": 0.2
            },
            "lastCalculatedAt": null
        },
        "trainingPairsCount": 0,
        "fineTuningReadyAt": 500
    }'::jsonb,
    true
)
WHERE definitions->'workspace_config' IS NOT NULL
  AND definitions->'workspace_config'->'document_profile' IS NULL;

CREATE TABLE IF NOT EXISTS document_training_pairs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    template_type TEXT NOT NULL,
    section_id TEXT NOT NULL,
    system_prompt_at_time TEXT,
    raw_output TEXT NOT NULL,
    corrected_output TEXT NOT NULL,
    edit_distance FLOAT NOT NULL DEFAULT 0,
    derived_style_signals TEXT[] DEFAULT '{}',
    was_distributed BOOLEAN DEFAULT FALSE,
    recommendations_actioned INT DEFAULT 0,
    quality_label TEXT,
    voice_profile_snapshot JSONB,
    quarter_phase TEXT,
    attainment_pct FLOAT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_training_pairs_workspace ON document_training_pairs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_doc_training_pairs_quality ON document_training_pairs(workspace_id, quality_label);
CREATE INDEX IF NOT EXISTS idx_doc_training_pairs_template ON document_training_pairs(workspace_id, template_type);

CREATE TABLE IF NOT EXISTS document_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    document_id UUID,
    template_type TEXT NOT NULL,
    section_id TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    edited_text TEXT NOT NULL,
    edit_distance FLOAT NOT NULL DEFAULT 0,
    derived_signals TEXT[] DEFAULT '{}',
    voice_profile_snapshot JSONB,
    quarter_phase_at_time TEXT,
    attainment_pct_at_time FLOAT,
    edited_by TEXT NOT NULL DEFAULT '',
    edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_edits_workspace ON document_edits(workspace_id);
CREATE INDEX IF NOT EXISTS idx_document_edits_section ON document_edits(workspace_id, template_type, section_id);
