-- Phase 4: Feedback + Tuning Pipeline
-- User feedback on agent outputs with conversion to tuning pairs

CREATE TABLE IF NOT EXISTS agent_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  generation_id UUID NOT NULL,              -- Which specific output this feedback is about
  user_id UUID,                             -- Who gave the feedback (null for anonymous/system)

  -- Feedback scope
  feedback_type TEXT NOT NULL,              -- 'section', 'editorial', 'overall'
  section_id TEXT,                          -- Which section (null for overall/editorial feedback)

  -- The feedback signal
  signal TEXT NOT NULL,                     -- See signal enum in feedback-processor.ts
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),  -- Optional star rating (1-5)
  comment TEXT,                             -- Free-text elaboration

  -- Processing state
  processed BOOLEAN DEFAULT false,          -- Whether converted to tuning pair
  tuning_key TEXT,                          -- The key generated in context_layer

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookups: feedback for an agent, ordered by recency
CREATE INDEX IF NOT EXISTS idx_af_agent
  ON agent_feedback(workspace_id, agent_id, created_at DESC);

-- Processing queue: unprocessed feedback
CREATE INDEX IF NOT EXISTS idx_af_unprocessed
  ON agent_feedback(processed) WHERE processed = false;

-- Feedback per generation (for showing feedback state in viewer)
CREATE INDEX IF NOT EXISTS idx_af_generation
  ON agent_feedback(generation_id, section_id);

-- Comments
COMMENT ON TABLE agent_feedback IS 'User feedback on agent-generated briefings, converted to tuning pairs';
COMMENT ON COLUMN agent_feedback.signal IS 'Feedback signal: useful, not_useful, too_detailed, too_brief, wrong_emphasis, good_insight, wrong_lead, wrong_order, wrong_tone, good_structure, keep_doing_this, wrong_data, missing_context';
COMMENT ON COLUMN agent_feedback.processed IS 'Whether this feedback has been converted to a tuning pair';
COMMENT ON COLUMN agent_feedback.tuning_key IS 'The context_layer key created from this feedback (category=agent_tuning)';
