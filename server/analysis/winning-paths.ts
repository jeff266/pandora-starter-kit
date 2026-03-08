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

  let scopeDealIds: Set<string> | null = null;
  if (scopeId) {
    const scopeResult = await query<{ deal_id: string }>(
      `SELECT DISTINCT deal_id
       FROM deal_scope_memberships
       WHERE workspace_id = $1 AND scope_id = $2`,
      [workspaceId, scopeId]
    );
    scopeDealIds = new Set(scopeResult.rows.map((r) => r.deal_id));
    if (scopeDealIds.size === 0) {
      const [pipelines, scopes] = await Promise.all([
        fetchAvailablePipelines(workspaceId),
        fetchAvailableScopes(workspaceId),
      ]);
      return {
        paths: [],
        totalWins: 0,
        availablePipelines: pipelines,
        availableScopes: scopes,
        activeFilter: filterParams,
      };
    }
  }

  const pipelineClause = pipeline ? `AND d.pipeline = $3` : '';
  const sizeClause = sizeBandClause(sizeBand);
  const scopeClause = scopeDealIds ? `AND d.id = ANY($${pipeline ? 4 : 3}::text[])` : '';

  const params: any[] = [workspaceId];
  if (pipeline) params.push(pipeline);
  if (scopeDealIds) params.push([...scopeDealIds]);

  const pathsResult = await query<{
    sequence: string;
    count: string;
    avg_amount: string;
    avg_cycle_days: string;
  }>(
    `WITH won_deals AS (
      SELECT d.id, d.amount,
             EXTRACT(EPOCH FROM (d.close_date - d.created_at)) / 86400 AS cycle_days
      FROM deals d
      WHERE d.workspace_id = $1
        AND d.stage_normalized IN ('closed_won', 'closedwon', 'closed won')
        ${pipelineClause}
        ${sizeClause}
        ${scopeClause}
    ),
    deal_sequences AS (
      SELECT
        wd.id AS deal_id,
        wd.amount,
        wd.cycle_days,
        array_agg(dsh.stage ORDER BY dsh.entered_at) AS stage_seq
      FROM won_deals wd
      JOIN deal_stage_history dsh ON dsh.deal_id = wd.id AND dsh.workspace_id = $1
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
    `SELECT stage FROM deal_stage_history
     WHERE deal_id = $1 AND workspace_id = $2
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
