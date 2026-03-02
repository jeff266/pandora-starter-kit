import { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { getPandoraRole, getHeadlineTarget, type PandolaRole } from './pandora-role.js';

// ===== TYPES =====

export interface TemporalContext {
  dayOfWeek: string;
  dayOfWeekNumber: number;
  isWeekStart: boolean;
  isWeekEnd: boolean;
  isWeekend: boolean;
  weekOfMonth: number;
  dayOfMonth: number;
  isMonthStart: boolean;
  isMonthEnd: boolean;
  isEndOfMonth: boolean;
  fiscalQuarter: string;
  fiscalYear: string;
  weekOfQuarter: number;
  quarterPhase: 'early' | 'mid' | 'late' | 'final_week';
  daysRemainingInQuarter: number;
  daysElapsedInQuarter: number;
  pctQuarterComplete: number;
  monthOfFiscalYear: number;
  quarterOfFiscalYear: number;
  pctYearComplete: number;
  isPlanningDay: boolean;
  timeOfDay: 'morning' | 'afternoon' | 'evening';
  urgencyLabel: string;
}

export interface OpeningBriefData {
  temporal: TemporalContext;
  user: {
    name: string;
    email: string;
    pandoraRole: string;
    workspaceRole: string;
  };
  workspace: {
    name: string;
    salesMotion: 'high_velocity' | 'mid_market' | 'enterprise';
  };
  targets: {
    headline: { amount: number; label: string; type: string } | null;
    pctAttained: number | null;
    gap: number | null;
    closedWonValue: number;
  };
  pipeline: {
    totalValue: number;
    dealCount: number;
    weightedValue: number;
    coverageRatio: number | null;
    closingThisWeek: { count: number; value: number; dealNames: string[] };
    closingThisMonth: { count: number; value: number };
    newThisWeek: { count: number; value: number };
  };
  findings: {
    critical: number;
    warning: number;
    topFindings: {
      severity: string;
      message: string;
      skillName: string;
      dealName?: string;
      age: string;
    }[];
    lastSkillRunAt: string | null;
  };
  movement: {
    dealsAdvanced: number;
    dealsClosed: number;
    closedWonValue: number;
    closedLostValue: number;
    newFindings: number;
  };
  conversations: {
    recentCallCount: number;
    unlinkedCalls: number;
  } | null;
  movementAnchorLabel: string;
}

// ===== CACHE =====

interface BriefCacheEntry {
  data: OpeningBriefData;
  expiresAt: number;
}

const briefCache = new Map<string, BriefCacheEntry>();
const BRIEF_TTL_MS = 5 * 60 * 1000;

// ===== TEMPORAL CONTEXT =====

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function computeTemporalContext(workspaceId: string): Promise<TemporalContext> {
  const now = new Date();
  const period = await configLoader.getQuotaPeriod(workspaceId).catch(() => null);

  const dow = now.getUTCDay();
  const dayOfWeek = DAYS[dow];
  const dayOfWeekNumber = dow === 0 ? 7 : dow;
  const isWeekStart = dow === 1;
  const isWeekEnd = dow === 5;
  const isWeekend = dow === 0 || dow === 6;

  const dom = now.getUTCDate();
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
  const weekOfMonth = Math.ceil(dom / 7);
  const isMonthStart = dom <= 3;
  const isMonthEnd = dom >= daysInMonth - 4;
  const isEndOfMonth = dom >= daysInMonth - 2;

  const hour = now.getUTCHours();
  const timeOfDay: 'morning' | 'afternoon' | 'evening' =
    hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  let weekOfQuarter = 1;
  let quarterPhase: 'early' | 'mid' | 'late' | 'final_week' = 'early';
  let daysRemainingInQuarter = 90;
  let daysElapsedInQuarter = 0;
  let pctQuarterComplete = 0;
  let fiscalQuarter = 'Q1';
  let fiscalYear = `FY${now.getUTCFullYear() + 1}`;
  let monthOfFiscalYear = 1;
  let quarterOfFiscalYear = 1;
  let pctYearComplete = 0;

  if (period) {
    const msPerDay = 86400000;
    daysElapsedInQuarter = Math.max(0, Math.floor((now.getTime() - period.start.getTime()) / msPerDay));
    const totalDaysInQuarter = Math.ceil((period.end.getTime() - period.start.getTime()) / msPerDay);
    daysRemainingInQuarter = Math.max(0, period.days_remaining);
    pctQuarterComplete = Math.min(1, daysElapsedInQuarter / Math.max(totalDaysInQuarter, 1));

    weekOfQuarter = Math.min(13, Math.floor(daysElapsedInQuarter / 7) + 1);
    const totalWeeks = Math.ceil(totalDaysInQuarter / 7);
    if (weekOfQuarter <= 4) quarterPhase = 'early';
    else if (weekOfQuarter <= 9) quarterPhase = 'mid';
    else if (weekOfQuarter < totalWeeks) quarterPhase = 'late';
    else quarterPhase = 'final_week';

    const config = await configLoader.getConfig(workspaceId).catch(() => null);
    const fyStartMonth = config?.cadence?.fiscal_year_start_month ?? 1;
    const calendarMonth = now.getUTCMonth() + 1;
    monthOfFiscalYear = ((calendarMonth - fyStartMonth + 12) % 12) + 1;
    quarterOfFiscalYear = Math.ceil(monthOfFiscalYear / 3);
    fiscalQuarter = `Q${quarterOfFiscalYear}`;
    const fyStartYear = calendarMonth >= fyStartMonth ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    fiscalYear = `FY${fyStartYear + 1}`;
    pctYearComplete = monthOfFiscalYear / 12;
  }

  const urgencyLabel = buildUrgencyLabel(weekOfQuarter, quarterPhase, daysRemainingInQuarter, dayOfWeek, isMonthEnd, fiscalQuarter, fiscalYear);

  return {
    dayOfWeek,
    dayOfWeekNumber,
    isWeekStart,
    isWeekEnd,
    isWeekend,
    weekOfMonth,
    dayOfMonth: now.getUTCDate(),
    isMonthStart,
    isMonthEnd,
    isEndOfMonth,
    fiscalQuarter,
    fiscalYear,
    weekOfQuarter,
    quarterPhase,
    daysRemainingInQuarter,
    daysElapsedInQuarter,
    pctQuarterComplete,
    monthOfFiscalYear,
    quarterOfFiscalYear,
    pctYearComplete,
    isPlanningDay: isWeekStart,
    timeOfDay,
    urgencyLabel,
  };
}

function buildUrgencyLabel(
  weekOfQuarter: number,
  phase: string,
  daysRemaining: number,
  dayOfWeek: string,
  isMonthEnd: boolean,
  quarter: string,
  fy: string
): string {
  if (phase === 'final_week') return `Last week of ${quarter} ${fy} — commit or slip decisions due`;
  if (phase === 'late') return `Week ${weekOfQuarter} of ${quarter} — late quarter, ${daysRemaining} days to close`;
  if (phase === 'early' && weekOfQuarter === 1) return `First week of ${quarter} ${fy} — fresh quarter, planning window`;
  if (isMonthEnd && dayOfWeek === 'Friday') return `Month-end Friday — pacing check`;
  if (phase === 'early') return `Week ${weekOfQuarter} of ${quarter} ${fy} — early quarter, pipeline generation mode`;
  return `Week ${weekOfQuarter} of ${quarter} — mid-quarter push`;
}

// ===== DEAL SCOPE FILTER =====
// Params always start at $2 (right after workspace_id = $1).
// Callers that need extra params append them after dealScope.params.

interface DealScopeFilter {
  sql: string;   // e.g. "AND owner = $2"
  params: any[]; // e.g. ["Nate Phillips"]
}

async function buildDealScopeFilter(
  workspaceId: string,
  pandoraRole: PandolaRole,
  workspaceRole: string,
  userEmail: string | null
): Promise<DealScopeFilter> {
  // Full visibility roles — no deal filter
  if (
    pandoraRole === 'cro' ||
    pandoraRole === 'revops' ||
    pandoraRole === 'admin' ||
    workspaceRole === 'admin' ||
    !pandoraRole
  ) {
    return { sql: '', params: [] };
  }

  if (pandoraRole === 'ae' && userEmail) {
    const repRow = await query<{ rep_name: string }>(
      `SELECT rep_name FROM sales_reps WHERE workspace_id = $1 AND rep_email = $2 LIMIT 1`,
      [workspaceId, userEmail]
    ).catch(() => null);
    const repName = repRow?.rows?.[0]?.rep_name;
    if (repName) {
      return { sql: `AND owner = $2`, params: [repName] };
    }
  }

  // Manager or unmatched AE — default to full visibility (brief is informational)
  return { sql: '', params: [] };
}

// Build a parameterized SQL fragment for a query that already has $1=workspaceId,
// $2...$K = dealScope params, and needs an additional param starting at $K+1.
function scopedQuery(
  baseSQL: string,
  dealScope: DealScopeFilter,
  extraParams: any[]
): { sql: string; params: any[] } {
  const nextIdx = 2 + dealScope.params.length;
  // Replace placeholders like {$2} (extra param slots) with computed indices
  let sql = baseSQL.replace('{dealScope}', dealScope.sql);
  extraParams.forEach((_, i) => {
    sql = sql.replace(`{$${i + 1}}`, `$${nextIdx + i}`);
  });
  return {
    sql,
    params: ['{workspaceId}' as any, ...dealScope.params, ...extraParams],
  };
}

// ===== MOVEMENT ANCHOR =====

function getMovementAnchor(temporal: TemporalContext): { date: Date; label: string } {
  const now = new Date();
  if (temporal.isWeekStart) return { date: new Date(now.getTime() - 3 * 86400000), label: 'last Friday' };
  return { date: new Date(now.getTime() - 86400000), label: 'yesterday' };
}

// ===== SALES MOTION =====

function deriveSalesMotion(avgDealSize: number, avgCycleLength: number): 'high_velocity' | 'mid_market' | 'enterprise' {
  if (avgDealSize < 10000 && avgCycleLength < 30) return 'high_velocity';
  if (avgDealSize > 100000 || avgCycleLength > 90) return 'enterprise';
  return 'mid_market';
}

function fmtAge(ts: string): string {
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 2) return 'this morning';
  if (diffH < 24) return `${diffH} hours ago`;
  const diffD = Math.floor(diffH / 24);
  return diffD === 1 ? 'yesterday' : `${diffD} days ago`;
}

