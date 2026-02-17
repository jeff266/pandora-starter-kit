/**
 * Pandora Agent — Native Tool Calling
 *
 * Single entry point for all Ask Pandora chat questions.
 * Uses Anthropic's native tool_use to let Claude decide what data it needs
 * and when it's done. No JSON planning prompts, no mode classifier, no scope
 * handlers. The model drives the loop; the loop runs until stop_reason: end_turn.
 */

import { callLLM, type ToolDef, type LLMCallOptions } from '../utils/llm-router.js';
import { executeDataTool } from './data-tools.js';
import type { ConversationMessage } from './conversation-state.js';

// ─── Tool definitions ──────────────────────────────────────────────────────────
// Using ToolDef format (parameters) — the router converts to input_schema for Anthropic.

const PANDORA_TOOLS: ToolDef[] = [
  {
    name: 'query_deals',
    description:
      'Query deal/opportunity records with flexible filters. Returns individual deal records with name, amount, stage, close_date, owner, account, days_in_stage, probability, forecast_category. Always returns total_count and total_amount across all matches. Use this when you need to see specific deals, break down pipeline numbers, or analyze deal-level data.',
    parameters: {
      type: 'object',
      properties: {
        is_open: { type: 'boolean', description: 'true for open pipeline, false for closed deals' },
        stage: { type: 'string', description: 'Filter by stage name (partial match supported)' },
        owner_email: { type: 'string', description: 'Filter by deal owner email' },
        owner_name: { type: 'string', description: 'Filter by deal owner name (partial match)' },
        account_id: { type: 'string', description: 'Filter by account ID' },
        account_name: { type: 'string', description: 'Filter by account name (partial match)' },
        close_date_from: { type: 'string', description: 'ISO date — deals closing on or after this date' },
        close_date_to: { type: 'string', description: 'ISO date — deals closing on or before this date' },
        amount_min: { type: 'number', description: 'Minimum deal amount' },
        amount_max: { type: 'number', description: 'Maximum deal amount' },
        created_after: { type: 'string', description: 'ISO date — deals created after' },
        created_before: { type: 'string', description: 'ISO date — deals created before' },
        forecast_category: { type: 'string', description: 'Filter: commit, best_case, pipeline, omitted' },
        pipeline_name: { type: 'string', description: 'Filter by named pipeline (e.g., "Sales Pipeline", "Partnership Pipeline")' },
        has_findings: { type: 'boolean', description: 'Only deals with active AI skill findings' },
        limit: { type: 'number', description: 'Max records to return (default 50, max 200)' },
        order_by: { type: 'string', description: 'Sort by: amount, close_date, created_date, days_in_stage' },
        order_dir: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
      },
      required: [],
    },
  },
  {
    name: 'query_accounts',
    description:
      'Query account/company records. Returns name, domain, industry, employee_count, owner, open deal count, total pipeline value, last activity date. Use to look up companies, find accounts by name or domain, or get account-level views.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Partial match on account name' },
        domain: { type: 'string', description: 'Domain filter (exact or partial)' },
        industry: { type: 'string', description: 'Industry filter' },
        owner_email: { type: 'string', description: 'Account owner email' },
        has_open_deals: { type: 'boolean', description: 'Only accounts with open pipeline' },
        min_pipeline_value: { type: 'number', description: 'Minimum total open pipeline' },
        limit: { type: 'number', description: 'Max records (default 50)' },
        order_by: { type: 'string', description: 'Sort by: name, pipeline_value, deal_count, last_activity' },
      },
      required: [],
    },
  },
  {
    name: 'query_conversations',
    description:
      'Query call/meeting records from Gong or Fireflies. Returns title, date, duration, participants, account/deal linkage, summaries, and optionally transcript excerpts. For Gong calls also returns talk_ratio, longest_monologue, interactivity. Use for anything about what happened on calls — objections, competitive mentions, coaching, patterns.',
    parameters: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Conversations linked to this account' },
        account_name: { type: 'string', description: 'Partial match on linked account name' },
        deal_id: { type: 'string', description: 'Conversations linked to this deal' },
        rep_email: { type: 'string', description: 'Conversations involving this rep' },
        since: { type: 'string', description: 'ISO date — conversations after this date' },
        until: { type: 'string', description: 'ISO date — conversations before this date' },
        title_contains: { type: 'string', description: 'Search in conversation title' },
        transcript_search: { type: 'string', description: 'Full-text search in transcript content' },
        summary_search: { type: 'string', description: 'Search in AI-generated summaries' },
        is_internal: { type: 'boolean', description: 'Filter internal vs external calls (default false = external only)' },
        min_duration_minutes: { type: 'number', description: 'Minimum call length in minutes' },
        source: { type: 'string', enum: ['gong', 'fireflies'], description: 'Filter by source system' },
        include_transcript_excerpts: { type: 'boolean', description: 'Include relevant transcript segments (uses more tokens but enables content analysis)' },
        excerpt_keyword: { type: 'string', description: 'Keyword to center transcript excerpts around (use with include_transcript_excerpts)' },
        limit: { type: 'number', description: 'Max records (default 30)' },
        order_by: { type: 'string', description: 'Sort by: date, duration, account_name' },
      },
      required: [],
    },
  },
  {
    name: 'get_skill_evidence',
    description:
      'Retrieve the most recent output from a Pandora AI skill. Skills run on schedules and produce findings (claims with severity) plus evaluated records (the data they analyzed). ALWAYS check skill evidence before querying raw data for pipeline health, risk, forecasting, or rep performance — skills have richer analysis with risk flags and cross-record patterns. Available skills: pipeline-hygiene (stale deals, missing data, close date issues), single-thread-alert (deals with only 1 contact engaged), data-quality-audit (CRM data completeness), pipeline-coverage-by-rep (rep-level pipeline vs quota), weekly-forecast-rollup (forecast by category with changes), pipeline-waterfall (pipeline movement: created, advanced, slipped, lost), rep-scorecard (rep performance metrics).',
    parameters: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          enum: ['pipeline-hygiene', 'single-thread-alert', 'data-quality-audit', 'pipeline-coverage-by-rep', 'weekly-forecast-rollup', 'pipeline-waterfall', 'rep-scorecard'],
          description: 'The skill to pull evidence from',
        },
        max_age_hours: { type: 'number', description: 'Only return if run within this many hours (default 24)' },
        filter_severity: { type: 'string', enum: ['critical', 'warning', 'info'], description: 'Only return findings of this severity' },
        filter_entity_id: { type: 'string', description: 'Only return findings about this specific deal/account/rep' },
      },
      required: ['skill_id'],
    },
  },
  {
    name: 'compute_metric',
    description:
      'Calculate a specific business metric with FULL show-your-work breakdown. Returns the value, the exact formula, every input, every record included, and every record excluded with reasons. Use when the user asks about a metric, wants to verify a number, or when you need to confirm your own math. ALWAYS use this instead of manual calculation.',
    parameters: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['total_pipeline', 'weighted_pipeline', 'win_rate', 'avg_deal_size', 'avg_sales_cycle', 'coverage_ratio', 'pipeline_created', 'pipeline_closed'],
          description: 'The metric to calculate',
        },
        owner_email: { type: 'string', description: 'Scope to one rep' },
        date_from: { type: 'string', description: 'Start of period (ISO date)' },
        date_to: { type: 'string', description: 'End of period (ISO date)' },
        stage: { type: 'string', description: 'Scope to one stage' },
        pipeline_name: { type: 'string', description: 'Scope to one named pipeline' },
        quota_amount: { type: 'number', description: 'Explicit quota for coverage_ratio (if not set, pulls from workspace config)' },
        lookback_days: { type: 'number', description: 'For win_rate — number of days to look back (default 90)' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'query_contacts',
    description:
      'Query contact records associated with accounts and deals. Returns name, email, title, account, role (champion/economic_buyer/etc), last activity, conversation count. Use for stakeholder mapping, multi-threading analysis, or finding decision-makers.',
    parameters: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Contacts at this account' },
        deal_id: { type: 'string', description: 'Contacts associated with this deal' },
        name: { type: 'string', description: 'Partial match on contact name' },
        email: { type: 'string', description: 'Exact or partial email match' },
        title_contains: { type: 'string', description: 'Job title search' },
        role: { type: 'string', description: 'Filter by role: champion, economic_buyer, technical_evaluator, coach, blocker' },
        has_conversation: { type: 'boolean', description: 'Only contacts who appeared on calls' },
        limit: { type: 'number', description: 'Max records (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'query_activity_timeline',
    description:
      'Get a chronological timeline of activity for a deal or account. Includes stage changes, calls, emails, tasks, notes, meetings with dates and actors. Use to understand the STORY of what happened — when stages changed, when calls occurred, gaps in activity. Essential for investigating deal velocity and engagement patterns.',
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Timeline for this deal' },
        account_id: { type: 'string', description: 'Timeline across all deals at this account' },
        since: { type: 'string', description: 'ISO date — events after this date' },
        until: { type: 'string', description: 'ISO date — events before this date' },
        activity_types: {
          type: 'array',
          items: { type: 'string', enum: ['stage_change', 'call', 'email', 'task', 'note', 'meeting'] },
          description: 'Filter by activity type',
        },
        limit: { type: 'number', description: 'Max events (default 50)' },
      },
      required: [],
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

const PANDORA_SYSTEM_PROMPT = `You are Pandora, a Revenue Operations analyst. You work for this company's revenue team. You have direct access to their CRM data, conversation recordings, and AI-generated pipeline analysis.

## How You Work

You have tools that query the company's live data. When someone asks a question, you pull the actual data, verify the numbers, and give a specific answer with evidence.

## Rules

1. NEVER GUESS. Every number you cite must come from a tool call. If you're unsure, call a tool.

2. NEVER SAY "I WOULD NEED." If a tool exists that could get the data, call it. You have 7 tools covering deals, accounts, conversations, contacts, activity timelines, skill evidence, and metric calculations. Use them.

3. SHOW YOUR WORK. When citing totals or metrics, list the underlying records. "19 deals totaling $303K" is better than "$303K." Name the top deals.

4. CHECK SKILL EVIDENCE FIRST. Before querying raw data for pipeline health, risk, forecasting, or rep performance questions, check get_skill_evidence. Skills have already analyzed the data with richer context than a raw query provides.

5. CROSS-REFERENCE. When a question spans entities (deals + calls, reps + accounts), query both sides. Don't answer with half the picture.

6. BE DIRECT. Lead with the answer. Put context and caveats after the main point, not before.

7. WHEN LISTING DEALS: always include name, amount, stage, close date, and owner.
   WHEN LISTING CONVERSATIONS: always include title, date, account, rep, and duration.
   WHEN CITING METRICS: always include the formula and record count.

8. PRIOR TOOL RESULTS IN CONTEXT ARE FROM PREVIOUS QUESTIONS — NOT YOUR CURRENT DATA. Each new question starts fresh. All 7 tools are always available. Never say "I don't have access to X in the data provided" or "the data shows only Y" — that refers to a past question. Call a tool.

9. FORECASTS AND QUARTERLY NUMBERS: For any question about Q1/Q2/Q3/Q4 forecast, quarterly pipeline, quarterly revenue, or forecast categories (commit/best case):
   - ALWAYS call get_skill_evidence with skill_id="weekly-forecast-rollup" first.
   - THEN call query_deals with close_date_from and close_date_to set to the quarter's date range.
   - Q1 = Jan 1 – Mar 31. Q2 = Apr 1 – Jun 30. Q3 = Jul 1 – Sep 30. Q4 = Oct 1 – Dec 31.
   - Use the current year unless the user specifies otherwise.
   - Never say "I don't have Q1 data" — you have deal close dates and the forecast rollup skill.

Today's date is ${new Date().toISOString().split('T')[0]}.`;

// ─── Response types ───────────────────────────────────────────────────────────

export interface PandoraToolCall {
  tool: string;
  params: Record<string, any>;
  result: any;
  description: string;
}

export interface PandoraCitedRecord {
  type: 'deal' | 'account' | 'conversation' | 'contact';
  id: string;
  name: string;
  key_fields: Record<string, any>;
}

export interface PandoraResponse {
  answer: string;
  evidence: {
    tool_calls: PandoraToolCall[];
    cited_records: PandoraCitedRecord[];
  };
  tokens_used: number;
  tool_call_count: number;
  latency_ms: number;
}

// ─── Main agent loop ──────────────────────────────────────────────────────────

export async function runPandoraAgent(
  workspaceId: string,
  message: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: any }>
): Promise<PandoraResponse> {
  const startTime = Date.now();
  const toolTrace: PandoraToolCall[] = [];
  let totalTokens = 0;
  const MAX_ITERATIONS = 8;

  // Build the messages array: prior history + new user message
  // The history uses the LLM router's message format
  const messages: LLMCallOptions['messages'] = [
    ...conversationHistory.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: message },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[PandoraAgent] iter=${i} calling LLM with ${PANDORA_TOOLS.length} tools, history=${messages.length} msgs`);
    console.log(`[PandoraAgent] tools:`, PANDORA_TOOLS.map(t => t.name).join(', '));

    const response = await callLLM(workspaceId, 'reason', {
      systemPrompt: PANDORA_SYSTEM_PROMPT,
      messages,
      tools: PANDORA_TOOLS,
      maxTokens: 4096,
      temperature: 0.2,
      _tracking: {
        workspaceId,
        phase: 'chat',
        stepName: `pandora-agent-iter-${i}`,
      },
    });

    totalTokens += (response.usage?.input || 0) + (response.usage?.output || 0);

    console.log(`[PandoraAgent] iter=${i} stopReason=${response.stopReason} toolCalls=${response.toolCalls?.length ?? 0}`);
    if (response.toolCalls?.length) {
      console.log(`[PandoraAgent] tools called:`, response.toolCalls.map((tc: any) => tc.name).join(', '));
    }

    // Done — model produced its answer
    if (response.stopReason === 'end_turn' || !response.toolCalls?.length) {
      // Guard: if no tools have been called yet, the agent is answering from context
      // instead of live data. Give it up to 2 nudges before accepting the answer.
      if (toolTrace.length === 0 && i < 2) {
        console.log(`[PandoraAgent] GUARD FIRED at iter=${i} — no tools called, injecting nudge`);
        messages.push({
          role: 'assistant',
          content: response.content || '',
        });

        // Build a targeted nudge based on question content
        let nudge = '[You answered without calling any tools. You must query live data before responding.';
        if (/\bQ[1-4]\b|quarter|forecast|commit|best.?case/i.test(message)) {
          nudge += ' For forecast questions: call get_skill_evidence with skill_id="weekly-forecast-rollup", then call query_deals with close_date_from and close_date_to for the relevant quarter.';
        } else if (/\bdeal|pipeline|stage|close|won|lost/i.test(message)) {
          nudge += ' Call query_deals to retrieve live pipeline data.';
        } else if (/\bcall|meeting|conversation|objection|competi/i.test(message)) {
          nudge += ' Call query_conversations to get live call data.';
        } else if (/\brep|account.exec|AE|quota|attainment/i.test(message)) {
          nudge += ' Call get_skill_evidence with skill_id="rep-scorecard" or query_deals filtered by owner.';
        } else {
          nudge += ' Call the appropriate tool from the 7 available tools.';
        }
        nudge += ']';

        messages.push({ role: 'user', content: nudge });
        continue;
      }

      return {
        answer: response.content,
        evidence: {
          tool_calls: toolTrace,
          cited_records: extractCitedRecords(toolTrace),
        },
        tokens_used: totalTokens,
        tool_call_count: toolTrace.length,
        latency_ms: Date.now() - startTime,
      };
    }

    // Model wants to call tools — execute them all
    // First, append the assistant's response (with tool_use blocks) to history
    // The router stores the raw content blocks on the response for this purpose
    const assistantContent = buildAssistantContent(response.content, response.toolCalls);
    messages.push({ role: 'assistant', content: assistantContent });

    // Execute each tool and collect results
    for (const toolCall of response.toolCalls) {
      let result: any;
      let isError = false;

      try {
        result = await executeDataTool(workspaceId, toolCall.name, toolCall.input);
        toolTrace.push({
          tool: toolCall.name,
          params: toolCall.input,
          result,
          description: result?.query_description || result?.formatted || `${toolCall.name} call`,
        });
      } catch (err: any) {
        result = { error: err.message || String(err) };
        isError = true;
        toolTrace.push({
          tool: toolCall.name,
          params: toolCall.input,
          result,
          description: `${toolCall.name} failed: ${err.message}`,
        });
      }

      // Append tool result as a 'tool' role message (router handles formatting)
      messages.push({
        role: 'tool',
        content: isError ? JSON.stringify(result) : JSON.stringify(result),
        toolCallId: toolCall.id,
      });
    }
  }

  // Hit max iterations — force a final synthesis with no tools
  const finalResponse = await callLLM(workspaceId, 'reason', {
    systemPrompt: PANDORA_SYSTEM_PROMPT,
    messages: [
      ...messages,
      { role: 'user', content: 'You have reached the maximum number of tool calls. Synthesize your best answer from the data gathered so far.' },
    ],
    maxTokens: 4096,
    temperature: 0.2,
    _tracking: {
      workspaceId,
      phase: 'chat',
      stepName: 'pandora-agent-final-synthesis',
    },
  });

  totalTokens += (finalResponse.usage?.input || 0) + (finalResponse.usage?.output || 0);

  return {
    answer: finalResponse.content,
    evidence: {
      tool_calls: toolTrace,
      cited_records: extractCitedRecords(toolTrace),
    },
    tokens_used: totalTokens,
    tool_call_count: toolTrace.length,
    latency_ms: Date.now() - startTime,
  };
}

// ─── Build assistant content array with tool_use blocks ───────────────────────

function buildAssistantContent(textContent: string, toolCalls: { id: string; name: string; input: Record<string, any> }[]): any[] {
  const blocks: any[] = [];
  if (textContent) {
    blocks.push({ type: 'text', text: textContent });
  }
  for (const tc of toolCalls) {
    blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
  }
  return blocks;
}

// ─── Extract cited records from tool results ──────────────────────────────────

function extractCitedRecords(toolTrace: PandoraToolCall[]): PandoraCitedRecord[] {
  const records: PandoraCitedRecord[] = [];
  const seen = new Set<string>();

  for (const call of toolTrace) {
    const result = call.result;
    if (!result) continue;

    if (Array.isArray(result.deals)) {
      for (const d of result.deals) {
        if (d.id && !seen.has(d.id)) {
          seen.add(d.id);
          records.push({
            type: 'deal', id: d.id, name: d.name,
            key_fields: { amount: d.amount, stage: d.stage, close_date: d.close_date, owner_name: d.owner_name, account_name: d.account_name },
          });
        }
      }
    }

    if (Array.isArray(result.accounts)) {
      for (const a of result.accounts) {
        if (a.id && !seen.has(a.id)) {
          seen.add(a.id);
          records.push({
            type: 'account', id: a.id, name: a.name,
            key_fields: { domain: a.domain, open_deal_count: a.open_deal_count, total_pipeline: a.total_pipeline },
          });
        }
      }
    }

    if (Array.isArray(result.conversations)) {
      for (const c of result.conversations) {
        if (c.id && !seen.has(c.id)) {
          seen.add(c.id);
          records.push({
            type: 'conversation', id: c.id, name: c.title,
            key_fields: { date: c.date, account_name: c.account_name, rep_name: c.rep_name, duration_minutes: c.duration_minutes },
          });
        }
      }
    }

    if (Array.isArray(result.contacts)) {
      for (const ct of result.contacts) {
        if (ct.id && !seen.has(ct.id)) {
          seen.add(ct.id);
          records.push({
            type: 'contact', id: ct.id, name: ct.name,
            key_fields: { email: ct.email, title: ct.title, account_name: ct.account_name },
          });
        }
      }
    }

    // compute_metric underlying records
    if (Array.isArray(result.underlying_records)) {
      for (const r of result.underlying_records) {
        if (r.id && !seen.has(r.id)) {
          seen.add(r.id);
          records.push({
            type: 'deal', id: r.id, name: r.name,
            key_fields: { amount: r.amount, included_because: r.included_because },
          });
        }
      }
    }
  }

  return records;
}

// ─── Conversation history builder (for follow-ups) ────────────────────────────

/**
 * Converts stored conversation_state messages into the history format
 * runPandoraAgent() expects. Prior tool calls are summarized as text
 * so the model has context of what was already queried.
 */
export function buildConversationHistory(
  messages: (ConversationMessage & { tool_trace?: any[]; cited_records?: any[] })[]
): Array<{ role: 'user' | 'assistant'; content: any }> {
  if (!messages?.length) return [];

  const history: Array<{ role: 'user' | 'assistant'; content: any }> = [];
  // Keep last ~10 messages (5 exchanges) to manage context
  const recent = messages.slice(-10);

  for (const msg of recent) {
    if (msg.role === 'user') {
      history.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      // Pass the answer text and which tools were called, but NOT the result data.
      // Injecting full prior tool results causes the model to anchor on
      // "data I retrieved before" and refuse to call tools for a new question
      // (e.g. seeing 50 calls from an objections question, then saying
      // "I don't have pipeline data" when asked about Q1 forecast).
      if (msg.tool_trace && msg.tool_trace.length > 0) {
        const toolsNote = `[Tools used for this answer: ${
          msg.tool_trace.map((t: any) => t.tool).join(', ')
        }]`;
        const content = (msg.content ? msg.content + '\n\n' : '') + toolsNote;
        history.push({ role: 'assistant', content });
      } else {
        history.push({ role: 'assistant', content: msg.content });
      }
    }
  }

  return history;
}

