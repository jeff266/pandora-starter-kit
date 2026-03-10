import { query } from '../db.js';
import { handleConversationTurn } from '../chat/orchestrator.js';
import {
  getConversationState,
  createConversationState,
} from '../chat/conversation-state.js';
import { getLatestBrief } from '../briefing/brief-assembler.js';
import { renderToBlockKit, extractPlainText } from './block-kit-renderer.js';
import { renderBriefToBlockKit } from './brief-renderer.js';
import type { SlackSlashCommandPayload, SlackBlock } from './types.js';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

interface SlashSession {
  threadId: string;
  expiresAt: number;
}

const slashSessions = new Map<string, SlashSession>();

function getSlashThreadId(workspaceId: string, slackUserId: string): string {
  const key = `${workspaceId}:${slackUserId}`;
  const existing = slashSessions.get(key);

  if (existing && Date.now() < existing.expiresAt) {
    return existing.threadId;
  }

  const threadId = `slash:${slackUserId}:${Date.now()}`;
  slashSessions.set(key, { threadId, expiresAt: Date.now() + SESSION_TTL_MS });
  return threadId;
}

async function postToResponseUrl(responseUrl: string, body: Record<string, any>): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[slash-command] postToResponseUrl error:', err);
  }
}

async function resolveWorkspaceFromTeam(teamId: string): Promise<string | null> {
  const result = await query<any>(
    `SELECT workspace_id FROM slack_channel_config WHERE workspace_id IS NOT NULL LIMIT 1`
  );
  if (result.rows.length > 0) return result.rows[0].workspace_id;

  const fallback = await query<any>(`SELECT id FROM workspaces LIMIT 1`);
  return fallback.rows.length > 0 ? fallback.rows[0].id : null;
}

/**
 * Resolve Slack user ID to workspace user ID and role (T10)
 */
async function resolveSlackUser(workspaceId: string, slackUserId: string): Promise<{ userId?: string; userRole?: string }> {
  try {
    const result = await query(
      `SELECT u.id as user_id, wr.system_type
       FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id
       JOIN workspace_roles wr ON wr.id = wm.role_id
       WHERE wm.workspace_id = $1
         AND u.slack_user_id = $2
         AND wm.status = 'active'
       LIMIT 1`,
      [workspaceId, slackUserId]
    );

    if (result.rows.length === 0) {
      return {};
    }

    return {
      userId: result.rows[0].user_id,
      userRole: result.rows[0].system_type || 'rep',
    };
  } catch (err) {
    console.error('[slash-command] Failed to resolve Slack user:', err);
    return {};
  }
}

export async function handleSlashCommand(payload: SlackSlashCommandPayload): Promise<void> {
  const { text, user_id, team_id, channel_id, response_url } = payload;

  const workspaceId = await resolveWorkspaceFromTeam(team_id);
  if (!workspaceId) {
    await postToResponseUrl(response_url, {
      response_type: 'ephemeral',
      text: '⚠️ This Slack workspace is not connected to Pandora. Contact your admin.',
    });
    return;
  }

  const trimmed = (text || '').trim();

  if (trimmed === 'brief') {
    await handleBriefCommand(workspaceId, response_url);
  } else if (trimmed === 'status') {
    await handleStatusCommand(workspaceId, response_url);
  } else if (trimmed === 'help' || trimmed === '') {
    await handleHelpCommand(response_url);
  } else if (trimmed.startsWith('run ')) {
    const skillName = trimmed.slice(4).trim();
    await handleRunCommand(workspaceId, skillName, response_url);
  } else {
    await handleAskCommand(workspaceId, user_id, channel_id, trimmed, response_url);
  }
}

