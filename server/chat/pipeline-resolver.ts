/**
 * Pipeline Resolver
 *
 * Workspace-aware resolution of natural language pipeline names to canonical
 * analysis_scopes entries. Used by queryDeals and computeMetric to replace
 * open-ended ILIKE matching with exact scope-based filtering.
 *
 * Also provides intent classification and default pipeline resolution for
 * unscoped questions, and pipeline defaults storage in context_layer.
 */

import { query } from '../db.js';

// ============================================================================
// Types
// ============================================================================

export interface ResolvedPipeline {
  scope_id: string;
  name: string;
  confirmed: boolean;
  filter_field: string;
  filter_operator: string;
  filter_values: string[];
}

export interface PipelineDefaults {
  quota_bearing_scope_ids: string[];
  primary_scope_id: string | null;
  intent_defaults: {
    attainment: 'primary' | 'quota_bearing' | 'all';
    coverage: 'primary' | 'quota_bearing' | 'all';
    deal_lookup: 'primary' | 'quota_bearing' | 'all';
    activity: 'all';
    rep_scoped: 'owner_only';
    unspecified: 'primary' | 'quota_bearing' | 'all';
  };
  needs_configuration?: boolean;
}

export interface PipelineResolution {
  scope_ids: string[] | null;
  owner_only: boolean;
  mode: 'explicit' | 'defaulted' | 'all' | 'owner_only';
  assumption_label: string;
  assumption_made: boolean;
}

export type QuestionIntent =
  | 'attainment'
  | 'coverage'
  | 'rep_scoped'
  | 'deal_lookup'
  | 'activity'
  | 'unspecified';

// ============================================================================
// Helpers
// ============================================================================

const normalize = (s: string): string =>
  s.toLowerCase()
    .replace(/\bpipeline\b/gi, '')
    .replace(/[-_]+/g, ' ')
    .trim();

// ============================================================================
// resolvePipelineName
// ============================================================================

/**
 * Resolve a natural-language pipeline name to a canonical analysis_scope row.
 *
 * Match priority (first wins):
 *   1. Exact normalized match
 *   2. Normalized user input is substring of normalized scope name
 *   3. Normalized scope name is substring of normalized user input
 *
 * Among ties at the same priority level, confirmed=true scopes win.
 * Returns null if no match found.
 */
export async function resolvePipelineName(
  workspaceId: string,
  userInput: string
): Promise<ResolvedPipeline | null> {
  let rows: Array<{
    scope_id: string;
    name: string;
    confirmed: boolean;
    filter_field: string;
    filter_operator: string;
    filter_values: string[];
  }>;

  try {
    const result = await query<{
      scope_id: string;
      name: string;
      confirmed: boolean;
      filter_field: string;
      filter_operator: string;
      filter_values: string[];
    }>(
      `SELECT scope_id, name, confirmed, filter_field, filter_operator, filter_values
       FROM analysis_scopes
       WHERE workspace_id = $1
         AND scope_id != 'default'
       ORDER BY confirmed DESC, created_at ASC`,
      [workspaceId]
    );
    rows = result.rows;
  } catch (_err) {
    return null;
  }

  if (rows.length === 0) return null;

  const normalizedInput = normalize(userInput);

  // Priority 1: exact normalized match
  const exactMatches = rows.filter(r => normalize(r.name) === normalizedInput);
  if (exactMatches.length > 0) {
    const confirmed = exactMatches.find(r => r.confirmed);
    return confirmed ?? exactMatches[0];
  }

  // Priority 2: user input is substring of scope name
  const inputInNameMatches = rows.filter(r =>
    normalize(r.name).includes(normalizedInput) && normalizedInput.length > 0
  );
  if (inputInNameMatches.length > 0) {
    const confirmed = inputInNameMatches.find(r => r.confirmed);
    return confirmed ?? inputInNameMatches[0];
  }

  // Priority 3: scope name is substring of user input
  const nameInInputMatches = rows.filter(r => {
    const nName = normalize(r.name);
    return nName.length > 0 && normalizedInput.includes(nName);
  });
  if (nameInInputMatches.length > 0) {
    const confirmed = nameInInputMatches.find(r => r.confirmed);
    return confirmed ?? nameInInputMatches[0];
  }

  return null;
}

// ============================================================================
// getWorkspacePipelineNames
// ============================================================================

/**
 * Return confirmed pipeline names for a workspace.
 * Used for dynamic tool description injection and default resolution.
 */
