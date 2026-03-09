import { query } from '../db.js';

export interface WinningPath {
  sequence: string[];
  count: number;
  avgArrUsd: number;
  avgCycleDays: number;
}

export interface WinningPathsData {
  paths: WinningPath[];
  totalWins: number;
  availablePipelines: string[];
  availableScopes: Array<{ id: string; name: string }>;
  activeFilter?: { pipeline?: string; scopeId?: string; sizeBand?: string };
}

export interface WinningPathFilterParams {
  pipeline?: string;
  scopeId?: string;
  sizeBand?: 'small' | 'mid' | 'enterprise';
}

export interface SimilarPathsData {
  dealId: string;
  dealName: string;
  dealPath: string[];
  matchingPaths: Array<WinningPath & { overlapScore: number }>;
}

function lcs(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function sizeBandClause(sizeBand?: string): string {
  if (sizeBand === 'small') return 'AND d.amount < 50000';
  if (sizeBand === 'mid') return 'AND d.amount >= 50000 AND d.amount < 250000';
  if (sizeBand === 'enterprise') return 'AND d.amount >= 250000';
  return '';
}

export async function computeWinningPaths(
  workspaceId: string,
  filterParams?: WinningPathFilterParams
): Promise<WinningPathsData> {
  const { pipeline, scopeId, sizeBand } = filterParams ?? {};

  // Build params and clauses without junction table — scope_id is directly on deals
  const params: any[] = [workspaceId];
  let pipelineClause = '';
  let scopeClause = '';

  if (pipeline) {
    params.push(pipeline);
    pipelineClause = `AND d.pipeline = $${params.length}`;
  }

  if (scopeId) {
    params.push(scopeId);
    scopeClause = `AND d.scope_id = $${params.length}`;
  }

  const sizeClause = sizeBandClause(sizeBand);

  const pathsResult = await query<{
    sequence: string;
    count: string;
    avg_amount: string;
    avg_cycle_days: string;
  }>(
    `WITH won_deals AS (
      SELECT d.id, d.amount, d.pipeline,
             EXTRACT(EPOCH FROM (d.close_date - d.created_at)) / 86400 AS cycle_days
      FROM deals d
      WHERE d.workspace_id = $1
        AND d.stage_normalized IN ('closed_won', 'closedwon', 'closed won')
        ${pipelineClause}
        ${sizeClause}
        ${scopeClause}
    ),
    labeled_history AS (
      -- Attach stage_configs display names; keep normalized key for deduplication.
      -- Display: stage_configs.stage_name → stage_normalized → raw stage (fallback).
      -- Dedup key: stage_normalized → raw stage (so "Closed Won" and "closed_won"
      --   from different raw IDs are treated as the same transition and collapsed).
      SELECT
        dsh.deal_id,
        dsh.entered_at,
        COALESCE(sc.stage_name, dsh.stage_normalized, dsh.stage)       AS label,
        COALESCE(dsh.stage_normalized, dsh.stage)                       AS norm_key,
        LAG(COALESCE(dsh.stage_normalized, dsh.stage))
          OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at)       AS prev_norm_key
      FROM deal_stage_history dsh
      JOIN won_deals wd_inner ON wd_inner.id = dsh.deal_id
      LEFT JOIN stage_configs sc
        ON  sc.workspace_id  = $1
        AND sc.pipeline_name = wd_inner.pipeline
        AND sc.stage_id      = dsh.stage
      WHERE dsh.workspace_id = $1
    ),
    deal_sequences AS (
      SELECT
        wd.id AS deal_id,
        wd.amount,
        wd.cycle_days,
        array_agg(lh.label ORDER BY lh.entered_at) AS stage_seq
      FROM won_deals wd
      JOIN labeled_history lh ON lh.deal_id = wd.id
      WHERE lh.norm_key IS DISTINCT FROM lh.prev_norm_key
      GROUP BY wd.id, wd.amount, wd.cycle_days
    )
    SELECT
      array_to_string(stage_seq, ' → ') AS sequence,
      COUNT(*) AS count,
      AVG(amount) AS avg_amount,
      AVG(cycle_days) AS avg_cycle_days
    FROM deal_sequences
    GROUP BY stage_seq
    ORDER BY COUNT(*) DESC
    LIMIT 10`,
    params
  );

  const totalResult = await query<{ total: string }>(
    `SELECT COUNT(*) AS total
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won', 'closedwon', 'closed won')
       ${pipelineClause}
       ${sizeClause}
       ${scopeClause}`,
    params
  );

  const [pipelines, availableScopes] = await Promise.all([
    fetchAvailablePipelines(workspaceId),
    fetchAvailableScopes(workspaceId),
  ]);

  const paths: WinningPath[] = pathsResult.rows
    .filter((r) => r.sequence)
    .map((r) => ({
      sequence: r.sequence.split(' → '),
      count: parseInt(r.count, 10),
      avgArrUsd: parseFloat(r.avg_amount) || 0,
      avgCycleDays: parseFloat(r.avg_cycle_days) || 0,
    }));

  return {
    paths,
    totalWins: parseInt(totalResult.rows[0]?.total ?? '0', 10),
    availablePipelines: pipelines,
    availableScopes: availableScopes,
    activeFilter: filterParams,
  };
}

export async function computeSimilarPaths(
  workspaceId: string,
  dealId: string
): Promise<SimilarPathsData> {
  const dealResult = await query<{ id: string; name: string }>(
    `SELECT id, name FROM deals WHERE id = $1 AND workspace_id = $2`,
    [dealId, workspaceId]
  );

  const deal = dealResult.rows[0];
  if (!deal) {
    return { dealId, dealName: 'Unknown', dealPath: [], matchingPaths: [] };
  }

  const historyResult = await query<{ stage: string }>(
    `SELECT label AS stage FROM (
       SELECT
         COALESCE(sc.stage_name, dsh.stage_normalized, dsh.stage)        AS label,
         COALESCE(dsh.stage_normalized, dsh.stage)                        AS norm_key,
         LAG(COALESCE(dsh.stage_normalized, dsh.stage))
           OVER (ORDER BY dsh.entered_at)                                 AS prev_norm_key,
         dsh.entered_at
       FROM deal_stage_history dsh
       JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = $2
       LEFT JOIN stage_configs sc
         ON  sc.workspace_id  = $2
         AND sc.pipeline_name = d.pipeline
         AND sc.stage_id      = dsh.stage
       WHERE dsh.deal_id = $1 AND dsh.workspace_id = $2
     ) s
     WHERE norm_key IS DISTINCT FROM prev_norm_key
     ORDER BY entered_at ASC`,
    [dealId, workspaceId]
  );

  const dealPath = historyResult.rows.map((r) => r.stage);

  const allPaths = await computeWinningPaths(workspaceId);

  const scored = allPaths.paths
    .map((path) => {
      const overlap = lcs(dealPath, path.sequence);
      const maxLen = Math.max(dealPath.length, path.sequence.length, 1);
      const overlapScore = Math.round((overlap / maxLen) * 100);
      return { ...path, overlapScore };
    })
    .filter((p) => p.overlapScore > 0)
    .sort((a, b) => b.overlapScore - a.overlapScore)
    .slice(0, 3);

  return {
    dealId,
    dealName: deal.name || 'Unnamed Deal',
    dealPath,
    matchingPaths: scored,
  };
}

async function fetchAvailablePipelines(workspaceId: string): Promise<string[]> {
  const result = await query<{ pipeline: string }>(
    `SELECT DISTINCT pipeline FROM deals
     WHERE workspace_id = $1 AND pipeline IS NOT NULL AND pipeline != ''
     ORDER BY pipeline`,
    [workspaceId]
  );
  return result.rows.map((r) => r.pipeline);
}

async function fetchAvailableScopes(
  workspaceId: string
): Promise<Array<{ id: string; name: string }>> {
  const result = await query<{ scope_id: string; name: string }>(
    `SELECT scope_id, name FROM analysis_scopes
     WHERE workspace_id = $1 AND confirmed = true
     ORDER BY name`,
    [workspaceId]
  );
  return result.rows.map((r) => ({ id: r.scope_id, name: r.name }));
}
