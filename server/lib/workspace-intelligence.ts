/**
 * WorkspaceIntelligence Resolver
 *
 * Canonical runtime object that replaces 6 competing context sources.
 * Resolves workspace configuration across 7 domains with 5-minute caching.
 *
 * Phase 3 of WorkspaceIntelligence architecture.
 */

import { query } from '../db.js';
import type {
  WorkspaceIntelligence,
  MetricDefinitionRow,
  BusinessDimensionRow,
  WorkspaceKnowledgeRow,
  DataDictionaryRow,
  TargetRow,
  CalibrationChecklistRow,
} from '../types/workspace-intelligence.js';
import { SKILL_MANIFESTS, evaluateSkillGate } from './skill-manifests.js';

// ============================================================
// CACHING
// ============================================================

interface CacheEntry {
  data: WorkspaceIntelligence;
  expires: number;
}

const WI_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Invalidates cached WorkspaceIntelligence for a workspace.
 * Call this from any write route that modifies relevant tables.
 */
export function invalidateWorkspaceIntelligence(workspaceId: string): void {
  WI_CACHE.delete(workspaceId);
}

// ============================================================
// MAIN RESOLVER
// ============================================================

/**
 * Resolves the complete WorkspaceIntelligence object for a workspace.
 * Returns cached value if fresh, otherwise queries all 7 domains in parallel.
 */
export async function resolveWorkspaceIntelligence(
  workspaceId: string
): Promise<WorkspaceIntelligence> {
  // Check cache
  const cached = WI_CACHE.get(workspaceId);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }

  // Resolve all domains in parallel
  const [
    business,
    metrics,
    segmentation,
    taxonomy,
    pipeline,
    data_quality,
    knowledge,
  ] = await Promise.all([
    resolveBusiness(workspaceId),
    resolveMetrics(workspaceId),
    resolveSegmentation(workspaceId),
    resolveTaxonomy(workspaceId),
    resolvePipeline(workspaceId),
    resolveDataQuality(workspaceId),
    resolveKnowledge(workspaceId),
  ]);

  // Readiness depends on other domains
  const readiness = await resolveReadiness(workspaceId, {
    business,
    metrics,
    segmentation,
    taxonomy,
    pipeline,
    data_quality,
  });

  // Assemble WorkspaceIntelligence object
  const wi: WorkspaceIntelligence = {
    workspace_id: workspaceId,
    resolved_at: new Date(),
    cache_ttl_seconds: 300, // 5 minutes
    business,
    metrics,
    segmentation,
    taxonomy,
    pipeline,
    data_quality,
    knowledge,
    readiness,
  };

  // Cache for 5 minutes
  WI_CACHE.set(workspaceId, {
    data: wi,
    expires: Date.now() + CACHE_TTL_MS,
  });

  return wi;
}

// ============================================================
// DOMAIN RESOLVERS
// ============================================================

/**
 * Resolves business configuration - WHO THEY ARE
 */
