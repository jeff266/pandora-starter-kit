import { query } from '../db.js';
import { estimateTradeoffs, type AgentConfig } from './tradeoffs.js';

export interface Conflict {
  type: 'TIME_OVERLAP' | 'CONTENT_OVERLAP' | 'VOLUME_CONFLICT' | 'HARD_CAP';
  severity: 'warning' | 'info' | 'error';
  agent_name: string;
  message: string;
  suggestion: string;
}

function parseCronDays(schedule: string): number[] {
  const parts = schedule.trim().split(/\s+/);
  const dayField = parts[4] ?? '*';
  if (dayField === '*') return [0, 1, 2, 3, 4, 5, 6];
  return dayField.split(',').map(Number).filter(n => !isNaN(n));
}

function parseCronHour(schedule: string): number {
  const parts = schedule.trim().split(/\s+/);
  const hourField = parts[1] ?? '0';
  return parseInt(hourField.split(',')[0] ?? '0', 10);
}

function daysOverlap(a: number[], b: number[]): boolean {
  return a.some(d => b.includes(d));
}

export async function detectConflicts(
  workspaceId: string,
  newConfig: AgentConfig & { name?: string },
  excludeAgentId?: string
): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];

  // Hard cap: max 20 agents per workspace
  const countResult = await query<{ cnt: string }>(
    'SELECT COUNT(*)::text AS cnt FROM agents WHERE workspace_id = $1',
    [workspaceId]
  ).catch(() => ({ rows: [{ cnt: '0' }] }));
  const totalAgents = parseInt(countResult.rows[0]?.cnt ?? '0', 10);
  if (!excludeAgentId && totalAgents >= 20) {
    conflicts.push({
      type: 'HARD_CAP',
      severity: 'error',
      agent_name: '',
      message: 'Workspace has reached the 20-agent limit.',
      suggestion: 'Delete or deactivate existing agents before creating new ones.',
    });
  }

  if (!newConfig.channel_id) return conflicts;

  const params: any[] = [workspaceId, newConfig.channel_id];
  const excludeClause = excludeAgentId ? ` AND a.id != $${params.push(excludeAgentId)}` : '';

  const activeResult = await query<{
    id: string; name: string; skill_ids: string[];
    estimated_deliveries_per_week: number | null;
    trigger_config: any;
  }>(
    `SELECT a.id, a.name, a.skill_ids, a.estimated_deliveries_per_week,
            dr.trigger_config
     FROM agents a
     JOIN delivery_rules dr ON dr.id = a.delivery_rule_id
     WHERE a.workspace_id = $1
       AND dr.channel_id = $2
       AND a.is_active = true${excludeClause}`,
    params
  ).catch(() => ({ rows: [] as any[] }));

  const existing = activeResult.rows;

  // Hard cap: max 5 agents on same channel
  if (existing.length >= 5) {
    conflicts.push({
      type: 'HARD_CAP',
      severity: 'error',
      agent_name: '',
      message: 'This channel already has 5 agents delivering today.',
      suggestion: 'Use a dedicated channel or consolidate agents.',
    });
  }

  for (const agent of existing) {
    const agentTc = agent.trigger_config as { type?: string; schedule?: string } || {};

    // TIME_OVERLAP
    if (newConfig.trigger_config.type === 'cron' && newConfig.trigger_config.schedule &&
        agentTc.type === 'cron' && agentTc.schedule) {
      const newDays = parseCronDays(newConfig.trigger_config.schedule);
      const agentDays = parseCronDays(agentTc.schedule);
      if (daysOverlap(newDays, agentDays)) {
        const newHour = parseCronHour(newConfig.trigger_config.schedule);
        const agentHour = parseCronHour(agentTc.schedule);
        const gap = Math.abs(newHour - agentHour);
        if (gap < 1) {
          conflicts.push({
            type: gap === 0 ? 'HARD_CAP' : 'TIME_OVERLAP',
            severity: gap === 0 ? 'error' : 'warning',
            agent_name: agent.name,
            message: `${agent.name} also fires at the same time on this channel.`,
            suggestion: 'Stagger by at least 1 hour or merge into one agent.',
          });
        }
      }
    }

    // CONTENT_OVERLAP
    const shared = (agent.skill_ids ?? []).filter((s: string) =>
      newConfig.skill_ids.includes(s)
    );
    if (shared.length > 0) {
      conflicts.push({
        type: 'CONTENT_OVERLAP',
        severity: 'warning',
        agent_name: agent.name,
        message: `${agent.name} also includes [${shared.join(', ')}] and delivers to the same channel.`,
        suggestion: 'Remove duplicate skills or route to different channels.',
      });
    }
  }

  // VOLUME_CONFLICT
  const existingDeliveries = existing.reduce(
    (sum: number, a: any) => sum + (a.estimated_deliveries_per_week ?? 1), 0
  );
  let newDeliveries = 1;
  try {
    const est = await estimateTradeoffs(workspaceId, newConfig);
    newDeliveries = est.deliveries_per_week;
  } catch { /* use default */ }
  const total = existingDeliveries + newDeliveries;
  if (total > 20) {
    conflicts.push({
      type: 'VOLUME_CONFLICT',
      severity: 'warning',
      agent_name: '',
      message: `Combined with existing agents, this channel will receive ~${Math.round(total)} deliveries/week — above the recommended 20/week threshold.`,
      suggestion: 'Reduce frequency, increase max_findings to batch more per delivery, or use a dedicated channel.',
    });
  }

  return conflicts;
}
