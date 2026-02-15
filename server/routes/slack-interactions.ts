import { Router } from 'express';
import { verifySlackSignature } from '../connectors/slack/signature.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { query } from '../db.js';
import pool from '../db.js';
import { assembleDealDossier, type DealDossier } from '../dossiers/deal-dossier.js';
import { executeAction } from '../actions/executor.js';
import { formatCurrency } from '../utils/format-currency.js';

const router = Router();

router.post('/', async (req, res) => {
  let payload: any;
  try {
    payload = typeof req.body.payload === 'string'
      ? JSON.parse(req.body.payload)
      : req.body.payload;
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  if (!payload) {
    return res.status(400).json({ error: 'Missing payload' });
  }

  if (!verifySlackSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.status(200).json({});

  try {
    if (payload.type === 'view_submission') {
      await handleViewSubmission(payload);
      return;
    }

    const action = payload.actions?.[0];
    if (!action) return;

    const value = safeParseJSON(action.value);
    if (!value) {
      console.warn('[slack-interactions] Could not parse action value:', action.value);
      return;
    }

    switch (action.action_id) {
      case 'mark_reviewed':
        await handleMarkReviewed(value, payload);
        break;
      case 'snooze_findings':
        await handleSnooze(value, payload);
        break;
      case 'drill_deal':
        await handleDrillDeal(value, payload);
        break;
      case 'pandora_execute_action':
        await handleExecuteAction(value, payload);
        break;
      case 'pandora_dismiss_action':
        await handleDismissAction(value, payload);
        break;
      case 'pandora_view_action':
        break;
      default:
        console.warn(`[slack-interactions] Unknown action: ${action.action_id}`);
    }
  } catch (err) {
    console.error('[slack-interactions] Error processing action:', err);
  }
});

function safeParseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

async function handleMarkReviewed(value: any, payload: any): Promise<void> {
  const { workspace_id, run_id } = value;
  if (!workspace_id || !run_id) return;

  await query(
    `UPDATE skill_runs
     SET result = jsonb_set(
       COALESCE(result, '{}'),
       '{reviewed}',
       to_jsonb($3::text)
     )
     WHERE run_id = $1 AND workspace_id = $2`,
    [run_id, workspace_id, new Date().toISOString()]
  );

  const client = getSlackAppClient();

  const existingBlocks: any[] = payload.message?.blocks || [];
  const nonActionBlocks = existingBlocks.filter((b: any) => b.type !== 'actions');

  nonActionBlocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `✓ Reviewed by <@${payload.user.id}> at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
    }],
  });

  await client.updateMessage(workspace_id, {
    channel: payload.channel.id,
    ts: payload.message.ts,
    blocks: nonActionBlocks,
  });

  console.log(`[slack-interactions] Run ${run_id} marked reviewed by ${payload.user.id}`);
}

async function handleSnooze(value: any, payload: any): Promise<void> {
  const { workspace_id, skill_id, run_id, days } = value;
  if (!workspace_id || !skill_id) return;

  const snoozeDays = days || 7;
  const snoozeUntil = new Date();
  snoozeUntil.setDate(snoozeUntil.getDate() + snoozeDays);

  await query(
    `INSERT INTO snooze_config (workspace_id, skill_id, run_id, snoozed_by, snooze_until)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, skill_id)
     DO UPDATE SET snooze_until = $5, snoozed_by = $4, run_id = $3, updated_at = now()`,
    [workspace_id, skill_id, run_id, payload.user.id, snoozeUntil.toISOString()]
  );

  const client = getSlackAppClient();
  await client.postEphemeral(workspace_id, {
    channel: payload.channel.id,
    user: payload.user.id,
    text: `Snoozed for ${snoozeDays} days. This skill will resume alerting on ${snoozeUntil.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`,
  });

  console.log(`[slack-interactions] Snoozed ${skill_id} for ${snoozeDays}d in workspace ${workspace_id}`);
}

async function handleDrillDeal(value: any, payload: any): Promise<void> {
  const { workspace_id, deal_id, deal_name } = value;
  if (!workspace_id || !deal_id) return;

  const client = getSlackAppClient();

  const thinking = await client.postMessage(workspace_id, payload.channel.id, [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Pulling details on ${deal_name || 'this deal'}..._` }],
  }], { thread_ts: payload.message.ts });

  try {
    const dossier = await assembleDealDossier(workspace_id, deal_id);
    const blocks = formatDossierForSlack(dossier);

    if (thinking.ts) {
      await client.updateMessage(workspace_id, {
        channel: payload.channel.id,
        ts: thinking.ts,
        blocks,
      });
    }

    console.log(`[slack-interactions] Drilled into deal ${deal_id} (${dossier.deal.name})`);
  } catch (err) {
    console.error('[slack-interactions] Drill deal error:', err);
    const errMsg = err instanceof Error && err.message.includes('not found')
      ? `Could not find deal "${deal_name || deal_id}".`
      : `Error retrieving deal details. Please try again.`;
    if (thinking.ts) {
      await client.updateMessage(workspace_id, {
        channel: payload.channel.id,
        ts: thinking.ts,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: errMsg },
        }],
      });
    }
  }
}