// ===== MAIN ASSEMBLY =====

export async function assembleOpeningBrief(
  workspaceId: string,
  userId: string
): Promise<OpeningBriefData> {
  const [temporal, roleInfo, quotaPeriod] = await Promise.all([
    computeTemporalContext(workspaceId),
    getPandoraRole(workspaceId, userId).catch(() => ({
      pandoraRole: null as PandolaRole,
      workspaceRole: 'member',
      userEmail: null as string | null,
    })),
    configLoader.getQuotaPeriod(workspaceId).catch(() => null),
  ]);

  const { pandoraRole, workspaceRole, userEmail } = roleInfo;
  const dealScope = await buildDealScopeFilter(workspaceId, pandoraRole, workspaceRole, userEmail);

  // Shared param pattern: [workspaceId, ...dealScope.params, ...extraParams]
  // dealScope.sql uses $2 if it has a param, additional extras use $2+len, $3+len, etc.
  const base = [workspaceId, ...dealScope.params];
  const nextP = 2 + dealScope.params.length; // index of first extra param
  const { date: movementAnchor, label: movementAnchorLabel } = getMovementAnchor(temporal);

  // Use actual quota period start for attainment calculation, fall back to 90 days
  const periodStart = quotaPeriod?.start ?? new Date(Date.now() - 90 * 86400000);

  const [
    workspaceRow,
    userRow,
    headlineTarget,
    pipelineStats,
    closingThisWeek,
    closingThisMonth,
    newThisWeek,
    periodAttainment,
    findingCounts,
    topFindings,
    lastSkillRun,
    movementRow,
    dealStatsRow,
    convRow,
  ] = await Promise.allSettled([
    // Workspace name
    query<{ name: string }>(
      `SELECT name FROM workspaces WHERE id = $1 LIMIT 1`,
      [workspaceId]
    ),
    // User name + email
    query<{ name: string; email: string }>(
      `SELECT u.name, u.email
       FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id
       WHERE wm.workspace_id = $1 AND u.id = $2 LIMIT 1`,
      [workspaceId, userId]
    ),
    // Role-scoped headline target (period-current)
    getHeadlineTarget(workspaceId, userId),
    // Open pipeline totals
    query<{ deal_count: string; total_value: string; weighted_value: string }>(
      `SELECT COUNT(*) as deal_count,
              COALESCE(SUM(amount), 0)::numeric as total_value,
              COALESCE(SUM(amount * COALESCE(probability, 0) / 100.0), 0)::numeric as weighted_value
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         ${dealScope.sql}`,
      base
    ),
    // Closing this week
    query<{ name: string; amount: string }>(
      `SELECT name, COALESCE(amount, 0)::numeric::text as amount
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND close_date >= CURRENT_DATE
         AND close_date <= CURRENT_DATE + INTERVAL '7 days'
         ${dealScope.sql}
       ORDER BY amount DESC NULLS LAST
       LIMIT 5`,
      base
    ),
    // Closing this month
    query<{ count: string; value: string }>(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0)::numeric as value
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND close_date >= CURRENT_DATE
         AND close_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
         ${dealScope.sql}`,
      base
    ),
    // New this week
    query<{ count: string; value: string }>(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0)::numeric as value
       FROM deals
       WHERE workspace_id = $1
         AND created_at >= CURRENT_DATE - INTERVAL '7 days'
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         ${dealScope.sql}`,
      base
    ),
    // Closed-won this quota period (attainment vs target)
    query<{ closed_won_value: string }>(
      `SELECT COALESCE(SUM(amount), 0)::numeric as closed_won_value
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized = 'closed_won'
         AND updated_at >= $${nextP}
         ${dealScope.sql}`,
      [...base, periodStart]
    ),
    // Finding counts
    query<{ critical: string; warning: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE severity = 'act') as critical,
         COUNT(*) FILTER (WHERE severity IN ('notable', 'watch')) as warning
       FROM findings
       WHERE workspace_id = $1 AND resolved_at IS NULL`,
      [workspaceId]
    ),
    // Top 3 findings
    query<{ severity: string; message: string; skill_id: string; entity_name: string | null; created_at: string }>(
      `SELECT severity, message, skill_id, entity_name, created_at::text
       FROM findings
       WHERE workspace_id = $1
         AND resolved_at IS NULL
         AND severity IN ('act', 'notable')
       ORDER BY
         CASE severity WHEN 'act' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 3`,
      [workspaceId]
    ),
    // Last skill run
    query<{ max_started: string | null }>(
      `SELECT MAX(started_at)::text as max_started
       FROM skill_runs
       WHERE workspace_id = $1 AND status = 'completed'`,
      [workspaceId]
    ),
    // Movement since anchor
    query<{ advanced: string; closed_won: string; closed_lost: string; closed_won_value: string; closed_lost_value: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE dsh.exited_at IS NOT NULL) as advanced,
         COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won' AND d.updated_at >= $${nextP}) as closed_won,
         COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_lost' AND d.updated_at >= $${nextP}) as closed_lost,
         COALESCE(SUM(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won' AND d.updated_at >= $${nextP}), 0)::numeric as closed_won_value,
         COALESCE(SUM(d.amount) FILTER (WHERE d.stage_normalized = 'closed_lost' AND d.updated_at >= $${nextP}), 0)::numeric as closed_lost_value
       FROM deals d
       LEFT JOIN deal_stage_history dsh ON dsh.deal_id = d.id
         AND dsh.exited_at >= $${nextP}
         AND dsh.stage_normalized NOT IN ('closed_won', 'closed_lost')
       WHERE d.workspace_id = $1
         ${dealScope.sql}`,
      [...base, movementAnchor]
    ),
    // Avg deal size + cycle for sales motion
    query<{ avg_amount: string; avg_cycle: string }>(
      `SELECT COALESCE(AVG(amount), 0)::numeric as avg_amount,
              COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400), 30)::numeric as avg_cycle
       FROM deals
       WHERE workspace_id = $1 AND stage_normalized = 'closed_won'`,
      [workspaceId]
    ),
    // Conversation intelligence (graceful — table may not exist)
    query<{ count: string; unlinked: string }>(
      `SELECT COUNT(*) as count,
              COUNT(*) FILTER (WHERE deal_id IS NULL) as unlinked
       FROM conversations
       WHERE workspace_id = $1
         AND created_at >= CURRENT_DATE - INTERVAL '7 days'`,
      [workspaceId]
    ).catch(() => null),
  ]);

  // Unpack results with safe fallbacks
  const wsName = workspaceRow.status === 'fulfilled' ? workspaceRow.value.rows[0]?.name ?? 'Your workspace' : 'Your workspace';
  const uRow = userRow.status === 'fulfilled' ? userRow.value.rows[0] : null;
  const headline = headlineTarget.status === 'fulfilled' ? headlineTarget.value : { amount: 0, label: '', type: 'company', source: 'none' };
  const pipe = pipelineStats.status === 'fulfilled' ? pipelineStats.value.rows[0] : null;
  const cwRows = closingThisWeek.status === 'fulfilled' ? closingThisWeek.value.rows : [];
  const closingM = closingThisMonth.status === 'fulfilled' ? closingThisMonth.value.rows[0] : null;
  const newW = newThisWeek.status === 'fulfilled' ? newThisWeek.value.rows[0] : null;
  const attain = periodAttainment.status === 'fulfilled' ? periodAttainment.value.rows[0] : null;
  const fCounts = findingCounts.status === 'fulfilled' ? findingCounts.value.rows[0] : null;
  const topF = topFindings.status === 'fulfilled' ? topFindings.value.rows : [];
  const lastRun = lastSkillRun.status === 'fulfilled' ? lastSkillRun.value.rows[0]?.max_started ?? null : null;
  const mv = movementRow.status === 'fulfilled' ? movementRow.value.rows[0] : null;
  const ds = dealStatsRow.status === 'fulfilled' ? dealStatsRow.value.rows[0] : null;
  const conv = convRow.status === 'fulfilled' && convRow.value ? convRow.value.rows[0] : null;

  const closedWonValue = Number(attain?.closed_won_value ?? 0);
  const targetAmount = headline.amount;
  const pctAttained = targetAmount > 0 ? Math.round((closedWonValue / targetAmount) * 100) : null;
  const gap = targetAmount > 0 ? Math.max(0, targetAmount - closedWonValue) : null;
  const totalPipeline = Number(pipe?.total_value ?? 0);
  const coverageRatio = gap && gap > 0 ? Math.round((totalPipeline / gap) * 10) / 10 : null;

  const avgDealSize = Number(ds?.avg_amount ?? 0);
  const avgCycle = Number(ds?.avg_cycle ?? 30);
  const salesMotion = deriveSalesMotion(avgDealSize, avgCycle);

  // New findings since movement anchor
  const newFindingsCount = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM findings WHERE workspace_id = $1 AND created_at >= $2`,
    [workspaceId, movementAnchor]
  ).then(r => Number(r.rows[0]?.count ?? 0)).catch(() => 0);

  return {
    temporal,
    user: {
      name: uRow?.name ?? 'there',
      email: uRow?.email ?? userEmail ?? '',
      pandoraRole: pandoraRole ?? 'admin',
      workspaceRole,
    },
    workspace: { name: wsName, salesMotion },
    targets: {
      headline: targetAmount > 0 ? { amount: targetAmount, label: headline.label, type: headline.type } : null,
      pctAttained,
      gap,
      closedWonValue,
    },
    pipeline: {
      totalValue: totalPipeline,
      dealCount: Number(pipe?.deal_count ?? 0),
      weightedValue: Number(pipe?.weighted_value ?? 0),
      coverageRatio,
      closingThisWeek: {
        count: cwRows.length,
        value: cwRows.reduce((s, r) => s + Number(r.amount), 0),
        dealNames: cwRows.slice(0, 3).map(r => r.name).filter(Boolean),
      },
      closingThisMonth: {
        count: Number(closingM?.count ?? 0),
        value: Number(closingM?.value ?? 0),
      },
      newThisWeek: {
        count: Number(newW?.count ?? 0),
        value: Number(newW?.value ?? 0),
      },
    },
    findings: {
      critical: Number(fCounts?.critical ?? 0),
      warning: Number(fCounts?.warning ?? 0),
      topFindings: topF.map(f => ({
        severity: f.severity === 'act' ? 'critical' : 'warning',
        message: f.message,
        skillName: f.skill_id,
        dealName: f.entity_name ?? undefined,
        age: fmtAge(f.created_at),
      })),
      lastSkillRunAt: lastRun,
    },
    movement: {
      dealsAdvanced: Number(mv?.advanced ?? 0),
      dealsClosed: Number(mv?.closed_won ?? 0) + Number(mv?.closed_lost ?? 0),
      closedWonValue: Number(mv?.closed_won_value ?? 0),
      closedLostValue: Number(mv?.closed_lost_value ?? 0),
      newFindings: newFindingsCount,
    },
    conversations: conv && Number(conv.count) > 0 ? {
      recentCallCount: Number(conv.count),
      unlinkedCalls: Number(conv.unlinked),
    } : null,
    movementAnchorLabel,
  };
}

// ===== TEMPLATE RENDERER =====

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export function renderBriefContext(data: OpeningBriefData): string {
  const t = data.temporal;
  const now = new Date();
  const monthName = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'][now.getUTCMonth()];

  const lines: string[] = [
    `[OPENING BRIEF CONTEXT — synthesize this into a natural opening, then answer any question the user included]`,
    ``,
    `TODAY: ${t.dayOfWeek}, ${t.dayOfMonth} ${monthName} ${now.getUTCFullYear()}`,
    `POSITION: ${t.urgencyLabel}`,
    `QUARTER: ${t.fiscalQuarter} ${t.fiscalYear} — Week ${t.weekOfQuarter} of 13, ${Math.round(t.pctQuarterComplete * 100)}% complete, ${t.daysRemainingInQuarter} days remaining`,
    ``,
    `USER: ${data.user.name} (${data.user.pandoraRole})`,
    `SALES MOTION: ${data.workspace.salesMotion}`,
  ];

  // Targets + attainment
  if (data.targets.headline) {
    lines.push(``, `TARGET: ${data.targets.headline.label}: ${fmt(data.targets.headline.amount)}`);
    if (data.targets.pctAttained !== null) {
      lines.push(`ATTAINMENT: ${fmt(data.targets.closedWonValue)} closed (${data.targets.pctAttained}%) — ${fmt(data.targets.gap ?? 0)} gap remaining`);
    }
    if (data.pipeline.coverageRatio !== null) {
      lines.push(`COVERAGE: ${data.pipeline.coverageRatio}x (pipeline ${fmt(data.pipeline.totalValue)} / gap ${fmt(data.targets.gap ?? 0)})`);
    }
  } else {
    lines.push(``, `TARGET: Not configured`);
  }

  // Pipeline now
  lines.push(``, `PIPELINE NOW:`);
  if (data.pipeline.dealCount > 0) {
    lines.push(`- ${data.pipeline.dealCount} open deals worth ${fmt(data.pipeline.totalValue)} (${fmt(data.pipeline.weightedValue)} weighted)`);
  } else {
    lines.push(`- No open deals synced yet`);
  }

  if (data.pipeline.closingThisWeek.count > 0) {
    const names = data.pipeline.closingThisWeek.dealNames.length > 0
      ? ` — ${data.pipeline.closingThisWeek.dealNames.join(', ')}`
      : '';
    lines.push(`- CLOSING THIS WEEK: ${data.pipeline.closingThisWeek.count} deal${data.pipeline.closingThisWeek.count > 1 ? 's' : ''} worth ${fmt(data.pipeline.closingThisWeek.value)}${names}`);
  }
  if (data.pipeline.closingThisMonth.count > data.pipeline.closingThisWeek.count) {
    lines.push(`- Closing this month: ${data.pipeline.closingThisMonth.count} deals, ${fmt(data.pipeline.closingThisMonth.value)}`);
  }
  if (data.pipeline.newThisWeek.count > 0) {
    lines.push(`- New this week: ${data.pipeline.newThisWeek.count} deals, ${fmt(data.pipeline.newThisWeek.value)}`);
  }

  // Findings
  lines.push(``);
  if (data.findings.topFindings.length > 0) {
    lines.push(`ATTENTION:`);
    for (const f of data.findings.topFindings) {
      const deal = f.dealName ? ` (${f.dealName})` : '';
      lines.push(`- [${f.severity}] ${f.message}${deal} — ${f.age}`);
    }
    lines.push(`(${data.findings.critical} critical, ${data.findings.warning} warning total unresolved)`);
  } else {
    lines.push(`No critical or warning findings. Pipeline is clean.`);
    if (!data.findings.lastSkillRunAt) {
      lines.push(`Note: Skills haven't run yet — findings will appear after first skill run.`);
    }
  }

  // Movement
  const mv = data.movement;
  if (mv.dealsAdvanced > 0 || mv.closedWonValue > 0 || mv.closedLostValue > 0 || mv.newFindings > 0) {
    lines.push(``, `SINCE ${data.movementAnchorLabel.toUpperCase()}:`);
    if (mv.dealsAdvanced > 0) lines.push(`- ${mv.dealsAdvanced} deals advanced stage`);
    if (mv.closedWonValue > 0) lines.push(`- Closed won: ${fmt(mv.closedWonValue)}`);
    if (mv.closedLostValue > 0) lines.push(`- Closed lost: ${fmt(mv.closedLostValue)}`);
    if (mv.newFindings > 0) lines.push(`- ${mv.newFindings} new findings`);
  }

  // Conversations (if connected)
  if (data.conversations && data.conversations.recentCallCount > 0) {
    const unlinked = data.conversations.unlinkedCalls > 0
      ? `, ${data.conversations.unlinkedCalls} not linked to a deal`
      : '';
    lines.push(``, `CALLS: ${data.conversations.recentCallCount} calls this week${unlinked}`);
  }

  // Role emphasis
  lines.push(``, getBriefRoleEmphasis(data.user.pandoraRole));
  lines.push(``, `[END BRIEF CONTEXT]`);

  return lines.join('\n');
}

