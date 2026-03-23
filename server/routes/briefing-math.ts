/**
 * Briefing Math Drilldown API Routes
 *
 * Provides detailed breakdowns for numbers shown in the Concierge briefing.
 * Each mathKey returns numerator, denominator, ratio, and underlying records.
 */

import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import { requireWorkspaceAccess } from '../middleware/auth.js';
import { getDataVisibilityScope } from '../permissions/data-visibility.js';
import { getWorkspaceMember } from '../middleware/permissions.js';
import { query } from '../db.js';

const router = Router();

function fmtDollar(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function stageName(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
router.use(requireWorkspaceAccess);

/**
 * Load the headline target and resolve its pipeline scope_id from analysis_scopes.
 * This ensures the closed-won numerator and the quota denominator measure the same pipeline.
 */
async function getTargetPipelineScope(
  workspaceId: string
): Promise<{
  quota: number;
  pipelineScopeId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  pipelineName: string | null;
  hasTarget: boolean;
}> {
  const targetResult = await query<{
    amount: string;
    pipeline_id: string | null;
    pipeline_name: string | null;
    period_start: string | null;
    period_end: string | null;
  }>(
    `SELECT amount, pipeline_id, pipeline_name, period_start, period_end
     FROM targets
     WHERE workspace_id = $1 AND is_active = true
       AND period_start <= CURRENT_DATE
       AND period_end >= CURRENT_DATE
     ORDER BY period_start DESC NULLS LAST
     LIMIT 1`,
    [workspaceId]
  );
  const targetRow = targetResult.rows[0];
  if (!targetRow) {
    return { quota: 0, pipelineScopeId: null, periodStart: null, periodEnd: null, pipelineName: null, hasTarget: false };
  }
  const quota = Number(targetRow.amount ?? 0);
  const periodStart = targetRow.period_start ? new Date(targetRow.period_start) : null;
  const periodEnd = targetRow.period_end ? new Date(targetRow.period_end) : null;
  const pipelineRef = targetRow.pipeline_id || targetRow.pipeline_name || null;
  if (!pipelineRef) {
    return { quota, pipelineScopeId: null, periodStart, periodEnd, pipelineName: null, hasTarget: true };
  }

  const scopeResult = await query<{ scope_id: string }>(
    `SELECT scope_id FROM analysis_scopes
     WHERE workspace_id = $1 AND (name = $2 OR scope_id = $2)
     LIMIT 1`,
    [workspaceId, pipelineRef]
  );
  return {
    quota,
    pipelineScopeId: scopeResult.rows[0]?.scope_id ?? null,
    periodStart,
    periodEnd,
    pipelineName: pipelineRef,
    hasTarget: true,
  };
}

/**
 * GET /:workspaceId/briefing/math/:mathKey
 *
 * Returns detailed breakdown for a specific metric.
 */
router.get(
  '/:workspaceId/briefing/math/:mathKey',
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId as string;
    const mathKey = req.params.mathKey as string;
    const userId = (req as any).user?.user_id as string;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      // Get user permissions for data visibility scoping
      const { member, permissions } = await getWorkspaceMember(workspaceId, userId);

      if (!permissions) {
        res.status(403).json({ error: 'No permissions found' });
        return;
      }

      const dataScope = getDataVisibilityScope(permissions as any);

      // Build deal scope filter based on visibility
      let dealScopeSQL = '';
      const dealScopeParams: any[] = [];

      if (dataScope.dealsFilter === 'own') {
        // Get user email for owner filter
        const userResult = await query<{ email: string }>(
          `SELECT email FROM users WHERE id = $1 LIMIT 1`,
          [userId]
        );
        const userEmail = userResult.rows[0]?.email;

        if (userEmail) {
          // Resolve email to rep_name via sales_reps table
          const repResult = await query<{ rep_name: string }>(
            `SELECT rep_name FROM sales_reps WHERE workspace_id = $1 AND rep_email = $2 LIMIT 1`,
            [workspaceId, userEmail]
          );
          const repName = repResult.rows[0]?.rep_name;

          if (repName) {
            dealScopeSQL = ` AND owner = $${2 + dealScopeParams.length}`;
            dealScopeParams.push(repName);
          }
        }
      }

      // Route to appropriate handler based on mathKey
      if (mathKey === 'coverage') {
        await handleCoverageMath(res, workspaceId, dealScopeSQL, dealScopeParams);
      } else if (mathKey === 'attainment') {
        await handleAttainmentMath(res, workspaceId, dealScopeSQL, dealScopeParams);
      } else if (mathKey === 'pipeline') {
        await handlePipelineMath(res, workspaceId, dealScopeSQL, dealScopeParams);
      } else if (mathKey.startsWith('deal-')) {
        const dealId = mathKey.substring(5);
        await handleDealMath(res, workspaceId, dealId, dataScope);
      } else {
        res.status(404).json({ error: 'math_key_not_found', mathKey });
      }
    } catch (err: any) {
      console.error('[briefing-math] Error:', err);
      res.status(500).json({
        error: 'math_computation_failed',
        message: err.message || 'Failed to compute math breakdown',
      });
    }
  }
);

