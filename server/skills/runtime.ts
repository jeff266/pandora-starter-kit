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
import { buildWorkspaceContextBlock } from '../context/workspace-memory.js';
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
import { processFindingPersistence } from '../findings/persistence-engine.js';
import { parseActionsFromOutput, insertExtractedActions } from '../actions/index.js';
import { getConsultantContext } from './consultant-context.js';
import { goalService } from '../goals/goal-service.js';
import { motionService } from '../goals/motion-service.js';
import pool from '../db.js';
import { buildQueryScope } from '../context/query-scope.js';
import { getMethodologyConfigResolver } from '../methodology/config-resolver.js';
import crypto from 'crypto';
import { PANDORA_VOICE_STANDARD } from '../lib/voice-standard.js';

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

const QUERY_TOOLS = new Set([
  'query_deals', 'query_contacts', 'query_accounts',
  'query_conversations', 'compute_metric',
]);

function trimSkillOutput(output: any): any {
  if (!output || typeof output !== 'object') return output;

  const trimmed = { ...output };

  if (trimmed.transcript_text) {
    trimmed.transcript_text = '[trimmed]';
  }
  if (trimmed.trimmed_conversations) {
    delete trimmed.trimmed_conversations;
  }
  if (trimmed.recent_conversations) {
    trimmed.recent_conversations = Array.isArray(trimmed.recent_conversations)
      ? trimmed.recent_conversations
          .slice(0, 3)
          .map((c: any) => ({
            id: c.id,
            title: c.title,
            started_at: c.started_at,
            duration_seconds: c.duration_seconds,
          }))
      : trimmed.recent_conversations;
  }

  for (const [key, val] of Object.entries(trimmed)) {
    if (Array.isArray(val) && val.length > 50) {
      (trimmed as any)[key] = val.slice(0, 50);
      console.log(
        `[SkillOutput] Trimmed ${key} from ${val.length} to 50 items`
      );
    }
  }

  return trimmed;
}

function isQueryTool(toolName: string): boolean {
  return QUERY_TOOLS.has(toolName);
}

export class SkillRuntime {
  constructor() {}

