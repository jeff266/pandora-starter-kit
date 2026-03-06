/**
 * Inline Actions API
 *
 * Lightweight endpoints for surfacing actions in Ask Pandora chat, deal list, and deal detail.
 * Shaped for the StageRecCard UI component — includes evidence, confidence, and CRM labels.
 */

import { Router, type Request, type Response } from 'express';
import { query as dbQuery } from '../db.js';
import dbPool from '../db.js';
import { executeAction } from '../actions/executor.js';
import { resolveStageToCRM } from '../actions/stage-resolver.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

interface Evidence {
  label: string;
  value: string;
  signal_type: 'conversation' | 'stakeholder' | 'activity' | 'timing' | 'keyword';
}

interface InlineAction {
  id: string;
  action_type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  summary: string;
  confidence: number;
  from_value: string | null;
  to_value: string | null;
  evidence: Evidence[];
  impact_label: string | null;
  urgency_label: string | null;
  execution_status: string;
  created_at: string;
  deal_name?: string;
}

/**
 * GET /api/workspaces/:workspaceId/deals/:dealId/actions
 *
 * Returns open actions for a single deal, shaped for inline card rendering.
 */
router.get(
  '/:workspaceId/deals/:dealId/actions',
  async (req: Request<WorkspaceParams & { dealId: string }>, res: Response) => {
    try {
      const { workspaceId, dealId } = req.params;

      // Fetch actions for this deal
      const result = await dbQuery(
        `SELECT a.*,
                d.name as deal_name,
                d.stage as deal_stage,
                d.amount as deal_amount,
                d.source as deal_source
         FROM actions a
         LEFT JOIN deals d ON a.target_deal_id = d.id
         WHERE a.workspace_id = $1
           AND a.target_deal_id = $2
           AND a.execution_status = 'open'
           AND a.severity IN ('critical', 'warning')
         ORDER BY
           CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
           a.created_at DESC
         LIMIT 10`,
        [workspaceId, dealId]
      );

      const actions: InlineAction[] = result.rows.map((row) => {
        // Extract confidence from execution_payload
        const confidence = extractConfidence(row.execution_payload);

        // Extract or generate evidence
        const evidence = extractEvidence(row);

        // Extract from/to values for update_stage actions
        const { from_value, to_value } = extractStageValues(row);

        // Generate impact label
        const impact_label = row.impact_amount
          ? `$${formatAmount(row.impact_amount)} at risk`
          : null;

        // Generate urgency label
        const urgency_label = computeUrgency(row);

        return {
          id: row.id,
          action_type: row.action_type,
          severity: row.severity,
          title: row.title || generateTitle(row.action_type, row.deal_name),
          summary: row.summary || row.reasoning || 'No details available',
          confidence,
          from_value,
          to_value,
          evidence,
          impact_label,
          urgency_label,
          execution_status: row.execution_status,
          created_at: row.created_at,
          deal_name: row.deal_name,
        };
      });

      res.json({ actions });
    } catch (err) {
      console.error('[Inline Actions API]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

/**
 * POST /api/workspaces/:workspaceId/actions/:actionId/execute-inline
 *
 * Execute an action with optional stage override.
 * Thin wrapper around executeAction that resolves override_value before execution.
 */
router.post(
  '/:workspaceId/actions/:actionId/execute-inline',
  async (req: Request<WorkspaceParams & { actionId: string }>, res: Response) => {
    try {
      const { workspaceId, actionId } = req.params;
      const { override_value, user_id } = req.body as {
        override_value?: string;
        user_id: string;
      };

      if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
      }

      // Load the action to check if override handling is needed
      const actionResult = await dbQuery(
        `SELECT a.*, d.source as deal_source
         FROM actions a
         LEFT JOIN deals d ON a.target_deal_id = d.id
         WHERE a.id = $1 AND a.workspace_id = $2`,
        [actionId, workspaceId]
      );

      if (actionResult.rows.length === 0) {
        return res.status(404).json({ error: 'Action not found' });
      }

      const action = actionResult.rows[0];

      // If override_value is provided and action is update_stage, resolve it
      if (override_value && action.action_type === 'update_stage') {
        const dealSource = action.deal_source as 'hubspot' | 'salesforce';

        if (!dealSource) {
          return res.status(400).json({ error: 'Cannot resolve stage: deal has no CRM source' });
        }

        // Resolve the override stage value to CRM-specific value
        const { crmValue, confidence } = await resolveStageToCRM(
          workspaceId,
          dealSource,
          override_value
        );

        // Update execution_payload with the resolved stage
        const updatedPayload = {
          ...(action.execution_payload || {}),
          to_value: crmValue,
          override_applied: true,
          override_original: override_value,
          override_confidence: confidence,
        };

        await dbQuery(
          `UPDATE actions
           SET execution_payload = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(updatedPayload), actionId]
        );
      }

      // Execute the action
      const result = await executeAction(dbPool, {
        actionId,
        workspaceId,
        actor: user_id,
        dryRun: false,
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error || 'Execution failed',
        });
      }

      // Return success with CRM record URL if available
      const crmRecordUrl = action.deal_source === 'hubspot'
        ? `https://app.hubspot.com/contacts/${action.execution_payload?.portal_id || ''}/deal/${action.execution_payload?.deal_external_id || ''}`
        : action.deal_source === 'salesforce'
        ? `https://${action.execution_payload?.instance_url || 'login.salesforce.com'}/${action.execution_payload?.deal_external_id || ''}`
        : undefined;

      res.json({
        success: true,
        executed_at: new Date().toISOString(),
        crm_record_url: crmRecordUrl,
      });
    } catch (err) {
      console.error('[Inline Execute API]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

/**
 * POST /api/workspaces/:workspaceId/actions/:actionId/dismiss
 *
 * Dismiss an action with optional reason.
 */
router.post(
  '/:workspaceId/actions/:actionId/dismiss',
  async (req: Request<WorkspaceParams & { actionId: string }>, res: Response) => {
    try {
      const { workspaceId, actionId } = req.params;
      const { reason } = req.body as { reason?: string };

      const result = await dbQuery(
        `UPDATE actions
         SET execution_status = 'dismissed',
             dismissed_reason = $3,
             updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2
         RETURNING *`,
        [actionId, workspaceId, reason || 'user_dismissed']
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Action not found' });
      }

      res.json({ success: true, action: result.rows[0] });
    } catch (err) {
      console.error('[Dismiss Action API]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

/**
 * GET /api/workspaces/:workspaceId/actions/summary-by-deal
 *
 * Batch endpoint: returns action counts per deal for rendering badges on deal list.
 * Single SQL query, no N+1.
 */
router.get(
  '/:workspaceId/actions/summary-by-deal',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      const result = await dbQuery(
        `SELECT
           target_deal_id as deal_id,
           COUNT(*) FILTER (WHERE severity = 'critical') as critical,
           COUNT(*) FILTER (WHERE severity = 'warning') as warning,
           COUNT(*) FILTER (WHERE severity = 'info') as info,
           COUNT(*) FILTER (WHERE action_type = 'update_stage') > 0 as has_stage_mismatch,
           (array_agg(action_type ORDER BY
             CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
             created_at DESC)
           )[1] as top_action_type
         FROM actions
         WHERE workspace_id = $1
           AND execution_status = 'open'
           AND target_deal_id IS NOT NULL
         GROUP BY target_deal_id`,
        [workspaceId]
      );

      // Convert to map for easy lookup
      const summary: Record<string, any> = {};
      result.rows.forEach((row) => {
        summary[row.deal_id] = {
          critical: parseInt(row.critical) || 0,
          warning: parseInt(row.warning) || 0,
          info: parseInt(row.info) || 0,
          has_stage_mismatch: row.has_stage_mismatch,
          top_action_type: row.top_action_type,
        };
      });

      res.json(summary);
    } catch (err) {
      console.error('[Summary By Deal API]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

// ─── Helper Functions ──────────────────────────────────────────────────────

function extractConfidence(payload: any): number {
  if (!payload) return 70;

  // Try various confidence field names
  if (typeof payload.confidence === 'number') {
    return payload.confidence < 1 ? payload.confidence * 100 : payload.confidence;
  }
  if (typeof payload.confidence_pct === 'number') {
    return payload.confidence_pct;
  }
  if (typeof payload.score_confidence === 'number') {
    return payload.score_confidence < 1 ? payload.score_confidence * 100 : payload.score_confidence;
  }

  return 70; // Default
}

function extractEvidence(row: any): Evidence[] {
  const evidence: Evidence[] = [];
  const payload = row.execution_payload || {};

  // Try structured evidence first
  if (Array.isArray(payload.evidence)) {
    return payload.evidence.slice(0, 5);
  }

  // Try reasoning_signals
  if (Array.isArray(payload.reasoning_signals)) {
    return payload.reasoning_signals.slice(0, 3).map((s: any) => ({
      label: s.type || s.label || 'Signal',
      value: s.description || s.value || s.text || '',
      signal_type: mapSignalType(s.type || s.signal_type),
    }));
  }

  // Fallback: generate from summary text
  const summary = row.summary || row.reasoning || '';
  if (summary.length > 20) {
    evidence.push({
      label: 'Analysis',
      value: summary.slice(0, 200),
      signal_type: 'keyword',
    });
  }

  // Always return at least 1 evidence row
  if (evidence.length === 0) {
    evidence.push({
      label: 'Recommendation',
      value: row.title || 'Stage update recommended based on activity analysis',
      signal_type: 'activity',
    });
  }

  return evidence;
}

function extractStageValues(row: any): { from_value: string | null; to_value: string | null } {
  const payload = row.execution_payload || {};

  if (row.action_type === 'update_stage') {
    return {
      from_value: row.deal_stage || payload.from_value || payload.current_stage || null,
      to_value: payload.to_value || payload.recommended_stage || payload.new_stage || null,
    };
  }

  return { from_value: null, to_value: null };
}

function formatAmount(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return amount.toLocaleString();
}

function computeUrgency(row: any): string | null {
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  if (row.severity === 'critical') {
    if (ageDays < 1) return 'Urgent';
    if (ageDays < 3) return 'High';
    return 'Critical';
  }

  if (ageDays > 7) return 'Stale';
  if (ageDays > 3) return 'Medium';
  return null;
}

function generateTitle(actionType: string, dealName?: string): string {
  const typeLabels: Record<string, string> = {
    update_stage: 'Stage Mismatch',
    re_engage_deal: 'Re-engagement Needed',
    update_close_date: 'Close Date Risk',
    add_stakeholder: 'Stakeholder Gap',
    schedule_follow_up: 'Follow-up Overdue',
  };

  const label = typeLabels[actionType] || 'Action Required';
  return dealName ? `${label} — ${dealName}` : label;
}

function mapSignalType(type: string): Evidence['signal_type'] {
  const lower = (type || '').toLowerCase();
  if (lower.includes('convers') || lower.includes('call') || lower.includes('meeting'))
    return 'conversation';
  if (lower.includes('stakeholder') || lower.includes('contact')) return 'stakeholder';
  if (lower.includes('activity') || lower.includes('engagement')) return 'activity';
  if (lower.includes('timing') || lower.includes('date') || lower.includes('velocity'))
    return 'timing';
  return 'keyword';
}

export default router;
