/**
 * Skill Framework - Barrel Exports
 *
 * Central export point for the entire skill framework.
 */

import { getSkillRegistry as _getSkillRegistry } from './registry.js';
import { registerAllEvidenceBuilders } from './evidence-builders/index.js';
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
import { bowtieAnalysisSkill } from './library/bowtie-analysis.js';
import { pipelineGoalsSkill } from './library/pipeline-goals.js';
import { projectRecapSkill } from './library/project-recap.js';
import { strategyInsightsSkill } from './library/strategy-insights.js';
import { workspaceConfigAuditSkill } from './library/workspace-config-audit.js';

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
export { bowtieAnalysisSkill } from './library/bowtie-analysis.js';
export { pipelineGoalsSkill } from './library/pipeline-goals.js';
export { projectRecapSkill } from './library/project-recap.js';
export { strategyInsightsSkill } from './library/strategy-insights.js';
export { workspaceConfigAuditSkill } from './library/workspace-config-audit.js';

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
  registry.register(bowtieAnalysisSkill);
  registry.register(pipelineGoalsSkill);
  registry.register(projectRecapSkill);
  registry.register(strategyInsightsSkill);
  registry.register(workspaceConfigAuditSkill);

  // Register evidence builders for "Show the Work" evidence assembly
  registerAllEvidenceBuilders();

  console.log('[Skills] Registered all built-in skills and evidence builders');
}
