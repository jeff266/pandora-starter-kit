/**
 * Ask Pandora Agent
 *
 * Replaces the hardcoded scope handler pattern for chat questions.
 * Routes to:
 *   1. Fast path — single tool call + synthesis for simple questions
 *   2. Loop — multi-step reasoning for complex questions
 *
 * Falls back to the existing runScopedAnalysis() path on any failure.
 */

import { callLLM } from '../utils/llm-router.js';
import { executeDataTool } from './data-tools.js';
import { runAgentLoop, type LoopResult } from '../agents/loop-executor.js';

export interface AskPandoraResponse {
  answer: string;
  evidence: {
    tool_calls: {
      tool: string;
      params: Record<string, any>;
      result: any;
      description: string;
      error?: string;
    }[];
    skill_evidence_used: {
      skill_id: string;
      last_run_at: string;
      claims_referenced: number;
    }[];
    loop_iterations: number;
    reasoning_chain?: {
      step: number;
      observation: string;
      action: string;
      evaluation: string;
    }[];
    cited_records: {
      type: string;
      id: string;
      name: string;
      key_fields: Record<string, any>;
    }[];
  };
  mode: 'fast' | 'loop';
  tokens_used: number;
  latency_ms: number;
  caveats: string[];
}

// ─── Fast path patterns ───────────────────────────────────────────────────────

interface FastPathPattern {
  pattern: RegExp;
  tool: string;
  paramBuilder: (match: RegExpMatchArray, context: FastPathContext) => Record<string, any>;
}

interface FastPathContext {
  periodStart?: string;
  periodEnd?: string;
}

function getCurrentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  return { start, end };
}

