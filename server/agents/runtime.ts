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
  postBlocks,
  postText,
  getSlackWebhook,
  formatHeader,
  formatSection,
  formatDivider,
  formatContext,
  type SlackBlock,
} from '../connectors/slack/client.js';
import { formatAgentWithEvidence } from '../skills/formatters/slack-formatter.js';

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
    const agent = registry.get(agentId);
    if (!agent) {
      throw new AgentExecutionError(`Agent '${agentId}' not found`);
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

      if (agent.synthesis.enabled && Object.keys(skillOutputs).length > 0) {
        console.log(`[Agent ${agentId}] Synthesizing ${Object.keys(skillOutputs).length} skill outputs`);
        const synthesisResult = await this.synthesize(agent, skillOutputs, workspaceId, runId);
        synthesizedOutput = synthesisResult.output;
        synthesisTokens = synthesisResult.tokens;
      }

      if (!options?.dryRun && synthesizedOutput) {
        await this.deliver(agent.delivery, synthesizedOutput, workspaceId, agent.name, skillEvidence);
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

      await this.logAgentRun(runId, agentId, workspaceId, result.status, result);

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
        truncated
      );
    }

    const allOutputs = Object.entries(skillOutputs)
      .map(([key, s]) => {
        const content = s.output || s.summary;
        const truncated = typeof content === 'string' && content.length > 6000
          ? content.slice(0, 6000) + '\n... [truncated]'
          : content;
        return `## ${s.skillId}\n${truncated}`;
      })
      .join('\n\n---\n\n');
    userPrompt = userPrompt.replace('{{skill_outputs}}', allOutputs);

    const capability: LLMCapability = agent.synthesis.provider === 'claude' ? 'reason' : 'extract';

    const tracking: TrackingContext = {
      workspaceId,
      skillId: `agent:${agent.id}`,
      skillRunId: runId,
      phase: 'synthesize',
      stepName: 'agent-synthesis',
    };

    const response = await callLLM(workspaceId, capability, {
      systemPrompt: agent.synthesis.systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: agent.synthesis.maxTokens || 4000,
      temperature: 0.7,
      _tracking: tracking,
    });

    return {
      output: response.content,
      tokens: { input: response.usage.input, output: response.usage.output },
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
        const webhookUrl = delivery.slackWebhookUrl || await getSlackWebhook(workspaceId);
        if (!webhookUrl) {
          console.warn(`[Agent] No Slack webhook configured for workspace ${workspaceId}`);
          return;
        }

        if (delivery.format === 'slack') {
          const blocks = evidence && Object.keys(evidence).length > 0
            ? formatAgentWithEvidence(output, evidence, agentName, 0)
            : this.formatSlackBlocks(output, agentName);
          await postBlocks(webhookUrl, blocks);
        } else {
          await postText(webhookUrl, `*${agentName}*\n\n${output}`);
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
               skill_evidence = COALESCE($8::jsonb, skill_evidence)
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
