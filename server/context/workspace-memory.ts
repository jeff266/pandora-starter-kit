import { query } from '../db.js';
import { getPandoraRole, getTargetWhereClause } from './pandora-role.js';
import { getLatestReadyBrief } from '../briefing/brief-resolver.js';

interface CacheEntry {
  block: string;
  ts: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export function clearWorkspaceMemoryCache(workspaceId?: string): void {
  if (workspaceId) {
    // Clear all cache keys for this workspace (covers per-user variants)
    for (const key of cache.keys()) {
      if (key === workspaceId || key.startsWith(`${workspaceId}:`)) {
        cache.delete(key);
      }
    }
  } else {
    cache.clear();
  }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export async function buildWorkspaceContextBlock(workspaceId: string, userId?: string): Promise<string> {
  const cacheKey = userId ? `${workspaceId}:${userId}` : workspaceId;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.block;
  }

  // Resolve user visibility for targets filtering when userId provided
  let targetsWhereClause = '';
  let targetsExtraParams: any[] = [];
  if (userId) {
    const roleInfo = await getPandoraRole(workspaceId, userId).catch(() => null);
    if (roleInfo) {
      const { sql, params } = getTargetWhereClause(
        roleInfo.pandoraRole,
        roleInfo.workspaceRole,
        userId,
        roleInfo.userEmail,
        2
      );
      targetsWhereClause = sql;
      targetsExtraParams = params;
    }
  }

  const [contextRow, targetsRow, stagesRow, goalsRow, scopesRow, salesRepsRow] = await Promise.all([
    query(
      `SELECT business_model, team_structure, goals_and_targets, definitions, operational_maturity
       FROM context_layer WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    ).catch(() => null),
    query(
      `SELECT pipeline_name, amount, metric, period_label, period_start, period_end
       FROM targets WHERE workspace_id = $1 AND is_active = true ${targetsWhereClause}
       ORDER BY period_start ASC`,
      [workspaceId, ...targetsExtraParams]
    ).catch(() => null),
    query(
      `SELECT stage_name, is_active, display_order
       FROM stage_configs WHERE workspace_id = $1
       ORDER BY display_order ASC NULLS LAST, stage_name ASC`,
      [workspaceId]
    ).catch(() => null),
    query(
      `SELECT label, metric_type, target_value, period, period_start, period_end, level
       FROM goals WHERE workspace_id = $1 AND is_active = true
       ORDER BY level ASC, created_at DESC LIMIT 10`,
      [workspaceId]
    ).catch(() => null),
    query(
      `SELECT name FROM analysis_scopes WHERE workspace_id = $1 ORDER BY name`,
      [workspaceId]
    ).catch(() => null),
    query(
      `SELECT rep_name, rep_email, team, quota_eligible
       FROM sales_reps WHERE workspace_id = $1 AND is_rep = true AND pandora_role IS NOT NULL
       ORDER BY rep_name ASC`,
      [workspaceId]
    ).catch(() => null),
  ]);

  const ctx = contextRow?.rows?.[0];
  const targets = targetsRow?.rows ?? [];
  const stages = stagesRow?.rows ?? [];
  const goals = goalsRow?.rows ?? [];
  const scopes = scopesRow?.rows ?? [];

  const bm: Record<string, any> = ctx?.business_model ?? {};
  const ts: Record<string, any> = ctx?.team_structure ?? {};
  const gat: Record<string, any> = ctx?.goals_and_targets ?? {};
  const def: Record<string, any> = ctx?.definitions ?? {};

  // Extract fiscal year start month early — needed for targets classification and calendar sections
  const fyMonth = def.cadence_fiscal_year_start_month?.value ?? gat.cadence?.fiscal_year_start_month;

  const lines: string[] = ['=== WORKSPACE CONTEXT ==='];

  // Company / Business Model
  const companyParts: string[] = [];
  if (bm.company_name) companyParts.push(`Company: ${bm.company_name}`);
  if (bm.gtm_motion) companyParts.push(`GTM: ${bm.gtm_motion}`);
  if (bm.avg_deal_size) companyParts.push(`Avg deal: ${fmt(Number(bm.avg_deal_size))}`);
  if (bm.sales_cycle_days) companyParts.push(`Sales cycle: ${bm.sales_cycle_days}d`);
  if (bm.pricing_model) companyParts.push(`Pricing: ${bm.pricing_model}`);
  if (bm.icp_description) companyParts.push(`ICP: ${bm.icp_description}`);
  if (companyParts.length > 0) lines.push(companyParts.join(' | '));

  // Revenue Quotas from targets table
  if (targets.length > 0) {
    const today = new Date();

    // Classify each target by whether its period is current, upcoming, or past
    const withStatus = targets.map((t: any) => {
      const start = t.period_start ? new Date(t.period_start) : null;
      const end = t.period_end ? new Date(t.period_end) : null;
      let status: 'current' | 'upcoming' | 'past' | 'undated' = 'undated';
      if (start && end) {
        if (today >= start && today <= end) status = 'current';
        else if (today < start) status = 'upcoming';
        else status = 'past';
      }
      return { ...t, status };
    });

    const currentTargets = withStatus.filter((t: any) => t.status === 'current');
    const upcomingTargets = withStatus.filter((t: any) => t.status === 'upcoming');
    const undatedTargets = withStatus.filter((t: any) => t.status === 'undated');

    // Fiscal year note: only relevant when FY doesn't start in January
    if (fyMonth && Number(fyMonth) !== 1) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const monthName = months[Number(fyMonth) - 1] ?? fyMonth;
      lines.push('');
      lines.push(`FISCAL YEAR NOTE: This workspace's fiscal year starts in ${monthName}. Fiscal year labels (e.g. "FY2027") refer to fiscal years, NOT calendar years. "Q1 FY2027" means ${monthName} – ${months[(Number(fyMonth) + 1) % 12]} of the calendar year in which that fiscal Q1 falls. Do NOT conflate a fiscal period label with a calendar quarter of the same number.`);
    }

    lines.push('');
    lines.push('REVENUE QUOTAS:');

    if (currentTargets.length > 0) {
      lines.push('  [ACTIVE — period contains today]:');
      for (const t of currentTargets) {
        const pipelineLabel = t.pipeline_name ? t.pipeline_name : 'All Pipelines';
        const periodStr = t.period_label || (t.period_start ? `${t.period_start} to ${t.period_end}` : '');
        lines.push(`  - ${pipelineLabel} ${periodStr}: ${fmt(Number(t.amount ?? 0))} ${t.metric || 'ARR'}`);
      }
    }

    if (upcomingTargets.length > 0) {
      lines.push('  [UPCOMING — period has NOT started yet]:');
      for (const t of upcomingTargets) {
        const pipelineLabel = t.pipeline_name ? t.pipeline_name : 'All Pipelines';
        const periodStr = t.period_label || (t.period_start ? `${t.period_start} to ${t.period_end}` : '');
        lines.push(`  - ${pipelineLabel} ${periodStr}: ${fmt(Number(t.amount ?? 0))} ${t.metric || 'ARR'} (starts ${t.period_start ?? '?'})`);
      }
    }

    if (undatedTargets.length > 0) {
      lines.push('  [NO DATES SET]:');
      for (const t of undatedTargets) {
        const pipelineLabel = t.pipeline_name ? t.pipeline_name : 'All Pipelines';
        const periodStr = t.period_label || 'unknown period';
        lines.push(`  - ${pipelineLabel} ${periodStr}: ${fmt(Number(t.amount ?? 0))} ${t.metric || 'ARR'}`);
      }
    }

    // Critical scoping rules
    lines.push('');
    lines.push('ATTAINMENT SCOPING RULES (CRITICAL — follow exactly):');

    // Rule 1: Named pipelines only count their own deals
    const namedPipelines = withStatus.filter((t: any) => t.pipeline_name);
    for (const t of namedPipelines) {
      lines.push(`- The ${t.period_label ?? ''} target of ${fmt(Number(t.amount ?? 0))} applies ONLY to the "${t.pipeline_name}" pipeline. Do NOT include closed-won deals from other pipelines.`);
    }
    const unnamedTargets = withStatus.filter((t: any) => !t.pipeline_name);
    if (unnamedTargets.length === 0 && namedPipelines.length > 0) {
      lines.push('- Pipelines without a named target have NO quota. Do not compare them to any target.');
    }

    // Rule 2: Never calculate attainment against upcoming targets
    if (upcomingTargets.length > 0) {
      const upcomingLabels = upcomingTargets.map((t: any) => t.period_label ?? t.period_start ?? 'upcoming').join(', ');
      lines.push(`- UPCOMING targets (${upcomingLabels}) have NOT started. Do NOT calculate current attainment against them — their period has not begun. Report them as future targets only.`);
    }

    // Rule 3: Announce what the actual active period is
    if (currentTargets.length > 0) {
      lines.push(`- When asked about "this quarter" or "current quota", use only the ACTIVE targets listed above.`);
    } else if (upcomingTargets.length > 0) {
      lines.push(`- There is NO active quota target for today's date. The next quota period begins ${upcomingTargets[0].period_start ?? 'soon'}.`);
    }
  }

  // Goals from goals table (supplement targets)
  const structuredGoals = goals.filter((g: any) => g.metric_type && g.target_value);
  if (structuredGoals.length > 0) {
    lines.push('');
    lines.push('STRUCTURED GOALS:');
    for (const g of structuredGoals) {
      const amount = Number(g.target_value);
      const valStr = g.metric_type === 'bookings' || g.metric_type === 'revenue' ? fmt(amount) : String(amount);
      lines.push(`- ${g.label}: ${valStr} ${g.metric_type} | ${g.period || ''}`);
    }
  }

  // Pipeline thresholds from goals_and_targets and definitions
  const thresholds: string[] = [];
  const staleThreshold = gat.thresholds?.stale_deal_days ?? gat.stale_deal_days;
  if (staleThreshold) thresholds.push(`Stale deal: ${staleThreshold}d`);
  const coverageTarget = gat.pipeline_coverage_target;
  if (coverageTarget) thresholds.push(`Coverage target: ${coverageTarget}x`);
  const winRateLookback = def.win_rate_config?.value?.lookback_days;
  if (winRateLookback) thresholds.push(`Win rate lookback: ${winRateLookback}d`);
  const forecastMethod = gat.forecast_method || def.forecast_method?.value;
  if (forecastMethod) thresholds.push(`Forecast: ${forecastMethod}`);
  if (thresholds.length > 0) {
    lines.push('');
    lines.push(`PIPELINE THRESHOLDS: ${thresholds.join(' | ')}`);
  }

  // Fiscal calendar
  const calParts: string[] = [];
  const quotaPeriod = def.cadence_quota_period?.value ?? gat.cadence?.quota_period ?? gat.quota_period;
  if (quotaPeriod) calParts.push(`${quotaPeriod} quota`);
  // fyMonth already extracted above
  if (fyMonth) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    calParts.push(`FY starts ${months[Number(fyMonth) - 1] ?? fyMonth}`);
  }
  const timezone = def.cadence_timezone?.value ?? gat.cadence?.timezone;
  if (timezone) calParts.push(`TZ: ${timezone}`);
  if (calParts.length > 0) {
    lines.push('');
    lines.push(`FISCAL CALENDAR: ${calParts.join(' | ')}`);
  }

  // Revenue motions
  const motions: any[] = def.revenue_motions?.value ?? [];
  if (motions.length > 0) {
    lines.push('');
    lines.push(`REVENUE MOTIONS: ${motions.map((m: any) => m.name).join(', ')}`);
  } else if (scopes.length > 0) {
    lines.push('');
    lines.push(`ANALYSIS SCOPES: ${scopes.map((s: any) => s.name).join(', ')}`);
  }

  // Team
  // Priority: context_layer.definitions.team_roster > context_layer.team_structure > sales_reps table
  const reps: any[] = def.team_roster?.value?.reps ?? ts.reps ?? [];
  const managers: string[] = def.team_roster?.value?.managers ?? ts.managers ?? [];
  const excluded: string[] = def.team_roster?.value?.excluded_owners ?? ts.excluded_owners ?? [];
  const salesRepsDb: any[] = salesRepsRow?.rows ?? [];
  if (reps.length > 0) {
    const repNames = reps.slice(0, 5).map((r: any) => r.name ?? r).join(', ');
    const more = reps.length > 5 ? ` (+ ${reps.length - 5} more)` : '';
    lines.push('');
    lines.push(`TEAM: ${repNames}${more}`);
    if (managers.length > 0) lines.push(`MANAGERS: ${managers.join(', ')}`);
    if (excluded.length > 0) lines.push(`EXCLUDED: ${excluded.join(', ')}`);
  } else if (salesRepsDb.length > 0) {
    const eligibleCount = salesRepsDb.filter((r: any) => r.quota_eligible !== false).length;
    const eligibleNote = eligibleCount < salesRepsDb.length ? `, ${eligibleCount} quota-eligible` : '';
    const repLabels = salesRepsDb.map((r: any) => {
      const name = r.rep_name ?? 'Unknown';
      return r.rep_email ? `${name} (${r.rep_email})` : name;
    });
    const displayNames = repLabels.slice(0, 8).join(', ');
    const more = repLabels.length > 8 ? ` (+ ${repLabels.length - 8} more)` : '';
    lines.push('');
    lines.push(`SALES TEAM (${salesRepsDb.length} reps${eligibleNote}): ${displayNames}${more}`);
  }

  // Sales methodology, competitors, loss reasons, buying committee (tier-2/3 onboarding)
  const methodology = def.onboarding_Q11_methodology?.value?.methodology;
  if (methodology) {
    lines.push('');
    lines.push(`SALES METHODOLOGY: ${methodology}`);
  }

  const competitors: any[] = def.onboarding_Q15_competitors?.value?.competitors ?? [];
  if (competitors.length > 0) {
    lines.push(`COMPETITORS: ${competitors.map((c: any) => c.name ?? c).join(', ')}`);
  }

  const lossReasons: any[] = def.onboarding_Q25_loss_reasons?.value?.reasons ?? [];
  if (lossReasons.length > 0) {
    lines.push(`LOSS REASONS: ${lossReasons.map((r: any) => r.reason ?? r).join(', ')}`);
  }

  const buyingCommittee: any[] = def.onboarding_Q17_buying_committee?.value?.roles ?? [];
  if (buyingCommittee.length > 0) {
    lines.push(`BUYING COMMITTEE: ${buyingCommittee.map((r: any) => r.role ?? r).join(', ')}`);
  }

  const saoStage = def.sao_stage?.value;
  if (saoStage) lines.push(`SAO STAGE: ${saoStage}`);

  // Stage config summary
  if (stages.length > 0) {
    const activeStages = stages.filter((s: any) => s.is_active !== false).map((s: any) => s.stage_name);
    const inactiveStages = stages.filter((s: any) => s.is_active === false).map((s: any) => s.stage_name);
    if (activeStages.length > 0) {
      lines.push('');
      lines.push(`ACTIVE STAGES: ${activeStages.join(' → ')}`);
    }
    if (inactiveStages.length > 0) {
      lines.push(`PARKING LOT / EXCLUDED: ${inactiveStages.join(', ')}`);
    }
  }

  // Win rate config
  const winRateCfg = def.win_rate_config?.value;
  if (winRateCfg) {
    const wrParts: string[] = [];
    if (winRateCfg.exclude_stage_0) wrParts.push('qualified deals only');
    if (winRateCfg.segment_by_motion) wrParts.push('segmented by motion');
    if (wrParts.length > 0) lines.push('');
    if (wrParts.length > 0) lines.push(`WIN RATE CONFIG: ${wrParts.join(', ')}`);
  }

  // Inject current open deals from the latest brief so the LLM can name them directly
  try {
    const brief = await getLatestReadyBrief(workspaceId);
    const dealItems: any[] = brief?.deals_to_watch?.items || [];
    if (dealItems.length > 0) {
      const sorted = [...dealItems].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 8);
      lines.push('');
      lines.push('OPEN DEALS (current quarter, sorted by amount):');
      lines.push('| Deal | Amount | Stage | Owner |');
      lines.push('| --- | --- | --- | --- |');
      for (const d of sorted) {
        lines.push(`| ${d.name} | ${fmt(d.amount || 0)} | ${d.stage || '—'} | ${d.owner || '—'} |`);
      }
    }
  } catch {
    // Never block context generation if brief fetch fails
  }

