import { query, getClient } from '../db.js';

export interface ActivityCoverageAssessment {
  mode: 'full_rfm' | 'rm_only' | 'r_only';
  totalOpenDeals: number;
  dealsWithActivityLast30d: number;
  dealsWithActivityEver: number;
  coveragePercent: number;
  activitySources: string[];
  hasConversationData: boolean;
  caveats: string[];
}

export interface RFMScore {
  recencyDays: number;
  recencySource: 'activity' | 'conversation' | 'stage_change' | 'record_update';
  frequencyCount: number;
  frequencyWindow: number;
  monetaryValue: number;
  recencyQuintile: number;
  frequencyQuintile: number | null;
  monetaryQuintile: number;
  rfmSegment: string;
  rfmGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  rfmLabel: string;
  mode: 'full_rfm' | 'rm_only' | 'r_only';
  isReliable: boolean;
}

export interface RFMQuintileBreakpoints {
  recency: number[];
  frequency: number[] | null;
  monetary: number[];
  computedFrom: {
    dealCount: number;
    windowStart: Date;
    windowEnd: Date;
  };
}

export interface RFMWorkspaceMeta {
  workspaceId: string;
  computedAt: Date;
  mode: 'full_rfm' | 'rm_only' | 'r_only';
  breakpoints: RFMQuintileBreakpoints;
  coverage: ActivityCoverageAssessment;
  historicalWinRates: Record<string, { winRate: number; sampleSize: number; avgDealSize?: number }>;
  dealCount: number;
}

const DEFAULT_ENGAGEMENT_WEIGHTS = {
  meeting: 10,
  call: 5,
  email_sent: 2,
  email_received: 1,
  task: 1,
  note: 1,
};

const rfmMetaCache = new Map<string, { meta: RFMWorkspaceMeta; cachedAt: number }>();
const RFM_META_TTL_MS = 6 * 60 * 60 * 1000;

export async function ensureRFMColumns(): Promise<void> {
  const sql = `
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_recency_days NUMERIC;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_recency_quintile SMALLINT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_recency_source TEXT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_frequency_count NUMERIC;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_frequency_quintile SMALLINT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_monetary_quintile SMALLINT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_segment TEXT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_grade TEXT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_label TEXT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_mode TEXT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS rfm_scored_at TIMESTAMPTZ;
  `;
  await query(sql, []);
}

export async function assessActivityCoverage(workspaceId: string): Promise<ActivityCoverageAssessment> {
  const [totalRes, recentRes, everRes, typesRes, convoRes] = await Promise.all([
    query<{ total_open: string }>(
      `SELECT COUNT(*) AS total_open FROM deals
       WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
      [workspaceId]
    ),
    query<{ deals_with_recent: string }>(
      `SELECT COUNT(DISTINCT a.deal_id) AS deals_with_recent
       FROM activities a
       JOIN deals d ON a.deal_id = d.id AND d.workspace_id = a.workspace_id
       WHERE a.workspace_id = $1
         AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND a.timestamp > NOW() - INTERVAL '30 days'`,
      [workspaceId]
    ),
    query<{ deals_with_any: string }>(
      `SELECT COUNT(DISTINCT a.deal_id) AS deals_with_any
       FROM activities a
       JOIN deals d ON a.deal_id = d.id AND d.workspace_id = a.workspace_id
       WHERE a.workspace_id = $1
         AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')`,
      [workspaceId]
    ),
    query<{ type: string }>(
      `SELECT DISTINCT type FROM activities
       WHERE workspace_id = $1 AND timestamp > NOW() - INTERVAL '90 days' AND type IS NOT NULL`,
      [workspaceId]
    ),
    query<{ linked_conversations: string }>(
      `SELECT COUNT(*) AS linked_conversations FROM conversations
       WHERE workspace_id = $1 AND deal_id IS NOT NULL`,
      [workspaceId]
    ),
  ]);

  const totalOpenDeals = Number(totalRes.rows[0]?.total_open ?? 0);
  const dealsWithActivityLast30d = Number(recentRes.rows[0]?.deals_with_recent ?? 0);
  const dealsWithActivityEver = Number(everRes.rows[0]?.deals_with_any ?? 0);
  const coveragePercent = totalOpenDeals > 0 ? dealsWithActivityLast30d / totalOpenDeals : 0;
  const activitySources = typesRes.rows.map(r => r.type);
  const hasConversationData = Number(convoRes.rows[0]?.linked_conversations ?? 0) > 0;

  let mode: 'full_rfm' | 'rm_only' | 'r_only';
  if (coveragePercent >= 0.70) mode = 'full_rfm';
  else if (coveragePercent >= 0.30) mode = 'rm_only';
  else mode = 'r_only';

  const caveats: string[] = [];
  if (mode === 'r_only') {
    caveats.push(
      'Activity data covers less than 30% of open deals. ' +
      'Recency is based on CRM record changes, not actual engagement. ' +
      'Enable email/calendar sync or connect Gong/Fireflies for accurate behavioral scoring.'
    );
  }
  if (mode === 'rm_only') {
    caveats.push(
      `Activity data covers ${Math.round(coveragePercent * 100)}% of open deals. ` +
      'Frequency scores may undercount engagement for reps who don\'t log all touchpoints. ' +
      'Recency and Monetary scores are reliable.'
    );
  }
  if (!hasConversationData) {
    caveats.push(
      'No conversation intelligence data linked to deals. ' +
      'Calls and meetings from Gong/Fireflies would strengthen Frequency scoring.'
    );
  }
  if (!activitySources.includes('email')) {
    caveats.push('No email activity data detected. Email sync would improve Recency accuracy.');
  }

  return { mode, totalOpenDeals, dealsWithActivityLast30d, dealsWithActivityEver, coveragePercent, activitySources, hasConversationData, caveats };
}

