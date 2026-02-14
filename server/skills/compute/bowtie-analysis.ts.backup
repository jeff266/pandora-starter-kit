import { query } from '../../db.js';
import { discoverBowtieStages, getBowtieDiscovery } from '../../analysis/bowtie-discovery.js';
import { getDefinitions } from '../../context/index.js';

export interface BowtieSummary {
  mapping: {
    bowtieMapping: any;
    hasPostSale: boolean;
    leftSideStages: string[];
    rightSideStages: string[];
    lifecycleStages: Array<{ lifecycle_stage: string; count: number }>;
  } | null;
  leftSideFunnel: {
    contactStages: Array<{ stage: string; total: number; new_this_month: number; new_last_month: number }>;
    dealCreation: {
      total_open_deals: number;
      new_this_month: number;
      new_last_month: number;
      pipeline_created_this_month: number;
    };
    wonDeals: {
      won_this_month: number;
      won_amount_this_month: number;
      avg_deal_size: number;
      won_last_month: number;
      won_amount_last_month: number;
    };
  } | null;
  conversions: {
    conversions: Record<string, { current_month: number; prior_month: number; trend: string; delta: number }>;
    avgDaysInStage: number | null;
    totalFunnelEfficiency: number;
    dropOffRates: Record<string, number>;
  } | null;
  rightSideFunnel: any | null;
  bottlenecks: {
    weakestConversion: { stage: string; rate: number } | null;
    biggestDecline: { stage: string; delta: number } | null;
    longestStage: { stage: string; days: number } | null;
    biggestVolumeLoss: { stage: string; loss: number } | null;
  } | null;
  activityCorrelation: {
    won: any;
    not_won: any;
    activityGap: any;
  } | null;
}

export async function loadBowtieMapping(workspaceId: string) {
  try {
    console.log('[BowtieAnalysis] Loading bowtie mapping for workspace', workspaceId);

    let bowtieData = await getBowtieDiscovery(workspaceId);

    if (!bowtieData) {
      console.log('[BowtieAnalysis] No cached bowtie discovery, running discovery...');
      bowtieData = await discoverBowtieStages(workspaceId);
    }

    const leftSideStages = bowtieData.bowtieStages
      .filter(s => s.bowtieCategory === 'pre_sale')
      .map(s => s.rawStage);

    const rightSideStages = bowtieData.bowtieStages
      .filter(s => s.bowtieCategory !== 'pre_sale')
      .map(s => s.rawStage);

    const hasPostSale = rightSideStages.length > 0;

    const lifecycleResult = await query<{ lifecycle_stage: string; count: number }>(
      `SELECT DISTINCT custom_fields->>'lifecyclestage' as lifecycle_stage, COUNT(*)::int as count
       FROM contacts WHERE workspace_id = $1 AND custom_fields->>'lifecyclestage' IS NOT NULL
       GROUP BY 1 ORDER BY count DESC`,
      [workspaceId]
    );

    return {
      bowtieMapping: bowtieData,
      hasPostSale,
      leftSideStages,
      rightSideStages,
      lifecycleStages: lifecycleResult.rows,
    };
  } catch (error) {
    console.log('[BowtieAnalysis] Error loading bowtie mapping:', error);
    return {
      bowtieMapping: null,
      hasPostSale: false,
      leftSideStages: [],
      rightSideStages: [],
      lifecycleStages: [],
    };
  }
}

