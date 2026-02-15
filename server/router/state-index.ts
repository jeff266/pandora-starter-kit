/**
 * Workspace State Index
 *
 * The router's knowledge of what's available in a workspace:
 * - Which skills have fresh evidence vs. stale evidence
 * - What data sources are connected (CRM, conversation intelligence)
 * - Which deliverable templates can be produced right now
 *
 * Cached with 60-second TTL, invalidated on skill completion or data sync.
 */

import { query } from '../db.js';

export interface SkillState {
  skill_id: string;
  skill_name: string;
  last_run: string | null;           // ISO timestamp of last successful run
  has_evidence: boolean;
  is_stale: boolean;                  // Based on staleness thresholds
  claim_count: number;
  record_count: number;
  run_duration_ms: number | null;
}

export interface DataCoverage {
  crm_connected: boolean;
  crm_type: 'hubspot' | 'salesforce' | null;
  conversation_connected: boolean;
  conversation_source: 'gong' | 'fireflies' | null;
  deals_total: number;
  deals_closed_won: number;
  deals_closed_lost: number;
  contacts_total: number;
  reps_count: number;
  calls_synced: number;
  icp_profile_active: boolean;
  icp_profile_mode: 'descriptive' | 'point_based' | 'regression' | null;
  quotas_uploaded: boolean;
}

export interface TemplateReadiness {
  template_id: string;
  template_name: string;
  ready: boolean;
  missing_skills: string[];          // Skills that haven't run yet
  stale_skills: string[];            // Skills whose evidence is stale
  degraded_dimensions: string[];     // Dimensions that will be limited
  reason?: string;                   // Human-readable readiness explanation
}

export interface WorkspaceStateIndex {
  workspace_id: string;
  computed_at: string;               // ISO timestamp

  skill_states: Record<string, SkillState>;
  data_coverage: DataCoverage;
  template_readiness: Record<string, TemplateReadiness>;
}

// Staleness thresholds — evidence older than this should be refreshed
const STALENESS_THRESHOLDS_MS: Record<string, number> = {
  'pipeline-hygiene':             24 * 60 * 60 * 1000,    // 24 hours
  'single-thread-alert':          24 * 60 * 60 * 1000,
  'data-quality-audit':           7 * 24 * 60 * 60 * 1000, // 7 days
  'pipeline-coverage':            24 * 60 * 60 * 1000,
  'icp-discovery':                30 * 24 * 60 * 60 * 1000, // 30 days
  'lead-scoring':                 24 * 60 * 60 * 1000,
  'workspace-config-audit':       7 * 24 * 60 * 60 * 1000,
  'forecast-rollup':              24 * 60 * 60 * 1000,
  'conversation-intelligence':    7 * 24 * 60 * 60 * 1000,
  'pipeline-waterfall':           7 * 24 * 60 * 60 * 1000,
  'rep-scorecard':                7 * 24 * 60 * 60 * 1000,
  'deal-risk-review':             24 * 60 * 60 * 1000,
  'weekly-recap':                 7 * 24 * 60 * 60 * 1000,
  'custom-field-discovery':       30 * 24 * 60 * 60 * 1000,
  'contact-role-resolution':      7 * 24 * 60 * 60 * 1000,
  'bowtie-analysis':              7 * 24 * 60 * 60 * 1000,
  'pipeline-goals':               7 * 24 * 60 * 60 * 1000,
  'project-recap':                7 * 24 * 60 * 60 * 1000,
  'strategy-insights':            7 * 24 * 60 * 60 * 1000,
};

const DEFAULT_STALENESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days default

// Template requirements — which skills must have evidence for each template type
interface TemplateRequirement {
  template_id: string;
  template_name: string;
  required_skills: string[];       // Must have evidence (any age)
  preferred_skills: string[];      // Better with evidence, but not required
  freshness_critical: string[];    // These must not be stale
}