type RawRFMValues = { recencyDays: number; recencySource: string; frequencyCount: number; monetaryValue: number };

export async function computeRawRFMValues(
  workspaceId: string,
  mode: 'full_rfm' | 'rm_only' | 'r_only',
  engagementWeights?: Record<string, number>
): Promise<Map<string, RawRFMValues>> {
  const weights = { ...DEFAULT_ENGAGEMENT_WEIGHTS, ...engagementWeights };

  const recencyResult = await query<{
    deal_id: string;
    amount: string | null;
    last_touch_date: string | null;
    recency_source: string;
  }>(
    `SELECT
      d.id AS deal_id,
      d.amount,
      COALESCE(
        latest_activity.last_date,
        latest_convo.last_date,
        latest_stage.last_date,
        d.last_activity_date,
        d.updated_at
      ) AS last_touch_date,
      CASE
        WHEN latest_activity.last_date IS NOT NULL THEN 'activity'
        WHEN latest_convo.last_date IS NOT NULL THEN 'conversation'
        WHEN latest_stage.last_date IS NOT NULL THEN 'stage_change'
        WHEN d.last_activity_date IS NOT NULL THEN 'activity'
        ELSE 'record_update'
      END AS recency_source
    FROM deals d
    LEFT JOIN LATERAL (
      SELECT MAX(a.timestamp) AS last_date
      FROM activities a
      WHERE a.deal_id = d.id AND a.timestamp IS NOT NULL
    ) latest_activity ON true
    LEFT JOIN LATERAL (
      SELECT MAX(c.call_date) AS last_date
      FROM conversations c
      WHERE c.deal_id = d.id AND c.call_date IS NOT NULL
    ) latest_convo ON true
    LEFT JOIN LATERAL (
      SELECT MAX(dsh.entered_at) AS last_date
      FROM deal_stage_history dsh
      WHERE dsh.deal_id = d.id
    ) latest_stage ON true
    WHERE d.workspace_id = $1
      AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
      AND d.created_at IS NOT NULL`,
    [workspaceId]
  );

  const rawMap = new Map<string, RawRFMValues>();
  for (const row of recencyResult.rows) {
    const lastTouch = row.last_touch_date ? new Date(row.last_touch_date) : new Date();
    const recencyDays = Math.max(0, (Date.now() - lastTouch.getTime()) / 86400000);
    rawMap.set(row.deal_id, {
      recencyDays,
      recencySource: row.recency_source,
      frequencyCount: 0,
      monetaryValue: Number(row.amount ?? 0),
    });
  }

  if (mode === 'full_rfm' || mode === 'rm_only') {
    const mw = weights.meeting;
    const cw = weights.call;
    const ew = weights.email_sent;

    const freqResult = await query<{ deal_id: string; weighted_count: string }>(
      `SELECT
        a.deal_id,
        SUM(
          CASE a.type
            WHEN 'meeting' THEN $2
            WHEN 'call' THEN $3
            WHEN 'email' THEN $4
            WHEN 'email_sent' THEN $4
            ELSE 1
          END
        ) AS weighted_count
      FROM activities a
      JOIN deals d ON a.deal_id = d.id AND d.workspace_id = a.workspace_id
      WHERE a.workspace_id = $1
        AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
        AND a.timestamp > NOW() - INTERVAL '30 days'
      GROUP BY a.deal_id`,
      [workspaceId, mw, cw, ew]
    );

    for (const row of freqResult.rows) {
      const existing = rawMap.get(row.deal_id);
      if (existing) {
        existing.frequencyCount += Number(row.weighted_count ?? 0);
      }
    }

    const convoFreqResult = await query<{ deal_id: string; weighted_count: string }>(
      `SELECT
        c.deal_id,
        COUNT(*) * $2 AS weighted_count
      FROM conversations c
      JOIN deals d ON c.deal_id = d.id AND d.workspace_id = c.workspace_id
      WHERE c.workspace_id = $1
        AND c.deal_id IS NOT NULL
        AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
        AND c.call_date > NOW() - INTERVAL '30 days'
      GROUP BY c.deal_id`,
      [workspaceId, mw]
    );

    for (const row of convoFreqResult.rows) {
      const existing = rawMap.get(row.deal_id);
      if (existing) {
        existing.frequencyCount += Number(row.weighted_count ?? 0);
      }
    }
  }

  return rawMap;
}

