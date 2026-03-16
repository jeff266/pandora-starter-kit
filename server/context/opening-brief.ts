import { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { getPandoraRole, getHeadlineTarget, type PandolaRole } from './pandora-role.js';
import { PANDORA_VOICE_STANDARD } from '../lib/voice-standard.js';
import { resolveDefaultPipeline } from '../chat/pipeline-resolver.js';
import {
  calibrateBriefPriorities,
  loadWorkspaceVoice,
  renderVoiceContext,
  type BriefPriorityFrame,
  type WorkspaceVoice,
} from './brief-priorities.js';
import { loadProductCatalog, expandDealName } from '../chat/deal-lookup.js';

// ===== DEAL GROUP TYPES =====

export type DealGroup = string; // actual pipeline name slug (e.g. "Renewal", "Core Sales Pipeline")

export interface BigDealAtRisk {
  id: string;
  name: string;
  amount: number;
  stage: string;
  rfmGrade: string;
  rfmLabel: string;
  daysSinceActivity: number;
  ownerEmail: string;
  pipeline: string;
  scopeId: string;
}

export interface GroupedDealFindings {
  group: string;   // pipeline name used as key
  label: string;   // display label (same as group for named pipelines)
  deals: BigDealAtRisk[];
  totalValue: number;
  criticalCount: number;
}

/** Resolve the display label for a deal's pipeline — uses the pipeline name when present,
 *  falls back to a humanised scope_id (e.g. "new-business" → "New Business"). */
export function resolvePipelineLabel(deal: { pipeline: string; scopeId: string }): string {
  const name = (deal.pipeline ?? '').trim();
  if (name) return name;
  const sid = (deal.scopeId ?? '').trim();
  if (!sid || sid === 'default') return 'Other';
  // humanise kebab-case: "new-business" → "New Business"
  return sid.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function groupDealFindings(deals: BigDealAtRisk[]): GroupedDealFindings[] | null {
  // Group by actual pipeline label — no keyword taxonomy
  const order: string[] = [];
  const groups = new Map<string, BigDealAtRisk[]>();
  for (const deal of deals) {
    const label = resolvePipelineLabel(deal);
    if (!groups.has(label)) { groups.set(label, []); order.push(label); }
    groups.get(label)!.push(deal);
  }
  if (groups.size <= 1) return null; // single pipeline → flat render
  return order.map(label => ({
    group: label,
    label,
    deals: groups.get(label)!,
    totalValue: groups.get(label)!.reduce((s, d) => s + d.amount, 0),
    criticalCount: groups.get(label)!.filter(d => d.daysSinceActivity > 90).length,
  }));
}

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
    periodStart: string | null;
    periodEnd: string | null;
  };
  pipeline: {
    totalValue: number;
    dealCount: number;
    weightedValue: number;
    coverageRatio: number | null;
    pipelineLabel: string | null;
    closingThisWeek: { count: number; value: number; dealNames: string[] };
    closingThisMonth: { count: number; value: number };
    newThisWeek: { count: number; value: number };
    byProductLine?: Record<string, { count: number; totalValue: number; avgAmount: number }>;
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
      is_watched?: boolean;
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
  bigDealsAtRisk: BigDealAtRisk[];
  groupedDeals: GroupedDealFindings[] | null;
  pipelineMovement: {
    headline: string | null;
    netDelta: number | null;
    coverageTrend: 'improving' | 'declining' | 'stable' | null;
    onTrack: boolean | null;
    primaryConcern: string | null;
    lastRunAt: Date | null;
  } | null;
  estimatedQ2Coverage: {
    openPipelineWeighted: number;
    expectedRolloverValue: number;
    rolloverDealCount: number;
    estimatedQ2Coverage: number;
    q2Target: number;
    confidence: 'estimate';
    note: string;
  } | null;
  priorityFrame: BriefPriorityFrame | null;
  workspaceVoice: WorkspaceVoice;
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
  let fiscalYear = `FY${now.getUTCFullYear()}`;
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
    // For January-start (calendar-year) companies, FY label = fyStartYear (e.g. FY2026).
    // For mid-year starts, FY label = fyStartYear + 1 (e.g. July 2025 start → FY2026).
    fiscalYear = fyStartMonth === 1 ? `FY${fyStartYear}` : `FY${fyStartYear + 1}`;
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
  const [temporal, roleInfo, quotaPeriod, workspaceVoice] = await Promise.all([
    computeTemporalContext(workspaceId),
    getPandoraRole(workspaceId, userId).catch(() => ({
      pandoraRole: null as PandolaRole,
      workspaceRole: 'member',
      userEmail: null as string | null,
    })),
    configLoader.getQuotaPeriod(workspaceId).catch(() => null),
    // Voice loading must never break brief generation — catch all errors
    loadWorkspaceVoice(workspaceId).catch(() => ({
      tone: 'direct' as const,
      detailLevel: 'operational' as const,
      framingStyle: 'number_first' as const,
      salesMotion: 'mixed' as const,
      coverageTarget: 3.0,
      riskPhrases: [] as string[],
      urgencyPhrases: [] as string[],
      winPhrases: [] as string[],
      pipelineVocabulary: [] as string[],
      commonShorthand: {} as Record<string, string>,
      hasLearnedPatterns: false,
      callsAnalyzed: 0,
      lastExtractedAt: null,
    })),
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

  // Resolve quota-bearing pipeline for scoping pipeline stats + coverage
  const pipelineResolution = await resolveDefaultPipeline(workspaceId, 'attainment', pandoraRole ?? 'admin', '').catch(() => null);
  const quarterEnd = quotaPeriod?.end ?? null;

  // scope_id filter (applied to pipeline stats, closing week/month queries)
  let scopeIdSQL = '';
  const scopeIdParams: any[] = [];
  if (pipelineResolution?.scope_ids?.length) {
    scopeIdSQL = ` AND scope_id = ANY($${base.length + 1}::uuid[])`;
    scopeIdParams.push(pipelineResolution.scope_ids);
  }
  const scopedBase = [...base, ...scopeIdParams];

  // Full scope for pipelineStats: scope_id + quarter-end close_date bound
  let pipelineStatsSQL = scopeIdSQL;
  const pipelineStatsParams = [...scopedBase];
  if (quarterEnd) {
    pipelineStatsSQL += ` AND close_date <= $${pipelineStatsParams.length + 1}`;
    pipelineStatsParams.push(quarterEnd);
  }

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
    // Open pipeline totals — scoped to quota-bearing pipeline + current quarter close_date
    query<{ deal_count: string; total_value: string; weighted_value: string }>(
      `SELECT COUNT(*) as deal_count,
              COALESCE(SUM(amount), 0)::numeric as total_value,
              COALESCE(SUM(amount * COALESCE(probability, 0)), 0)::numeric as weighted_value
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         ${dealScope.sql}${pipelineStatsSQL}`,
      pipelineStatsParams
    ),
    // Closing this week — scoped to quota-bearing pipeline
    query<{ name: string; amount: string }>(
      `SELECT name, COALESCE(amount, 0)::numeric::text as amount
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND close_date >= CURRENT_DATE
         AND close_date <= CURRENT_DATE + INTERVAL '7 days'
         ${dealScope.sql}${scopeIdSQL}
       ORDER BY amount DESC NULLS LAST
       LIMIT 5`,
      scopedBase
    ),
    // Closing this month — scoped to quota-bearing pipeline
    query<{ count: string; value: string }>(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0)::numeric as value
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND close_date >= CURRENT_DATE
         AND close_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
         ${dealScope.sql}${scopeIdSQL}`,
      scopedBase
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
    // Top findings with RFM urgency data — fetch 10, sort by urgency score in JS, take top 3
    query<{
      id: string;
      severity: string;
      message: string;
      skill_id: string;
      entity_name: string | null;
      created_at: string;
      rfm_grade: string | null;
      rfm_label: string | null;
      amount: string | null;
    }>(
      `SELECT f.id::text, f.severity, f.message, f.skill_id, f.entity_name, f.created_at::text,
              d.rfm_grade, d.rfm_label, d.amount
       FROM findings f
       LEFT JOIN deals d ON d.id = f.deal_id AND d.workspace_id = f.workspace_id
       WHERE f.workspace_id = $1
         AND f.resolved_at IS NULL
         AND f.severity IN ('act', 'notable')
       ORDER BY
         CASE f.severity WHEN 'act' THEN 1 ELSE 2 END,
         f.created_at DESC
       LIMIT 10`,
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
  const rawTopF = topFindings.status === 'fulfilled' ? topFindings.value.rows : [];

  // RFM urgency multiplier: F-grade cold deal surfaces over low-value warnings
  const severityWeight = (sev: string) => sev === 'act' ? 3 : sev === 'notable' ? 2 : 1;
  const rfmUrgencyMultiplier = (grade: string | null) => {
    if (grade === 'F') return 1.5;
    if (grade === 'D') return 1.2;
    if (grade === 'A') return 0.7;
    return 1.0;
  };
  const topF = [...rawTopF]
    .sort((a, b) => {
      const scoreA = severityWeight(a.severity) * rfmUrgencyMultiplier(a.rfm_grade) * Math.max(Number(a.amount ?? 0), 1);
      const scoreB = severityWeight(b.severity) * rfmUrgencyMultiplier(b.rfm_grade) * Math.max(Number(b.amount ?? 0), 1);
      return scoreB - scoreA;
    })
    .slice(0, 3);

  // Finding preferences (Watch/Dismiss signals) — safe fallback: if table missing, return empty
  const prefRows = await query<{ finding_id: string; preference: string }>(
    `SELECT finding_id, preference FROM finding_preferences
     WHERE workspace_id = $1 AND user_id = $2
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [workspaceId, userId]
  ).then(r => r.rows).catch(() => [] as { finding_id: string; preference: string }[]);

  const dismissedIds = new Set(prefRows.filter(p => p.preference === 'dismissed').map(p => p.finding_id));
  const watchedIds   = new Set(prefRows.filter(p => p.preference === 'watch').map(p => p.finding_id));

  // Filter out dismissed findings; tag watched ones
  const filteredTopF = topF
    .filter(f => !dismissedIds.has(f.id))
    .map(f => ({ ...f, is_watched: watchedIds.has(f.id) }));

  const lastRun = lastSkillRun.status === 'fulfilled' ? lastSkillRun.value.rows[0]?.max_started ?? null : null;
  const mv = movementRow.status === 'fulfilled' ? movementRow.value.rows[0] : null;
  const ds = dealStatsRow.status === 'fulfilled' ? dealStatsRow.value.rows[0] : null;
  const conv = convRow.status === 'fulfilled' && convRow.value ? convRow.value.rows[0] : null;

  const closedWonValue = Number(attain?.closed_won_value ?? 0);
  const targetAmount = headline.amount;
  const pctAttained = targetAmount > 0 ? Math.round((closedWonValue / targetAmount) * 100) : null;
  const gap = targetAmount > 0 ? Math.max(0, targetAmount - closedWonValue) : null;
  const totalPipeline = Number(pipe?.total_value ?? 0);
  const coverageRatio = gap == null
    ? null
    : gap > 0
      ? Math.round((totalPipeline / gap) * 10) / 10
      : targetAmount > 0 ? Math.round((totalPipeline / targetAmount) * 10) / 10 : null;

  const avgDealSize = Number(ds?.avg_amount ?? 0);
  const avgCycle = Number(ds?.avg_cycle ?? 30);
  const salesMotion = deriveSalesMotion(avgDealSize, avgCycle);

  // New findings since movement anchor
  const newFindingsCount = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM findings WHERE workspace_id = $1 AND created_at >= $2`,
    [workspaceId, movementAnchor]
  ).then(r => Number(r.rows[0]?.count ?? 0)).catch(() => 0);

  // Big Deals at Risk — D/F grade open deals above $10K (Task 3)
  const bigDealsAtRiskRows = await query<{
    id: string;
    name: string;
    amount: string | null;
    stage_normalized: string | null;
    rfm_grade: string | null;
    rfm_label: string | null;
    rfm_recency_days: string | null;
    owner_email: string | null;
    pipeline: string | null;
    scope_id: string | null;
  }>(
    `SELECT d.id, d.name, d.amount, d.stage_normalized,
            d.rfm_grade, d.rfm_label, d.rfm_recency_days, d.owner_email,
            d.pipeline, d.scope_id
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
       AND d.rfm_grade IN ('D', 'F')
       AND d.amount >= 10000
     ORDER BY d.amount DESC
     LIMIT 10`,
    [workspaceId]
  ).then(r => r.rows).catch(() => [] as any[]);

  const _riskProductCatalog = await loadProductCatalog(workspaceId).catch(() => [] as import('../chat/deal-lookup.js').ProductEntry[]);
  const bigDealsAtRisk: BigDealAtRisk[] = bigDealsAtRiskRows.map(r => ({
    id: r.id,
    name: expandDealName(r.name, _riskProductCatalog),
    amount: Number(r.amount ?? 0),
    stage: r.stage_normalized ?? '',
    rfmGrade: r.rfm_grade ?? '',
    rfmLabel: r.rfm_label ?? '',
    daysSinceActivity: Math.round(Number(r.rfm_recency_days ?? 0)),
    ownerEmail: r.owner_email ?? '',
    pipeline: r.pipeline ?? '',
    scopeId: r.scope_id ?? '',
  }));

  const groupedDeals = groupDealFindings(bigDealsAtRisk);

  // Product line breakdown (inferred from deal name suffix)
  const plRows = await query<{ product_line: string; count: string; total_value: string }>(
    `SELECT
       CASE
         WHEN LOWER(name) LIKE '%fellowship%' THEN 'fellowship'
         WHEN LOWER(name) LIKE '% - ab' THEN 'ab'
         WHEN LOWER(name) LIKE '% - db' THEN 'db'
         WHEN LOWER(name) LIKE '% - rab' THEN 'rab'
         WHEN LOWER(name) LIKE '% - dp' THEN 'dp'
         WHEN LOWER(name) LIKE '%pilot%' THEN 'pilot'
         ELSE 'other'
       END AS product_line,
       COUNT(*) AS count,
       COALESCE(SUM(amount), 0)::numeric AS total_value
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
     GROUP BY 1`,
    [workspaceId]
  ).then(r => r.rows).catch(() => [] as { product_line: string; count: string; total_value: string }[]);

  const byProductLine: NonNullable<OpeningBriefData['pipeline']['byProductLine']> = {};
  for (const row of plRows) {
    const count = Number(row.count);
    const totalValue = Number(row.total_value);
    byProductLine[row.product_line as keyof typeof byProductLine] = {
      count,
      totalValue,
      avgAmount: count > 0 ? Math.round(totalValue / count) : 0,
    };
  }

  // Pipeline Movement — most recent skill run (feeds brief PIPELINE MOVEMENT section)
  const pipelineMovementRow = await query<{
    output: any;
    created_at: string;
  }>(`
    SELECT output, created_at
    FROM skill_runs
    WHERE workspace_id = $1
      AND skill_id = 'pipeline-movement'
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
  `, [workspaceId]).then(r => r.rows[0] ?? null).catch(() => null);

  const pmSummary    = pipelineMovementRow?.output?.summary ?? null;
  const pmNetDelta   = pipelineMovementRow?.output?.net_delta ?? null;
  const pipelineMovement: OpeningBriefData['pipelineMovement'] = pipelineMovementRow ? {
    headline:      pmSummary?.headline   ?? null,
    netDelta:      pmNetDelta?.pipelineValueDelta ?? null,
    coverageTrend: pmNetDelta?.coverageTrend ?? null,
    onTrack:       pmNetDelta?.onTrack   ?? pmSummary?.on_track ?? null,
    primaryConcern: pmSummary?.primary_concern ?? null,
    lastRunAt:     pipelineMovementRow.created_at ? new Date(pipelineMovementRow.created_at) : null,
  } : null;

  // ===== Q2 COVERAGE ESTIMATE =====
  // Use current-quarter target as Q2 target proxy when no separate Q2 target exists.
  const q2TargetAmount = targetAmount > 0 ? targetAmount : 0;
  let estimatedQ2Coverage: OpeningBriefData['estimatedQ2Coverage'] = null;

  if (q2TargetAmount > 0 && quarterEnd) {
    const q2Est = await query<{
      q2_pipeline_weighted: string;
      expected_rollover: string;
      rollover_deal_count: string;
    }>(
      `SELECT
         COALESCE(SUM(
           CASE stage_normalized
             WHEN 'contract'    THEN amount * 0.85
             WHEN 'proposal'    THEN amount * 0.70
             WHEN 'demo'        THEN amount * 0.40
             WHEN 'evaluation'  THEN amount * 0.20
             WHEN 'discovery'   THEN amount * 0.10
             ELSE                    amount * 0.15
           END
         ) FILTER (
           WHERE close_date > $2
              OR stage_normalized IN ('evaluation', 'demo', 'discovery')
         ), 0)::numeric AS q2_pipeline_weighted,
         COALESCE(SUM(amount * 0.30) FILTER (
           WHERE close_date <= $2
             AND stage_normalized IN ('contract', 'proposal')
         ), 0)::numeric AS expected_rollover,
         COUNT(*) FILTER (
           WHERE close_date <= $2
             AND stage_normalized IN ('contract', 'proposal')
         )::text AS rollover_deal_count
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
      [workspaceId, quarterEnd]
    ).then(r => r.rows[0] ?? null).catch(() => null);

    if (q2Est) {
      const openPipelineWeighted  = Number(q2Est.q2_pipeline_weighted ?? 0);
      const expectedRolloverValue = Number(q2Est.expected_rollover ?? 0);
      const rolloverDealCount     = Number(q2Est.rollover_deal_count ?? 0);
      const totalQ2Weighted       = openPipelineWeighted + expectedRolloverValue;
      const q2CoverageRatio       = Math.round((totalQ2Weighted / q2TargetAmount) * 100) / 100;

      estimatedQ2Coverage = {
        openPipelineWeighted,
        expectedRolloverValue,
        rolloverDealCount,
        estimatedQ2Coverage: q2CoverageRatio,
        q2Target: q2TargetAmount,
        confidence: 'estimate',
        note: 'Estimate includes stage-weighted open pipeline plus 30% Q1 slip probability for late-stage deals',
      };
    }
  }

  // ===== PRIORITY FRAME =====
  const priorityFrame = calibrateBriefPriorities(
    temporal,
    pctAttained,
    coverageRatio,
    targetAmount > 0
  );

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
      periodStart: periodStart?.toISOString() || null,
      periodEnd: quarterEnd?.toISOString() || null,
    },
    pipeline: {
      totalValue: totalPipeline,
      dealCount: Number(pipe?.deal_count ?? 0),
      weightedValue: Number(pipe?.weighted_value ?? 0),
      coverageRatio,
      pipelineLabel: pipelineResolution?.assumption_label ?? null,
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
      byProductLine: Object.keys(byProductLine).length > 0 ? byProductLine : undefined,
    },
    findings: {
      critical: Number(fCounts?.critical ?? 0),
      warning: Number(fCounts?.warning ?? 0),
      topFindings: filteredTopF.map(f => ({
        severity: f.severity === 'act' ? 'critical' : 'warning',
        message: f.message,
        skillName: f.skill_id,
        dealName: f.entity_name ?? undefined,
        age: fmtAge(f.created_at),
        is_watched: f.is_watched,
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
    bigDealsAtRisk,
    groupedDeals,
    pipelineMovement,
    estimatedQ2Coverage,
    priorityFrame,
    workspaceVoice,
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

  // Calculate next quarter dates
  let nextQStartIso = '';
  let nextQEndIso = '';
  if (data.targets.periodEnd) {
    const currentEnd = new Date(data.targets.periodEnd);
    const nextStart = new Date(currentEnd.getTime() + 86400000);
    const nextEnd = new Date(nextStart.getTime() + 91 * 86400000);
    nextQStartIso = nextStart.toISOString().split('T')[0];
    nextQEndIso = nextEnd.toISOString().split('T')[0];
  }

  const lines: string[] = [
    `[OPENING BRIEF CONTEXT — synthesize this into a natural opening, then answer any question the user included]`,
    ``,
    `TODAY: ${t.dayOfWeek}, ${t.dayOfMonth} ${monthName} ${now.getUTCFullYear()}`,
    `POSITION: ${t.urgencyLabel}`,
    `QUARTER: ${t.fiscalQuarter} ${t.fiscalYear} — Week ${t.weekOfQuarter} of 13, ${Math.round(t.pctQuarterComplete * 100)}% complete, ${t.daysRemainingInQuarter} days remaining`,
    `CURRENT QUARTER DATES: ${data.targets.periodStart?.split('T')[0] || 'N/A'} to ${data.targets.periodEnd?.split('T')[0] || 'N/A'}`,
    `NEXT QUARTER DATES: ${nextQStartIso || 'N/A'} to ${nextQEndIso || 'N/A'}`,
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
      const pipelineScope = data.pipeline.pipelineLabel ? ` [${data.pipeline.pipelineLabel}]` : '';
      lines.push(`COVERAGE: ${data.pipeline.coverageRatio}x (pipeline ${fmt(data.pipeline.totalValue)}${pipelineScope} / gap ${fmt(data.targets.gap ?? 0)})`);
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

  // Product line breakdown (suppressed if all deals are in one bucket)
  if (data.pipeline.byProductLine && Object.keys(data.pipeline.byProductLine).length > 1) {
    const HIGH_VALUE = ['ab', 'db', 'fellowship', 'rab'];
    const plSummary = Object.entries(data.pipeline.byProductLine)
      .sort((a, b) => b[1].totalValue - a[1].totalValue)
      .map(([pl, s]) => {
        const tier = HIGH_VALUE.includes(pl) ? 'HIGH_VALUE' : 'LOW_VALUE';
        return `${pl.toUpperCase()} [${tier}]: ${s.count} deals, ${fmt(s.totalValue)} total, avg ${fmt(s.avgAmount)}`;
      });
    lines.push(`- BY PRODUCT LINE: ${plSummary.join(' | ')}`);
  }

  // Big Deals at Risk
  if (data.bigDealsAtRisk.length > 0) {
    lines.push(``, `BIG DEALS AT RISK (RFM grade D/F, >$10K):`);
    for (const d of data.bigDealsAtRisk) {
      lines.push(`- ${d.name} — ${fmt(d.amount)} — Grade ${d.rfmGrade} | ${d.rfmLabel} — ${d.daysSinceActivity} days no activity — Owner: ${d.ownerEmail || 'unassigned'}`);
    }
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

  // Pipeline Movement (week-over-week delta, from most recent pipeline-movement skill run)
  if (data.pipelineMovement) {
    const pm = data.pipelineMovement;
    lines.push(``, `PIPELINE MOVEMENT (week-over-week):`);
    if (pm.headline) lines.push(`- ${pm.headline}`);
    if (pm.netDelta !== null) {
      const sign   = pm.netDelta >= 0 ? '+' : '';
      lines.push(`- Net delta: ${sign}${fmt(pm.netDelta)} this week`);
    }
    if (pm.coverageTrend) lines.push(`- Coverage trend: ${pm.coverageTrend}`);
    if (pm.onTrack !== null) lines.push(`- On track for quarter: ${pm.onTrack ? 'Yes' : 'No'}`);
    if (pm.primaryConcern) lines.push(`- Primary concern: ${pm.primaryConcern}`);
    if (pm.lastRunAt) {
      const daysAgo = Math.floor((Date.now() - pm.lastRunAt.getTime()) / 86400000);
      lines.push(`- Data as of: ${daysAgo === 0 ? 'today' : `${daysAgo}d ago`}`);
    }
  }

  // Q2 Coverage Estimate
  if (data.estimatedQ2Coverage) {
    const q2 = data.estimatedQ2Coverage;
    lines.push(``, `Q2 COVERAGE ESTIMATE:`);
    lines.push(`- Open pipeline (weighted): ${fmt(q2.openPipelineWeighted)}`);
    lines.push(`- Expected Q1 rollover: ${fmt(q2.expectedRolloverValue)} (${q2.rolloverDealCount} deals)`);
    lines.push(`- Estimated Q2 coverage: ${q2.estimatedQ2Coverage}× (target: ${fmt(q2.q2Target)})`);
    lines.push(`- Note: ${q2.note}`);
  }

  // Workspace voice profile — injected before PRIORITY FRAME so it informs framing
  if (data.workspaceVoice) {
    lines.push(``, renderVoiceContext(data.workspaceVoice));
  }

  // Priority Frame
  if (data.priorityFrame) {
    const pf = data.priorityFrame;
    lines.push(``, `PRIORITY FRAME: ${pf.frameLabel}`);
    lines.push(`CURRENT CELL: ${pf.cell}`);
    lines.push(`FOCUS TOPICS: ${pf.primaryTopics.join(', ')}`);
    if (pf.suppressTopics.length > 0) {
      lines.push(`DEPRIORITIZE: ${pf.suppressTopics.join(', ')}`);
    }
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

export const BRIEF_SYSTEM_PROMPT = `${PANDORA_VOICE_STANDARD}

You are Pandora, a RevOps intelligence assistant. Give the user a quick read on where things stand, like a VP of RevOps who knows the numbers cold and has the CRO's trust. Direct, factual, no performance. You are reporting, not editorializing.

VOICE: Follow the WORKSPACE VOICE PROFILE in the context. The coverage target, tone, and any learned language patterns override these defaults when present.

Non-negotiable voice rules regardless of profile:
- No fear language
- Show your math — every number must be traceable
- Name specific deals and amounts, never generics
- No unfilled template variables

The voice profile is additive — it extends and personalizes the non-negotiable rules, never overrides them.

STRUCTURE (three parts, every response):
1. State of play: what is working right now. Coverage ratio, deals advancing, attainment pace, team momentum. One or two sentences. If nothing is genuinely positive, say so briefly and move on.
2. The gap: what is behind or at risk, with specifics. Name deals, name reps, cite dollar amounts. One to two sentences.
3. Options: two or three concrete moves that could change the outcome. Not generic advice. Actual choices the person can make this week: which deals to push, which reps to call, which numbers to pull.

RULES:
1. Prose only. Two to four short paragraphs. No headers, no bullets, no numbered lists.
2. Never more than three items in any section. Depth over breadth.
3. Always name specifics: deal names, rep names, dollar amounts, percentages. Vague summaries are useless.
4. Adapt to quarter phase: early quarter = pipeline generation and coverage; mid quarter = stage discipline and forecast accuracy; late quarter = gap coverage and commit defensibility; final week = close or slip decisions only.
5. Match the sales motion: high_velocity = volume and conversion rates; mid_market = coverage ratio and forecast roll-up; enterprise = specific deal advancement and stakeholder risk.
6. If nothing is urgent, say that plainly. "Coverage is at 3.2x, attainment is on pace, no critical findings this week." is a complete and correct response.
7. End by making it easy to go deeper, without asking "how can I help?"

BIG DEALS AT RISK:
If the context includes a BIG DEALS AT RISK section, treat these as the highest-priority findings regardless of the ATTENTION section order. A $200K deal that has gone cold for 36 days is more important than any low-dollar hygiene finding. Surface at least one Big Deal at Risk as the first finding if any exist, with:
- The specific dollar amount and days cold
- Why it matters to the quarterly number (use targets.gap if gap > 0, or next quarter pipeline if gap = 0)
- One specific action (not generic — name the deal and the recommended outreach type based on stage)

VOICE RULES for Big Deals at Risk (non-negotiable):
- No fear language
- No generic phrases
- Name specific deals, amounts, days
- If gap = 0 (target already hit), frame around next quarter setup, not current quarter urgency

LANGUAGE:
- Write short declarative sentences. Use periods. No em dashes.
- No antithesis constructions ("X is not Y, it is Z" or "That is not a pipeline problem, it is a data problem").
- No dramatic setup phrases ("But the data tells a different story", "Here is the reality", "What jumps out is").
- No rhetorical conclusions ("Either way", "The bottom line is", "Ultimately", "What this means is").
- No filler openers ("Worth noting that", "It is worth mentioning", "Notably").
- No indirect hedges ("This suggests", "This indicates", "This appears to").
- No echo openers that restate the user's question.
- No passive constructions used to sound authoritative ("Progress has been made", "Deals are being monitored").

EXAMPLE OF WRONG TONE:
"But the data tells a different story: 47 unresolved flags and nearly half your calls this week aren't tied to any deal record. That's not a pipeline problem, it's a data integrity problem. Either way, the CRM doesn't reflect reality."

EXAMPLE OF RIGHT TONE:
"Coverage is 6.3x, which gives you room. Attainment is behind on Core Sales because the $2.8M closed came from Fellowship Pipeline, which is not in scope for the quota. That is a planning conversation, not a performance call. To close the gap: get a decision on Spectrum Speakers this week, pull Behavioral Framework from forecast if there has been no contact in three weeks, and clarify which pipeline counts toward target before the board deck."

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

// ===== BRIEF INTERACTION LOGGING =====

export interface BriefInteraction {
  workspace_id: string;
  user_id: string;
  session_id: string;
  pandora_role?: string;
  quarter_phase?: string;
  attainment_pct?: number | null;
  days_remaining?: number | null;
  findings_shown?: unknown;
  big_deals_shown?: unknown;
  cards_drilled_into?: unknown;
  math_modals_opened?: unknown;
  actions_approved?: unknown;
  actions_ignored?: unknown;
  follow_up_questions?: unknown;
  time_on_brief_seconds?: number | null;
  returned_within_hour?: boolean;
  brief_was_relevant?: boolean | null;
}

export async function logBriefInteraction(data: Partial<BriefInteraction>): Promise<void> {
  try {
    if (!data.workspace_id || !data.user_id || !data.session_id) return;
    await query(
      `INSERT INTO brief_interactions (
        workspace_id, user_id, session_id,
        pandora_role, quarter_phase, attainment_pct, days_remaining,
        findings_shown, big_deals_shown,
        cards_drilled_into, math_modals_opened,
        actions_approved, actions_ignored,
        follow_up_questions, time_on_brief_seconds,
        returned_within_hour, brief_was_relevant
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )`,
      [
        data.workspace_id,
        data.user_id,
        data.session_id,
        data.pandora_role ?? null,
        data.quarter_phase ?? null,
        data.attainment_pct ?? null,
        data.days_remaining ?? null,
        data.findings_shown != null ? JSON.stringify(data.findings_shown) : null,
        data.big_deals_shown != null ? JSON.stringify(data.big_deals_shown) : null,
        data.cards_drilled_into != null ? JSON.stringify(data.cards_drilled_into) : null,
        data.math_modals_opened != null ? JSON.stringify(data.math_modals_opened) : null,
        data.actions_approved != null ? JSON.stringify(data.actions_approved) : null,
        data.actions_ignored != null ? JSON.stringify(data.actions_ignored) : null,
        data.follow_up_questions != null ? JSON.stringify(data.follow_up_questions) : null,
        data.time_on_brief_seconds ?? null,
        data.returned_within_hour ?? false,
        data.brief_was_relevant ?? null,
      ]
    );
  } catch (err) {
    console.error('[BriefInteraction] Failed to log interaction:', err instanceof Error ? err.message : err);
  }
}
