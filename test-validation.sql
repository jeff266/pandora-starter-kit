-- =============================================================================
-- PANDORA STARTER KIT - E2E VALIDATION QUERIES
-- Run these in Replit database console to validate all features
-- =============================================================================

\set workspace_id '4160191d-73bc-414b-97dd-5a1853190378'

\echo '============================================'
\echo 'VALIDATION REPORT'
\echo '============================================'
\echo ''

-- =============================================================================
-- 1. WORKSPACE CONFIGURATION
-- =============================================================================
\echo '1. WORKSPACE CONFIGURATION'
\echo '-------------------------------------------'

SELECT
  CASE
    WHEN value IS NOT NULL THEN '✓ Config exists'
    ELSE '✗ No config found'
  END as status,
  value->'thresholds'->>'stale_deal_days' as stale_days,
  value->'thresholds'->>'coverage_target' as coverage_target,
  value->'thresholds'->>'minimum_contacts_per_deal' as min_contacts,
  value->>'confirmed' as confirmed,
  updated_at
FROM context_layer
WHERE workspace_id = :'workspace_id'
  AND category = 'settings'
  AND key = 'workspace_config';

\echo ''

-- =============================================================================
-- 2. FUNNEL DEFINITION
-- =============================================================================
\echo '2. FUNNEL DEFINITION'
\echo '-------------------------------------------'

SELECT
  CASE
    WHEN definitions->'funnel' IS NOT NULL THEN '✓ Funnel defined'
    ELSE '⚠ No funnel (will use defaults)'
  END as status,
  definitions->'funnel'->>'model_type' as model_type,
  definitions->'funnel'->>'model_label' as model_label,
  jsonb_array_length(definitions->'funnel'->'stages') as stage_count,
  definitions->'funnel'->>'status' as funnel_status
FROM context_layer
WHERE workspace_id = :'workspace_id'
LIMIT 1;

\echo ''

-- =============================================================================
-- 3. STAGE HISTORY COVERAGE
-- =============================================================================
\echo '3. STAGE HISTORY BACKFILL'
\echo '-------------------------------------------'

WITH stats AS (
  SELECT
    COUNT(DISTINCT d.id) as total_deals,
    COUNT(DISTINCT dsh.deal_id) as deals_with_history,
    COUNT(*) FILTER (WHERE dsh.deal_id IS NOT NULL) as total_entries,
    ROUND(AVG(d.days_in_stage) FILTER (WHERE d.days_in_stage > 0), 1) as avg_days_in_stage
  FROM deals d
  LEFT JOIN deal_stage_history dsh ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
  WHERE d.workspace_id = :'workspace_id'
)
SELECT
  CASE
    WHEN ROUND(100.0 * deals_with_history / NULLIF(total_deals, 0), 1) >= 80 THEN '✓ Good coverage'
    WHEN deals_with_history > 0 THEN '⚠ Partial coverage'
    ELSE '✗ No stage history'
  END as status,
  total_deals,
  deals_with_history,
  ROUND(100.0 * deals_with_history / NULLIF(total_deals, 0), 1) || '%' as coverage_pct,
  total_entries,
  ROUND(total_entries::numeric / NULLIF(deals_with_history, 0), 1) as avg_entries_per_deal,
  avg_days_in_stage
FROM stats;

\echo ''

-- =============================================================================
-- 4. CONTACT ROLE INFERENCE
-- =============================================================================
\echo '4. CONTACT ROLE RESOLUTION'
\echo '-------------------------------------------'

