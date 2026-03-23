/**
 * Workspace Config Loader
 *
 * Central utility for loading workspace-specific configuration.
 * Skills import this instead of hardcoding assumptions.
 */

import { query } from '../db.js';
import type {
  WorkspaceConfig,
  PipelineConfig,
  WinRateResult,
  QuotaPeriodResult,
  VoiceConfig,
  VoiceModifierConfig,
  NamedFilter,
} from '../types/workspace-config.js';
import { buildVoicePromptBlock } from './voice-prompt-block.js';
import type { VoiceProfile } from '../voice/types.js';
import { DEFAULT_VOICE_PROFILE } from '../voice/types.js';
import type { WorkspaceDocumentProfile, SectionPreferences } from '../types/document-profile.js';
import { DEFAULT_DOCUMENT_PROFILE } from '../types/document-profile.js';

/**
 * Default voice configuration for new workspaces
 */
export const DEFAULT_VOICE_CONFIG: VoiceConfig & VoiceModifierConfig = {
  // Legacy fields
  detail_level: 'standard',
  framing: 'balanced',
  alert_threshold: 'watch_and_act',
  // VoiceProfile fields
  persona: 'teammate',
  ownership_pronoun: 'we',
  directness: 'direct',
  name_entities: true,
  celebrate_wins: true,
  surface_uncertainty: true,
  temporal_awareness: 'both',
};

/**
 * Workspace Configuration Loader
 *
 * Provides convenience methods for skills to access workspace settings
 * without hardcoding values.
 */
export class WorkspaceConfigLoader {
  /** Cache configs for the duration of a skill/agent run */
  private cache: Map<string, WorkspaceConfig> = new Map();

