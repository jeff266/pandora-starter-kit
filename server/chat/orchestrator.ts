import { 
  captureSuccessfulClassificationPair, 
  captureStrategicRoutingMiss,
  captureContradictionClassificationPair 
} from '../llm/training-capture.js';
import { query } from '../db.js';
import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from './intent-classifier.js';
import { PANDORA_PRODUCT_KNOWLEDGE, PANDORA_SUPPORT_CONTEXT } from './pandora-knowledge.js';
import { runScopedAnalysis } from '../analysis/scoped-analysis.js';
import { tryHeuristic } from './heuristic-router.js';
import { classifyDirectQuestion, classifyIntent, logIntentClassification } from './intent-classifier.js';
import { goalService } from '../goals/goal-service.js';
import { createInvestigationPlan } from '../investigation/planner.js';
import { executeInvestigation } from '../investigation/executor.js';
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
import { runPandoraAgent, buildConversationHistory, compressReasoningThread } from './pandora-agent.js';
import { classifyDeliberationMode } from './intent-classifier.js';
import { extractWorkspaceKnowledge } from './workspace-knowledge.js';
import { detectMetricAssertion, getComputedMetric, buildComparisonResponse } from './metric-assertion.js';
import { runDeliberation, type DeliberationResult } from './deliberation-engine.js';
import { logChatMessage } from '../lib/chat-logger.js';
import { estimateTokens } from './token-estimator.js';
import { callLLM } from '../utils/llm-router.js';
import { getWorkspaceContext, type WorkspaceContext } from './workspace-context.js';
import { synthesizeDocuments, formatDocumentResponse } from './document-synthesizer.js';
import { formatCurrency } from '../utils/format-currency.js';
import { runRetroPipeline } from '../retro/pipeline.js';
import { createSessionContext, type SessionContext } from '../agents/session-context.js';
import { extractSkillContext, formatMethodologyComparisons } from './context-assembler.js';
import { buildConversationContext } from '../context/build-conversation-context.js';
import { PandoraResponseBuilder } from '../lib/pandora-response-builder.js';
import { getCalibrationStatus } from '../lib/data-dictionary.js';
import { getInterviewState, buildInterviewPrompt, advanceInterview, advanceAndConfirmStep, buildCompletionSummary, STEP_LABELS, resetInterviewState } from '../lib/calibration-interview.js';
import { getUnmappedStages, buildStageMappingResponse, buildStageMappingTablePrompt, confirmStageMapping, isStageMappingComplete } from '../lib/stage-mapping-interview.js';
import type { NormalizedStage } from '../lib/stage-mapping-interview.js';

const CALIBRATION_TRIGGERS = /\b(calibrat|calibrate|calibration|map.*stage|stage.*map|set up pipeline|define pipeline|what counts as pipeline|define.*at.?risk|define.*commit|define.*win.?rate|setup calibration|start calibration|pipeline definition|interview)\b/i;
const CALIBRATION_START_OVER = /\b(start over|start fresh|reset calibration|begin again|restart calibration|reset and start)\b/i;

/**
 * Classifies whether a mid-calibration message is a clarifying question,
 * an explicit confirmation, or a substantive answer that should advance the step.
 */
