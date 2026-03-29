/**
 * Skill Framework - Barrel Exports
 *
 * Central export point for the entire skill framework.
 */

import { getSkillRegistry as _getSkillRegistry } from './registry.js';
import { query } from '../db.js';
import { buildCustomSkillDefinition } from './custom-skill-builder.js';
export { buildCustomSkillDefinition } from './custom-skill-builder.js';
export type { CustomSkillRow } from './custom-skill-builder.js';
import { registerAllEvidenceBuilders } from './evidence-builders/index.js';
import { registerAllActionGenerators } from './action-generators/index.js';
import { pipelineHygieneSkill } from './library/pipeline-hygiene.js';
import { dealRiskReviewSkill } from './library/deal-risk-review.js';
import { weeklyRecapSkill } from './library/weekly-recap.js';
import { singleThreadAlertSkill } from './library/single-thread-alert.js';
import { dataQualityAuditSkill } from './library/data-quality-audit.js';
import { pipelineCoverageSkill } from './library/pipeline-coverage.js';
import { forecastRollupSkill } from './library/forecast-rollup.js';
import { pipelineWaterfallSkill } from './library/pipeline-waterfall.js';
import { repScorecardSkill } from './library/rep-scorecard.js';
import { customFieldDiscoverySkill } from './library/custom-field-discovery.js';
import { leadScoringSkill } from './library/lead-scoring.js';
import { contactRoleResolutionSkill } from './library/contact-role-resolution.js';
import { icpDiscoverySkill } from './library/icp-discovery.js';
import { icpTaxonomyBuilderSkill } from './library/icp-taxonomy-builder.js';
import { bowtieAnalysisSkill } from './library/bowtie-analysis.js';
import { pipelineGoalsSkill } from './library/pipeline-goals.js';
import { projectRecapSkill } from './library/project-recap.js';
import { strategyInsightsSkill } from './library/strategy-insights.js';
import { workspaceConfigAuditSkill } from './library/workspace-config-audit.js';
import { stageVelocityBenchmarksSkill } from './library/stage-velocity-benchmarks.js';
import { conversationIntelligenceSkill } from './library/conversation-intelligence.js';
import { forecastModelSkill } from './library/forecast-model.js';
import { pipelineGenForecastSkill } from './library/pipeline-gen-forecast.js';
import { competitiveIntelligenceSkill } from './library/competitive-intelligence.js';
import { forecastAccuracyTrackingSkill } from './library/forecast-accuracy-tracking.js';
import { dealScoringModelSkill } from './library/deal-scoring-model.js';
import { dealRfmScoringSkill } from './library/deal-rfm-scoring.js';
import { monteCarloForecastSkill } from './library/monte-carlo-forecast.js';
import { pipelineContributionForecastSkill } from './library/pipeline-contribution-forecast.js';
import { stageMismatchDetectorSkill } from './library/stage-mismatch-detector.js';
import { behavioralWinningPathSkill } from './library/behavioral-winning-path.js';
import { coachingSkill } from './library/coaching.js';
import { meddicCoverageSkill } from './implementations/meddic-coverage/index.js';
import { pipelineMovementSkill } from './library/pipeline-movement.js';
import { voicePatternExtractionSkill } from './library/voice-pattern-extraction.js';
import { pipelineConversionRateSkill } from './library/pipeline-conversion-rate.js';
import { pipelineProgressionSkill } from './library/pipeline-progression.js';
import { gtmHealthDiagnosticSkill } from './library/gtm-health-diagnostic.js';
import { quarterlyPreMortemSkill } from './library/quarterly-pre-mortem.js';
import { engagementDropoffAnalysisSkill } from './library/engagement-dropoff-analysis.js';