function computeQuintileBreakpoints(values: number[], dimension: 'recency' | 'frequency' | 'monetary'): number[] {
  if (values.length < 10) {
    return computeTercileBreakpoints(values);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return [
    sorted[Math.floor(n * 0.20)],
    sorted[Math.floor(n * 0.40)],
    sorted[Math.floor(n * 0.60)],
    sorted[Math.floor(n * 0.80)],
  ];
}

function computeTercileBreakpoints(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return [0, 0, 0, 0];
  return [
    sorted[Math.floor(n * 0.33)],
    sorted[Math.floor(n * 0.67)],
    sorted[Math.floor(n * 0.67)],
    sorted[n - 1],
  ];
}

function assignRecencyQuintile(recencyDays: number, breakpoints: number[]): number {
  if (recencyDays <= breakpoints[0]) return 5;
  if (recencyDays <= breakpoints[1]) return 4;
  if (recencyDays <= breakpoints[2]) return 3;
  if (recencyDays <= breakpoints[3]) return 2;
  return 1;
}

function assignQuintile(value: number, breakpoints: number[]): number {
  if (value <= breakpoints[0]) return 1;
  if (value <= breakpoints[1]) return 2;
  if (value <= breakpoints[2]) return 3;
  if (value <= breakpoints[3]) return 4;
  return 5;
}

function buildRFMSegment(r: number, f: number | null, m: number): string {
  if (f !== null) return `R${r}-F${f}-M${m}`;
  return `R${r}-M${m}`;
}

function assignRFMGrade(r: number, f: number | null, m: number, mode: string): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (mode === 'r_only') {
    if (r >= 4 && m >= 4) return 'A';
    if (r >= 3 && m >= 3) return 'B';
    if (r >= 2 && m >= 2) return 'C';
    if (r >= 2 || m >= 4) return 'D';
    return 'F';
  }
  const freq = f ?? 3;
  if (r >= 4 && freq >= 4 && m >= 4) return 'A';
  if (r >= 4 && freq >= 3 && m >= 5) return 'A';
  if (r >= 5 && freq >= 4 && m >= 3) return 'A';
  if (r >= 3 && freq >= 3 && m >= 3) return 'B';
  if (r >= 4 && m >= 4) return 'B';
  if (r >= 3 && m >= 3) return 'C';
  if (freq >= 4 && m >= 4) return 'C';
  if (r >= 2 || m >= 4) return 'D';
  return 'F';
}

function assignRFMLabel(r: number, f: number | null, m: number, mode: string): string {
  if (m >= 4 && r <= 2 && (f ?? 3) <= 2) return 'Big Deal at Risk';
  if (m >= 4 && r <= 2) return 'High Value, Going Cold';
  if (r >= 4 && (f ?? 3) >= 4 && m <= 2) return 'Active but Small';
  const grade = assignRFMGrade(r, f, m, mode);
  switch (grade) {
    case 'A': return 'Hot Opportunity';
    case 'B': return 'Healthy Pipeline';
    case 'C': return 'Needs Attention';
    case 'D': return 'Losing Momentum';
    default: return 'Likely Dead';
  }
}

