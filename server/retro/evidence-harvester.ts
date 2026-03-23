/**
 * Quarterly Retrospective — Phase 0: Evidence Harvest
 *
 * Pure SQL reads against skill_runs and deals — zero LLM calls, zero tokens.
 * Extracts cached evidence from the 7 diagnostic skills, assesses operating
 * history tier, and harvests whale deal signals for EC-01 detection.
 */

import { query } from '../db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarvestedEvidence {
  skill_id: string;
  run_id: string;
  run_at: Date;
  freshness: 'fresh' | 'recent' | 'stale' | 'missing';
  headline: string;
  signals: string[];
  data_quality_tier: 1 | 2 | 3;
  diagnostic_layers: number[];
}

export interface QuarterWindow {
  label: string;
  start: Date;
  end: Date;
}

// ─── EC-02: History Assessment ────────────────────────────────────────────────

export interface HistoryAssessment {
  tier: 1 | 2 | 3;
  closed_deals: number;
  days_of_data: number;
  quarters_with_closes: number;
  benchmark_source: 'workspace' | 'proxy';
  layers_available: number[];
}

export async function assessHistoryTier(workspaceId: string): Promise<HistoryAssessment> {
  const result = await query<{
    closed_deals: string;
    days_of_data: string | null;
    quarters_with_closes: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE stage_normalized IN ('closed_won', 'closed_lost')) AS closed_deals,
       EXTRACT(DAY FROM NOW() - MIN(created_date))                               AS days_of_data,
       COUNT(DISTINCT DATE_TRUNC('quarter', close_date))
         FILTER (WHERE stage_normalized = 'closed_won')                          AS quarters_with_closes
     FROM deals
     WHERE workspace_id = $1
       AND deleted = false`,
    [workspaceId]
  );

  const row = result.rows[0] ?? { closed_deals: '0', days_of_data: '0', quarters_with_closes: '0' };
  const closedDeals = parseInt(row.closed_deals ?? '0', 10) || 0;
  const daysOfData = parseFloat(row.days_of_data ?? '0') || 0;
  const quartersWithCloses = parseInt(row.quarters_with_closes ?? '0', 10) || 0;

  let tier: 1 | 2 | 3;
  if (closedDeals < 20 || daysOfData < 90)  tier = 1;
  else if (closedDeals < 60 || daysOfData < 270) tier = 2;
  else tier = 3;

  return {
    tier,
    closed_deals: closedDeals,
    days_of_data: Math.round(daysOfData),
    quarters_with_closes: quartersWithCloses,
    benchmark_source: tier === 3 ? 'workspace' : 'proxy',
    layers_available: tier === 1 ? [2, 4] : [1, 2, 3, 4],
  };
}

// ─── EC-01: Whale Deal Signals ────────────────────────────────────────────────

export interface CIDealSignals {
  call_count: number;
  positive_sentiment_count: number;
  decision_maker_present: boolean;
  multi_threaded: boolean;
  next_step_committed: boolean;
}

export interface WhaleDealSignal {
  deal_id: string;
  deal_name: string;
  amount: number;
  pct_of_bookings: number;
  stage_30d_before_close: string;
  stage_at_close: string;
  stages_jumped: number;
  forecast_category_30d_prior: string;
  ci_signals_30d: CIDealSignals | null;
}

export async function harvestWhaleDealSignals(
  workspaceId: string,
  quarterStart: Date,
  quarterEnd: Date
): Promise<WhaleDealSignal[]> {
  // 1. Get total bookings for the quarter
  const bookingsRow = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND close_date BETWEEN $2 AND $3
       AND deleted = false`,
    [workspaceId, quarterStart.toISOString(), quarterEnd.toISOString()]
  );
  const totalBookings = parseFloat(bookingsRow.rows[0]?.total ?? '0') || 1; // avoid div/0

  // 2. Get top 5 closed-won deals by amount
  const dealsResult = await query<{
    id: string;
    deal_name: string;
    amount: string;
    close_date: string;
    stage_normalized: string;
    forecast_category: string | null;
  }>(
    `SELECT id, deal_name, amount, close_date, stage_normalized,
            forecast_category
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND close_date BETWEEN $2 AND $3
       AND deleted = false
     ORDER BY amount DESC
     LIMIT 5`,
    [workspaceId, quarterStart.toISOString(), quarterEnd.toISOString()]
  );

  if (dealsResult.rows.length === 0) return [];

  const signals: WhaleDealSignal[] = [];

  for (const deal of dealsResult.rows) {
    const amount = parseFloat(deal.amount ?? '0') || 0;
    const pctOfBookings = totalBookings > 0 ? amount / totalBookings : 0;
    const closeDate = new Date(deal.close_date);
    const priorDate = new Date(closeDate.getTime() - 30 * 86_400_000);

    // 3. Find stage 30 days before close via deal_stage_history
    const stageHistoryResult = await query<{
      stage_normalized: string | null;
      stage: string | null;
    }>(
      `SELECT COALESCE(stage_normalized, stage) AS stage_normalized, stage
       FROM deal_stage_history
       WHERE deal_id = $1
         AND entered_at <= $2
       ORDER BY entered_at DESC
       LIMIT 1`,
      [deal.id, priorDate.toISOString()]
    );

    const stage30dBefore = stageHistoryResult.rows[0]?.stage_normalized ?? 'unknown';

    // 4. Count stages jumped: stages entered between 30d mark and close
    const stagesJumpedResult = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT COALESCE(stage_normalized, stage)) AS count
       FROM deal_stage_history
       WHERE deal_id = $1
         AND entered_at > $2
         AND entered_at <= $3`,
      [deal.id, priorDate.toISOString(), closeDate.toISOString()]
    );
    const stagesJumped = Math.max(0, parseInt(stagesJumpedResult.rows[0]?.count ?? '0', 10) - 1);

    // 5. CI signals — attempt to extract from conversation_intelligence skill cache
    // This is best-effort: if no deal-level CI data, set to null
    let ciSignals: CIDealSignals | null = null;
    try {
      const ciResult = await query<{ output: any }>(
        `SELECT output
         FROM skill_runs
         WHERE workspace_id = $1
           AND skill_id = 'conversation-intelligence'
           AND status = 'completed'
           AND started_at >= NOW() - INTERVAL '45 days'
         ORDER BY started_at DESC
         LIMIT 1`,
        [workspaceId]
      );

      if (ciResult.rows[0]?.output) {
        const ciOutput = ciResult.rows[0].output;
        // Try to find deal-level signals in the CI output
        const dealSignals =
          ciOutput.deals?.[deal.id] ||
          ciOutput.deal_signals?.find((d: any) => d.deal_id === deal.id) ||
          ciOutput.deals?.find?.((d: any) => d.deal_id === deal.id);

        if (dealSignals) {
          ciSignals = {
            call_count: dealSignals.call_count ?? dealSignals.calls ?? 0,
            positive_sentiment_count: dealSignals.positive_sentiment_count ?? dealSignals.positive_calls ?? 0,
            decision_maker_present: dealSignals.decision_maker_present ?? dealSignals.exec_present ?? false,
            multi_threaded: dealSignals.multi_threaded ?? (dealSignals.contact_count > 1),
            next_step_committed: dealSignals.next_step_committed ?? dealSignals.next_step ?? false,
          };
        }
      }
    } catch {
      // CI extraction is best-effort — missing data is expected
    }

    signals.push({
      deal_id: deal.id,
      deal_name: deal.deal_name ?? 'Unknown Deal',
      amount,
      pct_of_bookings: pctOfBookings,
      stage_30d_before_close: stage30dBefore,
      stage_at_close: deal.stage_normalized ?? 'closed_won',
      stages_jumped: stagesJumped,
      forecast_category_30d_prior: deal.forecast_category ?? 'unknown',
      ci_signals_30d: ciSignals,
    });
  }

  return signals;
}

// ─── Diagnostic layer mapping ─────────────────────────────────────────────────

const SKILL_CONFIG: Record<string, {
  layers: number[];
  freshnessWindowDays: number;
}> = {
  'forecast-rollup':           { layers: [1],       freshnessWindowDays: 45 },
  'pipeline-coverage':         { layers: [1],       freshnessWindowDays: 45 },
  'pipeline-waterfall':        { layers: [1, 2],    freshnessWindowDays: 45 },
  'rep-scorecard':             { layers: [2, 3],    freshnessWindowDays: 45 },
  'icp-discovery':             { layers: [2],       freshnessWindowDays: 90 },
  'conversation-intelligence': { layers: [3],       freshnessWindowDays: 45 },
  'pipeline-hygiene':          { layers: [4],       freshnessWindowDays: 30 },
};

const HARVEST_SKILLS = Object.keys(SKILL_CONFIG);

// ─── Freshness logic ──────────────────────────────────────────────────────────

function assignFreshness(runAt: Date): 'fresh' | 'recent' | 'stale' {
  const ageDays = (Date.now() - runAt.getTime()) / 86_400_000;
  if (ageDays <= 7)  return 'fresh';
  if (ageDays <= 30) return 'recent';
  return 'stale';
}

// ─── Output parsing ───────────────────────────────────────────────────────────

function extractHeadlineAndSignals(
  skillId: string,
  output: any
): { headline: string; signals: string[]; quality: 1 | 2 | 3 } {
  if (!output || typeof output !== 'object') {
    return { headline: 'No data available', signals: [], quality: 3 };
  }

  const signals: string[] = [];
  let headline = '';
  let quality: 1 | 2 | 3 = 2;

  const cc = output.command_center || output.commandCenter;
  if (cc) {
    headline = cc.summary || cc.headline || cc.narrative || '';
    if (cc.findings?.length) {
      signals.push(...cc.findings.slice(0, 3).map((f: any) => f.message || f.claim_text || '').filter(Boolean));
    }
    if (cc.stats?.data_quality_tier) quality = cc.stats.data_quality_tier;
  }

  if (!headline) {
    headline = output.narrative || output.summary || output.headline || output.overview || '';
  }

  if (!signals.length && output.claims?.length) {
    signals.push(...output.claims.slice(0, 3).map((c: any) => c.claim_text || c.message || '').filter(Boolean));
  }

  if (!signals.length && output.findings?.length) {
    signals.push(...output.findings.slice(0, 3).map((f: any) => f.message || f.description || '').filter(Boolean));
  }

  if (!headline) {
    switch (skillId) {
      case 'forecast-rollup': {
        const amt = output.miss_amount ?? output.beat_amount;
        const pct = output.miss_pct ?? output.beat_pct;
        const dir = output.miss_amount != null ? 'Missed' : output.beat_amount != null ? 'Beat' : '';
        if (dir && amt != null) {
          headline = `${dir} by $${Math.abs(amt).toLocaleString()} (${Math.abs(pct ?? 0).toFixed(0)}%)`;
        } else {
          headline = output.label || 'Forecast rollup completed';
        }
        break;
      }
      case 'pipeline-coverage': {
        const ratio = output.coverage_ratio ?? output.coverageRatio;
        if (ratio != null) {
          headline = `Pipeline coverage ${ratio.toFixed(1)}x vs 3x target`;
        } else {
          headline = 'Pipeline coverage analyzed';
        }
        break;
      }
      case 'pipeline-waterfall': {
        headline = output.label || 'Pipeline waterfall computed';
        if (output.biggest_leak_stage) signals.push(`Biggest leakage: ${output.biggest_leak_stage}`);
        break;
      }
      case 'rep-scorecard':             headline = output.label || 'Rep scorecard generated'; break;
      case 'icp-discovery':             headline = output.label || 'ICP segment analysis completed'; break;
      case 'conversation-intelligence': headline = output.label || 'Conversation intelligence analyzed'; break;
      case 'pipeline-hygiene': {
        const stale = output.stale_deal_count ?? output.staleDealCount;
        if (stale != null) {
          headline = `${stale} stale deal(s) flagged`;
        } else {
          headline = 'Pipeline hygiene assessed';
        }
        break;
      }
    }
  }

  if (!headline) headline = `${skillId} run completed`;

  if (output.data_quality_tier) quality = output.data_quality_tier;
  else if (output.dataQualityTier) quality = output.dataQualityTier;

  return {
    headline: headline.slice(0, 200),
    signals: signals.filter(Boolean).slice(0, 3).map(s => String(s).slice(0, 150)),
    quality,
  };
}

// ─── Quarter inference ────────────────────────────────────────────────────────

export function inferCurrentQuarter(): QuarterWindow {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const q = Math.floor(month / 3) + 1;

  let prevQ = q - 1;
  let prevYear = year;
  if (prevQ < 1) {
    prevQ = 4;
    prevYear = year - 1;
  }

  const qStartMonth = (prevQ - 1) * 3;
  const start = new Date(prevYear, qStartMonth, 1);
  const end = new Date(prevYear, qStartMonth + 3, 0, 23, 59, 59);

  return { label: `Q${prevQ} ${prevYear}`, start, end };
}

// ─── Main harvest function ────────────────────────────────────────────────────

export async function harvestEvidence(
  workspaceId: string,
  _quarterStart?: Date,
  _quarterEnd?: Date
): Promise<HarvestedEvidence[]> {
  const result = await query<{
    skill_id: string;
    id: string;
    started_at: string;
    output: any;
  }>(
    `SELECT DISTINCT ON (skill_id)
       skill_id, id, started_at, output
     FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id = ANY($2)
       AND status = 'completed'
       AND started_at >= NOW() - INTERVAL '90 days'
     ORDER BY skill_id, started_at DESC`,
    [workspaceId, HARVEST_SKILLS]
  );

  const found = new Map<string, { id: string; started_at: string; output: any }>();
  for (const row of result.rows) {
    found.set(row.skill_id, { id: row.id, started_at: row.started_at, output: row.output });
  }

  const evidence: HarvestedEvidence[] = HARVEST_SKILLS.map((skillId) => {
    const config = SKILL_CONFIG[skillId];
    const row = found.get(skillId);

    if (!row) {
      return {
        skill_id: skillId,
        run_id: '',
        run_at: new Date(0),
        freshness: 'missing' as const,
        headline: `No recent ${skillId} run found`,
        signals: [],
        data_quality_tier: 3,
        diagnostic_layers: config.layers,
      };
    }

    const runAt = new Date(row.started_at);
    const ageDays = (Date.now() - runAt.getTime()) / 86_400_000;

    const freshness = ageDays > config.freshnessWindowDays
      ? 'missing' as const
      : assignFreshness(runAt);

    const { headline, signals, quality } = extractHeadlineAndSignals(skillId, row.output);

    return {
      skill_id: skillId,
      run_id: row.id,
      run_at: runAt,
      freshness,
      headline,
      signals,
      data_quality_tier: quality,
      diagnostic_layers: config.layers,
    };
  });

  return evidence;
}
