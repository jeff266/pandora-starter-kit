-- Migration 172: Configure Monday Pipeline Briefing agent in auto mode
-- Scheduled runs → pipeline execution (unchanged behavior)
-- Conversational invocations with a question → loop execution

UPDATE agents
SET
  execution_mode = 'auto',
  loop_config = '{
    "available_skills": ["pipeline-hygiene", "deal-risk-review", "forecast-rollup"],
    "max_iterations": 4,
    "termination": "goal_satisfied"
  }'::jsonb
WHERE
  name ILIKE '%pipeline briefing%'
  OR name ILIKE '%monday pipeline%';