function classifyCalibrationInput(message: string): 'question' | 'confirmation' | 'answer' {
  const trimmed = message.trim();
  const lower   = trimmed.toLowerCase();

  // Ends with '?' → definitely a question
  if (trimmed.endsWith('?')) return 'question';

  // Starts with a question word → clarifying question
  if (/^(is|are|does|do|will|should|can|how|what|why|when|which)\b/i.test(trimmed)) return 'question';

  // Explicit affirmative confirmations → advance
  if (/\b(yes|correct|right|confirmed|looks good|that'?s? right|sounds right|sounds good|perfect|ok|okay|agree|works for me|go ahead|proceed)\b/i.test(lower)) return 'confirmation';

  // Numeric values — quota, threshold, percentage, multiplier, day count → advance
  if (/\d+(\.\d+)?\s*(x|%|k|m|days?|weeks?)?/i.test(lower)) return 'answer';

  // Named/definitional values that are substantive answers → advance
  if (/\b(global|per.?pipeline|by pipeline|all pipelines|count.?based|value.?based|dollar.?based|trailing|rolling|quarterly|annual|commit|best.?case|forecast.?category|no activity|inactivity|stage.?name|custom.?field|renewal|expansion|no|none|skip|exclude|include)\b/i.test(lower)) return 'answer';

  // Default: treat as a question — never silently advance on ambiguous input
  return 'question';
}

export interface ConversationTurnInput {
  surface: 'slack_thread' | 'slack_dm' | 'in_app';
  workspaceId: string;
  threadId: string;
  channelId: string;
  message: string;
  userId?: string;
  userRole?: 'admin' | 'manager' | 'rep' | 'analyst' | 'viewer' | 'member';
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
    type?: string;
  };
  conciergeContext?: {
    quarter?: string;
    attainmentPct?: number;
    pipelineScope?: {
      totalValue?: number | null;
      dealCount?: number | null;
      coverageRatio?: number | null;
    };
    topFindings?: Array<{ severity: string; message: string }>;
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
  follow_up_questions?: string[];
  documents?: {
    docxPath: string;
    xlsxPath: string;
    docxFilename: string;
    xlsxFilename: string;
  };
  inline_actions?: any[];
  deliberation?: DeliberationResult;
  chart_specs?: any[];
  chart?: any;
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

function detectComplexRequest(message: string): boolean {
  if (message.length > 100) return true;

  const COMPLEX_PATTERNS = [
    /why\s+(is|did|has|was|are|does|do)\b/i,
    /should\s+(i|we|the\s+team)\b/i,
    /\b(prepare|analyze|investigate|compare|evaluate|assess)\b/i,
    /\b(strategy|plan\s+for|what\s+should\s+(i|we))\b/i,
    /\b(what'?s?\s+going\s+on|pull\s+the\s+thread|dig\s+into)\b/i,
    /\b(across\s+(all|the|my)|portfolio|team-wide|this\s+week'?s?\s+priorities)\b/i,
    /\b(prepare\s+me|brief\s+me|get\s+me\s+ready)\b/i,
  ];

  return COMPLEX_PATTERNS.some(p => p.test(message));
}

export async function handleConversationTurn(input: ConversationTurnInput): Promise<ConversationTurnResult> {
  const { workspaceId, channelId, threadId, message, surface, anchor, scope: inputScope, userId, userRole, conciergeContext } = input;

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

  if (conciergeContext && !isFollowUp) {
    const parts: string[] = ['[Concierge Briefing Context]'];
    if (conciergeContext.quarter) parts.push(`Quarter: ${conciergeContext.quarter}`);
    if (conciergeContext.attainmentPct != null) parts.push(`Attainment: ${Math.round(conciergeContext.attainmentPct)}%`);
    if (conciergeContext.pipelineScope) {
      const ps = conciergeContext.pipelineScope;
      if (ps.totalValue != null) parts.push(`Pipeline: ${formatCurrency(ps.totalValue)}`);
      if (ps.dealCount != null) parts.push(`Deal count: ${ps.dealCount}`);
      if (ps.coverageRatio != null) parts.push(`Coverage: ${ps.coverageRatio.toFixed(1)}×`);
    }
    if (conciergeContext.topFindings?.length) {
      parts.push('Key findings:');
      for (const f of conciergeContext.topFindings.slice(0, 5)) {
        parts.push(`  [${f.severity}] ${f.message}`);
      }
    }
    await appendMessage(workspaceId, channelId, threadId, {
      role: 'system',
      content: parts.join('\n'),
      timestamp: new Date().toISOString(),
    });
  }

  // ── Entity graph injection ──────────────────────────────────────────────
  // Complexity-gated: single-entity questions skip the graph entirely.
  // Multi-hop and aggregate questions get the relevant graph subgraph + routing hint.
  // Only injected on first turn — follow-ups rely on established context.
  if (!isFollowUp) {
    try {
      const effectiveRole = (userRole ?? 'admin') as Parameters<typeof buildConversationContext>[0]['role'];
      const anchorType = (inputScope?.type) as 'deal' | 'rep' | 'pipeline' | undefined;
      const graphCtx = await buildConversationContext({
        workspaceId,
        userId: userId || '',
        role: effectiveRole,
        surface: conciergeContext ? 'concierge' : 'ask_pandora',
        question: message,
        cardAnchor: anchorType && ['deal', 'rep', 'pipeline'].includes(anchorType)
          ? { type: anchorType as 'deal' | 'rep' | 'pipeline', entity_id: inputScope?.entity_id }
          : undefined,
      });

      if (graphCtx.entity_graph) {
        const graphParts: string[] = ['[Entity Graph — Data Model]'];
        graphParts.push(JSON.stringify(graphCtx.entity_graph, null, 2));
        if (graphCtx.routing_hint?.length) {
          graphParts.push(`\nQUERY PATH: ${graphCtx.routing_hint.join(' → ')}`);
        }
        if (graphCtx.pre_loaded) {
          graphParts.push(`\nPRE-LOADED ENTITY:\n${JSON.stringify(graphCtx.pre_loaded, null, 2)}`);
        }
        await appendMessage(workspaceId, channelId, threadId, {
          role: 'system',
          content: graphParts.join('\n'),
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      // Non-fatal — graph injection is best-effort
      console.warn('[orchestrator] Entity graph injection failed (non-fatal):', err);
    }
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

  // Create SessionContext with user role for RBAC data scoping (T10)
  const sessionContext = createSessionContext(
    {
      type: scopeType as any,
      entityId,
      repEmail,
    },
    workspaceId
  );
  sessionContext.userId = userId;
  sessionContext.userRole = userRole;

  let routerDecision = 'unknown';
  let dataStrategy = 'unknown';
  let tokensUsed = 0;
  let answer: string | undefined;

  const lastAssistantContent = (state.messages || [])
    .filter(m => m.role === 'assistant')
    .pop()?.content ?? '';

  // Pre-fetch calibration status so resumption detection and branch entry can use it
  // without a second DB round-trip inside the calibration block.
  let preCalStatus: Awaited<ReturnType<typeof getCalibrationStatus>> | null = null;
  try { preCalStatus = await getCalibrationStatus(workspaceId); } catch { /* non-fatal */ }

  // A conversation is "in calibration" if the last assistant turn contained calibration
  // phrasing (live session) OR the persisted status is in_progress and this is the first
  // assistant turn (mid-session refresh / new conversation continuing an interrupted flow).
  const hasNoAssistantHistory = lastAssistantContent === '';
  const inCalibrationSession = (
    /\*\*Step \d+ of 6/i.test(lastAssistantContent) ||
    /stage.*map|map.*stage|unmapped stage/i.test(lastAssistantContent) ||
    /does this match.*pipeline|how do you define|how do you map/i.test(lastAssistantContent) ||
    /looks right.*to confirm all|correct anything that looks wrong/i.test(lastAssistantContent) ||
    // Resumption prompt — user seeing "where your Pandora calibration left off"
    /pandora calibration left off/i.test(lastAssistantContent) ||
    /next up:.*pipeline|next up:.*win rate|next up:.*at.?risk|next up:.*commit|next up:.*forecast/i.test(lastAssistantContent) ||
    (hasNoAssistantHistory && preCalStatus?.status === 'in_progress')
  );

  if (feedback && feedback.type !== 'correct' && !inCalibrationSession) {
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

  // ── Metric Assertion Detection & Comparison ────────────────────────────────────
  // Check for metric assertions (e.g. "our win rate is 30%") before routing to PandoraAgent
  let metricEvidence: any = undefined;
  if (!answer) {
    const assertion = detectMetricAssertion(message);
    if (assertion) {
      const computeStart = Date.now();
      const computed = await getComputedMetric(
        assertion.metric_key, workspaceId
      );
      const computeDuration = Date.now() - computeStart;

      // Build comparison response — don't write anything yet
      answer = buildComparisonResponse(assertion, computed);
      routerDecision = 'metric_assertion_comparison';
      dataStrategy = 'computed_comparison';

      // Build evidence/trace entry for Show the Math
      if (computed) {
        metricEvidence = {
          tool_calls: [{
            tool: 'compute_metric',
            params: {
              metric_key: assertion.metric_key,
              workspace_id: workspaceId,
              lookback: '12 months',
            },
            result: {
              value: computed.value,
              unit: computed.unit,
              methodology: computed.methodology,
              computed_at: computed.computed_at,
            },
            description: `Computed ${assertion.metric_key} from CRM data`,
            duration_ms: computeDuration,
          }],
        };
      }

      // If no computed value, store as asserted with low
      // confidence in workspace_knowledge (not metric_definitions)
      if (!computed) {
        await extractWorkspaceKnowledge(
          `${assertion.metric_key} is ${assertion.asserted_value}`,
          workspaceId
        ).catch(() => {});
      }
      // If computed exists, DON'T write anything yet.
      // Wait for explicit user confirmation in the next turn.
    }
  }

  // ── Reasoning thread: read persisted value for early-branch use ─────────────
  // Compression lifecycle runs at Step 3.9 (before intent classification).
  // We read the stored value here so calibration branches have access to it
  // without waiting for the compression pass.
  let activeReasoningThread: string | null = (state.context as any).reasoningThread ?? null;

  // ── Calibration Interview Routing ────────────────────────────────────────────
  // The state machine owns the question sequence. The LLM never decides what to
  // ask next — it only receives the structured output as the answer string.
  //
  // Two entry conditions:
  //   1. Explicit calibration-intent phrase (CALIBRATION_TRIGGERS)
  //   2. User is mid-interview (last assistant message was a calibration question)
  //      — any reply in this case advances the state and returns the next question.

  if (!answer && (CALIBRATION_TRIGGERS.test(message) || inCalibrationSession)) {
    console.log('[Calibration] Branch entered — trigger:', CALIBRATION_TRIGGERS.test(message), '| inSession:', inCalibrationSession);
    try {
      const calStatus = preCalStatus ?? await getCalibrationStatus(workspaceId);
      console.log('[Calibration] status:', JSON.stringify(calStatus));

      // Stage mapping must be complete before dimension calibration
      const unmappedStages = await getUnmappedStages(workspaceId);
      console.log('[Calibration] unmappedStages count:', unmappedStages.length, '— first:', unmappedStages[0]?.crm_stage_name ?? 'none');

      if (unmappedStages.length > 0) {
        // ── STAGE MAPPING PHASE (table-based) ────────────────────────────────
        const msgLower = message.toLowerCase().replace(/_/g, ' ');

        // Detect affirmative: "looks right", "all correct", "that's right", "yes", etc.
        const isAffirmative = /\b(looks? right|all correct|that'?s? right|yes|yeah|yep|correct|confirmed|good|ok(ay)?|sounds good|perfect|exactly)\b/i.test(message);

        // Detect a correction: e.g. "Demo Conducted is actually Demo" or "Pilot is Evaluation"
        const normalizedStages: NormalizedStage[] = [
          'prospecting', 'qualification', 'demo', 'evaluation', 'proposal',
          'negotiation', 'closed_won', 'closed_lost',
        ];

        // Find any mentioned CRM stage name in the user's message
        let correctedCrmStage: string | null = null;
        let correctedMapping: NormalizedStage | null = null;

        if (inCalibrationSession && !isAffirmative) {
          // Try to parse a correction like "X is actually Y" or "X should be Y"
          // Extract the right-hand side (after "is", "should be", "actually", "→", "=")
          // to determine the target mapping — prevents "Evaluation is actually Demo"
          // from being mis-classified as 'evaluation' (the first token found).
          const correctionRhs = msgLower
            .replace(/.*?\b(?:is actually|should be|is really|maps to|→|=)\s*/i, '')
            .trim();

          for (const stage of unmappedStages) {
            const stageLower = stage.crm_stage_name.toLowerCase().replace(/_/g, ' ');
            if (msgLower.includes(stageLower)) {
              correctedCrmStage = stage.crm_stage_name;
              // Look for the target mapping in the right-hand side first; fall back to whole message
              correctedMapping = normalizedStages.find(s =>
                correctionRhs.includes(s.replace(/_/g, ' '))
              ) ?? normalizedStages.find(s =>
                msgLower.includes(s.replace(/_/g, ' ')) && s.replace(/_/g, ' ') !== stageLower
              ) ?? null;
              break;
            }
          }
          // Fallback: maybe user just typed the normalized name without the CRM name
          if (!correctedCrmStage) {
            correctedMapping = normalizedStages.find(s =>
              correctionRhs.includes(s.replace(/_/g, ' '))
            ) ?? normalizedStages.find(s =>
              msgLower.includes(s.replace(/_/g, ' '))
            ) ?? null;
          }
        }

        const skipMatch = /\b(skip|ignore|exclude|don't count|dont count|not applicable|n\/a)\b/i.test(message);

        if (inCalibrationSession && isAffirmative) {
          // Confirm all staged mappings at once (use suggested_mapping or closed_lost as fallback)
          for (const stage of unmappedStages) {
            const mapping: NormalizedStage = stage.suggested_mapping ?? 'closed_lost';
            await confirmStageMapping(workspaceId, stage.crm_stage_name, mapping, stage.normalized_stage_current);
          }
          // All stages mapped — advance interview state to active_pipeline
          const interviewState = await getInterviewState(workspaceId);
          const nextStep = interviewState.current_step === 'stage_mapping'
            ? await advanceInterview(workspaceId, 'stage_mapping')
            : interviewState.current_step;

          if (nextStep === 'complete') {
            answer = await buildCompletionSummary(workspaceId);
          } else {
            const nextQuestion = await buildInterviewPrompt(workspaceId, nextStep);
            answer = `All stages mapped. ✓\n\n${nextQuestion}`;
          }

        } else if (inCalibrationSession && correctedCrmStage && correctedMapping) {
          // Apply the single correction and re-show the updated table
          const correctedStageInfo = unmappedStages.find(s => s.crm_stage_name === correctedCrmStage);
          const correctedImportNormalized = correctedStageInfo?.normalized_stage_current ?? '';
          await confirmStageMapping(workspaceId, correctedCrmStage, correctedMapping, correctedImportNormalized);
          const remaining = await getUnmappedStages(workspaceId);

          if (remaining.length > 0) {
            answer = `Updated **${correctedCrmStage}** → **${correctedMapping}**.`;
          } else {
            // That correction cleared the last unmapped stage
            const interviewState = await getInterviewState(workspaceId);
            const nextStep = interviewState.current_step === 'stage_mapping'
              ? await advanceInterview(workspaceId, 'stage_mapping')
              : interviewState.current_step;

            if (nextStep === 'complete') {
              answer = await buildCompletionSummary(workspaceId);
            } else {
              const nextQuestion = await buildInterviewPrompt(workspaceId, nextStep);
              answer = `All stages mapped. ✓\n\n${nextQuestion}`;
            }
          }

        } else if (inCalibrationSession && skipMatch) {
          // Skip the first unmapped stage
          const skipStage = unmappedStages[0];
          await confirmStageMapping(workspaceId, skipStage.crm_stage_name, 'closed_lost', skipStage.normalized_stage_current);
          const remaining = await getUnmappedStages(workspaceId);

          if (remaining.length > 0) {
            answer = buildStageMappingTablePrompt(remaining);
          } else {
            const interviewState = await getInterviewState(workspaceId);
            const nextStep = interviewState.current_step === 'stage_mapping'
              ? await advanceInterview(workspaceId, 'stage_mapping')
              : interviewState.current_step;

            if (nextStep === 'complete') {
              answer = await buildCompletionSummary(workspaceId);
            } else {
              const nextQuestion = await buildInterviewPrompt(workspaceId, nextStep);
              answer = `All stages mapped. ✓\n\n${nextQuestion}`;
            }
          }

        } else {
          // First trigger or unrecognized reply — show the full table
          answer = buildStageMappingTablePrompt(unmappedStages);
        }

        routerDecision = 'calibration_stage_mapping';
        dataStrategy = 'calibration';

      } else {
        // ── DIMENSION INTERVIEW PHASE ────────────────────────────────────────
        const interviewState = await getInterviewState(workspaceId);
        const step = interviewState.current_step;
        console.log('[Calibration] interviewState step:', step, '| completed:', interviewState.completed_steps?.join(',') ?? 'none');

        // Detect a genuine new-chat resumption entry: no prior assistant turns and
        // calibration is in_progress with at least one completed step.  This must be
        // checked BEFORE the inCalibrationSession active-session branch so that the
        // first message in a new conversation always shows the resumption checklist
        // rather than being misrouted through intent classification.
        const isResumptionEntry =
          hasNoAssistantHistory &&
          calStatus.status === 'in_progress' &&
          interviewState.completed_steps.length > 0;

        if (step === 'complete') {
          answer = await buildCompletionSummary(workspaceId);

        } else if (CALIBRATION_START_OVER.test(message)) {
          // User wants to reset — clear state and restart from stage mapping.
          // resetInterviewState() deletes calibration-sourced stage_mappings rows
          // so getUnmappedStages() reflects the true state of the CRM stages.
          await resetInterviewState(workspaceId);
          const freshStages = await getUnmappedStages(workspaceId);
          console.log('[Calibration] Start-over requested — reset complete, freshStages:', freshStages.length);

          if (freshStages.length > 0) {
            // Stage mapping step: show the table so user can re-confirm
            answer = `Resetting your calibration. Let's start fresh from the beginning.\n\n${buildStageMappingTablePrompt(freshStages)}`;
          } else {
            // No unmapped stages (Setup Interview already mapped them via non-calibration source).
            // Auto-advance past stage_mapping and begin at the first dimension step.
            const nextStep = await advanceInterview(workspaceId, 'stage_mapping');
            console.log('[Calibration] No stages to map after reset — auto-advancing to:', nextStep);
            if (nextStep === 'complete') {
              answer = await buildCompletionSummary(workspaceId);
            } else {
              const firstQuestion = await buildInterviewPrompt(workspaceId, nextStep);
              answer = `Resetting your calibration. Stage mappings are already set up — let's start fresh with the dimension interview.\n\n${firstQuestion}`;
            }
          }

        } else if (isResumptionEntry) {
          // New-chat resumption — show completed steps checklist and next step
          const completedLabels = interviewState.completed_steps
            .map(s => `- ✓ ${STEP_LABELS[s] ?? s}`)
            .join('\n');
          const nextLabel = STEP_LABELS[step] ?? step;
          console.log('[Calibration] Resumption prompt (new chat) — completed:', interviewState.completed_steps.join(','), '| next:', step);
          answer = `Welcome back! Here's where your Pandora calibration left off:\n\n${completedLabels}\n\n**Next up: ${nextLabel}**\n\nSay **"Ready to continue"** to pick up where you left off, or **"Start over"** to reset and begin fresh.`;

        } else if (inCalibrationSession && step !== 'stage_mapping') {
          // If the previous turn was a resumption prompt and user says "continue" / "ready",
          // just show the current step question without advancing the state machine.
          const lastTurnWasResumptionPrompt =
            /pandora calibration left off/i.test(lastAssistantContent) ||
            /next up:.*pipeline|next up:.*win rate|next up:.*at.?risk|next up:.*commit|next up:.*forecast/i.test(lastAssistantContent);
          const isContinueSignal = /\b(continue|ready|let'?s? go|proceed|pick up|resume|yes|ok|okay|sure|sounds good)\b/i.test(message);

          if (lastTurnWasResumptionPrompt && isContinueSignal) {
            console.log('[Calibration] Resumption continue — showing current step:', step);
            answer = await buildInterviewPrompt(workspaceId, step);
          } else {
          // Classify the user's input before deciding whether to advance
          const inputIntent = classifyCalibrationInput(message);
          console.log('[Calibration] Intent:', inputIntent, '| step:', step);

          if (inputIntent === 'question') {
            // User asked a clarifying question — answer it via LLM and re-ask the current step
            // so inCalibrationSession stays true for the next message
            const currentStepQuestion = await buildInterviewPrompt(workspaceId, step);
            const { messages: convHistory } = await buildConversationHistory(state.messages || [], { workspaceId, reasoningThread: activeReasoningThread });
            const llmResponse = await callLLM(workspaceId, 'reason', {
              systemPrompt: `You are Pandora, a revenue intelligence AI running a calibration interview.
The user is currently on this calibration step:

${currentStepQuestion}

Answer their clarifying question briefly and accurately (2–3 sentences). Then re-ask the calibration question above verbatim so the interview can continue. Do not advance to a new topic.`,
              messages: [
                ...convHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
                { role: 'user', content: message },
              ],
              maxTokens: 800,
              temperature: 0.3,
              _tracking: {
                workspaceId,
                phase: 'chat',
                stepName: 'calibration-question-answer',
                questionText: message.slice(0, 200),
              },
            });
            answer = llmResponse.content;
            tokensUsed = llmResponse.usage.input + llmResponse.usage.output;
            console.log('[Calibration] Answered question, staying on step:', step);

          } else {
            // Confirmed answer or named value — save scope if pipeline_coverage, then advance
            if (step === 'pipeline_coverage') {
              const isPerPipeline = /\b(per.?pipeline|by pipeline|separate|each pipeline)\b/i.test(message);
              const scope = isPerPipeline ? 'per_pipeline' : 'global';
              await query(
                `UPDATE workspaces
                 SET workspace_config = jsonb_set(
                   COALESCE(workspace_config, '{}'),
                   '{calibration,coverage_target_scope}',
                   $2::jsonb
                 )
                 WHERE id = $1`,
                [workspaceId, JSON.stringify(scope)]
              );
              console.log('[Calibration] Saved coverage_target_scope:', scope);
            }

            const nextStep = await advanceAndConfirmStep(workspaceId, step);
            console.log('[Calibration] Advanced+confirmed:', step, '→', nextStep);

            if (nextStep === 'complete') {
              answer = await buildCompletionSummary(workspaceId);
            } else {
              answer = await buildInterviewPrompt(workspaceId, nextStep);
            }
          }
          }  // closes resumption-check else block

        } else {
          // Fresh calibration trigger (not a resumption entry) — show current step question
          answer = await buildInterviewPrompt(workspaceId, step);
        }

        console.log('[Calibration] answer built:', answer ? 'YES (' + answer.length + ' chars)' : 'NULL');
        routerDecision = 'calibration_interview';
        dataStrategy = 'calibration';
      }

      // tokensUsed already set by LLM call on question-answer path; 0 for state-machine paths
    } catch (calErr) {
      const msg = (calErr as Error).message ?? '';

      // Schema errors are infrastructure failures — log as error so they
      // surface in monitoring. Answer remains null → falls through to LLM.
      const isFatal =
        msg.includes('column') ||
        msg.includes('does not exist') ||
        msg.includes('relation') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('connect ETIMEDOUT');

      if (isFatal) {
        console.error('[orchestrator] Calibration routing FATAL error:', msg);
      } else {
        console.warn('[orchestrator] Calibration routing failed, falling through to LLM:', msg);
      }
    }
  }

  if (!answer) {
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
  }

  // ── Goal-Aware Investigation Routing ─────────────────────────────────────────
  // When a question references goal-tracking keywords and structured goals exist,
  // route through the investigation engine for deeper, causal analysis.
  // GUARD: Skip investigation routing for definitional/advisory questions — these
  // contain goal-related nouns (e.g. "coverage") but don't need data.
  const advisoryGuard = /^(how do you|how do we|how is|how are|what (is|are|does)|explain|define|what does|what counts|what qualifies)\b/i;
  // GUARD: Skip investigation routing for explicit future-quarter scoping — the
  // investigation engine only knows the current period; Pandora Agent handles temporal.
  const futureQuarterGuard = /\b(next quarter|next month|q2|q3|q4|q[234])\b/i;
  const goalKeywords = /\b(number|target|goal|quota|hitting|miss|track|forecast|behind|ahead|gap|pace|run rate|attainment|coverage|on.?track)\b/i;
  if (!answer && goalKeywords.test(message) && !advisoryGuard.test(message) && !futureQuarterGuard.test(message)) {
    try {
      const goals = await goalService.list(workspaceId, { is_active: true });
      if (goals.length > 0) {
        console.log(`[Orchestrator] Goal-aware investigation routing for: "${message.slice(0, 80)}"`);
        const plan = await createInvestigationPlan(workspaceId, message, { maxSteps: 5 });
        const result = await executeInvestigation(plan, {});

        answer = result.synthesis;
        routerDecision = 'investigation';
        dataStrategy = 'goal_aware_investigation';
        tokensUsed = result.total_tokens;

        await appendMessage(workspaceId, channelId, threadId, {
          role: 'assistant',
          content: answer,
          timestamp: new Date().toISOString(),
        });
        await updateTurnMetrics(workspaceId, channelId, threadId, tokensUsed);

        return {
          answer,
          thread_id: threadId,
          scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
          router_decision: routerDecision,
          data_strategy: dataStrategy,
          tokens_used: tokensUsed,
          investigation_steps: result.steps_executed,
          response_id: randomUUID(),
          feedback_enabled: true,
        } as any;
      }
    } catch (err) {
      console.error('[Orchestrator] Investigation engine error, falling through:', err instanceof Error ? err.message : err);
    }
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

  // ── Step 3.9: Reasoning thread lifecycle ────────────────────────────────────
  // Every 3 turns when the conversation exceeds 6 messages, run a cheap LLM
  // compression pass (DeepSeek) to extract the analytical inference chain —
  // hypotheses, challenges, conclusions, open questions, contradictions.
  // Persisted in context JSONB and reused across turns without re-running.
  // Passed into buildConversationHistory and runPandoraAgent so the model
  // can continue analytical arguments started earlier in the session.
  // NOTE: activeReasoningThread was initialised from persisted state above
  // (before the calibration block). We update it here with a fresh compression.
  const allMessages = state.messages || [] as any;
  const currentTurnCount: number = allMessages.length;
  const threadComputedAtTurn: number = (state.context as any).reasoningThreadTurn ?? 0;

  if (currentTurnCount > 6 && (currentTurnCount - threadComputedAtTurn >= 3)) {
    try {
      const freshThread = await compressReasoningThread(allMessages, workspaceId);
      if (freshThread) {
        activeReasoningThread = freshThread;
        // Persist to context JSONB using targeted jsonb_set — avoids clobbering
        // other context fields that updateContext() manages separately.
        query(
          `UPDATE conversation_state
           SET context = jsonb_set(
             jsonb_set(context, '{reasoningThread}', $4::jsonb, true),
             '{reasoningThreadTurn}', $5::jsonb, true
           ),
           updated_at = now()
           WHERE workspace_id = $1 AND channel_id = $2 AND thread_ts = $3`,
          [workspaceId, channelId, threadId, JSON.stringify(freshThread), JSON.stringify(currentTurnCount)]
        ).catch(err => console.warn('[ReasoningThread] Failed to persist to context:', err));
      }
    } catch (err) {
      console.warn('[ReasoningThread] Lifecycle failed, continuing without fresh thread:', err instanceof Error ? err.message : String(err));
    }
  }

  // ── Step 4.0: Intent Classification (in_app + slack_dm) ─────────────────────
  // Pre-dispatch routing to catch advisory questions before expensive tool calls.
  // Falls through to Pandora Agent for data_query or ambiguous categories.
  // slack_dm gets the full classification + Pandora Agent path (same as in_app).
  // slack_thread uses the lighter runScopedAnalysis path below.
  //
  // Workspace context is loaded here (cached, ~1ms warm) so the classifier can
  // see what's already in memory and avoid routing context-answerable questions
  // to the tool-calling agent.
  let intentClassification: Awaited<ReturnType<typeof classifyIntent>> | null = null;
  if (!answer && (surface === 'in_app' || surface === 'slack_dm')) {
    try {
      const { messages: conversationHistory } = await buildConversationHistory(state.messages || [] as any, { workspaceId, reasoningThread: activeReasoningThread });
      const ctxForClassifier = await getWorkspaceContext(workspaceId).catch(() => null);
      intentClassification = await classifyIntent(message, conversationHistory, workspaceId, ctxForClassifier);

      console.log('[Intent]', JSON.stringify(intentClassification));

      // FT2: Store classification for later success/failure tracking
      (state.context as any).lastIntentClassification = {
        ...intentClassification,
        userMessage: message,
        turnNumber: (state.messages || []).length
      };
      await updateContext(workspaceId, channelId, threadId, {
        last_scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
      });

      await logIntentClassification(workspaceId, message, intentClassification);

      // FT2: Check for strategic routing miss
      const isFollowUpAnalytical = (state.messages || []).length > 2; 
      if (isFollowUpAnalytical) {
        const lastTurn = state.messages[state.messages.length - 2];
        const lastClass = (state.context as any).prevIntentClassification;
        const missPatterns = ["that's not what i asked", "i meant", "why is this", "incorrect", "wrong"];
        if (lastClass && lastClass.category === 'analytical' && missPatterns.some(p => message.toLowerCase().includes(p))) {
           captureStrategicRoutingMiss(workspaceId, lastClass, INTENT_CLASSIFIER_SYSTEM_PROMPT).catch(console.error);
        }
      }

      // FT2: Check for successful classification (2 turns ago)
      const successTurn = (state.messages || []).length - 4;
      if (successTurn >= 0) {
        const successClass = (state.context as any).intentClassificationAtTurn?.[successTurn];
        const contradictionInWindow = state.messages.slice(successTurn).some(m => m.role === 'user' && /that'?s?\s+(not|wrong|incorrect)/i.test(m.content));
        if (successClass && !contradictionInWindow) {
           captureSuccessfulClassificationPair(workspaceId, successClass, INTENT_CLASSIFIER_SYSTEM_PROMPT).catch(console.error);
           // Clear it so we don't log it again
           delete (state.context as any).intentClassificationAtTurn[successTurn];
        }
      }
      
      // Store classification history in context
      if (!(state.context as any).intentClassificationAtTurn) (state.context as any).intentClassificationAtTurn = {};
      (state.context as any).intentClassificationAtTurn[(state.messages || []).length] = (state.context as any).lastIntentClassification;
      (state.context as any).prevIntentClassification = (state.context as any).lastIntentClassification;

      // Handle advisory_with_data_option: ask gating question
      // Skip when a specific entity is scoped — data retrieval should happen automatically.
      if (
        intentClassification.category === 'advisory_with_data_option' &&
        intentClassification.confidence >= 0.75 &&
        !isGatingResponse(message, conversationHistory) &&
        !entityId
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
      // Never short-circuit when a specific entity (deal/account/rep) is scoped —
      // those queries must go through the agentic loop so real data is fetched.
      if (
        intentClassification.category === 'advisory_stateless' &&
        intentClassification.confidence >= 0.75 &&
        !entityId
      ) {
        const { messages: conversationHistory } = await buildConversationHistory(state.messages || [] as any, { workspaceId, reasoningThread: activeReasoningThread });
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

      // Handle retrospective: 3-phase Evidence Harvest → Hypothesis → Targeted Synthesis
      if (
        intentClassification.category === 'retrospective' &&
        intentClassification.confidence >= 0.70
      ) {
        try {
          routerDecision = 'retrospective';
          const workspaceRow = await query<{ name: string }>(
            'SELECT name FROM workspaces WHERE id = $1',
            [workspaceId]
          );
          const workspaceName = workspaceRow.rows[0]?.name ?? 'Your Workspace';
          const retroResult = await runRetroPipeline(workspaceId, message, workspaceName);

          await appendMessage(workspaceId, channelId, threadId, {
            role: 'assistant',
            content: retroResult.answer,
            timestamp: new Date().toISOString(),
          });

          return {
            answer: retroResult.answer,
            thread_id: threadId,
            scope: { type: scopeType, entity_id: entityId },
            router_decision: `retrospective_${retroResult.route}`,
            data_strategy: `phase_${retroResult.phase_reached}`,
            tokens_used: retroResult.tokens_used,
            feedback_enabled: true,
            response_id: undefined,
          };
        } catch (err) {
          console.error('[orchestrator] Retrospective pipeline failed, falling through:', err);
          // Fall through to pandora_agent on error
        }
      }

      // Handle user responding "best practice" to a gating question
      if (isGatingResponse(message, conversationHistory) && prefersBestPractice(message)) {
        const { messages: conversationHistory } = await buildConversationHistory(state.messages || [] as any, { workspaceId, reasoningThread: activeReasoningThread });
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
          const { messages: history } = await buildConversationHistory(state.messages || [] as any, { workspaceId, reasoningThread: activeReasoningThread });
          const workspaceContext = await getWorkspaceContext(workspaceId);

          let chatResponse: string;
          let toolResults: any[] = [];
          let toolCalls: any[] = [];
          let evidence: any = { tool_calls: [], cited_records: [] };
          let latencyMs = 0;
          let pandoraResult: any = null;

          if (intentClassification.is_followup_doc) {
            // Follow-up doc request: reuse the last assistant message instead of re-mining
            const msgs = state.messages || [];
            const lastAssistant = [...msgs].reverse().find((m: any) => m.role === 'assistant') as any;
            if (lastAssistant) {
              chatResponse = lastAssistant.content || '';
              toolResults = (lastAssistant.tool_trace || []).map((tc: any) => ({
                tool: tc.tool,
                result: tc.result,
                error: tc.error,
              }));
              toolCalls = lastAssistant.tool_trace || [];
              evidence = {
                tool_calls: toolCalls,
                cited_records: lastAssistant.cited_records || [],
              };
              console.log('[orchestrator] Follow-up doc request — reusing last assistant response');
            } else {
              chatResponse = '';
            }
          } else {
            // Fresh document request: mine data first
            let agentMessage = message;
            if (entityId && scopeType && !['workspace', 'pipeline', 'conversations'].includes(scopeType)) {
              agentMessage = `[Context: viewing ${scopeType} id=${entityId}] ${message}`;
            }

            const isComplex = detectComplexRequest(message);
            pandoraResult = await runPandoraAgent(
              workspaceId,
              agentMessage,
              history,
              undefined,
              sessionContext,
              undefined,
              {
                complexity: isComplex ? 'high' : 'standard',
                enablePlanning: isComplex,
                reasoningThread: activeReasoningThread,
              }
            );
            chatResponse = pandoraResult.answer;
            toolResults = pandoraResult.evidence.tool_calls.map((tc: any) => ({
              tool: tc.tool,
              result: tc.result,
              error: tc.error,
            }));
            toolCalls = pandoraResult.evidence.tool_calls;
            evidence = pandoraResult.evidence;
            tokensUsed = pandoraResult.tokens_used;
            latencyMs = pandoraResult.latency_ms;
          }

          const synthOutput = await synthesizeDocuments({
            userMessage: intentClassification.is_followup_doc
              ? `Convert the following analysis into a downloadable document:\n\n${chatResponse}`
              : message,
            miningResult: {
              chatResponse,
              toolResults,
              toolCalls,
            },
            workspaceContext: workspaceContext as WorkspaceContext,
            workspaceId,
          });

          const formattedAnswer = formatDocumentResponse(synthOutput, workspaceId, chatResponse);

          answer = formattedAnswer;
          routerDecision = 'document_request';
          dataStrategy = 'document_synthesis';

          await appendMessage(workspaceId, channelId, threadId, {
            role: 'assistant',
            content: formattedAnswer,
            timestamp: new Date().toISOString(),
            ...(toolCalls.length > 0 ? {
              tool_trace: toolCalls,
              cited_records: evidence.cited_records,
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
            data_strategy: intentClassification.is_followup_doc ? 'followup_doc_synthesis' : 'document_synthesis',
            tokens_used: tokensUsed,
            response_id: randomUUID(),
            feedback_enabled: true,
            evidence,
            tool_call_count: toolCalls.length,
            latency_ms: latencyMs,
            documents: synthOutput,
            ...(pandoraResult?.chart_specs?.length ? { chart_specs: pandoraResult.chart_specs } : {}),
            ...(pandoraResult?.chart ? { chart: pandoraResult.chart } : {}),
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

  // ── Pandora Agent — full path for in_app and slack_dm ───────────────────────
  // Free-text questions from the Command Center and Slack DMs go here.
  // slack_thread uses the lighter runScopedAnalysis path below.
  // runScopedAnalysis is NOT a fallback for in_app or slack_dm.
  if (!answer && (surface === 'in_app' || surface === 'slack_dm')) {
    try {
      const { messages: history } = await buildConversationHistory(state.messages || [] as any, { workspaceId, reasoningThread: activeReasoningThread });

      // Inject entity scope so deal/account page questions have context.
      // e.g. "What are the risks?" on a deal page needs to know which deal.
      let agentMessage = message;
      if (entityId && scopeType && !['workspace', 'pipeline', 'conversations'].includes(scopeType)) {
        agentMessage = `[Context: viewing ${scopeType} id=${entityId}] ${message}`;
      } else if (anchor?.result) {
        // Anchor context: user clicked a skill result and is asking a follow-up
        const { narrative, methodologyComparisons } = extractSkillContext(anchor.result);
        const skillContext = narrative.slice(0, 600);
        const methodologyNote = formatMethodologyComparisons(methodologyComparisons, 'ask_pandora');
        const contextParts = [
          skillContext ? `[Skill run context: ${skillContext}]` : '',
          methodologyNote ? `[Methodology notes:\n${methodologyNote}]` : '',
        ].filter(Boolean).join('\n');
        if (contextParts) {
          agentMessage = `${contextParts}\n\n${message}`;
        }
      }

      // Intent-gated divergent deals context injection (T4)
      // Only inject when question is pipeline-related to save tokens
      const pipelineIntents = ['attainment', 'coverage', 'pipeline_health', 'deal_progression', 'forecast', 'analytical'];
      if (intentClassification && pipelineIntents.includes(intentClassification.category as string)) {
        try {
          const divergentDealsResult = await query(
            `SELECT id, name, stage, inferred_phase, phase_confidence, amount
             FROM deals
             WHERE workspace_id = $1
               AND phase_divergence = true
               AND stage_normalized NOT IN ('closed_won', 'closed_lost')
             ORDER BY phase_confidence DESC, amount DESC
             LIMIT 5`,
            [workspaceId]
          );

          const divergentDeals = divergentDealsResult.rows;

          if (divergentDeals.length > 0) {
            let divergenceContext = `\n\n[Stage Mismatch Alerts: ${divergentDeals.length} deal(s) show activity signals ahead of their CRM stage:\n`;
            for (const deal of divergentDeals) {
              divergenceContext += `- ${deal.name}: Currently in "${deal.stage}" but signals indicate "${deal.inferred_phase}" (${deal.phase_confidence}% confidence, $${Number(deal.amount).toLocaleString()})\n`;
            }
            divergenceContext += 'Recommendation: Mention these opportunities if relevant to the user\'s question about pipeline health or deal progression.]';
            agentMessage = agentMessage + divergenceContext;
          }
        } catch (err) {
          console.error('[Orchestrator] Failed to fetch divergent deals for context:', err);
          // Non-fatal: continue without divergent deals context
        }
      }

      // Deliberation classification — check if this warrants bull/bear analysis
      const classifierStart = Date.now();
      const deliberationClassification = await classifyDeliberationMode(message, {
        scopeType,
        entityId,
      });
      const classifierMs = Date.now() - classifierStart;

      if (classifierMs > 500) {
        console.warn(
          `[deliberation-classifier] slow: ${classifierMs}ms`,
          { workspaceId, scopeType, mode: deliberationClassification.mode }
        );
      }

      let deliberationResult: any = null;
      let deliberationMode: string | null = null;

      if (deliberationClassification.mode === 'bull_bear' &&
          deliberationClassification.confidence >= 0.70 &&
          entityId) {
        try {
          console.log(`[orchestrator] Running bull/bear deliberation for deal ${entityId}`);
          deliberationResult = await runDeliberation(workspaceId, entityId, message);
          deliberationMode = 'bull_bear';
        } catch (err) {
          console.error('[orchestrator] Deliberation failed, continuing to pandora_agent:', err);
          // Non-fatal — continue to pandora_agent
        }
      }

      // Boardroom deliberation
      if (deliberationClassification.mode === 'boardroom' &&
          deliberationClassification.confidence >= 0.70) {
        try {
          console.log(`[orchestrator] Running boardroom deliberation`);
          // Assemble context from recent history
          const recentContext = history.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n');
          const context = recentContext || 'No additional context available.';
          const { runBoardroomDeliberation } = await import('./deliberation-engine.js');
          deliberationResult = await runBoardroomDeliberation(workspaceId, message, context);
          deliberationMode = 'boardroom';
        } catch (err) {
          console.error('[orchestrator] Boardroom deliberation failed:', err);
        }
      }

      // Socratic deliberation
      if (deliberationClassification.mode === 'socratic' &&
          deliberationClassification.confidence >= 0.70) {
        try {
          console.log(`[orchestrator] Running socratic deliberation`);
          const recentContext = history.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n');
          const context = recentContext || 'No additional context available.';
          const { runSocraticDeliberation } = await import('./deliberation-engine.js');
          deliberationResult = await runSocraticDeliberation(workspaceId, message, context);
          deliberationMode = 'socratic';
        } catch (err) {
          console.error('[orchestrator] Socratic deliberation failed:', err);
        }
      }

      // Prosecutor/Defense deliberation
      if (deliberationClassification.mode === 'prosecutor_defense' &&
          deliberationClassification.confidence >= 0.70) {
        try {
          console.log(`[orchestrator] Running prosecutor/defense deliberation`);
          const recentContext = history.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n');
          const context = recentContext || 'No additional context available.';
          const { runProsecutorDefenseDeliberation } = await import('./deliberation-engine.js');
          deliberationResult = await runProsecutorDefenseDeliberation(workspaceId, message, context);
          deliberationMode = 'prosecutor_defense';
        } catch (err) {
          console.error('[orchestrator] Prosecutor/Defense deliberation failed:', err);
        }
      }

      // Note: red_team deliberation is triggered separately via hypothesis challenge
      // and has its own execution path. Do not wire red_team here.

      // Detect complex requests for planning mode
      const isComplex = detectComplexRequest(message);

      const pandoraResult = await runPandoraAgent(
        workspaceId,
        agentMessage,
        history,
        undefined,
        sessionContext,
        undefined,
        {
          complexity: isComplex ? 'high' : 'standard',
          enablePlanning: isComplex,
          reasoningThread: activeReasoningThread,
        }
      );

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

      // Build PandoraResponse envelope
      const builder = new PandoraResponseBuilder();

      // 1. Narrative — the synthesis text
      builder.addNarrative(answer);

      // 2. Charts — map existing ChartSpecs to ChartBlocks
      for (const spec of pandoraResult.chart_specs ?? []) {
        builder.addChart(spec, true); // saveable = true in Ask Pandora
      }

      // 3. Action cards — map suggested_actions or inline_actions
      if (pandoraResult.suggested_actions?.length) {
        for (const action of pandoraResult.suggested_actions) {
          builder.addActionCard({
            severity: action.priority === 'P1' ? 'critical' : action.priority === 'P2' ? 'warning' : 'info',
            title: action.title,
            rationale: action.description,
            target_entity_type: 'deal',
            target_entity_id: action.deal_id,
            target_entity_name: action.deal_name,
            action_id: action.id,
            cta_label: 'Take action',
            cta_href: action.deal_id ? `/deals/${action.deal_id}` : undefined,
          });
        }
      } else if (pandoraResult.inline_actions?.length) {
        for (const action of pandoraResult.inline_actions) {
          builder.addActionCard({
            severity: action.severity,
            title: action.title,
            rationale: action.summary,
            target_entity_type: 'deal',
            target_entity_name: action.deal_name,
            action_id: action.id,
            cta_label: 'Take action',
          });
        }
      }

      // 4. Record tools used
      for (const toolCall of pandoraResult.evidence?.tool_calls ?? []) {
        builder.recordTool(toolCall.tool);
      }

      // 5. Add deliberation block based on mode
      if (deliberationResult && deliberationMode === 'bull_bear') {
        builder.addDeliberation({
          mode: 'bull_bear',
          run_id: deliberationResult.id ?? undefined,
          hypothesis: message,
          panels: [
            {
              role: 'Bull',
              summary: deliberationResult.perspectives?.bull?.output ?? '',
              key_points: [],
              confidence: (deliberationResult.perspectives?.bull?.closeProbability ?? 50) / 100,
              color_hint: 'bull',
            },
            {
              role: 'Bear',
              summary: deliberationResult.perspectives?.bear?.output ?? '',
              key_points: [],
              confidence: (deliberationResult.perspectives?.bear?.closeProbability ?? 50) / 100,
              color_hint: 'bear',
            },
          ],
          synthesis: deliberationResult.verdict?.rawOutput ?? '',
          verdict: deliberationResult.verdict?.recommendedAction ?? undefined,
        });
      }

      if (deliberationResult && deliberationMode === 'boardroom') {
        builder.addDeliberation({
          mode: 'boardroom' as any,
          hypothesis: message,
          panels: deliberationResult.panels.map((p: any) => ({
            role: p.role,
            summary: p.output,
            key_points: [],
            confidence: 0.7,
            color_hint: p.color_hint,
          })),
          synthesis: deliberationResult.synthesis,
        });
      }

      if (deliberationResult && deliberationMode === 'socratic') {
        builder.addDeliberation({
          mode: 'socratic' as any,
          hypothesis: message,
          panels: [
            {
              role: 'Assumption',
              summary: deliberationResult.assumption,
              key_points: [deliberationResult.probing_questions],
              confidence: 0.5,
              color_hint: 'bear',
            },
            {
              role: 'Counter-Hypothesis',
              summary: deliberationResult.counter_hypothesis,
              key_points: [],
              confidence: 0.5,
              color_hint: 'bull',
            },
          ],
          synthesis: deliberationResult.synthesis,
        });
      }

      if (deliberationResult && deliberationMode === 'prosecutor_defense') {
        builder.addDeliberation({
          mode: 'prosecutor_defense' as any,
          hypothesis: message,
          panels: [
            {
              role: 'Prosecutor',
              summary: deliberationResult.prosecution,
              key_points: [],
              confidence: 1 - deliberationResult.confidence,
              color_hint: 'prosecutor',
            },
            {
              role: 'Defense',
              summary: deliberationResult.defense,
              key_points: [],
              confidence: deliberationResult.confidence,
              color_hint: 'defense',
            },
          ],
          synthesis: deliberationResult.verdict,
        });
      }

      const pandoraResponse = builder.build('ask_pandora', workspaceId, tokensUsed);

      return {
        answer,
        thread_id: threadId,
        scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
        router_decision: routerDecision,
        data_strategy: dataStrategy,
        tokens_used: tokensUsed,
        response_id: randomUUID(),
        feedback_enabled: true,
        follow_up_questions: pandoraResult.follow_up_questions || [],
        ...(pandoraResult.evidence.tool_calls.length > 0 ? {
          evidence: pandoraResult.evidence,
          tool_call_count: pandoraResult.tool_call_count,
          latency_ms: pandoraResult.latency_ms,
        } : {}),
        ...(pandoraResult.inline_actions ? { inline_actions: pandoraResult.inline_actions } : {}),
        ...(pandoraResult.chart_specs?.length ? { chart_specs: pandoraResult.chart_specs } : {}),
        ...(pandoraResult.chart ? { chart: pandoraResult.chart } : {}),
        pandora_response: pandoraResponse,
      } as any;
    } catch (err) {
      console.error('[orchestrator] Pandora Agent failed:', err);
      answer = "I wasn't able to analyze that right now. Please try again in a moment.";
      routerDecision = 'error_fallback';
      dataStrategy = 'none';
      tokensUsed = 0;
    }
  }

  // ── Slack path — runScopedAnalysis for slack_thread only ────────────────────
  // in_app and slack_dm questions never reach here; Pandora Agent handles them.
  // slack_thread uses the lighter scoped-analysis path (no full tool loop).
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

  // Extract workspace knowledge from user message (non-blocking, fire and forget)
  extractWorkspaceKnowledge(message, workspaceId).catch(() => {});

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
    evidence: metricEvidence,
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
  const today = new Date().toISOString().split('T')[0];
  const base = `You are Pandora, an AI RevOps advisor for B2B SaaS companies.
You have deep expertise in pipeline management, forecasting, ICP development,
sales process design, and RevOps tooling.

Today's date is ${today}. Any deal close date before today is past-due. Do not describe past-due close dates as future targets.

Answer the user's question with specific, practical guidance.
Avoid generic advice — be opinionated and direct.
When recommending frameworks or structures, explain the reasoning behind each choice.

## Response Format Rules

USE A TABLE when:
- Showing 3 or more items that share the same attributes (name, amount, stage, owner, date)
- Comparing reps, deals, or stages side by side
- Presenting pipeline breakdowns with multiple dimensions
- Any ranked list with 3+ columns of data

USE BULLET POINTS when:
- Items don't share a common set of attributes
- The list has fewer than 3 items
- Each item requires a sentence of explanation

MARKDOWN TABLE FORMAT:
| Deal | Amount | Stage | Owner | Close Date |
|---|---|---|---|---|
| Action Behavior Centers | $300K | Demo | Nate | May 29 |

Always include a header row.
Sort by the most relevant column (usually amount DESC for deals).
Cap tables at 10 rows — add "... and N more" if there are additional results.`;

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

  // Build workspace configuration section
  const targetLines = workspaceContext.active_targets.length > 0
    ? workspaceContext.active_targets.map(t =>
        `  ${t.period_label}: ${(t.target_amount/1000).toFixed(0)}K (${t.target_type}${t.pipeline ? ` · ${t.pipeline}` : ''})`
      ).join('\n')
    : '  No targets configured';

  const currentQTarget = workspaceContext.current_quarter_target
    ? `${(workspaceContext.current_quarter_target/1000).toFixed(0)}K`
    : 'not set';

  const repLines = workspaceContext.sales_reps.length > 0
    ? workspaceContext.sales_reps.map(r =>
        `  ${r.name} (${r.role})`
      ).join('\n')
    : '  No sales roster configured';

  const dimLines = workspaceContext.confirmed_dimensions.length > 0
    ? workspaceContext.confirmed_dimensions.map(d =>
        `  ${d.label} (${d.dimension_key})${d.description ? `: ${d.description}` : ''}`
      ).join('\n')
    : '  No confirmed dimensions';

  const workspaceConfigBlock = `

WORKSPACE CONFIGURATION:

Current quarter target: ${currentQTarget}

Quota targets:
${targetLines}

Sales team:
${repLines}

Confirmed business definitions:
${dimLines}

IMPORTANT: The WORKSPACE CONFIGURATION block above contains authoritative data about this workspace's quota targets, sales team, and business definitions. Answer questions about team members, quota targets, coverage targets, and confirmed definitions directly from this block WITHOUT making tool calls. Only use tools when the question requires live deal data, activity data, or computed metrics not present in the configuration block.

Questions answerable from configuration alone (no tools needed):
- Who are our reps / sales team?
- What's our quota target?
- What's our coverage target?
- What are our confirmed pipeline definitions?
- How many reps do we have?
`;

  const termLines = workspaceContext.data_dictionary_terms.length > 0
    ? workspaceContext.data_dictionary_terms.map(t => {
        const def = t.technical_definition || t.definition || '';
        return `  ${t.term}${def ? `: ${def}` : ''}${t.source ? ` [source: ${t.source}]` : ''}`;
      }).join('\n')
    : '';

  const terminologyBlock = termLines
    ? `\n\nWORKSPACE TERMINOLOGY:\n${termLines}\n\nWhen asked to define or explain any of the terms above, use the workspace definition exactly as written. These override generic industry definitions.`
    : '';

  const knowledgeLines = workspaceContext.workspace_knowledge.length > 0
    ? workspaceContext.workspace_knowledge.map(k => {
        const conf = k.confidence >= 0.9 ? 'high'
                   : k.confidence >= 0.7 ? 'medium'
                   : 'low';
        return `  [${conf}] ${k.value}`;
      }).join('\n')
    : '  No workspace-specific knowledge stored yet';

  const knowledgeBlock = `

BUSINESS KNOWLEDGE (learned from conversations):
${knowledgeLines}

When using any item above with confidence "high", cite it: "Based on what you've told me about [topic]..."
`;

  const methodologyRule = `

METHODOLOGY COMPARISON RULE:
When a user's question involves coverage targets, pipeline requirements, or forecast accuracy, Pandora may surface a methodology divergence note. If you receive a [Methodology notes:] block in context, use these rules:
- severity "info" (gap < 15%): suppress — do not mention it
- severity "notable" (gap 15–30%): append as a footnote after your main answer
  Format: ⟳ [1-sentence explanation of what the gap reveals]
- severity "alert" (gap > 30%): lead your answer with a one-line callout before the main answer
  Format: ⚠️ [1-sentence callout] — then continue with main answer
Never pick a methodology as definitively correct. Explain the mechanism. The footnote should help the user understand *why* the methods disagree, not which to blindly trust.`;

  const internalActionDetection = `

INTERNAL ACTION DETECTION:

After completing an analysis that derives or refines a business definition, you may suggest
saving the result. Use these exact trigger conditions:

OFFER update_data_dictionary when:
- The conversation started with "what is our definition of X" or "how do we define X"
- The user asked to refine, modify, or improve it
- You ran tool calls to derive the new definition
- The derived definition differs from what was stored
Format the suggestion as:
"I've derived a more precise [term] definition from your [data source]. Want me to update the Data Dictionary?"

OFFER confirm_metric_definition when:
- The user explicitly agreed with Pandora's computed metric value (responded to an A/B/C comparison with A or B)
- The chosen value should be locked as the confirmed benchmark
Format the suggestion as:
"Confirmed — I'll lock [metric] at [value] as the official benchmark. Approve to save."

DO NOT offer these actions for:
- Simple lookups with no refinement
- Conversations where no existing definition was referenced
- Cases where you're uncertain about the result

OFFER run_skill when ALL of:
- Your analysis has identified that a specific Pandora skill has never run for this workspace
  (you detected missing or uniformly-defaulted scores, empty grade columns, or absent skill output)
- The missing skill run directly explains the data quality problem being discussed
- You know the exact skill_id to recommend

IMPORTANT — one card per skill:
Surface one separate run_skill card per skill. Do NOT batch multiple skills into one card.

Format the suggestion as:
"[Skill name] hasn't run yet — that's why [explanation]. Want me to trigger it now?"

Payload format (include in your response JSON):
{
  "type": "run_skill",
  "title": "Run [Skill Name]",
  "action_payload": {
    "skill_id": "deal-rfm-scoring",
    "reason": "Deal grading fields are empty — this skill writes risk scores to your deals"
  }
}

Known skill_ids and when to recommend them:
- deal-rfm-scoring: when deal risk scores or grades are null/missing/all showing the same default value
- icp-discovery: when ICP fit scores are missing or all accounts/deals show the same tier
- deal-scoring-model: when deal scores haven't been computed or appear uniform
- pipeline-waterfall: when waterfall analysis is unavailable or outdated
- pipeline-hygiene: when data quality issues are identified in deal fields
`;

  return `${base}${contextSection}${caveatSection}${workspaceConfigBlock}${terminologyBlock}${knowledgeBlock}${methodologyRule}${internalActionDetection}

Tailor your recommendations to this company's specific profile.
For example, objection handling for a $150K ACV enterprise product looks very different
from objection handling for a $10K SMB product.

## Pandora Product Knowledge
${PANDORA_PRODUCT_KNOWLEDGE}

${PANDORA_SUPPORT_CONTEXT}`;
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
