/**
 * Push API — Finding Assembler
 *
 * Queries the findings table based on a delivery rule's filter_config.
 * Only returns NEW findings since the rule's last delivery.
 * Joins deals table for amount/score-based filters.
 */

import { query } from '../db.js';

export interface AssembledFinding {
  id: string;
  skill_id: string;
  skill_run_id: string;
  severity: string;
  category: string;
  message: string;
  deal_id: string | null;
  deal_name: string | null;
  deal_amount: number | null;
  deal_owner: string | null;
  ai_score: number | null;
  account_id: string | null;
  owner_email: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface FilterConfig {
  skill_ids?: string[];
  severities?: string[];       // accepts 'critical'/'warning'/'info' or 'act'/'watch'/'notable'/'info'
  categories?: string[];
  min_amount?: number;
  score_below?: number;
  score_above?: number;
  max_findings?: number;
  include_resolved?: boolean;
}

export interface DeliveryRuleRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  name: string;
  filter_config: FilterConfig;
  template: string;
  last_delivery_at: string | null;
  last_triggered_at: string | null;
  trigger_type: string;
  trigger_config: Record<string, any>;
  consecutive_failures: number;
  is_active: boolean;
}

// Map spec-style severity names to DB values
function mapSeverities(severities: string[]): string[] {
  const mapped: string[] = [];
  for (const s of severities) {
    switch (s) {
      case 'critical': mapped.push('act'); break;
      case 'warning':  mapped.push('watch', 'notable'); break;
      case 'info':     mapped.push('info'); break;
      // Already DB values — pass through
      case 'act':      mapped.push('act'); break;
      case 'watch':    mapped.push('watch'); break;
      case 'notable':  mapped.push('notable'); break;
      default:         mapped.push(s);
    }
  }
  return [...new Set(mapped)];
}

export async function assembleFindingsForRule(
  rule: DeliveryRuleRow,
  workspaceId: string
): Promise<AssembledFinding[]> {
  const filter = rule.filter_config || {};
  const maxFindings = filter.max_findings ?? 20;
  const sinceDate = rule.last_delivery_at
    ? new Date(rule.last_delivery_at).toISOString()
    : null;

  const params: any[] = [workspaceId];
  const conditions: string[] = ['f.workspace_id = $1'];

  // Only unresolved (unless include_resolved)
  if (!filter.include_resolved) {
    conditions.push('f.resolved_at IS NULL');
  }

  // Only new since last delivery
  if (sinceDate) {
    params.push(sinceDate);
    conditions.push(`f.created_at > $${params.length}`);
  }

  // Severity filter (map spec names → DB names)
  if (filter.severities && filter.severities.length > 0) {
    const dbSeverities = mapSeverities(filter.severities);
    params.push(dbSeverities);
    conditions.push(`f.severity = ANY($${params.length}::text[])`);
  }

  // Skill filter
  if (filter.skill_ids && filter.skill_ids.length > 0) {
    params.push(filter.skill_ids);
    conditions.push(`f.skill_id = ANY($${params.length}::text[])`);
  }

  // Category filter
  if (filter.categories && filter.categories.length > 0) {
    params.push(filter.categories);
    conditions.push(`f.category = ANY($${params.length}::text[])`);
  }

  // Min deal amount
  if (filter.min_amount !== undefined) {
    params.push(filter.min_amount);
    conditions.push(`COALESCE(d.amount::numeric, 0) >= $${params.length}`);
  }

  // Score filters (join to deals)
  if (filter.score_below !== undefined) {
    params.push(filter.score_below);
    conditions.push(`d.ai_score < $${params.length}`);
  }
  if (filter.score_above !== undefined) {
    params.push(filter.score_above);
    conditions.push(`d.ai_score > $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  params.push(maxFindings);
  const limitParam = `$${params.length}`;

  const sql = `
    SELECT
      f.id,
      f.skill_id,
      f.skill_run_id,
      f.severity,
      f.category,
      f.message,
      f.deal_id,
      f.account_id,
      f.owner_email,
      f.metadata,
      f.created_at,
      d.name   AS deal_name,
      d.amount AS deal_amount,
      d.owner  AS deal_owner,
      d.ai_score
    FROM findings f
    LEFT JOIN deals d ON d.id = f.deal_id AND d.workspace_id = f.workspace_id
    WHERE ${whereClause}
    ORDER BY
      CASE f.severity
        WHEN 'act'     THEN 1
        WHEN 'watch'   THEN 2
        WHEN 'notable' THEN 3
        WHEN 'info'    THEN 4
        ELSE 5
      END,
      COALESCE(d.amount::numeric, 0) DESC,
      f.created_at DESC
    LIMIT ${limitParam}
  `;

  const result = await query<any>(sql, params);

  return result.rows.map((r: any) => ({
    id: r.id,
    skill_id: r.skill_id,
    skill_run_id: r.skill_run_id,
    severity: r.severity,
    category: r.category,
    message: r.message,
    deal_id: r.deal_id,
    deal_name: r.deal_name,
    deal_amount: r.deal_amount !== null ? parseFloat(r.deal_amount) : null,
    deal_owner: r.deal_owner,
    ai_score: r.ai_score,
    account_id: r.account_id,
    owner_email: r.owner_email,
    metadata: r.metadata || {},
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}
