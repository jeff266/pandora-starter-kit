-- Seed Hypotheses for Frontera Workspace
-- Run this after migration 191 to populate initial hypotheses

-- First, check if hypotheses already exist
-- SELECT metric_key, hypothesis_text, confidence, current_value, threshold, unit
-- FROM standing_hypotheses
-- WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';

-- If empty, insert seed hypotheses:

INSERT INTO standing_hypotheses (
  workspace_id,
  source,
  metric_key,
  hypothesis_text,
  confidence,
  current_value,
  threshold,
  unit,
  status,
  metric,
  hypothesis,
  alert_threshold,
  alert_direction
) VALUES

-- Hypothesis 1: Pipeline coverage ratio should be >= 3.0x
(
  '4160191d-73bc-414b-97dd-5a1853190378',
  'user_confirmed',
  'pipeline-coverage.coverage_ratio',
  'Pipeline coverage ratio should exceed 3.0x for reliable forecast',
  0.60,
  0.0,
  3.0,
  'x',
  'active',
  'pipeline-coverage.coverage_ratio',
  'Pipeline coverage ratio should exceed 3.0x for reliable forecast',
  3.0,
  'above'
),

-- Hypothesis 2: Closed-won is growing quarter over quarter
(
  '4160191d-73bc-414b-97dd-5a1853190378',
  'user_confirmed',
  'forecast-rollup.closed_won',
  'Closed-won revenue grows quarter over quarter',
  0.65,
  0.0,
  1000000,
  '$',
  'active',
  'forecast-rollup.closed_won',
  'Closed-won revenue grows quarter over quarter',
  1000000,
  'above'
),

-- Hypothesis 3: Win rate should exceed 25%
(
  '4160191d-73bc-414b-97dd-5a1853190378',
  'user_confirmed',
  'pipeline-coverage.win_rate',
  'Team win rate should exceed 25% of qualified pipeline',
  0.55,
  0.0,
  0.25,
  '%',
  'active',
  'pipeline-coverage.win_rate',
  'Team win rate should exceed 25% of qualified pipeline',
  0.25,
  'above'
),

-- Hypothesis 4: Nate carries >60% of team pipeline (structural risk)
(
  '4160191d-73bc-414b-97dd-5a1853190378',
  'user_confirmed',
  'pipeline-coverage.rep_concentration',
  'Top rep carries more than 60% of team open pipeline — concentration risk',
  0.80,
  0.0,
  0.60,
  '%',
  'active',
  'pipeline-coverage.rep_concentration',
  'Top rep carries more than 60% of team open pipeline — concentration risk',
  0.60,
  'above'
)

ON CONFLICT (id) DO NOTHING;

-- Verify insertion
SELECT metric_key, hypothesis_text, confidence, threshold, unit, status
FROM standing_hypotheses
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
ORDER BY confidence DESC;
