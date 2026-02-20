import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import {
  getContext,
  getBusinessContext,
  getGoals,
  getDefinitions,
  getMaturity,
  updateContext,
  getContextVersion,
  isValidSection,
  onboardWorkspace,
  type OnboardingAnswers,
} from '../context/index.js';
import { discoverBowtieStages, getBowtieDiscovery } from '../analysis/bowtie-discovery.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

interface SectionParams extends WorkspaceParams {
  section: string;
}

const SECTION_GETTERS: Record<string, (id: string) => Promise<Record<string, unknown>>> = {
  business_model: getBusinessContext,
  team_structure: async (id) => {
    const ctx = await getContext(id);
    return ctx?.team_structure ?? {};
  },
  goals_and_targets: getGoals,
  goals: getGoals,
  definitions: getDefinitions,
  operational_maturity: getMaturity,
  maturity: getMaturity,
};

async function validateWorkspace(workspaceId: string, res: Response): Promise<boolean> {
  const result = await query<{ id: string }>('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Workspace not found' });
    return false;
  }
  return true;
}

router.get('/:workspaceId/context', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;
    const context = await getContext(req.params.workspaceId);
    res.json({ success: true, context });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Get context error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/context/version', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;
    const version = await getContextVersion(req.params.workspaceId);
    res.json({ success: true, version });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Get version error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/context/:section', async (req: Request<SectionParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    const { section } = req.params;
    const getter = SECTION_GETTERS[section];

    if (!getter) {
      res.status(400).json({
        error: `Invalid section: ${section}`,
        valid_sections: ['business_model', 'team_structure', 'goals_and_targets', 'definitions', 'operational_maturity'],
      });
      return;
    }

    const data = await getter(req.params.workspaceId);
    res.json({ success: true, section, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Get section error:', message);
    res.status(500).json({ error: message });
  }
});

