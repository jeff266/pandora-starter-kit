import { query } from '../db.js';
import { motionService } from './motion-service.js';
import type { Goal, CreateGoalInput, GoalCurrentValue, GoalTree, RevenueMotion } from './types.js';

function buildDealFilter(
  motion: RevenueMotion | null,
  startParamIdx: number,
): { whereClause: string; params: any[] } {
  if (!motion) return { whereClause: '', params: [] };

  const clauses: string[] = [];
  const params: any[] = [];
  let idx = startParamIdx;

  if (motion.pipeline_names && motion.pipeline_names.length > 0) {
    clauses.push(`AND pipeline = ANY($${idx})`);
    params.push(motion.pipeline_names);
    idx++;
  }

  const cf = motion.deal_filters?.custom_field;
  const vals = motion.deal_filters?.values;
  if (cf && Array.isArray(vals) && vals.length > 0) {
    const safeField = cf.replace(/[^a-zA-Z0-9_]/g, '');
    clauses.push(`AND custom_fields->>'${safeField}' = ANY($${idx})`);
    params.push(vals);
    idx++;
  }

  return { whereClause: clauses.join(' '), params };
}

export class GoalService {
  async create(workspaceId: string, input: CreateGoalInput): Promise<Goal> {
    const result = await query<Goal>(
      `INSERT INTO goals
        (workspace_id, metric_type, label, level, parent_goal_id, owner_type, owner_id,
         motion_id, upstream_goal_id, conversion_assumption, target_value, target_unit,
         period, period_start, period_end, source, confidence, inferred_from, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        workspaceId,
        input.metric_type,
        input.label,
        input.level,
        input.parent_goal_id || null,
        input.owner_type,
        input.owner_id,
        input.motion_id || null,
        input.upstream_goal_id || null,
        input.conversion_assumption ?? null,
        input.target_value,
        input.target_unit || 'currency',
        input.period,
        input.period_start,
        input.period_end,
        input.source || 'manual',
        input.confidence ?? 1.0,
        input.inferred_from || null,
        input.is_active !== false,
      ],
    );
    return result.rows[0];
  }

  async update(goalId: string, updates: Partial<Goal>): Promise<Goal> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let idx = 1;

    const fields: Array<keyof Goal> = [
      'metric_type', 'label', 'level', 'parent_goal_id', 'owner_type', 'owner_id',
      'motion_id', 'upstream_goal_id', 'conversion_assumption', 'target_value', 'target_unit',
      'period', 'period_start', 'period_end', 'source', 'confidence', 'inferred_from', 'is_active',
    ];

    for (const field of fields) {
      if (field in updates) {
        setClauses.push(`${field} = $${idx}`);
        values.push((updates as any)[field]);
        idx++;
      }
    }

    values.push(goalId);
    const result = await query<Goal>(
      `UPDATE goals SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0];
  }

  async list(
    workspaceId: string,
    filters?: { is_active?: boolean; motion_id?: string; level?: string; period_start?: string },
  ): Promise<Goal[]> {
    const conditions: string[] = ['workspace_id = $1'];
    const params: any[] = [workspaceId];
    let idx = 2;

    const isActive = filters?.is_active !== false;
    conditions.push(`is_active = $${idx}`);
    params.push(isActive);
    idx++;

    if (filters?.motion_id) {
      conditions.push(`motion_id = $${idx}`);
      params.push(filters.motion_id);
      idx++;
    }
    if (filters?.level) {
      conditions.push(`level = $${idx}`);
      params.push(filters.level);
      idx++;
    }
    if (filters?.period_start) {
      conditions.push(`period_start >= $${idx}`);
      params.push(filters.period_start);
      idx++;
    }

    const result = await query<Goal>(
      `SELECT * FROM goals WHERE ${conditions.join(' AND ')} ORDER BY level, metric_type`,
      params,
    );
    return result.rows;
  }

  async getById(goalId: string): Promise<Goal | null> {
    const result = await query<Goal>(`SELECT * FROM goals WHERE id = $1`, [goalId]);
    return result.rows[0] ?? null;
  }