function formatDossierForSlack(dossier: DealDossier): any[] {
  const blocks: any[] = [];
  const { deal, contacts, activities, findings, health_signals } = dossier;

  const amount = deal.amount ? formatCurrency(deal.amount) : 'N/A';

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: deal.name, emoji: true },
  });

  const fields: any[] = [
    { type: 'mrkdwn', text: `*Amount:* ${amount}` },
    { type: 'mrkdwn', text: `*Stage:* ${deal.stage || 'Unknown'}` },
  ];

  if (deal.close_date) {
    const closeDate = new Date(deal.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    fields.push({ type: 'mrkdwn', text: `*Close Date:* ${closeDate}` });
  }

  if (deal.owner_email) {
    fields.push({ type: 'mrkdwn', text: `*Owner:* ${deal.owner_email}` });
  }

  if (deal.days_in_stage > 0) {
    fields.push({ type: 'mrkdwn', text: `*Days in Stage:* ${deal.days_in_stage}` });
  }

  if (deal.pipeline_name) {
    fields.push({ type: 'mrkdwn', text: `*Pipeline:* ${deal.pipeline_name}` });
  }

  blocks.push({ type: 'section', fields });

  const signalParts: string[] = [];
  const recencyIcon = health_signals.activity_recency === 'active' ? '🟢' : health_signals.activity_recency === 'cooling' ? '🟡' : '🔴';
  signalParts.push(`${recencyIcon} Activity: ${health_signals.activity_recency}`);
  const threadIcon = health_signals.threading === 'multi' ? '🟢' : health_signals.threading === 'dual' ? '🟡' : '🔴';
  signalParts.push(`${threadIcon} Threading: ${health_signals.threading}`);
  const velocityIcon = health_signals.stage_velocity === 'fast' ? '🟢' : health_signals.stage_velocity === 'normal' ? '🟡' : '🔴';
  signalParts.push(`${velocityIcon} Velocity: ${health_signals.stage_velocity}`);
  signalParts.push(`📊 Data: ${health_signals.data_completeness}%`);

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: signalParts.join('  |  ') }],
  });

  if (findings.length > 0) {
    blocks.push({ type: 'divider' });
    const severityEmoji: Record<string, string> = { act: '🔴', watch: '🟡', notable: '🔵', info: 'ℹ️' };
    const findingLines = findings.slice(0, 5).map(f => {
      const emoji = severityEmoji[f.severity] || '•';
      return `${emoji} [${f.severity}] ${f.message}`;
    }).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Findings (${findings.length}):*\n${findingLines}` },
    });
  }

  if (contacts.length > 0) {
    blocks.push({ type: 'divider' });
    const contactLines = contacts.slice(0, 10).map(c => {
      const role = c.role ? ` (${c.role})` : '';
      const title = c.title ? ` — ${c.title}` : '';
      const primary = c.is_primary ? ' ★' : '';
      return `• ${c.name}${role}${title}${primary}`;
    }).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Contacts (${contacts.length}):*\n${contactLines}` },
    });
  }

  if (activities.length > 0) {
    blocks.push({ type: 'divider' });
    const activityLines = activities.slice(0, 5).map(a => {
      const date = a.date
        ? new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '?';
      return `• ${date} — ${a.type || 'Activity'}${a.subject ? `: ${a.subject}` : ''}`;
    }).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Recent Activity:*\n${activityLines}` },
    });
  }

  return blocks;
}

async function handleExecuteAction(value: any, payload: any): Promise<void> {
  const { action_id, workspace_id } = value;
  if (!action_id || !workspace_id) return;

  const client = getSlackAppClient();

  const actionResult = await query<any>(
    `SELECT * FROM actions WHERE id = $1 AND workspace_id = $2`,
    [action_id, workspace_id]
  );
  if (actionResult.rows.length === 0) {
    await client.postEphemeral(workspace_id, {
      channel: payload.channel.id,
      user: payload.user.id,
      text: 'Action not found or already processed.',
    });
    return;
  }

  const action = actionResult.rows[0];
  const isNotification = ['notify_rep', 'notify_manager'].includes(action.action_type);

  if (isNotification) {
    try {
      const result = await executeAction(pool, {
        actionId: action_id,
        workspaceId: workspace_id,
        actor: payload.user.username || payload.user.id,
      });

      if (result.success) {
        await replaceActionButtons(client, workspace_id, payload, action_id,
          `📨 *Notification sent* by <@${payload.user.id}>`);
      } else {
        await client.postEphemeral(workspace_id, {
          channel: payload.channel.id,
          user: payload.user.id,
          text: `❌ Execution failed: ${result.error || 'Unknown error'}`,
        });
      }
    } catch (err) {
      console.error('[slack-interactions] Execute notification error:', err);
      await client.postEphemeral(workspace_id, {
        channel: payload.channel.id,
        user: payload.user.id,
        text: `❌ Error: ${(err as Error).message}`,
      });
    }
    return;
  }

  const operations = action.execution_payload?.operations || action.recommended_steps || [];
  const opBlocks = Array.isArray(operations)
    ? operations.slice(0, 10).map((op: any) => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: op.field
            ? `*${op.field}:* ${op.current_value || '(empty)'} → *${op.proposed_value}*`
            : typeof op === 'string' ? `• ${op}` : `• ${JSON.stringify(op)}`,
        },
      }))
    : [];

  const modalView = {
    type: 'modal',
    callback_id: 'pandora_execute_confirm',
    private_metadata: JSON.stringify({
      action_id,
      workspace_id,
      channel: payload.channel.id,
      message_ts: payload.message?.ts,
    }),
    title: { type: 'plain_text', text: 'Confirm CRM Changes' },
    submit: { type: 'plain_text', text: 'Confirm & Execute' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${action.title}*\n${action.summary || ''}` },
      },
      { type: 'divider' },
      ...opBlocks,
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `⚠️ This will update the record in ${action.metadata?.crm_source || 'your CRM'}. An audit note will be added.`,
        }],
      },
    ],
  };

  await client.openModal(workspace_id, payload.trigger_id, modalView);
}