WITH role_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE buying_role IS NOT NULL) as contacts_with_roles,
    COUNT(*) as total_contacts,
    ROUND(AVG(role_confidence) FILTER (WHERE role_confidence IS NOT NULL), 2) as avg_confidence
  FROM deal_contacts
  WHERE workspace_id = :'workspace_id'
)
SELECT
  CASE
    WHEN ROUND(100.0 * contacts_with_roles / NULLIF(total_contacts, 0), 1) >= 50 THEN '✓ Good coverage'
    WHEN contacts_with_roles > 0 THEN '⚠ Partial coverage'
    ELSE '✗ No roles inferred'
  END as status,
  contacts_with_roles,
  total_contacts,
  ROUND(100.0 * contacts_with_roles / NULLIF(total_contacts, 0), 1) || '%' as coverage_pct,
  avg_confidence
FROM role_stats;

\echo ''
\echo 'Role Distribution:'

SELECT
  COALESCE(buying_role, 'no_role') as role,
  COUNT(*) as count,
  ROUND(AVG(role_confidence)::numeric, 2) as avg_confidence,
  role_source
FROM deal_contacts
WHERE workspace_id = :'workspace_id'
GROUP BY buying_role, role_source
ORDER BY count DESC
LIMIT 10;

\echo ''

-- =============================================================================
-- 5. RECENT SKILL EXECUTIONS
-- =============================================================================
\echo '5. RECENT SKILL RUNS (Last Hour)'
\echo '-------------------------------------------'

SELECT
  skill_id,
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'cached') as cache_hits,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(AVG(duration_ms) FILTER (WHERE status = 'completed'), 0) as avg_duration_ms,
  ROUND(AVG(duration_ms) FILTER (WHERE status = 'cached'), 0) as avg_cached_ms
FROM skill_runs
WHERE workspace_id = :'workspace_id'
  AND created_at >= NOW() - INTERVAL '1 hour'
GROUP BY skill_id
ORDER BY total_runs DESC
LIMIT 10;

\echo ''

-- =============================================================================
-- 6. RECENT AGENT RUNS
-- =============================================================================
\echo '6. RECENT AGENT RUNS (Last Hour)'
\echo '-------------------------------------------'

SELECT
  agent_id,
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(AVG(duration_ms), 0) as avg_duration_ms,
  MAX(created_at) as last_run
FROM agent_runs
WHERE workspace_id = :'workspace_id'
  AND created_at >= NOW() - INTERVAL '1 hour'
GROUP BY agent_id
ORDER BY total_runs DESC;

\echo ''

-- =============================================================================
-- 7. DATA QUALITY CHECKS
-- =============================================================================
\echo '7. DATA QUALITY CHECKS'
\echo '-------------------------------------------'

WITH quality AS (
  SELECT
    COUNT(*) as total_deals,
    COUNT(*) FILTER (WHERE amount > 0) as deals_with_amount,
    COUNT(*) FILTER (WHERE close_date IS NOT NULL) as deals_with_close_date,
    COUNT(*) FILTER (WHERE stage IS NOT NULL) as deals_with_stage,
    COUNT(*) FILTER (WHERE owner IS NOT NULL) as deals_with_owner,
    COUNT(*) FILTER (WHERE last_activity_date IS NOT NULL) as deals_with_activity
  FROM deals
  WHERE workspace_id = :'workspace_id'
)
SELECT
  total_deals,
  ROUND(100.0 * deals_with_amount / total_deals, 1) || '%' as pct_with_amount,
  ROUND(100.0 * deals_with_close_date / total_deals, 1) || '%' as pct_with_close_date,
  ROUND(100.0 * deals_with_stage / total_deals, 1) || '%' as pct_with_stage,
  ROUND(100.0 * deals_with_owner / total_deals, 1) || '%' as pct_with_owner,
  ROUND(100.0 * deals_with_activity / total_deals, 1) || '%' as pct_with_activity
FROM quality;

\echo ''

-- =============================================================================
-- 8. SKILL CACHE EFFECTIVENESS
-- =============================================================================
\echo '8. SKILL CACHE EFFECTIVENESS (Last 24h)'
\echo '-------------------------------------------'

