import { query } from '../db.js';
import {
  getMonday, endOfWeek, subDays, quarterStart, quarterEnd, getQuarter,
  daysRemainingInQuarter, getWonLostStages,
  getCurrentQuota, formatCompact, ordinal, buildOpenFilter,
} from './brief-utils.js';
import { determineBriefType, determineEditorialFocus } from './editorial-engine.js';
import { generateBriefNarratives } from './brief-narratives.js';
import type { BriefType, TheNumber, WhatChanged, Segments, Reps, DealsToWatch, AssembledBrief } from './brief-types.js';

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function assembleBrief(
  workspaceId: string,
  options: { brief_type?: BriefType; force?: boolean } = {}
): Promise<AssembledBrief> {
  const startTime = Date.now();
  const now = new Date();
  const briefType = options.brief_type ?? determineBriefType(now);
  const todayStr = now.toISOString().split('T')[0];

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
      result = await assembleMondaySetup(workspaceId, now, briefType, startTime);
    } else if (briefType === 'friday_recap') {
      result = await assembleFridayRecap(workspaceId, now, briefType, startTime);
    } else if (briefType === 'quarter_close') {
      result = await assembleQuarterClose(workspaceId, now, briefType, startTime);
    } else {
      result = await assemblePulse(workspaceId, now, briefType, startTime);
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
    const wonRes = await query<{ total: string }>(
      `SELECT COALESCE(SUM(amount),0)::text as total FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= $2 AND close_date <= $3`,
      [workspaceId, quota.period_start, quota.period_end]
    );
    wonThisPeriod = parseFloat(wonRes.rows[0]?.total || '0');
  }

  const target = quota?.target || 0;
  const gap = target > 0 ? Math.max(0, target - wonThisPeriod) : 0;
  const attainmentPct = target > 0 ? (wonThisPeriod / target) * 100 : 0;
  const winRate = (fResult as any).win_rate || 0.3;
  const coverageOnGap = gap > 0 && winRate > 0 ? pipelineTotal / (gap / winRate) : 0;

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
  const lostAmt = parseFloat(thisLost.rows[0]?.total || '0');
  const pushedAmt = parseFloat(pushed.rows[0]?.total || '0');
  const totalPipelineDelta = createdAmt - lostAmt - pushedAmt;

  return {
    created: { count: parseInt(thisCreated.rows[0]?.cnt || '0'), amount: createdAmt, prev_count: parseInt(priorCreated.rows[0]?.cnt || '0'), prev_amount: parseFloat(priorCreated.rows[0]?.total || '0') },
    won: { count: parseInt(thisWon.rows[0]?.cnt || '0'), amount: parseFloat(thisWon.rows[0]?.total || '0'), prev_count: parseInt(priorWon.rows[0]?.cnt || '0'), prev_amount: parseFloat(priorWon.rows[0]?.total || '0') },
    lost: { count: parseInt(thisLost.rows[0]?.cnt || '0'), amount: lostAmt, prev_count: parseInt(priorLost.rows[0]?.cnt || '0'), prev_amount: parseFloat(priorLost.rows[0]?.total || '0') },
    pushed: { count: parseInt(pushed.rows[0]?.cnt || '0'), amount: pushedAmt },
    total_pipeline_delta: totalPipelineDelta,
    streak,
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

  const [repRes, closedRes, quotaRes, findingsRes] = await Promise.all([
    query<any>(`SELECT COALESCE(owner_email, '') as email, COALESCE(owner_name, owner_email, 'Unknown') as name, COALESCE(SUM(amount),0)::text as pipeline, COUNT(*)::text as cnt FROM deals WHERE workspace_id = $1 AND ${openFilter} GROUP BY owner_email, owner_name ORDER BY SUM(amount) DESC`, [workspaceId]),
    query<any>(`SELECT COALESCE(owner_email,'') as email, COALESCE(SUM(amount),0)::text as closed FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= $2 AND close_date <= $3 GROUP BY owner_email`, [workspaceId, ps, pe]),
    query<any>(`SELECT rq.rep_identifier, rq.quota_value::text FROM rep_quotas rq JOIN quota_periods qp ON qp.id = rq.quota_period_id WHERE rq.workspace_id = $1 AND NOW() BETWEEN qp.period_start AND qp.period_end`, [workspaceId]),
    query<any>(`SELECT COALESCE(owner_email, entity_id, '') as entity_id, message, COALESCE(escalation_level,0)::text as escalation_level, COALESCE(times_flagged,1)::text as times_flagged FROM findings WHERE workspace_id = $1 AND resolved_at IS NULL AND severity IN ('act', 'watch') ORDER BY escalation_level DESC, times_flagged DESC`, [workspaceId]),
  ]);

  const closedMap = new Map(closedRes.rows.map((r: any) => [r.email, parseFloat(r.closed)]));
  const quotaMap = new Map(quotaRes.rows.map((r: any) => [r.rep_identifier, parseFloat(r.quota_value)]));
  const flagMap = new Map<string, any>();
  for (const f of findingsRes.rows) {
    if (!flagMap.has(f.entity_id)) flagMap.set(f.entity_id, f);
  }

  return {
    items: repRes.rows.map((r: any) => {
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
    }),
  };
}

