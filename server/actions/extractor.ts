/**
 * Action Extractor
 *
 * Extracts <actions> blocks from Claude synthesis output and inserts into actions table.
 * Handles supersession logic to prevent duplicate actions for the same target entity.
 */

import type { Pool } from 'pg';

export interface ExtractedAction {
  action_type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  summary?: string;
  recommended_steps?: string[];
  target_deal_name?: string;
  target_deal_id?: string;
  target_account_name?: string;
  target_account_id?: string;
  owner_email?: string;
  impact_amount?: number;
  urgency_label?: string;
  urgency_days_stale?: number;
  execution_payload?: {
    crm_updates?: Array<{ field: string; proposed_value: any }>;
    note_text?: string;
  };
}

/**
 * Extract <actions> block from Claude synthesis output.
 * Returns empty array if no actions block found (graceful).
 */
export function parseActionsFromOutput(synthesisOutput: string): ExtractedAction[] {
  // Look for <actions>...</actions> block
  const actionsMatch = synthesisOutput.match(/<actions>([\s\S]*?)<\/actions>/);
  if (!actionsMatch) return [];

  try {
    const parsed = JSON.parse(actionsMatch[1].trim());
    if (!Array.isArray(parsed)) return [];

    // Validate each action has required fields
    return parsed.filter((a: any) =>
      a.action_type && a.title && a.severity
    );
  } catch (err) {
    console.warn('[Actions Extractor] Failed to parse <actions> block:', err);
    return [];
  }
}

/**
 * Insert extracted actions into the actions table.
 * Supersedes open actions from the same skill + target entity.
 */
export async function insertExtractedActions(
  db: Pool,
  workspaceId: string,
  skillId: string,
  skillRunId: string,
  agentRunId: string | null,
  actions: ExtractedAction[]
): Promise<number> {
  if (actions.length === 0) return 0;

  let inserted = 0;

  for (const action of actions) {
    try {
      // Resolve target entity IDs if names provided but IDs missing
      let dealId = action.target_deal_id || null;
      let accountId = action.target_account_id || null;

      if (!dealId && action.target_deal_name) {
        const dealResult = await db.query(
          `SELECT id FROM deals WHERE workspace_id = $1 AND name ILIKE $2 LIMIT 1`,
          [workspaceId, `%${action.target_deal_name}%`]
        );
        dealId = dealResult.rows[0]?.id || null;
      }

      if (!accountId && action.target_account_name) {
        const acctResult = await db.query(
          `SELECT id FROM accounts WHERE workspace_id = $1 AND name ILIKE $2 LIMIT 1`,
          [workspaceId, `%${action.target_account_name}%`]
        );
        accountId = acctResult.rows[0]?.id || null;
      }

      // Supersede existing open actions for same skill + target
      if (dealId) {
        await db.query(`
          UPDATE actions
          SET execution_status = 'superseded',
              dismissed_reason = 'superseded',
              updated_at = now()
          WHERE workspace_id = $1
            AND source_skill = $2
            AND target_deal_id = $3
            AND execution_status = 'open'
        `, [workspaceId, skillId, dealId]);
      }

      const metadata: Record<string, any> = {};
      if (agentRunId) metadata.agent_run_id = agentRunId;
      if (action.urgency_days_stale) metadata.urgency_days_stale = action.urgency_days_stale;
      if (action.execution_payload?.crm_updates) metadata.crm_updates = action.execution_payload.crm_updates;

      const result = await db.query(`
        INSERT INTO actions (
          workspace_id, source_run_id, source_skill,
          action_type, severity, title, summary, recommended_steps,
          target_entity_name, target_deal_id, target_account_id,
          owner_email, impact_amount, urgency_label,
          execution_payload, metadata
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6, $7, $8,
          $9, $10, $11,
          $12, $13, $14,
          $15, $16
        ) RETURNING id
      `, [
        workspaceId, skillRunId, skillId,
        action.action_type, action.severity, action.title,
        action.summary || null,
        action.recommended_steps ? JSON.stringify(action.recommended_steps) : null,
        action.target_deal_name || action.target_account_name || null,
        dealId, accountId, action.owner_email || null,
        action.impact_amount || null, action.urgency_label || null,
        action.execution_payload ? JSON.stringify(action.execution_payload) : null,
        Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      ]);

      // Audit log: created
      await db.query(`
        INSERT INTO action_audit_log (workspace_id, action_id, event_type, actor, to_status)
        VALUES ($1, $2, 'created', 'system', 'open')
      `, [workspaceId, result.rows[0].id]);

      inserted++;
    } catch (err) {
      console.error(`[Actions Extractor] Failed to insert action "${action.title}":`, err);
      // Continue with remaining actions
    }
  }

  console.log(`[Actions Extractor] Inserted ${inserted}/${actions.length} actions for ${skillId}`);
  return inserted;
}
