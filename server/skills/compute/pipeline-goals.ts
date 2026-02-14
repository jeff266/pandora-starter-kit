import { query } from '../../db.js';

export async function loadTargetsAndActuals(workspaceId: string) {
  try {
    console.log('[PipelineGoals] Loading targets and actuals for workspace', workspaceId);

    let monthly = 0;
    let source = 'context_layer';
    let quotaWarning: string | undefined;

    try {
      const ctxResult = await query<any>(
        `SELECT sections->'goals_and_targets' as goals FROM context_layer WHERE workspace_id = $1`,
        [workspaceId]
      );

      const goals = ctxResult.rows[0]?.goals;
      if (goals) {
        if (goals.revenue_target) {
          monthly = Number(goals.revenue_target) / 12;
          source = 'annual_revenue_target';
        } else if (goals.quarterly_quota) {
          monthly = Number(goals.quarterly_quota) / 3;
          source = 'quarterly_quota';
        } else if (goals.monthly_quota) {
          monthly = Number(goals.monthly_quota);
          source = 'monthly_quota';
        }
      }
    } catch {
      console.log('[PipelineGoals] No context_layer data found, will use implied target');
    }

    if (monthly <= 0) {
      const impliedResult = await query<any>(
        `SELECT COALESCE(AVG(monthly_won), 0)::numeric as implied_monthly_target FROM (
          SELECT DATE_TRUNC('month', close_date) as month, SUM(amount) as monthly_won
          FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won'
            AND close_date >= NOW() - INTERVAL '3 months'
          GROUP BY 1
        ) sub`,
        [workspaceId]
      );
      monthly = Number(impliedResult.rows[0]?.implied_monthly_target || 0);
      source = 'implied_trailing_3mo';
      quotaWarning = 'No quota configured. Using trailing 3-month average as implied target.';
    }

    const attainmentResult = await query<any>(
      `SELECT COUNT(*)::int as deals_won, COALESCE(SUM(amount), 0)::numeric as amount_won
       FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won'
         AND close_date >= DATE_TRUNC('month', NOW())`,
      [workspaceId]
    );

    const pipelineResult = await query<any>(
      `SELECT COUNT(*)::int as open_deals, COALESCE(SUM(amount), 0)::numeric as open_pipeline,
         COALESCE(AVG(amount), 0)::numeric as avg_deal_size
       FROM deals WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
      [workspaceId]
    );

    const today = new Date();
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const daysRemaining = Math.ceil((endOfMonth.getTime() - today.getTime()) / 86400000);
    const weeksRemaining = Math.max(1, Math.ceil(daysRemaining / 7));

    const attRow = attainmentResult.rows[0] || {};
    const pipRow = pipelineResult.rows[0] || {};

    return {
      quota: { monthly, source },
      attainment: {
        deals_won: parseInt(attRow.deals_won || '0', 10),
        amount_won: Number(attRow.amount_won || 0),
      },
      pipeline: {
        open_deals: parseInt(pipRow.open_deals || '0', 10),
        open_pipeline: Number(pipRow.open_pipeline || 0),
        avg_deal_size: Number(pipRow.avg_deal_size || 0),
      },
      timing: { daysRemaining, weeksRemaining },
      quotaWarning,
    };
  } catch (error) {
    console.log('[PipelineGoals] Error loading targets and actuals:', error);
    return {
      quota: { monthly: 0, source: 'error' },
      attainment: { deals_won: 0, amount_won: 0 },
      pipeline: { open_deals: 0, open_pipeline: 0, avg_deal_size: 0 },
      timing: { daysRemaining: 30, weeksRemaining: 4 },
      quotaWarning: 'Failed to load quota data.',
    };
  }
}

export async function calculateHistoricalRates(workspaceId: string) {
  try {
    console.log('[PipelineGoals] Calculating historical rates for workspace', workspaceId);

    const winRateResult = await query<any>(
      `SELECT 
        COUNT(*) FILTER (WHERE stage_normalized = 'closed_won')::int as won,
        COUNT(*) FILTER (WHERE stage_normalized = 'closed_lost')::int as lost
       FROM deals WHERE workspace_id = $1
         AND close_date >= NOW() - INTERVAL '6 months'
         AND stage_normalized IN ('closed_won', 'closed_lost')`,
      [workspaceId]
    );

    const wr = winRateResult.rows[0] || {};
    const won = parseInt(wr.won || '0', 10);
    const lost = parseInt(wr.lost || '0', 10);
    const winRate = won + lost > 0 ? won / (won + lost) : 0;

    const benchmarkResult = await query<any>(
      `SELECT 
        COALESCE(AVG(sub.activities), 0)::numeric as avg_activities,
        COALESCE(AVG(sub.meetings), 0)::numeric as avg_meetings,
        COALESCE(AVG(sub.calls), 0)::numeric as avg_calls,
        COALESCE(AVG(sub.emails), 0)::numeric as avg_emails
       FROM (
        SELECT d.id,
          COUNT(a.id)::int as activities,
          COUNT(a.id) FILTER (WHERE a.activity_type = 'meeting')::int as meetings,
          COUNT(a.id) FILTER (WHERE a.activity_type = 'call')::int as calls,
          COUNT(a.id) FILTER (WHERE a.activity_type = 'email')::int as emails
        FROM deals d
        LEFT JOIN activities a ON a.deal_id = d.id AND a.workspace_id = d.workspace_id
        WHERE d.workspace_id = $1 AND d.stage_normalized = 'closed_won'
          AND d.close_date >= NOW() - INTERVAL '6 months'
        GROUP BY d.id
       ) sub`,
      [workspaceId]
    );

    const bm = benchmarkResult.rows[0] || {};

    const paceResult = await query<any>(
      `SELECT 
        COUNT(*)::int as activities_this_month,
        COUNT(*) FILTER (WHERE activity_type = 'meeting')::int as meetings_this_month,
        COUNT(*) FILTER (WHERE activity_type = 'call')::int as calls_this_month
       FROM activities WHERE workspace_id = $1
         AND timestamp >= DATE_TRUNC('month', NOW())`,
      [workspaceId]
    );

    const pace = paceResult.rows[0] || {};

    const activityOutcomeResult = await query<any>(
      `SELECT a.activity_type,
        COUNT(DISTINCT a.deal_id)::int as deals_touched,
        COUNT(DISTINCT a.deal_id) FILTER (WHERE d.stage_normalized = 'closed_won')::int as deals_won
       FROM activities a
       JOIN deals d ON d.id = a.deal_id AND d.workspace_id = a.workspace_id
       WHERE a.workspace_id = $1 AND d.close_date >= NOW() - INTERVAL '6 months'
         AND d.stage_normalized IN ('closed_won', 'closed_lost')
       GROUP BY a.activity_type`,
      [workspaceId]
    );

    const activityWinRates = activityOutcomeResult.rows.map((row: any) => ({
      activityType: row.activity_type,
      dealsTouched: parseInt(row.deals_touched || '0', 10),
      dealsWon: parseInt(row.deals_won || '0', 10),
      winRate: parseInt(row.deals_touched || '0', 10) > 0
        ? parseInt(row.deals_won || '0', 10) / parseInt(row.deals_touched || '0', 10)
        : 0,
    }));

    return {
      winRate,
      activityBenchmarks: {
        avg_activities: Number(bm.avg_activities || 0),
        avg_meetings: Number(bm.avg_meetings || 0),
        avg_calls: Number(bm.avg_calls || 0),
        avg_emails: Number(bm.avg_emails || 0),
      },
      currentPace: {
        activities_this_month: parseInt(pace.activities_this_month || '0', 10),
        meetings_this_month: parseInt(pace.meetings_this_month || '0', 10),
        calls_this_month: parseInt(pace.calls_this_month || '0', 10),
      },
      activityWinRates,
    };
  } catch (error) {
    console.log('[PipelineGoals] Error calculating historical rates:', error);
    return {
      winRate: 0,
      activityBenchmarks: { avg_activities: 0, avg_meetings: 0, avg_calls: 0, avg_emails: 0 },
      currentPace: { activities_this_month: 0, meetings_this_month: 0, calls_this_month: 0 },
      activityWinRates: [],
    };
  }
}

export function computeReverseMath(targets: any, rates: any) {
  try {
    console.log('[PipelineGoals] Computing reverse math from quota');

    const gap = Math.max(0, targets.quota.monthly - targets.attainment.amount_won);
    const avgDealSize = targets.pipeline.avg_deal_size || 50000;
    const winRate = Math.max(0.05, rates.winRate);

    const dealsNeededToWin = Math.ceil(gap / avgDealSize);
    const pipelineNeeded = Math.ceil(dealsNeededToWin / winRate);
    const pipelineGap = Math.max(0, pipelineNeeded - targets.pipeline.open_deals);

    const meetingsNeeded = dealsNeededToWin * (rates.activityBenchmarks.avg_meetings || 5);
    const callsNeeded = dealsNeededToWin * (rates.activityBenchmarks.avg_calls || 10);

    const weeksRemaining = targets.timing.weeksRemaining;
    const weeklyTargets = {
      deals_to_create: Math.ceil(pipelineGap / weeksRemaining),
      meetings_per_week: Math.ceil(meetingsNeeded / weeksRemaining),
      calls_per_week: Math.ceil(callsNeeded / weeksRemaining),
    };

    const monthDaysSoFar = new Date().getDate();
    const projectedMonthlyMeetings = Math.round((rates.currentPace.meetings_this_month / monthDaysSoFar) * 30);
    const meetingPaceGap = weeklyTargets.meetings_per_week * 4 - projectedMonthlyMeetings;

    const onTrack = gap <= 0 || (targets.pipeline.open_pipeline * winRate >= gap);

    return {
      gap,
      dealsNeededToWin,
      pipelineNeeded,
      pipelineGap,
      weeklyTargets,
      paceAssessment: {
        projectedMonthlyMeetings,
        meetingPaceGap,
        onTrack,
      },
      dealsInHand: targets.pipeline.open_deals,
      expectedFromPipeline: targets.pipeline.open_pipeline * winRate,
    };
  } catch (error) {
    console.log('[PipelineGoals] Error computing reverse math:', error);
    return {
      gap: 0,
      dealsNeededToWin: 0,
      pipelineNeeded: 0,
      pipelineGap: 0,
      weeklyTargets: { deals_to_create: 0, meetings_per_week: 0, calls_per_week: 0 },
      paceAssessment: { projectedMonthlyMeetings: 0, meetingPaceGap: 0, onTrack: false },
      dealsInHand: 0,
      expectedFromPipeline: 0,
    };
  }
}

export async function computeRepBreakdown(workspaceId: string) {
  try {
    console.log('[PipelineGoals] Computing rep breakdown for workspace', workspaceId);

    const dealResult = await query<any>(
      `SELECT d.owner,
        COUNT(DISTINCT d.id)::int as open_deals,
        COALESCE(SUM(d.amount), 0)::numeric as pipeline_value,
        COUNT(DISTINCT d.id) FILTER (WHERE d.stage_normalized = 'closed_won' AND d.close_date >= DATE_TRUNC('month', NOW()))::int as won_this_month,
        COALESCE(SUM(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won' AND d.close_date >= DATE_TRUNC('month', NOW())), 0)::numeric as won_value
       FROM deals d WHERE d.workspace_id = $1
         AND (d.stage_normalized NOT IN ('closed_won', 'closed_lost') 
              OR (d.stage_normalized = 'closed_won' AND d.close_date >= DATE_TRUNC('month', NOW())))
       GROUP BY d.owner ORDER BY pipeline_value DESC`,
      [workspaceId]
    );

    const activityResult = await query<any>(
      `SELECT owner,
        COUNT(*)::int as activities,
        COUNT(*) FILTER (WHERE activity_type = 'meeting')::int as meetings,
        COUNT(*) FILTER (WHERE activity_type = 'call')::int as calls
       FROM activities WHERE workspace_id = $1 AND timestamp >= DATE_TRUNC('month', NOW())
       GROUP BY owner`,
      [workspaceId]
    );

    const activityMap: Record<string, { activities: number; meetings: number; calls: number }> = {};
    for (const row of activityResult.rows) {
      activityMap[row.owner] = {
        activities: parseInt(row.activities || '0', 10),
        meetings: parseInt(row.meetings || '0', 10),
        calls: parseInt(row.calls || '0', 10),
      };
    }

    return dealResult.rows.map((row: any) => {
      const act = activityMap[row.owner] || { activities: 0, meetings: 0, calls: 0 };
      return {
        rep: row.owner,
        openDeals: parseInt(row.open_deals || '0', 10),
        pipelineValue: Number(row.pipeline_value || 0),
        wonThisMonth: parseInt(row.won_this_month || '0', 10),
        wonValue: Number(row.won_value || 0),
        activities: act.activities,
        meetings: act.meetings,
        calls: act.calls,
      };
    });
  } catch (error) {
    console.log('[PipelineGoals] Error computing rep breakdown:', error);
    return [];
  }
}

export async function preparePipelineGoalsSummary(workspaceId: string) {
  try {
    console.log('[PipelineGoals] Preparing pipeline goals summary for workspace', workspaceId);

    const targets = await loadTargetsAndActuals(workspaceId);
    const rates = await calculateHistoricalRates(workspaceId);
    const reverseMath = computeReverseMath(targets, rates);
    const repBreakdown = await computeRepBreakdown(workspaceId);

    console.log('[PipelineGoals] Summary complete', {
      quotaSource: targets.quota.source,
      gap: reverseMath.gap,
      onTrack: reverseMath.paceAssessment.onTrack,
      repCount: repBreakdown.length,
    });

    return {
      targets,
      rates,
      reverseMath,
      repBreakdown,
    };
  } catch (error) {
    console.log('[PipelineGoals] Error preparing summary:', error);
    return {
      targets: await loadTargetsAndActuals(workspaceId).catch(() => null),
      rates: await calculateHistoricalRates(workspaceId).catch(() => null),
      reverseMath: null,
      repBreakdown: [],
    };
  }
}