async function getDealsToWatch(workspaceId: string, wonLostStages: string[], since?: Date): Promise<DealsToWatch> {
  const openFilter = buildOpenFilter(wonLostStages);
  const sinceStr = (since || subDays(new Date(), 7)).toISOString();

  const [topDeals, riskyDeals, wonDeals] = await Promise.all([
    query<any>(`SELECT id::text, name, amount, stage, pipeline, COALESCE(owner_name,owner_email,'') as owner, close_date::text FROM deals WHERE workspace_id = $1 AND ${openFilter} ORDER BY amount DESC LIMIT 5`, [workspaceId]),
    query<any>(`SELECT DISTINCT d.id::text, d.name, d.amount, d.stage, COALESCE(d.owner_name,d.owner_email,'') as owner, d.close_date::text, f.message as signal_text, f.severity FROM findings f JOIN deals d ON d.id = f.deal_id AND d.workspace_id = f.workspace_id WHERE f.workspace_id = $1 AND f.resolved_at IS NULL AND f.severity IN ('act','watch') ORDER BY d.amount DESC LIMIT 5`, [workspaceId]),
    query<any>(`SELECT id::text, name, amount, stage, COALESCE(owner_name,owner_email,'') as owner FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= $2 ORDER BY amount DESC LIMIT 3`, [workspaceId, sinceStr]),
  ]);

  const dealMap = new Map<string, any>();
  for (const d of riskyDeals.rows) dealMap.set(d.name, { id: d.id, name: d.name, amount: parseFloat(d.amount||'0'), stage: d.stage, owner: d.owner, close_date: d.close_date, severity: d.severity === 'act' ? 'critical' : 'warning', signal_text: d.signal_text });
  for (const d of topDeals.rows) if (!dealMap.has(d.name)) dealMap.set(d.name, { id: d.id, name: d.name, amount: parseFloat(d.amount||'0'), stage: d.stage, owner: d.owner, close_date: d.close_date, severity: 'info', signal_text: `${formatCompact(parseFloat(d.amount||'0'))} in ${d.stage}` });
  for (const d of wonDeals.rows) dealMap.set(d.name, { id: d.id, name: d.name, amount: parseFloat(d.amount||'0'), stage: d.stage, owner: d.owner, severity: 'positive', signal_text: 'Won this week' });

  const order: Record<string, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  return { items: Array.from(dealMap.values()).sort((a, b) => (order[a.severity]??2) - (order[b.severity]??2) || b.amount - a.amount).slice(0, 8) };
}

// ─── Sub-assemblers ───────────────────────────────────────────────────────────