WITH cache_stats AS (
  SELECT
    COUNT(*) as total_runs,
    COUNT(*) FILTER (WHERE status = 'completed') as fresh_runs,
    COUNT(*) FILTER (WHERE status = 'cached') as cache_hits,
    SUM(duration_ms) FILTER (WHERE status = 'completed') as total_compute_ms,
    SUM(duration_ms) FILTER (WHERE status = 'cached') as total_cached_ms
  FROM skill_runs
  WHERE workspace_id = :'workspace_id'
    AND created_at >= NOW() - INTERVAL '24 hours'
)
SELECT
  total_runs,
  fresh_runs,
  cache_hits,
  CASE
    WHEN total_runs > 0 THEN ROUND(100.0 * cache_hits / total_runs, 1) || '%'
    ELSE '0%'
  END as cache_hit_rate,
  ROUND((total_compute_ms - total_cached_ms) / 1000.0, 1) || 's' as time_saved,
  CASE
    WHEN cache_hits > 0 THEN '✓ Caching active'
    WHEN fresh_runs > 0 THEN '⚠ No cache hits yet'
    ELSE '✗ No runs in 24h'
  END as status
FROM cache_stats;

\echo ''

-- =============================================================================
-- 9. PIPELINE GOALS - REP DETECTION
-- =============================================================================
\echo '9. PIPELINE GOALS - REP DETECTION TEST'
\echo '-------------------------------------------'

SELECT
  COUNT(DISTINCT actor) as unique_reps_in_activities,
  COUNT(DISTINCT owner) as unique_owners_in_deals,
  CASE
    WHEN COUNT(DISTINCT actor) >= 4 THEN '✓ Reps detected (activities.actor fix worked)'
    WHEN COUNT(DISTINCT actor) = 0 THEN '✗ No reps found (check activities table)'
    ELSE '⚠ Low rep count'
  END as status
FROM activities
WHERE workspace_id = :'workspace_id';

\echo ''

-- =============================================================================
-- SUMMARY
-- =============================================================================
\echo '============================================'
\echo 'SUMMARY'
\echo '============================================'
\echo ''

SELECT
  'Workspace Config' as feature,
  CASE WHEN EXISTS (
    SELECT 1 FROM context_layer
    WHERE workspace_id = :'workspace_id' AND category = 'settings' AND key = 'workspace_config'
  ) THEN '✓ PASS' ELSE '✗ FAIL' END as status
UNION ALL
SELECT
  'Stage History',
  CASE WHEN (
    SELECT COUNT(DISTINCT deal_id)::numeric / NULLIF(COUNT(DISTINCT d.id), 0)
    FROM deals d
    LEFT JOIN deal_stage_history dsh ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
    WHERE d.workspace_id = :'workspace_id'
  ) >= 0.8 THEN '✓ PASS' ELSE '⚠ PARTIAL' END
UNION ALL
SELECT
  'Contact Roles',
  CASE WHEN (
    SELECT COUNT(*) FILTER (WHERE buying_role IS NOT NULL)::numeric / NULLIF(COUNT(*), 0)
    FROM deal_contacts
    WHERE workspace_id = :'workspace_id'
  ) >= 0.5 THEN '✓ PASS' ELSE '⚠ PARTIAL' END
UNION ALL
SELECT
  'Pipeline Goals (Reps)',
  CASE WHEN (
    SELECT COUNT(DISTINCT actor) FROM activities WHERE workspace_id = :'workspace_id'
  ) >= 4 THEN '✓ PASS' ELSE '✗ FAIL' END
UNION ALL
SELECT
  'Skill Caching',
  CASE WHEN EXISTS (
    SELECT 1 FROM skill_runs
    WHERE workspace_id = :'workspace_id'
      AND status = 'cached'
      AND created_at >= NOW() - INTERVAL '24 hours'
  ) THEN '✓ PASS' ELSE '⚠ NOT TESTED' END;

\echo ''
\echo 'Run automated test: bash test-e2e-replit.sh'
\echo 'See manual checklist: cat test-manual-checklist.md'
\echo ''
