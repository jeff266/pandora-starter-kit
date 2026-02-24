import { query } from '../db.js';
import { runScopedAnalysis } from '../analysis/scoped-analysis.js';
import { tryHeuristic } from './heuristic-router.js';
import { classifyDirectQuestion, classifyIntent, logIntentClassification } from './intent-classifier.js';
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
import { logChatMessage } from '../lib/chat-logger.js';
import { estimateTokens } from './token-estimator.js';
import { callLLM } from '../utils/llm-router.js';
import { getWorkspaceContext, type WorkspaceContext } from './workspace-context.js';
import { synthesizeDocuments, formatDocumentResponse } from './document-synthesizer.js';
import { formatCurrency } from '../utils/format-currency.js';

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
  evidence?: any;
  tool_call_count?: number;
  latency_ms?: number;
  documents?: {
    docxPath: string;
    xlsxPath: string;
    docxFilename: string;
    xlsxFilename: string;
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

  // Log user message to chat_messages for in_app surface
  if (surface === 'in_app') {
    await logChatMessage({
      workspaceId,
      sessionId: threadId,
      surface: 'ask_pandora',
      role: 'user',
      content: message,
      scope: {
        type: inputScope?.type || 'workspace',
        entity_id: inputScope?.entity_id,
        rep_email: inputScope?.rep_email,
      },
    });
  }

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

  // ── Step 4.0: Intent Classification (in_app only) ────────────────────────────
  // Pre-dispatch routing to catch advisory questions before expensive tool calls.
  // Falls through to Pandora Agent for data_query or ambiguous categories.
  if (!answer && surface === 'in_app') {
    try {
      const conversationHistory = buildConversationHistory(state.messages || [] as any);
      const intentClassification = await classifyIntent(message, conversationHistory, workspaceId);

      console.log('[Intent]', JSON.stringify(intentClassification));

      await logIntentClassification(workspaceId, message, intentClassification);

      // Handle advisory_with_data_option: ask gating question
      if (
        intentClassification.category === 'advisory_with_data_option' &&
        intentClassification.confidence >= 0.75 &&
        !isGatingResponse(message, conversationHistory)
      ) {
        const gatingAnswer = intentClassification.gating_question!;

        await appendMessage(workspaceId, channelId, threadId, {
          role: 'assistant',
          content: gatingAnswer,
          timestamp: new Date().toISOString(),
        });

        await logChatMessage({
          workspaceId,
          sessionId: threadId,
          surface: 'ask_pandora',
          role: 'assistant',
          content: gatingAnswer,
          scope: {
            type: scopeType,
            entity_id: entityId,
            rep_email: repEmail,
          },
        });

        await updateContext(workspaceId, channelId, threadId, {
          last_scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
        });

        return {
          answer: gatingAnswer,
          thread_id: threadId,
          scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
          router_decision: 'gating_question',
          data_strategy: 'advisory_with_data_option',
          tokens_used: intentClassification.tokens_used,
          response_id: randomUUID(),
          feedback_enabled: false,
        };
      }

      // Handle advisory_stateless: skip tools, use Claude for advisory answer
      if (
        intentClassification.category === 'advisory_stateless' &&
        intentClassification.confidence >= 0.75
      ) {
        const conversationHistory = buildConversationHistory(state.messages || [] as any);
        return await handleAdvisoryResponse(
          message,
          workspaceId,
          threadId,
          channelId,
          scopeType,
          entityId,
          repEmail,
          conversationHistory
        );
      }

      // Handle user responding "best practice" to a gating question
      if (isGatingResponse(message, conversationHistory) && prefersBestPractice(message)) {
        const conversationHistory = buildConversationHistory(state.messages || [] as any);
        return await handleAdvisoryResponse(
          message,
          workspaceId,
          threadId,
          channelId,
          scopeType,
          entityId,
          repEmail,
          conversationHistory
        );
      }

      // Handle document_request: mine data then synthesize documents
      if (
        intentClassification.category === 'document_request' &&
        intentClassification.confidence >= 0.75
      ) {
        try {
          const history = buildConversationHistory(state.messages || [] as any);

          // Step 1: Run data mining through Pandora Agent
          let agentMessage = message;
          if (entityId && scopeType && !['workspace', 'pipeline', 'conversations'].includes(scopeType)) {
            agentMessage = `[Context: viewing ${scopeType} id=${entityId}] ${message}`;
          }

          const pandoraResult = await runPandoraAgent(workspaceId, agentMessage, history);

          // Step 2: Get workspace context
          const workspaceContext = await getWorkspaceContext(workspaceId);

          // Step 3: Synthesize documents
          const synthOutput = await synthesizeDocuments({
            userMessage: message,
            miningResult: {
              chatResponse: pandoraResult.answer,
              toolResults: pandoraResult.evidence.tool_calls.map((tc: any) => ({
                tool: tc.tool,
                result: tc.result,
                error: tc.error,
              })),
              toolCalls: pandoraResult.evidence.tool_calls,
            },
            workspaceContext,
            workspaceId,
          });

          // Step 4: Format response with download links
          const formattedAnswer = formatDocumentResponse(synthOutput, workspaceId, pandoraResult.answer);

          tokensUsed = pandoraResult.tokens_used;
          answer = formattedAnswer;
          routerDecision = 'document_request';
          dataStrategy = 'document_synthesis';

          await appendMessage(workspaceId, channelId, threadId, {
            role: 'assistant',
            content: formattedAnswer,
            timestamp: new Date().toISOString(),
            ...(pandoraResult.evidence.tool_calls.length > 0 ? {
              tool_trace: pandoraResult.evidence.tool_calls,
              cited_records: pandoraResult.evidence.cited_records,
            } : {}),
          } as any);

          await logChatMessage({
            workspaceId,
            sessionId: threadId,
            surface: 'ask_pandora',
            role: 'assistant',
            content: formattedAnswer,
            scope: {
              type: scopeType,
              entity_id: entityId,
              rep_email: repEmail,
            },
            tokenCost: tokensUsed,
          });

          await updateContext(workspaceId, channelId, threadId, {
            last_scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
          });
          await updateTurnMetrics(workspaceId, channelId, threadId, tokensUsed);

          return {
            answer: formattedAnswer,
            thread_id: threadId,
            scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
            router_decision: 'document_request',
            data_strategy: 'document_synthesis',
            tokens_used: tokensUsed,
            response_id: randomUUID(),
            feedback_enabled: true,
            evidence: pandoraResult.evidence,
            tool_call_count: pandoraResult.evidence.tool_calls.length,
            latency_ms: pandoraResult.latency_ms,
            documents: synthOutput,
          };
        } catch (err) {
          console.error('[orchestrator] Document synthesis failed:', (err as Error).message, (err as Error).stack);
          // Fall through to regular Pandora Agent on error
        }
      }

      // Fall through to Pandora Agent for data_query, ambiguous, or "mine data" choice
    } catch (err) {
      // Any error in intent classification → fall through silently to Pandora Agent
      console.warn('[orchestrator] Intent classification failed, falling through to Pandora Agent:', err);
    }
  }

  // ── Pandora Agent — exclusive path for all in_app questions ─────────────────
  // Free-text questions on the Command Center surface go here and nowhere else.
  // runScopedAnalysis is NOT a fallback for in_app — it's Slack-only (below).
  if (!answer && surface === 'in_app') {
    try {
      const history = buildConversationHistory(state.messages || [] as any);

      // Inject entity scope so deal/account page questions have context.
      // e.g. "What are the risks?" on a deal page needs to know which deal.
      let agentMessage = message;
      if (entityId && scopeType && !['workspace', 'pipeline', 'conversations'].includes(scopeType)) {
        agentMessage = `[Context: viewing ${scopeType} id=${entityId}] ${message}`;
      } else if (anchor?.result) {
        // Anchor context: user clicked a skill result and is asking a follow-up
        const skillContext = anchor.result.narrative || anchor.result.summary || '';
        if (skillContext) {
          agentMessage = `[Skill run context: ${String(skillContext).slice(0, 600)}]\n\n${message}`;
        }
      }

      const pandoraResult = await runPandoraAgent(workspaceId, agentMessage, history);

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

      // Log assistant message to chat_messages
      await logChatMessage({
        workspaceId,
        sessionId: threadId,
        surface: 'ask_pandora',
        role: 'assistant',
        content: answer,
        scope: {
          type: scopeType,
          entity_id: entityId,
          rep_email: repEmail,
        },
        tokenCost: tokensUsed,
      });

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
      console.error('[orchestrator] Pandora Agent failed:', err);
      answer = "I wasn't able to analyze that right now. Please try again in a moment.";
      routerDecision = 'error_fallback';
      dataStrategy = 'none';
      tokensUsed = 0;
    }
  }

  // ── Slack path — runScopedAnalysis for slack_thread / slack_dm ───────────────
  // in_app questions never reach here; Pandora Agent handles them exclusively.
  if (!answer && surface !== 'in_app') {
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

// ============================================================================
// Advisory Response Helpers (Intent Classifier - Step 4.0)
// ============================================================================

function isGatingResponse(
  message: string,
  history: Array<{ role: string; content: string }>,
): boolean {
  // Check if the previous assistant message was a gating question
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant) return false;

  const gatingPhrases = [
    'general revops best practice',
    'mine your actual',
    'which would be more useful',
    'two ways',
    'two approaches',
  ];

  return gatingPhrases.some(phrase =>
    lastAssistant.content.toLowerCase().includes(phrase)
  );
}

function prefersBestPractice(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /\b(best practice|general|framework|generic|just|without data|don't need data)\b/.test(lower) ||
    /^(best practice|general|just the framework|no data)/i.test(lower)
  );
}

function buildAdvisorySystemPrompt(workspaceContext: WorkspaceContext | null): string {
  const base = `You are Pandora, an AI RevOps advisor for B2B SaaS companies.
You have deep expertise in pipeline management, forecasting, ICP development,
sales process design, and RevOps tooling.

Answer the user's question with specific, practical guidance.
Avoid generic advice — be opinionated and direct.
When recommending frameworks or structures, explain the reasoning behind each choice.`;

  if (!workspaceContext) return base;

  // Build context bullets - only show non-null fields
  const contextBullets: string[] = [];

  if (workspaceContext.workspace_name) {
    contextBullets.push(`Company: ${workspaceContext.workspace_name}`);
  }
  if (workspaceContext.gtm_motion) {
    contextBullets.push(`GTM motion: ${workspaceContext.gtm_motion}`);
  }
  if (workspaceContext.segment) {
    contextBullets.push(`Segment: ${workspaceContext.segment}`);
  }
  if (workspaceContext.industry) {
    contextBullets.push(`Industry: ${workspaceContext.industry}`);
  }
  if (workspaceContext.acv_range) {
    contextBullets.push(`ACV range: ${workspaceContext.acv_range}`);
  }
  if (workspaceContext.avg_deal_size !== null && workspaceContext.avg_deal_size !== undefined) {
    contextBullets.push(`Avg deal size: ${formatCurrency(workspaceContext.avg_deal_size)}`);
  }
  if (workspaceContext.avg_sales_cycle_days !== null && workspaceContext.avg_sales_cycle_days !== undefined) {
    contextBullets.push(`Avg sales cycle: ${Math.round(workspaceContext.avg_sales_cycle_days)} days`);
  }
  if (workspaceContext.win_rate !== null && workspaceContext.win_rate !== undefined) {
    contextBullets.push(`Win rate: ${Math.round(workspaceContext.win_rate * 100)}%`);
  }
  if (workspaceContext.open_deals_count !== null && workspaceContext.open_deals_count !== undefined) {
    contextBullets.push(`Open deals: ${workspaceContext.open_deals_count}`);
  }
  if (workspaceContext.top_industries && workspaceContext.top_industries.length > 0) {
    contextBullets.push(`Top industries: ${workspaceContext.top_industries.slice(0, 3).join(', ')}`);
  }
  if (workspaceContext.top_personas && workspaceContext.top_personas.length > 0) {
    contextBullets.push(`Top personas: ${workspaceContext.top_personas.slice(0, 3).join(', ')}`);
  }
  if (workspaceContext.top_competitors && workspaceContext.top_competitors.length > 0) {
    contextBullets.push(`Top competitors mentioned: ${workspaceContext.top_competitors.slice(0, 3).join(', ')}`);
  }
  if (workspaceContext.top_objections && workspaceContext.top_objections.length > 0) {
    contextBullets.push(`Common objections: ${workspaceContext.top_objections.slice(0, 3).join(', ')}`);
  }

  if (contextBullets.length === 0) {
    return base;
  }

  // Build data coverage caveats
  const caveats: string[] = [];
  if (!workspaceContext.has_icp_profile) {
    caveats.push('ICP profile analysis has not been run yet - persona and industry data may be incomplete.');
  }
  if (!workspaceContext.has_conversation_signals) {
    caveats.push('Conversation signal extraction has not been run yet - competitor and objection data may be incomplete.');
  }

  const contextSection = `\nCompany context:\n${contextBullets.map(b => `- ${b}`).join('\n')}`;
  const caveatSection = caveats.length > 0
    ? `\n\nData coverage notes:\n${caveats.map(c => `- ${c}`).join('\n')}`
    : '';

  return `${base}${contextSection}${caveatSection}

Tailor your recommendations to this company's specific profile.
For example, objection handling for a $150K ACV enterprise product looks very different
from objection handling for a $10K SMB product.`;
}

async function handleAdvisoryResponse(
  message: string,
  workspaceId: string,
  threadId: string,
  channelId: string,
  scopeType: string,
  entityId: string | undefined,
  repEmail: string | undefined,
  conversationHistory: Array<{ role: string; content: string }>,
): Promise<ConversationTurnResult> {
  // Step 1: Get workspace context
  const workspaceContext = await getWorkspaceContext(workspaceId);

  // Step 2: Build advisory prompt with workspace context
  const systemPrompt = buildAdvisorySystemPrompt(workspaceContext);

  // Step 3: Call Claude (always Claude for final user-facing advisory answers)
  const response = await callLLM(workspaceId, 'reason', {
    systemPrompt,
    messages: [
      ...conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: message },
    ],
    maxTokens: 1500,
    temperature: 0.3,
    _tracking: {
      workspaceId,
      phase: 'chat',
      stepName: 'advisory-response',
      questionText: message.slice(0, 500),
    },
  });

  const answer = response.content;
  const tokensUsed = response.usage.input + response.usage.output;

  await appendMessage(workspaceId, channelId, threadId, {
    role: 'assistant',
    content: answer,
    timestamp: new Date().toISOString(),
  });

  await logChatMessage({
    workspaceId,
    sessionId: threadId,
    surface: 'ask_pandora',
    role: 'assistant',
    content: answer,
    scope: {
      type: scopeType,
      entity_id: entityId,
      rep_email: repEmail,
    },
    tokenCost: tokensUsed,
  });

  await updateContext(workspaceId, channelId, threadId, {
    last_scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
  });

  await updateTurnMetrics(workspaceId, channelId, threadId, tokensUsed);

  return {
    answer,
    thread_id: threadId,
    scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
    router_decision: 'advisory_stateless',
    data_strategy: 'advisory_stateless',
    tokens_used: tokensUsed,
    response_id: randomUUID(),
    feedback_enabled: true,
  };
}