  // ─── Current quarter date range (T005) ───────────────────────────────────────
  try {
    const fyStartMonthNum = Number(fyMonth ?? 1);
    const todayForQ = new Date();
    const todayMonth = todayForQ.getMonth() + 1;
    const todayYear = todayForQ.getFullYear();
    const monthsFromFYStart = (todayMonth - fyStartMonthNum + 12) % 12;
    const qIdx = Math.floor(monthsFromFYStart / 3);
    const qStartMonthNum = ((fyStartMonthNum - 1 + qIdx * 3) % 12) + 1;
    const qStartYearNum = qStartMonthNum > todayMonth ? todayYear - 1 : todayYear;
    const qEndDate = new Date(qStartYearNum, qStartMonthNum - 1 + 3, 0);
    const qStartStr = `${qStartYearNum}-${String(qStartMonthNum).padStart(2, '0')}-01`;
    const qEndStr = `${qEndDate.getFullYear()}-${String(qEndDate.getMonth() + 1).padStart(2, '0')}-${String(qEndDate.getDate()).padStart(2, '0')}`;
    const qNum = qIdx + 1;
    const qLabel = fyStartMonthNum === 1
      ? `Q${qNum} ${qStartYearNum}`
      : `Q${qNum} FY${qEndDate.getFullYear()}`;
    lines.push('');
    lines.push(`CURRENT QUARTER: ${qLabel} (${qStartStr} to ${qEndStr})`);
    lines.push(`When querying closed won deals for the current quarter, always filter:`);
    lines.push(`  close_date_from: ${qStartStr}  close_date_to: ${qEndStr}`);
    lines.push(`Core Sales Pipeline scope_ids: 'core-sales-pipeline' AND 'default'`);
    lines.push(`(Deals with scope_id='default' are legacy Core Sales records — include them in Core Sales totals.)`);
  } catch {
    // Non-fatal — skip quarter block if computation fails
  }

  lines.push('=== END WORKSPACE CONTEXT ===');

  // If nothing meaningful was added (only the header + footer), return empty string
  const block = lines.join('\n');
  const meaningful = lines.length > 2;

  const result = meaningful ? block : '';
  cache.set(cacheKey, { block: result, ts: Date.now() });
  return result;
}