const FAST_PATH_PATTERNS: FastPathPattern[] = [
  // "How many open deals?" / "How many deals do we have?"
  {
    pattern: /^how many (open |active )?(deals?|opportunities)/i,
    tool: 'query_deals',
    paramBuilder: () => ({ is_open: true, limit: 1 }),
  },
  // "What's our total pipeline?" / "Total pipeline" / "Current pipeline"
  {
    pattern: /\b(total|our|current|what.?s)\s+(pipeline|open pipeline)\b/i,
    tool: 'compute_metric',
    paramBuilder: () => ({ metric: 'total_pipeline' }),
  },
  // "What's our win rate?" / "Win rate"
  {
    pattern: /\bwin\s+rate\b/i,
    tool: 'compute_metric',
    paramBuilder: () => ({ metric: 'win_rate' }),
  },
  // "Show me [name]'s deals" / "What are [name]'s deals?"
  {
    pattern: /(?:show me|what are|list)\s+(\w+)(?:'s|'s| 's)?\s+deals/i,
    tool: 'query_deals',
    paramBuilder: (match) => ({ owner_name: match[1], is_open: true, order_by: 'amount', order_dir: 'desc' }),
  },
  // "Deals closing this month"
  {
    pattern: /deals?\s+closing\s+this\s+month/i,
    tool: 'query_deals',
    paramBuilder: (_match, ctx) => ({
      is_open: true,
      close_date_from: ctx.periodStart,
      close_date_to: ctx.periodEnd,
      order_by: 'close_date',
    }),
  },
  // "Average deal size"
  {
    pattern: /\baverage\s+deal\s+size\b/i,
    tool: 'compute_metric',
    paramBuilder: () => ({ metric: 'avg_deal_size' }),
  },
  // "Pipeline coverage" / "Coverage ratio"
  {
    pattern: /\b(pipeline\s+coverage|coverage\s+ratio)\b/i,
    tool: 'compute_metric',
    paramBuilder: () => ({ metric: 'coverage_ratio' }),
  },
  // "What deals are at risk?" / "Deals with findings"
  {
    pattern: /\bdeals?\s+(at risk|with (findings|issues|flags))\b/i,
    tool: 'query_deals',
    paramBuilder: () => ({ is_open: true, has_findings: true, order_by: 'amount', order_dir: 'desc' }),
  },
  // "What's our average sales cycle?"
  {
    pattern: /\baverage\s+sales\s+cycle\b/i,
    tool: 'compute_metric',
    paramBuilder: () => ({ metric: 'avg_sales_cycle' }),
  },
];

function detectFastPath(message: string): { tool: string; params: Record<string, any> } | null {
  const { start: periodStart, end: periodEnd } = getCurrentMonthRange();
  const ctx: FastPathContext = { periodStart, periodEnd };

  for (const fp of FAST_PATH_PATTERNS) {
    const match = message.match(fp.pattern);
    if (match) {
      const params = fp.paramBuilder(match, ctx);
      return { tool: fp.tool, params };
    }
  }
  return null;
}

// ─── Fast path execution ──────────────────────────────────────────────────────

const FAST_PATH_SYNTHESIS_PROMPT = `You are a Revenue Data Analyst. Answer the question using the provided data.
Cite specific records (names, amounts, dates). Be direct and concise — 2-4 sentences max for simple questions.
For lists, use brief bullets. Always state the total count and sum when relevant.`;

async function runFastPath(
  workspaceId: string,
  message: string,
  tool: string,
  params: Record<string, any>
): Promise<AskPandoraResponse> {
  const startTime = Date.now();

  let toolResult: any;
  let toolError: string | undefined;

  try {
    toolResult = await executeDataTool(workspaceId, tool, params);
  } catch (err: any) {
    toolError = err.message || String(err);
  }

  const dataText = toolError
    ? `Tool failed: ${toolError}`
    : JSON.stringify(toolResult, null, 2).slice(0, 6000);

  const synthesis = await callLLM(workspaceId, 'reason', {
    systemPrompt: FAST_PATH_SYNTHESIS_PROMPT,
    messages: [{
      role: 'user',
      content: `Question: ${message}\n\nData:\n${dataText}`,
    }],
    maxTokens: 1000,
    temperature: 0.3,
    _tracking: {
      workspaceId,
      phase: 'chat',
      stepName: 'ask-pandora-fast',
    },
  });

  const tokens = (synthesis.usage?.input || 0) + (synthesis.usage?.output || 0);

  const toolCall = {
    tool,
    params,
    result: toolResult || null,
    description: toolResult?.query_description || toolResult?.formatted || tool,
    error: toolError,
  };

  // Extract cited records
  const citedRecords: AskPandoraResponse['evidence']['cited_records'] = [];
  if (toolResult?.deals) {
    for (const d of (toolResult.deals || []).slice(0, 20)) {
      citedRecords.push({
        type: 'deal',
        id: d.id,
        name: d.name,
        key_fields: { amount: d.amount, stage: d.stage, close_date: d.close_date, owner_name: d.owner_name },
      });
    }
  }

  return {
    answer: synthesis.content,
    evidence: {
      tool_calls: [toolCall],
      skill_evidence_used: [],
      loop_iterations: 0,
      cited_records: citedRecords,
    },
    mode: 'fast',
    tokens_used: tokens,
    latency_ms: Date.now() - startTime,
    caveats: [],
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runAskPandora(
  workspaceId: string,
  message: string,
  priorContext?: string
): Promise<AskPandoraResponse> {
  // 1. Try fast path
  const fastPath = detectFastPath(message);
  if (fastPath) {
    try {
      return await runFastPath(workspaceId, message, fastPath.tool, fastPath.params);
    } catch {
      // Fall through to loop
    }
  }

  // 2. Run agentic loop
  const loopResult: LoopResult = await runAgentLoop(message, {
    workspaceId,
    available_tools: [
      'query_deals',
      'query_accounts',
      'query_conversations',
      'get_skill_evidence',
      'compute_metric',
      'query_contacts',
      'query_activity_timeline',
    ],
    max_iterations: 5,
  }, priorContext);

  const caveats: string[] = [];
  if (loopResult.evidence.tool_calls.some(tc => tc.error)) {
    caveats.push('Some data tools encountered errors — results may be incomplete.');
  }
  if (loopResult.evidence.loop_iterations >= 5) {
    caveats.push('Analysis reached the iteration limit — additional investigation may uncover more detail.');
  }

  return {
    answer: loopResult.answer,
    evidence: loopResult.evidence,
    mode: 'loop',
    tokens_used: loopResult.tokens_used,
    latency_ms: loopResult.latency_ms,
    caveats,
  };
}

// ─── Build prior context string from conversation state messages ──────────────

export function buildPriorContext(
  messages: { role: string; content: string; tool_trace?: any[]; timestamp?: string }[],
  maxMessages = 3,
  maxTokensPerResult = 3000
): string | undefined {
  if (!messages || messages.length === 0) return undefined;

  // Take last N assistant+user exchanges
  const recent = messages.slice(-maxMessages * 2);
  if (recent.length === 0) return undefined;

  const lines: string[] = ['CONVERSATION HISTORY (most recent first):'];

  for (const msg of recent.reverse()) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const contentPreview = msg.content.slice(0, 500);
    lines.push(`${role}: ${contentPreview}${msg.content.length > 500 ? '...' : ''}`);

    if (msg.role === 'assistant' && msg.tool_trace && Array.isArray(msg.tool_trace)) {
      const toolSummary = msg.tool_trace
        .slice(0, 3)
        .map((tc: any) => {
          const resultStr = JSON.stringify(tc.result || {}).slice(0, maxTokensPerResult * 4);
          return `  [Tool: ${tc.tool}] ${tc.description || ''}:\n  ${resultStr}`;
        })
        .join('\n');
      if (toolSummary) lines.push(`  Tools used:\n${toolSummary}`);
    }
  }

  lines.push('\nYou have access to the data from previous tool calls. If you can answer from existing data, do so. If you need additional data, call a tool.');

  const context = lines.join('\n');

  // Hard ceiling: 15,000 tokens ≈ 60,000 chars
  return context.slice(0, 60000);
}