// Types
export type {
  AITier,
  SkillCategory,
  SkillOutputFormat,
  SkillStatus,
  SkillDefinition,
  SkillStep,
  SkillExecutionContext,
  SkillStepResult,
  SkillResult,
  SkillEvidence,
  EvidenceClaim,
  EvaluatedRecord,
  DataSourceContribution,
  SkillParameter,
  EvidenceSchema,
  EvidenceColumnDef,
  EvidenceFormulaDef,
  ToolDefinition,
  DeepSeekConfig,
  DeepSeekResponse,
  ClaudeToolDefinition,
  ClaudeMessage,
  ClaudeTextBlock,
  ClaudeToolUseBlock,
  ClaudeToolResultBlock,
  ClaudeResponse,
} from './types.js';

// Tool Definitions
export {
  toolRegistry,
  getAllToolDefinitions,
  getToolsByNames,
  getToolDefinition,
} from './tool-definitions.js';

// Runtime
export {
  SkillRuntime,
  getSkillRuntime,
} from './runtime.js';

// Registry
export {
  SkillRegistry,
  getSkillRegistry,
  registerAllSkills,
} from './registry.js';

// Built-in Skills
export { pipelineHygieneSkill } from './library/pipeline-hygiene.js';
export { dealRiskReviewSkill } from './library/deal-risk-review.js';
export { weeklyRecapSkill } from './library/weekly-recap.js';
export { singleThreadAlertSkill } from './library/single-thread-alert.js';
export { dataQualityAuditSkill } from './library/data-quality-audit.js';
export { pipelineCoverageSkill } from './library/pipeline-coverage.js';
export { forecastRollupSkill } from './library/forecast-rollup.js';
export { pipelineWaterfallSkill } from './library/pipeline-waterfall.js';
export { repScorecardSkill } from './library/rep-scorecard.js';
export { customFieldDiscoverySkill } from './library/custom-field-discovery.js';
export { leadScoringSkill } from './library/lead-scoring.js';
export { contactRoleResolutionSkill } from './library/contact-role-resolution.js';
export { icpDiscoverySkill } from './library/icp-discovery.js';
export { icpTaxonomyBuilderSkill } from './library/icp-taxonomy-builder.js';
export { bowtieAnalysisSkill } from './library/bowtie-analysis.js';
export { pipelineGoalsSkill } from './library/pipeline-goals.js';
export { projectRecapSkill } from './library/project-recap.js';
export { strategyInsightsSkill } from './library/strategy-insights.js';
export { workspaceConfigAuditSkill } from './library/workspace-config-audit.js';
export { stageVelocityBenchmarksSkill } from './library/stage-velocity-benchmarks.js';
export { conversationIntelligenceSkill } from './library/conversation-intelligence.js';
export { forecastModelSkill } from './library/forecast-model.js';
export { pipelineGenForecastSkill } from './library/pipeline-gen-forecast.js';
export { competitiveIntelligenceSkill } from './library/competitive-intelligence.js';
export { forecastAccuracyTrackingSkill } from './library/forecast-accuracy-tracking.js';
export { dealScoringModelSkill } from './library/deal-scoring-model.js';
export { monteCarloForecastSkill } from './library/monte-carlo-forecast.js';
export { pipelineContributionForecastSkill } from './library/pipeline-contribution-forecast.js';
export { stageMismatchDetectorSkill } from './library/stage-mismatch-detector.js';
export { behavioralWinningPathSkill } from './library/behavioral-winning-path.js';
export { engagementDropoffAnalysisSkill } from './library/engagement-dropoff-analysis.js';

// Formatters
export {
  formatForSlack,
  formatPipelineHygiene,
  formatWeeklyRecap,
} from './formatters/slack-formatter.js';

export {
  formatAsMarkdown,
  formatPipelineHygieneMarkdown,
  formatDealRiskMarkdown,
} from './formatters/markdown-formatter.js';

// Webhook Handlers
export {
  handleSkillTrigger,
  handleEvent,
  handleGetSkillRun,
  handleListSkillRuns,
  formatSkillRunForWebhook,
} from './webhook.js';

/**
 * Register all built-in skills
 */
