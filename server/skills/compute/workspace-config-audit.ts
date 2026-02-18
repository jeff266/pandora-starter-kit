import { query } from '../../db.js';
import { configLoader } from '../../config/workspace-config-loader.js';
import { addConfigSuggestion } from '../../config/config-suggestions.js';

export interface AuditFinding {
  check: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  evidence: Record<string, any>;
  suggestion?: {
    section: string;
    path: string;
    type: 'confirm' | 'adjust' | 'add' | 'remove' | 'alert';
    suggested_value?: any;
    confidence: number;
  };
}

export interface ConfigAuditResult {
  workspace_id: string;
  run_at: string;
  config_confirmed: boolean;
  findings: AuditFinding[];
  checks_run: number;
  checks_passed: number;
  checks_with_findings: number;
  summary: {
    critical: number;
    warning: number;
    info: number;
  };
}

export async function runConfigAudit(workspaceId: string): Promise<ConfigAuditResult> {
  console.log(`[ConfigAudit] Starting audit for workspace ${workspaceId}`);
  const config = await configLoader.getConfig(workspaceId);
  const findings: AuditFinding[] = [];

  const checks = [
    () => checkRosterDrift(workspaceId, config),
    () => checkStageDrift(workspaceId, config),
    () => checkVelocityShift(workspaceId, config),
    () => checkWinRateShift(workspaceId, config),
    () => checkSegmentationDrift(workspaceId, config),
    () => checkCoverageTargetAlignment(workspaceId, config),
    () => checkStaleThresholdCalibration(workspaceId, config),
    () => checkFieldFillRates(workspaceId, config),
  ];

  let checksRun = 0;
  let checksPassed = 0;

  for (const check of checks) {
    try {
      checksRun++;
      const result = await check();
      if (result.length === 0) {
        checksPassed++;
      } else {
        findings.push(...result);
      }
    } catch (err) {
      console.error(`[ConfigAudit] Check failed:`, err);
    }
  }

  for (const finding of findings) {
    if (finding.suggestion) {
      try {
        await addConfigSuggestion(workspaceId, {
          source_skill: 'workspace-config-audit',
          section: finding.suggestion.section,
          path: finding.suggestion.path,
          type: finding.suggestion.type,
          message: finding.message,
          evidence: JSON.stringify(finding.evidence),
          confidence: finding.suggestion.confidence,
          suggested_value: finding.suggestion.suggested_value,
        });
      } catch (err) {
        console.error(`[ConfigAudit] Failed to add suggestion:`, err);
      }
    }
  }

  const summary = {
    critical: findings.filter(f => f.severity === 'critical').length,
    warning: findings.filter(f => f.severity === 'warning').length,
    info: findings.filter(f => f.severity === 'info').length,
  };

  console.log(`[ConfigAudit] Completed: ${checksRun} checks, ${checksPassed} passed, ${findings.length} findings (${summary.critical}C/${summary.warning}W/${summary.info}I)`);

  return {
    workspace_id: workspaceId,
    run_at: new Date().toISOString(),
    config_confirmed: config.confirmed || false,
    findings,
    checks_run: checksRun,
    checks_passed: checksPassed,
    checks_with_findings: checksRun - checksPassed,
    summary,
  };
}

