import { Router } from 'express';
import { verifySlackSignature } from '../connectors/slack/signature.js';
import { query } from '../db.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { classifyThreadReply } from '../chat/intent-classifier.js';
import {
  handleDrillDown,
  handleAddContext,
  handleQuestion,
  handleScopeFilter,
  handleAction,
} from '../chat/reply-handlers.js';
import { handleConversationTurn } from '../chat/orchestrator.js';
import {
  getConversationState,
  createConversationState,
  appendMessage,
  checkRateLimit,
} from '../chat/conversation-state.js';

const router = Router();

router.post('/', async (req, res) => {
  console.log('[slack-events] Incoming event:', req.body?.type, req.body?.event?.type || 'no-event');
  const signingSecretConfigured = !!process.env.SLACK_SIGNING_SECRET;

  if (req.body.type === 'url_verification') {
    if (signingSecretConfigured && !verifySlackSignature(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    return res.json({ challenge: req.body.challenge });
  }

  if (!verifySlackSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.status(200).json({});

  const event = req.body.event;
  if (!event) return;
  const teamId = req.body.team_id;

  try {
    if (event.type === 'message' && !event.bot_id && event.subtype !== 'bot_message') {
      if (event.thread_ts) {
        await handleThreadedReply(event, teamId);
      }
    } else if (event.type === 'app_mention' && !event.bot_id) {
      await handleAppMention(event, teamId);
    }
  } catch (err) {
    console.error('[slack-events] Error processing event:', err);
  }
});

async function resolveWorkspaceFromTeam(teamId: string): Promise<string | null> {
  const slackChannelResult = await query<any>(
    `SELECT workspace_id FROM slack_channel_config LIMIT 1`
  );
  if (slackChannelResult.rows.length > 0) return slackChannelResult.rows[0].workspace_id;

  const wsResult = await query<any>(`SELECT id FROM workspaces LIMIT 1`);
  return wsResult.rows.length > 0 ? wsResult.rows[0].id : null;
}

interface ThreadAnchorRow {
  workspace_id: string;
  skill_run_id: string | null;
  agent_run_id: string | null;
  report_type: string | null;
}

async function lookupThreadAnchor(channelId: string, messageTs: string): Promise<ThreadAnchorRow | null> {
  const result = await query<ThreadAnchorRow>(
    `SELECT workspace_id, skill_run_id, agent_run_id, report_type
     FROM thread_anchors
     WHERE channel_id = $1 AND message_ts = $2
     LIMIT 1`,
    [channelId, messageTs]
  );
  if (result.rows.length > 0) return result.rows[0];

  const fallback = await query<any>(
    `SELECT sr.run_id as skill_run_id, sr.skill_id as report_type, sr.workspace_id
     FROM skill_runs sr
     WHERE sr.slack_message_ts = $1 AND sr.slack_channel_id = $2
     LIMIT 1`,
    [messageTs, channelId]
  );
  if (fallback.rows.length > 0) {
    return {
      workspace_id: fallback.rows[0].workspace_id,
      skill_run_id: fallback.rows[0].skill_run_id,
      agent_run_id: null,
      report_type: fallback.rows[0].report_type,
    };
  }

  return null;
}

async function handleThreadedReply(event: any, teamId: string): Promise<void> {
  const anchor = await lookupThreadAnchor(event.channel, event.thread_ts);

  if (!anchor) {
    const existingState = await findConversationByThread(event.channel, event.thread_ts);
    if (existingState) {
      const result = await handleConversationTurn({
        surface: 'slack_thread',
        workspaceId: existingState.workspace_id,
        threadId: event.thread_ts,
        channelId: event.channel,
        message: event.text || '',
      });
      const client = getSlackAppClient();
      await client.postMessage(existingState.workspace_id, event.channel, [{
        type: 'section',
        text: { type: 'mrkdwn', text: result.answer },
      }], { thread_ts: event.thread_ts });
      return;
    }

    console.log(`[slack-events] Threaded reply in ${event.channel} — not a Pandora thread, ignoring`);
    return;
  }

  const workspaceId = anchor.workspace_id;
  console.log(`[slack-events] Threaded reply on ${anchor.report_type || 'unknown'} (skill: ${anchor.skill_run_id || 'N/A'}, agent: ${anchor.agent_run_id || 'N/A'})`);

  let skillRunResult: any = null;
  if (anchor.skill_run_id) {
    const runResult = await query<any>(
      `SELECT run_id, skill_id, result FROM skill_runs WHERE run_id = $1`,
      [anchor.skill_run_id]
    );
    if (runResult.rows.length > 0) {
      skillRunResult = runResult.rows[0];
    }
  }

  if (skillRunResult) {
    const allowed = await checkRateLimit(workspaceId, 20);
    if (!allowed) {
      await sendRateLimitMessage(workspaceId, event);
      return;
    }

    let state = await getConversationState(workspaceId, event.channel, event.thread_ts);
    if (!state) {
      state = await createConversationState(
        workspaceId, event.channel, event.thread_ts, 'slack',
        anchor.skill_run_id || undefined
      );
    }

    await appendMessage(workspaceId, event.channel, event.thread_ts, {
      role: 'user',
      content: event.text || '',
      timestamp: new Date().toISOString(),
    });

    const intent = await classifyThreadReply(workspaceId, event.text || '', skillRunResult.skill_id);
    console.log(`[slack-events] Intent: ${intent.type}`, JSON.stringify(intent));

    const slackEvent = {
      channel: event.channel,
      thread_ts: event.thread_ts,
      ts: event.ts,
      user: event.user,
      text: event.text || '',
    };

    const runRef = {
      id: skillRunResult.run_id,
      run_id: skillRunResult.run_id,
      skill_id: skillRunResult.skill_id,
      workspace_id: workspaceId,
      result: skillRunResult.result,
    };

    switch (intent.type) {
      case 'drill_down':
        await handleDrillDown(runRef, intent, slackEvent);
        break;
      case 'scope_filter':
        await handleScopeFilter(runRef, intent, slackEvent);
        break;
      case 'add_context':
        await handleAddContext(runRef, intent, slackEvent);
        break;
      case 'question':
        await handleQuestion(runRef, slackEvent);
        break;
      case 'action':
        await handleAction(runRef, intent, slackEvent);
        break;
      default:
        await sendHelpMessage(workspaceId, event);
    }
  } else {
    const result = await handleConversationTurn({
      surface: 'slack_thread',
      workspaceId,
      threadId: event.thread_ts,
      channelId: event.channel,
      message: event.text || '',
      anchor: anchor.agent_run_id ? {
        agent_run_id: anchor.agent_run_id,
        report_type: anchor.report_type || undefined,
      } : undefined,
    });

    const client = getSlackAppClient();
    await client.postMessage(workspaceId, event.channel, [{
      type: 'section',
      text: { type: 'mrkdwn', text: result.answer },
    }], { thread_ts: event.thread_ts });
  }
}

async function handleAppMention(event: any, teamId: string): Promise<void> {
  const workspaceId = await resolveWorkspaceFromTeam(teamId);
  if (!workspaceId) {
    console.warn('[slack-events] Could not resolve workspace for team:', teamId);
    return;
  }

  const question = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  if (!question) {
    const client = getSlackAppClient();
    await client.postMessage(workspaceId, event.channel, [{
      type: 'section',
      text: { type: 'mrkdwn', text: `Hi! I can help with your pipeline, deals, reps, and forecast. Try asking:\n• _"What's our pipeline looking like?"_\n• _"Which deals are at risk?"_\n• _"How is Sara tracking against quota?"_` },
    }], { thread_ts: event.ts });
    return;
  }

  if (event.thread_ts) {
    const existingState = await getConversationState(workspaceId, event.channel, event.thread_ts);
    if (existingState) {
      const result = await handleConversationTurn({
        surface: 'slack_thread',
        workspaceId,
        threadId: event.thread_ts,
        channelId: event.channel,
        message: question,
      });
      const client = getSlackAppClient();
      await client.postMessage(workspaceId, event.channel, [{
        type: 'section',
        text: { type: 'mrkdwn', text: result.answer },
      }], { thread_ts: event.thread_ts });
      return;
    }
  }

  const threadTs = event.thread_ts || event.ts;
  const client = getSlackAppClient();

  const thinking = await client.postMessage(workspaceId, event.channel, [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Thinking..._` }],
  }], { thread_ts: threadTs });

  const result = await handleConversationTurn({
    surface: 'slack_dm',
    workspaceId,
    threadId: threadTs,
    channelId: event.channel,
    message: question,
  });

  if (thinking.ts) {
    await client.updateMessage(workspaceId, {
      channel: event.channel,
      ts: thinking.ts,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: result.answer },
      }],
    });
  }
}

async function findConversationByThread(
  channelId: string,
  threadTs: string
): Promise<{ workspace_id: string } | null> {
  const result = await query<any>(
    `SELECT workspace_id FROM conversation_state
     WHERE channel_id = $1 AND thread_ts = $2 AND expires_at > now()
     LIMIT 1`,
    [channelId, threadTs]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

async function sendRateLimitMessage(workspaceId: string, event: any): Promise<void> {
  const client = getSlackAppClient();
  await client.postEphemeral(workspaceId, {
    channel: event.channel,
    user: event.user,
    text: `You've reached the conversation limit for this hour. Please try again shortly.`,
    thread_ts: event.thread_ts,
  });
}

async function sendHelpMessage(workspaceId: string, event: any): Promise<void> {
  const client = getSlackAppClient();
  await client.postMessage(workspaceId, event.channel, [{
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `I'm not sure what you'd like me to do. Try:\n• _"Tell me more about [deal name]"_\n• _"Run this for [rep name] only"_\n• _"[Deal name] is waiting on legal"_\n• _"Why is this deal flagged?"_`,
    },
  }], { thread_ts: event.thread_ts });
}

export default router;
