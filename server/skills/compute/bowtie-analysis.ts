/**
 * Bowtie Analysis - Dynamic Funnel Edition
 *
 * Refactored to use workspace-level funnel definitions instead of hardcoded
 * Lead → MQL → SQL → SAO → Won assumptions.
 */

import { query } from '../../db.js';
import { getFunnelDefinition, discoverFunnel } from '../../funnel/discovery.js';
import type {
  FunnelDefinition,
  FunnelStage,
  StageVolume,
  ConversionRate,
} from '../../types/funnel.js';

export interface BowtieSummary {
  funnel: {
    definition: FunnelDefinition;
    status: string;
    preSaleStages: FunnelStage[];
    centerStage: FunnelStage | null;
    postSaleStages: FunnelStage[];
  };
  leftSideFunnel: {
    stages: StageVolume[];
  } | null;
  conversions: {
    conversions: ConversionRate[];
    totalFunnelEfficiency: number;
  } | null;
  rightSideFunnel: {
    stages: StageVolume[];
  } | null;
  bottlenecks: {
    weakestConversion: { stage: string; rate: number } | null;
    biggestDecline: { stage: string; delta: number } | null;
    biggestVolumeLoss: { stage: string; loss: number } | null;
  } | null;
  activityCorrelation: {
    won: any;
    not_won: any;
    activityGap: any;
  } | null;
}

/**
 * Load or discover funnel definition for workspace
 */
export async function loadFunnelDefinition(workspaceId: string): Promise<FunnelDefinition> {
  let funnel = await getFunnelDefinition(workspaceId);

  if (!funnel) {
    console.log('[Bowtie Dynamic] No funnel defined, running discovery...');
    const discovery = await discoverFunnel(workspaceId);
    funnel = discovery.funnel;
  }

  return funnel;
}

/**
 * Get stage volumes dynamically based on funnel definition
 */
export async function getStageVolumes(
  workspaceId: string,
  stages: FunnelStage[]
): Promise<StageVolume[]> {
  const volumes: StageVolume[] = [];

  for (const stage of stages) {
    const { object, field, values, field_path, match_type } = stage.source;

    // Skip unmapped stages
    if (!field && (!values || values.length === 0) && match_type !== 'object_exists') {
      volumes.push({
        stage_id: stage.id,
        label: stage.label,
        side: stage.side,
        order: stage.order,
        total: 0,
        new_this_month: 0,
        new_last_month: 0,
        unmapped: true,
      });
      continue;
    }

    let table: string;
    let dateField: string;

    switch (object) {
      case 'leads':
        table = 'leads';
        dateField = 'created_date';
        break;
      case 'contacts':
        table = 'contacts';
        dateField = 'created_at';
        break;
      case 'deals':
        table = 'deals';
        dateField = 'created_at';
        break;
      case 'accounts':
        table = 'accounts';
        dateField = 'created_at';
        break;
      default:
        continue;
    }

    const fieldRef = field_path || field;

    let whereClause: string;
    let params: any[] = [workspaceId];

    if (match_type === 'object_exists') {
      // Stage = object exists (e.g., SAO = deal created)
      whereClause = `workspace_id = $1`;
    } else if (match_type === 'field_not_null') {
      whereClause = `workspace_id = $1 AND ${fieldRef} IS NOT NULL`;
    } else {
      // Default: match field against values
      whereClause = `workspace_id = $1 AND ${fieldRef} = ANY($2)`;
      params.push(values);
    }

    // For deal stages, exclude closed_won and closed_lost unless this IS the center/closed stage
    if (object === 'deals' && stage.side === 'pre_sale') {
      whereClause += ` AND stage_normalized NOT IN ('closed_won', 'closed_lost')`;
    }

    const queryText = `
      SELECT
        COUNT(*)::text as total,
        COUNT(*) FILTER (
          WHERE ${dateField} >= DATE_TRUNC('month', NOW())
        )::text as new_this_month,
        COUNT(*) FILTER (
          WHERE ${dateField} >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
          AND ${dateField} < DATE_TRUNC('month', NOW())
        )::text as new_last_month
        ${object === 'deals' ? `, COALESCE(SUM(amount), 0)::text as total_value,
          COALESCE(SUM(amount) FILTER (
            WHERE ${dateField} >= DATE_TRUNC('month', NOW())
          ), 0)::text as value_this_month` : ''}
      FROM ${table}
      WHERE ${whereClause}
    `;

    try {
      const result = await query<{
        total: string;
        new_this_month: string;
        new_last_month: string;
        total_value?: string;
        value_this_month?: string;
      }>(queryText, params);

      const row = result.rows[0];

      volumes.push({
        stage_id: stage.id,
        label: stage.label,
        side: stage.side,
        order: stage.order,
        total: parseInt(row?.total || '0', 10),
        new_this_month: parseInt(row?.new_this_month || '0', 10),
        new_last_month: parseInt(row?.new_last_month || '0', 10),
        total_value: row?.total_value ? parseFloat(row.total_value) : undefined,
        value_this_month: row?.value_this_month ? parseFloat(row.value_this_month) : undefined,
        unmapped: false,
      });
    } catch (error) {
      console.error(`[Bowtie Dynamic] Error querying stage ${stage.id}:`, error);
      volumes.push({
        stage_id: stage.id,
        label: stage.label,
        side: stage.side,
        order: stage.order,
        total: 0,
        new_this_month: 0,
        new_last_month: 0,
        unmapped: true,
      });
    }
  }

  return volumes;
}