export async function computeHistoricalWinRatesByRFM(
  workspaceId: string,
  breakpoints: RFMQuintileBreakpoints,
  mode: 'full_rfm' | 'rm_only' | 'r_only'
): Promise<Record<string, { winRate: number; sampleSize: number; avgDealSize: number }>> {
  const closedResult = await query<{
    deal_id: string;
    is_won: boolean;
    amount: string | null;
    recency_days: string | null;
    frequency_count: string | null;
  }>(
    `SELECT
      d.id AS deal_id,
      (d.stage_normalized = 'closed_won') AS is_won,
      d.amount,
      EXTRACT(EPOCH FROM (
        COALESCE(do_main.closed_at, NOW()) - INTERVAL '30 days' -
        COALESCE(
          (SELECT MAX(a.timestamp) FROM activities a
           WHERE a.deal_id = d.id AND a.timestamp < COALESCE(do_main.closed_at, NOW()) - INTERVAL '30 days'),
          d.created_at
        )
      )) / 86400 AS recency_days,
      COALESCE(
        (SELECT COUNT(*) FROM activities a
         WHERE a.deal_id = d.id
           AND a.timestamp BETWEEN COALESCE(do_main.closed_at, NOW()) - INTERVAL '60 days'
                               AND COALESCE(do_main.closed_at, NOW()) - INTERVAL '30 days'),
        0
      ) AS frequency_count
    FROM deals d
    LEFT JOIN deal_outcomes do_main ON do_main.deal_id = d.id AND do_main.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
      AND COALESCE(do_main.closed_at, d.updated_at) > NOW() - INTERVAL '24 months'`,
    [workspaceId]
  );

  const segmentBuckets = new Map<string, { won: number; total: number; totalAmount: number }>();
  const gradeBuckets = new Map<string, { won: number; total: number }>();

  for (const row of closedResult.rows) {
    const recencyDays = Number(row.recency_days ?? 30);
    const frequencyCount = Number(row.frequency_count ?? 0);
    const amount = Number(row.amount ?? 0);
    const isWon = row.is_won;

    const r = assignRecencyQuintile(Math.max(0, recencyDays), breakpoints.recency);
    const f = mode !== 'r_only' && breakpoints.frequency
      ? assignQuintile(frequencyCount, breakpoints.frequency)
      : null;
    const m = amount > 0 ? assignQuintile(amount, breakpoints.monetary) : 1;

    const segment = buildRFMSegment(r, f, m);
    const grade = assignRFMGrade(r, f, m, mode);

    const segBucket = segmentBuckets.get(segment) ?? { won: 0, total: 0, totalAmount: 0 };
    segBucket.total++;
    if (isWon) { segBucket.won++; segBucket.totalAmount += amount; }
    segmentBuckets.set(segment, segBucket);

    const gradeBucket = gradeBuckets.get(grade) ?? { won: 0, total: 0 };
    gradeBucket.total++;
    if (isWon) gradeBucket.won++;
    gradeBuckets.set(grade, gradeBucket);
  }

  const result: Record<string, { winRate: number; sampleSize: number; avgDealSize: number }> = {};

  for (const [seg, bucket] of segmentBuckets) {
    result[seg] = {
      winRate: bucket.total > 0 ? bucket.won / bucket.total : 0,
      sampleSize: bucket.total,
      avgDealSize: bucket.won > 0 ? bucket.totalAmount / bucket.won : 0,
    };
  }

  for (const [grade, bucket] of gradeBuckets) {
    result[grade] = {
      winRate: bucket.total > 0 ? bucket.won / bucket.total : 0,
      sampleSize: bucket.total,
      avgDealSize: 0,
    };
  }

  return result;
}

function testRFMDiscrimination(
  historicalWinRates: Record<string, { winRate: number }>
): { isDiscriminating: boolean; spread: number; warning: string | null } {
  const gradeRates = ['A', 'B', 'C', 'D', 'F']
    .map(g => historicalWinRates[g]?.winRate ?? null)
    .filter((r): r is number => r !== null);

  if (gradeRates.length < 2) {
    return { isDiscriminating: false, spread: 0, warning: 'Not enough grade data to assess discrimination.' };
  }

  const spread = Math.max(...gradeRates) - Math.min(...gradeRates);
  const aRate = historicalWinRates['A']?.winRate ?? 0;
  const fRate = historicalWinRates['F']?.winRate ?? 0.01;
  const lift = aRate / Math.max(fRate, 0.001);

  if (spread < 0.15 || lift < 1.5) {
    return {
      isDiscriminating: false,
      spread,
      warning: 'RFM grades do not strongly predict win/loss outcomes for this workspace. ' +
        'Scores are still useful for relative prioritization but should not be treated as predictive.',
    };
  }

  return { isDiscriminating: true, spread, warning: null };
}

