/**
 * Loop Executor
 *
 * Agentic reasoning loop for Ask Pandora.
 * Supports two action types:
 *   - run_skill: execute a registered Pandora skill and accumulate its output
 *   - call_tool: call a data tool (SQL query) and accumulate the result
 *
 * The loop iterates until goal_satisfied or max_iterations is reached.
 */

import { callLLM } from '../utils/llm-router.js';
import { executeDataTool } from '../chat/data-tools.js';

export interface AgentPlan {
  observation: string;
  reasoning: string;
  action: 'run_skill' | 'call_tool' | 'synthesize_and_deliver';

  // For run_skill
  skill_id?: string;
  skill_params?: Record<string, any>;

  // For call_tool
  tool_name?: string;
  tool_params?: Record<string, any>;

  evaluation?: string;
  goal_progress: 'none' | 'partial' | 'satisfied';
}

export interface ToolCall {
  tool: string;
  params: Record<string, any>;
  result: any;
  description: string;
  error?: string;
}

export interface LoopEvidence {
  tool_calls: ToolCall[];
  skill_evidence_used: { skill_id: string; last_run_at: string; claims_referenced: number }[];
  loop_iterations: number;
  reasoning_chain: { step: number; observation: string; action: string; evaluation: string }[];
  cited_records: { type: string; id: string; name: string; key_fields: Record<string, any> }[];
}

export interface LoopConfig {
  available_tools?: string[];
  available_skills?: string[];
  max_iterations?: number;
  planning_prompt?: string;
  workspaceId: string;
}

export interface LoopResult {
  answer: string;
  evidence: LoopEvidence;
  tokens_used: number;
  latency_ms: number;
  mode: 'loop';
}

// ─── System prompt for the planning LLM ──────────────────────────────────────

function buildPlanningSystemPrompt(config: LoopConfig, accumulatedEvidence: Record<string, any>): string {
  if (config.planning_prompt) return config.planning_prompt;

  const toolList = (config.available_tools || []).join(', ');

  const evidenceKeys = Object.keys(accumulatedEvidence);
  const evidenceSummary = evidenceKeys.length > 0
    ? `\n\nACCUMULATED EVIDENCE (${evidenceKeys.length} sources):\n` +
      evidenceKeys.map(k => {
        const val = accumulatedEvidence[k];
        const preview = JSON.stringify(val).slice(0, 500);
        return `[${k}]: ${preview}${preview.length >= 500 ? '...' : ''}`;
      }).join('\n\n')
    : '';

  return `You are a Revenue Data Analyst for a B2B SaaS company. You have access to data tools that query the company's CRM, conversation intelligence, and AI skill outputs.

YOUR CORE PRINCIPLE: Every number you cite must come from a tool call. Never estimate or approximate a number without data.

TOOLS AVAILABLE: ${toolList || 'query_deals, query_accounts, query_conversations, get_skill_evidence, compute_metric, query_contacts, query_activity_timeline'}

STRATEGY:
1. Start with get_skill_evidence if the question relates to an existing skill's domain (pipeline health, forecast, rep performance, data quality). Skills have richer analysis than raw queries.
2. Use query_deals / query_accounts / query_conversations for specific data lookups or when skill evidence is stale or insufficient.
3. Use compute_metric when the user asks about a specific number and wants to see the math.
4. Cross-reference multiple tools when the question spans entities.

RULES:
- Do NOT re-call a tool with the same parameters.
- If one tool call gives you enough to answer, stop. Don't over-investigate.
- Always report the record count and total alongside any aggregate (e.g., "19 deals totaling $303K").
- When listing deals: include name, amount, stage, close date, owner.
- When listing conversations: include title, date, account, rep, duration.${evidenceSummary}

You must respond in JSON:
{
  "observation": "What I see in the evidence so far...",
  "reasoning": "What I need next and why...",
  "action": "call_tool" | "synthesize_and_deliver",
  "tool_name": "tool name if calling a tool",
  "tool_params": { "param": "value" },
  "evaluation": "What I learned from the last step...",
  "goal_progress": "none" | "partial" | "satisfied"
}`;
}

// ─── Synthesis prompt ─────────────────────────────────────────────────────────

const SYNTHESIS_SYSTEM_PROMPT = `You are a Revenue Data Analyst. Synthesize the provided data into a clear, direct answer.
- Cite specific records: names, amounts, stages, dates.
- Quantify patterns (e.g., "7 of 23 calls mentioned pricing").
- Keep answers focused — 2-5 sentences for simple questions, structured bullets for complex ones.
- If numbers don't add up or data is incomplete, say so explicitly.
- End with: CONFIDENCE: HIGH|MEDIUM|LOW`;

