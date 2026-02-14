import { getAgentRegistry } from './registry.js';
import { pipelineStateAgent } from './definitions/pipeline-state.js';
import { forecastCallPrepAgent } from './definitions/forecast-call-prep.js';
import { bowtieReviewAgent } from './definitions/bowtie-review.js';
import { attainmentVsGoalAgent } from './definitions/attainment-vs-goal.js';
import { fridayRecapAgent } from './definitions/friday-recap.js';
import { strategyInsightsAgent } from './definitions/strategy-insights.js';

export { AgentRegistry, getAgentRegistry } from './registry.js';
export { AgentRuntime, getAgentRuntime } from './runtime.js';
export type {
  AgentDefinition,
  AgentSkillStep,
  AgentTrigger,
  AgentDelivery,
  AgentRunResult,
  AgentSkillResult,
  SkillOutput,
} from './types.js';

export function registerBuiltInAgents(): void {
  const registry = getAgentRegistry();
  registry.register(pipelineStateAgent);
  registry.register(forecastCallPrepAgent);
  registry.register(bowtieReviewAgent);
  registry.register(attainmentVsGoalAgent);
  registry.register(fridayRecapAgent);
  registry.register(strategyInsightsAgent);
  console.log(`[Agents] Registered ${registry.list().length} agents`);
}
