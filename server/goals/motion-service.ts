import { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';
import type { RevenueMotion, CreateMotionInput } from './types.js';

export class MotionService {
  async create(workspaceId: string, input: Partial<CreateMotionInput>): Promise<RevenueMotion> {
    const result = await query<RevenueMotion>(
      `INSERT INTO revenue_motions
        (workspace_id, type, sub_type, label, pipeline_names, deal_filters, team_labels, funnel_model, thresholds_override, is_active, source, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        workspaceId,
        input.type,
        input.sub_type || null,
        input.label,
        input.pipeline_names || [],
        JSON.stringify(input.deal_filters || {}),
        input.team_labels || [],
        JSON.stringify(input.funnel_model || {}),
        JSON.stringify(input.thresholds_override || {}),
        input.is_active !== false,
        input.source || 'manual',
        input.confidence ?? 1.0,
      ],
    );
    return result.rows[0];
  }

  async update(motionId: string, updates: Partial<RevenueMotion>): Promise<RevenueMotion> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let idx = 1;

    const fields: Array<[keyof RevenueMotion, boolean]> = [
      ['type', false],
      ['sub_type', false],
      ['label', false],
      ['pipeline_names', false],
      ['deal_filters', true],
      ['team_labels', false],
      ['funnel_model', true],
      ['thresholds_override', true],
      ['is_active', false],
      ['source', false],
      ['confidence', false],
    ];

    for (const [field, isJson] of fields) {
      if (field in updates) {
        setClauses.push(`${field} = $${idx}`);
        values.push(isJson ? JSON.stringify((updates as any)[field]) : (updates as any)[field]);
        idx++;
      }
    }

    values.push(motionId);
    const result = await query<RevenueMotion>(
      `UPDATE revenue_motions SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0];
  }

  async list(workspaceId: string): Promise<RevenueMotion[]> {
    const result = await query<RevenueMotion>(
      `SELECT * FROM revenue_motions WHERE workspace_id = $1 AND is_active = true ORDER BY type, sub_type`,
      [workspaceId],
    );
    return result.rows;
  }

  async getById(motionId: string): Promise<RevenueMotion | null> {
    const result = await query<RevenueMotion>(
      `SELECT * FROM revenue_motions WHERE id = $1`,
      [motionId],
    );
    return result.rows[0] ?? null;
  }

  async getByPipelineName(workspaceId: string, pipelineName: string): Promise<RevenueMotion | null> {
    const result = await query<RevenueMotion>(
      `SELECT * FROM revenue_motions WHERE workspace_id = $1 AND is_active = true AND $2 = ANY(pipeline_names) LIMIT 1`,
      [workspaceId, pipelineName],
    );
    return result.rows[0] ?? null;
  }

  async softDelete(motionId: string): Promise<void> {
    await query(
      `UPDATE revenue_motions SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [motionId],
    );
  }

  async getEffectiveThresholds(workspaceId: string, motionId: string): Promise<Record<string, any>> {
    const config = await configLoader.getConfig(workspaceId);
    const motion = await this.getById(motionId);
    return {
      ...((config as any).thresholds || {}),
      ...(motion?.thresholds_override || {}),
    };
  }
}

export const motionService = new MotionService();
