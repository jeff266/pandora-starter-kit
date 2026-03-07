import { query } from '../db.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { handleConversationTurn } from '../chat/orchestrator.js';
import {
  getConversationState,
  createConversationState,
} from '../chat/conversation-state.js';
import { renderToBlockKit, extractPlainText } from './block-kit-renderer.js';
import type { SlackMessageEvent } from './types.js';

const DM_THREAD_ID = 'dm';
const DM_TTL_MS = 72 * 60 * 60 * 1000;

async function resolveWorkspaceFromTeam(teamId?: string): Promise<string | null> {
  const result = await query<any>(
    `SELECT workspace_id FROM slack_channel_config WHERE workspace_id IS NOT NULL LIMIT 1`
  );
  if (result.rows.length > 0) return result.rows[0].workspace_id;

  const fallback = await query<any>(`SELECT id FROM workspaces LIMIT 1`);
  return fallback.rows.length > 0 ? fallback.rows[0].id : null;
}

async function isFirstDM(workspaceId: string, channelId: string): Promise<boolean> {
  const result = await query<any>(
    `SELECT 1 FROM conversation_state WHERE workspace_id=$1 AND channel_id=$2 LIMIT 1`,
    [workspaceId, channelId]
  );
  return result.rows.length === 0;
}

async function postOnboarding(workspaceId: string, channelId: string): Promise<void> {
  const client = getSlackAppClient();
  const onboardingBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          "Hi! I'm Pandora — your RevOps analyst.",
          '',
          'Ask me anything about your pipeline, forecast, reps, or deals. Try:',
          '• _"How\'s our pipeline coverage?"_',
          '• _"What\'s Sara\'s biggest risk this week?"_',
          '• _"Show me deals closing this month"_',
          '• _"Why are we missing mid-market?"_',
          '',
          'Or type `/pandora` in any channel to ask without leaving your conversation.',
        ].join('\n'),
      },
    },
  ];

  await client.postMessage(workspaceId, channelId, onboardingBlocks as any);
}

export async function handleDMMessage(event: SlackMessageEvent & { team_id?: string }): Promise<void> {
  if (event.bot_id || !event.text?.trim()) return;

  const workspaceId = await resolveWorkspaceFromTeam(event.team_id);
  if (!workspaceId) {
    console.warn('[dm-handler] Could not resolve workspace from team_id:', event.team_id);
    return;
  }

  const channelId = event.channel;
  const client = getSlackAppClient();

  const firstTime = await isFirstDM(workspaceId, channelId);
  if (firstTime) {
    await postOnboarding(workspaceId, channelId);
  }

  let state = await getConversationState(workspaceId, channelId, DM_THREAD_ID);
  if (!state) {
    state = await createConversationState(workspaceId, channelId, DM_THREAD_ID, 'slack');
  }

  const thinkingRef = await client.postMessage(workspaceId, channelId, [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_✦ thinking..._' }],
    },
  ] as any);

  try {
    const result = await handleConversationTurn({
      surface: 'slack_dm',
      workspaceId,
      channelId,
      threadId: DM_THREAD_ID,
      message: event.text,
    });

    if (thinkingRef.ts) {
      await client.deleteMessage(workspaceId, { channel: channelId, ts: thinkingRef.ts });
    }

    const blocks = renderToBlockKit(result, {
      includeShareButton: true,
      includeDeepLink: true,
    });

    await client.postMessage(workspaceId, channelId, blocks as any, {
      unfurl_links: false,
    });

    await maybeOfferDocumentRender(workspaceId, channelId, state);
  } catch (err) {
    console.error('[dm-handler] handleConversationTurn error:', err);

    if (thinkingRef.ts) {
      await client.updateMessage(workspaceId, {
        channel: channelId,
        ts: thinkingRef.ts,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '⚠️ Something went wrong. Please try again.' },
          },
        ],
      });
    }
  }
}

async function maybeOfferDocumentRender(
  workspaceId: string,
  channelId: string,
  state: any
): Promise<void> {
  const messageCount = (state.messages || []).filter((m: any) => m.role === 'assistant').length;
  if (messageCount < 5) return;

  const client = getSlackAppClient();
  const appUrl = process.env.APP_URL || 'https://pandora.replit.app';

  const accumBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📄 *We've covered a lot.* You can render this conversation as a document in Pandora.`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Open in Pandora →' },
        url: `${appUrl}/command-center`,
        action_id: 'open_pandora_from_dm',
      },
    },
  ];

  await client.postMessage(workspaceId, channelId, accumBlocks as any);
}
