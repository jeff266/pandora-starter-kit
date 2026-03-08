-- Migration 133: Agent conversational creation path
-- Adds goal, standing_questions, created_from, seed_conversation_id to agents
-- Adds synthesis_output to agent_runs for diff view

ALTER TABLE agents ADD COLUMN IF NOT EXISTS goal TEXT;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS standing_questions JSONB DEFAULT '[]';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS created_from TEXT
  NOT NULL DEFAULT 'manual'
  CHECK (created_from IN ('manual', 'conversation'));

ALTER TABLE agents ADD COLUMN IF NOT EXISTS seed_conversation_id TEXT;

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS synthesis_output TEXT;
