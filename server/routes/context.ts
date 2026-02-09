import { Router, type Request, type Response } from 'express';
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

export default router;
