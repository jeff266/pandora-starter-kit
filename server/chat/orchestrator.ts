import { query } from '../db.js';
import { runScopedAnalysis } from '../analysis/scoped-analysis.js';
import { tryHeuristic } from './heuristic-router.js';
import { classifyDirectQuestion } from './intent-classifier.js';
import {
  getConversationState,
  createConversationState,
  appendMessage,
  updateContext,
  checkRateLimit,
  getMessageCount,
  isFollowUpLimitReached,
  type ConversationState,
} from './conversation-state.js';
import { detectFeedback } from './feedback-detector.js';
import { recordFeedbackSignal } from '../feedback/signals.js';
import { createAnnotation, getActiveAnnotations } from '../feedback/annotations.js';
import { randomUUID } from 'crypto';
import { runPandoraAgent, buildConversationHistory } from './pandora-agent.js';

export interface ConversationTurnInput {
  surface: 'slack_thread' | 'slack_dm' | 'in_app';
  workspaceId: string;
  threadId: string;
  channelId: string;
  message: string;
  scope?: {
    type: string;
    entity_id?: string;
    rep_email?: string;
  };
  anchor?: {
    skill_run_id?: string;
    agent_run_id?: string;
    report_type?: string;
    result?: any;
  };
}

export interface ConversationTurnResult {
  answer: string;
  thread_id: string;
  scope: { type: string; entity_id?: string; rep_email?: string };
  router_decision: string;
  data_strategy: string;
  tokens_used: number;
  rate_limited?: boolean;
  turn_limit_reached?: boolean;
  response_id?: string;
  feedback_enabled?: boolean;
  entities_mentioned?: {
    deals: { id: string; name: string }[];
    accounts: { id: string; name: string }[];
    reps: { id: string; name: string }[];
  };
}

const CONVERSATION_SIGNALS = [
  /\b(calls?|meetings?|conversations?|recordings?|transcripts?)\b/i,
  /\b(objections?|competitors?|pricing\s+discuss(?:ed|ion)?|sentiment|themes?)\b/i,
  /\b(discovery\s+questions?|talk[\-\s]ratio|monologue|coaching|call\s+quality)\b/i,
  /\bwhat\s+(are|were)\s+(we|they|prospects?|customers?)\s+(hearing|saying|asking|mentioning)\b/i,
  /\b(summarize|summary\s+of)\s+(last|recent|this)\s+(week|month)/i,
  /\bwhat.{0,30}(heard|said|came\s+up|mentioned)\s+on\s+(calls?|meetings?)\b/i,
];

function isConversationQuestion(message: string): boolean {
  return CONVERSATION_SIGNALS.some(p => p.test(message));
}

