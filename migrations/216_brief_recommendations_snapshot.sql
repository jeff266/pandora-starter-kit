-- Add state_snapshot to brief_recommendations (Task #87 follow-up)
-- Stores the entity's state at the time the recommendation was logged.
-- This allows outcome generation to compute a true delta (then vs now).

ALTER TABLE brief_recommendations
  ADD COLUMN IF NOT EXISTS state_snapshot TEXT;