async function checkRosterDrift(workspaceId: string, config: any): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const knownPeople = new Set([
    ...config.teams.roles.flatMap((r: any) => r.members || []),
    ...config.teams.excluded_owners,
  ].map((e: string) => e.toLowerCase()));

  const result = await query<{
    owner: string;
    deal_count: number;
    total_amount: number;
  }>(
    `SELECT owner, COUNT(*)::int as deal_count,
            COALESCE(SUM(amount), 0)::numeric as total_amount
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       AND owner IS NOT NULL
     GROUP BY owner
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC`,
    [workspaceId]
  );

  const unknownReps = result.rows.filter(
    r => r.owner && !knownPeople.has(r.owner.toLowerCase())
  );

  if (unknownReps.length > 0) {
    const severity = unknownReps.length >= 3 ? 'critical' as const : 'warning' as const;
    findings.push({
      check: 'roster_drift',
      severity,
      message: `${unknownReps.length} deal owner(s) not in any team role or exclusion list: ${unknownReps.slice(0, 5).map(r => r.owner).join(', ')}`,
      evidence: {
        unknown_reps: unknownReps.slice(0, 10).map(r => ({
          name: r.owner,
          open_deals: r.deal_count,
          pipeline_value: Number(r.total_amount),
        })),
        total_unknown: unknownReps.length,
      },
      suggestion: {
        section: 'teams',
        path: 'teams.roles',
        type: 'add',
        suggested_value: unknownReps.slice(0, 5).map(r => r.owner),
        confidence: 0.85,
      },
    });
  }

  const staleMembers: string[] = [];
  for (const role of config.teams.roles || []) {
    for (const member of role.members || []) {
      const hasDeals = result.rows.some(
        r => r.owner?.toLowerCase() === member.toLowerCase()
      );
      if (!hasDeals) {
        const closedRecently = await query<{ cnt: number }>(
          `SELECT COUNT(*)::int as cnt FROM deals
           WHERE workspace_id = $1 AND owner = $2
             AND close_date >= NOW() - INTERVAL '90 days'`,
          [workspaceId, member]
        );
        if ((closedRecently.rows[0]?.cnt || 0) === 0) {
          staleMembers.push(member);
        }
      }
    }
  }

  if (staleMembers.length > 0) {
    findings.push({
      check: 'roster_stale_members',
      severity: 'info',
      message: `${staleMembers.length} team member(s) have no open deals and no closes in 90 days: ${staleMembers.slice(0, 5).join(', ')}`,
      evidence: { stale_members: staleMembers },
      suggestion: {
        section: 'teams',
        path: 'teams.excluded_owners',
        type: 'alert',
        confidence: 0.6,
      },
    });
  }

  return findings;
}

async function checkStageDrift(workspaceId: string, config: any): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const configuredStages = new Set<string>();
  for (const pipeline of config.pipelines || []) {
    Object.keys(pipeline.stage_probabilities || {}).forEach(s => configuredStages.add(s));
    (pipeline.loss_values || []).forEach((s: string) => configuredStages.add(s));
    (pipeline.disqualified_values || []).forEach((s: string) => configuredStages.add(s));
  }
  (config.win_rate?.won_values || []).forEach((s: string) => configuredStages.add(s));
  (config.win_rate?.lost_values || []).forEach((s: string) => configuredStages.add(s));
  (config.win_rate?.excluded_values || []).forEach((s: string) => configuredStages.add(s));

  const result = await query<{ stage: string; deal_count: number }>(
    `SELECT stage_normalized as stage, COUNT(*)::int as deal_count
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IS NOT NULL
       AND created_at >= NOW() - INTERVAL '90 days'
     GROUP BY stage_normalized
     ORDER BY COUNT(*) DESC`,
    [workspaceId]
  );

  const unknownStages = result.rows.filter(
    r => r.stage && !configuredStages.has(r.stage) && r.deal_count >= 3
  );

  if (unknownStages.length > 0) {
    findings.push({
      check: 'stage_drift',
      severity: unknownStages.some(s => s.deal_count >= 10) ? 'critical' : 'warning',
      message: `${unknownStages.length} stage value(s) in CRM not mapped in config: ${unknownStages.map(s => `"${s.stage}" (${s.deal_count} deals)`).join(', ')}`,
      evidence: {
        unmapped_stages: unknownStages,
        configured_stages: [...configuredStages],
      },
      suggestion: {
        section: 'pipelines',
        path: 'pipelines[0].stage_probabilities',
        type: 'add',
        suggested_value: Object.fromEntries(unknownStages.map(s => [s.stage, 0])),
        confidence: 0.75,
      },
    });
  }

  return findings;
}

async function checkVelocityShift(workspaceId: string, _config: any): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const result = await query<{
    period: string;
    avg_days: number;
    deal_count: number;
  }>(
    `SELECT
       CASE WHEN close_date >= NOW() - INTERVAL '30 days' THEN 'recent'
            ELSE 'prior' END as period,
       AVG(close_date::date - created_at::date)::int as avg_days,
       COUNT(*)::int as deal_count
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND close_date >= NOW() - INTERVAL '90 days'
     GROUP BY 1`,
    [workspaceId]
  );

  const recent = result.rows.find(r => r.period === 'recent');
  const prior = result.rows.find(r => r.period === 'prior');

  if (recent && prior && recent.deal_count >= 5 && prior.deal_count >= 5) {
    const shift = recent.avg_days - prior.avg_days;
    const shiftPct = Math.abs(shift) / Math.max(prior.avg_days, 1);

    if (shiftPct > 0.25) {
      findings.push({
        check: 'velocity_shift',
        severity: shiftPct > 0.50 ? 'warning' : 'info',
        message: `Sales cycle ${shift > 0 ? 'slowed' : 'accelerated'} by ${Math.abs(shift)} days (${(shiftPct * 100).toFixed(0)}%): recent ${recent.avg_days}d vs prior ${prior.avg_days}d`,
        evidence: {
          recent_avg_days: recent.avg_days,
          prior_avg_days: prior.avg_days,
          shift_days: shift,
          shift_pct: shiftPct,
          recent_deals: recent.deal_count,
          prior_deals: prior.deal_count,
        },
      });
    }
  }

  return findings;
}