export async function getWorkspacePipelineNames(
  workspaceId: string
): Promise<Array<{ scope_id: string; name: string }>> {
  try {
    const result = await query<{ scope_id: string; name: string }>(
      `SELECT scope_id, name
       FROM analysis_scopes
       WHERE workspace_id = $1
         AND scope_id != 'default'
         AND confirmed = true
       ORDER BY created_at ASC`,
      [workspaceId]
    );
    return result.rows;
  } catch (_err) {
    return [];
  }
}

// ============================================================================
// getPipelineDefaults / upsertPipelineDefaults
// ============================================================================

/**
 * Load pipeline default config from context_layer.definitions->'workspace_config'->'pipeline_defaults'.
 * Returns null if not yet configured.
 */
export async function getPipelineDefaults(
  workspaceId: string
): Promise<PipelineDefaults | null> {
  try {
    const result = await query<{ pipeline_defaults: any }>(
      `SELECT definitions->'workspace_config'->'pipeline_defaults' AS pipeline_defaults
       FROM context_layer
       WHERE workspace_id = $1
       LIMIT 1`,
      [workspaceId]
    );
    const raw = result.rows[0]?.pipeline_defaults;
    if (!raw || typeof raw !== 'object') return null;
    return raw as PipelineDefaults;
  } catch (_err) {
    return null;
  }
}

/**
 * Persist pipeline defaults into context_layer JSONB.
 * Safe to call on workspaces that may not yet have a context_layer row.
 */
export async function upsertPipelineDefaults(
  workspaceId: string,
  defaults: PipelineDefaults
): Promise<void> {
  const defaultsJson = JSON.stringify(defaults);
  await query(
    `INSERT INTO context_layer (workspace_id, definitions)
       VALUES ($1, jsonb_build_object('workspace_config', jsonb_build_object('pipeline_defaults', $2::jsonb)))
     ON CONFLICT (workspace_id) DO UPDATE
       SET definitions = jsonb_set(
         COALESCE(context_layer.definitions, '{}'),
         '{workspace_config,pipeline_defaults}',
         $2::jsonb,
         true
       ),
       updated_at = now()`,
    [workspaceId, defaultsJson]
  );
}

// ============================================================================
// autoConfigurePipelineDefaults
// ============================================================================

/**
 * Called after CRM sync scope inference to auto-populate pipeline defaults.
 * - Single pipeline workspace: sets it as primary and quota-bearing automatically.
 * - Multi-pipeline workspace: sets safe 'all' fallbacks and flags needs_configuration=true.
 *
 * No-op if already configured (needs_configuration is absent or false).
 */
export async function autoConfigurePipelineDefaults(
  workspaceId: string
): Promise<void> {
  try {
    const existing = await getPipelineDefaults(workspaceId);
    if (existing && !existing.needs_configuration) return;

    const scopes = await getWorkspacePipelineNames(workspaceId);
    if (scopes.length === 0) return;

    if (scopes.length === 1) {
      await upsertPipelineDefaults(workspaceId, {
        quota_bearing_scope_ids: [scopes[0].scope_id],
        primary_scope_id: scopes[0].scope_id,
        intent_defaults: {
          attainment: 'primary',
          coverage: 'primary',
          deal_lookup: 'primary',
          activity: 'all',
          rep_scoped: 'owner_only',
          unspecified: 'primary',
        },
      });
      console.log(`[PipelineResolver] Auto-configured single pipeline default: ${scopes[0].name} (${workspaceId})`);
    } else {
      await upsertPipelineDefaults(workspaceId, {
        quota_bearing_scope_ids: [],
        primary_scope_id: null,
        intent_defaults: {
          attainment: 'all',
          coverage: 'all',
          deal_lookup: 'all',
          activity: 'all',
          rep_scoped: 'owner_only',
          unspecified: 'all',
        },
        needs_configuration: true,
      });
      console.log(`[PipelineResolver] Multi-pipeline workspace flagged for configuration: ${scopes.length} pipelines (${workspaceId})`);
    }
  } catch (err) {
    console.warn(`[PipelineResolver] autoConfigurePipelineDefaults failed (non-fatal):`, err);
  }
}

// ============================================================================
// Intent classifier
// ============================================================================

const INTENT_PATTERNS: Record<Exclude<QuestionIntent, 'unspecified'>, RegExp[]> = {
  attainment: [
    /attainment/i,
    /on track/i,
    /\bquota\b/i,
    /\btarget\b/i,
    /gap to/i,
    /close the gap/i,
    /hit (the |our )?number/i,
    /against (goal|plan|target)/i,
  ],
  coverage: [
    /coverage/i,
    /pipeline.*rep/i,
    /rep.*pipeline/i,
    /who has enough/i,
    /pipeline.*ratio/i,
    /\d+x pipeline/i,
  ],
  rep_scoped: [
    /\bmy\b/i,
    /\bmine\b/i,
    /my deals/i,
    /my pipeline/i,
    /how am i/i,
    /my quota/i,
    /my book/i,
    /my number/i,
  ],
  deal_lookup: [
    /tell me about/i,
    /status of/i,
    /what.*happened.*with/i,
    /update on/i,
  ],
  activity: [
    /what closed/i,
    /what.*won/i,
    /all pipeline/i,
    /full funnel/i,
    /everything in/i,
    /total pipeline/i,
    /across (all|every)/i,
    /show (me )?all/i,
  ],
};

