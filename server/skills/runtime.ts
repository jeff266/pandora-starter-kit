/**
 * Skill Runtime Engine
 *
 * Executes skills by running their steps in dependency order, routing each step
 * to the correct AI tier (compute/deepseek/claude).
 *
 * Key responsibilities:
 * - Load business context from context layer
 * - Execute steps in topological order based on dependencies
 * - Route compute steps to functions, deepseek steps to Fireworks, claude steps to Anthropic
 * - Handle Claude tool_use loop with safety limits
 * - Track tokens, duration, errors for each step
 * - Log to skill_runs table
 */

import type {
  SkillDefinition,
  SkillStep,
  SkillExecutionContext,
  SkillResult,
  SkillStepResult,
  ToolDefinition,
  ClaudeToolDefinition,
  ClaudeMessage,
  ClaudeResponse,
  ClaudeToolUseBlock,
} from './types.js';
import { getToolDefinition } from './tool-definitions.js';
import { getContext } from '../context/index.js';
import { ClaudeClient } from '../utils/llm-client.js';
import { query } from '../db.js';
import { randomUUID } from 'crypto';

// ============================================================================
// DeepSeek Client (Fireworks API with OpenAI-compatible endpoint)
// ============================================================================

class DeepSeekClient {
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.FIREWORKS_API_KEY || '';
    this.baseURL = process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1';
    this.model = 'accounts/fireworks/models/deepseek-v3';

    if (!this.apiKey) {
      throw new Error('FIREWORKS_API_KEY required for DeepSeek tier');
    }
  }

  async call(prompt: string, schema?: Record<string, any>): Promise<{ text: string; tokens: number }> {
    const requestBody: any = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 4096,
    };

    // If schema provided, request JSON mode
    if (schema) {
      requestBody.response_format = { type: 'json_object' };
      requestBody.messages[0].content = `${prompt}\n\nReturn your response as valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}`;
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const tokens = data.usage?.total_tokens || 0;

    return { text, tokens };
  }
}

// ============================================================================
// Skill Runtime
// ============================================================================

export class SkillRuntime {
  private claudeClient: ClaudeClient;
  private deepseekClient: DeepSeekClient | null = null;

  constructor() {
    this.claudeClient = new ClaudeClient();
  }

  private getDeepSeekClient(): DeepSeekClient {
    if (!this.deepseekClient) {
      this.deepseekClient = new DeepSeekClient();
    }
    return this.deepseekClient;
  }

