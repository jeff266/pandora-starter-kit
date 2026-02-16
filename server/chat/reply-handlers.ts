import { query } from '../db.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { assembleDealDossier } from '../dossiers/deal-dossier.js';
import { assembleAccountDossier } from '../dossiers/account-dossier.js';
import { runScopedAnalysis, type AnalysisRequest } from '../analysis/scoped-analysis.js';
import { formatCurrency } from '../utils/format-currency.js';
import { appendMessage, updateContext, type ConversationMessage } from './conversation-state.js';
import type { ThreadReplyIntent } from './intent-classifier.js';

interface SlackEvent {
  channel: string;
  thread_ts: string;
  ts: string;
  user: string;
  text: string;
}

interface SkillRunRef {
  id: string;
  run_id: string;
  skill_id: string;
  workspace_id: string;
  result: any;
}

export async function handleDrillDown(
  run: SkillRunRef,
  intent: ThreadReplyIntent,
  event: SlackEvent
): Promise<void> {
  const client = getSlackAppClient();

  const thinking = await client.postMessage(run.workspace_id, event.channel, [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Looking up ${intent.entity_name || 'that'}..._` }],
  }], { thread_ts: event.thread_ts });

  try {
    if (intent.entity_type === 'deal' || !intent.entity_type) {
      const deal = await findEntityByName(run.workspace_id, 'deals', intent.entity_name || '');
      if (!deal) {
        await updateThinking(client, run.workspace_id, event, thinking.ts,
          `I couldn't find a deal matching "${intent.entity_name}". Try using the full deal name.`);
        return;
      }

      const dossier = await assembleDealDossier(run.workspace_id, deal.id);
      const blocks = formatDealDossierForThread(dossier);
      await updateThinking(client, run.workspace_id, event, thinking.ts, blocks);

      await updateContext(run.workspace_id, event.channel, event.thread_ts, {
        entities_discussed: [deal.id],
        last_scope: { type: 'deal', entity_id: deal.id },
      });
    } else if (intent.entity_type === 'account') {
      const account = await findEntityByName(run.workspace_id, 'accounts', intent.entity_name || '');
      if (!account) {
        await updateThinking(client, run.workspace_id, event, thinking.ts,
          `I couldn't find an account matching "${intent.entity_name}".`);
        return;
      }

      const dossier = await assembleAccountDossier(run.workspace_id, account.id);
      const blocks = formatAccountDossierForThread(dossier);
      await updateThinking(client, run.workspace_id, event, thinking.ts, blocks);

      await updateContext(run.workspace_id, event.channel, event.thread_ts, {
        entities_discussed: [account.id],
        last_scope: { type: 'account', entity_id: account.id },
      });
    } else if (intent.entity_type === 'rep') {
      const repResult = await query<any>(
        `SELECT DISTINCT owner FROM deals
         WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND LOWER(owner) LIKE $2
         LIMIT 1`,
        [run.workspace_id, `%${(intent.entity_name || '').toLowerCase()}%`]
      );

      if (repResult.rows.length === 0) {
        await updateThinking(client, run.workspace_id, event, thinking.ts,
          `I couldn't find a rep matching "${intent.entity_name}".`);
        return;
      }

      const repEmail = repResult.rows[0].owner;
      const analysis = await runScopedAnalysis({
        workspace_id: run.workspace_id,
        question: `Give a concise overview of this rep's pipeline, performance, and any notable findings.`,
        scope: { type: 'rep', rep_email: repEmail },
        format: 'text',
        max_tokens: 1500,
      });

      await updateThinking(client, run.workspace_id, event, thinking.ts, [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*${repEmail}*\n\n${analysis.answer}` },
      }]);

      await updateContext(run.workspace_id, event.channel, event.thread_ts, {
        entities_discussed: [repEmail],
        last_scope: { type: 'rep', rep_email: repEmail },
      });
    }

    await recordAssistantMessage(run.workspace_id, event, 'Provided detailed information.');
  } catch (err) {
    console.error('[reply-handlers] drill_down error:', err);
    await updateThinking(client, run.workspace_id, event, thinking.ts,
      `Sorry, I ran into an error looking that up. Please try again.`);
  }
}

export async function handleAddContext(
  run: SkillRunRef,
  intent: ThreadReplyIntent,
  event: SlackEvent
): Promise<void> {
  const client = getSlackAppClient();

  const contextText = intent.context_text || event.text;
  const entry = {
    source: 'slack_thread',
    added_by: event.user,
    added_at: new Date().toISOString(),
    skill_run_id: run.run_id || run.id,
    text: contextText,
  };

  let responseText: string;

  if (intent.deal_name) {
    const deal = await findEntityByName(run.workspace_id, 'deals', intent.deal_name);
    if (deal) {
      await query(
        `INSERT INTO context_layer (workspace_id, category, key, value)
         VALUES ($1, 'deal_context', $2, $3::jsonb)
         ON CONFLICT (workspace_id, category, key)
         DO UPDATE SET value = context_layer.value || $3::jsonb, updated_at = now()`,
        [run.workspace_id, `deal:${deal.id}`, JSON.stringify([entry])]
      );
      responseText = `Got it — noted that ${deal.name} context: "${contextText}". This will be factored into future analyses.`;
    } else {
      responseText = `I noted this context but couldn't match it to a specific deal named "${intent.deal_name}". It'll still be available for future analyses.`;
      await query(
        `INSERT INTO context_layer (workspace_id, category, key, value)
         VALUES ($1, 'user_context', $2, $3::jsonb)
         ON CONFLICT (workspace_id, category, key)
         DO UPDATE SET value = context_layer.value || $3::jsonb, updated_at = now()`,
        [run.workspace_id, `run:${run.run_id || run.id}`, JSON.stringify([entry])]
      );
    }
  } else {
    await query(
      `INSERT INTO context_layer (workspace_id, category, key, value)
       VALUES ($1, 'user_context', $2, $3::jsonb)
       ON CONFLICT (workspace_id, category, key)
       DO UPDATE SET value = context_layer.value || $3::jsonb, updated_at = now()`,
      [run.workspace_id, `run:${run.run_id || run.id}`, JSON.stringify([entry])]
    );
    responseText = `Noted. This context will be included in the next analysis.`;
  }

  await client.postMessage(run.workspace_id, event.channel, [{
    type: 'section',
    text: { type: 'mrkdwn', text: responseText },
  }], { thread_ts: event.thread_ts });

  await recordAssistantMessage(run.workspace_id, event, responseText);
}

export async function handleQuestion(
  run: SkillRunRef,
  event: SlackEvent
): Promise<void> {
  const client = getSlackAppClient();

  const thinking = await client.postMessage(run.workspace_id, event.channel, [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Analyzing..._` }],
  }], { thread_ts: event.thread_ts });

  try {
    const skillContext = run.result?.evidence || run.result?.summary;

    const analysis = await runScopedAnalysis({
      workspace_id: run.workspace_id,
      question: event.text,
      scope: {
        type: 'workspace',
        skill_run_id: run.run_id || run.id,
        skill_run_context: skillContext,
      },
      format: 'text',
      max_tokens: 1500,
    });

    await updateThinking(client, run.workspace_id, event, thinking.ts, [{
      type: 'section',
      text: { type: 'mrkdwn', text: analysis.answer },
    }]);

    await updateContext(run.workspace_id, event.channel, event.thread_ts, {
      skills_referenced: [run.skill_id],
    });
    await recordAssistantMessage(run.workspace_id, event, analysis.answer);
  } catch (err) {
    console.error('[reply-handlers] question error:', err);
    await updateThinking(client, run.workspace_id, event, thinking.ts,
      `Sorry, I couldn't process that question. Please try rephrasing.`);
  }
}