  async softDelete(goalId: string): Promise<void> {
    await query(`UPDATE goals SET is_active = false, updated_at = NOW() WHERE id = $1`, [goalId]);
  }

  async getTree(workspaceId: string, rootGoalId: string): Promise<GoalTree> {
    const goal = await this.getById(rootGoalId);
    if (!goal) throw new Error(`Goal ${rootGoalId} not found`);

    const [parentResult, childrenResult, upstreamResult, downstreamResult] = await Promise.all([
      goal.parent_goal_id
        ? query<Goal>(`SELECT * FROM goals WHERE id = $1`, [goal.parent_goal_id])
        : Promise.resolve({ rows: [] }),
      query<Goal>(`SELECT * FROM goals WHERE parent_goal_id = $1 AND is_active = true`, [rootGoalId]),
      goal.upstream_goal_id
        ? query<Goal>(`SELECT * FROM goals WHERE id = $1`, [goal.upstream_goal_id])
        : Promise.resolve({ rows: [] }),
      query<Goal>(`SELECT * FROM goals WHERE upstream_goal_id = $1 AND is_active = true`, [rootGoalId]),
    ]);

    return {
      goal,
      parent: parentResult.rows[0],
      children: childrenResult.rows,
      upstream: upstreamResult.rows[0],
      downstream: downstreamResult.rows,
    };
  }

  async inferDownstreamGoals(workspaceId: string, bookingsGoalId: string): Promise<Goal[]> {
    const bookingsGoal = await this.getById(bookingsGoalId);
    if (!bookingsGoal) throw new Error('Goal not found');

    const motion = bookingsGoal.motion_id
      ? await motionService.getById(bookingsGoal.motion_id)
      : null;

    const funnel = motion?.funnel_model;
    if (!funnel || !funnel.win_rate) return [];

    const created: Goal[] = [];

    const pipelineNeeded = bookingsGoal.target_value / funnel.win_rate;
    const pipelineGoal = await this.create(workspaceId, {
      metric_type: 'pipeline',
      label: `${motion?.label || 'Pipeline'} Pipeline Target`,
      level: bookingsGoal.level,
      parent_goal_id: bookingsGoal.parent_goal_id,
      owner_type: bookingsGoal.owner_type,
      owner_id: bookingsGoal.owner_id,
      motion_id: bookingsGoal.motion_id,
      upstream_goal_id: bookingsGoal.id,
      conversion_assumption: funnel.win_rate,
      target_value: Math.round(pipelineNeeded),
      target_unit: 'currency',
      period: bookingsGoal.period,
      period_start: bookingsGoal.period_start,
      period_end: bookingsGoal.period_end,
      source: 'inferred',
      confidence: funnel.source === 'manual' ? 0.9 : 0.7,
      inferred_from: `Derived from $${bookingsGoal.target_value.toLocaleString()} bookings target at ${(funnel.win_rate * 100).toFixed(0)}% win rate`,
      is_active: true,
    } as any);
    created.push(pipelineGoal);

    if (funnel.avg_deal_size > 0) {
      const oppsNeeded = Math.ceil(pipelineNeeded / funnel.avg_deal_size);
      const oppGoal = await this.create(workspaceId, {
        metric_type: 'opportunities',
        label: `${motion?.label || 'Pipeline'} Opportunity Target`,
        level: bookingsGoal.level,
        parent_goal_id: bookingsGoal.parent_goal_id,
        owner_type: bookingsGoal.owner_type,
        owner_id: bookingsGoal.owner_id,
        motion_id: bookingsGoal.motion_id,
        upstream_goal_id: pipelineGoal.id,
        conversion_assumption: funnel.avg_deal_size,
        target_value: oppsNeeded,
        target_unit: 'count',
        period: bookingsGoal.period,
        period_start: bookingsGoal.period_start,
        period_end: bookingsGoal.period_end,
        source: 'inferred',
        confidence: funnel.source === 'manual' ? 0.85 : 0.65,
        inferred_from: `Derived from $${Math.round(pipelineNeeded).toLocaleString()} pipeline target at $${funnel.avg_deal_size.toLocaleString()} avg deal size`,
        is_active: true,
      } as any);
      created.push(oppGoal);
    }

    return created;
  }

