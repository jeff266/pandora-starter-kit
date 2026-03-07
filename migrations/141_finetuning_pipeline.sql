-- FT1: Fine-Tuning Pipeline Schema + Quality Labeling
-- Migration 141

-- 1. ALTER document_training_pairs to allow NULL for classification pairs
ALTER TABLE document_training_pairs ALTER COLUMN template_type DROP NOT NULL;
ALTER TABLE document_training_pairs ALTER COLUMN section_id DROP NOT NULL;

-- 2. ADD pair_type and correction_signal to document_training_pairs
ALTER TABLE document_training_pairs ADD COLUMN pair_type TEXT NOT NULL DEFAULT 'document_synthesis';
ALTER TABLE document_training_pairs ADD COLUMN correction_signal TEXT;

-- 3. CREATE fine_tuning_jobs table
CREATE TABLE IF NOT EXISTS fine_tuning_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_purpose TEXT NOT NULL, -- 'document_synthesis' or 'classification'
    pair_type TEXT NOT NULL,
    base_model TEXT NOT NULL,
    fireworks_job_id TEXT,
    fireworks_model_id TEXT,
    train_record_count INT DEFAULT 0,
    val_record_count INT DEFAULT 0,
    dataset_s3_uri TEXT,
    epochs INT DEFAULT 3,
    learning_rate FLOAT DEFAULT 0.0001,
    status TEXT DEFAULT 'pending', -- 'pending', 'submitted', 'training', 'completed', 'failed', 'deployed'
    val_loss FLOAT,
    baseline_val_loss FLOAT,
    quality_improvement_pct FLOAT,
    deployed_at TIMESTAMPTZ,
    deployment_endpoint TEXT,
    confidence_gate_threshold FLOAT DEFAULT 0.75,
    submitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fine_tuning_jobs_status ON fine_tuning_jobs(status);
CREATE INDEX IF NOT EXISTS idx_fine_tuning_jobs_purpose ON fine_tuning_jobs(model_purpose);

-- 4. CREATE llm_call_log table
CREATE TABLE IF NOT EXISTS llm_call_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    capability TEXT NOT NULL,
    model_used TEXT NOT NULL,
    fell_back BOOLEAN DEFAULT FALSE,
    confidence FLOAT,
    input_tokens INT,
    output_tokens INT,
    duration_ms INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_call_log_workspace_created ON llm_call_log(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_call_log_model_created ON llm_call_log(model_used, created_at);
