import type { AgentDefinition } from './types.js';

export class AgentRegistry {
  private static instance: AgentRegistry;
  private agents: Map<string, AgentDefinition> = new Map();

  private constructor() {}

  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  register(agent: AgentDefinition): void {
    if (this.agents.has(agent.id)) {
      console.warn(`[AgentRegistry] Agent '${agent.id}' already registered, overwriting`);
    }
    this.agents.set(agent.id, agent);
    console.log(`[AgentRegistry] Registered agent: ${agent.id} (${agent.name})`);
  }

  get(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  listForWorkspace(workspaceId: string): AgentDefinition[] {
    return this.list().filter(
      a => a.workspaceIds === 'all' || a.workspaceIds.includes(workspaceId)
    );
  }

  enable(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.enabled = true;
      agent.updatedAt = new Date();
    }
  }

  disable(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.enabled = false;
      agent.updatedAt = new Date();
    }
  }

  remove(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }
}

export function getAgentRegistry(): AgentRegistry {
  return AgentRegistry.getInstance();
}