// ===== ROLE EMPHASIS =====

export function getBriefRoleEmphasis(pandoraRole: string): string {
  switch (pandoraRole) {
    case 'cro':
      return `ROLE EMPHASIS: Briefing a CRO. They care about: will we hit the number? Which teams are behind? What's the biggest risk to the forecast? Frame everything in terms of the company target.`;
    case 'manager':
      return `ROLE EMPHASIS: Briefing a team manager. They care about: how is my team performing? Which reps need coaching? Which deals on my team need attention? Call out individual reps by name when they need help or recognition.`;
    case 'ae':
      return `ROLE EMPHASIS: Briefing an AE about their own book of business. They care about: am I on track? What should I work on today? Which deals need my attention right now? Be direct and tactical — what to do in the next 4 hours.`;
    default:
      return `ROLE EMPHASIS: Briefing a RevOps operator. They care about: data quality, system health, skill run outputs, and operational improvements. Lead with data quality findings if present.`;
  }
}

// ===== BRIEF SYSTEM PROMPT =====

export const BRIEF_SYSTEM_PROMPT = `You are Pandora, a RevOps intelligence assistant. The user just opened a new conversation. Before they ask anything, provide a brief, opinionated opening that tells them what matters right now. This is not a dashboard readout — it's a colleague who's been watching the numbers and has something to say.

RULES:
1. Lead with the single most important thing — the item that would make this person say "I didn't know that" or "that's exactly what I was going to check"
2. Never list more than 3 items. Depth beats breadth.
3. Be specific: name deals, name reps, cite dollar amounts. Vague summaries are useless.
4. End with an implicit invitation to dig deeper — a natural continuation, not "how can I help?"
5. Adapt tone to time of day and day of week: Monday morning = crisp, forward-looking. Friday afternoon = reflective. Mid-week = focused on what's in motion.
6. If it's late in the quarter, lead with the gap or the probability of hitting target. If it's early, lead with pipeline generation and coverage.
7. Never say "Good morning" followed by a wall of bullets. Write in prose. Two to four short paragraphs, conversational.
8. If there are critical findings, lead with them.
9. If nothing is urgent, say so — "Pipeline looks healthy, coverage is at 3.2x, no critical findings this week. Quiet is good." is a valid brief.
10. Match the sales motion: high_velocity = volume and conversion. mid_market = coverage and forecast. enterprise = specific deal advancement and strategic risks.

DO NOT: List every metric. Use headers or bullet points. Say "based on my analysis". Repeat the user's role or name. Explain what Pandora is. Use emoji.`;

// ===== CACHE WRAPPER =====

export async function getOrAssembleBrief(workspaceId: string, userId: string): Promise<OpeningBriefData> {
  const key = `${workspaceId}:${userId}`;
  const cached = briefCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const data = await assembleOpeningBrief(workspaceId, userId);
  briefCache.set(key, { data, expiresAt: Date.now() + BRIEF_TTL_MS });
  return data;
}

export function invalidateBriefCache(workspaceId: string, userId?: string): void {
  if (userId) {
    briefCache.delete(`${workspaceId}:${userId}`);
  } else {
    for (const key of briefCache.keys()) {
      if (key.startsWith(`${workspaceId}:`)) briefCache.delete(key);
    }
  }
}