// ─── Math Handlers ────────────────────────────────────────────────────────────

/**
 * Coverage Ratio: weighted_pipeline / gap_to_target
 */
async function handleCoverageMath(
  res: Response,
  workspaceId: string,
  dealScopeSQL: string,
  dealScopeParams: any[]
): Promise<void> {
  const targetScope = await getTargetPipelineScope(workspaceId);
  const target = targetScope.quota;

  let closedWonSQL = `SELECT COALESCE(SUM(amount), 0)::numeric as closed_won
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'`;
  const closedWonParams: any[] = [workspaceId];
  let paramIdx = 2;

  if (targetScope.periodStart) {
    closedWonSQL += ` AND close_date >= $${paramIdx}`;
    closedWonParams.push(targetScope.periodStart);
    paramIdx++;
  }
  if (targetScope.periodEnd) {
    closedWonSQL += ` AND close_date <= $${paramIdx}`;
    closedWonParams.push(targetScope.periodEnd);
    paramIdx++;
  }
  if (targetScope.pipelineScopeId) {
    closedWonSQL += ` AND scope_id = $${paramIdx}::text`;
    closedWonParams.push(targetScope.pipelineScopeId);
    paramIdx++;
  }

  const closedWonResult = await query<{ closed_won: string }>(closedWonSQL, closedWonParams);
  const closedWon = Number(closedWonResult.rows[0]?.closed_won ?? 0);

  const gap = Math.max(0, target - closedWon);

  // Get weighted pipeline
  const pipelineResult = await query<{
    stage_normalized: string;
    deal_count: string;
    raw_value: string;
    weighted_value: string;
  }>(
    `SELECT
       stage_normalized,
       COUNT(*)::text as deal_count,
       COALESCE(SUM(amount), 0)::numeric::text as raw_value,
       COALESCE(SUM(amount * COALESCE(probability, 0)), 0)::numeric::text as weighted_value
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       ${dealScopeSQL}
     GROUP BY stage_normalized
     ORDER BY stage_normalized`,
    [workspaceId, ...dealScopeParams]
  );

  const breakdown = pipelineResult.rows.map(row => ({
    stage: row.stage_normalized,
    count: Number(row.deal_count),
    raw_value: Number(row.raw_value),
    weighted_value: Number(row.weighted_value),
  }));

  const weightedPipeline = breakdown.reduce((sum, row) => sum + row.weighted_value, 0);

  const formattedBreakdown: Array<{ label: string; value: string; bold?: boolean }> = breakdown.map(row => ({
    label: `${stageName(row.stage)} (${row.count} deal${row.count !== 1 ? 's' : ''})`,
    value: fmtDollar(row.weighted_value),
  }));
  formattedBreakdown.push({ label: 'Total weighted', value: fmtDollar(weightedPipeline), bold: true });

  if (gap > 0) {
    const ratio = Math.round((weightedPipeline / gap) * 10) / 10;
    res.json({
      mathKey: 'coverage',
      title: 'Pipeline Coverage Ratio',
      type: 'coverage',
      calculation: {
        numerator: { value: fmtDollar(weightedPipeline), label: 'Weighted pipeline' },
        denominator: { value: fmtDollar(gap), label: 'Gap to target' },
        result: { value: `${ratio}x` },
        note: `Weighted pipeline uses probability % per deal. Coverage shows how many times over you can cover the remaining gap to target.`,
      },
      breakdown: formattedBreakdown,
    });
  } else {
    const quotaRatio = target > 0 ? Math.round((weightedPipeline / target) * 10) / 10 : 0;
    res.json({
      mathKey: 'coverage',
      title: 'Pipeline Coverage (Quota Met)',
      type: 'coverage',
      calculation: {
        numerator: { value: fmtDollar(weightedPipeline), label: 'Weighted pipeline' },
        denominator: { value: fmtDollar(target), label: 'Original quota' },
        result: { value: `${quotaRatio}x` },
        note: `Quota already met — no remaining gap. Coverage shown against the original ${fmtDollar(target)} quota for context. Closed won: ${fmtDollar(closedWon)}.`,
      },
      breakdown: formattedBreakdown,
    });
  }
}