async function checkWinRateShift(workspaceId: string, config: any): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const wonValues = config.win_rate?.won_values || ['closed_won'];
  const lostValues = config.win_rate?.lost_values || ['closed_lost'];

  const result = await query<{
    period: string;
    won: number;
    lost: number;
    total: number;
  }>(
    `SELECT
       CASE WHEN close_date >= NOW() - INTERVAL '30 days' THEN 'recent'
            ELSE 'prior' END as period,
       COUNT(*) FILTER (WHERE stage_normalized = ANY($2))::int as won,
       COUNT(*) FILTER (WHERE stage_normalized = ANY($3))::int as lost,
       COUNT(*)::int as total
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IN (SELECT UNNEST($2::text[] || $3::text[]))
       AND close_date >= NOW() - INTERVAL '90 days'
     GROUP BY 1`,
    [workspaceId, wonValues, lostValues]
  );

  const recent = result.rows.find(r => r.period === 'recent');
  const prior = result.rows.find(r => r.period === 'prior');

  if (recent && prior && recent.total >= 5 && prior.total >= 5) {
    const recentRate = recent.won / Math.max(recent.won + recent.lost, 1);
    const priorRate = prior.won / Math.max(prior.won + prior.lost, 1);
    const shiftPp = (recentRate - priorRate) * 100;

    if (Math.abs(shiftPp) > 10) {
      findings.push({
        check: 'win_rate_shift',
        severity: Math.abs(shiftPp) > 20 ? 'critical' : 'warning',
        message: `Win rate ${shiftPp > 0 ? 'improved' : 'declined'} by ${Math.abs(shiftPp).toFixed(0)}pp: recent ${(recentRate * 100).toFixed(0)}% vs prior ${(priorRate * 100).toFixed(0)}%`,
        evidence: {
          recent_rate: recentRate,
          prior_rate: priorRate,
          shift_pp: shiftPp,
          recent_sample: recent.total,
          prior_sample: prior.total,
        },
        suggestion: {
          section: 'win_rate',
          path: 'win_rate.current_rate',
          type: 'adjust',
          suggested_value: recentRate,
          confidence: 0.8,
        },
      });
    }
  }

  return findings;
}

async function checkSegmentationDrift(workspaceId: string, config: any): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const result = await query<{
    bucket: string;
    deal_count: number;
    total_amount: number;
  }>(
    `SELECT
       CASE
         WHEN amount < 10000 THEN 'small (<$10K)'
         WHEN amount < 50000 THEN 'mid ($10K-$50K)'
         WHEN amount < 200000 THEN 'large ($50K-$200K)'
         ELSE 'enterprise ($200K+)'
       END as bucket,
       COUNT(*)::int as deal_count,
       COALESCE(SUM(amount), 0)::numeric as total_amount
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       AND amount > 0
     GROUP BY 1
     ORDER BY MIN(amount)`,
    [workspaceId]
  );

  if (result.rows.length >= 3) {
    const totalDeals = result.rows.reduce((s, r) => s + r.deal_count, 0);
    const dominant = result.rows.find(r => r.deal_count / totalDeals > 0.6);
    const tiny = result.rows.filter(r => r.deal_count / totalDeals < 0.05);

    if (dominant && tiny.length > 0) {
      findings.push({
        check: 'segmentation_drift',
        severity: 'info',
        message: `Pipeline heavily concentrated in "${dominant.bucket}" (${((dominant.deal_count / totalDeals) * 100).toFixed(0)}% of deals). Consider segment-specific thresholds.`,
        evidence: {
          distribution: result.rows.map(r => ({
            bucket: r.bucket,
            deals: r.deal_count,
            pct: ((r.deal_count / totalDeals) * 100).toFixed(1) + '%',
            value: Number(r.total_amount),
          })),
        },
        suggestion: {
          section: 'thresholds',
          path: 'thresholds.stale_deal_days',
          type: 'alert',
          confidence: 0.5,
        },
      });
    }
  }

  return findings;
}