async function batchUpdateRFMScores(workspaceId: string, scores: Map<string, RFMScore>): Promise<void> {
  if (scores.size === 0) return;

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const rows = [...scores.entries()];
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      for (const [dealId, s] of chunk) {
        await client.query(
          `UPDATE deals SET
            rfm_recency_days = $1,
            rfm_recency_quintile = $2,
            rfm_recency_source = $3,
            rfm_frequency_count = $4,
            rfm_frequency_quintile = $5,
            rfm_monetary_quintile = $6,
            rfm_segment = $7,
            rfm_grade = $8,
            rfm_label = $9,
            rfm_mode = $10,
            rfm_scored_at = NOW()
          WHERE id = $11 AND workspace_id = $12`,
          [
            s.recencyDays, s.recencyQuintile, s.recencySource,
            s.frequencyCount, s.frequencyQuintile, s.monetaryQuintile,
            s.rfmSegment, s.rfmGrade, s.rfmLabel, s.mode,
            dealId, workspaceId,
          ]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function computeAndStoreRFMScores(workspaceId: string): Promise<{
  scored: number;
  mode: 'full_rfm' | 'rm_only' | 'r_only';
  coverage: ActivityCoverageAssessment;
  meta: RFMWorkspaceMeta;
}> {
  await ensureRFMColumns();

  const coverage = await assessActivityCoverage(workspaceId);
  const { mode } = coverage;

  const rawValues = await computeRawRFMValues(workspaceId, mode);

  if (rawValues.size === 0) {
    const emptyMeta: RFMWorkspaceMeta = {
      workspaceId,
      computedAt: new Date(),
      mode,
      breakpoints: { recency: [7, 14, 30, 60], frequency: null, monetary: [0, 0, 0, 0], computedFrom: { dealCount: 0, windowStart: new Date(), windowEnd: new Date() } },
      coverage,
      historicalWinRates: {},
      dealCount: 0,
    };
    return { scored: 0, mode, coverage, meta: emptyMeta };
  }

  const recencyValues = [...rawValues.values()].map(v => v.recencyDays);
  const frequencyValues = mode !== 'r_only' ? [...rawValues.values()].map(v => v.frequencyCount) : null;
  const monetaryValues = [...rawValues.values()].filter(v => v.monetaryValue > 0).map(v => v.monetaryValue);

  const windowStart = new Date();
  windowStart.setMonth(windowStart.getMonth() - 24);

  const breakpoints: RFMQuintileBreakpoints = {
    recency: computeQuintileBreakpoints(recencyValues, 'recency'),
    frequency: frequencyValues ? computeQuintileBreakpoints(frequencyValues, 'frequency') : null,
    monetary: monetaryValues.length > 0 ? computeQuintileBreakpoints(monetaryValues, 'monetary') : [0, 0, 0, 0],
    computedFrom: { dealCount: rawValues.size, windowStart, windowEnd: new Date() },
  };

  const scores = new Map<string, RFMScore>();
  for (const [dealId, raw] of rawValues) {
    const r = assignRecencyQuintile(raw.recencyDays, breakpoints.recency);
    const f = mode !== 'r_only' && breakpoints.frequency !== null
      ? assignQuintile(raw.frequencyCount, breakpoints.frequency)
      : null;
    const m = raw.monetaryValue > 0 ? assignQuintile(raw.monetaryValue, breakpoints.monetary) : 1;

    scores.set(dealId, {
      recencyDays: raw.recencyDays,
      recencySource: raw.recencySource as RFMScore['recencySource'],
      frequencyCount: raw.frequencyCount,
      frequencyWindow: 30,
      monetaryValue: raw.monetaryValue,
      recencyQuintile: r,
      frequencyQuintile: f,
      monetaryQuintile: m,
      rfmSegment: buildRFMSegment(r, f, m),
      rfmGrade: assignRFMGrade(r, f, m, mode),
      rfmLabel: assignRFMLabel(r, f, m, mode),
      mode,
      isReliable: raw.recencySource !== 'record_update',
    });
  }

  await batchUpdateRFMScores(workspaceId, scores);

  const closedCountResult = await query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM deals
     WHERE workspace_id = $1 AND stage_normalized IN ('closed_won', 'closed_lost')
       AND updated_at > NOW() - INTERVAL '24 months'`,
    [workspaceId]
  );
  const closedCount = Number(closedCountResult.rows[0]?.cnt ?? 0);

  let historicalWinRates: Record<string, { winRate: number; sampleSize: number; avgDealSize: number }> = {};
  if (closedCount >= 50) {
    historicalWinRates = await computeHistoricalWinRatesByRFM(workspaceId, breakpoints, mode);
    const discrimination = testRFMDiscrimination(historicalWinRates);
    if (!discrimination.isDiscriminating && discrimination.warning) {
      console.warn(`[RFM] ${workspaceId}: ${discrimination.warning}`);
    }
  }

  const meta: RFMWorkspaceMeta = {
    workspaceId,
    computedAt: new Date(),
    mode,
    breakpoints,
    coverage,
    historicalWinRates,
    dealCount: rawValues.size,
  };

  rfmMetaCache.set(workspaceId, { meta, cachedAt: Date.now() });

  console.log(`[RFM] Scored ${scores.size} deals for ${workspaceId} in ${mode} mode (${Math.round(coverage.coveragePercent * 100)}% activity coverage)`);

  return { scored: scores.size, mode, coverage, meta };
}

export async function getRFMWorkspaceMeta(workspaceId: string): Promise<RFMWorkspaceMeta | null> {
  const cached = rfmMetaCache.get(workspaceId);
  if (cached && Date.now() - cached.cachedAt < RFM_META_TTL_MS) {
    return cached.meta;
  }
  return null;
}

export function renderRFMScoreCard(
  deal: {
    name: string;
    rfm_grade: string;
    rfm_label: string;
    rfm_recency_days: number;
    rfm_recency_quintile: number;
    rfm_frequency_count: number;
    rfm_frequency_quintile: number | null;
    rfm_monetary_quintile: number;
    amount: number;
  }
): string {
  const lines: string[] = [];
  lines.push(`*${deal.name}* — Priority: ${deal.rfm_grade} (${deal.rfm_label})`);

  const recencyEmoji = deal.rfm_recency_quintile >= 4 ? '✅' : deal.rfm_recency_quintile >= 2 ? '⚠️' : '🔴';
  const days = Math.round(deal.rfm_recency_days);
  const recencyContext = days <= 1 ? 'today' : `${days} days ago`;
  lines.push(`  ${recencyEmoji} Recency: Last touch ${recencyContext}`);

  if (deal.rfm_frequency_quintile !== null) {
    const freqEmoji = deal.rfm_frequency_quintile >= 4 ? '✅' : deal.rfm_frequency_quintile >= 2 ? '⚠️' : '🔴';
    lines.push(`  ${freqEmoji} Activity: ${Math.round(deal.rfm_frequency_count)} touchpoints in last 30d`);
  }

  const moneyEmoji = deal.rfm_monetary_quintile >= 4 ? '💰' : deal.rfm_monetary_quintile >= 2 ? '💵' : '📉';
  const kVal = (deal.amount / 1000).toFixed(0);
  lines.push(`  ${moneyEmoji} Value: $${kVal}K`);

  return lines.join('\n');
}

export function renderRFMComparison(
  dealGrade: string,
  historicalWinRates: Record<string, { winRate: number; sampleSize: number }>,
  isDiscriminating: boolean
): string {
  const lines: string[] = [];

  if (!isDiscriminating) {
    lines.push('_RFM scores are useful for prioritization but have limited predictive power for this workspace._');
    return lines.join('\n');
  }

  const gradeStats = historicalWinRates[dealGrade];
  if (gradeStats && gradeStats.sampleSize >= 5) {
    lines.push(`Deals graded ${dealGrade} in your pipeline historically close at ${Math.round(gradeStats.winRate * 100)}% (based on ${gradeStats.sampleSize} deals).`);
  }

  if (dealGrade === 'D' || dealGrade === 'F') {
    const aRate = historicalWinRates['A']?.winRate ?? 0;
    if (aRate > 0) {
      lines.push(`For comparison, your A-grade deals close at ${Math.round(aRate * 100)}%.`);
    }
  }

  return lines.join('\n');
}

export function renderRFMMethodology(meta: RFMWorkspaceMeta): string {
  const lines: string[] = [];
  lines.push(`## Your RFM Model`);
  lines.push(`Auto-calibrated from ${meta.dealCount} open deals. Mode: ${meta.mode}.`);
  lines.push('');

  const bp = meta.breakpoints;
  lines.push(`### Recency (days since last activity)`);
  lines.push(`  R5 (best):  0–${bp.recency[0]?.toFixed(0)} days`);
  lines.push(`  R4:         ${(bp.recency[0] + 1)?.toFixed(0)}–${bp.recency[1]?.toFixed(0)} days`);
  lines.push(`  R3:         ${(bp.recency[1] + 1)?.toFixed(0)}–${bp.recency[2]?.toFixed(0)} days`);
  lines.push(`  R2:         ${(bp.recency[2] + 1)?.toFixed(0)}–${bp.recency[3]?.toFixed(0)} days`);
  lines.push(`  R1 (worst): ${(bp.recency[3] + 1)?.toFixed(0)}+ days`);
  lines.push('');

  if (Object.keys(meta.historicalWinRates).length > 0) {
    lines.push(`### Historical Win Rates by Grade`);
    for (const grade of ['A', 'B', 'C', 'D', 'F']) {
      const stats = meta.historicalWinRates[grade];
      if (stats && stats.sampleSize >= 5) {
        lines.push(`  ${grade}: ${Math.round(stats.winRate * 100)}% (${stats.sampleSize} deals)`);
      }
    }
  }

  if (meta.coverage.caveats.length > 0) {
    lines.push('');
    lines.push(`### Data Quality Notes`);
    for (const caveat of meta.coverage.caveats) {
      lines.push(`  ⚠ ${caveat}`);
    }
  }

  return lines.join('\n');
}

export function buildRFMContextForLLM(
  deals: Array<{ rfm_grade: string | null; rfm_label: string | null; amount: number; forecast_category: string | null; name: string }>,
  meta: RFMWorkspaceMeta | null
): string {
  if (!deals.length) return '';

  const byGrade = { A: 0, B: 0, C: 0, D: 0, F: 0 } as Record<string, number>;
  const valueByGrade = { A: 0, B: 0, C: 0, D: 0, F: 0 } as Record<string, number>;
  const coldHighValue: string[] = [];

  for (const deal of deals) {
    const g = deal.rfm_grade ?? 'C';
    byGrade[g] = (byGrade[g] ?? 0) + 1;
    valueByGrade[g] = (valueByGrade[g] ?? 0) + deal.amount;
    if ((deal.rfm_grade === 'D' || deal.rfm_grade === 'F') && deal.amount > 50000) {
      coldHighValue.push(`${deal.name} ($${(deal.amount / 1000).toFixed(0)}K, ${deal.rfm_label})`);
    }
  }

  const fmt = (n: number) => `$${(n / 1000).toFixed(0)}K`;
  const lines: string[] = [];
  lines.push('BEHAVIORAL QUALITY OF PIPELINE (RFM):');

  for (const grade of ['A', 'B', 'C', 'D', 'F']) {
    if (byGrade[grade]) {
      const winRateStr = meta?.historicalWinRates[grade]
        ? ` [hist. ${Math.round(meta.historicalWinRates[grade].winRate * 100)}% win rate]`
        : '';
      lines.push(`  ${grade}: ${byGrade[grade]} deals (${fmt(valueByGrade[grade] ?? 0)})${winRateStr}`);
    }
  }

  const coldTotal = (byGrade['D'] ?? 0) + (byGrade['F'] ?? 0);
  const coldValue = (valueByGrade['D'] ?? 0) + (valueByGrade['F'] ?? 0);
  if (coldTotal > 0) {
    lines.push(`  ⚠ ${coldTotal} deals (${fmt(coldValue)}) are behaviorally cold (D/F grade) — may not close on schedule`);
  }

  if (coldHighValue.length > 0) {
    lines.push(`  High-value deals going cold: ${coldHighValue.slice(0, 3).join(', ')}`);
  }

  if (meta?.coverage.caveats.length) {
    lines.push(`  Note: ${meta.coverage.caveats[0]}`);
  }

  return lines.join('\n');
}