/**
 * Attainment: closed_won / quota
 */
async function handleAttainmentMath(
  res: Response,
  workspaceId: string,
  dealScopeSQL: string,
  dealScopeParams: any[]
): Promise<void> {
  const targetScope = await getTargetPipelineScope(workspaceId);
  const { quota, hasTarget } = targetScope;

  let scopeWhere = '';
  const scopeParams: any[] = [workspaceId];
  let paramIdx = 2;

  if (targetScope.periodStart) {
    scopeWhere += ` AND close_date >= $${paramIdx}`;
    scopeParams.push(targetScope.periodStart);
    paramIdx++;
  }
  if (targetScope.periodEnd) {
    scopeWhere += ` AND close_date <= $${paramIdx}`;
    scopeParams.push(targetScope.periodEnd);
    paramIdx++;
  }
  if (targetScope.pipelineScopeId) {
    scopeWhere += ` AND scope_id = $${paramIdx}::text`;
    scopeParams.push(targetScope.pipelineScopeId);
    paramIdx++;
  }

  const aggResult = await query<{ closed_won: string }>(
    `SELECT COALESCE(SUM(amount), 0)::numeric as closed_won
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'${scopeWhere}`,
    scopeParams
  );
  const closedWon = Number(aggResult.rows[0]?.closed_won ?? 0);

  const countResult = await query<{ total_count: string }>(
    `SELECT COUNT(*)::text as total_count
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'${scopeWhere}`,
    scopeParams
  );
  const totalCount = Number(countResult.rows[0]?.total_count ?? 0);

  const closedResult = await query<{
    name: string;
    amount: string;
    close_date: string;
  }>(
    `SELECT name, amount, close_date
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'${scopeWhere}
     ORDER BY amount DESC NULLS LAST LIMIT 20`,
    scopeParams
  );

  const closedDeals = closedResult.rows.map(row => ({
    name: row.name,
    amount: Number(row.amount),
    close_date: row.close_date,
  }));
  const pct = quota > 0 ? Math.round((closedWon / quota) * 100) : 0;

  const periodLabel = targetScope.periodStart && targetScope.periodEnd
    ? `${targetScope.periodStart.toISOString().split('T')[0]} to ${targetScope.periodEnd.toISOString().split('T')[0]}`
    : 'current period';
  const scopeNote = targetScope.pipelineScopeId ? ` Scoped to pipeline: ${targetScope.pipelineScopeId}.` : '';

  const formattedBreakdown: Array<{ label: string; value: string; bold?: boolean }> = closedDeals.map(deal => ({
    label: deal.name,
    value: fmtDollar(deal.amount),
  }));
  formattedBreakdown.push({ label: `Total (${totalCount} deal${totalCount !== 1 ? 's' : ''})`, value: fmtDollar(closedWon), bold: true });

  res.json({
    mathKey: 'attainment',
    title: 'Quota Attainment',
    type: 'attainment',
    hasTarget,
    calculation: {
      numerator: { value: fmtDollar(closedWon), label: 'Closed won' },
      denominator: { value: fmtDollar(quota), label: 'Quota' },
      result: { value: `${pct}%` },
      note: `Closed won deals in ${periodLabel}.${scopeNote}`,
    },
    breakdown: formattedBreakdown,
    deals: closedDeals,
    total_count: totalCount,
  });
}

/**
 * Pipeline: total_pipeline_value / quota (for sizing context)
 */
