/**
 * Skill Summarizers - Extract compact summaries from skill_runs.result_data
 *
 * Each summarizer is a pure TypeScript extraction function. No LLM calls.
 * Defensive - missing fields return graceful defaults, never throw.
 *
 * has_signal = false when skill found nothing actionable (all metrics nominal).
 * The Orchestrator skips has_signal = false skills entirely.
 */

import { query } from '../db.js';
import { SkillSummary, ActionSummary } from './types.js';

// ============================================================================
// Helpers
// ============================================================================

function safeGet(obj: any, path: string, fallback: any = null): any {
  return path.split('.').reduce(
    (o, k) => (o != null && o[k] !== undefined ? o[k] : fallback),
    obj
  );
}

function wordCount(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function truncateToWords(text: string, max: number): string {
  const words = text.split(/\s+/);
  if (words.length <= max) return text;
  return words.slice(0, max).join(' ') + '…';
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  } else if (amount >= 1_000) {
    return `$${Math.round(amount / 1_000)}K`;
  }
  return `$${Math.round(amount)}`;
}

// ============================================================================
// Summarizers
// ============================================================================

function summarizeForecastRollup(resultData: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  const closed_won = safeGet(resultData, 'closed_won.amount', 0) || 0;
  const commit = safeGet(resultData, 'commit.amount', 0) || 0;
  const best_case = safeGet(resultData, 'best_case.amount', 0) || 0;
  const pipeline = safeGet(resultData, 'pipeline.amount', 0) || 0;

  const bear = safeGet(resultData, 'landing_zone.bear', 0) || closed_won;
  const base = safeGet(resultData, 'landing_zone.base', 0) || closed_won + commit;
  const bull = safeGet(resultData, 'landing_zone.bull', 0) || closed_won + best_case;

  const attainment_pct = safeGet(resultData, 'attainment_pct', null);
  const quota = safeGet(resultData, 'quota', null);
  const days_remaining = safeGet(resultData, 'days_remaining', 0) || 0;

  const has_quota = quota && quota > 0;
  const category_changes = safeGet(resultData, 'category_changes', []) || [];
  const concentration_risk = safeGet(resultData, 'concentration_risk', false);

  // Extract top stalled commits and pacing issues
  const top_actions: ActionSummary[] = [];
  const stalled = safeGet(resultData, 'stalled_commits', []) || [];
  stalled.slice(0, 2).forEach((deal: any) => {
    top_actions.push({
      urgency: 'this_week',
      text: `Re-engage stalled commit: ${deal.name || 'Unknown'} (${formatCurrency(deal.amount || 0)})`,
      deal_name: deal.name,
      deal_id: deal.id,
      source_id: deal.source_id,
    });
  });

  let headline: string;
  if (has_quota) {
    headline = `Q landing ${formatCurrency(bear)}–${formatCurrency(bull)}; ${attainment_pct || '?'}% attainment, ${days_remaining} days left`;
  } else {
    headline = `No quota — ${formatCurrency(closed_won)} closed-won to date`;
  }

  const top_findings: string[] = [];
  if (category_changes.length > 0) {
    top_findings.push(`${category_changes.length} deal(s) changed forecast category this week`);
  }
  if (concentration_risk) {
    top_findings.push('Concentration risk: top 3 deals represent >60% of commit');
  }
  if (has_quota && attainment_pct && attainment_pct < 80) {
    const gap = quota - (closed_won + commit);
    top_findings.push(`${Math.round(100 - attainment_pct)}% gap to quota (${formatCurrency(gap)} needed)`);
  }

  const has_signal = category_changes.length > 0 ||
                     concentration_risk ||
                     (has_quota && attainment_pct && attainment_pct < 80);

  return {
    skill_id: 'forecast-rollup',
    headline,
    key_metrics: {
      closed_won,
      best_case,
      pipeline,
      bear,
      bull,
      attainment_pct: attainment_pct || null,
      days_remaining,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal,
  };
}

function summarizePipelineWaterfall(resultData: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  const created = safeGet(resultData, 'created.count', 0) || 0;
  const advanced = safeGet(resultData, 'advanced.count', 0) || 0;
  const regressed = safeGet(resultData, 'regressed.count', 0) || 0;
  const closed_won_count = safeGet(resultData, 'closed_won.count', 0) || 0;
  const closed_lost_count = safeGet(resultData, 'closed_lost.count', 0) || 0;
  const net_change = safeGet(resultData, 'net_change.amount', 0) || 0;

  const bottleneck_stages = safeGet(resultData, 'bottleneck_stages', []) || [];
  const created_value = safeGet(resultData, 'created.amount', 0) || 0;

  const top_findings: string[] = [];
  if (bottleneck_stages.length > 0) {
    const top_bottleneck = bottleneck_stages[0];
    top_findings.push(`${top_bottleneck.stage_name}: ${top_bottleneck.deal_count} deals stagnant`);
  }
  if (advanced === 0 && created === 0) {
    top_findings.push('Zero pipeline movement this week');
  }
  if (regressed > advanced) {
    top_findings.push(`More deals regressed (${regressed}) than advanced (${advanced})`);
  }

  const headline = bottleneck_stages.length > 0
    ? `${advanced} deals advanced, ${formatCurrency(created_value)} new pipeline; ${bottleneck_stages[0].stage_name} stage blocked`
    : `${advanced} deals advanced, ${formatCurrency(created_value)} new pipeline`;

  const top_actions: ActionSummary[] = [];
  bottleneck_stages.slice(0, 2).forEach((stage: any) => {
    top_actions.push({
      urgency: 'this_week',
      text: `Unblock ${stage.deal_count} deals in ${stage.stage_name}`,
    });
  });

  const has_signal = advanced > 0 || created > 0 || regressed > 0 || closed_won_count > 0 || closed_lost_count > 0;

  return {
    skill_id: 'pipeline-waterfall',
    headline,
    key_metrics: {
      created,
      advanced,
      regressed,
      closed_won_count,
      closed_lost_count,
      net_change,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal,
  };
}

function summarizeDealRiskReview(resultData: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  const flagged_deals = safeGet(resultData, 'flagged_deals', []) || [];
  const total_risk_value = flagged_deals.reduce((sum: number, d: any) => sum + (d.amount || 0), 0);
  const critical_count = flagged_deals.filter((d: any) => d.risk_severity === 'critical').length;

  const avg_days_stale = flagged_deals.length > 0
    ? Math.round(flagged_deals.reduce((sum: number, d: any) => sum + (d.days_stale || 0), 0) / flagged_deals.length)
    : 0;

  const risk_types: Record<string, number> = {};
  flagged_deals.forEach((d: any) => {
    const type = d.risk_type || 'unknown';
    risk_types[type] = (risk_types[type] || 0) + 1;
  });

  const dominant_risk = Object.entries(risk_types).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

  const headline = flagged_deals.length > 0
    ? `${flagged_deals.length} deals at risk totaling ${formatCurrency(total_risk_value)} — ${dominant_risk}`
    : 'No deals flagged at risk';

  const top_findings: string[] = [];
  flagged_deals.slice(0, 3).forEach((deal: any) => {
    top_findings.push(`${deal.name}: ${formatCurrency(deal.amount || 0)} — ${deal.risk_reason || 'unknown'}`);
  });

  const top_actions: ActionSummary[] = [];
  flagged_deals.slice(0, 3).forEach((deal: any) => {
    top_actions.push({
      urgency: deal.risk_severity === 'critical' ? 'today' : 'this_week',
      text: deal.recommended_action || `Review ${deal.name}`,
      deal_name: deal.name,
      deal_id: deal.id,
      source_id: deal.source_id,
    });
  });

  return {
    skill_id: 'deal-risk-review',
    headline,
    key_metrics: {
      deals_at_risk: flagged_deals.length,
      value_at_risk: total_risk_value,
      avg_days_stale,
      critical_count,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal: flagged_deals.length > 0,
  };
}

function summarizeRepScorecard(resultData: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  const flagged_reps = safeGet(resultData, 'flagged_reps', []) || [];

  const gap_types: Record<string, number> = {};
  flagged_reps.forEach((rep: any) => {
    const gap = rep.primary_gap || 'unknown';
    gap_types[gap] = (gap_types[gap] || 0) + 1;
  });

  const top_gap_type = Object.entries(gap_types).sort((a, b) => b[1] - a[1])[0]?.[0] || 'coverage';
  const team_avg_coverage = safeGet(resultData, 'team_avg_coverage', null);

  const headline = flagged_reps.length > 0
    ? `${flagged_reps.length} reps flagged — ${top_gap_type}`
    : 'Team on track';

  const top_findings: string[] = [];
  flagged_reps.slice(0, 3).forEach((rep: any, i: number) => {
    top_findings.push(`Rep ${i + 1}: ${rep.gap_description || rep.primary_gap}`);
  });

  const top_actions: ActionSummary[] = [];
  flagged_reps.slice(0, 3).forEach((rep: any) => {
    top_actions.push({
      urgency: rep.urgency || 'this_week',
      text: rep.coaching_priority || `Coach on ${rep.primary_gap}`,
      rep_name: rep.name,
      owner_email: rep.email,
    });
  });

  return {
    skill_id: 'rep-scorecard',
    headline,
    key_metrics: {
      reps_flagged: flagged_reps.length,
      top_gap_type,
      team_avg_coverage: team_avg_coverage || 0,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal: flagged_reps.length > 0,
  };
}

function summarizePipelineHygiene(resultData: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  const stale_deals = safeGet(resultData, 'stale_deals', []) || [];
  const stale_count = stale_deals.length;
  const stale_value = stale_deals.reduce((sum: number, d: any) => sum + (d.amount || 0), 0);

  const missing_amounts = safeGet(resultData, 'missing_amounts.count', 0) || 0;
  const closing_soon_stale = stale_deals.filter((d: any) => {
    const daysToClose = d.days_to_close || 999;
    return daysToClose < 30;
  }).length;

  const headline = stale_count > 0
    ? `${stale_count} deals need hygiene action (${formatCurrency(stale_value)} at risk)`
    : 'Pipeline hygiene clean';

  const top_findings: string[] = [];
  if (closing_soon_stale > 0) {
    top_findings.push(`${closing_soon_stale} stale deals closing within 30 days — high risk`);
  }
  stale_deals.slice(0, 3).forEach((deal: any) => {
    top_findings.push(`${deal.name}: ${deal.days_stale || '?'} days stale, closes ${deal.close_date || 'unknown'}`);
  });

  const top_actions: ActionSummary[] = [];
  stale_deals.slice(0, 3).forEach((deal: any) => {
    top_actions.push({
      urgency: (deal.days_to_close || 999) < 30 ? 'today' : 'this_week',
      text: `Re-engage ${deal.name} (${deal.days_stale || '?'} days stale)`,
      deal_name: deal.name,
      deal_id: deal.id,
      source_id: deal.source_id,
    });
  });

  return {
    skill_id: 'pipeline-hygiene',
    headline,
    key_metrics: {
      stale_count,
      stale_value,
      missing_amounts,
      closing_soon_stale,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal: stale_count > 0 || missing_amounts > 0,
  };
}

function summarizeSingleThreadAlert(resultData: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  const single_threaded = safeGet(resultData, 'single_threaded_deals', []) || [];
  const value_at_risk = single_threaded.reduce((sum: number, d: any) => sum + (d.amount || 0), 0);

  const headline = single_threaded.length > 0
    ? `${single_threaded.length} deals single-threaded totaling ${formatCurrency(value_at_risk)}`
    : 'No single-threaded deals';

  const top_findings: string[] = [];
  single_threaded.slice(0, 5).forEach((deal: any) => {
    top_findings.push(`${deal.name}: ${formatCurrency(deal.amount || 0)} — only ${deal.contact_count || 1} contact`);
  });

  const top_actions: ActionSummary[] = [];
  single_threaded.slice(0, 3).forEach((deal: any) => {
    top_actions.push({
      urgency: 'this_week',
      text: `Multi-thread ${deal.name}`,
      deal_name: deal.name,
      deal_id: deal.id,
      source_id: deal.source_id,
    });
  });

  return {
    skill_id: 'single-thread-alert',
    headline,
    key_metrics: {
      single_threaded_count: single_threaded.length,
      value_at_risk,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal: single_threaded.length > 0,
  };
}

function summarizePipelineCoverage(resultData: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  const coverage_ratio = safeGet(resultData, 'coverage_ratio', 0) || 0;
  const target_ratio = safeGet(resultData, 'target_ratio', 3) || 3;
  const gap_amount = safeGet(resultData, 'gap_amount', 0) || 0;
  const reps_below_target = safeGet(resultData, 'reps_below_target', []) || [];

  const above_target = coverage_ratio >= target_ratio;
  const headline = `${coverage_ratio.toFixed(1)}x pipeline coverage — ${above_target ? 'above' : 'below'} ${target_ratio.toFixed(1)}x target`;

  const top_findings: string[] = [];
  if (!above_target) {
    top_findings.push(`${formatCurrency(gap_amount)} pipeline gap to reach ${target_ratio.toFixed(1)}x coverage`);
  }
  reps_below_target.slice(0, 3).forEach((rep: any) => {
    top_findings.push(`${rep.name}: ${rep.coverage?.toFixed(1) || '?'}x coverage (below minimum)`);
  });

  const top_actions: ActionSummary[] = [];
  reps_below_target.slice(0, 3).forEach((rep: any) => {
    top_actions.push({
      urgency: 'this_week',
      text: `Build pipeline with ${rep.name} (needs ${formatCurrency(rep.gap_amount || 0)})`,
      rep_name: rep.name,
      owner_email: rep.email,
    });
  });

  return {
    skill_id: 'pipeline-coverage',
    headline,
    key_metrics: {
      coverage_ratio,
      target_ratio,
      gap_amount,
      reps_below_target: reps_below_target.length,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal: !above_target || reps_below_target.length > 0,
  };
}

function summarizeDataQualityAudit(resultData: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  const issues = safeGet(resultData, 'issues', []) || [];
  const deals_affected = safeGet(resultData, 'deals_affected', 0) || 0;

  const field_counts: Record<string, number> = {};
  issues.forEach((issue: any) => {
    const field = issue.field || 'unknown';
    field_counts[field] = (field_counts[field] || 0) + (issue.count || 1);
  });

  const critical_field = Object.entries(field_counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

  const headline = issues.length > 0
    ? `${issues.length} data quality issues — ${critical_field}`
    : 'Data quality clean';

  const top_findings: string[] = [];
  issues.slice(0, 5).forEach((issue: any) => {
    top_findings.push(`${issue.field || 'Unknown field'}: ${issue.count || 0} deals affected`);
  });

  const top_actions: ActionSummary[] = [];
  issues.slice(0, 3).forEach((issue: any) => {
    top_actions.push({
      urgency: 'this_week',
      text: `Clean ${issue.field || 'field'} on ${issue.count || 0} deals`,
    });
  });

  return {
    skill_id: 'data-quality-audit',
    headline,
    key_metrics: {
      issues_count: issues.length,
      deals_affected,
      critical_field,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal: issues.length > 3,
  };
}

function summarizeWeeklyRecap(resultData: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  const wins = safeGet(resultData, 'wins', []) || [];
  const losses = safeGet(resultData, 'losses', []) || [];
  const activities_count = safeGet(resultData, 'activities_count', 0) || 0;

  const wins_value = wins.reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
  const losses_value = losses.reduce((sum: number, l: any) => sum + (l.amount || 0), 0);

  const headline = `${wins.length} wins (${formatCurrency(wins_value)}), ${losses.length} losses (${formatCurrency(losses_value)}) this week`;

  const top_findings: string[] = [];
  if (wins.length > 0) {
    const notable_win = wins.sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0))[0];
    top_findings.push(`Notable win: ${notable_win.name} (${formatCurrency(notable_win.amount || 0)})`);
  }
  if (losses.length > 0) {
    const notable_loss = losses.sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0))[0];
    top_findings.push(`Notable loss: ${notable_loss.name} (${formatCurrency(notable_loss.amount || 0)}) — ${notable_loss.loss_reason || 'unknown'}`);
  }

  const top_actions: ActionSummary[] = [];
  losses.slice(0, 2).forEach((loss: any) => {
    if ((loss.amount || 0) > 50000) {
      top_actions.push({
        urgency: 'this_week',
        text: `Post-mortem on ${loss.name} loss`,
        deal_name: loss.name,
        deal_id: loss.id,
      });
    }
  });

  return {
    skill_id: 'weekly-recap',
    headline,
    key_metrics: {
      wins_count: wins.length,
      wins_value,
      losses_count: losses.length,
      losses_value,
      activities_count,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal: wins.length > 0 || losses.length > 0 || activities_count > 50,
  };
}

// ============================================================================
// Dispatcher
// ============================================================================

const SUMMARIZER_MAP: Record<string, (data: any) => Omit<SkillSummary, 'ran_at' | 'data_age_hours'>> = {
  'forecast-rollup':      summarizeForecastRollup,
  'pipeline-waterfall':   summarizePipelineWaterfall,
  'deal-risk-review':     summarizeDealRiskReview,
  'rep-scorecard':        summarizeRepScorecard,
  'pipeline-hygiene':     summarizePipelineHygiene,
  'single-thread-alert':  summarizeSingleThreadAlert,
  'pipeline-coverage':    summarizePipelineCoverage,
  'data-quality-audit':   summarizeDataQualityAudit,
  'weekly-recap':         summarizeWeeklyRecap,
};

export async function buildSkillSummaries(
  workspaceId: string,
  agentRunId: string,
  skillIds: string[]
): Promise<SkillSummary[]> {

  // For each skill, find the skill_run linked to this agent_run
  // Fall back to most recent completed run within 12 hours
  const summaries: SkillSummary[] = [];

  for (const skillId of skillIds) {
    let resultData: any = null;
    let ranAt: string | null = null;

    // Preferred: skill run from THIS agent's run batch
    // result column = full step-by-step data (what summarizers need)
    const linked = await query(`
      SELECT sr.result, sr.started_at
      FROM agent_skill_runs asr
      JOIN skill_runs sr ON sr.run_id = asr.skill_run_id
      WHERE asr.agent_run_id = $1
        AND asr.workspace_id = $2
        AND asr.skill_id = $3
        AND sr.status IN ('completed', 'partial')
      LIMIT 1
    `, [agentRunId, workspaceId, skillId]);

    if (linked.rows.length > 0) {
      resultData = linked.rows[0].result;
      ranAt = linked.rows[0].started_at;
    } else {
      // Fallback: most recent successful run within 12h
      const fallback = await query(`
        SELECT result, started_at
        FROM skill_runs
        WHERE workspace_id = $1
          AND skill_id = $2
          AND status IN ('completed', 'partial')
          AND started_at > NOW() - INTERVAL '12 hours'
        ORDER BY started_at DESC
        LIMIT 1
      `, [workspaceId, skillId]);

      if (fallback.rows.length > 0) {
        resultData = fallback.rows[0].result;
        ranAt = fallback.rows[0].started_at;
      }
    }

    if (!resultData || !ranAt) {
      // Skill didn't run — omit from summaries silently
      continue;
    }

    const summarizer = SUMMARIZER_MAP[skillId];
    if (!summarizer) continue;

    const partial = summarizer(resultData);
    const ageHours = Math.round(
      (Date.now() - new Date(ranAt).getTime()) / 3_600_000
    );

    summaries.push({
      ...partial,
      ran_at: ranAt,
      data_age_hours: ageHours,
    });
  }

  // Detect conflicts after all summaries built
  return detectConflicts(summaries);
}

function detectConflicts(summaries: SkillSummary[]): SkillSummary[] {
  // Check for pipeline-waterfall vs weekly-recap contradiction:
  // waterfall says zero movement but recap shows wins/losses
  const waterfall = summaries.find(s => s.skill_id === 'pipeline-waterfall');
  const recap = summaries.find(s => s.skill_id === 'weekly-recap');

  if (waterfall && recap) {
    const waterfallZero = waterfall.key_metrics['advanced'] === 0
      && waterfall.key_metrics['created'] === 0;
    const recapHasActivity = (recap.key_metrics['wins_count'] as number) > 0
      || (recap.key_metrics['losses_count'] as number) > 0;

    if (waterfallZero && recapHasActivity) {
      waterfall.conflicts_with = ['weekly-recap'];
    }
  }

  return summaries;
}