const TEMPLATE_REQUIREMENTS: TemplateRequirement[] = [
  {
    template_id: 'sales_process_map',
    template_name: 'Sales Process Map',
    required_skills: ['workspace-config-audit', 'pipeline-hygiene'],
    preferred_skills: ['pipeline-waterfall', 'icp-discovery', 'data-quality-audit'],
    freshness_critical: ['workspace-config-audit'],
  },
  {
    template_id: 'lead_scoring',
    template_name: 'Lead Scoring Report',
    required_skills: ['lead-scoring'],
    preferred_skills: ['icp-discovery'],
    freshness_critical: ['lead-scoring'],
  },
  {
    template_id: 'icp_profile',
    template_name: 'ICP Profile',
    required_skills: ['icp-discovery'],
    preferred_skills: [],
    freshness_critical: ['icp-discovery'],
  },
  {
    template_id: 'gtm_blueprint',
    template_name: 'GTM Blueprint',
    required_skills: ['workspace-config-audit', 'pipeline-hygiene', 'icp-discovery', 'lead-scoring'],
    preferred_skills: ['data-quality-audit', 'pipeline-waterfall'],
    freshness_critical: ['pipeline-hygiene', 'lead-scoring'],
  },
  {
    template_id: 'pipeline_audit',
    template_name: 'Pipeline Audit',
    required_skills: ['pipeline-hygiene', 'single-thread-alert', 'data-quality-audit'],
    preferred_skills: ['pipeline-coverage'],
    freshness_critical: ['pipeline-hygiene'],
  },
  {
    template_id: 'forecast_report',
    template_name: 'Forecast Report',
    required_skills: ['forecast-rollup'],
    preferred_skills: ['pipeline-hygiene', 'pipeline-coverage'],
    freshness_critical: ['forecast-rollup'],
  },
];

// Maps skills to the deliverable dimensions they enable
// Simplified version — Dimension Discovery provides the authoritative mapping
const SKILL_TO_DIMENSION_MAP: Record<string, string[]> = {
  'icp-discovery': ['PLG Signals', 'Channel/Partner', 'Team Selling'],
  'pipeline-waterfall': ['Typical Duration', 'Stage Regression'],
  'data-quality-audit': ['Closed Lost Capture'],
};

