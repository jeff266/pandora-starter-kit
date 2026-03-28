/**
 * Skill Manifests — Phase 6
 *
 * Dependency declarations for all skills.
 * Maps skill_id → required/preferred checklist items + metrics + fallback behavior.
 */

import type {
  SkillManifest,
  SkillGateResult,
  WorkspaceIntelligence,
} from '../types/workspace-intelligence.js';

// ============================================================
// SKILL MANIFESTS — ALL 38 SKILLS
// ============================================================

export const SKILL_MANIFESTS: Record<string, SkillManifest> = {
  // PRIORITY MANIFESTS (have active bugs)
  'pipeline-waterfall': {
    skill_id: 'pipeline-waterfall',
    required_checklist_items: ['pipeline_active_stages', 'pipeline_coverage_target'],
    preferred_checklist_items: ['segmentation_field', 'segmentation_values', 'coverage_requires_segmentation'],
    required_metric_keys: ['pipeline_coverage', 'pipeline_created'],
    fallback_behavior: 'draft_mode',
  },

  'pipeline-coverage': {
    skill_id: 'pipeline-coverage',
    required_checklist_items: ['pipeline_active_stages', 'pipeline_coverage_target'],
    preferred_checklist_items: ['segmentation_field', 'coverage_target_by_segment', 'coverage_requires_segmentation'],
    required_metric_keys: ['pipeline_coverage', 'quota_remaining'],
    fallback_behavior: 'draft_mode',
  },

  'rep-scorecard': {
    skill_id: 'rep-scorecard',
    required_checklist_items: ['quota_currency', 'attainment_method'],
    preferred_checklist_items: ['segmentation_field', 'land_motion_field', 'expand_motion_field'],
    required_metric_keys: ['attainment', 'win_rate', 'average_deal_size'],
    fallback_behavior: 'warn',
  },

  'forecast-rollup': {
    skill_id: 'forecast-rollup',
    required_checklist_items: ['forecast_categories', 'forecast_methodology', 'pipeline_active_stages'],
    preferred_checklist_items: ['quota_currency'],
    required_metric_keys: ['attainment', 'quota_remaining'],
    fallback_behavior: 'draft_mode',
  },

  'stage-velocity-benchmarks': {
    skill_id: 'stage-velocity-benchmarks',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: ['segmentation_field'],
    required_metric_keys: ['sales_cycle', 'stage_conversion'],
    fallback_behavior: 'warn',
  },

  'pipeline-conversion-rate': {
    skill_id: 'pipeline-conversion-rate',
    required_checklist_items: ['pipeline_active_stages', 'win_rate_denominator'],
    preferred_checklist_items: ['land_motion_field', 'expand_motion_field', 'segmentation_field'],
    required_metric_keys: ['win_rate'],
    fallback_behavior: 'warn',
  },

  // PIPELINE CATEGORY
  'pipeline-progression': {
    skill_id: 'pipeline-progression',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: ['segmentation_field'],
    required_metric_keys: ['stage_conversion', 'sales_cycle'],
    fallback_behavior: 'warn',
  },

  'pipeline-hygiene': {
    skill_id: 'pipeline-hygiene',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: [],
    required_metric_keys: ['pipeline_at_risk'],
    fallback_behavior: 'warn',
  },

  'pipeline-movement': {
    skill_id: 'pipeline-movement',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: [],
    required_metric_keys: ['pipeline_created'],
    fallback_behavior: 'warn',
  },

  'pipeline-goals': {
    skill_id: 'pipeline-goals',
    required_checklist_items: ['pipeline_coverage_target', 'quota_currency'],
    preferred_checklist_items: ['segmentation_field'],
    required_metric_keys: ['quota_remaining', 'pipeline_coverage'],
    fallback_behavior: 'warn',
  },

  'pipeline-gen-forecast': {
    skill_id: 'pipeline-gen-forecast',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: [],
    required_metric_keys: ['pipeline_created'],
    fallback_behavior: 'warn',
  },

  'pipeline-contribution-forecast': {
    skill_id: 'pipeline-contribution-forecast',
    required_checklist_items: ['pipeline_active_stages', 'forecast_categories'],
    preferred_checklist_items: ['segmentation_field'],
    required_metric_keys: ['win_rate', 'sales_cycle'],
    fallback_behavior: 'warn',
  },

  // FORECASTING CATEGORY
  'forecast-model': {
    skill_id: 'forecast-model',
    required_checklist_items: ['forecast_methodology', 'forecast_categories'],
    preferred_checklist_items: ['quota_currency'],
    required_metric_keys: ['attainment', 'win_rate'],
    fallback_behavior: 'warn',
  },

  'forecast-accuracy-tracking': {
    skill_id: 'forecast-accuracy-tracking',
    required_checklist_items: ['forecast_categories'],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  'monte-carlo-forecast': {
    skill_id: 'monte-carlo-forecast',
    required_checklist_items: ['pipeline_active_stages', 'forecast_categories'],
    preferred_checklist_items: ['win_rate_denominator'],
    required_metric_keys: ['win_rate', 'sales_cycle'],
    fallback_behavior: 'warn',
  },

  // DEAL ANALYSIS CATEGORY
  'deal-risk-review': {
    skill_id: 'deal-risk-review',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: [],
    required_metric_keys: ['pipeline_at_risk'],
    fallback_behavior: 'warn',
  },

  'deal-scoring-model': {
    skill_id: 'deal-scoring-model',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: [],
    required_metric_keys: ['win_rate'],
    fallback_behavior: 'warn',
  },

  'deal-rfm-scoring': {
    skill_id: 'deal-rfm-scoring',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  'single-thread-alert': {
    skill_id: 'single-thread-alert',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  'stage-mismatch-detector': {
    skill_id: 'stage-mismatch-detector',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  // STRATEGY & INSIGHTS CATEGORY
  'strategy-insights': {
    skill_id: 'strategy-insights',
    required_checklist_items: [],
    preferred_checklist_items: ['gtm_motion', 'growth_stage'],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  'gtm-health-diagnostic': {
    skill_id: 'gtm-health-diagnostic',
    required_checklist_items: [],
    preferred_checklist_items: ['gtm_motion', 'growth_stage', 'revenue_model'],
    required_metric_keys: ['win_rate', 'pipeline_coverage', 'attainment'],
    fallback_behavior: 'warn',
  },

  'quarterly-pre-mortem': {
    skill_id: 'quarterly-pre-mortem',
    required_checklist_items: ['quota_currency'],
    preferred_checklist_items: ['forecast_methodology'],
    required_metric_keys: ['attainment', 'quota_remaining'],
    fallback_behavior: 'warn',
  },

  'weekly-recap': {
    skill_id: 'weekly-recap',
    required_checklist_items: [],
    preferred_checklist_items: ['pipeline_active_stages'],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  'project-recap': {
    skill_id: 'project-recap',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  // CONVERSATION & INTELLIGENCE CATEGORY
  'conversation-intelligence': {
    skill_id: 'conversation-intelligence',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  'competitive-intelligence': {
    skill_id: 'competitive-intelligence',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: ['win_rate'],
    fallback_behavior: 'warn',
  },

  'voice-pattern-extraction': {
    skill_id: 'voice-pattern-extraction',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  // COACHING & ENABLEMENT CATEGORY
  'coaching': {
    skill_id: 'coaching',
    required_checklist_items: [],
    preferred_checklist_items: ['attainment_method'],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  'behavioral-winning-path': {
    skill_id: 'behavioral-winning-path',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: [],
    required_metric_keys: ['win_rate'],
    fallback_behavior: 'warn',
  },

  // DISCOVERY & CONFIGURATION CATEGORY
  'icp-discovery': {
    skill_id: 'icp-discovery',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: ['win_rate'],
    fallback_behavior: 'warn',
  },

  'icp-taxonomy-builder': {
    skill_id: 'icp-taxonomy-builder',
    required_checklist_items: [],
    preferred_checklist_items: ['land_motion_field', 'expand_motion_field'],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  'custom-field-discovery': {
    skill_id: 'custom-field-discovery',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  'workspace-config-audit': {
    skill_id: 'workspace-config-audit',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  'data-quality-audit': {
    skill_id: 'data-quality-audit',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  // SCORING & CONTACT MANAGEMENT CATEGORY
  'lead-scoring': {
    skill_id: 'lead-scoring',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: ['win_rate'],
    fallback_behavior: 'warn',
  },

  'contact-role-resolution': {
    skill_id: 'contact-role-resolution',
    required_checklist_items: [],
    preferred_checklist_items: [],
    required_metric_keys: [],
    fallback_behavior: 'warn',
  },

  // ANALYSIS & ADVANCED CATEGORY
  'bowtie-analysis': {
    skill_id: 'bowtie-analysis',
    required_checklist_items: ['pipeline_active_stages'],
    preferred_checklist_items: ['land_motion_field', 'expand_motion_field', 'renew_motion_field'],
    required_metric_keys: ['expansion_rate', 'nrr'],
    fallback_behavior: 'warn',
  },
};

// ============================================================
// SKILL GATE EVALUATION
// ============================================================

/**
 * Evaluates whether a skill can run in LIVE, DRAFT, or BLOCKED mode
 * based on checklist status and metric availability.
 */
export function evaluateSkillGate(
  manifest: SkillManifest,
  checklist: Array<{ question_id: string; status: string }>,
  wi: WorkspaceIntelligence
): SkillGateResult {
  const checklistMap = new Map(checklist.map((c) => [c.question_id, c.status]));

  const missing_required = manifest.required_checklist_items.filter((qid) => {
    const status = checklistMap.get(qid);
    return !status || status !== 'CONFIRMED';
  });

  const missing_preferred = manifest.preferred_checklist_items.filter((qid) => {
    const status = checklistMap.get(qid);
    return !status || status === 'UNKNOWN';
  });

  const missingMetrics = manifest.required_metric_keys.filter(
    (key) => !wi.metrics[key]
  );

  const warnings: string[] = [];
  if (missing_preferred.length > 0) {
    warnings.push(
      `Preferred config missing: ${missing_preferred.join(', ')} — analysis may be incomplete`
    );
  }
  if (missingMetrics.length > 0) {
    warnings.push(
      `Required metrics not seeded: ${missingMetrics.join(', ')}`
    );
  }

  // Missing metrics count as required failures
  const allMissingRequired = [...missing_required, ...missingMetrics];

  if (allMissingRequired.length > 0) {
    const gate = manifest.fallback_behavior === 'block' ? 'BLOCKED' : 'DRAFT';
    return {
      gate,
      missing_required: allMissingRequired,
      missing_preferred,
      warnings,
    };
  }

  return {
    gate: 'LIVE',
    missing_required: [],
    missing_preferred,
    warnings,
  };
}

// ============================================================
// GETTER
// ============================================================

/**
 * Gets a skill manifest by ID. Returns null if not found.
 */
export function getSkillManifest(skillId: string): SkillManifest | null {
  return SKILL_MANIFESTS[skillId] ?? null;
}
