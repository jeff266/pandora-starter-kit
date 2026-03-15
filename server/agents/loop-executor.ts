/**
 * Loop Executor
 *
 * Reasoning-driven agent execution mode. Instead of running skills in a fixed sequence,
 * the agent observes, plans, and chooses which skills to run based on goal progress.
 *
 * Core loop:
 * 1. Observe evidence gathered so far
 * 2. Plan next action (run a skill OR synthesize final answer)
 * 3. Execute skill if chosen
 * 4. Evaluate progress toward goal
 * 5. Repeat until goal satisfied or max iterations reached
 */

import { callLLM } from '../utils/llm-router.js';
import { query } from '../db.js';
import { AgentDefinition, LoopIteration, LoopRunResult } from './types.js';
import { createLogger } from '../utils/logger.js';
import { extractSkillContext, buildSkillContextBlock } from '../chat/context-assembler.js';

const logger = createLogger('loop-executor');

const DEFAULT_MAX_ITERATIONS = 6;
const TOKEN_BUDGET = 80_000;  // force termination if exceeded
const TOKEN_WARNING = 60_000;

interface LoopExecutorInput {
  agent: AgentDefinition;
  workspaceId: string;
  runId: string;
  question: string;
  existingEvidence?: Record<string, any>;
}

export async function executeLoop(input: LoopExecutorInput): Promise<LoopRunResult> {
  const { agent, workspaceId, runId, question, existingEvidence } = input;
  const config = (agent as any).loop_config || {};
  const maxIterations = config.max_iterations || DEFAULT_MAX_ITERATIONS;
  const availableSkills: string[] = config.available_skills || agent.skills?.map((s: any) => s.skillId) || [];

  const iterations: LoopIteration[] = [];
  const accumulatedEvidence: Record<string, any> = { ...(existingEvidence || {}) };
  const skillsExecuted: string[] = [];
  let totalLoopTokens = 0;
  let goalSatisfied = false;

  const systemPrompt = config.planning_prompt || buildPlanningPrompt(agent, availableSkills);

  logger.info({ workspaceId, runId, question: question.slice(0, 100) }, 'Loop executor starting');

  for (let i = 0; i < maxIterations; i++) {
    // Token guard
    if (totalLoopTokens > TOKEN_BUDGET) {
      logger.warn({ totalLoopTokens, iteration: i }, 'Token budget exceeded — forcing synthesis');
      break;
    }
    if (totalLoopTokens > TOKEN_WARNING) {
      logger.warn({ totalLoopTokens }, 'Token warning threshold reached');
    }

    // Build planning input
    const planningInput = buildPlanningInput({
      question,
      iteration: i + 1,
      maxIterations,
      accumulatedEvidence,
      skillsExecuted,
      availableSkills,
      previousIterations: iterations,
    });

    // Call DeepSeek for planning (cheap reasoning model)
    let planResponse: any;
    try {
      planResponse = await callLLM(workspaceId, 'reason', {
        systemPrompt,
        messages: [{ role: 'user', content: planningInput }],
        maxTokens: 800,
        temperature: 0.2,
        _tracking: {
          workspaceId,
          phase: 'loop-planning',
          stepName: `loop-iter-${i + 1}`,
          questionText: question,
        },
      });
    } catch (err) {
      logger.error({ err, iteration: i }, 'Planning LLM call failed');
      break;
    }

    const iterTokens = (planResponse.usage?.input_tokens || 0) + (planResponse.usage?.output_tokens || 0);
    totalLoopTokens += iterTokens;

    // Parse plan
    const plan = parsePlan(planResponse.content?.[0]?.text || planResponse.content || '');

    // Check termination
    if (plan.goal_progress === 'satisfied' || plan.action === 'synthesize_and_deliver') {
      iterations.push({
        iteration: i + 1,
        observation: plan.observation || '',
        plan: 'Goal satisfied — synthesizing',
        skill_executed: null,
        evaluation: plan.evaluation || 'Sufficient evidence gathered',
        goal_progress: 'satisfied',
        tokens: iterTokens,
      });
      goalSatisfied = true;
      break;
    }

    // Execute skill if requested
    let skillOutput: any = null;
    if (plan.action === 'run_skill' && plan.skill_id) {
      // Guard: don't re-run same skill with same params
      if (skillsExecuted.includes(plan.skill_id)) {
        logger.info({ skill_id: plan.skill_id }, 'Skipping duplicate skill execution');
        plan.evaluation = `Skipped ${plan.skill_id} — already executed. Using cached results.`;
      } else {
        skillOutput = await executeSkillForLoop(workspaceId, plan.skill_id, plan.skill_params || {});
        if (skillOutput !== null) {
          accumulatedEvidence[plan.skill_id] = skillOutput;
          skillsExecuted.push(plan.skill_id);
        }
      }
    }

    iterations.push({
      iteration: i + 1,
      observation: plan.observation || '',
      plan: plan.action === 'run_skill' ? `Run ${plan.skill_id}` : plan.action || 'unknown',
      skill_executed: plan.action === 'run_skill' ? plan.skill_id : null,
      evaluation: plan.evaluation || '',
      goal_progress: plan.goal_progress || 'partial',
      tokens: iterTokens,
    });
  }

  // Final synthesis with Claude
  const synthesisPrompt = buildSynthesisPrompt(question, iterations, accumulatedEvidence);

  let synthesisResponse: any;
  try {
    synthesisResponse = await callLLM(workspaceId, 'reason', {
      systemPrompt: `You are ${agent.role || agent.name}. ${agent.goal || agent.description || ''}

Synthesize a comprehensive, evidence-based answer. Every claim must be traceable to the evidence provided.
Never invent data. If evidence is insufficient, say so directly.
Voice: direct, peer-level, no hedging. Show your math.`,
      messages: [{ role: 'user', content: synthesisPrompt }],
      maxTokens: 3000,
      temperature: 0.5,
      _tracking: {
        workspaceId,
        phase: 'loop-synthesis',
        stepName: 'final-synthesis',
        questionText: question,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Synthesis LLM call failed');
    return {
      iterations,
      termination_reason: 'error',
      total_loop_tokens: totalLoopTokens,
      final_synthesis: 'An error occurred during synthesis. Please try again.',
    };
  }

  totalLoopTokens += (synthesisResponse.usage?.input_tokens || 0) + (synthesisResponse.usage?.output_tokens || 0);

  const finalText = synthesisResponse.content?.[0]?.text || synthesisResponse.content || '';

  logger.info({
    workspaceId,
    runId,
    iterations: iterations.length,
    totalTokens: totalLoopTokens,
    termination: goalSatisfied ? 'goal_satisfied' : 'max_iterations',
  }, 'Loop executor complete');

  logger.info({
    finalTextLength: finalText?.length,
    finalTextPreview: finalText?.slice(0, 100),
    termination: goalSatisfied ? 'goal_satisfied' : 'max_iterations',
  }, 'Loop executor returning result');

  return {
    iterations,
    termination_reason: totalLoopTokens > TOKEN_BUDGET
      ? 'token_limit'
      : goalSatisfied
        ? 'goal_satisfied'
        : 'max_iterations',
    total_loop_tokens: totalLoopTokens,
    final_synthesis: finalText,
  };
}

// Resolve skill output from DB row — prefers structured `output` JSONB column,
// falls back to legacy `output_text` / `result` columns.
function resolveSkillOutput(row: { output_text?: string | null; result?: string | null; output?: unknown }): unknown {
  if (row.output && typeof row.output === 'object' && !Array.isArray(row.output)) {
    const structured = row.output as Record<string, unknown>;
    if ('narrative' in structured) {
      return structured;
    }
  }
  return row.output_text || row.result || null;
}

// Execute a skill and return its output for the loop
async function executeSkillForLoop(
  workspaceId: string,
  skillId: string,
  params: Record<string, any>
): Promise<any> {
  try {
    // First check for recent cached output (within 60 minutes)
    const cached = await query(
      `SELECT output_text, result, output FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
         AND started_at >= NOW() - INTERVAL '60 minutes'
       ORDER BY started_at DESC LIMIT 1`,
      [workspaceId, skillId]
    );

    if (cached.rows.length > 0) {
      logger.info({ skillId }, 'Using cached skill output');
      return resolveSkillOutput(cached.rows[0]);
    }

    // If no cache, check for any recent output (within 24 hours)
    const recent = await query(
      `SELECT output_text, result, output, started_at FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
       ORDER BY started_at DESC LIMIT 1`,
      [workspaceId, skillId]
    );

    if (recent.rows.length > 0) {
      logger.info({ skillId, age: recent.rows[0].started_at }, 'Using recent (>60min) skill output');
      return resolveSkillOutput(recent.rows[0]);
    }

    // No cached output — log and return null (loop will note unavailability)
    logger.info({ skillId }, 'No cached skill output available — skill has not run recently');
    return null;

  } catch (err) {
    logger.error({ err, skillId }, 'Error fetching skill output for loop');
    return null;
  }
}

// Helper: Build the planning system prompt
function buildPlanningPrompt(agent: AgentDefinition, availableSkills: string[]): string {
  return `You are ${(agent as any).role || agent.name}.

YOUR GOAL: ${agent.goal || agent.description || 'Analyze the data and provide insights.'}

You are in a reasoning loop. Each iteration you:
1. OBSERVE what evidence you have gathered so far
2. PLAN what to investigate next
3. Decide: run a skill OR synthesize your final answer

Respond ONLY in valid JSON with this exact structure:
{
  "observation": "What I notice about current evidence...",
  "reasoning": "What I need to find out next and why...",
  "action": "run_skill" | "synthesize_and_deliver",
  "skill_id": "skill-id-if-running" | null,
  "skill_params": {} | null,
  "evaluation": "What I learned from the last step...",
  "goal_progress": "none" | "partial" | "satisfied"
}

AVAILABLE SKILLS:
${availableSkills.map(s => `- ${s}`).join('\n') || '(none specified — use synthesize_and_deliver)'}

RULES:
- Do NOT re-run a skill already in the skills_executed list
- If you have enough evidence, set action to "synthesize_and_deliver"
- Be efficient — every iteration costs tokens
- If a skill returned null, it has no cached data — don't retry it
- Set goal_progress to "satisfied" when you can answer the question fully`;
}

// Helper: Build the planning input for each iteration
function buildPlanningInput(params: {
  question: string;
  iteration: number;
  maxIterations: number;
  accumulatedEvidence: Record<string, any>;
  skillsExecuted: string[];
  availableSkills: string[];
  previousIterations: LoopIteration[];
}): string {
  const { text: evidenceSummary } = buildSkillContextBlock(params.accumulatedEvidence, 500, 6000);

  const previousSummary = params.previousIterations
    .map(it => `Step ${it.iteration}: ${it.observation} → ${it.plan} → ${it.evaluation}`)
    .join('\n');

  return `QUESTION: ${params.question}

ITERATION: ${params.iteration} of ${params.maxIterations}

SKILLS ALREADY EXECUTED: ${params.skillsExecuted.join(', ') || 'none'}

PREVIOUS STEPS:
${previousSummary || 'none yet'}

EVIDENCE GATHERED SO FAR:
${evidenceSummary || 'none yet'}

What is your next action?`;
}

// Helper: Build the synthesis prompt
function buildSynthesisPrompt(
  question: string,
  iterations: LoopIteration[],
  evidence: Record<string, any>
): string {
  const { text: evidenceBlock } = buildSkillContextBlock(evidence, 750, 9000);

  const reasoningChain = iterations
    .map(it => `Step ${it.iteration}: ${it.observation} → ${it.plan} → ${it.evaluation}`)
    .join('\n');

  return `ORIGINAL QUESTION: ${question}

MY REASONING CHAIN:
${reasoningChain}

EVIDENCE GATHERED:
${evidenceBlock}

Synthesize a comprehensive answer. Cite specific evidence for every claim.
If evidence is insufficient, say so and explain what data would help.
Be direct and specific. No generic advice.`;
}

// Helper: Parse the planning LLM response
function parsePlan(content: string): any {
  try {
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // If JSON parse fails, force synthesis
    return {
      observation: content.slice(0, 200),
      reasoning: 'JSON parse failed — synthesizing with available evidence',
      action: 'synthesize_and_deliver',
      skill_id: null,
      evaluation: 'Parse error on planning response',
      goal_progress: 'partial',
    };
  }
}