export async function handleConversationTurn(input: ConversationTurnInput): Promise<ConversationTurnResult> {
  const { workspaceId, channelId, threadId, message, surface, anchor, scope: inputScope } = input;

  let state = await getConversationState(workspaceId, channelId, threadId);
  const isFollowUp = !!state && (state.messages || []).length > 0;

  if (!state) {
    const source = surface === 'in_app' ? 'web' : 'slack';
    state = await createConversationState(
      workspaceId, channelId, threadId, source as any,
      anchor?.skill_run_id
    );
  }

  const msgCount = await getMessageCount(workspaceId, channelId, threadId);
  if (isFollowUpLimitReached(msgCount)) {
    return {
      answer: 'This conversation has reached its limit. Please start a new conversation.',
      thread_id: threadId,
      scope: { type: 'workspace' },
      router_decision: 'turn_limit',
      data_strategy: 'none',
      tokens_used: 0,
      turn_limit_reached: true,
    };
  }

  await appendMessage(workspaceId, channelId, threadId, {
    role: 'user',
    content: message,
    timestamp: new Date().toISOString(),
  });

  const isFollowUpConversation = isFollowUp && (state.messages || []).length > 1;
  const feedback = detectFeedback(message, isFollowUpConversation);

  let scopeType: string = inputScope?.type || state.context.last_scope?.type || 'workspace';
  let entityId = inputScope?.entity_id || state.context.last_scope?.entity_id;
  let repEmail = inputScope?.rep_email || state.context.last_scope?.rep_email;

  // Auto-detect conversation questions when no explicit scope provided
  if (!inputScope?.type && scopeType === 'workspace' && isConversationQuestion(message)) {
    scopeType = 'conversations';
  }

  let routerDecision = 'unknown';
  let dataStrategy = 'unknown';
  let tokensUsed = 0;
  let answer: string | undefined;

  if (feedback && feedback.type !== 'correct') {
    try {
      const lastAssistantMsg = (state.messages || []).filter(m => m.role === 'assistant').pop();
      const targetId = lastAssistantMsg?.timestamp || threadId;

      await recordFeedbackSignal(workspaceId, {
        targetType: 'chat_response',
        targetId,
        signalType: feedback.type === 'confirm' ? 'confirm' : 'dismiss',
        source: surface === 'in_app' ? 'command_center' : 'slack',
        metadata: {},
      });
    } catch (err) {
      console.warn('[orchestrator] Failed to record feedback signal:', err);
    }

    const ack = feedback.type === 'confirm' ? 'Noted.' : 'Got it, moving on.';
    const responseId = randomUUID();

    await appendMessage(workspaceId, channelId, threadId, {
      role: 'assistant',
      content: ack,
      timestamp: new Date().toISOString(),
    });

    await updateTurnMetrics(workspaceId, channelId, threadId, 0);

    return {
      answer: ack,
      thread_id: threadId,
      scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
      router_decision: 'feedback_' + feedback.type,
      data_strategy: 'feedback',
      tokens_used: 0,
      response_id: responseId,
      feedback_enabled: false,
    };
  }

  if (feedback && feedback.type === 'correct') {
    try {
      const lastAssistantMsg = (state.messages || []).filter(m => m.role === 'assistant').pop();
      const targetId = lastAssistantMsg?.timestamp || threadId;

      await recordFeedbackSignal(workspaceId, {
        targetType: 'chat_response',
        targetId,
        signalType: 'correct',
        source: surface === 'in_app' ? 'command_center' : 'slack',
        metadata: {},
      });

      if (state.context.last_scope?.entity_id) {
        await createAnnotation(workspaceId, {
          entityType: state.context.last_scope.type || 'workspace',
          entityId: state.context.last_scope.entity_id,
          annotationType: 'correction',
          content: message,
          source: surface === 'in_app' ? 'chat' : 'slack_thread',
          sourceThreadId: threadId,
        });
      }
    } catch (err) {
      console.warn('[orchestrator] Failed to record correction:', err);
    }
  }

  try {
    const heuristic = await tryHeuristic(workspaceId, message);
    if (heuristic.matched && heuristic.answer) {
      answer = heuristic.answer;
      routerDecision = 'heuristic';
      dataStrategy = heuristic.data_strategy || 'sql_lookup';
      tokensUsed = 0;

      if (heuristic.scope_hint) {
        scopeType = heuristic.scope_hint.type;
        entityId = heuristic.scope_hint.entity_id;
        repEmail = heuristic.scope_hint.rep_email;
      }
    }
  } catch (err) {
    console.warn('[orchestrator] Heuristic router failed, continuing to LLM path:', err);
  }

  if (!answer) {
    const synthesisLimit = surface === 'in_app' ? 30 : 20;
    const allowed = await checkRateLimit(workspaceId, synthesisLimit);
    if (!allowed) {
      const fallback = await tryHeuristicFallback(workspaceId, message);
      if (fallback) {
        answer = fallback;
        routerDecision = 'rate_limited_fallback';
        dataStrategy = 'sql_fallback';
        tokensUsed = 0;
      } else {
        return {
          answer: `You've reached the AI analysis limit for this hour (${synthesisLimit}/hr). Simple data lookups still work — try "How many deals?" or "What's our pipeline?"`,
          thread_id: threadId,
          scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
          router_decision: 'rate_limited',
          data_strategy: 'none',
          tokens_used: 0,
          rate_limited: true,
        };
      }
    }
  }

  // ── Pandora Agent — primary path for all in_app questions ───────────────────
  // Single native tool-calling loop. No mode classifier, no scope handler.
  // Falls back to scoped analysis only if this throws.
  if (!answer && surface === 'in_app') {
    try {
      const history = buildConversationHistory(state.messages || [] as any);
      const pandoraResult = await runPandoraAgent(workspaceId, message, history);

      answer = pandoraResult.answer;
      tokensUsed = pandoraResult.tokens_used;
      routerDecision = 'pandora_agent';
      dataStrategy = 'pandora_agent';

      // Persist assistant message with tool_trace for follow-up context
      await appendMessage(workspaceId, channelId, threadId, {
        role: 'assistant',
        content: answer,
        timestamp: new Date().toISOString(),
        ...(pandoraResult.evidence.tool_calls.length > 0 ? {
          tool_trace: pandoraResult.evidence.tool_calls,
          cited_records: pandoraResult.evidence.cited_records,
        } : {}),
      } as any);

      await updateContext(workspaceId, channelId, threadId, {
        last_scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
      });
      await updateTurnMetrics(workspaceId, channelId, threadId, tokensUsed);

      return {
        answer,
        thread_id: threadId,
        scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
        router_decision: routerDecision,
        data_strategy: dataStrategy,
        tokens_used: tokensUsed,
        response_id: randomUUID(),
        feedback_enabled: true,
        ...(pandoraResult.evidence.tool_calls.length > 0 ? {
          evidence: pandoraResult.evidence,
          tool_call_count: pandoraResult.tool_call_count,
          latency_ms: pandoraResult.latency_ms,
        } : {}),
      } as any;
    } catch (err) {
      console.warn('[orchestrator] Pandora Agent failed, falling back to scoped analysis:', err);
      // Fall through to existing scoped analysis path
    }
  }

  if (!answer) {
    try {
    if (isFollowUp) {
      const recentMessages = (state.messages || []).slice(-4);
      const structuredState = buildStructuredState(state, recentMessages);

      let annotationContext = '';
      if (entityId) {
        try {
          const annotations = await getActiveAnnotations(workspaceId, scopeType, entityId);
          if (annotations.length > 0) {
            annotationContext = '\n\nUSER-PROVIDED CONTEXT (from team members, treat as authoritative):\n' +
              annotations.map(a => `- ${a.content} (${a.created_by || 'team'}, ${new Date(a.created_at).toLocaleDateString()})`).join('\n') +
              '\nIncorporate this context into your analysis. If it contradicts CRM data, note the discrepancy but trust the user context.';
          }
        } catch (err) {
          console.warn('[orchestrator] Failed to fetch annotations:', err);
        }
      }

      const analysis = await runScopedAnalysis({
        workspace_id: workspaceId,
        question: message,
        scope: {
          type: scopeType as any,
          entity_id: entityId,
          rep_email: repEmail,
          skill_run_context: structuredState + annotationContext,
        },
        format: 'text',
        max_tokens: 2000,
      });
      answer = analysis.answer;
      tokensUsed = analysis.tokens_used;
      routerDecision = 'follow_up';
      dataStrategy = 'scoped_analysis';
    } else {
      if (!inputScope && !anchor) {
        const repResult = await query<any>(
          `SELECT DISTINCT owner FROM deals
           WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost') AND owner IS NOT NULL
           LIMIT 20`,
          [workspaceId]
        );
        const repNames = repResult.rows.map((r: any) => r.owner);

        const skillIds = [
          'pipeline-hygiene', 'deal-risk-review', 'pipeline-coverage',
          'weekly-recap', 'single-thread-alert', 'data-quality-audit',
          'forecast-rollup', 'rep-scorecard',
        ];

        const route = await classifyDirectQuestion(workspaceId, message, skillIds, repNames);
        routerDecision = route.type;

        if (route.type === 'data_query' && route.filters?.rep) {
          const repMatch = await query<any>(
            `SELECT DISTINCT owner FROM deals
             WHERE workspace_id = $1 AND LOWER(owner) LIKE $2 LIMIT 1`,
            [workspaceId, `%${route.filters.rep.toLowerCase()}%`]
          );
          if (repMatch.rows.length > 0) {
            scopeType = 'rep';
            repEmail = repMatch.rows[0].owner;
          }
        } else if (route.type === 'skill_trigger' && route.skill_id) {
          const lastRun = await query<any>(
            `SELECT result FROM skill_runs
             WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
             ORDER BY completed_at DESC LIMIT 1`,
            [workspaceId, route.skill_id]
          );
          if (lastRun.rows.length > 0) {
            const summary = lastRun.rows[0].result?.narrative || lastRun.rows[0].result?.summary;
            if (summary) {
              answer = typeof summary === 'string' ? summary.slice(0, 2000) : JSON.stringify(summary).slice(0, 2000);
              dataStrategy = 'skill_run_lookup';
              tokensUsed = 0;

              await appendMessage(workspaceId, channelId, threadId, {
                role: 'assistant',
                content: answer,
                timestamp: new Date().toISOString(),
              });
              await updateContext(workspaceId, channelId, threadId, {
                last_scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
                skills_referenced: [route.skill_id],
              });

              return {
                answer,
                thread_id: threadId,
                scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
                router_decision: routerDecision,
                data_strategy: dataStrategy,
                tokens_used: tokensUsed,
                response_id: randomUUID(),
                feedback_enabled: false,
              };
            }
          }
        }

        dataStrategy = 'scoped_analysis';
      } else {
        dataStrategy = anchor ? 'anchor_context' : 'scoped_analysis';
      }

      let initialAnnotationContext = '';
      if (entityId) {
        try {
          const annotations = await getActiveAnnotations(workspaceId, scopeType, entityId);
          if (annotations.length > 0) {
            initialAnnotationContext = '\n\nUSER-PROVIDED CONTEXT (from team members, treat as authoritative):\n' +
              annotations.map(a => `- ${a.content} (${a.created_by || 'team'}, ${new Date(a.created_at).toLocaleDateString()})`).join('\n') +
              '\nIncorporate this context into your analysis. If it contradicts CRM data, note the discrepancy but trust the user context.';
          }
        } catch (err) {
          console.warn('[orchestrator] Failed to fetch annotations:', err);
        }
      }

      const baseContext = anchor?.result?.evidence || anchor?.result?.summary || '';
      const analysis = await runScopedAnalysis({
        workspace_id: workspaceId,
        question: message,
        scope: {
          type: scopeType as any,
          entity_id: entityId,
          rep_email: repEmail,
          skill_run_id: anchor?.skill_run_id,
          skill_run_context: baseContext ? baseContext + initialAnnotationContext : initialAnnotationContext || undefined,
        },
        format: 'text',
        max_tokens: 2000,
      });
      answer = analysis.answer;
      tokensUsed = analysis.tokens_used;
    }
    } catch (err) {
      console.error('[orchestrator] LLM analysis failed:', err);
      answer = "I wasn't able to analyze that right now. Please try again or ask a simpler question like \"How many deals do we have?\"";
      routerDecision = 'error_fallback';
      dataStrategy = 'none';
      tokensUsed = 0;
    }
  }

  if (!answer) {
    answer = "I wasn't able to process that request. Please try rephrasing your question.";
    routerDecision = 'error_fallback';
    dataStrategy = 'none';
  }

  await appendMessage(workspaceId, channelId, threadId, {
    role: 'assistant',
    content: answer,
    timestamp: new Date().toISOString(),
  });

  await updateContext(workspaceId, channelId, threadId, {
    last_scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
  });

  await updateTurnMetrics(workspaceId, channelId, threadId, tokensUsed);

  const responseId = randomUUID();
  const feedbackEnabled = routerDecision !== 'heuristic' && routerDecision !== 'rate_limited_fallback';

  const entitiesMentioned: ConversationTurnResult['entities_mentioned'] = {
    deals: [], accounts: [], reps: [],
  };
  if (scopeType === 'deal' && entityId) {
    try {
      const d = await query<any>(`SELECT name FROM deals WHERE id = $1 AND workspace_id = $2`, [entityId, workspaceId]);
      if (d.rows[0]) entitiesMentioned.deals.push({ id: entityId, name: d.rows[0].name });
    } catch {}
  } else if (scopeType === 'account' && entityId) {
    try {
      const a = await query<any>(`SELECT name FROM accounts WHERE id = $1 AND workspace_id = $2`, [entityId, workspaceId]);
      if (a.rows[0]) entitiesMentioned.accounts.push({ id: entityId, name: a.rows[0].name });
    } catch {}
  } else if (scopeType === 'rep' && repEmail) {
    entitiesMentioned.reps.push({ id: repEmail, name: repEmail });
  }

  return {
    answer,
    thread_id: threadId,
    scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
    router_decision: routerDecision,
    data_strategy: dataStrategy,
    tokens_used: tokensUsed,
    response_id: responseId,
    feedback_enabled: feedbackEnabled,
    entities_mentioned: entitiesMentioned,
  };
}