/**
 * Calculate conversion rates between adjacent stages
 */
export function calculateConversionRates(volumes: StageVolume[]): ConversionRate[] {
  const rates: ConversionRate[] = [];

  for (let i = 0; i < volumes.length - 1; i++) {
    const from = volumes[i];
    const to = volumes[i + 1];

    if (from.unmapped || to.unmapped) continue;
    if (from.new_this_month === 0 && from.new_last_month === 0) continue;

    const currentRate = from.new_this_month > 0 ? to.new_this_month / from.new_this_month : 0;
    const priorRate = from.new_last_month > 0 ? to.new_last_month / from.new_last_month : 0;

    const delta = currentRate - priorRate;
    const trend = Math.abs(delta) < 0.02 ? 'stable' : delta > 0 ? 'improving' : 'declining';

    rates.push({
      from_stage: from.stage_id,
      from_label: from.label,
      to_stage: to.stage_id,
      to_label: to.label,
      current_month: {
        converted: to.new_this_month,
        total: from.new_this_month,
        rate: currentRate,
      },
      prior_month: {
        converted: to.new_last_month,
        total: from.new_last_month,
        rate: priorRate,
      },
      trend: trend as 'improving' | 'stable' | 'declining',
      delta_pp: ((delta * 100).toFixed(1)) + 'pp',
    });
  }

  return rates;
}

/**
 * Compute bottlenecks from conversion rates
 */
export function computeBottlenecks(conversions: ConversionRate[]) {
  if (!conversions || conversions.length === 0) {
    return null;
  }

  let weakestConversion: { stage: string; rate: number } | null = null;
  let biggestDecline: { stage: string; delta: number } | null = null;
  let biggestVolumeLoss: { stage: string; loss: number } | null = null;

  for (const conv of conversions) {
    const stageName = `${conv.from_label} → ${conv.to_label}`;

    if (!weakestConversion || conv.current_month.rate < weakestConversion.rate) {
      weakestConversion = { stage: stageName, rate: conv.current_month.rate };
    }

    const delta = conv.current_month.rate - conv.prior_month.rate;
    if (!biggestDecline || delta < (biggestDecline.delta || 0)) {
      biggestDecline = { stage: stageName, delta };
    }

    const dropOff = 1 - conv.current_month.rate;
    if (!biggestVolumeLoss || dropOff > (biggestVolumeLoss.loss || 0)) {
      biggestVolumeLoss = { stage: stageName, loss: dropOff };
    }
  }

  return { weakestConversion, biggestDecline, biggestVolumeLoss };
}

/**
 * Compute activity correlation (unchanged - works with any deal data)
 */