export function classifyQuestionIntent(message: string): QuestionIntent {
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as [
    Exclude<QuestionIntent, 'unspecified'>,
    RegExp[]
  ][]) {
    if (patterns.some(p => p.test(message))) return intent;
  }
  return 'unspecified';
}

// ============================================================================
// resolveDefaultPipeline
// ============================================================================

async function getScopeName(workspaceId: string, scopeId: string): Promise<string> {
  try {
    const result = await query<{ name: string }>(
      `SELECT name FROM analysis_scopes WHERE workspace_id = $1 AND scope_id = $2 LIMIT 1`,
      [workspaceId, scopeId]
    );
    return result.rows[0]?.name ?? scopeId;
  } catch (_err) {
    return scopeId;
  }
}

async function getScopeNames(workspaceId: string, scopeIds: string[]): Promise<string[]> {
  if (scopeIds.length === 0) return [];
  const names = await Promise.all(scopeIds.map(id => getScopeName(workspaceId, id)));
  return names;
}

/**
 * Resolve the pipeline scope(s) to apply when the user did NOT name a pipeline.
 *
 * Decision tree:
 *   1. Rep role or rep_scoped intent → owner-only (no pipeline filter)
 *   2. Activity intent → all pipelines
 *   3. Load PipelineDefaults from context_layer
 *   4. No defaults configured → single scope if only one exists, else all
 *   5. Multi-pipeline: use intent_defaults to pick primary/quota_bearing/all
 */
export async function resolveDefaultPipeline(
  workspaceId: string,
  intent: QuestionIntent,
  userRole: 'admin' | 'manager' | 'rep' | 'analyst' | 'viewer' | 'member',
  _requestingUserId: string
): Promise<PipelineResolution> {
  if (userRole === 'rep' || intent === 'rep_scoped') {
    return {
      scope_ids: null,
      owner_only: true,
      mode: 'owner_only',
      assumption_label: 'your deals',
      assumption_made: false,
    };
  }

  if (intent === 'activity') {
    return {
      scope_ids: null,
      owner_only: false,
      mode: 'all',
      assumption_label: 'all pipelines',
      assumption_made: true,
    };
  }

  const allScopes = await getWorkspacePipelineNames(workspaceId);

  // Single-pipeline workspace — always use it, no assumption ambiguity
  if (allScopes.length === 1) {
    return {
      scope_ids: [allScopes[0].scope_id],
      owner_only: false,
      mode: 'defaulted',
      assumption_label: allScopes[0].name,
      assumption_made: false,
    };
  }

  const defaults = await getPipelineDefaults(workspaceId);

  if (!defaults || !defaults.primary_scope_id) {
    return {
      scope_ids: null,
      owner_only: false,
      mode: 'all',
      assumption_label: allScopes.length > 1 ? 'all pipelines (configure defaults for smarter scoping)' : 'all pipelines',
      assumption_made: true,
    };
  }

  const intentDefault = defaults.intent_defaults[intent] ?? defaults.intent_defaults.unspecified;

  if (intentDefault === 'quota_bearing' && defaults.quota_bearing_scope_ids.length > 0) {
    const scopeNames = await getScopeNames(workspaceId, defaults.quota_bearing_scope_ids);
    return {
      scope_ids: defaults.quota_bearing_scope_ids,
      owner_only: false,
      mode: 'defaulted',
      assumption_label:
        scopeNames.length === 1
          ? `${scopeNames[0]} (quota-bearing)`
          : `quota-bearing pipelines (${scopeNames.join(', ')})`,
      assumption_made: true,
    };
  }

  if (intentDefault === 'primary') {
    const primaryName = await getScopeName(workspaceId, defaults.primary_scope_id);
    return {
      scope_ids: [defaults.primary_scope_id],
      owner_only: false,
      mode: 'defaulted',
      assumption_label: `${primaryName} (default)`,
      assumption_made: true,
    };
  }

  return {
    scope_ids: null,
    owner_only: false,
    mode: 'all',
    assumption_label: 'all pipelines',
    assumption_made: true,
  };
}
