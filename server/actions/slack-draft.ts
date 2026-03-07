import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';

export interface SlackDraft {
  id: string;
  workspace_id: string;
  source_action_id?: string;
  source_skill_id?: string;
  recipient_slack_id?: string;
  recipient_name?: string;
  draft_message: string;
  edited_message?: string;
  context?: any;
  status: 'pending' | 'approved' | 'sent' | 'dismissed';
  approved_by?: string;
  approved_at?: Date;
  sent_at?: Date;
  dismissed_at?: Date;
  dismiss_reason?: string;
  created_at: Date;
}

/**
 * Generate a Slack draft message using Claude
 */
export async function generateSlackDraft(
  workspaceId: string,
  recipientName: string,
  recommendation: string,
  dealContext?: any
): Promise<string> {
  const systemPrompt = `You are a high-performing sales representative. 
Write a short Slack message (2-4 sentences) to ${recipientName} based on this recommendation: "${recommendation}".
Context: ${JSON.stringify(dealContext || {})}

Rules:
- Tone: Direct, collegial, professional but informal (rep-to-rep or rep-to-manager).
- DO NOT mention Pandora, AI, or that this was automatically generated.
- Use "we" and "I".
- Be specific but concise.
- Output ONLY the message text. No subject lines, no "Hi ${recipientName}," (unless it feels natural in a Slack DM), no sign-offs.`;

  const response = await callLLM(workspaceId, 'generate', {
    systemPrompt,
    messages: [{ role: 'user', content: `Generate a Slack DM for ${recipientName}` }],
    temperature: 0.7,
  });

  return response.content.trim().replace(/^"|"$/g, '');
}

/**
 * Create a new Slack draft in the database
 */
export async function createSlackDraft(
  workspaceId: string,
  draft: Partial<SlackDraft>
): Promise<SlackDraft> {
  const result = await query<SlackDraft>(
    `INSERT INTO slack_drafts (
      workspace_id, source_action_id, source_skill_id, recipient_slack_id, 
      recipient_name, draft_message, context, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      workspaceId,
      draft.source_action_id,
      draft.source_skill_id,
      draft.recipient_slack_id,
      draft.recipient_name,
      draft.draft_message,
      draft.context ? JSON.stringify(draft.context) : null,
      'pending'
    ]
  );

  return result.rows[0];
}

/**
 * Send a Slack draft
 */
export async function sendSlackDraft(
  workspaceId: string,
  draftId: string,
  editedMessage?: string
): Promise<void> {
  const draftResult = await query<SlackDraft>(
    `SELECT * FROM slack_drafts WHERE id = $1 AND workspace_id = $2`,
    [draftId, workspaceId]
  );

  if (draftResult.rows.length === 0) {
    throw new Error('Draft not found');
  }

  const draft = draftResult.rows[0];
  const messageToSend = editedMessage || draft.draft_message;

  if (!draft.recipient_slack_id) {
    throw new Error('No recipient Slack ID found for this draft');
  }

  const slackClient = getSlackAppClient();
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: messageToSend,
      },
    },
  ];

  const result = await slackClient.sendDirectMessage(
    workspaceId,
    draft.recipient_slack_id,
    blocks,
    messageToSend.slice(0, 100)
  );

  if (!result.ok) {
    await query(
      `UPDATE slack_drafts SET status = 'failed', context = jsonb_set(COALESCE(context, '{}'), '{error}', to_jsonb($2::text)) WHERE id = $1`,
      [draftId, result.error]
    );
    throw new Error(`Slack API error: ${result.error}`);
  }

  await query(
    `UPDATE slack_drafts SET 
      status = 'sent', 
      sent_at = NOW(), 
      edited_message = $2,
      approved_at = NOW()
    WHERE id = $1`,
    [draftId, editedMessage || null]
  );
}

/**
 * Dismiss a Slack draft
 */
export async function dismissSlackDraft(
  workspaceId: string,
  draftId: string,
  reason?: string
): Promise<void> {
  await query(
    `UPDATE slack_drafts SET 
      status = 'dismissed', 
      dismissed_at = NOW(), 
      dismiss_reason = $3
    WHERE id = $1 AND workspace_id = $2`,
    [draftId, workspaceId, reason || null]
  );
}
