import { query } from '../db.js';
import { PANDORA_PRODUCT_KNOWLEDGE, PANDORA_SUPPORT_CONTEXT } from '../chat/pandora-knowledge.js';
import { writeMemoryFromBriefAssembly, getForecastAccuracyContext, writeQuarterlyForecastAccuracy, getCurrentPeriodLabel } from '../memory/workspace-memory.js';
import { getOutcomeSummaryForBrief } from '../documents/recommendation-tracker.js';
import {
  getMonday, endOfWeek, subDays, quarterStart, quarterEnd, getQuarter,
  daysRemainingInQuarter, getWonLostStages,
  getCurrentQuota, formatCompact, ordinal, buildOpenFilter,
} from './brief-utils.js';
import { determineBriefType, determineEditorialFocus } from './editorial-engine.js';
import { generateBriefNarratives } from './brief-narratives.js';
import { annotateBriefNarrative } from './brief-annotator.js';
import { computeTemporalContext } from '../context/opening-brief.js';
import { buildComparison, formatComparisonBlock } from '../documents/comparator.js';
import type { BriefType, TheNumber, WhatChanged, Segments, Reps, DealsToWatch, AssembledBrief } from './brief-types.js';
import { assembleLiveBriefData } from './live-query-assembler.js';
import type { LiveBriefData } from './live-query-assembler.js';
import { computeBriefFingerprint, getLastBriefFingerprint } from './fingerprint.js';
import { checkRefreshRateLimit } from './rate-limiter.js';
import { callLLM } from '../utils/llm-router.js';
import { createBriefSSEEmitter, NULL_EMITTER, type BriefSSEEmitter } from './brief-sse-emitter.js';
import { getDictionaryContext } from '../dictionary/dictionary-context.js';
import { getToolDefinitionsContext } from '../skills/tool-context.js';
import { PandoraResponseBuilder } from '../lib/pandora-response-builder.js';

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function assembleBrief(
  workspaceId: string,
  options: {
    brief_type?: BriefType;
    force?: boolean;
    emitter?: BriefSSEEmitter;
    userId?: string;
    userRole?: 'admin' | 'manager' | 'rep' | 'analyst' | 'viewer' | 'member';
  } = {}
): Promise<AssembledBrief> {
  const startTime = Date.now();
  const now = new Date();
  const briefType = options.brief_type ?? determineBriefType(now);
  const todayStr = now.toISOString().split('T')[0];
  const { emitter = NULL_EMITTER } = options;

  if (!options.force) {
    const existing = await query<any>(
      `SELECT * FROM weekly_briefs WHERE workspace_id = $1 AND generated_date = $2 AND status IN ('ready', 'sent', 'edited') LIMIT 1`,
      [workspaceId, todayStr]
    );
    if (existing.rows.length > 0) {
      console.log(`[brief-assembler] Returning existing ${briefType} brief for ${workspaceId}`);
      return parseBriefRow(existing.rows[0]);
    }
  }

  await query(
    `INSERT INTO weekly_briefs (workspace_id, brief_type, generated_date, status)
     VALUES ($1, $2, $3, 'assembling')
     ON CONFLICT (workspace_id, generated_date) DO UPDATE SET
       brief_type = $2, status = 'assembling', updated_at = NOW()`,
    [workspaceId, briefType, todayStr]
  );

  try {
    let result: AssembledBrief;
    if (briefType === 'monday_setup') {
      result = await assembleMondaySetup(workspaceId, now, briefType, startTime, emitter);
    } else if (briefType === 'friday_recap') {
      result = await assembleFridayRecap(workspaceId, now, briefType, startTime, emitter);
    } else if (briefType === 'quarter_close') {
      result = await assembleQuarterClose(workspaceId, now, briefType, startTime, emitter);
    } else {
      result = await assemblePulse(workspaceId, now, briefType, startTime, emitter);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE weekly_briefs SET status = 'failed', error_message = $1, updated_at = NOW() WHERE workspace_id = $2 AND generated_date = $3`,
      [msg, workspaceId, todayStr]
    );
    console.error(`[brief-assembler] Assembly failed for ${workspaceId}:`, msg);
    throw err;
  }
}

// ─── Shared data helpers ──────────────────────────────────────────────────────

async function getTheNumber(workspaceId: string, wonLostStages: string[], now: Date): Promise<TheNumber> {
  const openFilter = buildOpenFilter(wonLostStages);
  const quota = await getCurrentQuota(workspaceId);
  const daysRemaining = daysRemainingInQuarter(now);

  const [pipelineRes, forecastRes] = await Promise.all([
    query<{ total: string; cnt: string }>(
      `SELECT COALESCE(SUM(amount),0)::text as total, COUNT(*)::text as cnt FROM deals WHERE workspace_id = $1 AND ${openFilter}`,
      [workspaceId]
    ),
    query<{ result: any }>(
      `SELECT result FROM skill_runs WHERE workspace_id = $1 AND skill_id = 'forecast-rollup' AND status = 'completed' ORDER BY started_at DESC LIMIT 1`,
      [workspaceId]
    ),
  ]);

  const pipelineTotal = parseFloat(pipelineRes.rows[0]?.total || '0');
  const dealCount = parseInt(pipelineRes.rows[0]?.cnt || '0');
  const fResult = forecastRes.rows[0]?.result || {};

  let wonThisPeriod = 0;
  if (quota) {
    const pipelineClause = quota.pipeline_name ? `AND pipeline = $4` : '';
    const wonParams: any[] = [workspaceId, quota.period_start, quota.period_end];
    if (quota.pipeline_name) wonParams.push(quota.pipeline_name);
    const wonRes = await query<{ total: string }>(
      `SELECT COALESCE(SUM(amount),0)::text as total FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= $2 AND close_date <= $3 ${pipelineClause}`,
      wonParams
    );
    wonThisPeriod = parseFloat(wonRes.rows[0]?.total || '0');
  }

  const target = quota?.target || 0;
  const gap = target > 0 ? Math.max(0, target - wonThisPeriod) : 0;
  const attainmentPct = target > 0 ? (wonThisPeriod / target) * 100 : 0;
  const winRate = (fResult as any).win_rate || 0.3;
  const coverageOnGap = gap > 0 && winRate > 0 ? pipelineTotal / (gap / winRate) : 0;
  const requiredPipeline = gap > 0 && winRate > 0 ? gap / winRate : 0;
  const coverageRatio = requiredPipeline > 0 ? Math.round((pipelineTotal / requiredPipeline) * 100) / 100 : undefined;
  const avgDealSize = dealCount > 0 ? Math.round(pipelineTotal / dealCount) : 0;
  const weeksRemaining = Math.ceil(daysRemaining / 7);
  const requiredDealsToCLose = gap > 0 && avgDealSize > 0 ? Math.ceil(gap / avgDealSize) : undefined;

  let direction: 'up' | 'down' | 'flat' = 'flat';
  let wowPts: number | undefined;
  const monday = getMonday(now);
  const priorMonday = subDays(monday, 7);
  const priorSnap = await query<{ attainment_pct: string }>(
    `SELECT attainment_pct::text FROM goal_snapshots WHERE workspace_id = $1 AND snapshot_date >= $2 AND snapshot_date < $3 ORDER BY snapshot_date DESC LIMIT 1`,
    [workspaceId, priorMonday.toISOString().split('T')[0], monday.toISOString().split('T')[0]]
  );
  if (priorSnap.rows[0] && target > 0) {
    const priorPct = parseFloat(priorSnap.rows[0].attainment_pct || '0');
    wowPts = Math.round(attainmentPct - priorPct);
    direction = wowPts > 1 ? 'up' : wowPts < -1 ? 'down' : 'flat';
  }

  const runAt = new Date().toISOString();
  const weeksInQuarter = 13;
  const currentWeek = Math.max(1, weeksInQuarter - weeksRemaining);
  const paceChartData: { label: string; value: number }[] = [];
  const weeklyPaceTarget = target > 0 ? target / weeksInQuarter : 0;
  for (let w = 1; w <= weeksInQuarter; w++) {
    paceChartData.push({ label: `Wk ${w}`, value: Math.round(weeklyPaceTarget * w) });
  }
  const attainmentChartSpec = target > 0 ? {
    type: 'chart' as const,
    chartType: 'line' as const,
    title: 'Attainment Pacing',
    subtitle: `Current: ${Math.round(attainmentPct)}% at Wk ${currentWeek}`,
    data: paceChartData,
    referenceValue: target,
    annotation: wonThisPeriod > 0
      ? `At Wk ${currentWeek}: $${(wonThisPeriod / 1000).toFixed(0)}K closed of $${(target / 1000).toFixed(0)}K target`
      : `$${(target / 1000).toFixed(0)}K target — no closed won recorded yet`,
    source: { calculation_id: 'attainment_pacing', run_at: runAt, record_count: weeksInQuarter },
  } : undefined;

  return {
    pipeline_total: pipelineTotal,
    deal_count: dealCount,
    won_this_period: wonThisPeriod,
    forecast: {
      commit: (fResult as any).commit_total || 0,
      best_case: (fResult as any).best_case_total || 0,
      weighted: (fResult as any).weighted_forecast || pipelineTotal,
      win_rate: winRate,
    },
    attainment_pct: Math.round(attainmentPct * 10) / 10,
    gap,
    coverage_on_gap: Math.round(coverageOnGap * 100) / 100,
    direction,
    wow_pts: wowPts,
    days_remaining: daysRemaining,
    required_pipeline: requiredPipeline > 0 ? Math.round(requiredPipeline) : undefined,
    coverage_ratio: coverageRatio,
    avg_deal_size: avgDealSize || undefined,
    weeks_remaining: weeksRemaining,
    required_deals_to_close: requiredDealsToCLose,
    chart_spec: attainmentChartSpec,
  };
}

async function getWhatChanged(workspaceId: string, wonLostStages: string[], since: Date, priorStart: Date, priorEnd: Date): Promise<WhatChanged & { total_pipeline_delta?: number }> {
  const openFilter = buildOpenFilter(wonLostStages);
  const sinceStr = since.toISOString();
  const priorStartStr = priorStart.toISOString();
  const priorEndStr = priorEnd.toISOString();

  const [thisCreated, thisWon, thisLost, priorCreated, priorWon, priorLost, pushed] = await Promise.all([
    query<{ cnt: string; total: string }>(`SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM deals WHERE workspace_id = $1 AND created_at >= $2`, [workspaceId, sinceStr]),
    query<{ cnt: string; total: string }>(`SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= $2`, [workspaceId, sinceStr]),
    query<{ cnt: string; total: string }>(`SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_lost' AND updated_at >= $2`, [workspaceId, sinceStr]),
    query<{ cnt: string; total: string }>(`SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM deals WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $3`, [workspaceId, priorStartStr, priorEndStr]),
    query<{ cnt: string; total: string }>(`SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= $2 AND close_date < $3`, [workspaceId, priorStartStr, priorEndStr]),
    query<{ cnt: string; total: string }>(`SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_lost' AND updated_at >= $2 AND updated_at < $3`, [workspaceId, priorStartStr, priorEndStr]),
    query<{ cnt: string; total: string }>(`SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM deals WHERE workspace_id = $1 AND ${openFilter} AND updated_at >= $2 AND custom_fields->>'original_close_date' IS NOT NULL AND close_date > (custom_fields->>'original_close_date')::date`, [workspaceId, sinceStr]),
  ]);

  let streak: string | undefined;
  const streakRes = await query<{ times_flagged: string }>(
    `SELECT times_flagged::text FROM findings WHERE workspace_id = $1 AND category ILIKE '%net_pipeline%' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [workspaceId]
  );
  if (streakRes.rows[0] && parseInt(streakRes.rows[0].times_flagged) > 1) {
    streak = `${ordinal(parseInt(streakRes.rows[0].times_flagged))} consecutive week of net negative pipeline`;
  }

  const createdAmt = parseFloat(thisCreated.rows[0]?.total || '0');
  const wonAmt = parseFloat(thisWon.rows[0]?.total || '0');
  const lostAmt = parseFloat(thisLost.rows[0]?.total || '0');
  const pushedAmt = parseFloat(pushed.rows[0]?.total || '0');
  const totalPipelineDelta = createdAmt - lostAmt - pushedAmt;

  const waterfallRunAt = new Date().toISOString();
  const waterfallChartSpec = (createdAmt > 0 || wonAmt > 0 || lostAmt > 0 || pushedAmt > 0) ? {
    type: 'chart' as const,
    chartType: 'waterfall' as const,
    title: 'Pipeline Movement',
    data: [
      { label: 'Created', value: createdAmt },
      { label: 'Won', value: wonAmt },
      { label: 'Lost', value: -lostAmt },
      { label: 'Pushed', value: -pushedAmt },
    ].filter(d => d.value !== 0),
    annotation: totalPipelineDelta >= 0
      ? `Net +$${(totalPipelineDelta / 1000).toFixed(0)}K pipeline added this period`
      : `Net -$${(Math.abs(totalPipelineDelta) / 1000).toFixed(0)}K pipeline this period`,
    source: { calculation_id: 'pipeline_waterfall', run_at: waterfallRunAt, record_count: 4 },
  } : undefined;

  return {
    created: { count: parseInt(thisCreated.rows[0]?.cnt || '0'), amount: createdAmt, prev_count: parseInt(priorCreated.rows[0]?.cnt || '0'), prev_amount: parseFloat(priorCreated.rows[0]?.total || '0') },
    won: { count: parseInt(thisWon.rows[0]?.cnt || '0'), amount: wonAmt, prev_count: parseInt(priorWon.rows[0]?.cnt || '0'), prev_amount: parseFloat(priorWon.rows[0]?.total || '0') },
    lost: { count: parseInt(thisLost.rows[0]?.cnt || '0'), amount: lostAmt, prev_count: parseInt(priorLost.rows[0]?.cnt || '0'), prev_amount: parseFloat(priorLost.rows[0]?.total || '0') },
    pushed: { count: parseInt(pushed.rows[0]?.cnt || '0'), amount: pushedAmt },
    total_pipeline_delta: totalPipelineDelta,
    streak,
    chart_spec: waterfallChartSpec,
  };
}

async function getSegments(workspaceId: string, wonLostStages: string[]): Promise<Segments> {
  const openFilter = buildOpenFilter(wonLostStages);

  const [pipelineCnt, dealTypeCnt, rtCnt] = await Promise.all([
    query<{ cnt: string }>(`SELECT COUNT(DISTINCT pipeline)::text as cnt FROM deals WHERE workspace_id = $1 AND pipeline IS NOT NULL AND ${openFilter}`, [workspaceId]),
    query<{ cnt: string }>(`SELECT COUNT(DISTINCT custom_fields->>'dealtype')::text as cnt FROM deals WHERE workspace_id = $1 AND custom_fields->>'dealtype' IS NOT NULL AND ${openFilter}`, [workspaceId]),
    query<{ cnt: string }>(`SELECT COUNT(DISTINCT custom_fields->>'record_type_name')::text as cnt FROM deals WHERE workspace_id = $1 AND custom_fields->>'record_type_name' IS NOT NULL AND ${openFilter}`, [workspaceId]),
  ]);

  let segCol: string;
  let dimension: string;
  if (parseInt(pipelineCnt.rows[0]?.cnt || '0') > 1) { segCol = 'pipeline'; dimension = 'Pipeline'; }
  else if (parseInt(dealTypeCnt.rows[0]?.cnt || '0') > 1) { segCol = `custom_fields->>'dealtype'`; dimension = 'Deal Type'; }
  else if (parseInt(rtCnt.rows[0]?.cnt || '0') > 1) { segCol = `custom_fields->>'record_type_name'`; dimension = 'Record Type'; }
  else { segCol = 'pipeline'; dimension = 'Pipeline'; }

  const rows = await query<{ label: string; pipeline: string; cnt: string; avg_deal: string }>(
    `SELECT COALESCE(${segCol}, 'Other') as label, COALESCE(SUM(amount),0)::text as pipeline, COUNT(*)::text as cnt, COALESCE(AVG(amount),0)::text as avg_deal FROM deals WHERE workspace_id = $1 AND ${openFilter} GROUP BY label ORDER BY SUM(amount) DESC`,
    [workspaceId]
  );

  return {
    dimension,
    items: rows.rows.map(r => ({ label: r.label, pipeline: parseFloat(r.pipeline), count: parseInt(r.cnt), avg_deal: parseFloat(r.avg_deal) })),
  };
}

async function getReps(workspaceId: string, wonLostStages: string[]): Promise<Reps> {
  const openFilter = buildOpenFilter(wonLostStages);
  const quota = await getCurrentQuota(workspaceId);
  const ps = quota?.period_start || quarterStart(new Date()).toISOString().split('T')[0];
  const pe = quota?.period_end || quarterEnd(new Date()).toISOString().split('T')[0];

  const closedPipelineClause = quota?.pipeline_name ? `AND pipeline = $4` : '';
  const closedParams: any[] = [workspaceId, ps, pe];
  if (quota?.pipeline_name) closedParams.push(quota.pipeline_name);

  const [repRes, closedRes, quotaRes, findingsRes, rosterRes] = await Promise.all([
    query<any>(`SELECT COALESCE(owner, '') as email, COALESCE(owner, 'Unknown') as name, COALESCE(SUM(amount),0)::text as pipeline, COUNT(*)::text as cnt FROM deals WHERE workspace_id = $1 AND ${openFilter} GROUP BY owner ORDER BY SUM(amount) DESC`, [workspaceId]),
    query<any>(`SELECT COALESCE(owner, '') as email, COALESCE(SUM(amount),0)::text as closed FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= $2 AND close_date <= $3 ${closedPipelineClause} GROUP BY owner`, closedParams),
    query<any>(`SELECT rep_email, amount::text as quota_value FROM quotas WHERE workspace_id = $1 AND is_active = true AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE`, [workspaceId]),
    query<any>(`SELECT COALESCE(owner_email, '') as entity_id, message, COALESCE(escalation_level,0)::text as escalation_level, COALESCE(times_flagged,1)::text as times_flagged FROM findings WHERE workspace_id = $1 AND resolved_at IS NULL AND severity IN ('act', 'watch') ORDER BY escalation_level DESC, times_flagged DESC`, [workspaceId]),
    query<any>(`SELECT rep_name FROM sales_reps WHERE workspace_id = $1 AND is_rep = true AND pandora_role IS NOT NULL`, [workspaceId]),
  ]);

  const closedMap = new Map(closedRes.rows.map((r: any) => [r.email, parseFloat(r.closed)]));

  // Per-rep quotas: use quotas table if populated, otherwise no per-rep attainment
  const quotaMap = new Map(quotaRes.rows.map((r: any) => [r.rep_email, parseFloat(r.quota_value)]));

  const flagMap = new Map<string, any>();
  for (const f of findingsRes.rows) {
    if (!flagMap.has(f.entity_id)) flagMap.set(f.entity_id, f);
  }

  // Build allowed names set from sales_reps roster (pandora_role IS NOT NULL = has an assigned Pandora role)
  // Deal owners are stored by display name, so we match on rep_name.
  // If no roster entries exist for this workspace, fall back to unfiltered (legacy behavior).
  const allowedNames = new Set(rosterRes.rows.map((r: any) => r.rep_name as string));

  const filteredReps = allowedNames.size > 0
    ? repRes.rows.filter((r: any) => allowedNames.has(r.name))
    : repRes.rows;

  const repItems = filteredReps.map((r: any) => {
    const closed = closedMap.get(r.email) || 0;
    const quotaVal = quotaMap.get(r.email) || 0;
    const flag = flagMap.get(r.email);
    return {
      email: r.email, name: r.name,
      pipeline: parseFloat(r.pipeline), closed, deal_count: parseInt(r.cnt),
      quota: quotaVal || undefined,
      attainment_pct: quotaVal > 0 ? Math.round((closed / quotaVal) * 100) : undefined,
      gap: quotaVal > 0 ? Math.max(0, quotaVal - closed) : undefined,
      flag: flag?.message, flag_weeks: flag ? parseInt(flag.times_flagged) : undefined,
      flag_severity: flag ? (parseInt(flag.escalation_level) >= 2 ? 'critical' : parseInt(flag.escalation_level) >= 1 ? 'warning' : 'ok') : 'ok',
      escalation_level: flag ? parseInt(flag.escalation_level) : 0, findings_count: 0,
    } as any;
  });

  const repsChartSpec = repItems.length > 0 ? {
    type: 'chart' as const,
    chartType: 'horizontal_bar' as const,
    title: 'Rep Pipeline Coverage',
    data: repItems.map((r: any) => ({
      label: r.name || r.email || 'Unknown',
      value: r.pipeline,
      annotation: (r.quota && r.pipeline < r.quota * 3) ? 'Below 3x' : undefined,
    })),
    annotation: repItems.length > 1
      ? `${repItems[0].name || repItems[0].email} leads with ${repItems[0].pipeline >= 1000 ? `$${(repItems[0].pipeline / 1000).toFixed(0)}K` : `$${repItems[0].pipeline.toFixed(0)}`} pipeline`
      : undefined,
    source: { calculation_id: 'rep_coverage_comparison', run_at: new Date().toISOString(), record_count: repItems.length },
  } : undefined;

  return {
    items: repItems,
    chart_spec: repsChartSpec,
  };
}

async function getDealsToWatch(workspaceId: string, wonLostStages: string[], since?: Date): Promise<DealsToWatch> {
  const openFilter = buildOpenFilter(wonLostStages);
  const sinceStr = (since || subDays(new Date(), 7)).toISOString();

  const [topDeals, riskyDeals, wonDeals] = await Promise.all([
    query<any>(`SELECT id::text, name, amount, stage, pipeline, COALESCE(owner,'') as owner, close_date::text FROM deals WHERE workspace_id = $1 AND ${openFilter} ORDER BY amount DESC LIMIT 5`, [workspaceId]),
    query<any>(`SELECT DISTINCT d.id::text, d.name, d.amount, d.stage, COALESCE(d.owner,'') as owner, d.close_date::text, f.message as signal_text, f.severity FROM findings f JOIN deals d ON d.id = f.deal_id AND d.workspace_id = f.workspace_id WHERE f.workspace_id = $1 AND f.resolved_at IS NULL AND f.severity IN ('act','watch') ORDER BY d.amount DESC LIMIT 5`, [workspaceId]),
    query<any>(`SELECT id::text, name, amount, stage, COALESCE(owner,'') as owner FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= $2 ORDER BY amount DESC LIMIT 3`, [workspaceId, sinceStr]),
  ]);

  const dealMap = new Map<string, any>();
  for (const d of riskyDeals.rows) dealMap.set(d.name, { id: d.id, name: d.name, amount: parseFloat(d.amount||'0'), stage: d.stage, owner: d.owner, close_date: d.close_date, severity: d.severity === 'act' ? 'critical' : 'warning', signal_text: d.signal_text });
  for (const d of topDeals.rows) if (!dealMap.has(d.name)) dealMap.set(d.name, { id: d.id, name: d.name, amount: parseFloat(d.amount||'0'), stage: d.stage, owner: d.owner, close_date: d.close_date, severity: 'info', signal_text: `${formatCompact(parseFloat(d.amount||'0'))} in ${d.stage}` });
  for (const d of wonDeals.rows) dealMap.set(d.name, { id: d.id, name: d.name, amount: parseFloat(d.amount||'0'), stage: d.stage, owner: d.owner, severity: 'positive', signal_text: 'Won this week' });

  const order: Record<string, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  return { items: Array.from(dealMap.values()).sort((a, b) => (order[a.severity]??2) - (order[b.severity]??2) || b.amount - a.amount).slice(0, 8) };
}

// ─── Sub-assemblers ───────────────────────────────────────────────────────────

async function assembleMondaySetup(workspaceId: string, now: Date, briefType: BriefType, startTime: number, emitter: BriefSSEEmitter): Promise<AssembledBrief> {
  emitter.agentThinking('brief-assembler');

  const monday = getMonday(now);
  const priorMonday = subDays(monday, 7);
  const wonLostStages = await getWonLostStages(workspaceId);

  emitter.toolCall('brief-assembler', 'getTheNumber', 'Computing attainment');
  emitter.toolCall('brief-assembler', 'getWhatChanged', 'Analyzing pipeline changes');
  emitter.toolCall('brief-assembler', 'getSegments', 'Segmenting pipeline');
  emitter.toolCall('brief-assembler', 'getReps', 'Loading rep performance');
  emitter.toolCall('brief-assembler', 'getDealsToWatch', 'Identifying key deals');

  const [theNumber, whatChanged, segments, reps, deals, temporal] = await Promise.all([
    getTheNumber(workspaceId, wonLostStages, now),
    getWhatChanged(workspaceId, wonLostStages, monday, priorMonday, monday),
    getSegments(workspaceId, wonLostStages),
    getReps(workspaceId, wonLostStages),
    getDealsToWatch(workspaceId, wonLostStages, subDays(now, 7)),
    computeTemporalContext(workspaceId).catch(() => null),
  ]);

  if (theNumber.chart_spec) emitter.chartSpec(theNumber.chart_spec);
  if (whatChanged.chart_spec) emitter.chartSpec(whatChanged.chart_spec);
  if (reps.chart_spec) emitter.chartSpec(reps.chart_spec);

  const editorialFocus = determineEditorialFocus(briefType, theNumber, whatChanged as any, reps, deals, theNumber.days_remaining);
  const forecastAccuracyNote = await getForecastAccuracyContext(workspaceId).catch(() => undefined);

  emitter.toolCall('brief-assembler', 'generateNarrative', 'Synthesizing brief narrative');
  const rawBlurbs = await generateBriefNarratives(workspaceId, briefType, theNumber, whatChanged, reps.items, deals.items, editorialFocus, temporal?.weekOfQuarter, temporal?.quarterPhase as any, temporal?.pctQuarterComplete);
  const aiBlurbs = await annotateBriefNarrative(workspaceId, rawBlurbs, { theNumber, whatChanged, reps: reps.items, deals: deals.items });

  // Trigger partial accuracy write
  const periodLabel = getCurrentPeriodLabel();
  await writeQuarterlyForecastAccuracy(workspaceId, periodLabel).catch(err => console.error('Failed to write forecast accuracy:', err));

  emitter.agentDone('brief-assembler', 'Brief data assembled');

  return saveBrief(workspaceId, briefType, now, { theNumber, whatChanged, segments, reps, deals, aiBlurbs, editorialFocus, startTime, forecastAccuracyNote });
}

async function assemblePulse(workspaceId: string, now: Date, briefType: BriefType, startTime: number, emitter: BriefSSEEmitter): Promise<AssembledBrief> {
  emitter.agentThinking('brief-assembler');

  const wonLostStages = await getWonLostStages(workspaceId);
  const mondayBriefRes = await query<any>(`SELECT generated_at::text, the_number FROM weekly_briefs WHERE workspace_id = $1 AND brief_type = 'monday_setup' AND status IN ('ready','sent','edited') ORDER BY generated_at DESC LIMIT 1`, [workspaceId]);
  const mondayBrief = mondayBriefRes.rows[0];
  const since = mondayBrief ? new Date(mondayBrief.generated_at) : getMonday(now);
  const sinceLabel = since.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  emitter.toolCall('brief-assembler', 'getTheNumber', 'Computing attainment');
  emitter.toolCall('brief-assembler', 'getWhatChanged', 'Analyzing pipeline changes');
  emitter.toolCall('brief-assembler', 'getReps', 'Loading rep performance');
  emitter.toolCall('brief-assembler', 'getDealsToWatch', 'Identifying key deals');

  const [theNumber, whatChanged, reps, deals] = await Promise.all([
    getTheNumber(workspaceId, wonLostStages, now),
    getWhatChanged(workspaceId, wonLostStages, since, subDays(since, 7), since),
    getReps(workspaceId, wonLostStages),
    getDealsToWatch(workspaceId, wonLostStages, since),
  ]);

  if (theNumber.chart_spec) emitter.chartSpec(theNumber.chart_spec);
  if (whatChanged.chart_spec) emitter.chartSpec(whatChanged.chart_spec);
  if (reps.chart_spec) emitter.chartSpec(reps.chart_spec);

  if (mondayBrief?.the_number) {
    const mondayNum = typeof mondayBrief.the_number === 'string' ? JSON.parse(mondayBrief.the_number) : mondayBrief.the_number;
    theNumber.delta_since_monday = theNumber.pipeline_total - (mondayNum.pipeline_total || 0);
    theNumber.forecast_delta = theNumber.forecast.weighted - (mondayNum.forecast?.weighted || 0);
    theNumber.attainment_delta = theNumber.attainment_pct - (mondayNum.attainment_pct || 0);
  }

  (whatChanged as any).since_date = sinceLabel;
  const anyMoved = whatChanged.created.count > 0 || whatChanged.won.count > 0 || whatChanged.lost.count > 0 || whatChanged.pushed.count > 0;
  if (!anyMoved) (whatChanged as any).nothing_moved = true;

  const segments: any = { omitted: true, reason: `No material segment change since ${sinceLabel}` };

  const changedReps = reps.items.filter((r: any) => r.flag_weeks && r.flag_weeks > 0);
  if (changedReps.length === 0 && reps.items.length > 0) {
    reps.items = [];
    (reps as any).omitted = true;
    (reps as any).reason = `No rep changes since ${sinceLabel}`;
  }

  const temporal = await computeTemporalContext(workspaceId).catch(() => null);
  const editorialFocus = determineEditorialFocus(briefType, theNumber, whatChanged as any, reps, deals, theNumber.days_remaining);
  const forecastAccuracyNote = await getForecastAccuracyContext(workspaceId).catch(() => undefined);

  emitter.toolCall('brief-assembler', 'generateNarrative', 'Synthesizing brief narrative');
  const rawBlurbs = await generateBriefNarratives(workspaceId, briefType, theNumber, whatChanged, reps.items, deals.items, editorialFocus, temporal?.weekOfQuarter, temporal?.quarterPhase as any, temporal?.pctQuarterComplete);
  const aiBlurbs = await annotateBriefNarrative(workspaceId, rawBlurbs, { theNumber, whatChanged, reps: reps.items, deals: deals.items });

  // Trigger partial accuracy write
  const periodLabel = getCurrentPeriodLabel();
  await writeQuarterlyForecastAccuracy(workspaceId, periodLabel).catch(err => console.error('Failed to write forecast accuracy:', err));

  emitter.agentDone('brief-assembler', 'Brief data assembled');

  return saveBrief(workspaceId, briefType, now, { theNumber, whatChanged, segments, reps, deals, aiBlurbs, editorialFocus, startTime, forecastAccuracyNote });
}

async function assembleFridayRecap(workspaceId: string, now: Date, briefType: BriefType, startTime: number, emitter: BriefSSEEmitter): Promise<AssembledBrief> {
  emitter.agentThinking('brief-assembler');

  const monday = getMonday(now);
  const priorMonday = subDays(monday, 7);
  const wonLostStages = await getWonLostStages(workspaceId);

  emitter.toolCall('brief-assembler', 'getTheNumber', 'Computing attainment');
  emitter.toolCall('brief-assembler', 'getWhatChanged', 'Analyzing pipeline changes');
  emitter.toolCall('brief-assembler', 'getSegments', 'Segmenting pipeline');
  emitter.toolCall('brief-assembler', 'getReps', 'Loading rep performance');
  emitter.toolCall('brief-assembler', 'getDealsToWatch', 'Identifying key deals');

  const [theNumber, whatChanged, segments, reps, deals] = await Promise.all([
    getTheNumber(workspaceId, wonLostStages, now),
    getWhatChanged(workspaceId, wonLostStages, monday, priorMonday, monday),
    getSegments(workspaceId, wonLostStages),
    getReps(workspaceId, wonLostStages),
    getDealsToWatch(workspaceId, wonLostStages, monday),
  ]);

  if (theNumber.chart_spec) emitter.chartSpec(theNumber.chart_spec);
  if (whatChanged.chart_spec) emitter.chartSpec(whatChanged.chart_spec);
  if (reps.chart_spec) emitter.chartSpec(reps.chart_spec);

  reps.items.sort((a: any, b: any) => (b.closed || 0) - (a.closed || 0));
  const wonThisWeek = await query<any>(`SELECT id::text, name, amount, stage, COALESCE(owner,'') as owner FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= $2 ORDER BY amount DESC LIMIT 5`, [workspaceId, monday.toISOString().split('T')[0]]);
  (deals as any).won_this_week = wonThisWeek.rows.map((d: any) => ({ id: d.id, name: d.name, amount: parseFloat(d.amount||'0'), owner: d.owner }));

  const temporal = await computeTemporalContext(workspaceId).catch(() => null);
  const editorialFocus = determineEditorialFocus(briefType, theNumber, whatChanged as any, reps, deals, theNumber.days_remaining);
  const forecastAccuracyNote = await getForecastAccuracyContext(workspaceId).catch(() => undefined);

  emitter.toolCall('brief-assembler', 'generateNarrative', 'Synthesizing brief narrative');
  const rawBlurbs = await generateBriefNarratives(workspaceId, briefType, theNumber, whatChanged, reps.items, deals.items, editorialFocus, temporal?.weekOfQuarter, temporal?.quarterPhase as any, temporal?.pctQuarterComplete);
  const aiBlurbs = await annotateBriefNarrative(workspaceId, rawBlurbs, { theNumber, whatChanged, reps: reps.items, deals: deals.items });

  // Trigger partial accuracy write
  const periodLabel = getCurrentPeriodLabel();
  await writeQuarterlyForecastAccuracy(workspaceId, periodLabel).catch(err => console.error('Failed to write forecast accuracy:', err));

  emitter.agentDone('brief-assembler', 'Brief data assembled');

  return saveBrief(workspaceId, briefType, now, { theNumber, whatChanged, segments, reps, deals, aiBlurbs, editorialFocus, startTime, forecastAccuracyNote });
}

async function assembleQuarterClose(workspaceId: string, now: Date, briefType: BriefType, startTime: number, emitter: BriefSSEEmitter): Promise<AssembledBrief> {
  emitter.agentThinking('brief-assembler');

  const wonLostStages = await getWonLostStages(workspaceId);
  const openFilter = buildOpenFilter(wonLostStages);

  emitter.toolCall('brief-assembler', 'getTheNumber', 'Computing attainment');
  emitter.toolCall('brief-assembler', 'getReps', 'Loading rep performance');

  const [theNumber, reps] = await Promise.all([
    getTheNumber(workspaceId, wonLostStages, now),
    getReps(workspaceId, wonLostStages),
  ]);

  if (theNumber.chart_spec) emitter.chartSpec(theNumber.chart_spec);
  if (reps.chart_spec) emitter.chartSpec(reps.chart_spec);

  reps.items.sort((a: any, b: any) => (b.gap || 0) - (a.gap || 0));

  const qEnd = quarterEnd(now).toISOString().split('T')[0];
  const closeable = await query<any>(`SELECT id::text, name, amount, stage, COALESCE(owner,'') as owner, close_date::text FROM deals WHERE workspace_id = $1 AND ${openFilter} AND close_date <= $2 ORDER BY close_date ASC`, [workspaceId, qEnd]);
  const riskRes = await query<any>(`SELECT f.deal_id::text, f.message, f.severity FROM findings f WHERE f.workspace_id = $1 AND f.resolved_at IS NULL AND f.severity IN ('act','watch')`, [workspaceId]);
  const riskMap = new Map(riskRes.rows.map((r: any) => [r.deal_id, r]));

  const deals: DealsToWatch = {
    items: closeable.rows.map((d: any) => {
      const risk = riskMap.get(d.id);
      return { id: d.id, name: d.name, amount: parseFloat(d.amount||'0'), stage: d.stage, owner: d.owner, close_date: d.close_date, severity: risk ? (risk.severity === 'act' ? 'critical' : 'warning') : 'info', signal_text: risk?.message || `${d.stage} · closes ${d.close_date}` };
    }),
  };

  const whatChanged: WhatChanged = { created: { count: 0, amount: 0 }, won: { count: 0, amount: 0 }, lost: { count: 0, amount: 0 }, pushed: { count: 0, amount: 0 } };
  const segments: any = { omitted: true, reason: 'Not shown during quarter-close' };
  const temporal = await computeTemporalContext(workspaceId).catch(() => null);
  const editorialFocus = determineEditorialFocus(briefType, theNumber, whatChanged, reps, deals, theNumber.days_remaining);

  emitter.toolCall('brief-assembler', 'generateNarrative', 'Synthesizing brief narrative');
  const rawBlurbs = await generateBriefNarratives(workspaceId, briefType, theNumber, whatChanged, reps.items, deals.items, editorialFocus, temporal?.weekOfQuarter, temporal?.quarterPhase as any, temporal?.pctQuarterComplete);

  // Closed-Loop Recommendations
  const outcomes = await getOutcomeSummaryForBrief(workspaceId, subDays(now, 7));
  if (outcomes.length > 0) {
    const outcomeBlock = "\n\n### Recommendation Outcomes\n" + outcomes.join('\n');
    if (rawBlurbs.overall_summary) {
      rawBlurbs.overall_summary += outcomeBlock;
    } else {
      rawBlurbs.overall_summary = outcomeBlock;
    }
  }

  const aiBlurbs = await annotateBriefNarrative(workspaceId, rawBlurbs, { theNumber, whatChanged, reps: reps.items, deals: deals.items });

  emitter.agentDone('brief-assembler', 'Brief data assembled');

  return saveBrief(workspaceId, briefType, now, { theNumber, whatChanged, segments, reps, deals, aiBlurbs, editorialFocus, startTime });
}

// ─── Save & parse ─────────────────────────────────────────────────────────────

async function saveBrief(workspaceId: string, briefType: BriefType, now: Date, data: { theNumber: any; whatChanged: any; segments: any; reps: any; deals: any; aiBlurbs: any; editorialFocus: any; startTime: number; forecastAccuracyNote?: string }): Promise<AssembledBrief> {
  const { theNumber, whatChanged, segments, reps, deals, aiBlurbs, editorialFocus, startTime, forecastAccuracyNote } = data;
  const todayStr = now.toISOString().split('T')[0];
  const monday = getMonday(now);
  const sunday = endOfWeek(monday);
  const qStart = quarterStart(now);
  const qEnd = quarterEnd(now);
  const daysInQ = Math.ceil((qEnd.getTime() - qStart.getTime()) / (1000 * 60 * 60 * 24));
  const sectionRefreshedAt: Record<string, string> = { the_number: now.toISOString(), what_changed: now.toISOString(), segments: now.toISOString(), reps: now.toISOString(), deals_to_watch: now.toISOString() };

  // Prior Document Comparison
  let comparisonBlock: string | undefined;
  let comparisonData: any | undefined;
  try {
    const comparison = await buildComparison(workspaceId, null); // currentBriefId is null during initial insert
    if (comparison) {
      comparisonData = comparison;
      comparisonBlock = formatComparisonBlock(comparison, []);
    }
  } catch (err) {
    console.error(`[brief-assembler] Comparison failed for ${workspaceId}:`, err);
  }

  // Build PandoraResponse envelope
  const builder = new PandoraResponseBuilder();

  // Opening summary
  if (aiBlurbs?.week_summary) {
    builder.addNarrative(aiBlurbs.week_summary);
  }

  // The number narrative
  if (aiBlurbs?.pulse_summary) {
    builder.addNarrative(aiBlurbs.pulse_summary);
  }

  // Existing chart_specs — all 3 already exist on AssembledBrief
  if (theNumber?.chart_spec) {
    builder.addChart(theNumber.chart_spec, false);
  }
  if (whatChanged?.chart_spec) {
    builder.addChart(whatChanged.chart_spec, false);
  }
  if (reps?.chart_spec) {
    builder.addChart(reps.chart_spec, false);
  }

  // Risk narrative
  if (aiBlurbs?.risk_narrative) {
    builder.addNarrative(aiBlurbs.risk_narrative, 'warning');
  }

  // Deals to watch → ActionCards
  for (const deal of deals?.items ?? []) {
    builder.addActionCard({
      severity: deal.severity === 'critical' ? 'critical' : 'warning',
      title: deal.name,
      rationale: deal.signal_text,
      target_entity_type: 'deal',
      target_entity_id: deal.id,
      target_entity_name: deal.name,
      cta_label: 'View deal',
      cta_href: `/deals/${deal.id}`,
    });
  }

  // Key action
  if (aiBlurbs?.key_action) {
    builder.addNarrative(aiBlurbs.key_action, 'info');
  }

  const pandoraResponse = builder.build('concierge', workspaceId);

  const result = await query<any>(
    `INSERT INTO weekly_briefs (workspace_id, brief_type, generated_date, period_start, period_end, days_in_quarter, days_remaining, the_number, what_changed, segments, reps, deals_to_watch, ai_blurbs, editorial_focus, section_refreshed_at, status, assembly_duration_ms, comparison_block, comparison_data, forecast_accuracy_note, pandora_response)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ready',$16,$17,$18,$19,$20)
     ON CONFLICT (workspace_id, generated_date) DO UPDATE SET
       brief_type=$2, period_start=$4, period_end=$5, days_in_quarter=$6, days_remaining=$7,
       the_number=$8, what_changed=$9, segments=$10, reps=$11, deals_to_watch=$12,
       ai_blurbs=$13, editorial_focus=$14, section_refreshed_at=$15,
       status='ready', assembly_duration_ms=$16, updated_at=NOW(),
       comparison_block=$17, comparison_data=$18, forecast_accuracy_note=$19, pandora_response=$20
     RETURNING *`,
    [workspaceId, briefType, todayStr, monday.toISOString().split('T')[0], sunday.toISOString().split('T')[0], daysInQ, theNumber.days_remaining, JSON.stringify(theNumber), JSON.stringify(whatChanged), JSON.stringify(segments), JSON.stringify(reps), JSON.stringify(deals), JSON.stringify(aiBlurbs), JSON.stringify(editorialFocus), JSON.stringify(sectionRefreshedAt), Date.now() - startTime, comparisonBlock, JSON.stringify(comparisonData), forecastAccuracyNote, JSON.stringify(pandoraResponse)]
  );

  console.log(`[brief-assembler] ${briefType} brief ready for workspace ${workspaceId} in ${Date.now() - startTime}ms`);

  // Post consolidated brief to Slack (fire-and-forget)
  postBriefToSlack(workspaceId, result.rows[0].id, parseBriefRow(result.rows[0])).catch(err => {
    console.error('[brief-assembler] Failed to post brief to Slack:', err.message);
  });
  
  // Write to workspace memory
  if (deals?.items && deals.items.length > 0) {
    const findings = deals.items
      .filter((d: any) => d.severity === 'critical' || d.severity === 'warning')
      .map((d: any) => ({
        entity_type: 'deal',
        entity_id: d.id,
        entity_name: d.name,
        message: d.signal_text,
        severity: d.severity === 'critical' ? 'act' : 'watch'
      }));
    if (findings.length > 0) {
      writeMemoryFromBriefAssembly(workspaceId, result.rows[0].id, findings).catch(err => {
        console.error('[brief-assembler] Failed to write memory:', err.message);
      });
    }
  }

  return parseBriefRow(result.rows[0]);
}

function parseBriefRow(row: any): AssembledBrief {
  const p = (v: any) => typeof v === 'string' ? JSON.parse(v) : (v ?? {});
  return { ...row, the_number: p(row.the_number), what_changed: p(row.what_changed), segments: p(row.segments), reps: p(row.reps), deals_to_watch: p(row.deals_to_watch), ai_blurbs: p(row.ai_blurbs), editorial_focus: p(row.editorial_focus), section_refreshed_at: p(row.section_refreshed_at), sent_to: p(row.sent_to) || [], edited_sections: p(row.edited_sections) || {} };
}

export async function getLatestBrief(workspaceId: string): Promise<AssembledBrief | null> {
  const result = await query<any>(`SELECT * FROM weekly_briefs WHERE workspace_id = $1 AND status IN ('ready','sent','edited') ORDER BY generated_at DESC LIMIT 1`, [workspaceId]);
  if (result.rows.length === 0) return null;
  return parseBriefRow(result.rows[0]);
}

async function postBriefToSlack(
  workspaceId: string,
  briefId: string,
  brief: AssembledBrief
): Promise<void> {
  const { getSlackAppClient } = await import('../connectors/slack/slack-app-client.js');
  const { renderBriefToBlockKit } = await import('../slack/brief-renderer.js');

  const slackClient = getSlackAppClient();
  const briefChannel = await slackClient.getDefaultChannel(workspaceId);
  if (!briefChannel) {
    console.log('[brief-assembler] No Slack channel configured — skipping brief post');
    return;
  }

  const blocks = renderBriefToBlockKit(brief, { includeFullFindingsButton: true });
  const ref = await slackClient.postMessage(workspaceId, briefChannel, blocks as any);

  if (ref.ts && ref.channel) {
    await query(
      `UPDATE weekly_briefs SET slack_message_ts=$1, slack_channel_id=$2 WHERE id=$3`,
      [ref.ts, ref.channel, briefId]
    );
    console.log(`[brief-assembler] Brief posted to Slack channel ${ref.channel} ts=${ref.ts}`);
  }
}

// ─── Live Query Architecture (T004 + T005) ────────────────────────────────────

export interface LiveBriefNarrative {
  week_summary: string;
  pulse_summary: string;
  key_action: string;
  rep_observations: string;
  risk_narrative: string;
}

export async function assembleLiveBrief(
  workspaceId: string,
  triggeredBy: 'cron' | 'material_sync_change' | 'user_request'
): Promise<{
  brief: AssembledBrief | null;
  skipped: boolean;
  skip_reason?: string;
  synthesis_ran: boolean;
  tokens_used: number;
  is_byok?: boolean;
  next_refresh_allowed_at?: string;
  data_freshness?: { queried_at: string; last_crm_sync_at: string | null; sync_lag_minutes: number | null };
}> {
  const startTime = Date.now();

  // Step 1: Check rate limit for user-initiated requests
  if (triggeredBy === 'user_request') {
    const rateLimit = await checkRefreshRateLimit(workspaceId);
    if (!rateLimit.allowed) {
      await logRefreshAttempt(workspaceId, {
        triggered_by: triggeredBy,
        data_changed: false,
        synthesis_ran: false,
        rate_limited: true,
        tokens_used: 0,
        duration_ms: Date.now() - startTime,
      });
      return {
        brief: await getLatestBrief(workspaceId),
        skipped: true,
        skip_reason: rateLimit.reason,
        synthesis_ran: false,
        tokens_used: 0,
        is_byok: false,
        next_refresh_allowed_at: rateLimit.next_allowed_at,
      };
    }
  }

  // Step 2: Compute fingerprint
  const { fingerprint, inputs } = await computeBriefFingerprint(workspaceId);
  const lastFingerprint = await getLastBriefFingerprint(workspaceId);
  const dataChanged = fingerprint !== lastFingerprint;

  // Step 3: Serve cached brief if nothing changed
  if (!dataChanged && lastFingerprint !== null) {
    await logRefreshAttempt(workspaceId, {
      triggered_by: triggeredBy,
      fingerprint_before: lastFingerprint,
      fingerprint_after: fingerprint,
      data_changed: false,
      synthesis_ran: false,
      rate_limited: false,
      tokens_used: 0,
      duration_ms: Date.now() - startTime,
    });
    return {
      brief: await getLatestBrief(workspaceId),
      skipped: true,
      skip_reason: 'No data changes since last brief',
      synthesis_ran: false,
      tokens_used: 0,
    };
  }

  // Step 4: Run live query pass
  const liveData = await assembleLiveBriefData(workspaceId);

  // Step 5: Compute delta vs prior brief
  const priorBrief = await getLatestBrief(workspaceId);
  if (priorBrief?.the_number) {
    liveData.delta = computeDelta(liveData, priorBrief);
  }

  // Step 6: Synthesize narrative with prompt caching
  const { narrative, tokensUsed } = await synthesizeBriefNarrative(workspaceId, liveData);

  // Step 7: Store new brief
  const newBrief = await storeLiveBrief(workspaceId, {
    liveData,
    narrative,
    fingerprint,
    fingerprintInputs: inputs,
    assembledAt: new Date().toISOString(),
    dataSource: 'live_query',
  });

  await logRefreshAttempt(workspaceId, {
    triggered_by: triggeredBy,
    fingerprint_before: lastFingerprint,
    fingerprint_after: fingerprint,
    data_changed: true,
    synthesis_ran: true,
    rate_limited: false,
    tokens_used: tokensUsed,
    duration_ms: Date.now() - startTime,
  });

  console.log(`[brief-assembler] Live brief assembled for ${workspaceId} in ${Date.now() - startTime}ms, tokens=${tokensUsed}`);

  return {
    brief: newBrief,
    skipped: false,
    synthesis_ran: true,
    tokens_used: tokensUsed,
    data_freshness: liveData.data_freshness,
  };
}

async function synthesizeBriefNarrative(
  workspaceId: string,
  liveData: LiveBriefData
): Promise<{ narrative: LiveBriefNarrative; tokensUsed: number }> {
  const workspaceContext = await getWorkspaceContext(workspaceId);

  // T005: Prompt caching — the LLM router automatically applies cache_control: ephemeral
  // to the systemPrompt for Anthropic. The static system prompt + workspace context
  // is the ideal cache target (~800-1200 tokens, above the 1024 minimum).
  const briefSystemPrompt = await buildBriefSystemPrompt(workspaceId);
  const systemPrompt = `${briefSystemPrompt}

<workspace_context>
${workspaceContext}
</workspace_context>

## Pandora Product Knowledge
${PANDORA_PRODUCT_KNOWLEDGE}

${PANDORA_SUPPORT_CONTEXT}`;

  const dynamicContent = buildDynamicBriefContent(liveData);

  const response = await callLLM(workspaceId, 'reason', {
    systemPrompt,
    messages: [
      {
        role: 'user' as const,
        content: dynamicContent,
      },
    ],
    maxTokens: 1200,
    temperature: 0.4,
    _tracking: {
      workspaceId,
      skillId: 'brief-synthesis',
      phase: 'synthesize',
      stepName: 'narrative',
    },
  });

  const cacheRead = (response.usage as any)?.cache_read_input_tokens || 0;
  const tokensUsed = ((response.usage as any)?.input_tokens || 0)
    + ((response.usage as any)?.output_tokens || 0)
    - cacheRead;

  const narrative = parseBriefNarrative(response.content);
  return { narrative, tokensUsed };
}

async function buildBriefSystemPrompt(workspaceId: string): Promise<string> {
  const dictionaryContext = await getDictionaryContext(workspaceId).catch(() => '');
  const toolContext = getToolDefinitionsContext();

  return `You are the VP RevOps analyst embedded in this team. You have already looked at the data before anyone got in. You have a point of view and you're prepared to defend it.

${dictionaryContext}
${toolContext}

VOICE RULES:
- Use "we" and "I" — you own the number with the team
- Make calls. "The commit number doesn't reflect what I'm seeing" not "there may be risk"
- Name people and deals. Generic findings are useless.
- State the one thing that matters most this week as your focus — not a suggestion, a directive
- Never present a relative number without the absolute base
- Never state causation — state correlation and invite investigation
- Hedged language for low-confidence observations: "early signal", "worth watching"
- Direct language for high-confidence findings: "We have a problem here"

OUTPUT FORMAT (JSON):
{
  "week_summary": "2-3 sentence narrative of current state in the teammate voice",
  "pulse_summary": "1 sentence — the single most important thing right now",
  "key_action": "The one concrete action for this week — specific, named, time-bound",
  "rep_observations": "1-2 sentences about rep-level patterns worth noting",
  "risk_narrative": "1-2 sentences on the biggest risk to the quarter, if any"
}`;
}

function buildDynamicBriefContent(liveData: LiveBriefData): string {
  const n = liveData.the_number;
  const deals = liveData.deals_to_watch.slice(0, 8);
  const reps = liveData.rep_summary;

  const deltaSection = liveData.delta ? `
CHANGES SINCE LAST BRIEF:
- Pipeline movement: ${liveData.delta.pipeline_change >= 0 ? '+' : ''}${formatK(liveData.delta.pipeline_change)}
${liveData.delta.new_closed_won.length > 0 ? `- New closed won: ${liveData.delta.new_closed_won.map(d => `${d.name} (${formatK(d.amount)})`).join(', ')}` : ''}
${liveData.delta.newly_at_risk.length > 0 ? `- Newly at risk: ${liveData.delta.newly_at_risk.map(d => `${d.name} (${d.reason})`).join(', ')}` : ''}` : '';

  return `<current_data queried_at="${liveData.data_freshness.queried_at}">
ATTAINMENT: ${n.attainment_pct}% ($${formatM(n.closed_won_amount)} closed of $${formatM(n.quota_amount)} quota)
GAP: $${formatM(n.gap_amount)} remaining | ${n.days_remaining} days left | ${n.pipeline_label}
COVERAGE: ${n.coverage_ratio}x ($${formatM(n.open_pipeline_amount)} open pipeline, ${n.open_pipeline_count} deals)

TOP OPEN DEALS:
${deals.map(d =>
  `- ${d.name}: $${formatK(d.amount)} | ${d.stage} | ${d.owner_name} | closes ${d.close_date} | ${d.contact_count} contacts | ${d.days_since_activity != null ? `${d.days_since_activity}d since activity` : 'activity recent'}${d.risk_flags.length > 0 ? ` | FLAGS: ${d.risk_flags[0]}` : ''}`
).join('\n')}

REPS:
${reps.map(r =>
  `- ${r.owner_name}: $${formatM(r.pipeline_amount)} pipeline | $${formatM(r.closed_won_amount)} closed | ${r.coverage_ratio}x coverage | ${r.deal_count} deals`
).join('\n')}
${deltaSection}
</current_data>

Write the brief narrative in the specified JSON format.`;
}

async function getWorkspaceContext(workspaceId: string): Promise<string> {
  const [workspaceResult, quotaResult, repResult] = await Promise.all([
    query<{ name: string }>(
      `SELECT name FROM workspaces WHERE id = $1`,
      [workspaceId]
    ),
    query<{ period_start: string; period_end: string; amount: string; pipeline_name: string | null }>(
      `SELECT period_start::text, period_end::text, amount::text, pipeline_name
       FROM targets
       WHERE workspace_id = $1 AND is_active = true
         AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE
       ORDER BY period_start DESC LIMIT 1`,
      [workspaceId]
    ),
    query<{ owner_name: string }>(
      `SELECT DISTINCT owner_name FROM deals
       WHERE workspace_id = $1 AND owner_name IS NOT NULL
       ORDER BY owner_name LIMIT 20`,
      [workspaceId]
    ),
  ]);

  const companyName = workspaceResult.rows[0]?.name || 'this company';
  const quota = quotaResult.rows[0];
  const repNames = repResult.rows.map(r => r.owner_name).join(', ');

  return [
    `Company: ${companyName}`,
    quota ? `Quarter: ${quota.period_start} to ${quota.period_end}` : '',
    quota ? `Quota: $${formatM(Number(quota.amount))}` : '',
    quota?.pipeline_name ? `Primary pipeline: ${quota.pipeline_name}` : '',
    repNames ? `Reps: ${repNames}` : '',
  ].filter(Boolean).join('\n');
}

function parseBriefNarrative(content: string): LiveBriefNarrative {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        week_summary: parsed.week_summary || '',
        pulse_summary: parsed.pulse_summary || '',
        key_action: parsed.key_action || '',
        rep_observations: parsed.rep_observations || '',
        risk_narrative: parsed.risk_narrative || '',
      };
    }
  } catch {
    // fall through
  }
  return {
    week_summary: content.slice(0, 500),
    pulse_summary: '',
    key_action: '',
    rep_observations: '',
    risk_narrative: '',
  };
}

function computeDelta(current: LiveBriefData, prior: any): LiveBriefData['delta'] {
  const priorPipeline = prior.the_number?.open_pipeline_amount || 0;
  const currentPipeline = current.the_number.open_pipeline_amount;

  const priorDealIds = new Set((prior.deals_to_watch || []).map((d: any) => d.id));

  const newClosedWon = current.deals_to_watch
    .filter(d => !priorDealIds.has(d.id) && d.stage === 'closed_won')
    .map(d => ({ name: d.name, amount: d.amount }));

  const newlyAtRisk = current.deals_to_watch
    .filter(d => d.days_since_activity != null && d.days_since_activity >= 14)
    .filter(d => {
      const priorDeal = (prior.deals_to_watch || []).find((p: any) => p.id === d.id);
      return !priorDeal || (priorDeal.days_since_activity || 0) < 14;
    })
    .map(d => ({ name: d.name, reason: `No activity in ${d.days_since_activity} days` }));

  return {
    pipeline_change: currentPipeline - priorPipeline,
    new_closed_won: newClosedWon,
    newly_at_risk: newlyAtRisk,
  };
}

async function storeLiveBrief(
  workspaceId: string,
  opts: {
    liveData: LiveBriefData;
    narrative: LiveBriefNarrative;
    fingerprint: string;
    fingerprintInputs: any;
    assembledAt: string;
    dataSource: string;
  }
): Promise<AssembledBrief> {
  const { liveData, narrative, fingerprint, fingerprintInputs, assembledAt, dataSource } = opts;
  const todayStr = new Date().toISOString().split('T')[0];

  const aiBlurbs = {
    week_summary: narrative.week_summary,
    pulse_summary: narrative.pulse_summary,
    key_action: narrative.key_action,
    rep_observations: narrative.rep_observations,
    risk_narrative: narrative.risk_narrative,
  };

  const theNumber = liveData.the_number;
  const dealsToWatch = { deals: liveData.deals_to_watch };

  const result = await query<any>(
    `INSERT INTO weekly_briefs (
       workspace_id, brief_type, generated_date, status,
       the_number, deals_to_watch, ai_blurbs,
       what_changed, segments, reps,
       fingerprint, fingerprint_inputs, data_source, live_query_at, assembled_at,
       assembly_duration_ms
     ) VALUES ($1, $2, $3, 'ready', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0)
     ON CONFLICT (workspace_id, generated_date) DO UPDATE SET
       status = 'ready',
       the_number = EXCLUDED.the_number,
       deals_to_watch = EXCLUDED.deals_to_watch,
       ai_blurbs = EXCLUDED.ai_blurbs,
       fingerprint = EXCLUDED.fingerprint,
       fingerprint_inputs = EXCLUDED.fingerprint_inputs,
       data_source = EXCLUDED.data_source,
       live_query_at = EXCLUDED.live_query_at,
       assembled_at = EXCLUDED.assembled_at,
       updated_at = NOW()
     RETURNING *`,
    [
      workspaceId,
      'pulse',
      todayStr,
      JSON.stringify(theNumber),
      JSON.stringify(dealsToWatch),
      JSON.stringify(aiBlurbs),
      JSON.stringify({}),
      JSON.stringify({}),
      JSON.stringify({ reps: liveData.rep_summary }),
      fingerprint,
      JSON.stringify(fingerprintInputs),
      dataSource,
      liveData.data_freshness.queried_at,
      assembledAt,
    ]
  );

  return parseBriefRow(result.rows[0]);
}

async function logRefreshAttempt(
  workspaceId: string,
  opts: {
    triggered_by: string;
    fingerprint_before?: string | null;
    fingerprint_after?: string;
    data_changed: boolean;
    synthesis_ran: boolean;
    rate_limited: boolean;
    tokens_used: number;
    duration_ms: number;
  }
): Promise<void> {
  try {
    await query(
      `INSERT INTO brief_refresh_log
         (workspace_id, triggered_by, fingerprint_before, fingerprint_after,
          data_changed, synthesis_ran, tokens_used, rate_limited, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        workspaceId,
        opts.triggered_by,
        opts.fingerprint_before || null,
        opts.fingerprint_after || null,
        opts.data_changed,
        opts.synthesis_ran,
        opts.tokens_used,
        opts.rate_limited,
        opts.duration_ms,
      ]
    );
  } catch (err) {
    console.error('[brief-assembler] Failed to log refresh attempt:', err);
  }
}

function formatM(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

function formatK(n: number): string {
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}
