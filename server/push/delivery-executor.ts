/**
 * Push API — Delivery Executor
 *
 * Formats findings and delivers them to the target channel.
 * Retries transient failures, auto-disables rules after 5 consecutive failures.
 * Never throws — delivery failure must not affect callers.
 */

import { query } from '../db.js';
import type { AssembledFinding, DeliveryRuleRow } from './finding-assembler.js';
import { formatSlackPayload } from './formatters/slack-push-formatter.js';
import { formatEmailHtml, formatEmailSubject } from './formatters/email-push-formatter.js';
import { formatWebhookPayload, signPayload } from './formatters/webhook-formatter.js';

export interface DeliveryChannelRow {
  id: string;
  workspace_id: string;
  name: string;
  channel_type: 'slack' | 'email' | 'webhook';
  config: Record<string, any>;
  is_active: boolean;
  verified_at: string | null;
}

// ─── Transport functions ──────────────────────────────────────────────────────

async function postToSlack(webhookUrl: string, payload: object, retries = 3): Promise<void> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return;
    if (res.status >= 400 && res.status < 500) {
      // 4xx — don't retry, permanent failure
      throw new Error(`Slack 4xx: ${res.status} ${res.statusText}`);
    }
    lastErr = new Error(`Slack ${res.status}: ${res.statusText}`);
  }
  throw lastErr || new Error('Slack delivery failed');
}

async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  retries = 3
): Promise<void> {
  // Dynamic import to avoid startup overhead if Resend is unconfigured
  const { Resend } = await import('resend');
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');
  const resend = new Resend(apiKey);

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 5000));
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Pandora <noreply@pandora.ai>',
      to,
      subject,
      html,
    });
    if (!error) return;
    lastErr = new Error(error.message || 'Email delivery failed');
  }
  throw lastErr || new Error('Email delivery failed');
}

async function postWebhook(
  url: string,
  payload: object,
  secret: string | undefined,
  retries = 3
): Promise<void> {
  const payloadJson = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Pandora-Push/1.0',
  };
  if (secret) {
    headers['X-Pandora-Signature'] = signPayload(payloadJson, secret);
  }

  const delays = [5000, 15000, 45000];
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, delays[attempt - 1] || 45000));
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: payloadJson,
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return;
    if (res.status >= 400 && res.status < 500) {
      throw new Error(`Webhook 4xx (no retry): ${res.status}`);
    }
    lastErr = new Error(`Webhook ${res.status}: ${res.statusText}`);
  }
  throw lastErr || new Error('Webhook delivery failed');
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function logDelivery(params: {
  ruleId: string;
  workspaceId: string;
  channelId: string;
  triggeredBy: string;
  status: 'success' | 'failed' | 'empty' | 'skipped';
  findingCount?: number;
  error?: string;
  payloadPreview?: string;
  durationMs: number;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO delivery_log
         (rule_id, workspace_id, channel_id, triggered_by, finding_count, status, error, payload_preview, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        params.ruleId,
        params.workspaceId,
        params.channelId,
        params.triggeredBy,
        params.findingCount ?? null,
        params.status,
        params.error ?? null,
        params.payloadPreview ? params.payloadPreview.slice(0, 500) : null,
        params.durationMs,
      ]
    );
  } catch (err) {
    console.warn('[PushAPI] Failed to write delivery log:', err instanceof Error ? err.message : err);
  }
}

async function updateRuleState(ruleId: string, success: boolean, consecutiveFailures: number): Promise<void> {
  try {
    if (success) {
      await query(
        `UPDATE delivery_rules
         SET last_delivery_at = NOW(), last_delivery_status = 'success', consecutive_failures = 0
         WHERE id = $1`,
        [ruleId]
      );
    } else {
      const autoDisable = consecutiveFailures >= 5;
      await query(
        `UPDATE delivery_rules
         SET last_delivery_status = 'failed',
             consecutive_failures = $2,
             is_active = CASE WHEN $3 THEN false ELSE is_active END
         WHERE id = $1`,
        [ruleId, consecutiveFailures, autoDisable]
      );
      if (autoDisable) {
        console.warn(`[PushAPI] Rule ${ruleId} auto-disabled after 5 consecutive failures`);
      }
    }
  } catch (err) {
    console.warn('[PushAPI] Failed to update rule state:', err instanceof Error ? err.message : err);
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function executeDelivery(
  rule: DeliveryRuleRow,
  channel: DeliveryChannelRow,
  findings: AssembledFinding[],
  triggeredBy: string,
  workspaceName: string
): Promise<void> {
  const startMs = Date.now();

  if (findings.length === 0) {
    await logDelivery({
      ruleId: rule.id,
      workspaceId: rule.workspace_id,
      channelId: channel.id,
      triggeredBy,
      status: 'empty',
      findingCount: 0,
      durationMs: Date.now() - startMs,
    });
    return;
  }

  let payloadPreview: string | undefined;

  try {
    const skillIds = [...new Set(findings.map(f => f.skill_id))];

    switch (channel.channel_type) {
      case 'slack': {
        const payload = formatSlackPayload(findings, rule.template, workspaceName, rule.name, skillIds);
        payloadPreview = JSON.stringify(payload);
        await postToSlack(channel.config.webhook_url, payload);
        break;
      }
      case 'email': {
        const html = formatEmailHtml(findings, workspaceName, rule.name);
        const subject = formatEmailSubject(workspaceName, rule.name, findings);
        payloadPreview = subject;
        const to: string[] = channel.config.to || [];
        if (to.length === 0) throw new Error('No recipients configured');
        await sendEmail(to, subject, html);
        break;
      }
      case 'webhook': {
        const payload = formatWebhookPayload(findings, rule.workspace_id, workspaceName, rule.name, triggeredBy);
        payloadPreview = JSON.stringify(payload);
        await postWebhook(channel.config.url, payload, channel.config.secret);
        break;
      }
      default:
        throw new Error(`Unknown channel type: ${channel.channel_type}`);
    }

    await updateRuleState(rule.id, true, 0);
    await logDelivery({
      ruleId: rule.id,
      workspaceId: rule.workspace_id,
      channelId: channel.id,
      triggeredBy,
      status: 'success',
      findingCount: findings.length,
      payloadPreview,
      durationMs: Date.now() - startMs,
    });

    console.log(`[PushAPI] Delivered ${findings.length} findings via ${channel.channel_type} for rule "${rule.name}" (${triggeredBy})`);

  } catch (err: any) {
    const newFailures = (rule.consecutive_failures || 0) + 1;
    const errMsg = err.message || String(err);
    await updateRuleState(rule.id, false, newFailures);
    await logDelivery({
      ruleId: rule.id,
      workspaceId: rule.workspace_id,
      channelId: channel.id,
      triggeredBy,
      status: 'failed',
      error: errMsg,
      durationMs: Date.now() - startMs,
    });
    console.error(`[PushAPI] Delivery failed for rule "${rule.name}" (attempt ${newFailures}/5):`, errMsg);
    // Never throw — delivery failure must not crash callers
  }
}