router.put('/:workspaceId/context/:section', async (req: Request<SectionParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    const { section } = req.params;

    const dbSection = section === 'goals' ? 'goals_and_targets'
      : section === 'maturity' ? 'operational_maturity'
      : section;

    if (!isValidSection(dbSection)) {
      res.status(400).json({
        error: `Invalid section: ${section}`,
        valid_sections: ['business_model', 'team_structure', 'goals_and_targets', 'definitions', 'operational_maturity'],
      });
      return;
    }

    const { data, updated_by } = req.body as { data?: Record<string, unknown>; updated_by?: string };

    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'Request body must include a "data" object' });
      return;
    }

    const updated = await updateContext(req.params.workspaceId, dbSection, data, updated_by);
    res.json({ success: true, version: updated.version, context: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Update section error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/context/onboard', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    const body = req.body as Partial<OnboardingAnswers>;

    const requiredFields: (keyof OnboardingAnswers)[] = [
      'gtm_motion',
      'avg_deal_size',
      'sales_cycle_days',
      'qualified_stages',
      'stale_deal_days',
      'pipeline_coverage_target',
      'revenue_target',
    ];

    const missing = requiredFields.filter((f) => body[f] === undefined || body[f] === null);
    if (missing.length > 0) {
      res.status(400).json({
        error: 'Missing required onboarding fields',
        missing,
        expected: {
          gtm_motion: 'string (plg, enterprise, hybrid)',
          avg_deal_size: 'number',
          sales_cycle_days: 'number',
          qualified_stages: 'string[] (stage names that mean "qualified")',
          stale_deal_days: 'number (days before a deal is considered stale)',
          pipeline_coverage_target: 'number (multiple of quota, e.g. 3)',
          revenue_target: 'number',
        },
      });
      return;
    }

    const answers: OnboardingAnswers = {
      gtm_motion: body.gtm_motion!,
      avg_deal_size: body.avg_deal_size!,
      sales_cycle_days: body.sales_cycle_days!,
      qualified_stages: body.qualified_stages!,
      stale_deal_days: body.stale_deal_days!,
      pipeline_coverage_target: body.pipeline_coverage_target!,
      revenue_target: body.revenue_target!,
      pricing_model: body.pricing_model,
      icp_description: body.icp_description,
      target_market: body.target_market,
    };

    const context = await onboardWorkspace(req.params.workspaceId, answers);
    res.json({ success: true, message: 'Workspace onboarded successfully', context });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Onboard error:', message);
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// Forecast Thresholds API
// ============================================================================

router.get('/:workspaceId/forecast-thresholds', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    const result = await query<{ commit_threshold: number; best_case_threshold: number }>(
      `SELECT commit_threshold, best_case_threshold
       FROM forecast_thresholds
       WHERE workspace_id = $1`,
      [req.params.workspaceId]
    );

    if (result.rows.length === 0) {
      // Return defaults if not set
      res.json({ commit_threshold: 90, best_case_threshold: 60 });
    } else {
      res.json(result.rows[0]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Get forecast thresholds error:', message);
    res.status(500).json({ error: message });
  }
});

router.put('/:workspaceId/forecast-thresholds', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    const { commit_threshold, best_case_threshold } = req.body;

    // Validate inputs
    if (
      typeof commit_threshold !== 'number' ||
      typeof best_case_threshold !== 'number' ||
      commit_threshold < 0 || commit_threshold > 100 ||
      best_case_threshold < 0 || best_case_threshold > 100 ||
      commit_threshold < best_case_threshold
    ) {
      res.status(400).json({
        error: 'Invalid thresholds. Must be numbers 0-100, with commit >= best_case'
      });
      return;
    }

    await query(
      `INSERT INTO forecast_thresholds (workspace_id, commit_threshold, best_case_threshold, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (workspace_id)
       DO UPDATE SET
         commit_threshold = $2,
         best_case_threshold = $3,
         updated_at = NOW()`,
      [req.params.workspaceId, commit_threshold, best_case_threshold]
    );

    res.json({
      success: true,
      commit_threshold,
      best_case_threshold
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Update forecast thresholds error:', message);
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// Quota Periods API
// ============================================================================

router.get('/:workspaceId/quotas/periods', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    const result = await query<{
      id: string;
      name: string;
      period_type: string;
      start_date: string;
      end_date: string;
      team_quota: number;
      created_at: string;
    }>(
      `SELECT id, name, period_type, start_date, end_date, team_quota, created_at
       FROM quota_periods
       WHERE workspace_id = $1
       ORDER BY start_date DESC`,
      [req.params.workspaceId]
    );

    res.json(result.rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Get quota periods error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/quotas/periods', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    const { name, period_type, start_date, end_date, team_quota } = req.body;

    // Validate inputs
    if (!name || !period_type || !start_date || !end_date || team_quota === undefined) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (!['monthly', 'quarterly', 'annual'].includes(period_type)) {
      res.status(400).json({ error: 'Invalid period_type. Must be monthly, quarterly, or annual' });
      return;
    }

    const result = await query<{ id: string }>(
      `INSERT INTO quota_periods (workspace_id, name, period_type, start_date, end_date, team_quota)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [req.params.workspaceId, name, period_type, start_date, end_date, team_quota]
    );

    res.status(201).json({ id: result.rows[0].id, name, period_type, start_date, end_date, team_quota });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Create quota period error:', message);
    res.status(500).json({ error: message });
  }
});

router.put('/:workspaceId/quotas/periods/:periodId', async (req: Request<WorkspaceParams & { periodId: string }>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    const { name, period_type, start_date, end_date, team_quota } = req.body;

    await query(
      `UPDATE quota_periods
       SET name = COALESCE($1, name),
           period_type = COALESCE($2, period_type),
           start_date = COALESCE($3, start_date),
           end_date = COALESCE($4, end_date),
           team_quota = COALESCE($5, team_quota),
           updated_at = NOW()
       WHERE id = $6 AND workspace_id = $7`,
      [name, period_type, start_date, end_date, team_quota, req.params.periodId, req.params.workspaceId]
    );

    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Update quota period error:', message);
    res.status(500).json({ error: message });
  }
});

router.delete('/:workspaceId/quotas/periods/:periodId', async (req: Request<WorkspaceParams & { periodId: string }>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    await query(
      `DELETE FROM quota_periods WHERE id = $1 AND workspace_id = $2`,
      [req.params.periodId, req.params.workspaceId]
    );

    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Delete quota period error:', message);
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// Rep Quotas API
// ============================================================================

router.get('/:workspaceId/quotas/periods/:periodId/reps', async (req: Request<WorkspaceParams & { periodId: string }>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    const result = await query<{
      id: string;
      rep_name: string;
      quota_amount: number;
    }>(
      `SELECT rq.id, rq.rep_name, rq.quota_amount
       FROM rep_quotas rq
       JOIN quota_periods qp ON qp.id = rq.period_id
       WHERE rq.period_id = $1 AND qp.workspace_id = $2
       ORDER BY rq.rep_name`,
      [req.params.periodId, req.params.workspaceId]
    );

    res.json(result.rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Get rep quotas error:', message);
    res.status(500).json({ error: message });
  }
});

router.put('/:workspaceId/quotas/periods/:periodId/reps/:repName', async (req: Request<WorkspaceParams & { periodId: string; repName: string }>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    const { quota_amount } = req.body;

    if (quota_amount === undefined) {
      res.status(400).json({ error: 'Missing quota_amount' });
      return;
    }

    await query(
      `INSERT INTO rep_quotas (period_id, rep_name, quota_amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (period_id, rep_name)
       DO UPDATE SET quota_amount = $3, updated_at = NOW()`,
      [req.params.periodId, req.params.repName, quota_amount]
    );

    res.json({ success: true, rep_name: req.params.repName, quota_amount });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Update rep quota error:', message);
    res.status(500).json({ error: message });
  }
});

router.delete('/:workspaceId/quotas/periods/:periodId/reps/:repName', async (req: Request<WorkspaceParams & { periodId: string; repName: string }>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;

    await query(
      `DELETE FROM rep_quotas
       WHERE period_id = $1 AND rep_name = $2`,
      [req.params.periodId, req.params.repName]
    );

    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Delete rep quota error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/bowtie/discover', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;
    const result = await discoverBowtieStages(req.params.workspaceId);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Bowtie discovery error:', message);
    res.status(500).json({ error: message });
  }
});

router.put('/:workspaceId/bowtie', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;
    const bowtieData = req.body;
    bowtieData.status = 'confirmed';
    const definitions = await getDefinitions(req.params.workspaceId) as Record<string, unknown>;
    await updateContext(req.params.workspaceId, 'definitions', {
      ...definitions,
      bowtie_discovery: bowtieData,
    }, 'user:manual');
    res.json(bowtieData);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Bowtie PUT error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/bowtie', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    if (!(await validateWorkspace(req.params.workspaceId, res))) return;
    const result = await getBowtieDiscovery(req.params.workspaceId);
    if (!result) {
      res.json({ hasBowtieStages: false, message: 'Bowtie discovery has not been run yet. POST to /bowtie/discover to analyze.' });
      return;
    }
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context] Get bowtie error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