// ─── Tool call dedup key ──────────────────────────────────────────────────────

function toolKey(toolName: string, params: Record<string, any>): string {
  return `${toolName}:${JSON.stringify(params || {}).slice(0, 120)}`;
}

// ─── Extract cited records from tool results ─────────────────────────────────

function extractCitedRecords(toolCalls: ToolCall[]): LoopEvidence['cited_records'] {
  const cited: LoopEvidence['cited_records'] = [];
  const seen = new Set<string>();

  for (const tc of toolCalls) {
    if (tc.error || !tc.result) continue;

    // Deals
    if (Array.isArray(tc.result.deals)) {
      for (const d of tc.result.deals.slice(0, 20)) {
        if (d.id && !seen.has(d.id)) {
          seen.add(d.id);
          cited.push({
            type: 'deal',
            id: d.id,
            name: d.name,
            key_fields: {
              amount: d.amount,
              stage: d.stage,
              close_date: d.close_date,
              owner_name: d.owner_name,
            },
          });
        }
      }
    }

    // Accounts
    if (Array.isArray(tc.result.accounts)) {
      for (const a of tc.result.accounts.slice(0, 10)) {
        if (a.id && !seen.has(a.id)) {
          seen.add(a.id);
          cited.push({
            type: 'account',
            id: a.id,
            name: a.name,
            key_fields: { total_pipeline: a.total_pipeline, open_deal_count: a.open_deal_count },
          });
        }
      }
    }

    // Conversations
    if (Array.isArray(tc.result.conversations)) {
      for (const c of tc.result.conversations.slice(0, 15)) {
        if (c.id && !seen.has(c.id)) {
          seen.add(c.id);
          cited.push({
            type: 'conversation',
            id: c.id,
            name: c.title,
            key_fields: { date: c.date, account_name: c.account_name, duration_minutes: c.duration_minutes },
          });
        }
      }
    }

    // Contacts
    if (Array.isArray(tc.result.contacts)) {
      for (const ct of tc.result.contacts.slice(0, 10)) {
        if (ct.id && !seen.has(ct.id)) {
          seen.add(ct.id);
          cited.push({
            type: 'contact',
            id: ct.id,
            name: ct.name,
            key_fields: { title: ct.title, account_name: ct.account_name },
          });
        }
      }
    }
  }

  return cited;
}

// ─── Truncate evidence for context window management ─────────────────────────

function truncateEvidence(evidence: Record<string, any>, maxTokensPerEntry = 3000): Record<string, any> {
  const truncated: Record<string, any> = {};
  for (const [k, v] of Object.entries(evidence)) {
    const serialized = JSON.stringify(v);
    // Rough token estimate: 1 token ≈ 4 chars
    if (serialized.length > maxTokensPerEntry * 4) {
      // Truncate arrays to first 20 elements
      const shallow = { ...v };
      for (const key of Object.keys(shallow)) {
        if (Array.isArray(shallow[key]) && shallow[key].length > 20) {
          shallow[key] = shallow[key].slice(0, 20);
          shallow[`${key}_truncated`] = true;
        }
      }
      truncated[k] = shallow;
    } else {
      truncated[k] = v;
    }
  }
  return truncated;
}

// ─── Main loop ────────────────────────────────────────────────────────────────

