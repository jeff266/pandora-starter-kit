/**
 * Skill Runtime Engine
 *
 * Executes skills by running their steps in dependency order, routing each step
 * to the correct AI tier via the LLM Router.
 *
 * Key responsibilities:
 * - Load business context from context layer
 * - Execute steps in topological order based on dependencies
 * - Route LLM steps through capability-based router (reason/extract/classify/generate)
 * - Handle tool_use loop with safety limits (provider-agnostic)
 * - Track tokens, duration, errors for each step
 * - Log to skill_runs table
 */

import type {
  SkillDefinition,
  SkillStep,
  SkillExecutionContext,
  SkillResult,
  SkillStepResult,
} from './types.js';
import { getToolDefinition } from './tool-definitions.js';
import { getContext, getDataFreshness } from '../context/index.js';
import {
  callLLM,
  assistantMessageFromResponse,
  toolResultMessage,
  type LLMCapability,
  type LLMCallOptions,
  type LLMResponse,
  type ToolDef,
} from '../utils/llm-router.js';
import { query } from '../db.js';
import { randomUUID } from 'crypto';

// ============================================================================
// Skill Runtime
// ============================================================================

export class SkillRuntime {
  constructor() {}

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

    const contextData = await getContext(workspaceId);
    const dataFreshness = await getDataFreshness(workspaceId);

    // Merge skill timeConfig with runtime overrides from params
    const mergedTimeConfig = {
      ...skill.timeConfig,
      ...params?.timeConfig,
    };

    const businessContext = {
      business_model: contextData?.business_model || {},
      team_structure: contextData?.team_structure || {},
      goals_and_targets: contextData?.goals_and_targets || {},
      definitions: contextData?.definitions || {},
      operational_maturity: contextData?.operational_maturity || {},
      timeConfig: mergedTimeConfig,
      dataFreshness,
    };

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

    await this.logSkillRun(runId, skill.id, workspaceId, 'running');

    const stepResults: SkillStepResult[] = [];
    let finalOutput: any = null;