async function handlePipelineMath(
  res: Response,
  workspaceId: string,
  dealScopeSQL: string,
  dealScopeParams: any[]
): Promise<void> {
  // Get quota for context
  const quotaResult = await query<{ amount: string }>(
    `SELECT amount FROM targets
     WHERE workspace_id = $1 AND is_active = true
       AND (period_start IS NULL OR period_start <= NOW())
       AND (period_end IS NULL OR period_end >= NOW())
     ORDER BY period_start DESC NULLS LAST LIMIT 1`,
    [workspaceId]
  );
  const quota = Number(quotaResult.rows[0]?.amount ?? 0);

  // Get pipeline by stage
  const pipelineResult = await query<{
    stage_normalized: string;
    deal_count: string;
    raw_value: string;
    weighted_value: string;
  }>(
    `SELECT
       stage_normalized,
       COUNT(*)::text as deal_count,
       COALESCE(SUM(amount), 0)::numeric::text as raw_value,
       COALESCE(SUM(amount * COALESCE(probability, 0)), 0)::numeric::text as weighted_value
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       ${dealScopeSQL}
     GROUP BY stage_normalized
     ORDER BY stage_normalized`,
    [workspaceId, ...dealScopeParams]
  );

  const breakdown = pipelineResult.rows.map(row => ({
    stage: row.stage_normalized,
    count: Number(row.deal_count),
    raw_value: Number(row.raw_value),
    weighted_value: Number(row.weighted_value),
  }));

  const rawPipeline = breakdown.reduce((sum, row) => sum + row.raw_value, 0);
  const weightedPipeline = breakdown.reduce((sum, row) => sum + row.weighted_value, 0);
  const coverageRatio = quota > 0 ? Math.round((rawPipeline / quota) * 10) / 10 : 0;

  const formattedBreakdown: Array<{ label: string; value: string; bold?: boolean }> = breakdown.map(row => ({
    label: `${stageName(row.stage)} (${row.count} deal${row.count !== 1 ? 's' : ''})`,
    value: fmtDollar(row.raw_value),
  }));
  formattedBreakdown.push({ label: 'Total raw', value: fmtDollar(rawPipeline), bold: true });
  formattedBreakdown.push({ label: 'Total weighted', value: fmtDollar(weightedPipeline), bold: true });

  res.json({
    mathKey: 'pipeline',
    title: 'Open Pipeline',
    type: 'pipeline',
    calculation: {
      numerator: { value: fmtDollar(rawPipeline), label: 'Raw pipeline' },
      denominator: { value: fmtDollar(quota), label: 'Quota (for context)' },
      result: { value: `${coverageRatio}x` },
      note: `Raw pipeline shows total value of open deals. Weighted uses probability %.`,
    },
    breakdown: formattedBreakdown,
    weighted_total: weightedPipeline,
  });
}

/**
 * Deal Detail: risk signals, findings, activity
 */
async function handleDealMath(
  res: Response,
  workspaceId: string,
  dealId: string,
  dataScope: any
): Promise<void> {
  // Check if user can see this deal
  const dealResult = await query<{
    name: string;
    amount: string;
    stage: string;
    stage_normalized: string;
    close_date: string;
    owner_email: string;
    updated_at: string;
  }>(
    `SELECT name, amount, stage, stage_normalized, close_date, owner_email, updated_at
     FROM deals
     WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
    [workspaceId, dealId]
  );

  if (dealResult.rows.length === 0) {
    res.status(404).json({ error: 'deal_not_found' });
    return;
  }

  const deal = dealResult.rows[0];

  // Get findings
  const findingsResult = await query<{
    severity: string;
    message: string;
    category: string;
    created_at: string;
  }>(
    `SELECT severity, message, category, created_at
     FROM findings
     WHERE workspace_id = $1
       AND entity_id = $2
       AND resolved_at IS NULL
     ORDER BY
       CASE severity WHEN 'act' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END,
       created_at DESC
     LIMIT 10`,
    [workspaceId, dealId]
  );

  const findings = findingsResult.rows.map(row => ({
    severity: row.severity,
    message: row.message,
    category: row.category,
    age: Math.floor((Date.now() - new Date(row.created_at).getTime()) / (24 * 60 * 60 * 1000)),
  }));

  // Get last conversation
  const convResult = await query<{ created_at: string }>(
    `SELECT created_at FROM conversations
     WHERE workspace_id = $1 AND deal_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [workspaceId, dealId]
  ).catch(() => ({ rows: [] }));

  const lastConversation = convResult.rows[0]?.created_at ?? null;

  // Calculate days in stage
  const daysInStage = Math.floor(
    (Date.now() - new Date(deal.updated_at).getTime()) / (24 * 60 * 60 * 1000)
  );

  res.json({
    mathKey: `deal-${dealId}`,
    title: deal.name,
    deal: {
      id: dealId,
      name: deal.name,
      amount: Number(deal.amount),
      stage: deal.stage,
      stage_normalized: deal.stage_normalized,
      close_date: deal.close_date,
      owner_email: deal.owner_email,
      days_in_stage: daysInStage,
    },
    findings,
    last_conversation: lastConversation,
    note: `Risk signals and findings for ${deal.name}.`,
  });
}

export default router;
