-- =============================================================================
-- PANDORA E2E VALIDATION QUERIES
-- Run in Replit database console or via: psql $DATABASE_URL -f test-validation.sql
-- =============================================================================

\echo ''
\echo '================================================================='
\echo '  PANDORA DATABASE VALIDATION REPORT'
\echo '================================================================='
\echo ''

-- ---------------------------------------------------------------------------
-- 1. Workspace Config
-- ---------------------------------------------------------------------------
\echo '── 1. Workspace Config ──'

SELECT
  CASE WHEN COUNT(*) > 0 THEN '✓' ELSE '✗' END AS status,
  'Workspace config exists' AS check_name,
  COUNT(*) || ' workspace(s) with config' AS detail
FROM context_layer
WHERE definitions ? 'workspace_config';

-- ---------------------------------------------------------------------------
-- 2. Funnel Definitions
-- ---------------------------------------------------------------------------
\echo ''
\echo '── 2. Funnel Definitions ──'

SELECT
  w.id AS workspace_id,
  CASE WHEN cl.definitions ? 'funnel' THEN '✓' ELSE '✗' END AS funnel_status,
  CASE WHEN cl.definitions ? 'funnel'
    THEN 'Funnel configured'
    ELSE 'No funnel definition'
  END AS detail
FROM workspaces w
LEFT JOIN context_layer cl ON cl.workspace_id = w.id;

-- ---------------------------------------------------------------------------
-- 3. Stage History Coverage (target >80%)
-- ---------------------------------------------------------------------------
\echo ''
\echo '── 3. Stage History Coverage ──'

SELECT
  d.workspace_id,
  COUNT(DISTINCT d.id) AS total_deals,
  COUNT(DISTINCT dsh.deal_id) AS deals_with_history,
  ROUND(100.0 * COUNT(DISTINCT dsh.deal_id) / NULLIF(COUNT(DISTINCT d.id), 0), 1) AS coverage_pct,
  CASE
    WHEN 100.0 * COUNT(DISTINCT dsh.deal_id) / NULLIF(COUNT(DISTINCT d.id), 0) >= 80 THEN '✓'
    WHEN 100.0 * COUNT(DISTINCT dsh.deal_id) / NULLIF(COUNT(DISTINCT d.id), 0) >= 50 THEN '⚠'
    ELSE '✗'
  END AS status,
  (SELECT COUNT(*) FROM deal_stage_history WHERE workspace_id = d.workspace_id) AS total_entries
FROM deals d
LEFT JOIN deal_stage_history dsh ON dsh.deal_id = d.id AND dsh.workspace_id = d.workspace_id
GROUP BY d.workspace_id;

-- ---------------------------------------------------------------------------
-- 4. Contact Role Coverage (target >50%)
-- ---------------------------------------------------------------------------
\echo ''
\echo '── 4. Contact Role Coverage ──'

SELECT
  dc.workspace_id,
  COUNT(*) AS total_deal_contacts,
  COUNT(*) FILTER (WHERE dc.buying_role IS NOT NULL) AS with_roles,
  COUNT(*) FILTER (WHERE dc.role_source = 'inferred') AS inferred_roles,
  ROUND(100.0 * COUNT(*) FILTER (WHERE dc.buying_role IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS role_coverage_pct,
  CASE
    WHEN 100.0 * COUNT(*) FILTER (WHERE dc.buying_role IS NOT NULL) / NULLIF(COUNT(*), 0) >= 50 THEN '✓'
    ELSE '⚠'
  END AS status
FROM deal_contacts dc
GROUP BY dc.workspace_id;

\echo ''
\echo '  Role distribution:'

SELECT
  buying_role,
  COUNT(*) AS count,
  ROUND(AVG(role_confidence), 2) AS avg_confidence
FROM deal_contacts
WHERE role_source = 'inferred'
GROUP BY buying_role
ORDER BY count DESC;

-- ---------------------------------------------------------------------------
-- 5. Recent Skill Runs
-- ---------------------------------------------------------------------------
\echo ''
\echo '── 5. Recent Skill Runs ──'

SELECT
  skill_id,
  status,
  COUNT(*) AS run_count,
  MAX(started_at) AS last_run,
  CASE WHEN COUNT(*) > 0 THEN '✓' ELSE '✗' END AS status_indicator
FROM skill_runs
WHERE started_at >= NOW() - INTERVAL '24 hours'
GROUP BY skill_id, status
ORDER BY last_run DESC;

-- ---------------------------------------------------------------------------
-- 6. Agent Runs
-- ---------------------------------------------------------------------------
\echo ''
\echo '── 6. Agent Runs ──'

SELECT
  agent_id,
  status,
  COUNT(*) AS run_count,
  MAX(started_at) AS last_run,
  CASE WHEN COUNT(*) FILTER (WHERE status = 'completed') > 0 THEN '✓' ELSE '⚠' END AS status_indicator
FROM agent_runs
WHERE started_at >= NOW() - INTERVAL '7 days'
GROUP BY agent_id, status
ORDER BY last_run DESC;

-- ---------------------------------------------------------------------------
-- 7. Cache Effectiveness
-- ---------------------------------------------------------------------------
\echo ''
\echo '── 7. Cache Effectiveness ──'

SELECT
  'Cacheable skill runs (last 30min)' AS metric,
  COUNT(*) AS value,
  CASE WHEN COUNT(*) >= 1 THEN '✓' ELSE '⚠' END AS status
FROM skill_runs
WHERE status = 'completed'
  AND started_at >= NOW() - INTERVAL '30 minutes';

SELECT
  'Cache infrastructure' AS metric,
  CASE WHEN COUNT(*) >= 4 THEN 'All columns present ✓' ELSE 'Missing columns ✗' END AS status
FROM information_schema.columns
WHERE table_name = 'skill_runs'
  AND column_name IN ('status', 'started_at', 'output_text', 'result');

-- ---------------------------------------------------------------------------
-- 8. Data Quality Metrics
-- ---------------------------------------------------------------------------
\echo ''
\echo '── 8. Data Quality Metrics ──'

SELECT
  'deals' AS entity,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE stage_normalized IS NOT NULL) AS with_stage,
  COUNT(*) FILTER (WHERE amount IS NOT NULL AND amount > 0) AS with_amount,
  COUNT(*) FILTER (WHERE owner IS NOT NULL) AS with_owner
FROM deals;

SELECT
  'contacts' AS entity,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE email IS NOT NULL) AS with_email,
  COUNT(*) FILTER (WHERE title IS NOT NULL) AS with_title
FROM contacts;

SELECT
  'activities' AS entity,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE actor IS NOT NULL) AS with_actor,
  COUNT(DISTINCT activity_type) AS distinct_types
FROM activities;

SELECT
  'conversations' AS entity,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE transcript IS NOT NULL) AS with_transcript
FROM conversations;

-- ---------------------------------------------------------------------------
-- 9. Deal Stage History Schema Validation
-- ---------------------------------------------------------------------------
\echo ''
\echo '── 9. Schema Validation ──'

SELECT
  column_name,
  data_type,
  CASE
    WHEN column_name IN ('id','workspace_id','deal_id','stage','stage_normalized','entered_at','exited_at','duration_days','source','source_user','created_at')
    THEN '✓ Expected'
    ELSE '⚠ Extra'
  END AS status
FROM information_schema.columns
WHERE table_name = 'deal_stage_history'
ORDER BY ordinal_position;

\echo ''
\echo '================================================================='
\echo '  VALIDATION COMPLETE'
\echo '================================================================='
\echo ''