async function assembleMondaySetup(workspaceId: string, now: Date, briefType: BriefType, startTime: number): Promise<AssembledBrief> {
  const monday = getMonday(now);
  const priorMonday = subDays(monday, 7);
  const wonLostStages = await getWonLostStages(workspaceId);
  const [theNumber, whatChanged, segments, reps, deals] = await Promise.all([
    getTheNumber(workspaceId, wonLostStages, now),
    getWhatChanged(workspaceId, wonLostStages, monday, priorMonday, monday),
    getSegments(workspaceId, wonLostStages),
    getReps(workspaceId, wonLostStages),
    getDealsToWatch(workspaceId, wonLostStages, subDays(now, 7)),
  ]);
  const editorialFocus = determineEditorialFocus(briefType, theNumber, whatChanged as any, reps, deals, theNumber.days_remaining);
  const aiBlurbs = await generateBriefNarratives(workspaceId, briefType, theNumber, whatChanged, reps.items, deals.items, editorialFocus);
  return saveBrief(workspaceId, briefType, now, { theNumber, whatChanged, segments, reps, deals, aiBlurbs, editorialFocus, startTime });
}

async function assemblePulse(workspaceId: string, now: Date, briefType: BriefType, startTime: number): Promise<AssembledBrief> {
  const wonLostStages = await getWonLostStages(workspaceId);
  const mondayBriefRes = await query<any>(`SELECT generated_at::text, the_number FROM weekly_briefs WHERE workspace_id = $1 AND brief_type = 'monday_setup' AND status IN ('ready','sent','edited') ORDER BY generated_at DESC LIMIT 1`, [workspaceId]);
  const mondayBrief = mondayBriefRes.rows[0];
  const since = mondayBrief ? new Date(mondayBrief.generated_at) : getMonday(now);
  const sinceLabel = since.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const [theNumber, whatChanged, reps, deals] = await Promise.all([
    getTheNumber(workspaceId, wonLostStages, now),
    getWhatChanged(workspaceId, wonLostStages, since, subDays(since, 7), since),
    getReps(workspaceId, wonLostStages),
    getDealsToWatch(workspaceId, wonLostStages, since),
  ]);

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

  const editorialFocus = determineEditorialFocus(briefType, theNumber, whatChanged as any, reps, deals, theNumber.days_remaining);
  const aiBlurbs = await generateBriefNarratives(workspaceId, briefType, theNumber, whatChanged, reps.items, deals.items, editorialFocus);
  return saveBrief(workspaceId, briefType, now, { theNumber, whatChanged, segments, reps, deals, aiBlurbs, editorialFocus, startTime });
}

async function assembleFridayRecap(workspaceId: string, now: Date, briefType: BriefType, startTime: number): Promise<AssembledBrief> {
  const monday = getMonday(now);
  const priorMonday = subDays(monday, 7);
  const wonLostStages = await getWonLostStages(workspaceId);

  const [theNumber, whatChanged, segments, reps, deals] = await Promise.all([
    getTheNumber(workspaceId, wonLostStages, now),
    getWhatChanged(workspaceId, wonLostStages, monday, priorMonday, monday),
    getSegments(workspaceId, wonLostStages),
    getReps(workspaceId, wonLostStages),
    getDealsToWatch(workspaceId, wonLostStages, monday),
  ]);

  reps.items.sort((a: any, b: any) => (b.closed || 0) - (a.closed || 0));
  const wonThisWeek = await query<any>(`SELECT id::text, name, amount, stage, COALESCE(owner_name,owner_email,'') as owner FROM deals WHERE workspace_id = $1 AND stage_normalized = 'closed_won' AND close_date >= $2 ORDER BY amount DESC LIMIT 5`, [workspaceId, monday.toISOString().split('T')[0]]);
  (deals as any).won_this_week = wonThisWeek.rows.map((d: any) => ({ id: d.id, name: d.name, amount: parseFloat(d.amount||'0'), owner: d.owner }));

  const editorialFocus = determineEditorialFocus(briefType, theNumber, whatChanged as any, reps, deals, theNumber.days_remaining);
  const aiBlurbs = await generateBriefNarratives(workspaceId, briefType, theNumber, whatChanged, reps.items, deals.items, editorialFocus);
  return saveBrief(workspaceId, briefType, now, { theNumber, whatChanged, segments, reps, deals, aiBlurbs, editorialFocus, startTime });
}