function buildStructuredState(state: ConversationState, recentMessages: any[]): string {
  const ctx = state.context;
  const stateObj = {
    focus: ctx.last_scope || { type: 'workspace' },
    entities_discussed: ctx.entities_discussed || [],
    skills_referenced: ctx.skills_referenced || [],
    filters_active: ctx.filters_active,
    turn_count: (ctx as any).turn_count || 0,
    recent_exchange: recentMessages.slice(-4).map(m => ({
      role: m.role,
      summary: m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content,
    })),
  };

  return `Conversation state:\n${JSON.stringify(stateObj, null, 2)}`;
}

async function tryHeuristicFallback(workspaceId: string, message: string): Promise<string | null> {
  try {
    const result = await query<any>(
      `SELECT count(*)::int as total,
         count(*) FILTER (WHERE stage_normalized NOT IN ('closed_won', 'closed_lost'))::int as open
       FROM deals WHERE workspace_id = $1`,
      [workspaceId]
    );
    const row = result.rows[0];
    if (row) {
      return `I can't do a deep analysis right now (rate limit reached), but here's a quick look: you have **${row.open}** open deals out of **${row.total}** total. Try a specific question like "What's our pipeline?" for instant data lookups.`;
    }
  } catch {}
  return null;
}

async function updateTurnMetrics(
  workspaceId: string,
  channelId: string,
  threadTs: string,
  tokensUsed: number
): Promise<void> {
  try {
    await query(
      `UPDATE conversation_state
       SET context = jsonb_set(
         jsonb_set(
           context,
           '{turn_count}',
           to_jsonb(COALESCE((context->>'turn_count')::int, 0) + 1),
           true
         ),
         '{total_token_cost}',
         to_jsonb(COALESCE((context->>'total_token_cost')::int, 0) + $4),
         true
       ),
       updated_at = now()
       WHERE workspace_id = $1 AND channel_id = $2 AND thread_ts = $3`,
      [workspaceId, channelId, threadTs, tokensUsed]
    );
  } catch (err) {
    console.warn('[orchestrator] Failed to update turn metrics:', err);
  }
}