export function registerBuiltInSkills(): void {
  const registry = _getSkillRegistry();

  // Register skills
  registry.register(pipelineHygieneSkill);
  registry.register(dealRiskReviewSkill);
  registry.register(weeklyRecapSkill);
  registry.register(singleThreadAlertSkill);
  registry.register(dataQualityAuditSkill);
  registry.register(pipelineCoverageSkill);
  registry.register(forecastRollupSkill);
  registry.register(pipelineWaterfallSkill);
  registry.register(repScorecardSkill);
  registry.register(customFieldDiscoverySkill);
  registry.register(leadScoringSkill);
  registry.register(contactRoleResolutionSkill);
  registry.register(icpDiscoverySkill);
  registry.register(icpTaxonomyBuilderSkill);
  registry.register(bowtieAnalysisSkill);
  registry.register(pipelineGoalsSkill);
  registry.register(projectRecapSkill);
  registry.register(strategyInsightsSkill);
  registry.register(workspaceConfigAuditSkill);
  registry.register(stageVelocityBenchmarksSkill);
  registry.register(conversationIntelligenceSkill);
  registry.register(forecastModelSkill);
  registry.register(pipelineGenForecastSkill);
  registry.register(competitiveIntelligenceSkill);
  registry.register(forecastAccuracyTrackingSkill);
  registry.register(dealScoringModelSkill);
  registry.register(dealRfmScoringSkill);
  registry.register(monteCarloForecastSkill);
  registry.register(pipelineContributionForecastSkill);
  registry.register(stageMismatchDetectorSkill);
  registry.register(behavioralWinningPathSkill);
  registry.register(coachingSkill);
  registry.register(meddicCoverageSkill);
  registry.register(pipelineMovementSkill);
  registry.register(voicePatternExtractionSkill);
  registry.register(pipelineConversionRateSkill);
  registry.register(pipelineProgressionSkill);
  registry.register(gtmHealthDiagnosticSkill);
  registry.register(quarterlyPreMortemSkill);

  // Register evidence builders for "Show the Work" evidence assembly
  registerAllEvidenceBuilders();

  // Register action generators for programmatic action creation
  registerAllActionGenerators();

  console.log('[Skills] Registered all built-in skills, evidence builders, and action generators');
}

/**
 * Load all active custom skills from DB into the registry.
 * Safe to call at startup and after workspace-level changes.
 */
export async function loadCustomSkills(workspaceId?: string): Promise<void> {
  const registry = _getSkillRegistry();
  try {
    const whereClause = workspaceId ? 'AND workspace_id = $1' : '';
    const params = workspaceId ? [workspaceId] : [];
    const rows = await query(
      `SELECT * FROM custom_skills WHERE status = 'active' ${whereClause} ORDER BY created_at ASC`,
      params
    );
    for (const row of rows.rows as any[]) {
      const skillDef = buildCustomSkillDefinition(row);
      if (registry.has(skillDef.id)) registry.unregister(skillDef.id);
      registry.register(skillDef);
    }
    if (rows.rows.length > 0) {
      console.log(`[CustomSkills] Loaded ${rows.rows.length} custom skill(s) into registry`);
    }
  } catch (err: any) {
    console.error('[CustomSkills] Failed to load custom skills:', err.message);
  }
}

/**
 * Hot-load a single custom skill into the registry without restart.
 */
export async function registerCustomSkill(skillId: string, workspaceId: string): Promise<void> {
  const registry = _getSkillRegistry();
  const result = await query(
    `SELECT * FROM custom_skills WHERE skill_id = $1 AND workspace_id = $2 AND status = 'active'`,
    [skillId, workspaceId]
  );
  if (result.rows.length > 0) {
    const skillDef = buildCustomSkillDefinition(result.rows[0] as any);
    if (registry.has(skillDef.id)) registry.unregister(skillDef.id);
    registry.register(skillDef);
  }
}

/**
 * Remove a custom skill from the registry.
 */
export function unregisterCustomSkill(skillId: string): void {
  _getSkillRegistry().unregister(skillId);
}