async function resolveBusiness(
  workspaceId: string
): Promise<WorkspaceIntelligence['business']> {
  try {
    const result = await query<{ workspace_config: any }>(
      `SELECT workspace_config FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const row = result.rows[0];
    if (!row?.workspace_config?.business) {
      // No business config exists - return all nulls
      return {
        gtm_motion: null,
        growth_stage: null,
        revenue_model: null,
        board_metrics: [],
        cro_primary_concern: null,
        sells_multiple_products: false,
        products: [],
        forecast_methodology: null,
        quota_currency: null,
        multi_year_reporting: null,
        nrr_tracked: false,
      };
    }

    const biz = row.workspace_config.business;
    return {
      gtm_motion: biz.gtm_motion || null,
      growth_stage: biz.growth_stage || null,
      revenue_model: biz.revenue_model || null,
      board_metrics: Array.isArray(biz.board_metrics) ? biz.board_metrics : [],
      cro_primary_concern: biz.cro_primary_concern || null,
      sells_multiple_products: Boolean(biz.sells_multiple_products),
      products: Array.isArray(biz.products) ? biz.products : [],
      forecast_methodology: biz.forecast_methodology || null,
      quota_currency: biz.quota_currency || null,
      multi_year_reporting: biz.multi_year_reporting || null,
      nrr_tracked: Boolean(biz.nrr_tracked),
    };
  } catch (err) {
    console.error('[WorkspaceIntelligence] resolveBusiness failed', {
      workspaceId,
      err,
    });
    return {
      gtm_motion: null,
      growth_stage: null,
      revenue_model: null,
      board_metrics: [],
      cro_primary_concern: null,
      sells_multiple_products: false,
      products: [],
      forecast_methodology: null,
      quota_currency: null,
      multi_year_reporting: null,
      nrr_tracked: false,
    };
  }
}

/**
 * Resolves metric definitions - HOW THEY MEASURE
 */
async function resolveMetrics(
  workspaceId: string
): Promise<WorkspaceIntelligence['metrics']> {
  try {
    const result = await query<MetricDefinitionRow>(
      `SELECT * FROM metric_definitions WHERE workspace_id = $1`,
      [workspaceId]
    );

    const metrics: WorkspaceIntelligence['metrics'] = {};

    for (const row of result.rows) {
      metrics[row.metric_key] = {
        id: row.id,
        label: row.label,
        numerator: row.numerator,
        denominator: row.denominator,
        aggregation_method: row.aggregation_method,
        unit: row.unit,
        segmentation_defaults: row.segmentation_defaults || [],
        confidence: row.confidence,
        confirmed_value: row.confirmed_value,
        last_computed_value: row.last_computed_value,
      };
    }

    return metrics;
  } catch (err) {
    console.error('[WorkspaceIntelligence] resolveMetrics failed', {
      workspaceId,
      err,
    });
    return {};
  }
}

/**
 * Resolves segmentation dimensions - HOW THEY SEGMENT
 */
async function resolveSegmentation(
  workspaceId: string
): Promise<WorkspaceIntelligence['segmentation']> {
  try {
    const result = await query<BusinessDimensionRow>(
      `SELECT * FROM business_dimensions WHERE workspace_id = $1`,
      [workspaceId]
    );

    const dimensions: WorkspaceIntelligence['segmentation']['dimensions'] = {};
    const default_dimensions: string[] = [];

    for (const row of result.rows) {
      if (row.crm_field) {
        dimensions[row.dimension_key] = {
          crm_field: row.crm_field,
          entity: row.entity,
          values: row.crm_values || [],
          confirmed: row.confirmed,
        };

        if (row.confirmed) {
          default_dimensions.push(row.dimension_key);
        }
      }
    }

    return {
      default_dimensions,
      dimensions,
    };
  } catch (err) {
    console.error('[WorkspaceIntelligence] resolveSegmentation failed', {
      workspaceId,
      err,
    });
    return {
      default_dimensions: [],
      dimensions: {},
    };
  }
}

/**
 * Resolves deal taxonomy - HOW THEY CLASSIFY DEALS
 */
async function resolveTaxonomy(
  workspaceId: string
): Promise<WorkspaceIntelligence['taxonomy']> {
  try {
    const [configResult, knowledgeResult] = await Promise.all([
      query<{ workspace_config: any }>(
        `SELECT workspace_config FROM workspaces WHERE id = $1`,
        [workspaceId]
      ),
      query<{ key: string; value: string }>(
        `SELECT key, value FROM workspace_knowledge
         WHERE workspace_id = $1 AND domain = 'taxonomy'`,
        [workspaceId]
      ),
    ]);

    // Build custom_aliases from workspace_knowledge
    const custom_aliases: Record<string, string> = {};
    for (const row of knowledgeResult.rows) {
      if (row.key.startsWith('alias.')) {
        const aliasKey = row.key.replace('alias.', '');
        custom_aliases[aliasKey] = row.value;
      }
    }

    // Extract taxonomy from workspace_config if present
    const config = configResult.rows[0]?.workspace_config;
    const pipelines = config?.pipelines || [];
    const firstPipeline = pipelines[0];

    return {
      land_field: firstPipeline?.taxonomy?.land_field || null,
      land_values: Array.isArray(firstPipeline?.taxonomy?.land_values)
        ? firstPipeline.taxonomy.land_values
        : [],
      expand_field: firstPipeline?.taxonomy?.expand_field || null,
      expand_values: Array.isArray(firstPipeline?.taxonomy?.expand_values)
        ? firstPipeline.taxonomy.expand_values
        : [],
      renew_field: firstPipeline?.taxonomy?.renew_field || null,
      renew_values: Array.isArray(firstPipeline?.taxonomy?.renew_values)
        ? firstPipeline.taxonomy.renew_values
        : [],
      custom_aliases,
    };
  } catch (err) {
    console.error('[WorkspaceIntelligence] resolveTaxonomy failed', {
      workspaceId,
      err,
    });
    return {
      land_field: null,
      land_values: [],
      expand_field: null,
      expand_values: [],
      renew_field: null,
      renew_values: [],
      custom_aliases: {},
    };
  }
}

/**
 * Resolves pipeline configuration - WHAT COUNTS AS PIPELINE
 */
async function resolvePipeline(
  workspaceId: string
): Promise<WorkspaceIntelligence['pipeline']> {
  try {
    const [configResult, targetsResult] = await Promise.all([
      query<{ workspace_config: any }>(
        `SELECT workspace_config FROM workspaces WHERE id = $1`,
        [workspaceId]
      ),
      query<TargetRow>(
        `SELECT * FROM targets WHERE workspace_id = $1 AND is_active = true`,
        [workspaceId]
      ),
    ]);

    const config = configResult.rows[0]?.workspace_config;
    const pipelines = config?.pipelines || [];
    const firstPipeline = pipelines[0];

    // Build active_stages from workspace_config
    const active_stages: string[] = [];
    const excluded_stages: string[] = [];

    if (firstPipeline?.stage_probabilities) {
      for (const [stage, prob] of Object.entries(
        firstPipeline.stage_probabilities
      )) {
        if (typeof prob === 'number' && prob > 0) {
          active_stages.push(stage);
        }
      }
    }

    // Build coverage_targets from targets table
    const coverage_targets: Record<string, number> = {};

    for (const target of targetsResult.rows) {
      if (target.metric === 'pipeline_coverage' || target.metric === 'coverage') {
        const key = target.segment_scope || 'default';
        coverage_targets[key] = target.amount;
      }
    }

    // If no coverage targets from table, use pipeline config
    if (Object.keys(coverage_targets).length === 0 && firstPipeline?.coverage_target) {
      coverage_targets.default = firstPipeline.coverage_target;
    }

    return {
      active_stages,
      excluded_stages,
      coverage_targets,
      weighted: Boolean(firstPipeline?.weighted),
      coverage_requires_segmentation: Boolean(
        firstPipeline?.coverage_requires_segmentation
      ),
    };
  } catch (err) {
    console.error('[WorkspaceIntelligence] resolvePipeline failed', {
      workspaceId,
      err,
    });
    return {
      active_stages: [],
      excluded_stages: [],
      coverage_targets: {},
      weighted: false,
      coverage_requires_segmentation: false,
    };
  }
}

/**
 * Resolves data quality metrics - WHETHER TO TRUST THE DATA
 */
async function resolveDataQuality(
  workspaceId: string
): Promise<WorkspaceIntelligence['data_quality']> {
  try {
    const [dictionaryResult, stageHistoryCheck] = await Promise.all([
      query<DataDictionaryRow>(
        `SELECT term, completion_rate, trust_score, is_trusted_for_reporting, last_audited
         FROM data_dictionary
         WHERE workspace_id = $1 AND is_active = true`,
        [workspaceId]
      ),
      query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM deal_stage_history WHERE workspace_id = $1 LIMIT 1) as exists`,
        [workspaceId]
      ).catch(() => ({ rows: [{ exists: false }] })),
    ]);

    const fields: WorkspaceIntelligence['data_quality']['fields'] = {};

    for (const row of dictionaryResult.rows) {
      fields[row.term] = {
        completion_rate: row.completion_rate,
        trust_score: row.trust_score,
        is_trusted_for_reporting: row.is_trusted_for_reporting,
        last_audited: row.last_audited,
      };
    }

    const stage_history_available = stageHistoryCheck.rows[0]?.exists || false;
    const close_dates_reliable =
      fields.close_date?.trust_score === 'HIGH' || false;

    return {
      fields,
      stage_history_available,
      close_dates_reliable,
    };
  } catch (err) {
    console.error('[WorkspaceIntelligence] resolveDataQuality failed', {
      workspaceId,
      err,
    });
    return {
      fields: {},
      stage_history_available: false,
      close_dates_reliable: false,
    };
  }
}