// In-memory cache with TTL
const stateCache = new Map<string, { state: WorkspaceStateIndex; expires: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute

export async function buildWorkspaceStateIndex(workspaceId: string): Promise<WorkspaceStateIndex> {
  const [skillStates, dataCoverage] = await Promise.all([
    buildSkillStates(workspaceId),
    buildDataCoverage(workspaceId),
  ]);

  const templateReadiness = buildTemplateReadiness(skillStates, dataCoverage);

  return {
    workspace_id: workspaceId,
    computed_at: new Date().toISOString(),
    skill_states: skillStates,
    data_coverage: dataCoverage,
    template_readiness: templateReadiness,
  };
}

async function buildSkillStates(workspaceId: string): Promise<Record<string, SkillState>> {
  // Get the most recent successful run for every skill in this workspace
  const runs = await query(`
    SELECT DISTINCT ON (skill_id)
      skill_id,
      completed_at,
      duration_ms,
      output
    FROM skill_runs
    WHERE workspace_id = $1
      AND status = 'completed'
      AND output IS NOT NULL
    ORDER BY skill_id, completed_at DESC
  `, [workspaceId]);

  // Build state for all known skills
  const knownSkillIds = Object.keys(STALENESS_THRESHOLDS_MS);
  const states: Record<string, SkillState> = {};

  for (const skillId of knownSkillIds) {
    const run = runs.rows.find((r: any) => r.skill_id === skillId);

    if (run) {
      const lastRun = new Date(run.completed_at);
      const threshold = STALENESS_THRESHOLDS_MS[skillId] || DEFAULT_STALENESS_MS;
      const isStale = (Date.now() - lastRun.getTime()) > threshold;

      // Count claims and records from evidence
      const evidence = run.output?.evidence;
      const claimCount = evidence?.claims?.length || 0;
      const recordCount = evidence?.evaluated_records?.length || 0;

      states[skillId] = {
        skill_id: skillId,
        skill_name: formatSkillName(skillId),
        last_run: run.completed_at,
        has_evidence: true,
        is_stale: isStale,
        claim_count: claimCount,
        record_count: recordCount,
        run_duration_ms: run.duration_ms,
      };
    } else {
      states[skillId] = {
        skill_id: skillId,
        skill_name: formatSkillName(skillId),
        last_run: null,
        has_evidence: false,
        is_stale: true,
        claim_count: 0,
        record_count: 0,
        run_duration_ms: null,
      };
    }
  }

  return states;
}

async function buildDataCoverage(workspaceId: string): Promise<DataCoverage> {
  // Check connected integrations
  const connectors = await query(`
    SELECT connector_name, status
    FROM connections
    WHERE workspace_id = $1 AND status = 'active'
  `, [workspaceId]);

  const crmConnector = connectors.rows.find(
    (c: any) => c.connector_name === 'hubspot' || c.connector_name === 'salesforce'
  );

  const convConnector = connectors.rows.find(
    (c: any) => c.connector_name === 'gong' || c.connector_name === 'fireflies'
  );

  // Get record counts
  const dealCounts = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE stage = 'Closed Won' OR stage ILIKE '%won%') as won,
      COUNT(*) FILTER (WHERE stage = 'Closed Lost' OR stage ILIKE '%lost%') as lost
    FROM deals
    WHERE workspace_id = $1
  `, [workspaceId]);

  const contactCount = await query(`
    SELECT COUNT(*) as total FROM contacts WHERE workspace_id = $1
  `, [workspaceId]);

  // Count distinct reps (deal owners)
  const repCount = await query(`
    SELECT COUNT(DISTINCT owner) as total
    FROM deals
    WHERE workspace_id = $1 AND owner IS NOT NULL
  `, [workspaceId]);

  // Count synced calls (if conversations table exists)
  const callCount = await query(`
    SELECT COUNT(*) as total FROM conversations WHERE workspace_id = $1
  `, [workspaceId]).catch(() => ({ rows: [{ total: 0 }] }));

  const row = dealCounts.rows[0] || { total: '0', won: '0', lost: '0' };

  return {
    crm_connected: !!crmConnector,
    crm_type: crmConnector?.connector_name || null,
    conversation_connected: !!convConnector,
    conversation_source: convConnector?.connector_name || null,
    deals_total: parseInt(row.total || '0', 10),
    deals_closed_won: parseInt(row.won || '0', 10),
    deals_closed_lost: parseInt(row.lost || '0', 10),
    contacts_total: parseInt(contactCount.rows[0]?.total || '0', 10),
    reps_count: parseInt(repCount.rows[0]?.total || '0', 10),
    calls_synced: parseInt(callCount.rows[0]?.total || '0', 10),
    icp_profile_active: false, // TODO: Check icp_profiles table when it exists
    icp_profile_mode: null,
    quotas_uploaded: false, // TODO: Check quotas table
  };
}

function buildTemplateReadiness(
  skillStates: Record<string, SkillState>,
  dataCoverage: DataCoverage
): Record<string, TemplateReadiness> {
  const readiness: Record<string, TemplateReadiness> = {};

  for (const template of TEMPLATE_REQUIREMENTS) {
    const missingSkills = template.required_skills.filter(
      s => !skillStates[s]?.has_evidence
    );

    const staleSkills = template.freshness_critical.filter(
      s => skillStates[s]?.is_stale
    );

    const degradedDimensions: string[] = [];
    for (const skillId of template.preferred_skills) {
      if (!skillStates[skillId]?.has_evidence) {
        const degraded = SKILL_TO_DIMENSION_MAP[skillId];
        if (degraded) degradedDimensions.push(...degraded);
      }
    }

    const ready = missingSkills.length === 0;

    let reason: string | undefined;
    if (!ready) {
      reason = `Missing required skills: ${missingSkills.join(', ')}. Run these skills first.`;
    } else if (staleSkills.length > 0) {
      reason = `Evidence is stale for: ${staleSkills.join(', ')}. Results may not reflect recent changes.`;
    } else if (degradedDimensions.length > 0) {
      reason = `Some dimensions will be limited: ${degradedDimensions.join(', ')}.`;
    }

    readiness[template.template_id] = {
      template_id: template.template_id,
      template_name: template.template_name,
      ready,
      missing_skills: missingSkills,
      stale_skills: staleSkills,
      degraded_dimensions: Array.from(new Set(degradedDimensions)),
      reason,
    };
  }

  return readiness;
}

function formatSkillName(skillId: string): string {
  return skillId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export async function getWorkspaceState(workspaceId: string): Promise<WorkspaceStateIndex> {
  const cached = stateCache.get(workspaceId);
  if (cached && cached.expires > Date.now()) {
    return cached.state;
  }

  const state = await buildWorkspaceStateIndex(workspaceId);
  stateCache.set(workspaceId, { state, expires: Date.now() + CACHE_TTL_MS });
  return state;
}

/**
 * Invalidate cache when a skill runs or data syncs
 */
export function invalidateStateCache(workspaceId: string): void {
  stateCache.delete(workspaceId);
}
