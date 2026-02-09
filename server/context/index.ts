import { query } from '../db.js';

type ContextSection =
  | 'business_model'
  | 'team_structure'
  | 'goals_and_targets'
  | 'definitions'
  | 'operational_maturity';

interface ContextLayer {
  id: string;
  workspace_id: string;
  business_model: Record<string, unknown>;
  team_structure: Record<string, unknown>;
  goals_and_targets: Record<string, unknown>;
  definitions: Record<string, unknown>;
  operational_maturity: Record<string, unknown>;
  version: number;
  updated_at: Date;
  updated_by: string | null;
}

const VALID_SECTIONS: ReadonlySet<string> = new Set<string>([
  'business_model',
  'team_structure',
  'goals_and_targets',
  'definitions',
  'operational_maturity',
]);

export function isValidSection(section: string): section is ContextSection {
  return VALID_SECTIONS.has(section);
}

async function ensureContext(workspaceId: string): Promise<void> {
  await query(
    `INSERT INTO context_layer (workspace_id)
     VALUES ($1)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId]
  );
}

export async function getContext(workspaceId: string): Promise<ContextLayer | null> {
  await ensureContext(workspaceId);
  const result = await query<ContextLayer>(
    'SELECT * FROM context_layer WHERE workspace_id = $1',
    [workspaceId]
  );
  return result.rows[0] ?? null;
}

export async function getBusinessContext(workspaceId: string): Promise<Record<string, unknown>> {
  await ensureContext(workspaceId);
  const result = await query<{ business_model: Record<string, unknown> }>(
    'SELECT business_model FROM context_layer WHERE workspace_id = $1',
    [workspaceId]
  );
  return result.rows[0]?.business_model ?? {};
}

export async function getGoals(workspaceId: string): Promise<Record<string, unknown>> {
  await ensureContext(workspaceId);
  const result = await query<{ goals_and_targets: Record<string, unknown> }>(
    'SELECT goals_and_targets FROM context_layer WHERE workspace_id = $1',
    [workspaceId]
  );
  return result.rows[0]?.goals_and_targets ?? {};
}

export async function getDefinitions(workspaceId: string): Promise<Record<string, unknown>> {
  await ensureContext(workspaceId);
  const result = await query<{ definitions: Record<string, unknown> }>(
    'SELECT definitions FROM context_layer WHERE workspace_id = $1',
    [workspaceId]
  );
  return result.rows[0]?.definitions ?? {};
}

export async function getMaturity(workspaceId: string): Promise<Record<string, unknown>> {
  await ensureContext(workspaceId);
  const result = await query<{ operational_maturity: Record<string, unknown> }>(
    'SELECT operational_maturity FROM context_layer WHERE workspace_id = $1',
    [workspaceId]
  );
  return result.rows[0]?.operational_maturity ?? {};
}

export async function updateContext(
  workspaceId: string,
  section: ContextSection,
  data: Record<string, unknown>,
  updatedBy?: string
): Promise<ContextLayer> {
  await ensureContext(workspaceId);

  const result = await query<ContextLayer>(
    `UPDATE context_layer
     SET ${section} = $2,
         version = version + 1,
         updated_at = NOW(),
         updated_by = $3
     WHERE workspace_id = $1
     RETURNING *`,
    [workspaceId, JSON.stringify(data), updatedBy ?? null]
  );

  return result.rows[0];
}

export async function getContextVersion(workspaceId: string): Promise<number> {
  await ensureContext(workspaceId);
  const result = await query<{ version: number }>(
    'SELECT version FROM context_layer WHERE workspace_id = $1',
    [workspaceId]
  );
  return result.rows[0]?.version ?? 1;
}

export interface OnboardingAnswers {
  gtm_motion: string;
  avg_deal_size: number;
  sales_cycle_days: number;
  qualified_stages: string[];
  stale_deal_days: number;
  pipeline_coverage_target: number;
  revenue_target: number;
  pricing_model?: string;
  icp_description?: string;
  target_market?: string;
}

export async function onboardWorkspace(
  workspaceId: string,
  answers: OnboardingAnswers,
  updatedBy?: string
): Promise<ContextLayer> {
  await ensureContext(workspaceId);

  const businessModel = {
    gtm_motion: answers.gtm_motion,
    acv_range: { avg: answers.avg_deal_size },
    sales_cycle_days: answers.sales_cycle_days,
    pricing_model: answers.pricing_model ?? null,
    icp_description: answers.icp_description ?? null,
    target_market: answers.target_market ?? null,
  };

  const goalsAndTargets = {
    revenue_target: answers.revenue_target,
    pipeline_coverage_target: answers.pipeline_coverage_target,
    thresholds: {
      stale_deal_days: answers.stale_deal_days,
    },
  };

  const definitions = {
    qualified_definition: answers.qualified_stages,
    stage_mapping: {},
    terminology_map: {},
  };

  const result = await query<ContextLayer>(
    `UPDATE context_layer
     SET business_model = $2,
         goals_and_targets = $3,
         definitions = $4,
         version = version + 1,
         updated_at = NOW(),
         updated_by = $5
     WHERE workspace_id = $1
     RETURNING *`,
    [
      workspaceId,
      JSON.stringify(businessModel),
      JSON.stringify(goalsAndTargets),
      JSON.stringify(definitions),
      updatedBy ?? 'onboarding',
    ]
  );

  return result.rows[0];
}