export async function handleScopeFilter(
  run: SkillRunRef,
  intent: ThreadReplyIntent,
  event: SlackEvent
): Promise<void> {
  const client = getSlackAppClient();

  const thinking = await client.postMessage(run.workspace_id, event.channel, [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Re-analyzing with filter: ${intent.filter_type} = ${intent.filter_value}..._` }],
  }], { thread_ts: event.thread_ts });

  try {
    const scopeType = intent.filter_type === 'rep' ? 'rep' : 'pipeline';
    const analysis = await runScopedAnalysis({
      workspace_id: run.workspace_id,
      question: `Re-run the ${run.skill_id} analysis focused on ${intent.filter_type}: ${intent.filter_value}. Provide the same type of insights but scoped to this filter.`,
      scope: {
        type: scopeType as any,
        rep_email: intent.filter_type === 'rep' ? intent.filter_value : undefined,
        filters: intent.filter_type !== 'rep' ? { [intent.filter_type!]: intent.filter_value } : undefined,
      },
      format: 'text',
      max_tokens: 2000,
    });

    await updateThinking(client, run.workspace_id, event, thinking.ts, [{
      type: 'section',
      text: { type: 'mrkdwn', text: `*${run.skill_id} — filtered by ${intent.filter_type}: ${intent.filter_value}*\n\n${analysis.answer}` },
    }]);

    await recordAssistantMessage(run.workspace_id, event, analysis.answer);
  } catch (err) {
    console.error('[reply-handlers] scope_filter error:', err);
    await updateThinking(client, run.workspace_id, event, thinking.ts,
      `Sorry, I couldn't re-run with that filter. Please try again.`);
  }
}

export async function handleAction(
  run: SkillRunRef,
  intent: ThreadReplyIntent,
  event: SlackEvent
): Promise<void> {
  const client = getSlackAppClient();
  let responseText: string;

  if (intent.action_type === 'snooze') {
    const days = 7;
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + days);

    await query(
      `INSERT INTO snooze_config (workspace_id, skill_id, run_id, snoozed_by, snooze_until)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, skill_id)
       DO UPDATE SET snooze_until = $5, snoozed_by = $4, run_id = $3, updated_at = now()`,
      [run.workspace_id, run.skill_id, run.run_id || run.id, event.user, snoozeUntil.toISOString()]
    );
    responseText = `Snoozed ${run.skill_id} for ${days} days. It will resume alerting on ${snoozeUntil.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`;
  } else if (intent.action_type === 'reviewed') {
    await query(
      `UPDATE skill_runs
       SET result = jsonb_set(COALESCE(result, '{}'), '{reviewed}', to_jsonb($3::text))
       WHERE run_id = $1 AND workspace_id = $2`,
      [run.run_id || run.id, run.workspace_id, new Date().toISOString()]
    );
    responseText = `Marked this run as reviewed.`;
  } else if (intent.action_type === 'dismiss') {
    responseText = `To dismiss specific findings, use the Dismiss button on individual action cards, or visit the Command Center.`;
  } else {
    responseText = `I can help with: snooze (pause alerts), reviewed (mark as seen). What would you like to do?`;
  }

  await client.postMessage(run.workspace_id, event.channel, [{
    type: 'section',
    text: { type: 'mrkdwn', text: responseText },
  }], { thread_ts: event.thread_ts });

  await recordAssistantMessage(run.workspace_id, event, responseText);
}

