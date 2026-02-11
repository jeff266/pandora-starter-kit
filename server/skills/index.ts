/**
 * Skill Framework - Barrel Exports
 *
 * Central export point for the entire skill framework.
 */

import { getSkillRegistry as _getSkillRegistry } from './registry.js';
import { pipelineHygieneSkill } from './library/pipeline-hygiene.js';
import { dealRiskReviewSkill } from './library/deal-risk-review.js';
import { weeklyRecapSkill } from './library/weekly-recap.js';
import { singleThreadAlertSkill } from './library/single-thread-alert.js';
import { dataQualityAuditSkill } from './library/data-quality-audit.js';

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

  console.log('[Skills] Registered all built-in skills');
}
