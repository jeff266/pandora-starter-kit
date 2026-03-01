-- T001: Database migration — weekly_briefs table (revised schema)

CREATE TABLE IF NOT EXISTS weekly_briefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    brief_type TEXT DEFAULT 'monday_setup' CHECK (brief_type IN ('monday_setup', 'pulse', 'friday_recap', 'quarter_close')),
    generated_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Period tracking (Mon-Sun of the week the brief belongs to)
    period_start DATE,
    period_end DATE,
    
    -- Quarter context
    days_in_quarter INT,
    days_remaining INT,
    
    -- Five JSONB sections
    the_number JSONB NOT NULL DEFAULT '{}',
    what_changed JSONB NOT NULL DEFAULT '{}',
    segments JSONB NOT NULL DEFAULT '{}',
    reps JSONB NOT NULL DEFAULT '{}',
    deals_to_watch JSONB NOT NULL DEFAULT '{}',
    
    -- AI narratives
    ai_blurbs JSONB NOT NULL DEFAULT '{}',
    
    -- Editorial
    editorial_focus JSONB NOT NULL DEFAULT '{}',
    
    -- Freshness
    section_refreshed_at JSONB NOT NULL DEFAULT '{}',
    
    -- Status
    status TEXT DEFAULT 'assembling' CHECK (status IN ('assembling', 'ready', 'sent', 'edited', 'failed')),
    error_message TEXT,
    
    -- Delivery
    sent_to JSONB DEFAULT '[]',
    edited_sections JSONB DEFAULT '{}',
    edited_by TEXT,
    edited_at TIMESTAMPTZ,
    
    -- Metrics
    assembly_duration_ms INT,
    ai_tokens_used INT,
    skill_runs_used UUID[],
    
    -- Timestamps
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint: one brief per workspace per day
    UNIQUE(workspace_id, generated_date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_weekly_briefs_workspace_date ON weekly_briefs (workspace_id, generated_date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_briefs_workspace_generated_at ON weekly_briefs (workspace_id, generated_at DESC);
