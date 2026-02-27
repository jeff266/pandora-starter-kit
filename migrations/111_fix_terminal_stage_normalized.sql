-- Fix deal_stage_history.stage_normalized for rows where the stage maps to a
-- terminal "Closed-Won" or "Closed-Lost" stage via stage_configs.stage_id,
-- but was incorrectly recorded as an intermediate stage (e.g. 'negotiation', 'qualification').
--
-- Note: PostgreSQL POSIX regex treats \b as backspace, not word boundary.
-- Use character-class anchors (^|[^a-z]) and ($|[^a-z]) for safe word-boundary matching.

UPDATE deal_stage_history dsh
SET stage_normalized = CASE
  WHEN sc.stage_name ~* '(^|[^a-z])closed.?won([^a-z]|$)' THEN 'closed_won'
  WHEN sc.stage_name ~* '(^|[^a-z])closed.?lost([^a-z]|$)' THEN 'closed_lost'
END
FROM stage_configs sc
WHERE sc.workspace_id = dsh.workspace_id
  AND sc.stage_id = dsh.stage
  AND (
    sc.stage_name ~* '(^|[^a-z])closed.?won([^a-z]|$)'
    OR sc.stage_name ~* '(^|[^a-z])closed.?lost([^a-z]|$)'
  )
  AND dsh.stage_normalized NOT IN ('closed_won', 'closed_lost');

-- Also fix deals.stage_normalized for any deal currently sitting in one of these
-- terminal stages that was incorrectly normalized.

UPDATE deals d
SET stage_normalized = CASE
  WHEN sc.stage_name ~* '(^|[^a-z])closed.?won([^a-z]|$)' THEN 'closed_won'
  WHEN sc.stage_name ~* '(^|[^a-z])closed.?lost([^a-z]|$)' THEN 'closed_lost'
END
FROM stage_configs sc
WHERE sc.workspace_id = d.workspace_id
  AND sc.stage_id = d.stage
  AND (
    sc.stage_name ~* '(^|[^a-z])closed.?won([^a-z]|$)'
    OR sc.stage_name ~* '(^|[^a-z])closed.?lost([^a-z]|$)'
  )
  AND d.stage_normalized NOT IN ('closed_won', 'closed_lost');