    try {
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
            tokenUsage: 0,
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

      const lastStep = sortedSteps[sortedSteps.length - 1];
      finalOutput = context.stepResults[lastStep.outputKey];

      await this.logSkillRun(runId, skill.id, workspaceId, 'completed', finalOutput);

      return {
        runId,
        skillId: skill.id,
        workspaceId,
        status: context.metadata.errors.length === 0 ? 'completed' : 'partial',
        output: finalOutput,
        outputFormat: skill.outputFormat,
        steps: stepResults,
        stepData: context.stepResults,
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

  // ============================================================================
  // Token Budget Guardrails
  // ============================================================================

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private validateInputSize(step: SkillStep, context: SkillExecutionContext): void {
    if (step.tier === 'compute') return;

    const prompt = step.tier === 'claude' ? step.claudePrompt : step.deepseekPrompt;
    if (!prompt) return;

    const rendered = this.renderTemplate(prompt, context);
    const estimatedTokens = this.estimateTokens(rendered);

    if (step.tier === 'deepseek') {
      for (const [key, value] of Object.entries(context.stepResults)) {
        if (Array.isArray(value) && value.length > 30) {
          throw new Error(
            `DeepSeek step '${step.id}' receives array '${key}' with ${value.length} items (max 30). Add a compute step to filter/rank before classification.`
          );
        }
      }
    }

    if (estimatedTokens > 20000) {
      throw new Error(
        `${step.tier} step '${step.id}' input exceeds 20K token limit (${estimatedTokens} estimated). Add more compute aggregation steps to reduce data volume.`
      );
    }

    if (estimatedTokens > 8000) {
      console.warn(
        `[Skill Runtime] WARNING: ${step.tier} step '${step.id}' input is ${estimatedTokens} estimated tokens (target <8K). Consider adding more compute aggregation.`
      );
    }
  }

  // ============================================================================
  // Step Execution
  // ============================================================================

  private async executeStep(step: SkillStep, context: SkillExecutionContext): Promise<any> {
    this.validateInputSize(step, context);

    switch (step.tier) {
      case 'compute':
        return this.executeComputeStep(step, context);
      case 'deepseek':
        return this.executeLLMStep(step, context, 'extract');
      case 'claude':
        return this.executeLLMStep(step, context, 'reason');
      default:
        throw new Error(`Unknown step tier: ${step.tier}`);
    }
  }

  private async executeComputeStep(step: SkillStep, context: SkillExecutionContext): Promise<any> {
    if (!step.computeFn) {
      throw new Error(`Compute step ${step.id} missing computeFn`);
    }

    const tool = getToolDefinition(step.computeFn);
    if (!tool) {
      throw new Error(`Tool not found: ${step.computeFn}`);
    }

    const args = step.computeArgs || {};
    return tool.execute(args, context);
  }

  /**
   * Execute an LLM step via the router (replaces executeClaudeStep + executeDeepSeekStep)
   */
  private async executeLLMStep(
    step: SkillStep,
    context: SkillExecutionContext,
    capability: LLMCapability
  ): Promise<any> {
    const prompt = step.claudePrompt || step.deepseekPrompt;
    if (!prompt) {
      throw new Error(`LLM step ${step.id} missing prompt (claudePrompt or deepseekPrompt)`);
    }

    const renderedPrompt = this.renderTemplate(prompt, context);
    const systemPrompt = this.buildSystemPrompt(step, context);

    const tools: ToolDef[] = step.claudeTools
      ? step.claudeTools.map(name => {
          const tool = getToolDefinition(name);
          if (!tool) throw new Error(`Tool not found: ${name}`);
          return {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          };
        })
      : [];

    const maxToolCalls = step.maxToolCalls || 10;

    if (tools.length === 0 && !step.claudeTools) {
      const response = await callLLM(context.workspaceId, capability, {
        systemPrompt,
        messages: [{ role: 'user', content: renderedPrompt }],
        schema: step.deepseekSchema,
        maxTokens: 4096,
        temperature: capability === 'reason' ? 0.7 : 0.1,
      });

      const totalTokens = response.usage.input + response.usage.output;
      this.trackTokens(context, step.tier, totalTokens);

      if (step.deepseekSchema && response.content) {
        try {
          let parsed = JSON.parse(response.content);
          const expectedType = step.deepseekSchema.type;

          if (expectedType === 'array' && !Array.isArray(parsed) && typeof parsed === 'object') {
            const expectedFields = step.deepseekSchema.items?.required as string[] | undefined;
            const arrayValues = Object.entries(parsed)
              .filter(([, v]) => Array.isArray(v) && (v as any[]).length > 0);

            let bestKey: string | null = null;
            let bestArr: any[] = [];

            if (expectedFields && expectedFields.length > 0 && arrayValues.length > 0) {
              let bestScore = -1;
              for (const [key, arr] of arrayValues) {
                const sample = (arr as any[])[0];
                if (sample && typeof sample === 'object') {
                  const matchCount = expectedFields.filter(f => f in sample).length;
                  if (matchCount > bestScore) {
                    bestScore = matchCount;
                    bestKey = key;
                    bestArr = arr as any[];
                  }
                }
              }
            }

            if (!bestKey && arrayValues.length > 0) {
              arrayValues.sort(([, a], [, b]) => (b as any[]).length - (a as any[]).length);
              bestKey = arrayValues[0][0];
              bestArr = arrayValues[0][1] as any[];
            }

            if (bestKey) {
              console.log(`[LLM Step] ${step.id} unwrapped object to array via key '${bestKey}' (${bestArr.length} items)`);
              parsed = bestArr;
            } else if (expectedFields && expectedFields.length > 0) {
              const matchCount = expectedFields.filter(f => f in parsed).length;
              if (matchCount >= Math.ceil(expectedFields.length / 2)) {
                console.log(`[LLM Step] ${step.id} wrapped single object as array (matched ${matchCount}/${expectedFields.length} expected fields)`);
                parsed = [parsed];
              } else {
                console.warn(`[LLM Step] ${step.id} expected array but got object (keys: ${Object.keys(parsed).slice(0, 5).join(', ')})`);
              }
            } else {
              console.warn(`[LLM Step] ${step.id} expected array but got object with no array values`);
            }
          }

          const shape = Array.isArray(parsed) ? `array[${parsed.length}]` : typeof parsed;
          console.log(`[LLM Step] ${step.id} parsed JSON: ${shape}`);
          return parsed;
        } catch {
          console.warn(`[LLM Step] Failed to parse JSON from ${capability}, returning raw text (${response.content.length} chars)`);
          return response.content;
        }
      }

      return response.content;
    }

    return this.executeLLMWithToolLoop(
      context,
      capability,
      systemPrompt,
      renderedPrompt,
      tools,
      maxToolCalls,
      step.tier
    );
  }

  /**
   * Provider-agnostic tool_use loop
   */
  private async executeLLMWithToolLoop(
    context: SkillExecutionContext,
    capability: LLMCapability,
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDef[],
    maxToolCalls: number,
    tier: string
  ): Promise<string> {
    const messages: LLMCallOptions['messages'] = [
      { role: 'user', content: userPrompt },
    ];

    let toolCallCount = 0;

    while (toolCallCount < maxToolCalls) {
      const response = await callLLM(context.workspaceId, capability, {
        systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: 4096,
        temperature: capability === 'reason' ? 0.7 : 0.1,
      });

      const totalTokens = response.usage.input + response.usage.output;
      this.trackTokens(context, tier, totalTokens);

      if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
        return response.content;
      }

      if (response.stopReason === 'tool_use' && response.toolCalls) {
        messages.push(assistantMessageFromResponse(response));

        for (const toolCall of response.toolCalls) {
          toolCallCount++;
          context.metadata.toolCallCount++;

          console.log(`[LLM Tool] ${toolCall.name} called with:`, toolCall.input);

          const tool = getToolDefinition(toolCall.name);
          if (!tool) {
            messages.push(toolResultMessage(toolCall.id, JSON.stringify({ error: `Tool not found: ${toolCall.name}` })));
            continue;
          }

          try {
            const result = await tool.execute(toolCall.input, context);
            messages.push(toolResultMessage(toolCall.id, JSON.stringify(result)));
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            messages.push(toolResultMessage(toolCall.id, JSON.stringify({ error: errorMsg })));
          }
        }

        continue;
      }

      return response.content;
    }

    console.warn(`[LLM Tool] Max tool calls (${maxToolCalls}) reached, making final call without tools`);
    messages.push({
      role: 'user',
      content: 'You have used all available tool calls. Please provide your final analysis now based on the data you have gathered so far. Do not request any more tools.',
    });
    const finalResponse = await callLLM(context.workspaceId, capability, {
      systemPrompt,
      messages,
      maxTokens: 4096,
      temperature: capability === 'reason' ? 0.7 : 0.1,
    });
    this.trackTokens(context, tier, finalResponse.usage.input + finalResponse.usage.output);
    return finalResponse.content;
  }

  private trackTokens(context: SkillExecutionContext, tier: string, tokens: number): void {
    if (tier === 'claude') {
      context.metadata.tokenUsage.claude += tokens;
    } else if (tier === 'deepseek') {
      context.metadata.tokenUsage.deepseek += tokens;
    }
  }

  // ============================================================================
  // System Prompt & Template Rendering
  // ============================================================================

  private buildSystemPrompt(step: SkillStep, context: SkillExecutionContext): string {
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

  private renderTemplate(template: string, context: SkillExecutionContext): string {
    let rendered = template;

    const variablePattern = /\{\{([^}]+)\}\}/g;
    const matches = template.matchAll(variablePattern);

    for (const match of matches) {
      const varPath = match[1].trim();
      const value = this.resolveVariable(varPath, context);
      rendered = rendered.replace(match[0], this.stringify(value));
    }

    return rendered;
  }

  private resolveVariable(path: string, context: SkillExecutionContext): any {
    const parts = path.split('.');
    let current: any = context.stepResults;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
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
    const keepFields = ['name', 'deal_name', 'dealName', 'dealId', 'id', 'amount', 'stage', 'stage_normalized', 'close_date', 'owner', 'deal_risk', 'health_score', 'velocity_score', 'days_in_stage', 'last_activity_date', 'total', 'count', 'type', 'risk_level', 'likely_cause', 'has_expansion_contacts', 'recommended_action', 'root_cause', 'suggested_action', 'contactCount', 'contactNames'];
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

  // ============================================================================
  // Dependency Sorting
  // ============================================================================

  private sortStepsByDependencies(steps: SkillStep[]): SkillStep[] {
    const sorted: SkillStep[] = [];
    const visited = new Set<string>();

    const visit = (step: SkillStep) => {
      if (visited.has(step.id)) return;

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

  // ============================================================================
  // Database Logging
  // ============================================================================

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
