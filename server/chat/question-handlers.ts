import { query } from '../db.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { runScopedAnalysis } from '../analysis/scoped-analysis.js';
import { callLLM } from '../utils/llm-router.js';
import {
  getConversationState,
  createConversationState,
  appendMessage,
  updateContext,
  getMessageCount,
  isFollowUpLimitReached,
  type ConversationState,
} from './conversation-state.js';
import type { DirectQuestionRoute } from './intent-classifier.js';

interface SlackEvent {
  channel: string;
  thread_ts?: string;
  ts: string;
  user: string;
  text: string;
}

export async function handleDirectQuestion(
  workspaceId: string,
  question: string,
  route: DirectQuestionRoute,
  event: SlackEvent
): Promise<void> {
  const client = getSlackAppClient();
  const threadTs = event.thread_ts || event.ts;

  const thinking = await client.postMessage(workspaceId, event.channel, [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Thinking..._` }],
  }], { thread_ts: threadTs });

  try {
    let state = await getConversationState(workspaceId, event.channel, threadTs);
    if (!state) {
      state = await createConversationState(workspaceId, event.channel, threadTs, 'slack');
    }

    await appendMessage(workspaceId, event.channel, threadTs, {
      role: 'user',
      content: question,
      timestamp: new Date().toISOString(),
    });

    let answer: string;

    switch (route.type) {
      case 'data_query':
        answer = await handleDataQuery(workspaceId, question, route, state);
        break;
      case 'skill_trigger':
        answer = await handleSkillTrigger(workspaceId, route);
        break;
      case 'comparison':
        answer = await handleComparison(workspaceId, question, route, state);
        break;
      case 'explanation':
        answer = await handleExplanation(workspaceId, question, route, state);
        break;
      case 'action_request':
        answer = `To take actions, please use the action buttons on skill reports, or visit the Command Center.`;
        break;
      default:
        answer = await handleGenericQuestion(workspaceId, question, state);
    }

    await updateThinkingBlocks(client, workspaceId, event.channel, thinking.ts, [{
      type: 'section',
      text: { type: 'mrkdwn', text: answer },
    }]);

    await appendMessage(workspaceId, event.channel, threadTs, {
      role: 'assistant',
      content: answer,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[question-handlers] Error:', err);
    await updateThinkingBlocks(client, workspaceId, event.channel, thinking.ts, [{
      type: 'section',
      text: { type: 'mrkdwn', text: `Sorry, I ran into an error processing your question. Please try again.` },
    }]);
  }
}

export async function handleFollowUp(
  workspaceId: string,
  event: SlackEvent
): Promise<void> {
  const client = getSlackAppClient();
  const threadTs = event.thread_ts || event.ts;

  const msgCount = await getMessageCount(workspaceId, event.channel, threadTs);
  if (isFollowUpLimitReached(msgCount)) {
    await client.postMessage(workspaceId, event.channel, [{
      type: 'section',
      text: { type: 'mrkdwn', text: `This conversation has reached its limit. Start a new thread or ask me directly with @Pandora.` },
    }], { thread_ts: threadTs });
    return;
  }

  const thinking = await client.postMessage(workspaceId, event.channel, [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Thinking..._` }],
  }], { thread_ts: threadTs });

  try {
    const state = await getConversationState(workspaceId, event.channel, threadTs);
    if (!state) {
      await updateThinkingBlocks(client, workspaceId, event.channel, thinking.ts, [{
        type: 'section',
        text: { type: 'mrkdwn', text: `I've lost context on this conversation. Could you rephrase your question?` },
      }]);
      return;
    }

    await appendMessage(workspaceId, event.channel, threadTs, {
      role: 'user',
      content: event.text,
      timestamp: new Date().toISOString(),
    });

    const recentMessages = (state.messages || []).slice(-6);
    const conversationHistory = recentMessages.map(m =>
      `${m.role === 'user' ? 'User' : 'Pandora'}: ${m.content}`
    ).join('\n\n');

    const entitiesStr = state.context.entities_discussed?.length
      ? `Previously discussed entities: ${state.context.entities_discussed.join(', ')}`
      : '';

    const scopeType = state.context.last_scope?.type || 'workspace';
    const analysis = await runScopedAnalysis({
      workspace_id: workspaceId,
      question: event.text,
      scope: {
        type: scopeType as any,
        entity_id: state.context.last_scope?.entity_id,
        rep_email: state.context.last_scope?.rep_email,
        skill_run_context: `Previous conversation:\n${conversationHistory}\n\n${entitiesStr}`,
      },
      format: 'text',
      max_tokens: 1500,
    });

    await updateThinkingBlocks(client, workspaceId, event.channel, thinking.ts, [{
      type: 'section',
      text: { type: 'mrkdwn', text: analysis.answer },
    }]);

    await appendMessage(workspaceId, event.channel, threadTs, {
      role: 'assistant',
      content: analysis.answer,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[question-handlers] Follow-up error:', err);
    await updateThinkingBlocks(client, workspaceId, event.channel, thinking.ts, [{
      type: 'section',
      text: { type: 'mrkdwn', text: `Sorry, I couldn't process that follow-up. Please try again.` },
    }]);
  }
}

async function handleDataQuery(
  workspaceId: string,
  question: string,
  route: DirectQuestionRoute,
  state: ConversationState
): Promise<string> {
  let scopeType: 'pipeline' | 'rep' | 'workspace' = 'workspace';
  let repEmail: string | undefined;
  const filters = route.filters || {};

  if (filters.rep) {
    scopeType = 'rep';
    const repResult = await query<any>(
      `SELECT DISTINCT owner FROM deals
       WHERE workspace_id = $1 AND LOWER(owner) LIKE $2
       LIMIT 1`,
      [workspaceId, `%${filters.rep.toLowerCase()}%`]
    );
    if (repResult.rows.length > 0) {
      repEmail = repResult.rows[0].owner;
    }
  } else if (route.entities?.includes('pipeline') || route.metrics?.includes('pipeline')) {
    scopeType = 'pipeline';
  }

  const analysis = await runScopedAnalysis({
    workspace_id: workspaceId,
    question,
    scope: {
      type: scopeType,
      rep_email: repEmail,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    },
    format: 'text',
    max_tokens: 1500,
  });

  if (route.entities) {
    await updateContext(workspaceId, state.channel_id, state.thread_ts, {
      entities_discussed: route.entities,
    });
  }

  return analysis.answer;
}

async function handleSkillTrigger(
  workspaceId: string,
  route: DirectQuestionRoute
): Promise<string> {
  if (!route.skill_id) {
    return `I couldn't determine which skill to run. Available skills include pipeline-hygiene, deal-risk-review, pipeline-coverage, and more. Which one would you like?`;
  }

  try {
    const result = await query<any>(
      `SELECT run_id, status, result, completed_at
       FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1`,
      [workspaceId, route.skill_id]
    );

    if (result.rows.length > 0) {
      const run = result.rows[0];
      const completedAt = run.completed_at
        ? new Date(run.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'recently';
      const summary = run.result?.narrative || run.result?.summary || 'No summary available.';
      return `*Last ${route.skill_id} run* (${completedAt}):\n\n${typeof summary === 'string' ? summary.slice(0, 1500) : JSON.stringify(summary).slice(0, 1500)}`;
    }

    return `The ${route.skill_id} skill hasn't been run yet. You can trigger it from the Skills page in the Command Center.`;
  } catch (err) {
    console.error('[question-handlers] skill_trigger error:', err);
    return `I couldn't retrieve results for ${route.skill_id}. Please try again.`;
  }
}

async function handleComparison(
  workspaceId: string,
  question: string,
  route: DirectQuestionRoute,
  state: ConversationState
): Promise<string> {
  const analysis = await runScopedAnalysis({
    workspace_id: workspaceId,
    question: `Compare ${route.compare_a || ''} vs ${route.compare_b || ''} on ${route.metric || 'key metrics'}. ${question}`,
    scope: { type: 'workspace' },
    format: 'text',
    max_tokens: 2000,
  });

  return analysis.answer;
}

async function handleExplanation(
  workspaceId: string,
  question: string,
  route: DirectQuestionRoute,
  state: ConversationState
): Promise<string> {
  let scopeType: any = 'workspace';
  let entityId: string | undefined;

  if (route.entity_name) {
    const dealResult = await query<any>(
      `SELECT id FROM deals WHERE workspace_id = $1 AND LOWER(name) LIKE $2 LIMIT 1`,
      [workspaceId, `%${route.entity_name.toLowerCase()}%`]
    );
    if (dealResult.rows.length > 0) {
      scopeType = 'deal';
      entityId = dealResult.rows[0].id;
    }
  }

  const analysis = await runScopedAnalysis({
    workspace_id: workspaceId,
    question,
    scope: { type: scopeType, entity_id: entityId },
    format: 'text',
    max_tokens: 2000,
  });

  return analysis.answer;
}

async function handleGenericQuestion(
  workspaceId: string,
  question: string,
  state: ConversationState
): Promise<string> {
  const analysis = await runScopedAnalysis({
    workspace_id: workspaceId,
    question,
    scope: {
      type: state.context.last_scope?.type as any || 'workspace',
      entity_id: state.context.last_scope?.entity_id,
      rep_email: state.context.last_scope?.rep_email,
    },
    format: 'text',
    max_tokens: 1500,
  });

  return analysis.answer;
}

async function updateThinkingBlocks(
  client: ReturnType<typeof getSlackAppClient>,
  workspaceId: string,
  channel: string,
  ts: string,
  blocks: any[]
): Promise<void> {
  if (ts) {
    await client.updateMessage(workspaceId, { channel, ts, blocks });
  }
}
