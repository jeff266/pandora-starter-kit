import { getAgentRegistry } from './registry.js';
import { pipelineStateAgent } from './definitions/pipeline-state.js';
import { forecastCallPrepAgent } from './definitions/forecast-call-prep.js';

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
  console.log(`[Agents] Registered ${registry.list().length} agents`);
}
