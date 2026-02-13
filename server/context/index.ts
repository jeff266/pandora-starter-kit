import { query } from '../db.js';
import { differenceInDays, format } from 'date-fns';

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

/**
 * Data Freshness for File Import Workspaces
 *
 * Tracks data source, staleness, and entity availability for graceful skill degradation.
 */
export interface DataFreshness {
  source: 'file_import' | 'api_sync' | 'unknown';
  lastUpdated: string | null;
  daysSinceUpdate: number | null;
  isStale: boolean;
  hasDeals: boolean;
  hasContacts: boolean;
  hasAccounts: boolean;
  hasActivities: boolean;
  hasConversations: boolean;
  hasStageHistory: boolean;
  staleCaveat: string | null;
}

/**
 * Get data freshness information for a workspace
 */
export async function getDataFreshness(workspaceId: string): Promise<DataFreshness> {
  const importCheck = await query<{ created_at: string }>(
    'SELECT created_at FROM import_batches WHERE workspace_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
    [workspaceId, 'applied']
  );

  const connectionCheck = await query<{ source: string; last_sync_at: string }>(
    'SELECT source, last_sync_at FROM connections WHERE workspace_id = $1 ORDER BY last_sync_at DESC NULLS LAST LIMIT 1',
    [workspaceId]
  );

  let source: 'file_import' | 'api_sync' | 'unknown' = 'unknown';
  let lastUpdated: Date | null = null;

  const hasImport = importCheck.rows.length > 0;
  const hasConnection = connectionCheck.rows.length > 0;

  if (hasImport && hasConnection) {
    const importDate = new Date(importCheck.rows[0].created_at);
    const syncDate = new Date(connectionCheck.rows[0].last_sync_at);
    if (importDate > syncDate) {
      source = 'file_import';
      lastUpdated = importDate;
    } else {
      source = 'api_sync';
      lastUpdated = syncDate;
    }
  } else if (hasImport) {
    source = 'file_import';
    lastUpdated = new Date(importCheck.rows[0].created_at);
  } else if (hasConnection) {
    source = 'api_sync';
    lastUpdated = connectionCheck.rows[0].last_sync_at ? new Date(connectionCheck.rows[0].last_sync_at) : null;
  }

  const daysSinceUpdate = lastUpdated ? differenceInDays(new Date(), lastUpdated) : null;

  const entityCounts = await query<{
    deal_count: string;
    contact_count: string;
    account_count: string;
    activity_count: string;
    conversation_count: string;
    stage_history_count: string;
  }>(
    'SELECT (SELECT COUNT(*) FROM deals WHERE workspace_id = $1) as deal_count, (SELECT COUNT(*) FROM contacts WHERE workspace_id = $1) as contact_count, (SELECT COUNT(*) FROM accounts WHERE workspace_id = $1) as account_count, (SELECT COUNT(*) FROM activities WHERE workspace_id = $1) as activity_count, (SELECT COUNT(*) FROM conversations WHERE workspace_id = $1) as conversation_count, (SELECT COUNT(*) FROM deal_stage_history WHERE workspace_id = $1) as stage_history_count',
    [workspaceId]
  );

  const counts = entityCounts.rows[0];
  const isStale = source === 'file_import' && (daysSinceUpdate === null || daysSinceUpdate > 14);

  let staleCaveat: string | null = null;
  if (isStale && lastUpdated) {
    staleCaveat = 'Data was last imported ' + daysSinceUpdate + ' days ago (' + format(lastUpdated, 'MMM d, yyyy') + '). Insights may not reflect recent pipeline changes.';
  }

  return {
    source,
    lastUpdated: lastUpdated?.toISOString() || null,
    daysSinceUpdate,
    isStale,
    hasDeals: parseInt(counts.deal_count) > 0,
    hasContacts: parseInt(counts.contact_count) > 0,
    hasAccounts: parseInt(counts.account_count) > 0,
    hasActivities: parseInt(counts.activity_count) > 0,
    hasConversations: parseInt(counts.conversation_count) > 0,
    hasStageHistory: parseInt(counts.stage_history_count) > 0,
    staleCaveat,
  };
}
