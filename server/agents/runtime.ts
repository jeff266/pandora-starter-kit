import { randomUUID } from 'crypto';
import type {
  AgentDefinition,
  AgentDelivery,
  AgentRunResult,
  AgentSkillResult,
  SkillOutput,
} from './types.js';
import { AgentExecutionError } from './types.js';
import type { SkillEvidence } from '../skills/types.js';
import { getAgentRegistry } from './registry.js';
import { getSkillRegistry } from '../skills/registry.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { query } from '../db.js';
import {
  callLLM,
  type LLMCapability,
  type TrackingContext,
} from '../utils/llm-router.js';
import {
  formatHeader,
  formatSection,
  formatDivider,
  formatContext,
  type SlackBlock,
} from '../connectors/slack/client.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { formatAgentWithEvidence } from '../skills/formatters/slack-formatter.js';
import { deliverToChannels, type DeliveryChannel } from './channels.js';
import { getConsultantContext } from '../skills/consultant-context.js';
import { getAgent } from './agent-service.js';
import { sanitizeForPrompt } from '../utils/sanitize-for-prompt.js';

export class AgentRuntime {
  private static instance: AgentRuntime;

  static getInstance(): AgentRuntime {
    if (!AgentRuntime.instance) {
      AgentRuntime.instance = new AgentRuntime();
    }
    return AgentRuntime.instance;
  }