async function assembleQuarterClose(workspaceId: string, now: Date, briefType: BriefType, startTime: number): Promise<AssembledBrief> {
  const wonLostStages = await getWonLostStages(workspaceId);
  const openFilter = buildOpenFilter(wonLostStages);
  const [theNumber, reps] = await Promise.all([
    getTheNumber(workspaceId, wonLostStages, now),
    getReps(workspaceId, wonLostStages),
  ]);

  reps.items.sort((a: any, b: any) => (b.gap || 0) - (a.gap || 0));

  const qEnd = quarterEnd(now).toISOString().split('T')[0];
  const closeable = await query<any>(`SELECT id::text, name, amount, stage, COALESCE(owner_name,owner_email,'') as owner, close_date::text FROM deals WHERE workspace_id = $1 AND ${openFilter} AND close_date <= $2 ORDER BY close_date ASC`, [workspaceId, qEnd]);
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
  const editorialFocus = determineEditorialFocus(briefType, theNumber, whatChanged, reps, deals, theNumber.days_remaining);
  const aiBlurbs = await generateBriefNarratives(workspaceId, briefType, theNumber, whatChanged, reps.items, deals.items, editorialFocus);
  return saveBrief(workspaceId, briefType, now, { theNumber, whatChanged, segments, reps, deals, aiBlurbs, editorialFocus, startTime });
}

// ─── Save & parse ─────────────────────────────────────────────────────────────

async function saveBrief(workspaceId: string, briefType: BriefType, now: Date, data: { theNumber: any; whatChanged: any; segments: any; reps: any; deals: any; aiBlurbs: any; editorialFocus: any; startTime: number }): Promise<AssembledBrief> {
  const { theNumber, whatChanged, segments, reps, deals, aiBlurbs, editorialFocus, startTime } = data;
  const todayStr = now.toISOString().split('T')[0];
  const monday = getMonday(now);
  const sunday = endOfWeek(monday);
  const qStart = quarterStart(now);
  const qEnd = quarterEnd(now);
  const daysInQ = Math.ceil((qEnd.getTime() - qStart.getTime()) / (1000 * 60 * 60 * 24));
  const sectionRefreshedAt: Record<string, string> = { the_number: now.toISOString(), what_changed: now.toISOString(), segments: now.toISOString(), reps: now.toISOString(), deals_to_watch: now.toISOString() };

  const result = await query<any>(
    `INSERT INTO weekly_briefs (workspace_id, brief_type, generated_date, period_start, period_end, days_in_quarter, days_remaining, the_number, what_changed, segments, reps, deals_to_watch, ai_blurbs, editorial_focus, section_refreshed_at, status, assembly_duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ready',$16)
     ON CONFLICT (workspace_id, generated_date) DO UPDATE SET
       brief_type=$2, period_start=$4, period_end=$5, days_in_quarter=$6, days_remaining=$7,
       the_number=$8, what_changed=$9, segments=$10, reps=$11, deals_to_watch=$12,
       ai_blurbs=$13, editorial_focus=$14, section_refreshed_at=$15,
       status='ready', assembly_duration_ms=$16, updated_at=NOW()
     RETURNING *`,
    [workspaceId, briefType, todayStr, monday.toISOString().split('T')[0], sunday.toISOString().split('T')[0], daysInQ, theNumber.days_remaining, JSON.stringify(theNumber), JSON.stringify(whatChanged), JSON.stringify(segments), JSON.stringify(reps), JSON.stringify(deals), JSON.stringify(aiBlurbs), JSON.stringify(editorialFocus), JSON.stringify(sectionRefreshedAt), Date.now() - startTime]
  );

  console.log(`[brief-assembler] ${briefType} brief ready for workspace ${workspaceId} in ${Date.now() - startTime}ms`);
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