  /**
   * Execute a skill
   */
  async executeSkill(
    skill: SkillDefinition,
    workspaceId: string,
    params?: any
  ): Promise<SkillResult> {
    const runId = randomUUID();
    const startTime = Date.now();

    console.log(`[Skill Runtime] Starting ${skill.id} for workspace ${workspaceId}, runId: ${runId}`);

    // Load business context
    const contextData = await getContext(workspaceId);
    const businessContext = {
      business_model: contextData?.business_model || {},
      team_structure: contextData?.team_structure || {},
      goals_and_targets: contextData?.goals_and_targets || {},
      definitions: contextData?.definitions || {},
      operational_maturity: contextData?.operational_maturity || {},
    };

    // Create execution context
    const context: SkillExecutionContext = {
      workspaceId,
      skillId: skill.id,
      runId,
      businessContext,
      stepResults: {},
      metadata: {
        startedAt: new Date(),
        tokenUsage: { compute: 0, deepseek: 0, claude: 0 },
        toolCallCount: 0,
        errors: [],
      },
    };

    // Log to skill_runs table
    await this.logSkillRun(runId, skill.id, workspaceId, 'running');

    // Execute steps
    const stepResults: SkillStepResult[] = [];
    let finalOutput: any = null;

    try {
      // Sort steps by dependency order (topological sort)
      const sortedSteps = this.sortStepsByDependencies(skill.steps);

      for (const step of sortedSteps) {
        const stepStartTime = Date.now();

        try {
          console.log(`[Skill Runtime] Executing step: ${step.id} (${step.tier})`);

          const result = await this.executeStep(step, context);
          context.stepResults[step.outputKey] = result;

          const duration = Date.now() - stepStartTime;
          stepResults.push({
            stepId: step.id,
            status: 'completed',
            tier: step.tier,
            duration_ms: duration,
            tokenUsage: 0, // Will be updated if using AI tiers
          });

          console.log(`[Skill Runtime] Step ${step.id} completed in ${duration}ms`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[Skill Runtime] Step ${step.id} failed:`, errorMsg);

          context.metadata.errors.push({
            step: step.id,
            error: errorMsg,
          });

          stepResults.push({
            stepId: step.id,
            status: 'failed',
            tier: step.tier,
            duration_ms: Date.now() - stepStartTime,
            tokenUsage: 0,
            error: errorMsg,
          });
        }
      }

      // Final output is the last step's result (or a designated output step)
      const lastStep = sortedSteps[sortedSteps.length - 1];
      finalOutput = context.stepResults[lastStep.outputKey];

      // Update skill_runs with success
      await this.logSkillRun(runId, skill.id, workspaceId, 'completed', finalOutput);

      return {
        runId,
        skillId: skill.id,
        workspaceId,
        status: context.metadata.errors.length === 0 ? 'completed' : 'partial',
        output: finalOutput,
        outputFormat: skill.outputFormat,
        steps: stepResults,
        totalDuration_ms: Date.now() - startTime,
        totalTokenUsage: context.metadata.tokenUsage,
        completedAt: new Date(),
        errors: context.metadata.errors.length > 0 ? context.metadata.errors : undefined,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Skill Runtime] Skill ${skill.id} failed:`, errorMsg);

      await this.logSkillRun(runId, skill.id, workspaceId, 'failed', null, errorMsg);

      return {
        runId,
        skillId: skill.id,
        workspaceId,
        status: 'failed',
        output: null,
        outputFormat: skill.outputFormat,
        steps: stepResults,
        totalDuration_ms: Date.now() - startTime,
        totalTokenUsage: context.metadata.tokenUsage,
        completedAt: new Date(),
        errors: [{ step: 'execution', error: errorMsg }],
      };
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(step: SkillStep, context: SkillExecutionContext): Promise<any> {
    switch (step.tier) {
      case 'compute':
        return this.executeComputeStep(step, context);
      case 'deepseek':
        return this.executeDeepSeekStep(step, context);
      case 'claude':
        return this.executeClaudeStep(step, context);
      default:
        throw new Error(`Unknown step tier: ${step.tier}`);
    }
  }

  /**
   * Execute COMPUTE step (deterministic function call)
   */
  private async executeComputeStep(step: SkillStep, context: SkillExecutionContext): Promise<any> {
    if (!step.computeFn) {
      throw new Error(`Compute step ${step.id} missing computeFn`);
    }

    const tool = getToolDefinition(step.computeFn);
    if (!tool) {
      throw new Error(`Tool not found: ${step.computeFn}`);
    }

    const args = step.computeArgs || {};
    const result = await tool.execute(args, context);

    return result;
  }

  /**
   * Execute DEEPSEEK step (bulk extraction/classification)
   */
  private async executeDeepSeekStep(step: SkillStep, context: SkillExecutionContext): Promise<any> {
    if (!step.deepseekPrompt) {
      throw new Error(`DeepSeek step ${step.id} missing deepseekPrompt`);
    }

    const client = this.getDeepSeekClient();

    // Render prompt template with variables from context
    const renderedPrompt = this.renderTemplate(step.deepseekPrompt, context);

    // Call DeepSeek
    const response = await client.call(renderedPrompt, step.deepseekSchema);

    // Track tokens
    context.metadata.tokenUsage.deepseek += response.tokens;

    // Parse JSON if schema provided
    if (step.deepseekSchema) {
      try {
        return JSON.parse(response.text);
      } catch (error) {
        console.warn(`[DeepSeek] Failed to parse JSON response, returning raw text`);
        return response.text;
      }
    }

    return response.text;
  }

  /**
   * Execute CLAUDE step (strategic reasoning with tool use)
   */
  private async executeClaudeStep(step: SkillStep, context: SkillExecutionContext): Promise<any> {
    if (!step.claudePrompt) {
      throw new Error(`Claude step ${step.id} missing claudePrompt`);
    }

    // Build system message
    const systemPrompt = this.buildClaudeSystemPrompt(step, context);

    // Render user prompt
    const userPrompt = this.renderTemplate(step.claudePrompt, context);

    // Get tools for this step
    const tools = step.claudeTools ? this.buildClaudeTools(step.claudeTools) : [];

    // Execute Claude with tool use loop
    const maxToolCalls = step.maxToolCalls || 10;
    const result = await this.executeClaudeWithTools(
      systemPrompt,
      userPrompt,
      tools,
      context,
      maxToolCalls
    );

    return result;
  }

  /**
   * Execute Claude with tool_use loop
   */
  private async executeClaudeWithTools(
    systemPrompt: string,
    userPrompt: string,
    tools: ClaudeToolDefinition[],
    context: SkillExecutionContext,
    maxToolCalls: number
  ): Promise<string> {
    const messages: ClaudeMessage[] = [
      { role: 'user', content: userPrompt },
    ];

    let toolCallCount = 0;

    while (toolCallCount < maxToolCalls) {
      // Call Claude API
      const response = await this.callClaudeAPI(systemPrompt, messages, tools);

      // Track tokens
      context.metadata.tokenUsage.claude += response.usage.input_tokens + response.usage.output_tokens;

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        // Claude is done, extract final text
        const textBlocks = response.content.filter(block => block.type === 'text');
        return textBlocks.map(block => (block as any).text).join('\n');
      }

      if (response.stop_reason === 'tool_use') {
        // Claude wants to use tools
        const toolUseBlocks = response.content.filter(block => block.type === 'tool_use') as ClaudeToolUseBlock[];

        if (toolUseBlocks.length === 0) {
          throw new Error('Claude requested tool_use but provided no tools');
        }

        // Add assistant message to conversation
        messages.push({
          role: 'assistant',
          content: response.content,
        });

        // Execute each tool call
        const toolResults: any[] = [];

        for (const toolUse of toolUseBlocks) {
          toolCallCount++;
          context.metadata.toolCallCount++;

          console.log(`[Claude Tool] ${toolUse.name} called with:`, toolUse.input);

          const tool = getToolDefinition(toolUse.name);
          if (!tool) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: `Tool not found: ${toolUse.name}` }),
            });
            continue;
          }

          try {
            const result = await tool.execute(toolUse.input, context);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: errorMsg }),
            });
          }
        }

        // Add tool results to conversation
        messages.push({
          role: 'user',
          content: toolResults,
        });

        // Continue loop - Claude will process tool results
        continue;
      }

      // Max tokens or other stop reason
      const textBlocks = response.content.filter(block => block.type === 'text');
      return textBlocks.map(block => (block as any).text).join('\n');
    }

    // Safety limit reached
    console.warn(`[Claude Tool] Max tool calls (${maxToolCalls}) reached, stopping`);
    return 'Tool use limit reached. Results may be incomplete.';
  }

  /**
   * Call Claude API
   */
  private async callClaudeAPI(
    systemPrompt: string,
    messages: ClaudeMessage[],
    tools: ClaudeToolDefinition[]
  ): Promise<ClaudeResponse> {
    const anthropic = (this.claudeClient as any).client;

    const requestBody: any = {
      model: (this.claudeClient as any).model,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: 4096,
      temperature: 0.7,
    };

    if (tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await anthropic.messages.create(requestBody);
    return response as ClaudeResponse;
  }

  /**
   * Build Claude system prompt with business context
   */
  private buildClaudeSystemPrompt(step: SkillStep, context: SkillExecutionContext): string {
    const { business_model, goals_and_targets } = context.businessContext;

    return `You are analyzing GTM data for a workspace.

Business Context:
- GTM Motion: ${(business_model as any).gtm_motion || 'unknown'}
- Avg Deal Size: $${(business_model as any).acv_range?.avg || 'unknown'}
- Sales Cycle: ${(business_model as any).sales_cycle_days || 'unknown'} days
- Revenue Target: $${(goals_and_targets as any).revenue_target || 'unknown'}
- Pipeline Coverage Target: ${(goals_and_targets as any).pipeline_coverage_target || 'unknown'}x

Your task: ${step.name}

Important:
- Be specific with deal names and numbers
- Don't generalize - use actual data
- Focus on actionable insights
- Format your response clearly`;
  }

  /**
   * Build Claude tool definitions
   */
  private buildClaudeTools(toolNames: string[]): ClaudeToolDefinition[] {
    return toolNames.map(name => {
      const tool = getToolDefinition(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }

      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      };
    });
  }

  /**
   * Render template with {{variable}} placeholders
   */
  private renderTemplate(template: string, context: SkillExecutionContext): string {
    let rendered = template;

    // Replace {{variable}} with context.stepResults[variable] or context.businessContext[variable]
    const variablePattern = /\{\{([^}]+)\}\}/g;
    const matches = template.matchAll(variablePattern);

    for (const match of matches) {
      const varPath = match[1].trim();
      const value = this.resolveVariable(varPath, context);
      rendered = rendered.replace(match[0], this.stringify(value));
    }

    return rendered;
  }

  /**
   * Resolve variable path like "goals.revenue_target" or "pipeline_summary"
   */
  private resolveVariable(path: string, context: SkillExecutionContext): any {
    const parts = path.split('.');
    let current: any = context.stepResults;

    // Try stepResults first
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        // Try businessContext
        current = context.businessContext;
        for (const part of parts) {
          if (current && typeof current === 'object' && part in current) {
            current = current[part];
          } else {
            return `{{${path}}}`;
          }
        }
        break;
      }
    }

    return current;
  }

  /**
   * Stringify value for template rendering (with size limits for prompt safety)
   */
  private stringify(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      const summarized = value.slice(0, 20).map(item => this.summarizeItem(item));
      const json = JSON.stringify(summarized, null, 2);
      if (value.length > 20) {
        return `${json}\n... and ${value.length - 20} more items (${value.length} total)`;
      }
      return json;
    }
    if (typeof value === 'object') {
      const json = JSON.stringify(value, null, 2);
      if (json.length > 8000) {
        return json.slice(0, 8000) + '\n... [truncated]';
      }
      return json;
    }
    return String(value);
  }

  private summarizeItem(item: any): any {
    if (typeof item !== 'object' || item === null) return item;
    const summary: any = {};
    const keepFields = ['name', 'deal_name', 'id', 'amount', 'stage', 'stage_normalized', 'close_date', 'owner', 'deal_risk', 'health_score', 'velocity_score', 'days_in_stage', 'last_activity_date', 'total', 'count', 'type'];
    for (const key of keepFields) {
      if (key in item) summary[key] = item[key];
    }
    if (Object.keys(summary).length === 0) {
      for (const [k, v] of Object.entries(item).slice(0, 8)) {
        summary[k] = typeof v === 'object' ? '[object]' : v;
      }
    }
    return summary;
  }

  /**
   * Sort steps by dependencies (topological sort)
   */
  private sortStepsByDependencies(steps: SkillStep[]): SkillStep[] {
    const sorted: SkillStep[] = [];
    const visited = new Set<string>();

    const visit = (step: SkillStep) => {
      if (visited.has(step.id)) return;

      // Visit dependencies first
      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          const depStep = steps.find(s => s.id === depId);
          if (depStep) {
            visit(depStep);
          }
        }
      }

      visited.add(step.id);
      sorted.push(step);
    };

    for (const step of steps) {
      visit(step);
    }

    return sorted;
  }

  /**
   * Log skill run to database
   */
  private async logSkillRun(
    runId: string,
    skillId: string,
    workspaceId: string,
    status: string,
    output?: any,
    error?: string
  ): Promise<void> {
    try {
      if (status === 'running') {
        await query(
          `INSERT INTO skill_runs (run_id, skill_id, workspace_id, status, started_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (run_id) DO NOTHING`,
          [runId, skillId, workspaceId, status]
        );
      } else {
        await query(
          `UPDATE skill_runs
           SET status = $2, output = $3, error = $4, completed_at = NOW()
           WHERE run_id = $1`,
          [runId, status, output ? JSON.stringify(output) : null, error]
        );
      }
    } catch (err) {
      console.error('[Skill Runtime] Failed to log skill run:', err);
    }
  }
}

/**
 * Singleton instance
 */
let runtime: SkillRuntime | null = null;

export function getSkillRuntime(): SkillRuntime {
  if (!runtime) {
    runtime = new SkillRuntime();
  }
  return runtime;
}