export async function computeLeftSideFunnel(workspaceId: string) {
  try {
    console.log('[BowtieAnalysis] Computing left-side funnel for workspace', workspaceId);

    const contactStagesResult = await query<{
      stage: string; total: number; new_this_month: number; new_last_month: number;
    }>(
      `SELECT 
        custom_fields->>'lifecyclestage' as stage,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()))::int as new_this_month,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW()))::int as new_last_month
       FROM contacts WHERE workspace_id = $1
       GROUP BY 1`,
      [workspaceId]
    );

    const dealCreationResult = await query<{
      total_open_deals: number; new_this_month: number; new_last_month: number; pipeline_created_this_month: number;
    }>(
      `SELECT 
        COUNT(*)::int as total_open_deals,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()))::int as new_this_month,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW()))::int as new_last_month,
        COALESCE(SUM(amount) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())), 0)::numeric as pipeline_created_this_month
       FROM deals WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
      [workspaceId]
    );

    const wonDealsResult = await query<{
      won_this_month: number; won_amount_this_month: number; avg_deal_size: number;
      won_last_month: number; won_amount_last_month: number;
    }>(
      `SELECT 
        COUNT(*)::int as won_this_month,
        COALESCE(SUM(amount), 0)::numeric as won_amount_this_month,
        COALESCE(AVG(amount), 0)::numeric as avg_deal_size,
        COUNT(*) FILTER (WHERE close_date >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND close_date < DATE_TRUNC('month', NOW()))::int as won_last_month,
        COALESCE(SUM(amount) FILTER (WHERE close_date >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND close_date < DATE_TRUNC('month', NOW())), 0)::numeric as won_amount_last_month
       FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'`,
      [workspaceId]
    );

    const dealCreation = dealCreationResult.rows[0] || {
      total_open_deals: 0, new_this_month: 0, new_last_month: 0, pipeline_created_this_month: 0,
    };

    const wonDeals = wonDealsResult.rows[0] || {
      won_this_month: 0, won_amount_this_month: 0, avg_deal_size: 0, won_last_month: 0, won_amount_last_month: 0,
    };

    return {
      contactStages: contactStagesResult.rows,
      dealCreation: {
        total_open_deals: Number(dealCreation.total_open_deals),
        new_this_month: Number(dealCreation.new_this_month),
        new_last_month: Number(dealCreation.new_last_month),
        pipeline_created_this_month: Number(dealCreation.pipeline_created_this_month),
      },
      wonDeals: {
        won_this_month: Number(wonDeals.won_this_month),
        won_amount_this_month: Number(wonDeals.won_amount_this_month),
        avg_deal_size: Number(wonDeals.avg_deal_size),
        won_last_month: Number(wonDeals.won_last_month),
        won_amount_last_month: Number(wonDeals.won_amount_last_month),
      },
    };
  } catch (error) {
    console.log('[BowtieAnalysis] Error computing left-side funnel:', error);
    return null;
  }
}