async function handleAskCommand(
  workspaceId: string,
  slackUserId: string,
  channelId: string,
  question: string,
  responseUrl: string
): Promise<void> {
  const threadId = getSlashThreadId(workspaceId, slackUserId);

  let state = await getConversationState(workspaceId, `slash:${slackUserId}`, threadId);
  if (!state) {
    state = await createConversationState(workspaceId, `slash:${slackUserId}`, threadId, 'slack');
  }

  // Resolve Slack user to workspace user for RBAC (T10)
  const { userId, userRole } = await resolveSlackUser(workspaceId, slackUserId);

  try {
    const result = await handleConversationTurn({
      surface: 'slack_dm',
      workspaceId,
      channelId: `slash:${slackUserId}`,
      threadId,
      message: question,
      userId,
      userRole: userRole as any,
    });

    const blocks = renderToBlockKit(result, {
      includeShareButton: true,
      includeDeepLink: true,
    });

    await postToResponseUrl(responseUrl, {
      response_type: 'ephemeral',
      blocks,
      text: extractPlainText(result),
      replace_original: true,
    });
  } catch (err) {
    console.error('[slash-command] handleAskCommand error:', err);
    await postToResponseUrl(responseUrl, {
      response_type: 'ephemeral',
      text: '⚠️ Something went wrong. Please try again.',
      replace_original: true,
    });
  }
}

async function handleBriefCommand(workspaceId: string, responseUrl: string): Promise<void> {
  const brief = await getLatestBrief(workspaceId);

  if (!brief) {
    await postToResponseUrl(responseUrl, {
      response_type: 'ephemeral',
      text: 'No brief available yet. Briefs are generated daily — check back later.',
      replace_original: true,
    });
    return;
  }

  const blocks = renderBriefToBlockKit(brief, { compact: true });

  await postToResponseUrl(responseUrl, {
    response_type: 'ephemeral',
    blocks,
    text: 'VP RevOps Brief',
    replace_original: true,
  });
}

async function handleStatusCommand(workspaceId: string, responseUrl: string): Promise<void> {
  const [briefRow, skillRow] = await Promise.all([
    query<any>(
      `SELECT generated_at, brief_type, status FROM weekly_briefs WHERE workspace_id=$1 ORDER BY generated_at DESC LIMIT 1`,
      [workspaceId]
    ),
    query<any>(
      `SELECT skill_id, completed_at FROM skill_runs WHERE workspace_id=$1 AND status='completed' ORDER BY completed_at DESC LIMIT 1`,
      [workspaceId]
    ),
  ]);

  const brief = briefRow.rows[0];
  const skill = skillRow.rows[0];

  const lines: string[] = ['*Pandora Status*'];
  if (brief) {
    const ts = new Date(brief.generated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    lines.push(`• Last brief: ${brief.brief_type} · ${ts} · ${brief.status}`);
  } else {
    lines.push('• No brief generated yet');
  }
  if (skill) {
    const ts = new Date(skill.completed_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    lines.push(`• Last skill run: ${skill.skill_id} · ${ts}`);
  }

  await postToResponseUrl(responseUrl, {
    response_type: 'ephemeral',
    text: lines.join('\n'),
    replace_original: true,
  });
}

async function handleHelpCommand(responseUrl: string): Promise<void> {
  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Pandora slash commands*\n\n• `/pandora [question]` — Ask Pandora anything about your pipeline, forecast, or reps\n• `/pandora brief` — Show the current VP RevOps brief\n• `/pandora run [skill]` — Run a specific skill (e.g. `pipeline-hygiene`)\n• `/pandora status` — Workspace sync status and last brief time\n• `/pandora help` — Show this message',
      },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'You can also DM me directly, or reply to any brief I post in the channel.' }],
    },
  ];

  await postToResponseUrl(responseUrl, {
    response_type: 'ephemeral',
    blocks,
    replace_original: true,
  });
}

async function handleRunCommand(
  workspaceId: string,
  skillName: string,
  responseUrl: string
): Promise<void> {
  await postToResponseUrl(responseUrl, {
    response_type: 'ephemeral',
    text: `Running \`${skillName}\`... Results will appear in your channel when complete.`,
    replace_original: true,
  });

  try {
    const { getSkillRegistry } = await import('../skills/registry.js');
    const registry = getSkillRegistry();
    const skill = registry.get(skillName);

    if (!skill) {
      await postToResponseUrl(responseUrl, {
        response_type: 'ephemeral',
        text: `⚠️ Skill \`${skillName}\` not found. Use \`/pandora help\` to see available commands.`,
      });
      return;
    }

    console.log(`[slash-command] Skill run triggered via Slack: ${skillName} for workspace ${workspaceId}`);
  } catch (err) {
    console.error('[slash-command] handleRunCommand error:', err);
  }
}
