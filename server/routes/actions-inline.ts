/**
 * Inline Actions API
 *
 * Lightweight endpoints for surfacing actions in Ask Pandora chat, deal list, and deal detail.
 * Shaped for the StageRecCard UI component — includes evidence, confidence, and CRM labels.
 */

import { Router, type Request, type Response } from 'express';
import { createHash } from 'crypto';
import { query as dbQuery } from '../db.js';
import dbPool from '../db.js';
import { executeAction } from '../actions/executor.js';
import { resolveStageToCRM } from '../actions/stage-resolver.js';
import { getCredentials } from '../connectors/adapters/credentials.js';
import { HubSpotClient } from '../connectors/hubspot/client.js';
import { SalesforceClient } from '../connectors/salesforce/client.js';
import { requireWorkspaceAccess } from '../middleware/auth.js';
import { approveInternalAction } from '../workflow/action-approver.js';

const INTERNAL_ACTION_TYPES_SET = new Set([
  'update_data_dictionary',
  'update_workspace_knowledge',
  'confirm_metric_definition',
  'update_calibration',
  'run_skill',
]);

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

      // Lazy-seed stage action if phase_divergence=true and no open update_stage action exists
      const dealResult = await dbQuery(
        `SELECT phase_divergence, inferred_phase, phase_confidence, phase_signals, stage
         FROM deals
         WHERE id = $1 AND workspace_id = $2`,
        [dealId, workspaceId]
      );

      const deal = dealResult.rows[0];

      if (deal?.phase_divergence) {
        // Check if update_stage action already exists (open)
        const existingAction = await dbQuery(
          `SELECT id FROM actions
           WHERE workspace_id = $1
             AND target_deal_id = $2
             AND action_type = 'update_stage'
             AND execution_status = 'open'
           LIMIT 1`,
          [workspaceId, dealId]
        );

        if (existingAction.rows.length === 0) {
          // Auto-create action
          const confidence = deal.phase_confidence || 70;
          const signals = deal.phase_signals || {};

          await dbQuery(
            `INSERT INTO actions (
               workspace_id, target_deal_id, action_type, severity,
               title, summary, execution_payload, execution_status
             ) VALUES (
               $1, $2, 'update_stage', $3,
               $4, $5, $6, 'open'
             )`,
            [
              workspaceId,
              dealId,
              confidence >= 80 ? 'critical' : 'warning',
              'Stage Mismatch Detected',
              `Deal shows signals of ${deal.inferred_phase} phase but CRM stage is ${deal.stage}`,
              JSON.stringify({
                from_value: deal.stage,
                to_value: deal.inferred_phase,
                confidence: confidence,
                evidence: buildEvidenceFromSignals(signals),
              }),
            ]
          );
        }
      }

      // Fetch actions for this deal
      const includeNextSteps = req.query.include_next_steps === 'true';
      const severityFilter = includeNextSteps
        ? `AND a.execution_status = 'open'`
        : `AND a.execution_status = 'open' AND a.severity IN ('critical', 'warning')`;

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
           ${severityFilter}
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
      const { override_value, user_id, mode } = req.body as {
        override_value?: string;
        user_id: string;
        mode?: 'task_create' | 'note_create';
      };

      if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
      }

      // Load the action to check if override handling is needed
      const actionResult = await dbQuery(
        `SELECT a.*, d.source as deal_source, d.source_id as deal_source_id, d.owner as deal_owner
         FROM actions a
         LEFT JOIN deals d ON a.target_deal_id = d.id
         WHERE a.id = $1 AND a.workspace_id = $2`,
        [actionId, workspaceId]
      );

      if (actionResult.rows.length === 0) {
        return res.status(404).json({ error: 'Action not found' });
      }

      const action = actionResult.rows[0];

      // Internal Pandora action types — write to Pandora's own tables
      if (INTERNAL_ACTION_TYPES_SET.has(action.action_type)) {
        const result = await approveInternalAction(action, workspaceId, actionId, user_id);
        if (!result.success) {
          return res.status(400).json({ success: false, error: result.message });
        }
        await dbQuery(
          `UPDATE actions SET execution_status = 'executed', executed_at = now(), executed_by = $3, updated_at = now()
           WHERE id = $1 AND workspace_id = $2`,
          [actionId, workspaceId, user_id]
        );
        return res.json({ success: true, message: result.message, executed_at: new Date().toISOString() });
      }

      // Next-step action: handle task_create / note_create directly
      if (mode && action.action_type === 'next_step') {
        const crmSource = action.deal_source as 'hubspot' | 'salesforce' | undefined;
        const externalId = action.deal_source_id as string | undefined;

        if (!crmSource || !externalId) {
          return res.status(400).json({ error: 'Deal has no CRM source — cannot create task/note' });
        }

        const connection = await getCredentials(workspaceId, crmSource).catch(() => null);
        if (!connection) {
          return res.status(400).json({ error: `No ${crmSource} connector configured` });
        }

        const creds = connection.credentials;
        let execResult: { success: boolean; error?: string } = { success: false };

        if (crmSource === 'hubspot') {
          const hs = new HubSpotClient(creds.access_token || creds.accessToken, workspaceId);
          if (mode === 'task_create') {
            execResult = await hs.createDealTask(externalId, action.title, action.summary || action.title);
          } else {
            execResult = await hs.addDealNote(externalId, `Pandora next step: ${action.title}`);
          }
        } else if (crmSource === 'salesforce') {
          const sf = new SalesforceClient({
            accessToken: creds.access_token || creds.accessToken,
            instanceUrl: creds.instance_url || creds.instanceUrl,
            apiVersion: 'v62.0',
          });
          if (mode === 'task_create') {
            execResult = await sf.createOpportunityTask(externalId, action.title, action.summary || action.title);
          } else {
            execResult = await sf.addOpportunityNote(externalId, 'Pandora next step', `Pandora next step: ${action.title}`);
          }
        }

        if (!execResult.success) {
          return res.status(400).json({ success: false, error: execResult.error || 'CRM write failed' });
        }

        await dbQuery(
          `UPDATE actions SET execution_status = 'executed', executed_at = now(), executed_by = $3, updated_at = now()
           WHERE id = $1 AND workspace_id = $2`,
          [actionId, workspaceId, user_id]
        );

        return res.json({ success: true, executed_at: new Date().toISOString() });
      }

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
        bypassJudgment: true, // User-triggered execution bypasses automatic judgment
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error || 'Execution failed',
        });
      }

      // Resolve related findings after successful execution (T5)
      await dbQuery(
        `UPDATE findings
         SET resolved_at = NOW(),
             resolution_method = 'action_executed'
         WHERE workspace_id = $1
           AND deal_id = (SELECT target_deal_id FROM actions WHERE id = $2)
           AND category = 'stage_mismatch'
           AND resolved_at IS NULL`,
        [workspaceId, actionId]
      );

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
      const { reason, resolve_findings } = req.body as {
        reason?: string;
        resolve_findings?: boolean;
      };

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

      // Resolve related findings if requested (T5)
      if (resolve_findings) {
        await dbQuery(
          `UPDATE findings
           SET resolved_at = NOW(),
               resolution_method = 'dismissed_with_action'
           WHERE workspace_id = $1
             AND deal_id = (SELECT target_deal_id FROM actions WHERE id = $2)
             AND category = 'stage_mismatch'
             AND resolved_at IS NULL`,
          [workspaceId, actionId]
        );
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

/**
 * POST /api/workspaces/:workspaceId/deals/:dealId/actions/sync
 *
 * Upserts next-step actions from the frontend into the actions table.
 * Uses md5(workspace_id||'::'||deal_id||'::'||title) as dedup key.
 * Skips steps where a dismissed record exists with same hash.
 * Returns { actions: [{ id, title, priority, source, suggested_crm_action }] }
 */
router.post(
  '/:workspaceId/deals/:dealId/actions/sync',
  async (req: Request<WorkspaceParams & { dealId: string }>, res: Response) => {
    try {
      const { workspaceId, dealId } = req.params;
      const { steps } = req.body as {
        steps: Array<{
          title: string;
          priority: 'P0' | 'P1' | 'P2';
          source: 'dossier' | 'client_rule' | 'meddic' | 'coaching';
          category?: string;
          suggested_crm_action?: 'task_create' | 'note_create' | 'field_write' | null;
        }>;
      };

      if (!Array.isArray(steps) || steps.length === 0) {
        return res.json({ actions: [] });
      }

      const results: Array<{ id: string; title: string; priority: string; source: string; suggested_crm_action: string | null }> = [];

      for (const step of steps) {
        if (!step.title?.trim()) continue;

        // Compute dedup hash (match the index predicate: WHERE execution_status != 'dismissed')
        const upsertResult = await dbQuery(
          `WITH input AS (
             SELECT $1::uuid AS ws_id, $2::uuid AS d_id, $3::text AS ttl,
                    $4::text AS src, $5::text AS cat, $6::text AS crm_action
           )
           INSERT INTO actions (
             workspace_id, target_deal_id, action_type, severity,
             title, summary, source, category, suggested_crm_action,
             dedup_hash, execution_status, source_skill
           )
           SELECT ws_id, d_id, 'next_step', 'info',
                  ttl, ttl, src, cat, crm_action,
                  md5(ws_id::text || '::' || d_id::text || '::' || ttl),
                  'open', 'recommended_next_steps'
           FROM input
           ON CONFLICT (workspace_id, dedup_hash) WHERE execution_status != 'dismissed' AND dedup_hash IS NOT NULL
           DO UPDATE SET updated_at = now()
           RETURNING id, title, source, suggested_crm_action`,
          [
            workspaceId,
            dealId,
            step.title.trim(),
            step.source || 'client_rule',
            step.category || null,
            step.suggested_crm_action || 'task_create',
          ]
        );

        if (upsertResult.rows.length > 0) {
          results.push({
            id: upsertResult.rows[0].id,
            title: upsertResult.rows[0].title,
            priority: step.priority || 'P1',
            source: upsertResult.rows[0].source,
            suggested_crm_action: upsertResult.rows[0].suggested_crm_action,
          });
        }
      }

      res.json({ actions: results });
    } catch (err) {
      console.error('[Actions Sync API]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

/**
 * GET /api/workspaces/:workspaceId/deals/:dealId/actions/next-steps
 *
 * Returns persisted open next-step actions for a deal (source = next_step pattern).
 * Used on page load to check if sync is needed.
 */
router.get(
  '/:workspaceId/deals/:dealId/actions/next-steps',
  async (req: Request<WorkspaceParams & { dealId: string }>, res: Response) => {
    try {
      const { workspaceId, dealId } = req.params;

      const result = await dbQuery(
        `SELECT id, title, source, category, suggested_crm_action, created_at
         FROM actions
         WHERE workspace_id = $1
           AND target_deal_id = $2
           AND action_type = 'next_step'
           AND execution_status = 'open'
         ORDER BY created_at ASC`,
        [workspaceId, dealId]
      );

      res.json({ actions: result.rows });
    } catch (err) {
      console.error('[Next Steps API]', err);
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

function buildEvidenceFromSignals(signals: any): Evidence[] {
  const evidence: Evidence[] = [];

  if (signals.keyword_matches && Array.isArray(signals.keyword_matches)) {
    evidence.push({
      label: 'Keywords Detected',
      value: signals.keyword_matches.join(', '),
      signal_type: 'keyword',
    });
  }

  if (signals.conversation_count) {
    evidence.push({
      label: 'Conversation Activity',
      value: `${signals.conversation_count} conversations analyzed`,
      signal_type: 'conversation',
    });
  }

  if (signals.last_conversation_date) {
    evidence.push({
      label: 'Last Activity',
      value: new Date(signals.last_conversation_date).toLocaleDateString(),
      signal_type: 'timing',
    });
  }

  return evidence.slice(0, 3); // Max 3 evidence items
}

// ---------------------------------------------------------------------------
// POST /:workspaceId/suggested-actions/sync
// Persist ephemeral suggested actions (from Ask Pandora extractor) to DB so
// ActionCard can call /actions/:id/execute-inline and /actions/:id/dismiss.
// Returns ActionCardItem[] with real DB ids.
// ---------------------------------------------------------------------------
router.post('/:workspaceId/suggested-actions/sync', async (req: Request, res: Response) => {
  const { workspaceId } = req.params as { workspaceId: string };
  console.log('[SuggestedActions] sync called for workspace:', workspaceId, 'actions:', (req.body as any)?.actions?.length ?? 0);
  const { actions } = req.body as {
    actions: Array<{
      id: string;
      type: string;
      title: string;
      description?: string;
      evidence?: string;
      priority: 'P1' | 'P2' | 'P3';
      deal_id?: string;
      execution_mode?: string;
      action_payload?: Record<string, unknown>;
    }>;
  };

  if (!Array.isArray(actions) || actions.length === 0) {
    return res.json({ cards: [] });
  }

  const cards: Array<{
    id: string;
    title: string;
    priority: 'P0' | 'P1' | 'P2';
    source: string;
    suggested_crm_action: 'task_create' | 'note_create' | 'field_write' | null;
    action_type?: string;
    skill_id?: string;
  }> = [];

  for (const action of actions.slice(0, 6)) {
    const cardPriority: 'P0' | 'P1' | 'P2' =
      action.priority === 'P1' ? 'P0' :
      action.priority === 'P2' ? 'P1' : 'P2';

    const INTERNAL_TYPES = [
      'update_data_dictionary',
      'update_workspace_knowledge',
      'confirm_metric_definition',
      'update_calibration',
      'run_skill',
    ];

    const crmAction: 'task_create' | 'field_write' | null =
      action.type === 'update_forecast_category' || action.type === 'update_close_date'
        ? 'field_write'
        : INTERNAL_TYPES.includes(action.type)
          ? null
          : 'task_create';

    const source =
      action.type === 'run_meddic_coverage' ? 'meddic' :
      action.type === 'run_skill' ? 'dossier' :
      INTERNAL_TYPES.includes(action.type) ? 'pandora_internal' :
      'dossier';

    const dedupInput = `${workspaceId}:suggested:${action.type}:${action.title}`;
    const dedupHash = createHash('sha256').update(dedupInput).digest('hex').slice(0, 32);
    const summary = action.description || action.evidence || action.title;

    const actionAny = action as any;
    const sourceSkill =
      action.type === 'run_skill' ? (actionAny.action_payload?.skill_id as string | undefined) || action.type :
      action.type === 'run_meddic_coverage' ? 'meddic-coverage' :
      action.type;

    const storedActionType = INTERNAL_TYPES.includes(action.type) ? action.type : 'next_step';
    const executionPayload = INTERNAL_TYPES.includes(action.type) && action.action_payload
      ? JSON.stringify(action.action_payload)
      : null;

    try {
      const result = await dbQuery(
        `INSERT INTO actions (
           workspace_id, action_type, severity, title, summary,
           source, priority, suggested_crm_action, dedup_hash,
           execution_status, target_deal_id, source_skill, execution_payload
         ) VALUES ($1, $2, 'info', $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11)
         ON CONFLICT (workspace_id, dedup_hash)
           WHERE execution_status != 'dismissed' AND dedup_hash IS NOT NULL
         DO UPDATE SET
           title = EXCLUDED.title,
           summary = EXCLUDED.summary,
           execution_payload = COALESCE(EXCLUDED.execution_payload, actions.execution_payload),
           updated_at = now()
         RETURNING id`,
        [
          workspaceId,
          storedActionType,
          action.title,
          summary,
          source,
          cardPriority,
          crmAction,
          dedupHash,
          action.deal_id || null,
          sourceSkill,
          executionPayload,
        ]
      );

      if (result.rows[0]) {
        const card: Record<string, unknown> = {
          id: result.rows[0].id,
          title: action.title,
          priority: cardPriority,
          source,
          suggested_crm_action: crmAction,
          action_type: storedActionType,
        };
        if (INTERNAL_TYPES.includes(action.type) && action.action_payload) {
          card.payload = action.action_payload;
        }
        cards.push(card as any);
      }
    } catch (err) {
      console.error('[SuggestedActions] Failed to persist action:', (err as Error).message);
    }
  }

  return res.json({ cards });
});

/**
 * POST /api/workspaces/:workspaceId/actions/assign-to-rep
 *
 * Creates a task-assignment action for a deal and executes it immediately.
 * Resolves the deal owner, creates an action record, and executes via the
 * existing executor (CRM note if no PM tool connected).
 */
router.post(
  '/:workspaceId/actions/assign-to-rep',
  requireWorkspaceAccess,
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;
    const userId      = (req as any).user?.user_id as string;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { dealId, taskTitle, taskNote, dueDate } = req.body as {
      dealId: string;
      taskTitle?: string;
      taskNote?: string;
      dueDate?: string; // ISO date string, defaults to tomorrow
    };

    if (!dealId) {
      return res.status(400).json({ error: 'dealId is required' });
    }

    try {
      // 1. Load the deal to resolve owner
      const dealResult = await dbQuery(
        `SELECT id, name, amount, owner_email, stage_normalized, source, source_id, external_id
         FROM deals WHERE id = $1 AND workspace_id = $2`,
        [dealId, workspaceId]
      );

      if (dealResult.rows.length === 0) {
        return res.status(404).json({ error: 'Deal not found' });
      }

      const deal = dealResult.rows[0];
      const assigneeEmail: string = deal.owner_email ?? '';

      // 2. Resolve workspace member for the owner email
      const memberResult = await dbQuery(
        `SELECT u.id, u.name, u.email
         FROM users u
         JOIN workspace_members wm ON wm.user_id = u.id
         WHERE wm.workspace_id = $1 AND u.email = $2
         LIMIT 1`,
        [workspaceId, assigneeEmail]
      );
      const assignedUser = memberResult.rows[0] ?? null;

      // 3. Resolve acting user email for audit
      const actorResult = await dbQuery(
        `SELECT email FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const actorEmail: string = actorResult.rows[0]?.email ?? 'system';

      // 4. Build the task payload
      const resolvedTitle = taskTitle || `Follow up on ${deal.name}`;
      const resolvedNote  = taskNote  || `Task assigned by Pandora — deal: ${deal.name}`;
      const resolvedDue   = dueDate   || new Date(Date.now() + 86400000).toISOString().split('T')[0];

      const executionPayload = {
        deal_id: dealId,
        deal_name: deal.name,
        task_title: resolvedTitle,
        task_note: resolvedNote,
        due_date: resolvedDue,
        assignee_email: assigneeEmail,
        assignee_user_id: assignedUser?.id ?? null,
        crm_updates: [],
        // Fallback CRM note body if no PM tool
        crm_note_body: `Pandora: ${resolvedTitle} — ${resolvedNote} (due ${resolvedDue})`,
      };

      // 5. Insert the action record
      const insertResult = await dbQuery(
        `INSERT INTO actions (
           workspace_id, action_type, title, summary,
           target_deal_id, target_entity_name,
           severity, approval_status, execution_status,
           execution_payload, source_skill, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
         RETURNING id`,
        [
          workspaceId,
          'assign_to_rep',
          resolvedTitle,
          resolvedNote,
          dealId,
          deal.name,
          'info',
          'approved',
          'open',
          JSON.stringify(executionPayload),
          'concierge',
        ]
      );

      const actionId: string = insertResult.rows[0].id;

      // 6. Execute immediately (bypass judgment — user explicitly triggered this)
      const execResult = await executeAction(dbPool, {
        actionId,
        workspaceId,
        actor: actorEmail,
        bypassJudgment: true,
      });

      res.json({
        ok: true,
        actionId,
        assignedTo: assigneeEmail || null,
        taskCreated: execResult.success,
        operations: execResult.operations,
      });
    } catch (err) {
      console.error('[assign-to-rep]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

export default router;