async function checkCoverageTargetAlignment(workspaceId: string, config: any): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const coverageTarget = config.thresholds?.coverage_target || 3.0;

  const result = await query<{
    open_pipeline: number;
    monthly_quota: number;
    trailing_won: number;
  }>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0)::numeric FROM deals
        WHERE workspace_id = $1
          AND stage_normalized NOT IN ('closed_won', 'closed_lost')) as open_pipeline,
       (SELECT COALESCE(AVG(monthly_won), 0)::numeric FROM (
         SELECT DATE_TRUNC('month', close_date) as month, SUM(amount) as monthly_won
         FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won'
           AND close_date >= NOW() - INTERVAL '3 months'
         GROUP BY 1
       ) sub) as monthly_quota,
       (SELECT COALESCE(SUM(amount), 0)::numeric FROM deals
        WHERE workspace_id = $1 AND stage_normalized = 'closed_won'
          AND close_date >= NOW() - INTERVAL '6 months') as trailing_won`,
    [workspaceId]
  );

  const row = result.rows[0];
  if (row && Number(row.monthly_quota) > 0) {
    const actualCoverage = Number(row.open_pipeline) / Number(row.monthly_quota);
    const gap = actualCoverage - coverageTarget;

    if (gap < -1.0) {
      findings.push({
        check: 'coverage_target_alignment',
        severity: gap < -2.0 ? 'critical' : 'warning',
        message: `Pipeline coverage at ${actualCoverage.toFixed(1)}x vs ${coverageTarget}x target. ${Math.abs(gap).toFixed(1)}x gap — coverage target may be unrealistic for current pipeline generation capacity.`,
        evidence: {
          actual_coverage: actualCoverage,
          target_coverage: coverageTarget,
          open_pipeline: Number(row.open_pipeline),
          monthly_quota: Number(row.monthly_quota),
          gap: gap,
        },
        suggestion: {
          section: 'thresholds',
          path: 'thresholds.coverage_target',
          type: 'adjust',
          suggested_value: Math.max(1.5, Math.round(actualCoverage * 2) / 2),
          confidence: 0.65,
        },
      });
    } else if (gap > 2.0) {
      findings.push({
        check: 'coverage_target_alignment',
        severity: 'info',
        message: `Pipeline coverage at ${actualCoverage.toFixed(1)}x significantly exceeds ${coverageTarget}x target. Coverage target may be too conservative.`,
        evidence: {
          actual_coverage: actualCoverage,
          target_coverage: coverageTarget,
          open_pipeline: Number(row.open_pipeline),
          monthly_quota: Number(row.monthly_quota),
        },
        suggestion: {
          section: 'thresholds',
          path: 'thresholds.coverage_target',
          type: 'adjust',
          suggested_value: Math.round(actualCoverage * 2) / 2,
          confidence: 0.55,
        },
      });
    }
  }

  return findings;
}

async function checkStaleThresholdCalibration(workspaceId: string, config: any): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const threshold = typeof config.thresholds?.stale_deal_days === 'number'
    ? config.thresholds.stale_deal_days
    : config.thresholds?.stale_deal_days?.default || 14;

  const result = await query<{
    total_open: number;
    stale_count: number;
    p50_days: number;
    p75_days: number;
    p90_days: number;
  }>(
    `SELECT
       COUNT(*)::int as total_open,
       COUNT(*) FILTER (WHERE last_activity_date < NOW() - INTERVAL '${threshold} days')::int as stale_count,
       PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY CURRENT_DATE - COALESCE(last_activity_date, created_at)::date)::int as p50_days,
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY CURRENT_DATE - COALESCE(last_activity_date, created_at)::date)::int as p75_days,
       PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY CURRENT_DATE - COALESCE(last_activity_date, created_at)::date)::int as p90_days
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId]
  );

  const row = result.rows[0];
  if (row && row.total_open >= 10) {
    const stalePct = row.stale_count / row.total_open;

    if (stalePct > 0.7) {
      findings.push({
        check: 'stale_threshold_too_tight',
        severity: 'warning',
        message: `${(stalePct * 100).toFixed(0)}% of open deals are flagged stale (threshold: ${threshold} days). p50=${row.p50_days}d, p75=${row.p75_days}d. Threshold may be too aggressive for your sales cycle.`,
        evidence: {
          threshold,
          stale_pct: stalePct,
          stale_count: row.stale_count,
          total_open: row.total_open,
          p50: row.p50_days,
          p75: row.p75_days,
          p90: row.p90_days,
        },
        suggestion: {
          section: 'thresholds',
          path: 'thresholds.stale_deal_days',
          type: 'adjust',
          suggested_value: row.p75_days,
          confidence: 0.8,
        },
      });
    } else if (stalePct < 0.05 && row.total_open >= 20) {
      findings.push({
        check: 'stale_threshold_too_loose',
        severity: 'info',
        message: `Only ${(stalePct * 100).toFixed(0)}% of deals flagged stale (threshold: ${threshold} days). Threshold may be too lenient. p50=${row.p50_days}d.`,
        evidence: {
          threshold,
          stale_pct: stalePct,
          stale_count: row.stale_count,
          total_open: row.total_open,
          p50: row.p50_days,
          p75: row.p75_days,
        },
        suggestion: {
          section: 'thresholds',
          path: 'thresholds.stale_deal_days',
          type: 'adjust',
          suggested_value: Math.max(7, row.p50_days),
          confidence: 0.6,
        },
      });
    }
  }

  return findings;
}