/**
 * Resolves workspace knowledge - WHAT THEY KNOW ABOUT THEMSELVES
 */
async function resolveKnowledge(
  workspaceId: string
): Promise<WorkspaceIntelligence['knowledge']> {
  try {
    const result = await query<WorkspaceKnowledgeRow>(
      `SELECT key, value, domain, source, confidence
       FROM workspace_knowledge
       WHERE workspace_id = $1 AND confidence >= 0.6
       ORDER BY confidence DESC
       LIMIT 30`,
      [workspaceId]
    );

    const knowledge: WorkspaceIntelligence['knowledge'] = {};

    for (const row of result.rows) {
      const domain = row.domain || 'general';
      if (!knowledge[domain]) {
        knowledge[domain] = [];
      }
      knowledge[domain].push({
        key: row.key,
        value: row.value,
        source: row.source,
        confidence: row.confidence,
      });
    }

    return knowledge;
  } catch (err) {
    console.error('[WorkspaceIntelligence] resolveKnowledge failed', {
      workspaceId,
      err,
    });
    return {};
  }
}

/**
 * Resolves readiness scores - HOW COMPLETE THIS PICTURE IS
 */
async function resolveReadiness(
  workspaceId: string,
  domains: {
    business: WorkspaceIntelligence['business'];
    metrics: WorkspaceIntelligence['metrics'];
    segmentation: WorkspaceIntelligence['segmentation'];
    taxonomy: WorkspaceIntelligence['taxonomy'];
    pipeline: WorkspaceIntelligence['pipeline'];
    data_quality: WorkspaceIntelligence['data_quality'];
  }
): Promise<WorkspaceIntelligence['readiness']> {
  try {
    const result = await query<CalibrationChecklistRow>(
      `SELECT question_id, domain, status, skill_dependencies
       FROM calibration_checklist
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    // Calculate domain scores from calibration checklist
    const domainCounts: Record<string, { confirmed: number; total: number }> = {
      business: { confirmed: 0, total: 0 },
      metrics: { confirmed: 0, total: 0 },
      segmentation: { confirmed: 0, total: 0 },
      taxonomy: { confirmed: 0, total: 0 },
      pipeline: { confirmed: 0, total: 0 },
      data_quality: { confirmed: 0, total: 0 },
    };

    const blocking_gaps: string[] = [];

    for (const row of result.rows) {
      const domain = row.domain;
      if (domainCounts[domain]) {
        domainCounts[domain].total++;
        if (row.status === 'CONFIRMED') {
          domainCounts[domain].confirmed++;
        }

        // Blocking gap = UNKNOWN status + has skill_dependencies
        if (
          row.status === 'UNKNOWN' &&
          Array.isArray(row.skill_dependencies) &&
          row.skill_dependencies.length > 0
        ) {
          blocking_gaps.push(row.question_id);
        }
      }
    }

    // Calculate scores (confirmed / total) for each domain
    const by_domain = {
      business:
        domainCounts.business.total > 0
          ? domainCounts.business.confirmed / domainCounts.business.total
          : 0,
      metrics:
        domainCounts.metrics.total > 0
          ? domainCounts.metrics.confirmed / domainCounts.metrics.total
          : 0,
      segmentation:
        domainCounts.segmentation.total > 0
          ? domainCounts.segmentation.confirmed / domainCounts.segmentation.total
          : 0,
      taxonomy:
        domainCounts.taxonomy.total > 0
          ? domainCounts.taxonomy.confirmed / domainCounts.taxonomy.total
          : 0,
      pipeline:
        domainCounts.pipeline.total > 0
          ? domainCounts.pipeline.confirmed / domainCounts.pipeline.total
          : 0,
      data_quality:
        domainCounts.data_quality.total > 0
          ? domainCounts.data_quality.confirmed / domainCounts.data_quality.total
          : 0,
    };

    // Overall score = average of 6 domain scores × 100
    const overall_score = Math.round(
      ((by_domain.business +
        by_domain.metrics +
        by_domain.segmentation +
        by_domain.taxonomy +
        by_domain.pipeline +
        by_domain.data_quality) /
        6) *
        100
    );

    // Compute skill gates for all skills (Phase 6)
    const skill_gates: Record<string, 'LIVE' | 'DRAFT' | 'BLOCKED'> = {};
    const checklistRows = result.rows.map((r) => ({
      question_id: r.question_id,
      status: r.status,
    }));

    // Assemble partial WorkspaceIntelligence for gate evaluation
    const partialWi: WorkspaceIntelligence = {
      workspace_id: workspaceId,
      resolved_at: new Date(),
      cache_ttl_seconds: 300,
      business: domains.business,
      metrics: domains.metrics,
      segmentation: domains.segmentation,
      taxonomy: domains.taxonomy,
      pipeline: domains.pipeline,
      data_quality: domains.data_quality,
      knowledge: {
        hypotheses: [],
        recent_findings: [],
        skill_evidence: [],
      },
      readiness: {
        overall_score,
        by_domain,
        blocking_gaps,
        skill_gates: {},
      },
    };

    // Evaluate gate status for all skills
    for (const [skillId, manifest] of Object.entries(SKILL_MANIFESTS)) {
      const gateResult = evaluateSkillGate(manifest, checklistRows, partialWi);
      skill_gates[skillId] = gateResult.gate;
    }

    return {
      overall_score,
      by_domain,
      blocking_gaps,
      skill_gates,
    };
  } catch (err) {
    console.error('[WorkspaceIntelligence] resolveReadiness failed', {
      workspaceId,
      err,
    });
    return {
      overall_score: 0,
      by_domain: {
        business: 0,
        metrics: 0,
        segmentation: 0,
        taxonomy: 0,
        pipeline: 0,
        data_quality: 0,
      },
      blocking_gaps: [],
      skill_gates: {},
    };
  }
}

// ============================================================
// TYPE RE-EXPORTS
// ============================================================

export type { WorkspaceIntelligence };