export async function computeConversionRates(workspaceId: string) {
  try {
    console.log('[BowtieAnalysis] Computing conversion rates for workspace', workspaceId);

    const currentMonthStages = await query<{ stage: string; count: number }>(
      `SELECT custom_fields->>'lifecyclestage' as stage, COUNT(*)::int as count
       FROM contacts WHERE workspace_id = $1
         AND created_at >= DATE_TRUNC('month', NOW())
         AND custom_fields->>'lifecyclestage' IS NOT NULL
       GROUP BY 1`,
      [workspaceId]
    );

    const priorMonthStages = await query<{ stage: string; count: number }>(
      `SELECT custom_fields->>'lifecyclestage' as stage, COUNT(*)::int as count
       FROM contacts WHERE workspace_id = $1
         AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
         AND created_at < DATE_TRUNC('month', NOW())
         AND custom_fields->>'lifecyclestage' IS NOT NULL
       GROUP BY 1`,
      [workspaceId]
    );

    const currentDeals = await query<{ new_deals: number }>(
      `SELECT COUNT(*)::int as new_deals
       FROM deals WHERE workspace_id = $1 AND created_at >= DATE_TRUNC('month', NOW())`,
      [workspaceId]
    );

    const priorDeals = await query<{ new_deals: number }>(
      `SELECT COUNT(*)::int as new_deals
       FROM deals WHERE workspace_id = $1
         AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
         AND created_at < DATE_TRUNC('month', NOW())`,
      [workspaceId]
    );

    const winRateResult = await query<{ won: number; lost: number }>(
      `SELECT
        COUNT(*) FILTER (WHERE stage_normalized = 'closed_won')::int as won,
        COUNT(*) FILTER (WHERE stage_normalized = 'closed_lost')::int as lost
       FROM deals WHERE workspace_id = $1
         AND stage_normalized IN ('closed_won', 'closed_lost')
         AND close_date >= NOW() - INTERVAL '6 months'`,
      [workspaceId]
    );

    const currentMap: Record<string, number> = {};
    for (const row of currentMonthStages.rows) {
      if (row.stage) currentMap[row.stage.toLowerCase()] = Number(row.count);
    }

    const priorMap: Record<string, number> = {};
    for (const row of priorMonthStages.rows) {
      if (row.stage) priorMap[row.stage.toLowerCase()] = Number(row.count);
    }

    const safeRate = (numerator: number, denominator: number) =>
      denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0;

    const computeTransition = (
      name: string,
      currentNum: number, currentDen: number,
      priorNum: number, priorDen: number
    ) => {
      const currentRate = safeRate(currentNum, currentDen);
      const priorRate = safeRate(priorNum, priorDen);
      const delta = Math.round((currentRate - priorRate) * 10000) / 10000;
      let trend = 'stable';
      if (delta > 0.02) trend = 'improving';
      else if (delta < -0.02) trend = 'declining';
      return { current_month: currentRate, prior_month: priorRate, trend, delta };
    };

    const currentLeads = currentMap['lead'] || 0;
    const currentMql = currentMap['marketingqualifiedlead'] || currentMap['mql'] || 0;
    const currentSql = currentMap['salesqualifiedlead'] || currentMap['sql'] || 0;
    const priorLeads = priorMap['lead'] || 0;
    const priorMql = priorMap['marketingqualifiedlead'] || priorMap['mql'] || 0;
    const priorSql = priorMap['salesqualifiedlead'] || priorMap['sql'] || 0;

    const currentNewDeals = Number(currentDeals.rows[0]?.new_deals || 0);
    const priorNewDeals = Number(priorDeals.rows[0]?.new_deals || 0);

    const winRow = winRateResult.rows[0] || { won: 0, lost: 0 };
    const totalClosed = Number(winRow.won) + Number(winRow.lost);

    const conversions: Record<string, any> = {
      lead_to_mql: computeTransition('lead_to_mql', currentMql, currentLeads, priorMql, priorLeads),
      mql_to_sql: computeTransition('mql_to_sql', currentSql, currentMql, priorSql, priorMql),
      sql_to_sao: computeTransition('sql_to_sao', currentNewDeals, currentSql, priorNewDeals, priorSql),
      sao_to_won: {
        current_month: safeRate(Number(winRow.won), totalClosed),
        prior_month: 0,
        trend: 'stable',
        delta: 0,
      },
    };

    let avgDaysInStage: number | null = null;
    try {
      const daysResult = await query<{ avg_days: number }>(
        `SELECT COALESCE(AVG(days_in_stage), 0)::numeric as avg_days
         FROM deals WHERE workspace_id = $1 AND days_in_stage IS NOT NULL`,
        [workspaceId]
      );
      avgDaysInStage = Number(daysResult.rows[0]?.avg_days || 0) || null;
    } catch {
      console.log('[BowtieAnalysis] days_in_stage column not available');
    }

    const rates = [
      conversions.lead_to_mql.current_month,
      conversions.mql_to_sql.current_month,
      conversions.sql_to_sao.current_month,
      conversions.sao_to_won.current_month,
    ];
    const totalFunnelEfficiency = rates.reduce((acc, r) => acc * r, 1);

    const dropOffRates: Record<string, number> = {};
    for (const [key, val] of Object.entries(conversions)) {
      dropOffRates[key] = Math.round((1 - (val as any).current_month) * 10000) / 10000;
    }

    return { conversions, avgDaysInStage, totalFunnelEfficiency, dropOffRates };
  } catch (error) {
    console.log('[BowtieAnalysis] Error computing conversion rates:', error);
    return null;
  }
}