  /**
   * Get workspace configuration (cached)
   */
  async getConfig(workspaceId: string): Promise<WorkspaceConfig> {
    if (this.cache.has(workspaceId)) {
      return this.cache.get(workspaceId)!;
    }

    const result = await query<{ workspace_config: WorkspaceConfig }>(
      `SELECT definitions->'workspace_config' as workspace_config
       FROM context_layer
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    const stored = result.rows[0]?.workspace_config;
    const config = stored || this.getDefaults(workspaceId);

    if (stored && !config.named_filters) {
      config.named_filters = WorkspaceConfigLoader.getDefaultNamedFilters();
    }

    this.cache.set(workspaceId, config);
    return config;
  }

  /**
   * Clear cache for a workspace (call after config updates)
   */
  clearCache(workspaceId?: string): void {
    if (workspaceId) {
      this.cache.delete(workspaceId);
    } else {
      this.cache.clear();
    }
  }

  // ===== WIN RATE =====

  /**
   * Calculate win rate using workspace configuration
   */
  async getWinRate(
    workspaceId: string,
    options?: {
      pipeline?: string;
      period_months?: number;
    }
  ): Promise<WinRateResult> {
    const config = await this.getConfig(workspaceId);
    const wr = config.win_rate;

    const lookbackMonths = options?.period_months || wr.lookback_months;

    let queryText = `
      SELECT
        COUNT(*) FILTER (
          WHERE stage_normalized = ANY($2)
        )::int as won,
        COUNT(*) FILTER (
          WHERE stage_normalized = ANY($3)
        )::int as lost,
        COUNT(*)::int as total_closed
      FROM deals
      WHERE workspace_id = $1
        AND close_date >= NOW() - INTERVAL '${lookbackMonths} months'
    `;

    const params: any[] = [
      workspaceId,
      wr.won_values,
      wr.lost_values,
    ];

    // Exclude certain values from denominator
    if (wr.excluded_values && wr.excluded_values.length > 0) {
      queryText += ` AND stage_normalized NOT IN (SELECT UNNEST($${params.length + 1}::text[]))`;
      params.push(wr.excluded_values);
    }

    // Apply minimum stage filter (requires deal_stage_history)
    if (wr.minimum_stage) {
      queryText += `
        AND id IN (
          SELECT DISTINCT deal_id FROM deal_stage_history
          WHERE workspace_id = $1
            AND stage_normalized = $${params.length + 1}
        )
      `;
      params.push(wr.minimum_stage);
    }

    // Apply pipeline filter
    if (options?.pipeline) {
      const pipelineConfig = config.pipelines.find(
        (p) => p.id === options.pipeline
      );
      if (pipelineConfig) {
        queryText += ` AND ${pipelineConfig.filter.field} = ANY($${params.length + 1}::text[])`;
        params.push(pipelineConfig.filter.values);
      }
    }

    const result = await query<{
      won: number;
      lost: number;
      total_closed: number;
    }>(queryText, params);

    const row = result.rows[0];
    const won = parseInt(String(row?.won || 0), 10);
    const lost = parseInt(String(row?.lost || 0), 10);
    const totalClosed = parseInt(String(row?.total_closed || 0), 10);

    return {
      won,
      lost,
      excluded: totalClosed - won - lost,
      rate: won / Math.max(won + lost, 1),
      pipeline: options?.pipeline || 'all',
      lookback_months: lookbackMonths,
      minimum_stage: wr.minimum_stage || null,
    };
  }

  // ===== STALE THRESHOLDS =====

  /**
   * Get stale deal thresholds for a pipeline
   */
  async getStaleThreshold(
    workspaceId: string,
    pipeline?: string
  ): Promise<{ warning: number; critical: number }> {
    const config = await this.getConfig(workspaceId);
    const t = config.thresholds;

    if (!t) return { warning: 7, critical: 21 };

    const warning =
      typeof t.stale_deal_days === 'number'
        ? t.stale_deal_days
        : t.stale_deal_days?.[pipeline || 'default'] ?? 7;

    const critical =
      typeof t.critical_stale_days === 'number'
        ? t.critical_stale_days
        : t.critical_stale_days?.[pipeline || 'default'] ?? 21;

    return { warning, critical };
  }

  // ===== COVERAGE TARGET =====

  /**
   * Get pipeline coverage target
   */
  async getCoverageTarget(
    workspaceId: string,
    pipeline?: string
  ): Promise<number> {
    const config = await this.getConfig(workspaceId);
    const t = config.thresholds;

    // Canonical lookup chain for workspace config reads:
    //   1. Primary path   — the authoritative location (e.g. thresholds.coverage_target)
    //   2. Fallback path  — legacy or alternate location (e.g. goals_and_targets.pipeline_coverage_target)
    //   3. Hardcoded default — always present, never throws
    // Follow this pattern for all workspace config reads so skills degrade
    // gracefully on workspaces that haven't completed onboarding.
    if (!t || t.coverage_target === undefined || t.coverage_target === null) {
      return (config as any)?.goals_and_targets?.pipeline_coverage_target ?? 3.0;
    }

    return typeof t.coverage_target === 'number'
      ? t.coverage_target
      : t.coverage_target?.[pipeline || 'default'] ?? 3.0;
  }

  // ===== PIPELINE SCOPE =====

  /**
   * Get active pipelines (included in default scope)
   */
  async getActivePipelines(
    workspaceId: string
  ): Promise<PipelineConfig[]> {
    const config = await this.getConfig(workspaceId);
    return config.pipelines.filter((p) => p.included_in_default_scope);
  }

  /**
   * Get SQL WHERE clause to scope deals to pipeline(s)
   *
   * Example: "AND pipeline = ANY(ARRAY['New Business', 'Renewals'])"
   */
  async getPipelineScopeFilter(
    workspaceId: string,
    pipeline?: string
  ): Promise<string> {
    const config = await this.getConfig(workspaceId);

    if (pipeline) {
      const p = config.pipelines.find((pc) => pc.id === pipeline);
      if (p) {
        const values = p.filter.values
          .map((v) => `'${v.replace(/'/g, "''")}'`)
          .join(',');
        return `AND ${p.filter.field} = ANY(ARRAY[${values}])`;
      }
    }

    // Default: include only "in scope" pipelines
    const activePipelines = config.pipelines.filter(
      (p) => p.included_in_default_scope
    );

    if (activePipelines.length === 0) {
      return ''; // no filter = all deals
    }

    if (activePipelines.length === 1) {
      const p = activePipelines[0];
      const values = p.filter.values
        .map((v) => `'${v.replace(/'/g, "''")}'`)
        .join(',');
      return `AND ${p.filter.field} = ANY(ARRAY[${values}])`;
    }

    // Multiple pipelines
    const clauses = activePipelines.map((p) => {
      const values = p.filter.values
        .map((v) => `'${v.replace(/'/g, "''")}'`)
        .join(',');
      return `${p.filter.field} = ANY(ARRAY[${values}])`;
    });

    return `AND (${clauses.join(' OR ')})`;
  }

  // ===== REPS / TEAM =====

  /**
   * Get list of reps, optionally filtered by role
   */
  async getReps(workspaceId: string, role?: string): Promise<string[]> {
    const config = await this.getConfig(workspaceId);
    const excluded = new Set(config.teams.excluded_owners);

    if (role) {
      const r = config.teams.roles.find((tr) => tr.id === role);
      return r?.members.filter((m) => !excluded.has(m)) || [];
    }

    // All reps minus excluded
    const allMembers = config.teams.roles.flatMap((r) => r.members);
    return [...new Set(allMembers)].filter((m) => !excluded.has(m));
  }

  /**
   * Get rep field name
   */
  async getRepField(workspaceId: string): Promise<string> {
    const config = await this.getConfig(workspaceId);
    return config.teams.rep_field;
  }

  // ===== ACTIVITIES =====

  /**
   * Get activity engagement weights
   */
  async getActivityWeights(
    workspaceId: string
  ): Promise<Record<string, number>> {
    const config = await this.getConfig(workspaceId);
    return config.activities.engagement_weights;
  }

  /**
   * Get minimum activities threshold
   */
  async getMinimumActivitiesForActive(
    workspaceId: string
  ): Promise<number> {
    const config = await this.getConfig(workspaceId);
    return config.activities.minimum_activities_for_active;
  }

  // ===== REQUIRED FIELDS =====

  /**
   * Get required fields for an object/pipeline/stage
   */
  async getRequiredFields(
    workspaceId: string,
    object: 'deals' | 'contacts' | 'leads' | 'accounts',
    pipeline?: string,
    stage?: string
  ): Promise<string[]> {
    const config = await this.getConfig(workspaceId);
    return config.thresholds.required_fields
      .filter(
        (f) =>
          f.object === object &&
          (!f.pipeline || f.pipeline === pipeline) &&
          (!f.stage_after || !stage || stage >= f.stage_after)
      )
      .map((f) => f.field);
  }

  // ===== QUOTA PERIOD =====

  /**
   * Get current quota period info
   */
  async getQuotaPeriod(workspaceId: string): Promise<QuotaPeriodResult> {
    const config = await this.getConfig(workspaceId);
    const c = config.cadence;

    const now = new Date();
    let periodStart: Date, periodEnd: Date;

    if (c.quota_period === 'monthly') {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (c.quota_period === 'quarterly') {
      // Adjust for fiscal year start
      const fiscalMonth =
        (now.getMonth() - (c.fiscal_year_start_month - 1) + 12) % 12;
      const quarterStart = Math.floor(fiscalMonth / 3) * 3;
      const calendarMonth =
        (quarterStart + c.fiscal_year_start_month - 1) % 12;
      periodStart = new Date(now.getFullYear(), calendarMonth, 1);
      periodEnd = new Date(now.getFullYear(), calendarMonth + 3, 0);
    } else {
      // Annual
      periodStart = new Date(
        now.getFullYear(),
        c.fiscal_year_start_month - 1,
        1
      );
      periodEnd = new Date(
        now.getFullYear() + 1,
        c.fiscal_year_start_month - 1,
        0
      );
    }

    const daysRemaining = Math.ceil(
      (periodEnd.getTime() - now.getTime()) / 86400000
    );

    return {
      type: c.quota_period,
      start: periodStart,
      end: periodEnd,
      days_remaining: daysRemaining,
    };
  }

  // ===== THREADING THRESHOLD =====

  /**
   * Get minimum contacts per deal (single-threading alert)
   */
  async getMinimumContactsPerDeal(workspaceId: string): Promise<number> {
    const config = await this.getConfig(workspaceId);
    return config.thresholds.minimum_contacts_per_deal;
  }

  /**
   * Get threading distinctness rule
   */
  async getThreadingDistinctRule(
    workspaceId: string
  ): Promise<'department' | 'role' | 'seniority' | 'none'> {
    const config = await this.getConfig(workspaceId);
    return config.thresholds.threading_requires_distinct || 'none';
  }

  // ===== DEFAULTS =====

  /**
   * Get default configuration for a workspace
   */
  private getDefaults(workspaceId: string): WorkspaceConfig {
    return {
      workspace_id: workspaceId,
      pipelines: [
        {
          id: 'default',
          name: 'All Deals',
          type: 'new_business',
          filter: { field: '1', values: ['1'] }, // always true
          coverage_target: 3.0,
          stage_probabilities: {},
          loss_values: ['closed_lost'],
          included_in_default_scope: true,
          value_field: 'amount',
          forecast_eligible: true,
        },
      ],
      win_rate: {
        won_values: ['closed_won'],
        lost_values: ['closed_lost'],
        excluded_values: [],
        lookback_months: 6,
      },
      teams: {
        rep_field: 'owner_email',
        roles: [],
        groups: [],
        excluded_owners: [],
      },
      activities: {
        tracked_types: [],
        engagement_weights: {
          meeting: 10,
          call: 5,
          email: 2,
          note: 1,
        },
        exclude_internal: false,
        internal_domains: [],
        minimum_activities_for_active: 1,
      },
      cadence: {
        quota_period: 'monthly',
        fiscal_year_start_month: 1,
        planning_cadence: 'weekly',
        week_start_day: 1,
        timezone: 'America/New_York',
      },
      thresholds: {
        stale_deal_days: 14,
        critical_stale_days: 30,
        coverage_target: 3.0,
        minimum_contacts_per_deal: 2,
        required_fields: [
          { field: 'amount', object: 'deals' },
          { field: 'close_date', object: 'deals' },
        ],
      },
      scoring: {
        icp_dimensions: [],
        scoring_model: 'auto',
      },
      voice: {
        ...DEFAULT_VOICE_CONFIG,
      },
      named_filters: WorkspaceConfigLoader.getDefaultNamedFilters(),
      updated_at: new Date(),
      confirmed: false,
      document_profile: DEFAULT_DOCUMENT_PROFILE,
    };
  }

  static getDefaultNamedFilters(): NamedFilter[] {
    const now = new Date().toISOString();
    return [
      {
        id: 'open_pipeline',
        label: 'Open Pipeline',
        description: 'All currently open deals not in terminal stages',
        object: 'deals',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'stage_normalized', operator: 'not_in', value: ['closed_won', 'closed_lost'] },
          ],
        },
        source: 'default',
        confidence: 1.0,
        confirmed: true,
        created_at: now,
        updated_at: now,
        created_by: 'system',
      },
      {
        id: 'new_logo',
        label: 'New Logo Deal',
        description: 'Open deals at accounts with no prior closed-won deals',
        object: 'deals',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'stage_normalized', operator: 'not_in', value: ['closed_won', 'closed_lost'] },
            {
              field: '*',
              operator: 'eq',
              value: 0,
              cross_object: {
                target_object: 'deals',
                join_field: 'account_id',
                aggregate: 'count',
                where: "stage_normalized = 'closed_won'",
              },
            },
          ],
        },
        source: 'default',
        confidence: 0.8,
        confirmed: false,
        created_at: now,
        updated_at: now,
        created_by: 'system',
      },
      {
        id: 'stale_deal',
        label: 'Stale Deal',
        description: 'Open deals with no activity beyond the workspace stale threshold',
        object: 'deals',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'stage_normalized', operator: 'not_in', value: ['closed_won', 'closed_lost'] },
            { field: 'days_in_stage', operator: 'gte', value: 14 },
          ],
        },
        source: 'default',
        confidence: 0.8,
        confirmed: false,
        created_at: now,
        updated_at: now,
        created_by: 'system',
      },
      {
        id: 'closing_this_quarter',
        label: 'Closing This Quarter',
        description: 'Open deals with close dates in the current quarter',
        object: 'deals',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'stage_normalized', operator: 'not_in', value: ['closed_won', 'closed_lost'] },
            { field: 'close_date', operator: 'relative_date', value: { type: 'relative', unit: 'quarters', offset: 0, anchor: 'period_end' } },
          ],
        },
        source: 'default',
        confidence: 0.9,
        confirmed: true,
        created_at: now,
        updated_at: now,
        created_by: 'system',
      },
      {
        id: 'at_risk',
        label: 'At-Risk Deal',
        description: 'Deals flagged with high risk scores or stale activity',
        object: 'deals',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'stage_normalized', operator: 'not_in', value: ['closed_won', 'closed_lost'] },
            { field: 'deal_risk', operator: 'gte', value: 70 },
          ],
        },
        source: 'default',
        confidence: 0.85,
        confirmed: false,
        created_at: now,
        updated_at: now,
        created_by: 'system',
      },
    ];
  }

  async getVoiceConfig(workspaceId: string): Promise<VoiceConfig & VoiceModifierConfig> {
    const config = await this.getConfig(workspaceId);
    return (config.voice || DEFAULT_VOICE_CONFIG) as VoiceConfig & VoiceModifierConfig;
  }

  /**
   * Get voice profile for a workspace (maps modifier config to profile)
   */
  async getVoiceProfile(workspaceId: string): Promise<VoiceProfile> {
    const voice = await this.getVoiceConfig(workspaceId);

    const profile: VoiceProfile = {
      persona: voice.persona || DEFAULT_VOICE_PROFILE.persona,
      ownership_pronoun: voice.ownership_pronoun || DEFAULT_VOICE_PROFILE.ownership_pronoun,
      directness: voice.directness || DEFAULT_VOICE_PROFILE.directness,
      detail_level: (voice.detail_level as any) || DEFAULT_VOICE_PROFILE.detail_level,
      name_entities: voice.name_entities !== undefined ? voice.name_entities : DEFAULT_VOICE_PROFILE.name_entities,
      celebrate_wins: voice.celebrate_wins !== undefined ? voice.celebrate_wins : DEFAULT_VOICE_PROFILE.celebrate_wins,
      surface_uncertainty: voice.surface_uncertainty !== undefined ? voice.surface_uncertainty : DEFAULT_VOICE_PROFILE.surface_uncertainty,
      temporal_awareness: voice.temporal_awareness || DEFAULT_VOICE_PROFILE.temporal_awareness,
    };

    // Apply anonymize mode
    if (voice.anonymize_mode) {
      profile.name_entities = false;
    }

    return profile;
  }

  /**
   * Update voice configuration for a workspace
   */
  async updateVoiceConfig(
    workspaceId: string,
    partial: Partial<VoiceModifierConfig & VoiceConfig>
  ): Promise<VoiceConfig & VoiceModifierConfig> {
    const currentConfig = await this.getConfig(workspaceId);
    const updatedVoice = {
      ...(currentConfig.voice || DEFAULT_VOICE_CONFIG),
      ...partial,
    };

    await query(
      `UPDATE context_layer
       SET definitions = jsonb_set(definitions, '{workspace_config,voice}', $2::jsonb, true),
           updated_at = NOW()
       WHERE workspace_id = $1`,
      [workspaceId, JSON.stringify(updatedVoice)]
    );

    this.clearCache(workspaceId);
    return updatedVoice as VoiceConfig & VoiceModifierConfig;
  }

  // ===== DOCUMENT PROFILE =====

  /**
   * Get document profile for a workspace
   */
  async getDocumentProfile(workspaceId: string): Promise<WorkspaceDocumentProfile> {
    const config = await this.getConfig(workspaceId);
    return config.document_profile || DEFAULT_DOCUMENT_PROFILE;
  }

  /**
   * Update document profile for a workspace (deep merge via jsonb_set)
   */
  async updateDocumentProfile(
    workspaceId: string,
    partial: Partial<WorkspaceDocumentProfile>
  ): Promise<WorkspaceDocumentProfile> {
    const currentProfile = await this.getDocumentProfile(workspaceId);
    const updatedProfile = {
      ...currentProfile,
      ...partial,
      // Handle nested merges if necessary, though document_profile structure is mostly top-level keys
      calibration: {
        ...currentProfile.calibration,
        ...(partial.calibration || {}),
      },
      qualityScores: {
        ...currentProfile.qualityScores,
        ...(partial.qualityScores || {}),
      },
      distributionPatterns: {
        ...currentProfile.distributionPatterns,
        ...(partial.distributionPatterns || {}),
      },
    };

    await query(
      `UPDATE context_layer
       SET definitions = jsonb_set(definitions, '{workspace_config,document_profile}', $2::jsonb, true),
           updated_at = NOW()
       WHERE workspace_id = $1`,
      [workspaceId, JSON.stringify(updatedProfile)]
    );

    this.clearCache(workspaceId);
    return updatedProfile;
  }

  /**
   * Get preferences for a specific section
   */
  async getSectionPreferences(
    workspaceId: string,
    templateType: string,
    sectionId: string
  ): Promise<SectionPreferences | null> {
    const profile = await this.getDocumentProfile(workspaceId);
    const key = `${templateType}:${sectionId}`;
    return profile.sectionPreferences[key] || null;
  }

  // ===== PIPELINE VALUE & FORECAST ELIGIBILITY =====

  /**
   * Returns only pipelines eligible for quota/forecast math.
   * Skills use this to scope coverage ratio, attainment %,
   * and forecast rollup calculations.
   */
  async getForecastPipelines(workspaceId: string): Promise<PipelineConfig[]> {
    const config = await this.getConfig(workspaceId);
    return config.pipelines.filter(
      p => p.forecast_eligible !== false
      // default true if field missing (backwards compat)
    );
  }

  /**
   * Returns pipelines NOT eligible for forecast math.
   * Skills report these separately without adding to
   * quota attainment.
   */
  async getNonForecastPipelines(workspaceId: string): Promise<PipelineConfig[]> {
    const config = await this.getConfig(workspaceId);
    return config.pipelines.filter(
      p => p.forecast_eligible === false
    );
  }

  /**
   * Returns the value_field for a specific pipeline.
   * Default: 'amount'
   */
  async getValueField(
    workspaceId: string,
    pipelineId?: string
  ): Promise<string> {
    const config = await this.getConfig(workspaceId);
    if (pipelineId) {
      const pipeline = config.pipelines.find(p => p.id === pipelineId);
      return pipeline?.value_field || 'amount';
    }
    // Return value_field from first forecast-eligible pipeline
    const forecast = config.pipelines.find(
      p => p.forecast_eligible !== false
    );
    return forecast?.value_field || 'amount';
  }
}

// Export singleton instance
export const configLoader = new WorkspaceConfigLoader();
