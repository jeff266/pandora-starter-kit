/**
 * Push API — Webhook Formatter
 * Formats raw JSON payload for HTTP webhook delivery.
 * Signs with HMAC-SHA256 if channel has a secret.
 */

import { createHmac } from 'crypto';
import type { AssembledFinding } from '../finding-assembler.js';

export interface WebhookPayload {
  workspace_id: string;
  workspace_name: string;
  delivered_at: string;
  trigger: string;
  rule_name: string;
  finding_count: number;
  findings: WebhookFinding[];
}

export interface WebhookFinding {
  id: string;
  skill_id: string;
  severity: string;
  category: string;
  message: string;
  deal_id: string | null;
  deal_name: string | null;
  deal_amount: number | null;
  deal_owner: string | null;
  ai_score: number | null;
  found_at: string;
  metadata: Record<string, any>;
}

export function formatWebhookPayload(
  findings: AssembledFinding[],
  workspaceId: string,
  workspaceName: string,
  ruleName: string,
  triggeredBy: string
): WebhookPayload {
  return {
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    delivered_at: new Date().toISOString(),
    trigger: triggeredBy,
    rule_name: ruleName,
    finding_count: findings.length,
    findings: findings.map(f => ({
      id: f.id,
      skill_id: f.skill_id,
      severity: f.severity,
      category: f.category,
      message: f.message,
      deal_id: f.deal_id,
      deal_name: f.deal_name,
      deal_amount: f.deal_amount,
      deal_owner: f.deal_owner,
      ai_score: f.ai_score,
      found_at: f.created_at,
      metadata: f.metadata,
    })),
  };
}

export function signPayload(payloadJson: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payloadJson).digest('hex');
}
