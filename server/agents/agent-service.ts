import { query } from '../db.js';
import { AGENT_TEMPLATES, type AgentTemplate } from './templates.js';
import { estimateTradeoffs, type AgentConfig, type TriggerConfig, type FilterConfig } from './tradeoffs.js';
import { detectConflicts } from './conflicts.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  icon?: string;
  skill_ids: string[];
  trigger_config: TriggerConfig;
  filter_config: FilterConfig;
  template_format?: string;
  channel_id?: string;
  is_active?: boolean;
  template_id?: string;
}

export interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  template_id: string | null;
  icon: string;
  skill_ids: string[];
  focus_config: Record<string, any>;
  delivery_rule_id: string | null;
  estimated_tokens_per_week: number | null;
  estimated_deliveries_per_week: number | null;
  estimated_findings_per_delivery: number | null;
  fatigue_score: number | null;
  focus_score: number | null;
  is_active: boolean;
  is_template: boolean;
  last_run_at: string | null;
  total_deliveries: number;
  total_findings_delivered: number;
  created_at: string;
  updated_at: string;
}

export interface AgentPerformance {
  agent_id: string;
  total_deliveries: number;
  successful_deliveries: number;
  total_findings_delivered: number;
  avg_findings_per_delivery: number;
  last_delivered_at: string | null;
  deliveries_by_day: { day: string; count: number }[];
  success_rate: number;
}

async function verifyChannel(workspaceId: string, channelId: string): Promise<void> {
  const result = await query(
    'SELECT id FROM delivery_channels WHERE id = $1 AND workspace_id = $2',
    [channelId, workspaceId]
  );
  if (result.rows.length === 0) {
    throw new Error('Channel not found or does not belong to this workspace');
  }
}

