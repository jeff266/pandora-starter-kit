-- End-to-End Incremental Sync Verification
-- Run this query before and after a second sync to confirm incremental mode is working

-- ====================================================================================
-- TEST 1: Verify last_sync_at is written after first sync
-- ====================================================================================

SELECT
  c.id,
  c.source,
  c.status,
  c.last_sync_at,
  CASE
    WHEN c.last_sync_at IS NULL THEN '🔴 Not synced yet (expected for first sync)'
    WHEN c.last_sync_at > NOW() - INTERVAL '5 minutes' THEN '🟢 Recently synced (watermark updated)'
    ELSE '🟡 Synced, but watermark is old'
  END as watermark_status
FROM connections c
WHERE c.source IN ('salesforce', 'hubspot', 'gong', 'fireflies')
ORDER BY c.last_sync_at DESC NULLS LAST;

-- ====================================================================================
-- TEST 2: Check sync logs to see if incremental mode was used
-- ====================================================================================

SELECT
  sl.id,
  sl.source,
  sl.status,
  sl.started_at,
  sl.completed_at,
  sl.records_synced,
  sl.metadata->>'mode' as sync_mode,
  sl.metadata->>'since' as incremental_since,
  CASE
    WHEN sl.metadata->>'mode' = 'incremental' THEN '✅ Incremental'
    WHEN sl.metadata->>'mode' = 'initial' THEN '⚠️ Initial (full sync)'
    ELSE '❓ Unknown mode'
  END as mode_indicator,
  CASE
    WHEN sl.metadata->>'mode' = 'incremental'
         AND sl.records_synced < (
           SELECT AVG(records_synced) * 0.5
           FROM sync_log sl2
           WHERE sl2.source = sl.source
             AND sl2.metadata->>'mode' = 'initial'
         ) THEN '✅ Record count reduced (incremental working)'
    WHEN sl.metadata->>'mode' = 'incremental' THEN '⚠️ Check: Record count still high'
    ELSE 'N/A'
  END as record_count_check
FROM sync_log sl
WHERE sl.source IN ('salesforce', 'hubspot', 'gong', 'fireflies')
ORDER BY sl.started_at DESC
LIMIT 10;

-- ====================================================================================
-- TEST 3: Compare first vs second sync record counts (should drop significantly)
-- ====================================================================================

WITH sync_comparison AS (
  SELECT
    source,
    metadata->>'mode' as mode,
    COUNT(*) as sync_count,
    AVG(records_synced) as avg_records,
    MIN(records_synced) as min_records,
    MAX(records_synced) as max_records
  FROM sync_log
  WHERE status = 'synced'
    AND source IN ('salesforce', 'hubspot', 'gong', 'fireflies')
  GROUP BY source, metadata->>'mode'
)
SELECT
  source,
  mode,
  sync_count,
  ROUND(avg_records) as avg_records,
  min_records,
  max_records,
  CASE
    WHEN mode = 'incremental'
         AND avg_records < (SELECT MAX(avg_records) * 0.5 FROM sync_comparison sc2 WHERE sc2.source = sync_comparison.source AND sc2.mode = 'initial')
    THEN '✅ Incremental fetching fewer records'
    WHEN mode = 'incremental'
    THEN '⚠️ Incremental fetching similar record count (check filters)'
    ELSE 'N/A (initial sync)'
  END as verification_status
FROM sync_comparison
ORDER BY source, mode;

-- ====================================================================================
-- TEST 4: Verify watermark advances after each sync
-- ====================================================================================

SELECT
  c.source,
  c.last_sync_at as current_watermark,
  (SELECT MAX(sl.completed_at)
   FROM sync_log sl
   WHERE sl.workspace_id = c.workspace_id
     AND sl.source = c.source
     AND sl.status = 'synced'
  ) as last_completed_sync,
  CASE
    WHEN c.last_sync_at = (
      SELECT MAX(sl.completed_at)
      FROM sync_log sl
      WHERE sl.workspace_id = c.workspace_id
        AND sl.source = c.source
        AND sl.status = 'synced'
    ) THEN '✅ Watermark matches last sync'
    WHEN c.last_sync_at IS NULL THEN '⚠️ No watermark set yet'
    ELSE '🔴 Watermark stale (not updating)'
  END as watermark_health
FROM connections c
WHERE c.source IN ('salesforce', 'hubspot', 'gong', 'fireflies')
ORDER BY c.source;

-- ====================================================================================
-- EXPECTED RESULTS:
-- ====================================================================================
--
-- TEST 1: After first sync, last_sync_at should be populated
-- TEST 2: Second sync should show mode='incremental' with 'since' timestamp
-- TEST 3: Incremental syncs should fetch significantly fewer records (<50% of initial)
-- TEST 4: Watermark should advance after each successful sync
--
-- RED FLAGS:
-- - last_sync_at stays NULL after multiple syncs
-- - mode always shows 'initial' even after first sync
-- - Record counts don't drop on incremental syncs
-- - Watermark doesn't advance after successful sync
