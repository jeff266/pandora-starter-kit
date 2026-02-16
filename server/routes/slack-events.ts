import { Router } from 'express';
import { verifySlackSignature } from '../connectors/slack/signature.js';
import { query } from '../db.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { classifyThreadReply, classifyDirectQuestion } from '../chat/intent-classifier.js';
import {
  handleDrillDown,
  handleAddContext,
  handleQuestion,
  handleScopeFilter,
  handleAction,
} from '../chat/reply-handlers.js';
import {
  handleDirectQuestion,
  handleFollowUp,
} from '../chat/question-handlers.js';
import {
  getConversationState,
  createConversationState,
  appendMessage,
  checkRateLimit,
} from '../chat/conversation-state.js';

const router = Router();

router.post('/', async (req, res) => {
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
  const result = await query<any>(
    `SELECT cc.workspace_id FROM connector_configs cc
     WHERE cc.source_type = 'slack_app'
     AND cc.credentials->>'team_id' = $1
     LIMIT 1`,
    [teamId]
  );
  if (result.rows.length > 0) return result.rows[0].workspace_id;

  const slackChannelResult = await query<any>(
    `SELECT workspace_id FROM slack_channel_config LIMIT 1`
  );
  if (slackChannelResult.rows.length > 0) return slackChannelResult.rows[0].workspace_id;

  const wsResult = await query<any>(`SELECT id FROM workspaces LIMIT 1`);
  return wsResult.rows.length > 0 ? wsResult.rows[0].id : null;
}

async function handleThreadedReply(event: any, teamId: string): Promise<void> {
  const skillRun = await query<any>(
    `SELECT sr.run_id, sr.skill_id, sr.workspace_id, sr.result
     FROM skill_runs sr
     WHERE sr.slack_message_ts = $1
     AND sr.slack_channel_id = $2`,
    [event.thread_ts, event.channel]
  );

  if (skillRun.rows.length === 0) {
    const existingState = await findConversationByThread(event.channel, event.thread_ts);
    if (existingState) {
      const allowed = await checkRateLimit(existingState.workspace_id);
      if (!allowed) {
        await sendRateLimitMessage(existingState.workspace_id, event);
        return;
      }
      await handleFollowUp(existingState.workspace_id, {
        channel: event.channel,
        thread_ts: event.thread_ts,
        ts: event.ts,
        user: event.user,
        text: event.text || '',
      });
      return;
    }

    console.log(`[slack-events] Threaded reply in ${event.channel} — not a Pandora thread, ignoring`);
    return;
  }

  const run = skillRun.rows[0];
  console.log(`[slack-events] Threaded reply on skill run ${run.run_id} (${run.skill_id})`);

  const allowed = await checkRateLimit(run.workspace_id);
  if (!allowed) {
    await sendRateLimitMessage(run.workspace_id, event);
    return;
  }

  let state = await getConversationState(run.workspace_id, event.channel, event.thread_ts);
  if (!state) {
    state = await createConversationState(
      run.workspace_id, event.channel, event.thread_ts, 'slack', run.run_id
    );
  }

  await appendMessage(run.workspace_id, event.channel, event.thread_ts, {
    role: 'user',
    content: event.text || '',
    timestamp: new Date().toISOString(),
  });

  const intent = await classifyThreadReply(run.workspace_id, event.text || '', run.skill_id);
  console.log(`[slack-events] Intent: ${intent.type}`, JSON.stringify(intent));

  const slackEvent = {
    channel: event.channel,
    thread_ts: event.thread_ts,
    ts: event.ts,
    user: event.user,
    text: event.text || '',
  };

  const runRef = {
    id: run.run_id,
    run_id: run.run_id,
    skill_id: run.skill_id,
    workspace_id: run.workspace_id,
    result: run.result,
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
      await sendHelpMessage(run.workspace_id, event);
  }
}

async function handleAppMention(event: any, teamId: string): Promise<void> {
  const workspaceId = await resolveWorkspaceFromTeam(teamId);
  if (!workspaceId) {
    console.warn('[slack-events] Could not resolve workspace for team:', teamId);
    return;
  }

  const allowed = await checkRateLimit(workspaceId);
  if (!allowed) {
    await sendRateLimitMessage(workspaceId, event);
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
      await handleFollowUp(workspaceId, {
        channel: event.channel,
        thread_ts: event.thread_ts,
        ts: event.ts,
        user: event.user,
        text: question,
      });
      return;
    }
  }

  const repResult = await query<any>(
    `SELECT DISTINCT owner_email FROM deals
     WHERE workspace_id = $1 AND status = 'open' AND owner_email IS NOT NULL
     LIMIT 20`,
    [workspaceId]
  );
  const repNames = repResult.rows.map((r: any) => r.owner_email);

  const skillIds = [
    'pipeline-hygiene', 'deal-risk-review', 'pipeline-coverage',
    'weekly-recap', 'single-thread-alert', 'data-quality-audit',
    'forecast-rollup', 'rep-scorecard', 'pipeline-waterfall',
    'bowtie-analysis', 'pipeline-goals',
  ];

  const route = await classifyDirectQuestion(workspaceId, question, skillIds, repNames);
  console.log(`[slack-events] Direct question route: ${route.type}`, JSON.stringify(route));

  await handleDirectQuestion(workspaceId, question, route, {
    channel: event.channel,
    thread_ts: event.thread_ts,
    ts: event.ts,
    user: event.user,
    text: question,
  });
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