async function findEntityByName(
  workspaceId: string,
  table: 'deals' | 'accounts',
  name: string
): Promise<{ id: string; name: string } | null> {
  if (!name || name.length < 2) return null;

  const exactResult = await query<{ id: string; name: string }>(
    `SELECT id, name FROM ${table}
     WHERE workspace_id = $1 AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [workspaceId, name]
  );
  if (exactResult.rows.length > 0) return exactResult.rows[0];

  const fuzzyResult = await query<{ id: string; name: string }>(
    `SELECT id, name FROM ${table}
     WHERE workspace_id = $1 AND LOWER(name) LIKE $2
     LIMIT 1`,
    [workspaceId, `%${name.toLowerCase()}%`]
  );
  return fuzzyResult.rows.length > 0 ? fuzzyResult.rows[0] : null;
}

async function updateThinking(
  client: ReturnType<typeof getSlackAppClient>,
  workspaceId: string,
  event: SlackEvent,
  thinkingTs: string,
  content: string | any[]
): Promise<void> {
  const blocks = typeof content === 'string'
    ? [{ type: 'section', text: { type: 'mrkdwn', text: content } }]
    : content;

  if (thinkingTs) {
    await client.updateMessage(workspaceId, {
      channel: event.channel,
      ts: thinkingTs,
      blocks,
    });
  } else {
    await client.postMessage(workspaceId, event.channel, blocks, {
      thread_ts: event.thread_ts,
    });
  }
}

async function recordAssistantMessage(
  workspaceId: string,
  event: SlackEvent,
  content: string
): Promise<void> {
  try {
    await appendMessage(workspaceId, event.channel, event.thread_ts, {
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[reply-handlers] Failed to record assistant message:', err);
  }
}

function formatDealDossierForThread(dossier: any): any[] {
  const blocks: any[] = [];
  const { deal, contacts, findings, health_signals } = dossier;

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
    fields.push({ type: 'mrkdwn', text: `*Close:* ${new Date(deal.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` });
  }
  if (deal.owner) {
    fields.push({ type: 'mrkdwn', text: `*Owner:* ${deal.owner}` });
  }
  blocks.push({ type: 'section', fields });

  if (health_signals) {
    const icons: Record<string, string> = { active: '🟢', cooling: '🟡', cold: '🔴', multi: '🟢', dual: '🟡', single: '🔴', fast: '🟢', normal: '🟡', stuck: '🔴' };
    const parts = [
      `${icons[health_signals.activity_recency] || '⚪'} Activity: ${health_signals.activity_recency}`,
      `${icons[health_signals.threading] || '⚪'} Threading: ${health_signals.threading}`,
      `${icons[health_signals.stage_velocity] || '⚪'} Velocity: ${health_signals.stage_velocity}`,
    ];
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: parts.join('  |  ') }] });
  }

  if (findings && findings.length > 0) {
    blocks.push({ type: 'divider' });
    const sevEmoji: Record<string, string> = { act: '🔴', watch: '🟡', notable: '🔵', info: 'ℹ️' };
    const lines = findings.slice(0, 5).map((f: any) =>
      `${sevEmoji[f.severity] || '•'} ${f.message}`
    ).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Findings (${findings.length}):*\n${lines}` } });
  }

  if (contacts && contacts.length > 0) {
    const contactLines = contacts.slice(0, 5).map((c: any) =>
      `• ${c.name}${c.role ? ` (${c.role})` : ''}${c.title ? ` — ${c.title}` : ''}`
    ).join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Contacts:*\n${contactLines}` } });
  }

  return blocks;
}

function formatAccountDossierForThread(dossier: any): any[] {
  const blocks: any[] = [];
  const { account } = dossier;

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: account.name, emoji: true },
  });

  const fields: any[] = [];
  if (account.industry) fields.push({ type: 'mrkdwn', text: `*Industry:* ${account.industry}` });
  if (account.domain) fields.push({ type: 'mrkdwn', text: `*Domain:* ${account.domain}` });
  if (account.owner) fields.push({ type: 'mrkdwn', text: `*Owner:* ${account.owner}` });
  if (fields.length > 0) blocks.push({ type: 'section', fields });

  if (dossier.deal_summary) {
    const ds = dossier.deal_summary;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Deals:* ${ds.open_count || 0} open (${formatCurrency(ds.open_value || 0)}) | ${ds.won_count || 0} won | ${ds.lost_count || 0} lost` },
    });
  }

  if (dossier.findings && dossier.findings.length > 0) {
    blocks.push({ type: 'divider' });
    const lines = dossier.findings.slice(0, 5).map((f: any) => `• ${f.message}`).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Findings:*\n${lines}` } });
  }

  return blocks;
}