  async computeCurrentValue(workspaceId: string, goal: Goal): Promise<GoalCurrentValue> {
    const motion = goal.motion_id ? await motionService.getById(goal.motion_id) : null;
    const baseParams: any[] = [workspaceId];
    const { whereClause, params: filterParams } = buildDealFilter(motion, baseParams.length + 1);
    const allParams = [...baseParams, ...filterParams];

    switch (goal.metric_type) {
      case 'bookings': {
        const periodIdx1 = allParams.length + 1;
        const periodIdx2 = allParams.length + 2;
        allParams.push(goal.period_start, goal.period_end);
        const r = await query<{ current_value: string; deal_count: string }>(
          `SELECT COALESCE(SUM(amount), 0) as current_value, COUNT(*) as deal_count
           FROM deals
           WHERE workspace_id = $1 AND stage_normalized = 'closed_won'
             AND close_date >= $${periodIdx1} AND close_date <= $${periodIdx2}
             ${whereClause}`,
          allParams,
        );
        return {
          current_value: parseFloat(r.rows[0]?.current_value || '0'),
          deal_count: parseInt(r.rows[0]?.deal_count || '0', 10),
          computation_detail: { metric_type: 'bookings', period: `${goal.period_start} to ${goal.period_end}` },
        };
      }

      case 'pipeline': {
        const periodIdx = allParams.length + 1;
        allParams.push(goal.period_end);
        const r = await query<{ current_value: string; deal_count: string }>(
          `SELECT COALESCE(SUM(amount), 0) as current_value, COUNT(*) as deal_count
           FROM deals
           WHERE workspace_id = $1
             AND stage_normalized NOT IN ('closed_won', 'closed_lost')
             AND close_date <= $${periodIdx}
             ${whereClause}`,
          allParams,
        );
        return {
          current_value: parseFloat(r.rows[0]?.current_value || '0'),
          deal_count: parseInt(r.rows[0]?.deal_count || '0', 10),
          computation_detail: { metric_type: 'pipeline', period_end: goal.period_end },
        };
      }

      case 'opportunities': {
        const r = await query<{ deal_count: string }>(
          `SELECT COUNT(*) as deal_count
           FROM deals
           WHERE workspace_id = $1
             AND stage_normalized NOT IN ('closed_won', 'closed_lost')
             ${whereClause}`,
          allParams,
        );
        const count = parseInt(r.rows[0]?.deal_count || '0', 10);
        return {
          current_value: count,
          deal_count: count,
          computation_detail: { metric_type: 'opportunities' },
        };
      }

      case 'win_rate': {
        const periodIdx1 = allParams.length + 1;
        const periodIdx2 = allParams.length + 2;
        allParams.push(goal.period_start, goal.period_end);
        const wonR = await query<{ count: string }>(
          `SELECT COUNT(*) as count FROM deals
           WHERE workspace_id = $1 AND stage_normalized = 'closed_won'
             AND close_date >= $${periodIdx1} AND close_date <= $${periodIdx2} ${whereClause}`,
          allParams,
        );
        const lostR = await query<{ count: string }>(
          `SELECT COUNT(*) as count FROM deals
           WHERE workspace_id = $1 AND stage_normalized = 'closed_lost'
             AND close_date >= $${periodIdx1} AND close_date <= $${periodIdx2} ${whereClause}`,
          allParams,
        );
        const won = parseInt(wonR.rows[0]?.count || '0', 10);
        const lost = parseInt(lostR.rows[0]?.count || '0', 10);
        const total = won + lost;
        const rate = total > 0 ? (won / total) * 100 : 0;
        return {
          current_value: Math.round(rate * 10) / 10,
          deal_count: total,
          computation_detail: { won, lost, total },
        };
      }

      default:
        return {
          current_value: 0,
          deal_count: 0,
          computation_detail: { unsupported: true, metric_type: goal.metric_type },
        };
    }
  }
}

export const goalService = new GoalService();
