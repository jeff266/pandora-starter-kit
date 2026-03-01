import { query } from '../db.js';
import { getPandoraRole, getTargetWhereClause } from './pandora-role.js';

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

  const [contextRow, targetsRow, stagesRow, goalsRow, scopesRow] = await Promise.all([
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
    lines.push('');
    lines.push('REVENUE QUOTAS (active):');

    // Compute annual total by summing all active targets
    const annualTotal = targets.reduce((sum: number, t: any) => sum + Number(t.amount ?? 0), 0);

    // Check if all targets share the same pipeline name
    const pipelineNames = [...new Set(targets.map((t: any) => t.pipeline_name).filter(Boolean))];
    const sharedPipeline = pipelineNames.length === 1 ? pipelineNames[0] : null;

    // Show annual total line when there are multiple targets (otherwise it's redundant)
    if (targets.length > 1 && annualTotal > 0) {
      const breakdownParts = targets
        .map((t: any) => `${t.period_label ?? 'period'} ${fmt(Number(t.amount ?? 0))}`)
        .join(' + ');
      const pipelinePrefix = sharedPipeline ? `${sharedPipeline} — ` : '';
      lines.push(`- ${pipelinePrefix}FY Annual Total: ${fmt(annualTotal)} (${breakdownParts})`);
    }

    // Individual quarter lines
    for (const t of targets) {
      const pipelineLabel = t.pipeline_name ? t.pipeline_name : 'All Pipelines';
      const amountStr = t.amount != null ? fmt(Number(t.amount)) : '?';
      const metricStr = t.metric || 'ARR';
      const periodStr = t.period_label || (t.period_start ? `${t.period_start} to ${t.period_end}` : '');
      lines.push(`- ${pipelineLabel} ${periodStr}: ${amountStr} ${metricStr}`);
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
  const fyMonth = def.cadence_fiscal_year_start_month?.value ?? gat.cadence?.fiscal_year_start_month;
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
  const reps: any[] = def.team_roster?.value?.reps ?? ts.reps ?? [];
  const managers: string[] = def.team_roster?.value?.managers ?? ts.managers ?? [];
  const excluded: string[] = def.team_roster?.value?.excluded_owners ?? ts.excluded_owners ?? [];
  if (reps.length > 0) {
    const repNames = reps.slice(0, 5).map((r: any) => r.name ?? r).join(', ');
    const more = reps.length > 5 ? ` (+ ${reps.length - 5} more)` : '';
    lines.push('');
    lines.push(`TEAM: ${repNames}${more}`);
    if (managers.length > 0) lines.push(`MANAGERS: ${managers.join(', ')}`);
    if (excluded.length > 0) lines.push(`EXCLUDED: ${excluded.join(', ')}`);
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

  lines.push('=== END WORKSPACE CONTEXT ===');

  // If nothing meaningful was added (only the header + footer), return empty string
  const block = lines.join('\n');
  const meaningful = lines.length > 2;

  const result = meaningful ? block : '';
  cache.set(cacheKey, { block: result, ts: Date.now() });
  return result;
}
