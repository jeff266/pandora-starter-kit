import { createHash } from 'crypto';
import { query } from '../../db.js';

export interface McpToolInput {
  save?: boolean;
  [key: string]: any;
}

export interface McpToolResult {
  data?: any;
  saved: boolean;
  save_location?: string;
  insight_id?: string | null;
}

export async function maybeAutoSave(
  workspaceId: string,
  toolName: string,
  insightText: string,
  insightType: string,
  severity: string,
  triggerQuery: string,
  entityType?: string,
  entityId?: string,
  entityName?: string,
  save: boolean = true
): Promise<string | null> {
  if (!save || !insightText?.trim()) return null;

  const contentHash = createHash('md5').update(insightText.trim()).digest('hex');

  try {
    const result = await query(
      `INSERT INTO claude_insights
         (workspace_id, insight_text, insight_type, severity,
          trigger_surface, tool_name, entity_type, entity_id,
          entity_name, content_hash, trigger_query)
       VALUES ($1,$2,$3,$4,'mcp',$5,$6,$7,$8,$9,$10)
       ON CONFLICT (workspace_id, content_hash) DO NOTHING
       RETURNING id`,
      [
        workspaceId,
        insightText.slice(0, 4000),
        insightType,
        severity,
        toolName,
        entityType ?? null,
        entityId ?? null,
        entityName ?? null,
        contentHash,
        triggerQuery ?? null,
      ]
    );
    return result.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

export function mapSkillToInsightType(skillId: string): string {
  if (skillId.includes('pipeline')) return 'pipeline';
  if (skillId.includes('forecast')) return 'forecast';
  if (skillId.includes('rep') || skillId.includes('coaching')) return 'rep';
  if (skillId.includes('deal')) return 'deal';
  if (skillId.includes('icp') || skillId.includes('strategy')) return 'strategic';
  if (skillId.includes('competitive')) return 'competitive';
  if (skillId.includes('conversation') || skillId.includes('voice')) return 'coaching';
  return 'process';
}

export function getTopSeverity(claims: any[]): string {
  if (!Array.isArray(claims)) return 'info';
  if (claims.some((c: any) => c.severity === 'critical' || c.severity === 'act')) return 'critical';
  if (claims.some((c: any) => c.severity === 'warning' || c.severity === 'watch')) return 'warning';
  return 'info';
}

const CHECKPOINT_TOOLS = new Set([
  'run_pipeline_hygiene', 'run_forecast_rollup',
  'run_deal_risk_review', 'run_rep_scorecard',
  'run_deliberation', 'run_skill',
  'run_conversation_intelligence', 'run_icp_discovery',
  'run_competitive_intelligence', 'run_strategy_insights',
  'run_bowtie_analysis', 'run_monte_carlo',
  'get_pipeline_health', 'get_forecast_rollup',
  'get_concierge_brief',
]);

export function isCheckpointWorthy(toolName: string, result: any): boolean {
  return (
    CHECKPOINT_TOOLS.has(toolName) &&
    (result?.finding_count > 0 || result?.findings?.length > 0)
  );
}