async function checkFieldFillRates(workspaceId: string, config: any): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const result = await query<{
    total: number;
    has_amount: number;
    has_close_date: number;
    has_owner: number;
    has_stage: number;
    has_contact: number;
  }>(
    `SELECT
       COUNT(*)::int as total,
       COUNT(*) FILTER (WHERE amount IS NOT NULL AND amount > 0)::int as has_amount,
       COUNT(*) FILTER (WHERE close_date IS NOT NULL)::int as has_close_date,
       COUNT(*) FILTER (WHERE owner IS NOT NULL)::int as has_owner,
       COUNT(*) FILTER (WHERE stage IS NOT NULL)::int as has_stage,
       (SELECT COUNT(DISTINCT deal_id)::int FROM deal_contacts WHERE workspace_id = $1) as has_contact
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId]
  );

  const row = result.rows[0];
  if (row && row.total >= 10) {
    const fields = [
      { name: 'amount', filled: row.has_amount, required: true },
      { name: 'close_date', filled: row.has_close_date, required: true },
      { name: 'owner', filled: row.has_owner, required: true },
      { name: 'stage', filled: row.has_stage, required: true },
      { name: 'contacts', filled: row.has_contact, required: false },
    ];

    const lowFill = fields.filter(f => {
      const rate = f.filled / row.total;
      return f.required ? rate < 0.9 : rate < 0.5;
    });

    if (lowFill.length > 0) {
      const configuredRequired = (config.thresholds?.required_fields || []).map(
        (f: any) => f.field
      );

      const unconfiguredLow = lowFill.filter(
        f => f.required && !configuredRequired.includes(f.name)
      );

      findings.push({
        check: 'field_fill_rates',
        severity: lowFill.some(f => f.required && f.filled / row.total < 0.7) ? 'critical' : 'warning',
        message: `Data quality gaps: ${lowFill.map(f => `${f.name} ${((f.filled / row.total) * 100).toFixed(0)}%`).join(', ')} fill rate on ${row.total} open deals`,
        evidence: {
          total_deals: row.total,
          fill_rates: fields.map(f => ({
            field: f.name,
            filled: f.filled,
            rate: ((f.filled / row.total) * 100).toFixed(1) + '%',
            required: f.required,
          })),
          unconfigured_required: unconfiguredLow.map(f => f.name),
        },
        suggestion: unconfiguredLow.length > 0 ? {
          section: 'thresholds',
          path: 'thresholds.required_fields',
          type: 'add',
          suggested_value: unconfiguredLow.map(f => ({ field: f.name, object: 'deals' })),
          confidence: 0.75,
        } : undefined,
      });
    }
  }

  return findings;
}

export async function getAuditHistory(workspaceId: string, limit: number = 12): Promise<any[]> {
  const result = await query<{
    run_id: string;
    started_at: string;
    completed_at: string;
    status: string;
    result: any;
    output_text: string;
    duration_ms: number;
  }>(
    `SELECT run_id, started_at, completed_at, status, result, output_text, duration_ms
     FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = 'workspace-config-audit'
     ORDER BY started_at DESC
     LIMIT $2`,
    [workspaceId, limit]
  );

  return result.rows.map(row => {
    const reportText = row.result?.report || row.output_text || '';
    const healthMatch = reportText.match(/\*\*(Healthy|Needs Attention|Critical)\*\*/i);
    return {
      run_id: row.run_id,
      started_at: row.started_at,
      completed_at: row.completed_at,
      status: row.status,
      duration_ms: row.duration_ms,
      health: healthMatch ? healthMatch[1] : null,
      report_preview: reportText.substring(0, 200) || null,
    };
  });
}