export async function createAgent(workspaceId: string, input: CreateAgentInput): Promise<Agent> {
  if (!input.skill_ids || input.skill_ids.length === 0) {
    throw new Error('skill_ids must not be empty');
  }
  if (input.channel_id) {
    await verifyChannel(workspaceId, input.channel_id);
  }

  const agentConfig: AgentConfig = {
    skill_ids: input.skill_ids,
    trigger_config: input.trigger_config,
    filter_config: input.filter_config,
    channel_id: input.channel_id,
  };

  const hardConflicts = (await detectConflicts(workspaceId, { ...agentConfig, name: input.name }))
    .filter(c => c.type === 'HARD_CAP');
  if (hardConflicts.length > 0) {
    throw new Error(hardConflicts[0].message);
  }

  const tradeoffs = await estimateTradeoffs(workspaceId, agentConfig);

  let deliveryRuleId: string | null = null;
  if (input.channel_id) {
    const ruleResult = await query<{ id: string }>(
      `INSERT INTO delivery_rules
         (workspace_id, channel_id, name, trigger_type, trigger_config, filter_config, template, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        workspaceId,
        input.channel_id,
        input.name,
        input.trigger_config.type,
        JSON.stringify(input.trigger_config),
        JSON.stringify(input.filter_config),
        input.template_format || 'standard',
        input.is_active ?? false,
      ]
    );
    deliveryRuleId = ruleResult.rows[0].id;
  }

  const agentResult = await query<Agent>(
    `INSERT INTO agents
       (workspace_id, name, description, icon, template_id, skill_ids, delivery_rule_id,
        estimated_tokens_per_week, estimated_deliveries_per_week, estimated_findings_per_delivery,
        fatigue_score, focus_score, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      workspaceId,
      input.name,
      input.description ?? null,
      input.icon ?? '🤖',
      input.template_id ?? null,
      input.skill_ids,
      deliveryRuleId,
      tradeoffs.tokens_per_week,
      tradeoffs.deliveries_per_week,
      tradeoffs.findings_per_delivery,
      tradeoffs.fatigue_score,
      tradeoffs.focus_score,
      input.is_active ?? false,
    ]
  );
  return agentResult.rows[0];
}

export async function updateAgent(
  agentId: string,
  workspaceId: string,
  input: Partial<CreateAgentInput>
): Promise<Agent> {
  const existing = await getAgent(agentId, workspaceId);
  if (!existing) throw new Error('Agent not found');

  const merged: CreateAgentInput = {
    name: input.name ?? existing.name,
    description: input.description ?? existing.description ?? undefined,
    icon: input.icon ?? existing.icon,
    skill_ids: input.skill_ids ?? existing.skill_ids,
    trigger_config: input.trigger_config ?? ({ type: 'cron' } as TriggerConfig),
    filter_config: input.filter_config ?? {},
    channel_id: input.channel_id,
    is_active: input.is_active ?? existing.is_active,
  };

  const agentConfig: AgentConfig = {
    skill_ids: merged.skill_ids,
    trigger_config: merged.trigger_config,
    filter_config: merged.filter_config,
    channel_id: merged.channel_id,
  };

  const tradeoffs = await estimateTradeoffs(workspaceId, agentConfig);
  await detectConflicts(workspaceId, { ...agentConfig, name: merged.name }, agentId);

  if (existing.delivery_rule_id && merged.channel_id) {
    await query(
      `UPDATE delivery_rules SET
         name=$1, trigger_type=$2, trigger_config=$3, filter_config=$4,
         template=$5, is_active=$6, updated_at=NOW()
       WHERE id=$7`,
      [
        merged.name,
        merged.trigger_config.type,
        JSON.stringify(merged.trigger_config),
        JSON.stringify(merged.filter_config),
        merged.template_format || 'standard',
        merged.is_active,
        existing.delivery_rule_id,
      ]
    );
  }

  const result = await query<Agent>(
    `UPDATE agents SET
       name=$1, description=$2, icon=$3, skill_ids=$4,
       estimated_tokens_per_week=$5, estimated_deliveries_per_week=$6,
       estimated_findings_per_delivery=$7, fatigue_score=$8, focus_score=$9,
       is_active=$10, updated_at=NOW()
     WHERE id=$11 AND workspace_id=$12
     RETURNING *`,
    [
      merged.name, merged.description ?? null, merged.icon, merged.skill_ids,
      tradeoffs.tokens_per_week, tradeoffs.deliveries_per_week,
      tradeoffs.findings_per_delivery, tradeoffs.fatigue_score, tradeoffs.focus_score,
      merged.is_active, agentId, workspaceId,
    ]
  );
  return result.rows[0];
}

export async function deleteAgent(agentId: string, workspaceId: string): Promise<void> {
  const agent = await getAgent(agentId, workspaceId);
  if (!agent) throw new Error('Agent not found');
  await query('DELETE FROM agents WHERE id=$1 AND workspace_id=$2', [agentId, workspaceId]);
  if (agent.delivery_rule_id) {
    await query('DELETE FROM delivery_rules WHERE id=$1', [agent.delivery_rule_id]).catch(() => {});
  }
}

export async function toggleAgent(
  agentId: string,
  workspaceId: string,
  isActive: boolean
): Promise<Agent> {
  const result = await query<Agent>(
    `UPDATE agents SET is_active=$1, updated_at=NOW()
     WHERE id=$2 AND workspace_id=$3 RETURNING *`,
    [isActive, agentId, workspaceId]
  );
  if (result.rows.length === 0) throw new Error('Agent not found');
  const agent = result.rows[0];
  if (agent.delivery_rule_id) {
    await query(
      'UPDATE delivery_rules SET is_active=$1, updated_at=NOW() WHERE id=$2',
      [isActive, agent.delivery_rule_id]
    ).catch(() => {});
  }
  return agent;
}

export async function deployTemplate(
  templateId: string,
  workspaceId: string,
  channelId: string | null,
  activateImmediately: boolean
): Promise<Agent> {
  const template = AGENT_TEMPLATES.find(t => t.template_id === templateId);
  if (!template) throw new Error(`Template not found: ${templateId}`);
  if (channelId) {
    await verifyChannel(workspaceId, channelId);
  }
  const input: CreateAgentInput = {
    name: template.name,
    description: template.description,
    icon: template.icon,
    skill_ids: template.skill_ids,
    trigger_config: template.trigger_config as TriggerConfig,
    filter_config: template.filter_config as FilterConfig,
    template_format: template.template_format,
    channel_id: channelId ?? undefined,
    is_active: false,
    template_id: template.template_id,
  };
  let agent = await createAgent(workspaceId, input);
  if (activateImmediately) {
    agent = await toggleAgent(agent.id, workspaceId, true);
  }
  return agent;
}

export async function getAgentPerformance(
  agentId: string,
  workspaceId: string
): Promise<AgentPerformance> {
  const agent = await getAgent(agentId, workspaceId);
  if (!agent) throw new Error('Agent not found');

  if (!agent.delivery_rule_id) {
    return {
      agent_id: agentId,
      total_deliveries: 0,
      successful_deliveries: 0,
      total_findings_delivered: 0,
      avg_findings_per_delivery: 0,
      last_delivered_at: null,
      deliveries_by_day: [],
      success_rate: 0,
    };
  }

  const statsResult = await query<{
    total: string; successful: string; total_findings: string;
    avg_findings: string; last_at: string | null;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status='success')::text AS successful,
       COALESCE(SUM(finding_count),0)::text AS total_findings,
       COALESCE(AVG(finding_count),0)::text AS avg_findings,
       MAX(delivered_at) AS last_at
     FROM delivery_log
     WHERE rule_id=$1 AND delivered_at > NOW() - INTERVAL '30 days'`,
    [agent.delivery_rule_id]
  );

  const byDayResult = await query<{ day: string; cnt: string }>(
    `SELECT DATE(delivered_at)::text AS day, COUNT(*)::text AS cnt
     FROM delivery_log
     WHERE rule_id=$1 AND delivered_at > NOW() - INTERVAL '30 days'
     GROUP BY day ORDER BY day`,
    [agent.delivery_rule_id]
  );

  const stats = statsResult.rows[0] ?? { total: '0', successful: '0', total_findings: '0', avg_findings: '0', last_at: null };
  const total = parseInt(stats.total, 10);
  const successful = parseInt(stats.successful, 10);

  return {
    agent_id: agentId,
    total_deliveries: total,
    successful_deliveries: successful,
    total_findings_delivered: parseInt(stats.total_findings, 10),
    avg_findings_per_delivery: Math.round(parseFloat(stats.avg_findings) * 10) / 10,
    last_delivered_at: stats.last_at,
    deliveries_by_day: byDayResult.rows.map(r => ({ day: r.day, count: parseInt(r.cnt, 10) })),
    success_rate: total > 0 ? Math.round((successful / total) * 100) : 0,
  };
}

export async function listAgents(
  workspaceId: string,
  activeFilter?: boolean | null
): Promise<Agent[]> {
  let whereClause = 'WHERE workspace_id=$1';
  const params: any[] = [workspaceId];
  if (activeFilter === true) { whereClause += ' AND is_active=true'; }
  else if (activeFilter === false) { whereClause += ' AND is_active=false'; }
  const result = await query<Agent>(
    `SELECT * FROM agents ${whereClause} ORDER BY created_at DESC`,
    params
  );
  return result.rows;
}

export async function getAgent(agentId: string, workspaceId: string): Promise<Agent | null> {
  const result = await query<Agent>(
    'SELECT * FROM agents WHERE id=$1 AND workspace_id=$2',
    [agentId, workspaceId]
  );
  return result.rows[0] ?? null;
}