  async executeAgent(
    agentId: string,
    workspaceId: string,
    options?: { dryRun?: boolean }
  ): Promise<AgentRunResult> {
    const registry = getAgentRegistry();
    let agent: AgentDefinition | undefined = registry.get(agentId);

    if (!agent) {
      const dbAgent = await getAgent(agentId, workspaceId);
      if (!dbAgent) {
        throw new AgentExecutionError(`Agent '${agentId}' not found`);
      }
      agent = {
        id: dbAgent.id,
        name: dbAgent.name,
        description: dbAgent.description || '',
        skills: (dbAgent.skill_ids || []).map(skillId => ({
          skillId,
          required: true,
          outputKey: skillId,
          cacheTtlMinutes: 30,
        })),
        synthesis: {
          enabled: true,
          provider: 'claude',
          systemPrompt: '',
          userPromptTemplate: '',
          maxTokens: 2000,
        },
        trigger: { type: 'manual' },
        delivery: { channel: 'api', format: 'markdown' },
        workspaceIds: [workspaceId],
        createdBy: 'user',
        createdAt: new Date(dbAgent.created_at),
        updatedAt: new Date(dbAgent.updated_at),
        enabled: true,
        ...(dbAgent.goal ? { goal: dbAgent.goal } : {}),
        ...(dbAgent.standing_questions?.length ? { standing_questions: dbAgent.standing_questions } : {}),
      };
    }

    if (!agent.enabled) {
      throw new AgentExecutionError(`Agent '${agentId}' is disabled`);
    }

    const runId = randomUUID();
    const startTime = Date.now();

    console.log(`[Agent ${agentId}] Starting for workspace ${workspaceId}, runId: ${runId}`);

    await this.logAgentRun(runId, agentId, workspaceId, 'running');

    const skillOutputs: Record<string, SkillOutput> = {};
    const skillResults: AgentSkillResult[] = [];
    const skillEvidence: Record<string, SkillEvidence> = {};

    try {
      for (const step of agent.skills) {
        const skillStart = Date.now();
        try {
          // Check for cached skill output
          const cacheTtl = step.cacheTtlMinutes || 30;
          const cached = await query(
            `SELECT id, output_text, result, token_usage, output
             FROM skill_runs
             WHERE workspace_id = $1
               AND skill_id = $2
               AND status = 'completed'
               AND started_at >= NOW() - ($3 || ' minutes')::interval
             ORDER BY started_at DESC
             LIMIT 1`,
            [workspaceId, step.skillId, cacheTtl]
          );

          if (cached.rows.length > 0) {
            // Reuse cached output
            const cachedRun = cached.rows[0];
            const cachedOutput = cachedRun.output_text || JSON.stringify(cachedRun.result);
            const cachedEvidence = cachedRun.output?.evidence || null;

            skillOutputs[step.outputKey] = {
              skillId: step.skillId,
              output: cachedOutput,
              summary: this.summarizeOutput(cachedOutput),
              tokenUsage: cachedRun.token_usage || null,
              duration: 0,
              cached: true,
              evidence: cachedEvidence,
            };

            if (cachedEvidence) {
              skillEvidence[step.outputKey] = cachedEvidence;
            }

            skillResults.push({
              skillId: step.skillId,
              status: 'cached',
              duration: 0,
            });

            console.log(`[Agent ${agentId}] Skill ${step.skillId} output reused from cache (${cacheTtl}min TTL)`);
            continue; // Skip execution
          }

          // No cache hit - execute skill
          const result = await this.runSkill(
            step.skillId,
            workspaceId,
            step.timeout_seconds || 120,
            step.params
          );

          const outputPreview = this.summarizeOutput(result.output);

          skillOutputs[step.outputKey] = {
            skillId: step.skillId,
            output: typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2),
            summary: outputPreview,
            tokenUsage: result.totalTokenUsage || null,
            duration: Date.now() - skillStart,
            cached: false,
            evidence: result.evidence,
          };

          // Accumulate evidence for downstream rendering (WorkbookGenerator, Command Center)
          if (result.evidence) {
            skillEvidence[step.outputKey] = result.evidence;
          }

          skillResults.push({
            skillId: step.skillId,
            status: 'completed',
            duration: Date.now() - skillStart,
          });

          console.log(`[Agent ${agentId}] Skill ${step.skillId} completed in ${Date.now() - skillStart}ms`);
        } catch (err: any) {
          const duration = Date.now() - skillStart;
          skillResults.push({
            skillId: step.skillId,
            status: 'failed',
            duration,
            error: err.message,
          });

          if (step.required) {
            console.error(`[Agent ${agentId}] Required skill ${step.skillId} failed: ${err.message}`);
            await this.logAgentRun(runId, agentId, workspaceId, 'failed', {
              error: `Required skill ${step.skillId} failed: ${err.message}`,
              skillResults,
            });
            throw new AgentExecutionError(
              `Required skill ${step.skillId} failed`,
              err
            );
          }

          console.warn(`[Agent ${agentId}] Optional skill ${step.skillId} failed, continuing: ${err.message}`);
        }
      }

      let synthesizedOutput: string | null = null;
      let synthesisTokens = { input: 0, output: 0 };
      let synthesisMode: 'goal_aware' | 'findings_dump' = 'findings_dump';

      if (agent.synthesis.enabled && Object.keys(skillOutputs).length > 0) {
        console.log(`[Agent ${agentId}] Synthesizing ${Object.keys(skillOutputs).length} skill outputs`);
        const synthesisResult = await this.synthesize(agent, skillOutputs, workspaceId, runId);
        synthesizedOutput = synthesisResult.output;
        synthesisTokens = synthesisResult.tokens;
        synthesisMode = synthesisResult.synthesisMode;
      }

      // Deliver results to channels (if not dry run)
      if (!options?.dryRun) {
        // Use new channel delivery system if agent has multi-channel support
        // Otherwise fall back to legacy single-channel delivery
        const hasMultiChannelConfig = agent.delivery && typeof (agent.delivery as any).channels !== 'undefined';

        if (hasMultiChannelConfig && synthesizedOutput) {
          const deliveryConfig = agent.delivery as any;
          await deliverToChannels(
            { runId, agentId, workspaceId, skillResults, synthesizedOutput, skillEvidence: Object.keys(skillEvidence).length > 0 ? skillEvidence : undefined } as any,
            workspaceId,
            agent.name,
            {
              channels: deliveryConfig.channels || ['slack'],
              formats: deliveryConfig.formats,
              download_ttl_hours: deliveryConfig.download_ttl_hours,
              extract_findings: deliveryConfig.extract_findings !== false,
            }
          );
        } else if (synthesizedOutput) {
          // Legacy single-channel delivery
          await this.deliver(agent.delivery, synthesizedOutput, workspaceId, agent.name, skillEvidence);
        }
      }

      const skillTokenTotal = Object.values(skillOutputs).reduce((sum, s) => {
        if (!s.tokenUsage) return sum;
        return sum + (s.tokenUsage.claude || 0) + (s.tokenUsage.deepseek || 0);
      }, 0);

      const result: AgentRunResult = {
        runId,
        agentId,
        workspaceId,
        status: skillResults.some(r => r.status === 'failed') ? 'partial' : 'completed',
        duration: Date.now() - startTime,
        skillResults,
        synthesizedOutput,
        tokenUsage: {
          skills: skillTokenTotal,
          synthesis: synthesisTokens.input + synthesisTokens.output,
          total: skillTokenTotal + synthesisTokens.input + synthesisTokens.output,
        },
        skillEvidence: Object.keys(skillEvidence).length > 0 ? skillEvidence : undefined,
      };

      await this.logAgentRun(runId, agentId, workspaceId, result.status, { ...result, synthesisMode });

      console.log(`[Agent ${agentId}] Completed in ${result.duration}ms, ${result.tokenUsage.total} tokens`);
      return result;
    } catch (err: any) {
      if (err instanceof AgentExecutionError) throw err;

      const duration = Date.now() - startTime;
      await this.logAgentRun(runId, agentId, workspaceId, 'failed', {
        error: err.message,
        skillResults,
      });
      throw new AgentExecutionError(`Agent ${agentId} failed: ${err.message}`, err);
    }
  }

  private async runSkill(
    skillId: string,
    workspaceId: string,
    timeoutSeconds: number,
    params?: Record<string, any>
  ): Promise<any> {
    const skillRegistry = getSkillRegistry();
    const skill = skillRegistry.get(skillId);
    if (!skill) {
      throw new Error(`Skill '${skillId}' not found in registry`);
    }

    const runtime = getSkillRuntime();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Skill '${skillId}' timed out after ${timeoutSeconds}s`)),
        timeoutSeconds * 1000
      );
    });

    const result = await Promise.race([
      runtime.executeSkill(skill, workspaceId, params),
      timeoutPromise,
    ]);

    if (result.status === 'failed') {
      throw new Error(result.errors?.map((e: any) => e.error).join('; ') || 'Skill execution failed');
    }

    return result;
  }

  // ── Goal-aware synthesis helpers (delegates to exported module functions) ─

  private formatSkillName(skillId: string): string {
    return formatSkillName(skillId);
  }

  private computeWordBudget(questionCount: number): number {
    return computeWordBudget(questionCount);
  }

  private compressEvidenceForSynthesis(skillOutputs: Record<string, SkillOutput>): string {
    return compressEvidenceForSynthesis(skillOutputs);
  }

  private buildGoalAwareSynthesisPrompt(
    goal: string,
    standing_questions: string[],
    skillOutputs: Record<string, SkillOutput>
  ): { systemPrompt: string; userPrompt: string } {
    return buildGoalAwareSynthesisPrompt(goal, standing_questions, skillOutputs);
  }

  private async synthesize(
    agent: AgentDefinition,
    skillOutputs: Record<string, SkillOutput>,
    workspaceId: string,
    runId: string
  ): Promise<{ output: string; tokens: { input: number; output: number } }> {
    let userPrompt = agent.synthesis.userPromptTemplate;

    for (const [key, skillOutput] of Object.entries(skillOutputs)) {
      const content = skillOutput.output || skillOutput.summary;
      const truncated = typeof content === 'string' && content.length > 8000
        ? content.slice(0, 8000) + '\n... [truncated]'
        : content;
      userPrompt = userPrompt.replace(
        new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
        sanitizeForPrompt(truncated)
      );
    }

    const allOutputs = Object.entries(skillOutputs)
      .map(([key, s]) => {
        const content = s.output || s.summary;
        const truncated = typeof content === 'string' && content.length > 6000
          ? content.slice(0, 6000) + '\n... [truncated]'
          : content;
        return `## ${s.skillId}\n${sanitizeForPrompt(truncated)}`;
      })
      .join('\n\n---\n\n');
    userPrompt = userPrompt.replace('{{skill_outputs}}', allOutputs);

    // Check DB agent first, then fall back to registry definition for goal-aware synthesis
    let systemPrompt = agent.synthesis.systemPrompt;
    let synthesisMode: 'goal_aware' | 'findings_dump' = 'findings_dump';
    try {
      const dbAgent = await getAgent(agent.id, workspaceId);
      // DB agent takes precedence; registry definition provides defaults for system agents
      const goal = (dbAgent?.goal && dbAgent.goal.trim()) ? dbAgent.goal : agent.goal;
      const standing_questions = (dbAgent?.standing_questions?.length)
        ? dbAgent.standing_questions
        : (agent.standing_questions ?? []);

      if (goal && standing_questions.length > 0) {
        const goalPrompts = this.buildGoalAwareSynthesisPrompt(goal, standing_questions, skillOutputs);
        systemPrompt = goalPrompts.systemPrompt;
        userPrompt = goalPrompts.userPrompt;
        synthesisMode = 'goal_aware';
        console.log(`[Agent ${agent.id}] Using goal-aware synthesis: "${goal}"`);
      }
    } catch (err) {
      // Non-fatal — fall through to default synthesis
    }

    // Inject consultant call context into synthesis system prompt (if available)
    try {
      const consultantContext = await getConsultantContext(workspaceId);
      if (consultantContext) {
        systemPrompt = systemPrompt + '\n\n' + consultantContext;
      }
    } catch (err) {
      // Non-fatal — consultant context is optional enrichment
    }

    const capability: LLMCapability = agent.synthesis.provider === 'claude' ? 'reason' : 'extract';

    const tracking: TrackingContext = {
      workspaceId,
      skillId: `agent:${agent.id}`,
      skillRunId: runId,
      phase: 'synthesize',
      stepName: 'agent-synthesis',
    };

    const response = await callLLM(workspaceId, capability, {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: agent.synthesis.maxTokens || 4000,
      temperature: 0.7,
      _tracking: tracking,
    });

    return {
      output: response.content,
      tokens: { input: response.usage.input, output: response.usage.output },
      synthesisMode,
    };
  }

  private async deliver(
    delivery: AgentDelivery,
    output: string,
    workspaceId: string,
    agentName: string,
    evidence?: Record<string, SkillEvidence>
  ): Promise<void> {
    switch (delivery.channel) {
      case 'slack': {
        const { sendNotification } = await import('../notifications/notification-gateway.js');

        if (delivery.format === 'slack') {
          const blocks = evidence && Object.keys(evidence).length > 0
            ? formatAgentWithEvidence(output, evidence, agentName, 0)
            : this.formatSlackBlocks(output, agentName);

          const slackAppClient = getSlackAppClient();
          const botToken = await slackAppClient.getBotToken(workspaceId);
          const channel = botToken ? await slackAppClient.getDefaultChannel(workspaceId) : null;

          const result = await sendNotification({
            workspace_id: workspaceId,
            category: 'agent_briefing_ready',
            severity: 'info',
            title: `${agentName} briefing ready`,
            body: output.slice(0, 200),
            slack_blocks: blocks,
            use_bot: !!botToken && !!channel,
            target_channel: channel || undefined,
          });

          if (result.status === 'suppressed' || result.status === 'queued') {
            console.log(`[Agent] Notification ${result.status} (${result.reason}) for workspace ${workspaceId}`);
          }
        } else {
          const result = await sendNotification({
            workspace_id: workspaceId,
            category: 'agent_briefing_ready',
            severity: 'info',
            title: `${agentName} briefing ready`,
            body: output.slice(0, 200),
            slack_text: `*${agentName}*\n\n${output}`,
          });

          if (result.status === 'suppressed' || result.status === 'queued') {
            console.log(`[Agent] Notification ${result.status} (${result.reason}) for workspace ${workspaceId}`);
          }
        }
        console.log(`[Agent] Delivered to Slack for workspace ${workspaceId}`);
        break;
      }
      case 'email':
        console.warn('[Agent] Email delivery not yet implemented');
        break;
      case 'api':
        break;
    }
  }

  private formatSlackBlocks(output: string, agentName: string): SlackBlock[] {
    const blocks: SlackBlock[] = [
      formatHeader(`${agentName}`),
      formatDivider(),
    ];

    const sections = output.split(/\n(?=#{1,3}\s)|\n(?=\d+\.\s)/);
    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      const cleaned = trimmed
        .replace(/^#{1,3}\s*/gm, '*')
        .replace(/\*\*([^*]+)\*\*/g, '*$1*');

      if (cleaned.length > 2900) {
        const chunks = cleaned.match(/.{1,2900}/gs) || [];
        for (const chunk of chunks) {
          blocks.push(formatSection(chunk));
        }
      } else {
        blocks.push(formatSection(cleaned));
      }
    }

    blocks.push(formatDivider());
    blocks.push(formatContext(`Pandora Agent | ${new Date().toISOString().slice(0, 16)} UTC`));

    return blocks;
  }

  private summarizeOutput(output: any): string {
    if (!output) return '';
    if (typeof output === 'string') return output.slice(0, 500);
    const json = JSON.stringify(output);
    return json.slice(0, 500);
  }

  private async logAgentRun(
    runId: string,
    agentId: string,
    workspaceId: string,
    status: string,
    data?: any
  ): Promise<void> {
    try {
      if (status === 'running') {
        await query(
          `INSERT INTO agent_runs (id, agent_id, workspace_id, status, started_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [runId, agentId, workspaceId, status]
        );
      } else {
        // Serialize skill evidence with size safety check
        let evidenceJson: string | null = null;
        if (data?.skillEvidence && Object.keys(data.skillEvidence).length > 0) {
          const raw = JSON.stringify(data.skillEvidence);
          if (raw.length > 5_000_000) {
            // Truncate evaluated_records if evidence exceeds 5MB
            const truncated = { ...data.skillEvidence };
            for (const [key, ev] of Object.entries(truncated) as [string, any][]) {
              if (ev.evaluated_records?.length > 500) {
                truncated[key] = { ...ev, evaluated_records: ev.evaluated_records.slice(0, 500), _truncated: true };
              }
            }
            evidenceJson = JSON.stringify(truncated);
          } else {
            evidenceJson = raw;
          }
        }

        await query(
          `UPDATE agent_runs
           SET status = $1,
               completed_at = NOW(),
               duration_ms = $2,
               skill_results = $3,
               synthesized_output = $4,
               token_usage = $5,
               error = $6,
               skill_evidence = COALESCE($8::jsonb, skill_evidence),
               synthesis_mode = COALESCE($9, synthesis_mode)
           WHERE id = $7`,
          [
            status,
            data?.duration || null,
            JSON.stringify(data?.skillResults || []),
            data?.synthesizedOutput || null,
            JSON.stringify(data?.tokenUsage || {}),
            data?.error || null,
            runId,
            evidenceJson,
            data?.synthesisMode || null,
          ]
        );
      }
    } catch (err) {
      console.error('[Agent] Failed to log run:', err);
    }
  }
}

export function getAgentRuntime(): AgentRuntime {
  return AgentRuntime.getInstance();
}

// ── Exported helpers (for unit tests and external consumers) ─────────────────

/**
 * Convert skill IDs to title case: 'pipeline-hygiene' → 'Pipeline Hygiene'
 */
export function formatSkillName(skillId: string): string {
  return skillId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Dynamic word budget: 400 base + 80 per standing question.
 * 3 questions → 640 words, 5 questions → 800 words.
 */
export function computeWordBudget(questionCount: number): number {
  return 400 + questionCount * 80;
}

/**
 * Compress multi-skill evidence into a structured summary for the synthesis prompt.
 * Prioritises critical → warning → info, takes top 5 claims per skill,
 * hard caps at 3,000 chars. Falls back to text output when no structured claims.
 */
export function compressEvidenceForSynthesis(skillOutputs: Record<string, SkillOutput>): string {
  const sections: string[] = [];

  for (const [, skillOutput] of Object.entries(skillOutputs)) {
    const skillName = formatSkillName(skillOutput.skillId);
    const claims = skillOutput.evidence?.claims ?? [];

    if (claims.length > 0) {
      const sorted = [...claims].sort((a, b) => {
        const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
        return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
      });

      const topClaims = sorted.slice(0, 5);
      const claimLines = topClaims.map(c => {
        const prefix = c.severity === 'critical' ? '⚠' : c.severity === 'warning' ? '•' : '–';
        return `${prefix} ${c.claim_text}`;
      });

      sections.push(`### ${skillName}\n${claimLines.join('\n')}`);
    } else {
      const text = (typeof skillOutput.output === 'string'
        ? skillOutput.output
        : skillOutput.summary || ''
      ).trim();
      if (text) {
        sections.push(`### ${skillName}\n${text.slice(0, 400)}${text.length > 400 ? '\n... [truncated]' : ''}`);
      }
    }
  }

  let result = sections.join('\n\n');

  if (result.length > 3000) {
    result = result.slice(0, 3000) + '\n... [additional findings truncated]';
  }

  return result || '(No findings from skill runs)';
}

/**
 * Builds the goal-aware synthesis prompt (STATUS → Q&A → ACTIONS).
 * Exported for testing. Used when the agent has a goal + standing questions.
 */
export function buildGoalAwareSynthesisPrompt(
  goal: string,
  standing_questions: string[],
  skillOutputs: Record<string, SkillOutput>
): { systemPrompt: string; userPrompt: string } {
  const compressedEvidence = compressEvidenceForSynthesis(skillOutputs);
  const wordBudget = computeWordBudget(standing_questions.length);

  const questionsBlock = standing_questions
    .map((q, i) => `**Q${i + 1}: ${q}**`)
    .join('\n\n');

  const systemPrompt = `You are a VP of Revenue Operations delivering a recurring briefing to your leadership team. Be direct, specific, and evidence-based. Every claim must reference actual deal names, rep names, or dollar amounts from the findings below. If evidence is insufficient to answer a standing question, say so in one sentence — do not speculate.`;

  const userPrompt = `YOUR MANDATE:
${goal}

SKILL FINDINGS:
${compressedEvidence}

---

Produce a briefing with exactly this structure. Do not add sections, do not reorder sections, do not combine sections.

## STATUS AGAINST GOAL
2–3 sentences. Answer directly: are we on track to achieve "${goal}"?
- Start with a verdict: "On track.", "At risk.", or "Behind."
- Follow with the single most important piece of supporting evidence.
- End with one sentence on what changed since the last run. If no prior run data exists, omit this sentence entirely — do not mention that it's missing.

## STANDING QUESTIONS
Answer each question below using evidence from the skill findings. Use specific deal names, rep names, and dollar amounts. Do not generalize. If the evidence is insufficient to answer a specific question, write one sentence saying what data would be needed — do not speculate.

${questionsBlock}

Format: bold the question, then answer in 2–4 sentences directly below it.

## THIS WEEK'S ACTIONS
List 3–5 actions. Each action must:
- Name the specific person, deal, or system involved
- State the exact action to take (not "review" or "consider" — "close", "call", "require", "configure")
- Connect directly to the goal: "${goal}"

Format: numbered list. No sub-bullets.

---

RULES:
- Every claim must be traceable to the skill findings above. No invented data.
- Dollar amounts and percentages must come directly from the evidence.
- If a standing question cannot be answered from the evidence, say so plainly.
- Actions must be specific enough that a RevOps analyst could execute them tomorrow without asking a follow-up question.
- Total word count: ${wordBudget} words maximum.`;

  return { systemPrompt, userPrompt };
}