export async function computeRightSideFunnel(workspaceId: string, postSaleStages: string[]) {
  try {
    if (!postSaleStages || postSaleStages.length === 0) {
      return { note: 'Right-side bowtie not tracked in CRM.' };
    }

    console.log('[BowtieAnalysis] Computing right-side funnel for workspace', workspaceId);

    const stageBreakdown = await query<{
      stage: string; stage_normalized: string; deals: number; total_value: number;
    }>(
      `SELECT 
        stage, stage_normalized,
        COUNT(*)::int as deals,
        COALESCE(SUM(amount), 0)::numeric as total_value
       FROM deals WHERE workspace_id = $1 AND stage IN (SELECT unnest($2::text[]))
       GROUP BY 1, 2`,
      [workspaceId, postSaleStages]
    );

    const churnResult = await query<{ churned_count: number; churned_value: number }>(
      `SELECT COUNT(*)::int as churned_count, COALESCE(SUM(d.amount), 0)::numeric as churned_value
       FROM deals d
       WHERE d.workspace_id = $1 AND d.stage_normalized = 'closed_lost'
         AND d.close_date >= NOW() - INTERVAL '90 days'
         AND EXISTS (
           SELECT 1 FROM deals d2 WHERE d2.workspace_id = $1 
           AND d2.account_id = d.account_id AND d2.stage_normalized = 'closed_won'
           AND d2.id != d.id
         )`,
      [workspaceId]
    );

    const churn = churnResult.rows[0] || { churned_count: 0, churned_value: 0 };

    return {
      stageBreakdown: stageBreakdown.rows.map(r => ({
        stage: r.stage,
        stage_normalized: r.stage_normalized,
        deals: Number(r.deals),
        total_value: Number(r.total_value),
      })),
      churn: {
        churned_count: Number(churn.churned_count),
        churned_value: Number(churn.churned_value),
      },
    };
  } catch (error) {
    console.log('[BowtieAnalysis] Error computing right-side funnel:', error);
    return { note: 'Right-side bowtie not tracked in CRM.' };
  }
}

export function computeBottlenecks(conversions: any) {
  try {
    if (!conversions || !conversions.conversions) {
      return null;
    }

    const convMap = conversions.conversions as Record<string, {
      current_month: number; prior_month: number; trend: string; delta: number;
    }>;

    let weakestConversion: { stage: string; rate: number } | null = null;
    let biggestDecline: { stage: string; delta: number } | null = null;
    let biggestVolumeLoss: { stage: string; loss: number } | null = null;

    for (const [stage, data] of Object.entries(convMap)) {
      if (!weakestConversion || data.current_month < weakestConversion.rate) {
        weakestConversion = { stage, rate: data.current_month };
      }
      if (!biggestDecline || data.delta < biggestDecline.delta) {
        biggestDecline = { stage, delta: data.delta };
      }
      const dropOff = 1 - data.current_month;
      if (!biggestVolumeLoss || dropOff > biggestVolumeLoss.loss) {
        biggestVolumeLoss = { stage, loss: dropOff };
      }
    }

    let longestStage: { stage: string; days: number } | null = null;
    if (conversions.avgDaysInStage && conversions.avgDaysInStage > 0) {
      longestStage = { stage: 'overall', days: conversions.avgDaysInStage };
    }

    return { weakestConversion, biggestDecline, longestStage, biggestVolumeLoss };
  } catch (error) {
    console.log('[BowtieAnalysis] Error computing bottlenecks:', error);
    return null;
  }
}

export async function computeActivityCorrelation(workspaceId: string) {
  try {
    console.log('[BowtieAnalysis] Computing activity correlation for workspace', workspaceId);

    const result = await query<{
      outcome: string; deal_count: number; avg_activities: number;
      avg_meetings: number; avg_calls: number;
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
      outcome: 'won', deal_count: 0, avg_activities: 0, avg_meetings: 0, avg_calls: 0,
    };
    const notWon = result.rows.find(r => r.outcome === 'not_won') || {
      outcome: 'not_won', deal_count: 0, avg_activities: 0, avg_meetings: 0, avg_calls: 0,
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
    console.log('[BowtieAnalysis] Error computing activity correlation:', error);
    return null;
  }
}

export async function prepareBowtieSummary(workspaceId: string): Promise<BowtieSummary> {
  console.log('[BowtieAnalysis] Preparing bowtie summary for workspace', workspaceId);

  const mapping = await loadBowtieMapping(workspaceId);
  const leftSideFunnel = await computeLeftSideFunnel(workspaceId);
  const conversions = await computeConversionRates(workspaceId);

  let rightSideFunnel = null;
  if (mapping.hasPostSale && mapping.rightSideStages.length > 0) {
    rightSideFunnel = await computeRightSideFunnel(workspaceId, mapping.rightSideStages);
  } else {
    rightSideFunnel = { note: 'Right-side bowtie not tracked in CRM.' };
  }

  const bottlenecks = computeBottlenecks(conversions);
  const activityCorrelation = await computeActivityCorrelation(workspaceId);

  console.log('[BowtieAnalysis] Bowtie summary complete for workspace', workspaceId);

  return {
    mapping,
    leftSideFunnel,
    conversions,
    rightSideFunnel,
    bottlenecks,
    activityCorrelation,
  };
}
