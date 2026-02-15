import { Router } from 'express';
import { verifySlackSignature } from '../connectors/slack/signature.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { query } from '../db.js';

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
  const { workspace_id, deal_id, deal_name, run_id } = value;
  if (!workspace_id || !deal_id) return;

  const client = getSlackAppClient();

  const thinking = await client.postMessage(workspace_id, payload.channel.id, [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Pulling details on ${deal_name || 'this deal'}..._` }],
  }], { thread_ts: payload.message.ts });

  try {
    const dealResult = await query(
      `SELECT d.id, d.deal_name, d.amount, d.stage, d.close_date, d.owner,
              d.health_score, d.deal_risk, d.velocity_score,
              a.name as account_name
       FROM deals d
       LEFT JOIN accounts a ON d.account_id = a.id AND a.workspace_id = $1
       WHERE d.id = $2 AND d.workspace_id = $1`,
      [workspace_id, deal_id]
    );

    if (dealResult.rows.length === 0) {
      if (thinking.ts) {
        await client.updateMessage(workspace_id, {
          channel: payload.channel.id,
          ts: thinking.ts,
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `Could not find deal "${deal_name || deal_id}".` },
          }],
        });
      }
      return;
    }

    const deal = dealResult.rows[0];

    const contactsResult = await query(
      `SELECT c.first_name, c.last_name, c.email, c.title, dc.role, dc.is_primary
       FROM deal_contacts dc
       JOIN contacts c ON dc.contact_id = c.id AND c.workspace_id = $1
       WHERE dc.deal_id = $2 AND dc.workspace_id = $1
       ORDER BY dc.is_primary DESC, c.last_name ASC
       LIMIT 10`,
      [workspace_id, deal_id]
    );

    const activitiesResult = await query(
      `SELECT type, subject, activity_date
       FROM activities
       WHERE workspace_id = $1 AND deal_id = $2
       ORDER BY activity_date DESC
       LIMIT 5`,
      [workspace_id, deal_id]
    );

    const blocks = buildDealDossierBlocks(deal, contactsResult.rows, activitiesResult.rows);

    if (thinking.ts) {
      await client.updateMessage(workspace_id, {
        channel: payload.channel.id,
        ts: thinking.ts,
        blocks,
      });
    }

    console.log(`[slack-interactions] Drilled into deal ${deal_id} (${deal.deal_name})`);
  } catch (err) {
    console.error('[slack-interactions] Drill deal error:', err);
    if (thinking.ts) {
      await client.updateMessage(workspace_id, {
        channel: payload.channel.id,
        ts: thinking.ts,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `Error retrieving deal details. Please try again.` },
        }],
      });
    }
  }
}

function buildDealDossierBlocks(deal: any, contacts: any[], activities: any[]): any[] {
  const blocks: any[] = [];

  const amount = deal.amount
    ? `$${(deal.amount / 1000).toFixed(deal.amount >= 1000000 ? 1 : 0)}${deal.amount >= 1000000 ? 'M' : 'K'}`
    : 'N/A';

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${deal.deal_name}`, emoji: true },
  });

  const fields: any[] = [
    { type: 'mrkdwn', text: `*Amount:* ${amount}` },
    { type: 'mrkdwn', text: `*Stage:* ${deal.stage || 'Unknown'}` },
  ];

  if (deal.close_date) {
    const closeDate = new Date(deal.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    fields.push({ type: 'mrkdwn', text: `*Close Date:* ${closeDate}` });
  }

  if (deal.account_name) {
    fields.push({ type: 'mrkdwn', text: `*Account:* ${deal.account_name}` });
  }

  blocks.push({ type: 'section', fields });

  const scoreFields: string[] = [];
  if (deal.health_score != null) scoreFields.push(`Health: ${deal.health_score}`);
  if (deal.deal_risk != null) scoreFields.push(`Risk: ${Math.round(deal.deal_risk * 100)}%`);
  if (deal.velocity_score != null) scoreFields.push(`Velocity: ${deal.velocity_score}`);
  if (scoreFields.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: scoreFields.join(' | ') }],
    });
  }

  if (contacts.length > 0) {
    blocks.push({ type: 'divider' });
    const contactLines = contacts.map(c => {
      const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
      const role = c.role ? ` (${c.role})` : '';
      const title = c.title ? ` — ${c.title}` : '';
      const primary = c.is_primary ? ' ★' : '';
      return `• ${name}${role}${title}${primary}`;
    }).join('\n');

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Contacts (${contacts.length}):*\n${contactLines}` },
    });
  }

  if (activities.length > 0) {
    blocks.push({ type: 'divider' });
    const activityLines = activities.map(a => {
      const date = a.activity_date
        ? new Date(a.activity_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

export default router;