export async function computeActivityCorrelation(workspaceId: string) {
  try {
    const result = await query<{
      outcome: string;
      deal_count: number;
      avg_activities: number;
      avg_meetings: number;
      avg_calls: number;
    }>(
      `SELECT
        CASE WHEN d.stage_normalized = 'closed_won' THEN 'won' ELSE 'not_won' END as outcome,
        COUNT(DISTINCT d.id)::int as deal_count,
        COALESCE(AVG(sub.activity_count), 0)::numeric as avg_activities,
        COALESCE(AVG(sub.meeting_count), 0)::numeric as avg_meetings,
        COALESCE(AVG(sub.call_count), 0)::numeric as avg_calls
       FROM deals d
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int as activity_count,
           COUNT(*) FILTER (WHERE a.activity_type = 'meeting')::int as meeting_count,
           COUNT(*) FILTER (WHERE a.activity_type = 'call')::int as call_count
         FROM activities a WHERE a.deal_id = d.id AND a.workspace_id = d.workspace_id
       ) sub ON true
       WHERE d.workspace_id = $1
         AND d.stage_normalized IN ('closed_won', 'closed_lost')
         AND d.close_date >= NOW() - INTERVAL '6 months'
       GROUP BY 1`,
      [workspaceId]
    );

    const won = result.rows.find(r => r.outcome === 'won') || {
      outcome: 'won',
      deal_count: 0,
      avg_activities: 0,
      avg_meetings: 0,
      avg_calls: 0,
    };
    const notWon = result.rows.find(r => r.outcome === 'not_won') || {
      outcome: 'not_won',
      deal_count: 0,
      avg_activities: 0,
      avg_meetings: 0,
      avg_calls: 0,
    };

    const wonData = {
      deal_count: Number(won.deal_count),
      avg_activities: Number(Number(won.avg_activities).toFixed(1)),
      avg_meetings: Number(Number(won.avg_meetings).toFixed(1)),
      avg_calls: Number(Number(won.avg_calls).toFixed(1)),
    };

    const notWonData = {
      deal_count: Number(notWon.deal_count),
      avg_activities: Number(Number(notWon.avg_activities).toFixed(1)),
      avg_meetings: Number(Number(notWon.avg_meetings).toFixed(1)),
      avg_calls: Number(Number(notWon.avg_calls).toFixed(1)),
    };

    return {
      won: wonData,
      not_won: notWonData,
      activityGap: {
        activities_delta: Number((wonData.avg_activities - notWonData.avg_activities).toFixed(1)),
        meetings_delta: Number((wonData.avg_meetings - notWonData.avg_meetings).toFixed(1)),
        calls_delta: Number((wonData.avg_calls - notWonData.avg_calls).toFixed(1)),
      },
    };
  } catch (error) {
    console.error('[Bowtie Dynamic] Error computing activity correlation:', error);
    return null;
  }
}

/**
 * Main entry point - prepare bowtie summary using dynamic funnel
 */
export async function prepareBowtieSummary(workspaceId: string): Promise<BowtieSummary> {
  console.log('[Bowtie Dynamic] Preparing bowtie summary for workspace', workspaceId);

  // 1. Load funnel definition
  const funnel = await loadFunnelDefinition(workspaceId);

  const preSaleStages = funnel.stages.filter(s => s.side === 'pre_sale').sort((a, b) => a.order - b.order);
  const centerStage = funnel.stages.find(s => s.side === 'center') || null;
  const postSaleStages = funnel.stages.filter(s => s.side === 'post_sale').sort((a, b) => a.order - b.order);

  console.log(
    `[Bowtie Dynamic] Funnel: ${funnel.model_label} (${preSaleStages.length} pre-sale, ` +
    `${postSaleStages.length} post-sale, status: ${funnel.status})`
  );

  // 2. Get stage volumes for pre-sale funnel
  const leftSideVolumes = await getStageVolumes(workspaceId, preSaleStages);

  // Include center stage if it exists
  let allPreSaleVolumes = leftSideVolumes;
  if (centerStage) {
    const centerVolume = await getStageVolumes(workspaceId, [centerStage]);
    allPreSaleVolumes = [...leftSideVolumes, ...centerVolume];
  }

  // 3. Calculate conversion rates
  const conversions = calculateConversionRates(allPreSaleVolumes);
  const totalFunnelEfficiency = conversions.reduce((acc, r) => acc * r.current_month.rate, 1);

  // 4. Get post-sale volumes
  let rightSideVolumes: StageVolume[] | null = null;
  if (postSaleStages.length > 0) {
    rightSideVolumes = await getStageVolumes(workspaceId, postSaleStages);
  }

  // 5. Compute bottlenecks
  const bottlenecks = computeBottlenecks(conversions);

  // 6. Activity correlation
  const activityCorrelation = await computeActivityCorrelation(workspaceId);

  console.log('[Bowtie Dynamic] Summary complete');

  return {
    funnel: {
      definition: funnel,
      status: funnel.status,
      preSaleStages,
      centerStage,
      postSaleStages,
    },
    leftSideFunnel: {
      stages: allPreSaleVolumes,
    },
    conversions: {
      conversions,
      totalFunnelEfficiency,
    },
    rightSideFunnel: rightSideVolumes ? { stages: rightSideVolumes } : null,
    bottlenecks,
    activityCorrelation,
  };
}