export async function runAgentLoop(
  question: string,
  config: LoopConfig,
  priorContext?: string
): Promise<LoopResult> {
  const startTime = Date.now();
  const maxIterations = config.max_iterations || 5;
  const { workspaceId } = config;

  const accumulatedEvidence: Record<string, any> = {};
  const calledTools = new Set<string>();
  const toolCalls: ToolCall[] = [];
  const skillEvidenceUsed: LoopEvidence['skill_evidence_used'] = [];
  const reasoningChain: LoopEvidence['reasoning_chain'] = [];
  let totalTokens = 0;

  const conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];

  // Inject prior context if available (follow-ups)
  const initialUserContent = priorContext
    ? `${priorContext}\n\nCurrent question: ${question}`
    : question;

  conversationHistory.push({ role: 'user', content: initialUserContent });

  let finalAnswer = '';

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const systemPrompt = buildPlanningSystemPrompt(config, truncateEvidence(accumulatedEvidence));

    const planResponse = await callLLM(workspaceId, 'reason', {
      systemPrompt,
      messages: conversationHistory,
      maxTokens: 1000,
      temperature: 0,
      _tracking: {
        workspaceId,
        phase: 'chat',
        stepName: `ask-pandora-plan-${iteration}`,
      },
    });

    totalTokens += (planResponse.usage?.input || 0) + (planResponse.usage?.output || 0);

    // Parse plan
    let plan: AgentPlan;
    try {
      const jsonMatch = planResponse.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in plan response');
      plan = JSON.parse(jsonMatch[0]) as AgentPlan;
    } catch {
      // If parsing fails, treat as ready to synthesize
      plan = {
        observation: 'Could not parse plan',
        reasoning: 'Synthesizing with available data',
        action: 'synthesize_and_deliver',
        goal_progress: 'partial',
      };
    }

    reasoningChain.push({
      step: iteration + 1,
      observation: plan.observation || '',
      action: plan.action,
      evaluation: plan.evaluation || '',
    });

    conversationHistory.push({
      role: 'assistant',
      content: planResponse.content,
    });

    // ── Handle action ──────────────────────────────────────────────────────
    if (plan.action === 'synthesize_and_deliver' || plan.goal_progress === 'satisfied') {
      break;
    }

    if (plan.action === 'call_tool' && plan.tool_name) {
      const key = toolKey(plan.tool_name, plan.tool_params || {});

      if (calledTools.has(key)) {
        // Prevent duplicate calls — push feedback and let LLM re-plan
        conversationHistory.push({
          role: 'user',
          content: `[System: Tool "${plan.tool_name}" was already called with these parameters. Use accumulated evidence or call a different tool.]`,
        });
        continue;
      }

      calledTools.add(key);

      let toolResult: any;
      let toolError: string | undefined;

      try {
        toolResult = await executeDataTool(workspaceId, plan.tool_name, plan.tool_params || {});
        accumulatedEvidence[key] = toolResult;

        // Track skill evidence separately for the evidence panel
        if (plan.tool_name === 'get_skill_evidence' && toolResult) {
          skillEvidenceUsed.push({
            skill_id: plan.tool_params?.skill_id || 'unknown',
            last_run_at: toolResult.last_run_at,
            claims_referenced: toolResult.claim_count || 0,
          });
        }
      } catch (err: any) {
        toolError = err.message || String(err);
        accumulatedEvidence[`${key}:error`] = `[TOOL FAILED: ${toolError}]`;
      }

      toolCalls.push({
        tool: plan.tool_name,
        params: plan.tool_params || {},
        result: toolResult || null,
        description: toolResult?.query_description || toolResult?.formatted || plan.tool_name,
        error: toolError,
      });

      // Feed result back to conversation
      const resultSummary = toolError
        ? `Tool "${plan.tool_name}" failed: ${toolError}`
        : `Tool "${plan.tool_name}" result: ${JSON.stringify(toolResult).slice(0, 2000)}`;

      conversationHistory.push({
        role: 'user',
        content: `[Tool result]: ${resultSummary}`,
      });
    } else if (plan.action === 'run_skill' && plan.skill_id) {
      // run_skill is handled by the existing agent runtime
      // In the loop context, we note it was requested but skip actual execution
      // (skill execution is expensive; the loop should use get_skill_evidence instead)
      conversationHistory.push({
        role: 'user',
        content: `[System: For skill data, use get_skill_evidence tool with skill_id="${plan.skill_id}" instead of run_skill.]`,
      });
    }
  }

  // ── Final synthesis ────────────────────────────────────────────────────────
  const evidenceForSynthesis = Object.entries(accumulatedEvidence)
    .map(([k, v]) => `[${k}]:\n${JSON.stringify(v).slice(0, 3000)}`)
    .join('\n\n');

  const synthesisMessages: { role: 'user' | 'assistant'; content: string }[] = [
    {
      role: 'user',
      content: `Question: ${question}\n\nData gathered:\n${evidenceForSynthesis || 'No data gathered.'}`,
    },
  ];

  const synthesisResponse = await callLLM(workspaceId, 'reason', {
    systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
    messages: synthesisMessages,
    maxTokens: 2000,
    temperature: 0.3,
    _tracking: {
      workspaceId,
      phase: 'chat',
      stepName: 'ask-pandora-synthesize',
    },
  });

  totalTokens += (synthesisResponse.usage?.input || 0) + (synthesisResponse.usage?.output || 0);
  finalAnswer = synthesisResponse.content;

  return {
    answer: finalAnswer,
    evidence: {
      tool_calls: toolCalls,
      skill_evidence_used: skillEvidenceUsed,
      loop_iterations: reasoningChain.length,
      reasoning_chain: reasoningChain,
      cited_records: extractCitedRecords(toolCalls),
    },
    tokens_used: totalTokens,
    latency_ms: Date.now() - startTime,
    mode: 'loop',
  };
}
