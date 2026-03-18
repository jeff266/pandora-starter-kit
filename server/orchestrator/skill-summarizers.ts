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

function summarizeForecastRollup(resultData: any, outputData?: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  // Result may be wrapped under forecast_data.team (new format) or flat (old format)
  const team = safeGet(resultData, 'forecast_data.team', null) ?? safeGet(resultData, 'team', null) ?? {};

  const closed_won =
    safeGet(team, 'closedWon', null) ??
    safeGet(resultData, 'closed_won.amount', 0) ?? 0;
  const commit =
    safeGet(team, 'commit', null) ??
    safeGet(resultData, 'commit.amount', 0) ?? 0;
  const best_case =
    safeGet(team, 'bestCase', null) ??
    safeGet(resultData, 'best_case.amount', 0) ?? 0;
  const pipeline =
    safeGet(team, 'pipeline', null) ??
    safeGet(resultData, 'pipeline.amount', 0) ?? 0;

  const bear =
    safeGet(team, 'bearCase', null) ??
    safeGet(resultData, 'landing_zone.bear', null) ??
    (closed_won || 0);
  const base =
    safeGet(team, 'baseCase', null) ??
    safeGet(resultData, 'landing_zone.base', null) ??
    ((closed_won || 0) + (commit || 0));
  const bull =
    safeGet(team, 'bullCase', null) ??
    safeGet(resultData, 'landing_zone.bull', null) ??
    ((closed_won || 0) + (best_case || 0));

  const quotaConfig = safeGet(resultData, 'quota_config', null) ?? {};
  const attainment_pct =
    safeGet(team, 'attainmentPct', null) ??
    safeGet(resultData, 'attainment_pct', null);
  const quota =
    safeGet(quotaConfig, 'quota', null) ??
    safeGet(quotaConfig, 'totalQuota', null) ??
    safeGet(resultData, 'quota', null);
  const days_remaining =
    safeGet(team, 'daysRemaining', null) ??
    safeGet(resultData, 'days_remaining', 0) ?? 0;

  const has_quota = quota && quota > 0;
  const category_changes =
    safeGet(resultData, 'wow_delta.categoryChanges', null) ??
    safeGet(resultData, 'category_changes', []) ?? [];
  const concentration_risk =
    safeGet(resultData, 'forecast_data.concentrationRisk', null) ??
    safeGet(resultData, 'concentration_risk', false);

  // Extract top stalled commits and pacing issues
  const top_actions: ActionSummary[] = [];
  const stalled =
    safeGet(resultData, 'forecast_data.stalledCommits', null) ??
    safeGet(resultData, 'stalled_commits', []) ?? [];
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
                     (has_quota && attainment_pct && attainment_pct < 80) ||
                     (closed_won || 0) > 0 ||
                     (pipeline || 0) > 0;

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

function summarizePipelineWaterfall(resultData: any, outputData?: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
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

function summarizeDealRiskReview(resultData: any, outputData?: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  const flagged_deals = safeGet(resultData, 'flagged_deals', []) || [];

  // ── Step 1: Extract at-risk deals from output->narrative (Claude's assessment) ──
  // This is the authoritative source — Claude reads full deal context and produces
  // a structured JSON array with named deals, risk scores, and recommended actions.
  // The narrative may be stored as a markdown-wrapped JSON string: ```json\n[...]\n```
  let at_risk_deals: any[] = [];
  try {
    if (outputData) {
      // outputData may be:
      //   A) JSONB object: { evidence: {...}, narrative: "```json\n[...]\n```" }
      //   B) String (partial/cached runs): "```json\n[...]\n```" (narrative directly)
      //   C) String (partial/cached runs): '{"evidence":...,"narrative":"..."}' (JSON-encoded object)
      let raw: any = outputData;

      if (typeof raw === 'string') {
        // Try stripping markdown first (case B) — most common raw string format
        const maybeStripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        try {
          raw = JSON.parse(maybeStripped);
        } catch {
          // Stripped didn't parse; try the raw string as JSON (case C)
          try { raw = JSON.parse(raw); } catch { raw = null; }
        }
      }

      // Now raw is either an object ({evidence, narrative}), an array (deals), or null
      let narrative: any;
      if (Array.isArray(raw)) {
        narrative = raw;                                  // raw is already the deal array
      } else {
        narrative = raw?.narrative || raw?.risk_assessment || null;
      }

      // Narrative may still be a markdown-wrapped JSON string
      if (typeof narrative === 'string') {
        const stripped = narrative.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        try { narrative = JSON.parse(stripped); } catch { narrative = []; }
      }

      const deals: any[] = Array.isArray(narrative) ? narrative : [];

      at_risk_deals = deals
        .filter((d: any) => d.risk === 'high' || d.risk === 'medium' || (d.riskScore || 0) >= 60)
        .sort((a: any, b: any) => (b.riskScore || 0) - (a.riskScore || 0))
        .slice(0, 5)
        .map((d: any) => ({
          name: d.dealName || d.name,
          amount: Number(d.amount) || 0,
          owner: d.owner || 'Unknown',
          stage: d.currentStage || d.stage || 'Unknown',
          risk_score: d.riskScore || 0,
          risk_factors: (d.factors || d.risk_factors || []).slice(0, 2),
          days_in_stage: d.days_in_stage || 0,
          close_date: d.closeDate || d.close_date || '',
          recommended_action: d.recommendedAction || d.recommended_action,
        }));

      console.log(`[DealRiskReview Summarizer] ${at_risk_deals.length} at-risk deals extracted from narrative (${deals.length} total assessed)`);
    }
  } catch (err) {
    console.warn('[DealRiskReview Summarizer] Failed to parse output column:', err);
  }

  // ── Step 2: Build metrics — prefer at_risk_deals (Claude) over flagged_deals (compute) ──
  // The result column uses flagged_deals from pre-Claude compute steps.
  // When empty (common — compute steps may not persist flagged arrays), fall back
  // to at_risk_deals which come from the authoritative Claude assessment.
  const effective_deals = flagged_deals.length > 0 ? flagged_deals : at_risk_deals;
  const total_risk_value = effective_deals.reduce(
    (sum: number, d: any) => sum + (Number(d.amount) || 0), 0
  );
  const critical_count = effective_deals.filter(
    (d: any) => (d.risk_severity === 'critical') || (d.risk_score || 0) >= 80
  ).length;

  const avg_days_stale = flagged_deals.length > 0 && flagged_deals[0].days_stale !== undefined
    ? Math.round(flagged_deals.reduce((sum: number, d: any) => sum + (d.days_stale || 0), 0) / flagged_deals.length)
    : 0;

  const headline = effective_deals.length > 0
    ? `${effective_deals.length} deals at risk totaling ${formatCurrency(total_risk_value)}`
    : 'No deals flagged at risk';

  // top_findings: prefer flagged_deals format, fall back to at_risk_deals
  const top_findings: string[] = flagged_deals.length > 0
    ? flagged_deals.slice(0, 3).map((d: any) =>
        `${d.name}: ${formatCurrency(d.amount || 0)} — ${d.risk_reason || 'unknown'}`
      )
    : at_risk_deals.slice(0, 3).map((d: any) =>
        `${d.name}: ${formatCurrency(d.amount)} — ${(d.risk_factors || []).join('; ')}`
      );

  // top_actions: prefer flagged_deals format, fall back to at_risk_deals
  const top_actions: ActionSummary[] = flagged_deals.length > 0
    ? flagged_deals.slice(0, 3).map((d: any) => ({
        urgency: d.risk_severity === 'critical' ? 'today' as const : 'this_week' as const,
        text: d.recommended_action || `Review ${d.name}`,
        deal_name: d.name,
        deal_id: d.id,
        source_id: d.source_id,
      }))
    : at_risk_deals.slice(0, 3).map((d: any) => ({
        urgency: (d.risk_score || 0) >= 80 ? 'today' as const : 'this_week' as const,
        text: d.recommended_action || `Review ${d.name}`,
        deal_name: d.name,
        deal_id: undefined,
        source_id: undefined,
      }));

  return {
    skill_id: 'deal-risk-review',
    headline,
    key_metrics: {
      deals_at_risk: effective_deals.length,
      value_at_risk: total_risk_value,
      avg_days_stale,
      critical_count,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal: effective_deals.length > 0,
    at_risk_deals: at_risk_deals.length > 0 ? at_risk_deals : undefined,
  };
}

function summarizeRepScorecard(resultData: any, outputData?: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
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

function summarizePipelineHygiene(resultData: any, outputData?: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  // Try to extract stale deals from multiple possible locations in result_data
  let stale_deals = safeGet(resultData, 'stale_deals', []) ||
                    safeGet(resultData, 'stale_deals_agg.topDeals', []) || [];

  const stale_count = stale_deals.length;
  const stale_value = stale_deals.reduce((sum: number, d: any) => sum + (d.amount || 0), 0);

  const missing_amounts = safeGet(resultData, 'missing_amounts.count', 0) || 0;
  const closing_soon_stale = stale_deals.filter((d: any) => {
    const daysToClose = d.days_to_close || d.daysToClose || 999;
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
    top_findings.push(`${deal.name || deal.dealName}: ${deal.days_stale || deal.daysStale || '?'} days stale, closes ${deal.close_date || deal.closeDate || 'unknown'}`);
  });

  const top_actions: ActionSummary[] = [];
  stale_deals.slice(0, 3).forEach((deal: any) => {
    top_actions.push({
      urgency: (deal.days_to_close || deal.daysToClose || 999) < 30 ? 'today' : 'this_week',
      text: `Re-engage ${deal.name || deal.dealName} (${deal.days_stale || deal.daysStale || '?'} days stale)`,
      deal_name: deal.name || deal.dealName,
      deal_id: deal.id || deal.dealId,
      source_id: deal.source_id || deal.sourceId,
    });
  });

  // Extract stale deals for Orchestrator named deals block
  const stale_deals_formatted = stale_deals.slice(0, 5).map((d: any) => ({
    name: d.name || d.dealName || 'Unknown',
    amount: Number(d.amount) || 0,
    owner: d.owner || 'Unknown',
    stage: d.stage || 'Unknown',
    days_stale: d.days_stale || d.daysStale || 0,
    last_activity_date: d.last_activity_date || d.lastActivityDate || '',
  }));

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
    stale_deals: stale_deals_formatted.length > 0 ? stale_deals_formatted : undefined,
  };
}

function summarizeSingleThreadAlert(resultData: any, outputData?: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
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

function summarizePipelineCoverage(resultData: any, outputData?: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
  // Data lives under coverage_data.team (flat keys on old runs, nested on new runs)
  const total_pipeline =
    safeGet(resultData, 'coverage_data.team.totalPipeline', null) ??
    safeGet(resultData, 'total_pipeline', 0) ?? 0;
  const total_quota =
    safeGet(resultData, 'coverage_data.team.totalQuota', null) ??
    safeGet(resultData, 'total_quota', 0) ?? 0;
  const target_ratio =
    safeGet(resultData, 'coverage_data.team.coverageTarget', null) ??
    safeGet(resultData, 'target_ratio', 3) ?? 3;
  const days_remaining = safeGet(resultData, 'coverage_data.team.daysRemaining', null);
  const closed_won =
    safeGet(resultData, 'coverage_data.team.closedWon', null) ??
    safeGet(resultData, 'closed_won', 0) ?? 0;
  const deal_count = safeGet(resultData, 'coverage_data.team.dealCount', 0) ?? 0;
  const reps: any[] = safeGet(resultData, 'coverage_data.reps', []) ?? [];

  // coverageRatio may be null when rep-level quotas are absent — compute from totals
  const stored_ratio = safeGet(resultData, 'coverage_data.team.coverageRatio', null);
  const coverage_ratio: number =
    stored_ratio != null ? stored_ratio
    : (total_quota > 0 ? total_pipeline / total_quota : 0);

  // Gap to coverage target (not just quota)
  const gap_amount = total_quota > 0
    ? Math.max(0, (total_quota * target_ratio) - total_pipeline)
    : safeGet(resultData, 'gap_amount', 0) ?? 0;

  const has_data = (total_pipeline as number) > 0 || (closed_won as number) > 0;
  const above_target = coverage_ratio >= target_ratio;

  const headline = has_data
    ? `${coverage_ratio.toFixed(2)}x pipeline coverage — ${above_target ? 'above' : 'below'} ${target_ratio.toFixed(1)}x target`
    : 'No pipeline data available';

  const top_findings: string[] = [];
  if (has_data) {
    top_findings.push(`${formatCurrency(total_pipeline as number)} open pipeline, ${deal_count} deals`);
    if ((total_quota as number) > 0) {
      top_findings.push(`${formatCurrency(gap_amount)} gap to ${target_ratio.toFixed(1)}x coverage target`);
    }
    if ((closed_won as number) > 0) {
      top_findings.push(`${formatCurrency(closed_won as number)} closed-won this quarter`);
    }
    if (days_remaining !== null) {
      top_findings.push(`${days_remaining} days remaining in quarter`);
    }
    reps.slice(0, 2).forEach((rep: any) => {
      if (rep.pipeline > 0 || rep.closedWon > 0) {
        top_findings.push(`${rep.name}: ${formatCurrency(rep.pipeline || 0)} pipeline, ${formatCurrency(rep.closedWon || 0)} closed-won`);
      }
    });
  }

  const top_actions: ActionSummary[] = [];
  if (!above_target && (total_quota as number) > 0) {
    top_actions.push({
      urgency: 'this_week',
      text: `Close pipeline gap — need ${formatCurrency(gap_amount)} more to reach ${target_ratio.toFixed(1)}x coverage`,
    });
  }
  reps.slice(0, 2).forEach((rep: any) => {
    if (rep.pipeline > 0) {
      top_actions.push({
        urgency: 'this_week',
        text: `Review ${rep.name}: ${formatCurrency(rep.pipeline)} open pipeline`,
        rep_name: rep.name,
        owner_email: rep.email,
      });
    }
  });

  // Build rep pipeline breakdown for chart generation (top 6 reps with pipeline)
  const rep_pipeline_json = JSON.stringify(
    reps
      .filter((r: any) => (r.pipeline || 0) > 0 || (r.closedWon || 0) > 0)
      .slice(0, 6)
      .map((r: any) => ({
        name: (r.name || r.email || 'Unknown').split(' ')[0], // First name only for chart labels
        pipeline: Math.round((r.pipeline || 0) / 1000),        // $K
        closedWon: Math.round((r.closedWon || 0) / 1000),
      }))
  );

  // Calculate rep concentration — fraction of pipeline held by top rep (0-1)
  const sortedReps = [...reps].sort((a, b) => (b.pipeline || 0) - (a.pipeline || 0));
  const topRepPipeline = sortedReps[0]?.pipeline || 0;
  const rep_concentration = (total_pipeline as number) > 0
    ? topRepPipeline / (total_pipeline as number)
    : 0;

  return {
    skill_id: 'pipeline-coverage',
    headline,
    key_metrics: {
      coverage_ratio,
      target_ratio,
      total_pipeline,
      total_quota,
      gap_amount,
      closed_won,
      deal_count,
      rep_pipeline_json,
      rep_concentration,
    },
    top_findings: top_findings.slice(0, 5),
    top_actions: top_actions.slice(0, 3),
    has_signal: has_data,
  };
}

function summarizeDataQualityAudit(resultData: any, outputData?: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
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

function summarizeWeeklyRecap(resultData: any, outputData?: any): Omit<SkillSummary, 'ran_at' | 'data_age_hours'> {
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

const SUMMARIZER_MAP: Record<string, (data: any, output?: any) => Omit<SkillSummary, 'ran_at' | 'data_age_hours'>> = {
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
    // output column = final narrative/synthesis output (for deal-risk-review)
    const linked = await query(`
      SELECT sr.result, sr.output, sr.started_at
      FROM agent_skill_runs asr
      JOIN skill_runs sr ON sr.run_id = asr.skill_run_id
      WHERE asr.agent_run_id = $1
        AND asr.workspace_id = $2
        AND asr.skill_id = $3
        AND sr.status IN ('completed', 'partial')
      LIMIT 1
    `, [agentRunId, workspaceId, skillId]);

    let outputData: any = null;

    if (linked.rows.length > 0) {
      resultData = linked.rows[0].result;
      outputData = linked.rows[0].output;
      ranAt = linked.rows[0].started_at;
    } else {
      // Fallback: most recent successful run within 7 days.
      // Prefer runs that have result data (result IS NOT NULL) — agent-phase runs
      // often write to output only; scheduler runs write to both result and output.
      // Using result-first ordering ensures we get the richer structured data for
      // summarizers that rely on result (forecast-rollup, pipeline-waterfall, etc.),
      // while output-only runs still work for skills like deal-risk-review.
      const fallback = await query(`
        SELECT result, output, started_at
        FROM skill_runs
        WHERE workspace_id = $1
          AND skill_id = $2
          AND status IN ('completed', 'partial')
          AND started_at > NOW() - INTERVAL '7 days'
        ORDER BY (result IS NOT NULL)::int DESC, started_at DESC
        LIMIT 1
      `, [workspaceId, skillId]);

      if (fallback.rows.length > 0) {
        resultData = fallback.rows[0].result;
        outputData = fallback.rows[0].output;
        ranAt = fallback.rows[0].started_at;
      }
    }

    if (!ranAt || (!resultData && !outputData)) {
      // Skill didn't run or has no data at all — omit from summaries silently
      continue;
    }

    const summarizer = SUMMARIZER_MAP[skillId];
    if (!summarizer) continue;

    const partial = summarizer(resultData, outputData);
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
  console.log(`[SkillSummarizers] ${summaries.length}/${skillIds.length} skills resolved: ${summaries.map(s => s.skill_id).join(', ') || 'none'}`);
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
