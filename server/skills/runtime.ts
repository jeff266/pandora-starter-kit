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
  SkillEvidence,
} from './types.js';
import Handlebars from 'handlebars';
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
  type TrackingContext,
} from '../utils/llm-router.js';
import { estimateCost } from '../lib/token-tracker.js';
import { query } from '../db.js';
import { randomUUID } from 'crypto';
import { getEvidenceBuilder } from './evidence-builder.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { extractFindings, insertFindings } from '../findings/extractor.js';
import { parseActionsFromOutput, insertExtractedActions } from '../actions/extractor.js';

// ============================================================================
// Skill Runtime
// ============================================================================

Handlebars.registerHelper('multiply', (a: number, b: number) => {
  const result = Number(a) * Number(b);
  return isNaN(result) ? '0' : result.toFixed(1).replace(/\.0$/, '');
});

Handlebars.registerHelper('join', (arr: any[], sep: string) => {
  if (!Array.isArray(arr)) return '';
  return arr.join(typeof sep === 'string' ? sep : ', ');
});

Handlebars.registerHelper('formatNumber', (num: any) => {
  const n = Number(num);
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
});

Handlebars.registerHelper('json', (obj: any) => {
  return JSON.stringify(obj, null, 2);
});

Handlebars.registerHelper('lt', (a: any, b: any) => Number(a) < Number(b));
Handlebars.registerHelper('eq', (a: any, b: any) => a === b || String(a) === String(b));
Handlebars.registerHelper('gt', (a: any, b: any) => Number(a) > Number(b));

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

    let voiceBlock = '';
    try {
      const voiceConfig = await configLoader.getVoiceConfig(workspaceId);
      voiceBlock = voiceConfig.promptBlock;
    } catch (err) {
      console.warn(`[Skill Runtime] Failed to load voice config for ${workspaceId}, using defaults`);
    }

    const businessContext = {
      business_model: contextData?.business_model || {},
      team_structure: contextData?.team_structure || {},
      goals_and_targets: contextData?.goals_and_targets || {},
      definitions: contextData?.definitions || {},
      operational_maturity: contextData?.operational_maturity || {},
      timeConfig: mergedTimeConfig,
      dataFreshness,
      voiceBlock,
    };

    const context: SkillExecutionContext = {
      workspaceId,
      skillId: skill.id,
      runId,
      businessContext,
      stepResults: {},
      metadata: {
        startedAt: new Date(),
        tokenUsage: {
          compute: 0,
          deepseek: 0,
          claude: 0,
          claudeCacheCreation: 0,
          claudeCacheRead: 0,
        },
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

      // Assemble evidence from step results using registered builder
      let evidence: SkillEvidence | undefined;
      try {
        const evidenceBuilderFn = getEvidenceBuilder(skill.id);
        if (evidenceBuilderFn) {
          evidence = await evidenceBuilderFn(context.stepResults, workspaceId, businessContext);
          console.log(`[Skill Runtime] Evidence built for ${skill.id}: ${evidence.claims.length} claims, ${evidence.evaluated_records.length} records`);

          // 5MB safety truncation — prevent oversized JSONB writes
          if (evidence) {
            const evidenceSize = JSON.stringify(evidence).length;
            if (evidenceSize > 5_000_000) {
              evidence.evaluated_records = evidence.evaluated_records.slice(0, 500);
              (evidence as any)._truncated = true;
              console.warn(
                `[Skill Runtime] Evidence truncated for ${skill.id} (${evidenceSize} bytes → 500 records)`
              );
            }
          }
        }
      } catch (err) {
        console.warn(`[Skill Runtime] Evidence assembly failed for ${skill.id}:`, err instanceof Error ? err.message : err);
        // Evidence failure is non-fatal — skill still returns its output
      }

      await this.logSkillRun(runId, skill.id, workspaceId, 'completed', finalOutput, undefined, context.metadata.tokenUsage, evidence);

      try {
        const findings = extractFindings(skill.id, runId, workspaceId, context.stepResults);
        if (findings.length > 0) {
          await insertFindings(findings);
          console.log(`[Findings] Extracted ${findings.length} findings from ${skill.id} run ${runId}`);
        }
      } catch (err) {
        console.error(`[Findings] Extraction failed for ${skill.id}:`, err instanceof Error ? err.message : err);
      }

      // Extract actions from synthesis output
      try {
        if (finalOutput && typeof finalOutput === 'string') {
          const pool = (await import('../db.js')).default;
          const extractedActions = parseActionsFromOutput(finalOutput);
          if (extractedActions.length > 0) {
            await insertExtractedActions(
              pool,
              workspaceId,
              skill.id,
              runId,
              undefined, // agentRunId
              extractedActions
            );
            console.log(`[Actions] Extracted ${extractedActions.length} actions from ${skill.id} run ${runId}`);
          }
        }
      } catch (err) {
        console.error(`[Actions] Extraction failed for ${skill.id}:`, err instanceof Error ? err.message : err);
      }

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
        evidence,
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

    const tracking: TrackingContext = {
      workspaceId: context.workspaceId,
      skillId: context.skillId,
      skillRunId: context.runId,
      phase: step.tier === 'claude' ? 'synthesize' : step.tier === 'deepseek' ? 'classify' : 'compute',
      stepName: step.id,
    };

    if (tools.length === 0 && !step.claudeTools) {
      const response = await callLLM(context.workspaceId, capability, {
        systemPrompt,
        messages: [{ role: 'user', content: renderedPrompt }],
        schema: step.deepseekSchema,
        maxTokens: step.maxTokens || 4096,
        temperature: capability === 'reason' ? 0.7 : 0.1,
        _tracking: tracking,
      });

      this.trackTokens(context, step.tier, response.usage);

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
      step.tier,
      tracking,
      step.maxTokens || 4096
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
    tier: string,
    tracking?: TrackingContext,
    maxTokens: number = 4096
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
        maxTokens,
        temperature: capability === 'reason' ? 0.7 : 0.1,
        _tracking: tracking,
      });

      this.trackTokens(context, tier, response.usage);

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
      maxTokens,
      temperature: capability === 'reason' ? 0.7 : 0.1,
      _tracking: tracking,
    });
    this.trackTokens(context, tier, finalResponse.usage);
    return finalResponse.content;
  }

  private trackTokens(
    context: SkillExecutionContext,
    tier: string,
    usage: { input: number; output: number; cacheCreation?: number; cacheRead?: number }
  ): void {
    const totalTokens = usage.input + usage.output;
    if (tier === 'claude') {
      context.metadata.tokenUsage.claude += totalTokens;
      context.metadata.tokenUsage.claudeCacheCreation += usage.cacheCreation || 0;
      context.metadata.tokenUsage.claudeCacheRead += usage.cacheRead || 0;
    } else if (tier === 'deepseek') {
      context.metadata.tokenUsage.deepseek += totalTokens;
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
    const data: Record<string, any> = {};

    for (const [k, v] of Object.entries(context.businessContext || {})) {
      data[k] = v;
    }
    for (const [k, v] of Object.entries(context.stepResults || {})) {
      data[k] = v;
    }

    try {
      const compiled = Handlebars.compile(template, { noEscape: true });
      return compiled(data);
    } catch (err) {
      console.error('[Template] Handlebars compilation failed, falling back to simple replacement:', err instanceof Error ? err.message : err);
      return this.renderTemplateFallback(template, context);
    }
  }

  private renderTemplateFallback(template: string, context: SkillExecutionContext): string {
    let rendered = template;
    const variablePattern = /\{\{([^#/}][^}]*)\}\}/g;
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
    if (Array.isArray(value)) return JSON.stringify(value.slice(0, 20), null, 2);
    if (typeof value === 'object') {
      const json = JSON.stringify(value, null, 2);
      return json.length > 8000 ? json.slice(0, 8000) + '\n... [truncated]' : json;
    }
    return String(value);
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
    error?: string,
    tokenUsageData?: { compute: number; deepseek: number; claude: number; claudeCacheCreation?: number; claudeCacheRead?: number },
    evidence?: SkillEvidence
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
        const enhancedTokenUsage = tokenUsageData ? {
          claude: tokenUsageData.claude,
          deepseek: tokenUsageData.deepseek,
          compute: tokenUsageData.compute,
          claudeCacheCreation: tokenUsageData.claudeCacheCreation || 0,
          claudeCacheRead: tokenUsageData.claudeCacheRead || 0,
          total_tokens: tokenUsageData.claude + tokenUsageData.deepseek + tokenUsageData.compute,
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: estimateCost('claude-sonnet-4-5', tokenUsageData.claude, 0) +
            estimateCost('deepseek-v3p1', tokenUsageData.deepseek, 0),
          by_provider: {
            claude: tokenUsageData.claude,
            deepseek: tokenUsageData.deepseek,
          },
          by_phase: {
            compute: tokenUsageData.compute,
            classify: tokenUsageData.deepseek,
            synthesize: tokenUsageData.claude,
          },
        } : undefined;

        // Build result_data with both narrative output and evidence
        // Save evidence even if output is null (e.g., when synthesis step fails)
        const resultData = (output || evidence) ? {
          ...(output ? { narrative: output } : {}),
          ...(evidence ? { evidence } : {}),
        } : null;

        await query(
          `UPDATE skill_runs
           SET status = $2, output = $3, error = $4, completed_at = NOW(),
               token_usage = COALESCE($5::jsonb, token_usage)
           WHERE run_id = $1`,
          [
            runId,
            status,
            resultData ? JSON.stringify(resultData) : null,
            error,
            enhancedTokenUsage ? JSON.stringify(enhancedTokenUsage) : null,
          ]
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
