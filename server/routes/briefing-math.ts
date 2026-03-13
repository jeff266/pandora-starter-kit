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
import { configLoader } from '../config/workspace-config-loader.js';

const router = Router();
router.use(requireWorkspaceAccess);

/**
 * GET /:workspaceId/briefing/math/:mathKey
 *
 * Returns detailed breakdown for a specific metric.
 */
router.get(
  '/:workspaceId/briefing/math/:mathKey',
  requirePermission('briefing.view'),
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

      const dataScope = getDataVisibilityScope(permissions);

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
  // Get current quota period
  const quotaPeriod = await configLoader.getQuotaPeriod(workspaceId).catch(() => null);
  const periodStart = quotaPeriod?.start ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Get target (quota)
  const targetResult = await query<{ amount: string }>(
    `SELECT amount FROM targets
     WHERE workspace_id = $1 AND is_primary = true
     ORDER BY created_at DESC LIMIT 1`,
    [workspaceId]
  );
  const target = Number(targetResult.rows[0]?.amount ?? 0);

  // Get closed won this period
  const closedWonResult = await query<{ closed_won: string }>(
    `SELECT COALESCE(SUM(amount), 0)::numeric as closed_won
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND updated_at >= $2
       ${dealScopeSQL}`,
    [workspaceId, periodStart, ...dealScopeParams]
  );
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
       COALESCE(SUM(amount * COALESCE(probability, 0) / 100.0), 0)::numeric::text as weighted_value
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
  const ratio = gap > 0 ? Math.round((weightedPipeline / gap) * 10) / 10 : 0;

  res.json({
    mathKey: 'coverage',
    title: 'Pipeline Coverage Ratio',
    numerator: { value: weightedPipeline, label: 'Weighted pipeline' },
    denominator: { value: gap, label: 'Gap to target' },
    result: { value: ratio, label: `${ratio}x coverage`, unit: 'x' },
    breakdown,
    note: `Weighted pipeline uses probability % per deal. Coverage shows how many times over you can cover the remaining gap to target.`,
  });
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
  // Get current quota period
  const quotaPeriod = await configLoader.getQuotaPeriod(workspaceId).catch(() => null);
  const periodStart = quotaPeriod?.start ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Get quota
  const quotaResult = await query<{ amount: string }>(
    `SELECT amount FROM targets
     WHERE workspace_id = $1 AND is_primary = true
     ORDER BY created_at DESC LIMIT 1`,
    [workspaceId]
  );
  const quota = Number(quotaResult.rows[0]?.amount ?? 0);

  // Get closed won deals
  const closedResult = await query<{
    name: string;
    amount: string;
    close_date: string;
  }>(
    `SELECT name, amount, close_date
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND updated_at >= $2
       ${dealScopeSQL}
     ORDER BY amount DESC NULLS LAST
     LIMIT 20`,
    [workspaceId, periodStart, ...dealScopeParams]
  );

  const closedDeals = closedResult.rows.map(row => ({
    name: row.name,
    amount: Number(row.amount),
    close_date: row.close_date,
  }));

  const closedWon = closedDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const pct = quota > 0 ? Math.round((closedWon / quota) * 100) : 0;

  res.json({
    mathKey: 'attainment',
    title: 'Quota Attainment',
    numerator: { value: closedWon, label: 'Closed won' },
    denominator: { value: quota, label: 'Quota' },
    result: { value: pct, label: `${pct}% attainment`, unit: '%' },
    breakdown: closedDeals,
    note: `Closed won deals since ${periodStart.toISOString().split('T')[0]}.`,
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
     WHERE workspace_id = $1 AND is_primary = true
     ORDER BY created_at DESC LIMIT 1`,
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
       COALESCE(SUM(amount * COALESCE(probability, 0) / 100.0), 0)::numeric::text as weighted_value
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

  res.json({
    mathKey: 'pipeline',
    title: 'Open Pipeline',
    numerator: { value: rawPipeline, label: 'Raw pipeline' },
    denominator: { value: quota, label: 'Quota (for context)' },
    result: { value: coverageRatio, label: `${coverageRatio}x quota`, unit: 'x' },
    breakdown,
    weighted_total: weightedPipeline,
    note: `Raw pipeline shows total value of open deals. Weighted uses probability %.`,
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