  /**
   * Execute a skill
   */
  async executeSkill(
    skill: SkillDefinition,
    workspaceId: string,
    params?: any,
    userId?: string,
    onStep?: (stepId: string, stepName: string) => void
  ): Promise<SkillResult> {
    const runId = randomUUID();
    const startTime = Date.now();

    console.log(`[Skill Runtime] Starting ${skill.id} for workspace ${workspaceId}, runId: ${runId}`);

    const [contextData, dataFreshness, activeTargetsResult, workspaceContextBlock, queryScope, workspaceConfig] = await Promise.all([
      getContext(workspaceId),
      getDataFreshness(workspaceId),
      query(
        `SELECT pipeline_name, amount, metric, period_label, period_start, period_end
         FROM targets WHERE workspace_id = $1 AND is_active = true
         ORDER BY period_start ASC`,
        [workspaceId]
      ).catch(() => ({ rows: [] })),
      buildWorkspaceContextBlock(workspaceId, userId).catch(() => ''),
      buildQueryScope(workspaceId, userId),
      configLoader.getConfig(workspaceId).catch(() => null),
    ]);

    // Merge skill timeConfig with runtime overrides from params
    const mergedTimeConfig = {
      ...skill.timeConfig,
      ...params?.timeConfig,
    };

    let voiceBlock = '';
    try {
      const voiceConfig = await configLoader.getVoiceConfig(workspaceId);
      voiceBlock = (voiceConfig as any).promptBlock ?? '';
    } catch (err) {
      console.warn(`[Skill Runtime] Failed to load voice config for ${workspaceId}, using defaults`);
    }

    // Fetch consultant call context (non-blocking, non-fatal)
    let consultantContextBlock = '';
    try {
      const cc = await getConsultantContext(workspaceId);
      if (cc) consultantContextBlock = cc;
    } catch (err) {
      console.warn(`[Skill Runtime] Failed to load consultant context for ${workspaceId}`);
    }

    // Resolve methodology config (non-blocking, non-fatal)
    let methodologyBlock = '';
    let methodologyConfigId: string | null = null;
    let methodologyConfigVersion: number | null = null;
    let methodologyContextSnapshot: any = null;

    try {
      const configResolver = getMethodologyConfigResolver();

      // Try to resolve based on deal context if available in params
      const deal = params?.deal;
      const methodologyConfig = await configResolver.resolve(workspaceId, {
        segment: deal?.segment,
        product: deal?.product
      });

      if (methodologyConfig) {
        methodologyConfigId = methodologyConfig.id;
        methodologyConfigVersion = methodologyConfig.version;

        const mergedConfig = await configResolver.getMergedConfig(methodologyConfig.id);

        // Build METHODOLOGY_CONTEXT block
        const sections: string[] = [];
        sections.push('\n\nMETHODOLOGY_CONTEXT:');
        sections.push(`Framework: ${mergedConfig.base_methodology} (${mergedConfig.display_name || 'Standard'})`);
        sections.push(`Version: ${mergedConfig.version} | Scope: ${mergedConfig.scope_type}`);
        sections.push('');

        if (mergedConfig.config?.problem_definition) {
          sections.push('PROBLEM DEFINITION:');
          sections.push(mergedConfig.config.problem_definition);
          sections.push('');
        }

        if (mergedConfig.config?.champion_signals) {
          sections.push('CHAMPION SIGNALS:');
          sections.push(mergedConfig.config.champion_signals);
          sections.push('');
        }

        if (mergedConfig.config?.economic_buyer_signals) {
          sections.push('ECONOMIC BUYER SIGNALS:');
          sections.push(mergedConfig.config.economic_buyer_signals);
          sections.push('');
        }

        if (mergedConfig.config?.disqualifying_signals) {
          sections.push('DISQUALIFYING SIGNALS:');
          sections.push(mergedConfig.config.disqualifying_signals);
          sections.push('');
        }

        if ((mergedConfig.config?.qualifying_questions?.length ?? 0) > 0) {
          sections.push('QUALIFYING QUESTIONS:');
          sections.push(mergedConfig.config.qualifying_questions!.join('\n'));
          sections.push('');
        }

        if (mergedConfig.config?.stage_criteria && Object.keys(mergedConfig.config.stage_criteria).length > 0) {
          sections.push('STAGE ADVANCEMENT CRITERIA:');
          sections.push(JSON.stringify(mergedConfig.config.stage_criteria, null, 2));
          sections.push('');
        }

        if (mergedConfig.config?.framework_fields && Object.keys(mergedConfig.config.framework_fields).length > 0) {
          sections.push('FRAMEWORK FIELD DETECTION HINTS:');
          for (const [fieldKey, fieldConfig] of Object.entries(mergedConfig.config.framework_fields as any)) {
            const fc = fieldConfig as any;
            if (fc?.detection_hints) {
              sections.push(`${fieldKey}: ${fc.detection_hints}`);
            }
          }
          sections.push('');
        }

        methodologyBlock = sections.join('\n');

        // Token cap enforcement (2000 token limit, ~4 chars per token)
        const estimatedTokens = Math.ceil(methodologyBlock.length / 4);
        if (estimatedTokens > 2000) {
          const tokenOverage = estimatedTokens - 2000;
          const maxChars = 2000 * 4; // ~8000 chars
          methodologyBlock = methodologyBlock.slice(0, maxChars) +
            `\n\n[Methodology config truncated — ${tokenOverage} tokens over limit. Edit in Settings → Methodology to reduce.]`;
          console.warn(`[Skill Runtime] Methodology config truncated for ${workspaceId}: ${estimatedTokens} tokens → 2000 tokens`);
        }

        // Build context snapshot for skill_runs stamping
        const configHash = crypto.createHash('sha256')
          .update(JSON.stringify(mergedConfig.config))
          .digest('hex')
          .slice(0, 8);

        methodologyContextSnapshot = {
          base_methodology: mergedConfig.base_methodology,
          scope: mergedConfig.scope_type,
          version: mergedConfig.version,
          display_name: mergedConfig.display_name,
          config_hash: configHash
        };

        console.log(`[Skill Runtime] Methodology config resolved: ${mergedConfig.base_methodology} v${mergedConfig.version} (${mergedConfig.scope_type})`);
      }
    } catch (err) {
      console.warn(`[Skill Runtime] Failed to load methodology config for ${workspaceId}, continuing without it:`, err instanceof Error ? err.message : err);
      // Fallback: use static methodology from context_layer.definitions if available
      const staticMethodology = (contextData as any)?.definitions?.onboarding_Q11_methodology?.value?.methodology;
      if (staticMethodology) {
        methodologyBlock = `\n\nMETHODOLOGY: ${staticMethodology} (system default — no custom config)`;
      }
    }

    const businessContext: Record<string, any> = {
      business_model: contextData?.business_model || {},
      team_structure: contextData?.team_structure || {},
      goals_and_targets: contextData?.goals_and_targets || {},
      definitions: contextData?.definitions || {},
      operational_maturity: contextData?.operational_maturity || {},
      timeConfig: mergedTimeConfig,
      dataFreshness,
      voiceBlock,
      consultantContext: consultantContextBlock,
      active_targets: (activeTargetsResult as any).rows ?? [],
      workspaceContextBlock: workspaceContextBlock + methodologyBlock,
      methodologyConfigId,
      methodologyConfigVersion,
      methodologyContextSnapshot,
    };

    // Structured goal context (goal-aware skill prompts)
    try {
      const [activeGoals, activeMotions] = await Promise.all([
        goalService.list(workspaceId, { is_active: true }),
        motionService.list(workspaceId),
      ]);

      businessContext.motions = activeMotions.map((m) => ({
        type: m.type,
        label: m.label,
        pipeline_names: m.pipeline_names,
        thresholds: m.thresholds_override,
        funnel: m.funnel_model,
      }));

      businessContext.structured_goals = await Promise.all(
        activeGoals.map(async (goal) => {
          const [current, latestSnap] = await Promise.all([
            goalService.computeCurrentValue(workspaceId, goal),
            query(
              'SELECT * FROM goal_snapshots WHERE goal_id = $1 ORDER BY snapshot_date DESC LIMIT 1',
              [goal.id],
            ),
          ]);
          const snap = latestSnap.rows[0] as any;
          const motion = activeMotions.find((m) => m.id === goal.motion_id);
          return {
            goal_id: goal.id,
            label: goal.label,
            metric_type: goal.metric_type,
            level: goal.level,
            motion: motion
              ? { type: motion.type, label: motion.label, pipeline_names: motion.pipeline_names }
              : null,
            target: goal.target_value,
            current: current.current_value,
            attainment_pct: snap?.attainment_pct ?? 0,
            gap: snap?.gap ?? goal.target_value - current.current_value,
            trajectory: snap?.trajectory ?? 'unknown',
            days_remaining: snap?.days_remaining ?? null,
            required_run_rate: snap?.required_run_rate ?? null,
            actual_run_rate: snap?.actual_run_rate ?? null,
            projected_landing: snap?.projected_landing ?? null,
            period: `${goal.period_start} to ${goal.period_end}`,
          };
        }),
      );
    } catch (err) {
      console.warn(
        '[BusinessContext] Could not load structured goals:',
        err instanceof Error ? err.message : err,
      );
      businessContext.structured_goals = [];
      businessContext.motions = [];
    }

    const scopeFilters = params?.scope_filters || [];

    // Resolve pipeline config for value resolution (resolveValue call sites)
    // Default to first pipeline (value_field: 'amount') so unconfigured workspaces are unaffected.
    // If the skill is running under a scope with field_overrides.value_field, override here.
    const DEFAULT_PIPELINE_CONFIG = {
      id: 'default',
      name: 'All Deals',
      type: 'new_business' as const,
      filter: { field: '1', values: ['1'] },
      coverage_target: 3.0,
      stage_probabilities: {},
      loss_values: ['closed_lost'],
      included_in_default_scope: true,
      value_field: 'amount',
      value_formula: null,
      forecast_eligible: true,
    };

    // Use first forecast-eligible pipeline (most specific), falling back to any pipeline, then default.
    // This ensures multi-pipeline workspaces use the most relevant value_field.
    const activePipelines = workspaceConfig?.pipelines ?? [];
    const basePipeline =
      activePipelines.find(p => p.forecast_eligible && p.included_in_default_scope) ??
      activePipelines[0] ??
      DEFAULT_PIPELINE_CONFIG;

    let pipelineConfig = { ...basePipeline };

    // Apply scope field_overrides if this skill was invoked for a specific scope.
    // Scope overrides win over pipeline defaults so scoped runs automatically use
    // the correct field without additional config.
    const activeScope = params?.activeScope as import('../config/scope-loader.js').ActiveScope | undefined;
    if (activeScope?.field_overrides?.value_field) {
      pipelineConfig = { ...pipelineConfig, value_field: activeScope.field_overrides.value_field };
    }
    if (activeScope?.field_overrides?.value_formula !== undefined) {
      pipelineConfig = { ...pipelineConfig, value_formula: activeScope.field_overrides.value_formula ?? null };
    }
    if (activeScope?.field_overrides?.coverage_target !== undefined) {
      pipelineConfig = { ...pipelineConfig, coverage_target: activeScope.field_overrides.coverage_target };
    }
    // stale_deal_days is exposed via context.params for tools that need it (not a PipelineConfig field)

    const context: SkillExecutionContext = {
      workspaceId,
      userId,
      skillId: skill.id,
      runId,
      businessContext,
      stepResults: {},
      params: params || {},
      scopeFilters,
      queryScope,
      pipelineConfig,
      metadata: {
        startedAt: new Date(),
        tokenUsage: {
          compute: 0,
          deepseek: 0,
          claude: 0,
          claudeCacheCreation: 0,
          claudeCacheRead: 0,
        } as any,
        toolCallCount: 0,
        errors: [],
      },
    };

    await this.logSkillRun(
      runId,
      skill.id,
      workspaceId,
      'running',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      methodologyConfigId,
      methodologyConfigVersion,
      methodologyContextSnapshot
    );

    const stepResults: SkillStepResult[] = [];
    let finalOutput: any = null;

    try {
      const sortedSteps = this.sortStepsByDependencies(skill.steps);

      for (const step of sortedSteps) {
        const stepStartTime = Date.now();

        try {
          console.log(`[Skill Runtime] Executing step: ${step.id} (${step.tier})`);

          // Fire onStep callback so callers can stream progress to the frontend
          try { onStep?.(step.id, step.name || step.id); } catch {}

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

      const annotations = context.stepResults.final_annotations;
      const annotationsList = Array.isArray(annotations) && annotations.length > 0 ? annotations : null;
      const annotationsMetadata = annotationsList ? {
        total_before_filter: (context.metadata as any).totalAnnotationsBeforeFilter || 0,
        total_active: annotationsList.length,
      } : null;

      if (annotationsList) {
        console.log(`[Skill Runtime] Storing ${annotationsList.length} annotations in output`);
      }

      await this.logSkillRun(
        runId,
        skill.id,
        workspaceId,
        'completed',
        finalOutput,
        undefined,
        context.metadata.tokenUsage,
        evidence,
        annotationsList,
        annotationsMetadata,
        Date.now() - startTime,
        methodologyConfigId,
        methodologyConfigVersion,
        methodologyContextSnapshot,
        stepResults
      );

      try {
        const findings = await extractFindings(skill.id, runId, workspaceId, context.stepResults);
        if (findings.length > 0) {
          const insertedFindings = await insertFindings(findings);
          console.log(`[Findings] Extracted ${insertedFindings.length} findings from ${skill.id} run ${runId}`);
          processFindingPersistence(workspaceId, runId, skill.id, insertedFindings).catch((err) =>
            console.error('[Persistence] engine error:', err instanceof Error ? err.message : err),
          );
          import('../webhooks/deal-events.js')
            .then(m => m.emitDealFlaggedEvents(workspaceId, insertedFindings, skill.id))
            .catch(() => {});
        }
      } catch (err) {
        console.error(`[Findings] Extraction failed for ${skill.id}:`, err instanceof Error ? err.message : err);
      }

      try {
        let totalActionsCreated = 0;

        // Extract actions from <actions> block in Claude output
        if (finalOutput) {
          const actionSearchText = typeof finalOutput === 'string'
            ? finalOutput
            : (finalOutput?.narrative ?? finalOutput?.output_text ?? '');
          const extractedActions = parseActionsFromOutput(actionSearchText);
          if (extractedActions.length > 0) {
            const insertedCount = await insertExtractedActions(
              pool, workspaceId, skill.id, runId, null, extractedActions
            );
            console.log(`[Actions] Extracted ${insertedCount} actions from ${skill.id} run ${runId}`);
            totalActionsCreated += insertedCount;
          }
        }

        // Run registered action generator if one exists for this skill
        try {
          const { getActionGenerator } = await import('./action-generators/index.js');
          const actionGenerator = getActionGenerator(skill.id);
          if (actionGenerator) {
            const generatedCount = await actionGenerator(
              pool,
              workspaceId,
              runId,
              stepResults,
              (contextData ?? {}) as Record<string, any>
            );
            if (generatedCount > 0) {
              console.log(`[Actions] Generated ${generatedCount} actions programmatically from ${skill.id} run ${runId}`);
              totalActionsCreated += generatedCount;
            }
          }
        } catch (err) {
          console.error(`[Actions] Action generator failed for ${skill.id}:`, err instanceof Error ? err.message : err);
        }

        // Emit webhook events if any actions were created
        if (totalActionsCreated > 0) {
          import('../webhooks/action-events.js')
            .then(m => m.emitActionCreatedEvents(workspaceId, skill.id, runId))
            .catch(() => {});
        }
      } catch (err) {
        console.error(`[Actions] Extraction failed for ${skill.id}:`, err instanceof Error ? err.message : err);
      }

      // Push API: fire skill_run delivery triggers (fire-and-forget)
      try {
        const { onSkillRunCompleted } = await import('../push/trigger-manager.js');
        onSkillRunCompleted(workspaceId, skill.id, runId);
      } catch {
        // Non-fatal — push trigger failure never blocks skill completion
      }

      // Workflow Rules: evaluate workflow rules triggered by skill completion (fire-and-forget)
      try {
        const { workflowTriggerManager } = await import('../workflow/trigger-manager.js');
        // Get findings created by this skill run
        const { query: dbQuery } = await import('../db.js');
        const findingsResult = await dbQuery(
          `SELECT id, workspace_id, category, severity, title, summary, metadata, deal_id
           FROM findings
           WHERE workspace_id = $1 AND skill_run_id = $2`,
          [workspaceId, runId]
        );
        workflowTriggerManager.onSkillRunComplete(runId, workspaceId, findingsResult.rows as any);
      } catch {
        // Non-fatal — workflow trigger failure never blocks skill completion
      }

      // CRM Write-back: trigger write-back for mappings with after_skill_run sync trigger
      try {
        const { query } = await import('../db.js');
        const mappingsCheck = await query(
          `SELECT COUNT(*) as count FROM crm_property_mappings
           WHERE workspace_id = $1 AND is_active = true AND sync_trigger = 'after_skill_run'`,
          [workspaceId]
        );
        if (mappingsCheck.rows[0]?.count > 0) {
          // Fire and forget - don't block skill completion
          import('../crm-writeback/write-engine.js').then(({ executeSkillRunWriteBack }) => {
            // Get affected entity IDs based on skill type
            // For now, this is a placeholder - would need skill-specific logic
            const affectedIds: string[] = [];
            if (affectedIds.length > 0) {
              executeSkillRunWriteBack(workspaceId, skill.id, runId, affectedIds)
                .catch(err => {
                  console.error(`[CRMWriteback] Post-skill writeback failed:`, err instanceof Error ? err.message : err);
                });
            }
          }).catch(() => {});
        }
      } catch {
        // Non-fatal — write-back failure never blocks skill completion
      }

      // Scoring state: recompute after icp-discovery completes so state transitions locked→ready→active
      if (skill.id === 'icp-discovery') {
        import('../scoring/workspace-scoring-state.js').then(({ recomputeScoringState }) => {
          recomputeScoringState(workspaceId).catch(err => {
            console.error(`[ScoringState] Post-icp-discovery recompute failed:`, err instanceof Error ? err.message : err);
          });
        }).catch(() => {});
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
        annotations: annotationsList || undefined,
        annotationsMetadata: annotationsMetadata || undefined,
      } as any;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Skill Runtime] Skill ${skill.id} failed:`, errorMsg);

      await this.logSkillRun(
        runId,
        skill.id,
        workspaceId,
        'failed',
        null,
        errorMsg,
        undefined,
        undefined,
        undefined,
        undefined,
        Date.now() - startTime,
        methodologyConfigId,
        methodologyConfigVersion,
        methodologyContextSnapshot,
        stepResults.length > 0 ? stepResults : undefined
      );

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
      // Dynamic fallback 1: workspace_saved_queries by name
      try {
        const sq = await query(
          `SELECT sql_text FROM workspace_saved_queries WHERE workspace_id = $1 AND name = $2 LIMIT 1`,
          [context.workspaceId, step.computeFn]
        );
        if (sq.rows.length > 0) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL app.current_workspace_id = '${context.workspaceId}'`);
            await client.query('SET LOCAL statement_timeout = 10000');
            await client.query('SET LOCAL ROLE pandora_rls_user');
            const r = await client.query(sq.rows[0].sql_text);
            await client.query('COMMIT');
            return { rows: r.rows, count: r.rowCount, source: 'saved_query' };
          } catch (e) {
            await client.query('ROLLBACK');
            throw e;
          } finally {
            client.release();
          }
        }
      } catch (_) {}

      // Dynamic fallback 2: inline_sql stored on custom_skills row
      try {
        const cs = await query(
          `SELECT inline_sql FROM custom_skills WHERE workspace_id = $1 AND skill_id = $2 AND query_source = 'inline_sql' LIMIT 1`,
          [context.workspaceId, step.computeFn]
        );
        if (cs.rows.length > 0 && cs.rows[0].inline_sql) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL app.current_workspace_id = '${context.workspaceId}'`);
            await client.query('SET LOCAL statement_timeout = 10000');
            await client.query('SET LOCAL ROLE pandora_rls_user');
            const r = await client.query(cs.rows[0].inline_sql);
            await client.query('COMMIT');
            return { rows: r.rows, count: r.rowCount, source: 'inline_sql' };
          } catch (e) {
            await client.query('ROLLBACK');
            throw e;
          } finally {
            client.release();
          }
        }
      } catch (_) {}

      throw new Error(`Tool not found: ${step.computeFn}`);
    }

    const args = step.computeArgs || {};
    const start = Date.now();
    let result: any;
    let errorMsg: string | undefined;
    try {
      result = await tool.execute(args, context);
      return result;
    } catch (err: any) {
      errorMsg = err.message || String(err);
      throw err;
    } finally {
      const { logToolCall } = await import('../chat/tool-logger.js');
      logToolCall({
        workspace_id: context.workspaceId,
        tool_name: step.computeFn,
        called_by: 'skill_run',
        skill_id: (context as any).skillId ?? (context as any).skill?.id,
        duration_ms: Date.now() - start,
        result_empty: result == null,
        error: errorMsg,
      });
    }
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

            if (!bestKey && expectedFields && expectedFields.length > 0) {
              const selfMatchCount = expectedFields.filter(f => f in parsed).length;
              if (selfMatchCount >= Math.ceil(expectedFields.length / 2)) {
                console.log(`[LLM Step] ${step.id} wrapped single object as array (matched ${selfMatchCount}/${expectedFields.length} expected fields)`);
                parsed = [parsed];
              } else if (arrayValues.length > 0) {
                arrayValues.sort(([, a], [, b]) => (b as any[]).length - (a as any[]).length);
                bestKey = arrayValues[0][0];
                bestArr = arrayValues[0][1] as any[];
              }
            } else if (!bestKey && arrayValues.length > 0) {
              arrayValues.sort(([, a], [, b]) => (b as any[]).length - (a as any[]).length);
              bestKey = arrayValues[0][0];
              bestArr = arrayValues[0][1] as any[];
            }

            if (bestKey) {
              console.log(`[LLM Step] ${step.id} unwrapped object to array via key '${bestKey}' (${bestArr.length} items)`);
              parsed = bestArr;
            } else if (!Array.isArray(parsed)) {
              console.warn(`[LLM Step] ${step.id} expected array but got object (keys: ${Object.keys(parsed).slice(0, 5).join(', ')})`);
            }
          }

          const shape = Array.isArray(parsed) ? `array[${parsed.length}]` : typeof parsed;
          console.log(`[LLM Step] ${step.id} parsed JSON: ${shape}`);

          if (expectedType === 'array' && (!Array.isArray(parsed) || parsed.length < 3)) {
            console.error(`[LLM Step] ${step.id} parse quality warning — expected array, got: ${typeof parsed}, length: ${Array.isArray(parsed) ? parsed.length : 'N/A'}`);
          }

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
            const toolInput = { ...toolCall.input };
            if (context.scopeFilters && context.scopeFilters.length > 0 && isQueryTool(toolCall.name)) {
              const existing = toolInput.named_filters ||
                (toolInput.named_filter ? [toolInput.named_filter] : []);
              toolInput.named_filters = [...new Set([...context.scopeFilters, ...existing])];
              delete toolInput.named_filter;
            }
            const result = await tool.execute(toolInput, context);
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
      (context.metadata.tokenUsage as any).claudeCacheCreation += usage.cacheCreation || 0;
      (context.metadata.tokenUsage as any).claudeCacheRead += usage.cacheRead || 0;
    } else if (tier === 'deepseek') {
      context.metadata.tokenUsage.deepseek += totalTokens;
    }
  }

  // ============================================================================
  // System Prompt & Template Rendering
  // ============================================================================

  private buildSystemPrompt(step: SkillStep, context: SkillExecutionContext): string {
    const { business_model, goals_and_targets, consultantContext } = context.businessContext as any;

    const consultantBlock = consultantContext ? `\n\n${consultantContext}` : '';

    const scopeBlock = this.buildScopeNotice(context);

    return `${PANDORA_VOICE_STANDARD}

You are analyzing GTM data for a workspace.

Business Context:
- GTM Motion: ${(business_model as any).gtm_motion || 'unknown'}
- Avg Deal Size: $${(business_model as any).acv_range?.avg || 'unknown'}
- Sales Cycle: ${(business_model as any).sales_cycle_days || 'unknown'} days
- Revenue Target: $${(goals_and_targets as any).revenue_target || 'unknown'}
- Pipeline Coverage Target: ${(goals_and_targets as any).pipeline_coverage_target || 'unknown'}x${consultantBlock}${scopeBlock}

Your task: ${step.name}

Important:
- Be specific with deal names and numbers
- Don't generalize - use actual data
- Focus on actionable insights
- Format your response clearly`;
  }

  private buildScopeNotice(context: SkillExecutionContext): string {
    const appliedFilters: any[] = [];
    for (const value of Object.values(context.stepResults || {})) {
      if (value && typeof value === 'object' && '_applied_filters' in (value as any)) {
        const filters = (value as any)._applied_filters;
        if (Array.isArray(filters)) {
          appliedFilters.push(...filters);
        }
      }
    }

    if (appliedFilters.length === 0) return '';

    const seen = new Set<string>();
    const unique = appliedFilters.filter(f => {
      if (seen.has(f.filter_id)) return false;
      seen.add(f.filter_id);
      return true;
    });

    const lines = unique.map(f => {
      const confidence = f.confirmed ? 'confirmed by admin' : `confidence: ${(f.confidence * 100).toFixed(0)}%, NOT YET CONFIRMED by admin`;
      return `- "${f.filter_label}" — defined as: ${f.conditions_summary}\n  Source: ${f.filter_source} (${confidence})`;
    });

    return `\n\nSCOPE NOTICE:\nThis analysis is scoped using the following named filters:\n${lines.join('\n')}\n\nIf any filter definition seems wrong for the analysis, flag it in your synthesis.`;
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
    evidence?: SkillEvidence,
    annotations?: any,
    annotationsMetadata?: any,
    durationMs?: number,
    methodologyConfigId?: string | null,
    methodologyConfigVersion?: number | null,
    methodologyContextSnapshot?: any,
    stepResultsData?: any[]
  ): Promise<void> {
    try {
      if (status === 'running') {
        // Initial insert with methodology config stamping
        await query(
          `INSERT INTO skill_runs (
            run_id, skill_id, workspace_id, status, started_at,
            methodology_config_id, methodology_config_version, context_snapshot
          )
           VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)
           ON CONFLICT (run_id) DO NOTHING`,
          [
            runId,
            skillId,
            workspaceId,
            status,
            (methodologyConfigId && methodologyConfigId !== 'system_default') ? methodologyConfigId : null,
            methodologyConfigVersion || null,
            methodologyContextSnapshot ? JSON.stringify(methodologyContextSnapshot) : null
          ]
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
        // If the last step returned a StructuredSkillOutput ({ narrative, methodologyComparisons }),
        // unwrap it so narrative stays as the main text and comparisons go into their own field.
        const isStructuredOutput =
          output && typeof output === 'object' && !Array.isArray(output) && 'narrative' in output;
        const narrativeText = isStructuredOutput ? (output as any).narrative : output;
        const methodologyComparisons: any[] | undefined = isStructuredOutput
          ? (output as any).methodologyComparisons
          : undefined;

        // Save evidence even if output is null (e.g., when synthesis step fails)
        const resultData = (narrativeText || evidence || annotations) ? {
          ...(narrativeText !== undefined && narrativeText !== null ? { narrative: narrativeText } : {}),
          ...(evidence ? { evidence } : {}),
          ...(annotations ? { annotations } : {}),
          ...(annotationsMetadata ? { annotations_metadata: annotationsMetadata } : {}),
          ...(methodologyComparisons?.length ? { methodologyComparisons } : {}),
        } : null;

        const trimmedResultData = trimSkillOutput(resultData);

        const serialized = trimmedResultData ? JSON.stringify(trimmedResultData) : null;
        if (serialized && serialized.length > 2_000_000) {
          console.warn(
            `[SkillRuntime] Output size warning: ` +
            `${Math.round(serialized.length / 1000)}KB ` +
            `for skill ${skillId}. Consider further trimming.`
          );
        }

        await query(
          `UPDATE skill_runs
           SET status = $2, output = $3, error = $4, completed_at = NOW(),
               duration_ms = COALESCE($6, duration_ms),
               token_usage = COALESCE($5::jsonb, token_usage),
               steps = COALESCE($7::jsonb, steps)
           WHERE run_id = $1`,
          [
            runId,
            status,
            serialized,
            error,
            enhancedTokenUsage ? JSON.stringify(enhancedTokenUsage) : null,
            durationMs ?? null,
            stepResultsData && stepResultsData.length > 0 ? JSON.stringify(stepResultsData) : null,
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
