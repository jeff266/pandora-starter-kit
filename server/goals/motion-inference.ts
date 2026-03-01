import { query } from '../db.js';
import type { InferredMotion, FunnelModel } from './types.js';

function matchesRenewal(name: string): boolean {
  return /renew|retain|retention/i.test(name);
}

function matchesExpansion(name: string): boolean {
  return /expan|upsell|cross.?sell|grow|existing|upgrade/i.test(name);
}

function classifyDealType(dealType: string): { motion: 'new_business' | 'expansion' | 'renewal'; sub_type: string | null } {
  const lower = dealType.toLowerCase();
  if (/renew|retention/.test(lower)) return { motion: 'renewal', sub_type: null };
  if (/expan|upsell|grow|upgrade/.test(lower)) return { motion: 'expansion', sub_type: 'upsell' };
  if (/cross.?sell|add.?on/.test(lower)) return { motion: 'expansion', sub_type: 'cross_sell' };
  return { motion: 'new_business', sub_type: null };
}

async function computeFunnelModel(
  workspaceId: string,
  motion: Omit<InferredMotion, 'funnel_model'>,
): Promise<FunnelModel> {
  const params: any[] = [workspaceId];
  const conditions: string[] = ['workspace_id = $1'];

  if (motion.pipeline_names && motion.pipeline_names.length > 0) {
    params.push(motion.pipeline_names);
    conditions.push(`pipeline = ANY($${params.length})`);
  }

  if (motion.deal_filters?.custom_field && motion.deal_filters?.values) {
    const field = motion.deal_filters.custom_field.replace(/[^a-zA-Z0-9_]/g, '');
    params.push(motion.deal_filters.values);
    conditions.push(`custom_fields->>'${field}' = ANY($${params.length})`);
  }

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  params.push(twelveMonthsAgo.toISOString().split('T')[0]);
  conditions.push(`updated_at >= $${params.length}`);

  const whereClause = conditions.join(' AND ');

  const wonResult = await query<{ count: string; avg_amount: string; avg_cycle: string }>(
    `SELECT COUNT(*) as count,
            COALESCE(AVG(amount), 0) as avg_amount,
            COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400), 0) as avg_cycle
     FROM deals
     WHERE ${whereClause} AND stage_normalized = 'closed_won'`,
    params,
  );

  const lostResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM deals WHERE ${whereClause} AND stage_normalized = 'closed_lost'`,
    params,
  );

  const wonCount = parseInt(wonResult.rows[0]?.count || '0', 10);
  const lostCount = parseInt(lostResult.rows[0]?.count || '0', 10);
  const total = wonCount + lostCount;

  const winRate = total > 0 ? wonCount / total : 0.25;
  const avgDealSize = parseFloat(wonResult.rows[0]?.avg_amount || '0') || 50000;
  const avgCycleDays = parseFloat(wonResult.rows[0]?.avg_cycle || '0') || 60;

  return {
    win_rate: Math.round(winRate * 1000) / 1000,
    avg_deal_size: Math.round(avgDealSize),
    avg_cycle_days: Math.round(avgCycleDays),
    stage_conversion_rates: {},
    source: 'inferred',
    computed_at: new Date().toISOString(),
  };
}

export async function inferMotions(workspaceId: string): Promise<InferredMotion[]> {
  const inferred: InferredMotion[] = [];

  const pipelinesResult = await query<{ pipeline_name: string }>(
    `SELECT DISTINCT pipeline_name FROM stage_configs WHERE workspace_id = $1 AND pipeline_name IS NOT NULL`,
    [workspaceId],
  );

  const pipelines = pipelinesResult.rows;

  if (pipelines.length === 0) {
    const defaultMotion: Omit<InferredMotion, 'funnel_model'> = {
      type: 'new_business',
      label: 'New Business',
      pipeline_names: [],
      confidence: 0.5,
      source: 'inferred',
    };
    const funnel = await computeFunnelModel(workspaceId, defaultMotion);
    return [{ ...defaultMotion, funnel_model: funnel }];
  }

  if (pipelines.length === 1) {
    const dealTypesResult = await query<{ dt: string; cnt: string }>(
      `SELECT DISTINCT custom_fields->>'dealtype' as dt, COUNT(*) as cnt
       FROM deals
       WHERE workspace_id = $1 AND custom_fields->>'dealtype' IS NOT NULL
       GROUP BY custom_fields->>'dealtype'`,
      [workspaceId],
    );

    if (dealTypesResult.rows.length >= 2) {
      for (const row of dealTypesResult.rows) {
        if (!row.dt) continue;
        const classified = classifyDealType(row.dt);
        const partial: Omit<InferredMotion, 'funnel_model'> = {
          type: classified.motion,
          sub_type: classified.sub_type,
          label: `${row.dt} (${pipelines[0].pipeline_name})`,
          pipeline_names: [pipelines[0].pipeline_name],
          deal_filters: { custom_field: 'dealtype', values: [row.dt] },
          confidence: 0.75,
          source: 'inferred',
        };
        const funnel = await computeFunnelModel(workspaceId, partial);
        inferred.push({ ...partial, funnel_model: funnel });
      }
      return inferred;
    }
  }

  for (const row of pipelines) {
    const name = row.pipeline_name;
    let type: InferredMotion['type'];
    let sub_type: string | null = null;
    let confidence = 0.7;

    if (matchesRenewal(name)) {
      type = 'renewal';
      confidence = 0.9;
    } else if (matchesExpansion(name)) {
      type = 'expansion';
      sub_type = /upsell/i.test(name) ? 'upsell' : /cross/i.test(name) ? 'cross_sell' : null;
      confidence = 0.85;
    } else {
      type = 'new_business';
    }

    const partial: Omit<InferredMotion, 'funnel_model'> = {
      type,
      sub_type,
      label: name,
      pipeline_names: [name],
      confidence,
      source: 'inferred',
    };
    const funnel = await computeFunnelModel(workspaceId, partial);
    inferred.push({ ...partial, funnel_model: funnel });
  }

  return inferred;
}
