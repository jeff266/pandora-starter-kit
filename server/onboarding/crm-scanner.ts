import { query } from '../db.js';
import type { CRMScanResult, PipelineStat, DimensionStat, StageStat, WonLostStat, OwnerStat, AmountDistribution, FieldFillRate, AmountCycleBucket } from './types.js';

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export async function scanCRM(workspaceId: string): Promise<CRMScanResult> {
  const [
    pipelines,
    deal_types,
    record_types,
    stages,
    won_lost,
    owners,
    close_date_clusters,
    amount_distribution,
    custom_field_fill_rates,
    contacts_per_deal,
    new_owners,
    unused_stages,
    amount_cycle_buckets,
  ] = await Promise.all([

    safe(async (): Promise<PipelineStat[]> => {
      const r = await query(`
        SELECT COALESCE(pipeline, 'Default') AS pipeline,
               COUNT(*) AS count,
               COALESCE(SUM(amount), 0) AS total_amount,
               COALESCE(AVG(amount), 0) AS avg_amount,
               AVG(
                 EXTRACT(EPOCH FROM (close_date - created_at))/86400
               ) FILTER (WHERE stage_normalized = 'closed_won' AND close_date IS NOT NULL AND created_at IS NOT NULL AND close_date > created_at) AS avg_cycle_days,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (close_date - created_at))/86400)
               FILTER (WHERE stage_normalized = 'closed_won' AND close_date IS NOT NULL AND created_at IS NOT NULL AND close_date > created_at) AS median_cycle_days
        FROM deals WHERE workspace_id = $1::uuid AND amount IS NOT NULL
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10
      `, [workspaceId]);
      return r.rows.map(row => ({
        pipeline: row.pipeline,
        count: parseInt(row.count),
        total_amount: parseFloat(row.total_amount) || 0,
        avg_amount: parseFloat(row.avg_amount) || 0,
        avg_cycle_days: row.avg_cycle_days != null ? parseFloat(row.avg_cycle_days) : null,
        median_cycle_days: row.median_cycle_days != null ? parseFloat(row.median_cycle_days) : null,
      }));
    }, []),

    safe(async (): Promise<DimensionStat[]> => {
      const r = await query(`
        SELECT custom_fields->>'dealtype' AS value, COUNT(*) AS count, COALESCE(AVG(amount), 0) AS avg_amount
        FROM deals WHERE workspace_id = $1::uuid AND custom_fields->>'dealtype' IS NOT NULL
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10
      `, [workspaceId]);
      return r.rows.map(row => ({ value: row.value, count: parseInt(row.count), avg_amount: parseFloat(row.avg_amount) || 0 }));
    }, []),

    safe(async (): Promise<DimensionStat[]> => {
      const r = await query(`
        SELECT custom_fields->>'record_type_name' AS value, COUNT(*) AS count, COALESCE(AVG(amount), 0) AS avg_amount
        FROM deals WHERE workspace_id = $1::uuid AND custom_fields->>'record_type_name' IS NOT NULL
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10
      `, [workspaceId]);
      return r.rows.map(row => ({ value: row.value, count: parseInt(row.count), avg_amount: parseFloat(row.avg_amount) || 0 }));
    }, []),

    safe(async (): Promise<StageStat[]> => {
      const r = await query(`
        SELECT stage, COUNT(*) AS deals,
               COALESCE(ROUND(AVG(amount)::numeric, 0), 0) AS avg_amount,
               ROUND(AVG(days_in_stage)::numeric, 0) AS avg_days
        FROM deals WHERE workspace_id = $1::uuid AND stage IS NOT NULL
        GROUP BY stage ORDER BY MIN(created_at) LIMIT 30
      `, [workspaceId]);
      return r.rows.map(row => ({
        stage: row.stage,
        deals: parseInt(row.deals),
        avg_amount: parseFloat(row.avg_amount) || 0,
        avg_days: row.avg_days != null ? parseFloat(row.avg_days) : null,
      }));
    }, []),

    safe(async (): Promise<WonLostStat[]> => {
      const r = await query(`
        SELECT stage, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_amount
        FROM deals WHERE workspace_id = $1::uuid AND stage_normalized IN ('closed_won','closed_lost')
        GROUP BY stage
      `, [workspaceId]);
      return r.rows.map(row => ({ stage: row.stage, count: parseInt(row.count), total_amount: parseFloat(row.total_amount) || 0 }));
    }, []),

    safe(async (): Promise<OwnerStat[]> => {
      const r = await query(`
        SELECT owner AS owner_name, COUNT(*) AS deal_count,
               COALESCE(SUM(amount), 0) AS total_amount,
               MAX(created_at) AS last_deal_created, MIN(created_at) AS first_deal_created
        FROM deals WHERE workspace_id = $1::uuid AND owner IS NOT NULL
        GROUP BY owner ORDER BY COUNT(*) DESC LIMIT 50
      `, [workspaceId]);
      return r.rows.map(row => ({
        owner_name: row.owner_name,
        deal_count: parseInt(row.deal_count),
        total_amount: parseFloat(row.total_amount) || 0,
        last_deal_created: row.last_deal_created ? new Date(row.last_deal_created).toISOString() : null,
        first_deal_created: row.first_deal_created ? new Date(row.first_deal_created).toISOString() : null,
      }));
    }, []),

    safe(async () => {
      const r = await query(`
        SELECT DATE_TRUNC('month', close_date) AS month, COUNT(*) AS count,
               COALESCE(SUM(amount), 0) AS total_amount
        FROM deals WHERE workspace_id = $1::uuid AND close_date IS NOT NULL
        GROUP BY 1 ORDER BY 1 DESC LIMIT 24
      `, [workspaceId]);
      return r.rows.map(row => ({ month: row.month, count: parseInt(row.count), total_amount: parseFloat(row.total_amount) || 0 }));
    }, []),

    safe(async (): Promise<AmountDistribution | null> => {
      const r = await query(`
        SELECT
          PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY amount) AS p10,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount) AS p25,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) AS p50,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount) AS p75,
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY amount) AS p90,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY amount) AS p95
        FROM deals WHERE workspace_id = $1::uuid AND amount > 0
      `, [workspaceId]);
      const row = r.rows[0];
      if (!row || row.p50 == null) return null;
      return { p10: +row.p10, p25: +row.p25, p50: +row.p50, p75: +row.p75, p90: +row.p90, p95: +row.p95 };
    }, null),

    safe(async (): Promise<FieldFillRate[]> => {
      const r = await query(`
        SELECT key,
               COUNT(*) AS filled_count,
               COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM deals WHERE workspace_id = $1::uuid), 0) AS fill_pct
        FROM deals, jsonb_object_keys(custom_fields) AS key
        WHERE workspace_id = $1::uuid AND custom_fields IS NOT NULL
        GROUP BY key ORDER BY fill_pct DESC LIMIT 30
      `, [workspaceId]);
      return r.rows.map(row => ({ key: row.key, filled_count: parseInt(row.filled_count), fill_pct: parseFloat(row.fill_pct) || 0 }));
    }, []),

    safe(async () => {
      const r = await query(`
        SELECT AVG(contact_count) AS avg_contacts,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY contact_count) AS median_contacts
        FROM (
          SELECT d.id, COUNT(dc.contact_id) AS contact_count
          FROM deals d LEFT JOIN deal_contacts dc ON dc.deal_id = d.id
          WHERE d.workspace_id = $1::uuid GROUP BY d.id
        ) sub
      `, [workspaceId]);
      const row = r.rows[0];
      if (!row) return null;
      return { avg_contacts: parseFloat(row.avg_contacts) || 0, median_contacts: parseFloat(row.median_contacts) || 0 };
    }, null),

    safe(async (): Promise<string[]> => {
      const r = await query(`
        SELECT DISTINCT owner FROM deals
        WHERE workspace_id = $1::uuid AND created_at > NOW() - INTERVAL '30 days'
          AND owner NOT IN (
            SELECT DISTINCT owner FROM deals
            WHERE workspace_id = $1::uuid AND created_at < NOW() - INTERVAL '30 days' AND owner IS NOT NULL
          )
        AND owner IS NOT NULL LIMIT 20
      `, [workspaceId]);
      return r.rows.map(row => row.owner);
    }, []),

    safe(async (): Promise<string[]> => {
      const r = await query(`
        SELECT sc.stage_name FROM stage_configs sc
        LEFT JOIN deals d ON d.workspace_id = sc.workspace_id AND d.stage = sc.stage_name
        WHERE sc.workspace_id = $1::uuid
        GROUP BY sc.stage_name HAVING COUNT(d.id) = 0
      `, [workspaceId]);
      return r.rows.map(row => row.stage_name);
    }, []),

    safe(async (): Promise<AmountCycleBucket[]> => {
      const r = await query(`
        WITH buckets AS (
          SELECT
            CASE
              WHEN amount < 1000   THEN 1
              WHEN amount < 5000   THEN 2
              WHEN amount < 10000  THEN 3
              WHEN amount < 25000  THEN 4
              WHEN amount < 50000  THEN 5
              WHEN amount < 100000 THEN 6
              WHEN amount < 250000 THEN 7
              ELSE 8
            END AS bucket_order,
            CASE
              WHEN amount < 1000   THEN '<$1K'
              WHEN amount < 5000   THEN '$1K-$5K'
              WHEN amount < 10000  THEN '$5K-$10K'
              WHEN amount < 25000  THEN '$10K-$25K'
              WHEN amount < 50000  THEN '$25K-$50K'
              WHEN amount < 100000 THEN '$50K-$100K'
              WHEN amount < 250000 THEN '$100K-$250K'
              ELSE '$250K+'
            END AS bucket,
            amount,
            EXTRACT(EPOCH FROM (close_date - created_at))/86400 AS cycle_days,
            stage_normalized
          FROM deals
          WHERE workspace_id = $1::uuid AND amount > 0
            AND (close_date IS NULL OR close_date > created_at)
        )
        SELECT
          bucket_order,
          bucket,
          COUNT(*) AS deals,
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)) AS median_amount,
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cycle_days) FILTER (WHERE cycle_days > 0)) AS median_cycle_days,
          ROUND(AVG(cycle_days) FILTER (WHERE cycle_days > 0)) AS avg_cycle_days,
          ROUND(
            COUNT(*) FILTER (WHERE stage_normalized = 'closed_won') * 100.0 /
            NULLIF(COUNT(*) FILTER (WHERE stage_normalized IN ('closed_won','closed_lost')), 0)
          ) AS win_rate_pct
        FROM buckets
        GROUP BY bucket_order, bucket
        HAVING COUNT(*) >= 3
        ORDER BY bucket_order
      `, [workspaceId]);
      return r.rows.map(row => ({
        bucket: row.bucket,
        bucket_order: parseInt(row.bucket_order),
        deals: parseInt(row.deals),
        median_amount: parseFloat(row.median_amount) || 0,
        median_cycle_days: row.median_cycle_days != null ? parseFloat(row.median_cycle_days) : null,
        avg_cycle_days: row.avg_cycle_days != null ? parseFloat(row.avg_cycle_days) : null,
        win_rate_pct: row.win_rate_pct != null ? parseFloat(row.win_rate_pct) : null,
      }));
    }, []),

  ]);

  return {
    pipelines,
    deal_types,
    record_types,
    stages,
    won_lost,
    owners,
    close_date_clusters,
    amount_distribution,
    custom_field_fill_rates,
    contacts_per_deal,
    new_owners,
    unused_stages,
    amount_cycle_buckets,
    segment_analysis: null,
  };
}