async function handleDismissAction(value: any, payload: any): Promise<void> {
  const { action_id, workspace_id } = value;
  if (!action_id || !workspace_id) return;

  const client = getSlackAppClient();

  try {
    await query(
      `UPDATE actions SET execution_status = 'dismissed', dismissed_reason = 'Dismissed via Slack', executed_by = $3, updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND execution_status IN ('open', 'in_progress')`,
      [action_id, workspace_id, payload.user.username || payload.user.id]
    );

    await query(
      `INSERT INTO action_audit_log (workspace_id, action_id, event_type, actor, from_status, to_status, details)
       VALUES ($1, $2, 'dismissed', $3, 'open', 'dismissed', $4)`,
      [workspace_id, action_id, payload.user.username || payload.user.id,
       JSON.stringify({ source: 'slack', user_id: payload.user.id })]
    );

    await replaceActionButtons(client, workspace_id, payload, action_id,
      `⏭ *Dismissed* by <@${payload.user.id}>`);

    console.log(`[slack-interactions] Action ${action_id} dismissed by ${payload.user.id}`);
  } catch (err) {
    console.error('[slack-interactions] Dismiss error:', err);
    await client.postEphemeral(workspace_id, {
      channel: payload.channel.id,
      user: payload.user.id,
      text: `❌ Error dismissing action: ${(err as Error).message}`,
    });
  }
}

async function handleViewSubmission(payload: any): Promise<void> {
  if (payload.view?.callback_id !== 'pandora_execute_confirm') return;

  const meta = safeParseJSON(payload.view.private_metadata);
  if (!meta) return;

  const { action_id, workspace_id, channel, message_ts } = meta;
  const client = getSlackAppClient();

  try {
    const result = await executeAction(pool, {
      actionId: action_id,
      workspaceId: workspace_id,
      actor: payload.user.username || payload.user.id,
    });

    if (result.success) {
      if (channel && message_ts) {
        await client.postMessage(workspace_id, channel, [{
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `✅ *Executed* by <@${payload.user.id}> • ${result.operations.length} operation(s) completed`,
          }],
        }], { thread_ts: message_ts });
      }
      console.log(`[slack-interactions] Action ${action_id} executed by ${payload.user.id}`);
    } else {
      await client.postEphemeral(workspace_id, {
        channel: channel || '',
        user: payload.user.id,
        text: `❌ Execution failed: ${result.error || 'Unknown error'}`,
      });
    }
  } catch (err) {
    console.error('[slack-interactions] Modal submission error:', err);
    if (meta.channel) {
      await client.postEphemeral(workspace_id, {
        channel: meta.channel,
        user: payload.user.id,
        text: `❌ Error executing action: ${(err as Error).message}`,
      });
    }
  }
}

async function replaceActionButtons(
  client: ReturnType<typeof getSlackAppClient>,
  workspaceId: string,
  payload: any,
  actionId: string,
  statusText: string
): Promise<void> {
  const existingBlocks: any[] = payload.message?.blocks || [];
  const targetBlockId = `action_buttons_${actionId.slice(0, 8)}`;

  const updatedBlocks = existingBlocks.map((block: any) => {
    if (block.block_id === targetBlockId) {
      return {
        type: 'context',
        block_id: `action_status_${actionId.slice(0, 8)}`,
        elements: [{
          type: 'mrkdwn',
          text: `${statusText} • <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|just now>`,
        }],
      };
    }
    return block;
  });

  await client.updateMessage(workspaceId, {
    channel: payload.channel.id,
    ts: payload.message.ts,
    blocks: updatedBlocks,
  });
}

export default router;
