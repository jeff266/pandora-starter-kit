/**
 * TTE Survival Data Layer
 *
 * Fetches deal observations from the DB and builds Kaplan-Meier survival curves.
 * Handles segmentation, size band classification, lead source normalization,
 * and in-memory caching with 6-hour TTL.
 */

import { query } from '../db.js';
import {
  DealObservation,
  SurvivalCurve,
  computeKaplanMeier,
  emptyCurve,
} from './survival-curve.js';

export type SurvivalSegment =
  | 'source'
  | 'owner'
  | 'size_band'
  | 'stage_reached'
  | 'pipeline'
  | 'none';

export interface SurvivalQueryOptions {
  workspaceId: string;
  lookbackMonths?: number;
  groupBy?: SurvivalSegment;
  filters?: {
    source?: string;
    ownerEmail?: string;
    minAmount?: number;
    maxAmount?: number;
    stage?: string;
    pipeline?: string;
  };
  minSegmentSize?: number;
}

interface RawDealRow {
  deal_id: string;
  days_open: string;
  is_won: boolean | string;
  amount: string | null;
  owner: string | null;
  lead_source: string | null;
  pipeline_name: string | null;
  highest_stage: string | null;
}

interface CacheEntry {
  result: BuildSurvivalCurvesResult;
  cachedAt: Date;
}

interface BuildSurvivalCurvesResult {
  overall: SurvivalCurve;
  segments: Map<string, SurvivalCurve>;
  metadata: {
    totalDeals: number;
    segmentsComputed: number;
    segmentsBelowThreshold: string[];
    lookbackWindow: { from: Date; to: Date };
  };
}

const survivalCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheKey(options: SurvivalQueryOptions): string {
  const filterHash = JSON.stringify(options.filters ?? {});
  return `survival:${options.workspaceId}:${options.groupBy ?? 'none'}:${filterHash}`;
}

function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.cachedAt.getTime() < CACHE_TTL_MS;
}

export function invalidateSurvivalCache(workspaceId: string): void {
  for (const key of survivalCache.keys()) {
    if (key.startsWith(`survival:${workspaceId}:`)) {
      survivalCache.delete(key);
    }
  }
}

export function normalizeLeadSource(rawSource: string | null): string {
  if (!rawSource) return 'Unknown';
  const lower = rawSource.toLowerCase().trim();
  if (['organic', 'website', 'inbound', 'content', 'seo', 'blog', 'webinar', 'event', 'marketing'].some(k => lower.includes(k))) {
    return 'Inbound';
  }
  if (['outbound', 'cold', 'prospecting', 'sdr', 'bdr', 'sales generated', 'sales sourced'].some(k => lower.includes(k))) {
    return 'Outbound';
  }
  if (['product', 'plg', 'self-serve', 'freemium', 'trial', 'signup', 'free'].some(k => lower.includes(k))) {
    return 'PLG';
  }
  if (['partner', 'referral', 'channel', 'reseller', 'alliance'].some(k => lower.includes(k))) {
    return 'Partner';
  }
  return 'Other';
}

export function classifyDealSizeBand(amount: number, distribution: { p25: number; p75: number }): string {
  if (amount <= distribution.p25) return 'Small';
  if (amount <= distribution.p75) return 'Mid-Market';
  return 'Enterprise';
}

export async function fetchDealObservations(
  options: SurvivalQueryOptions
): Promise<DealObservation[]> {
  const lookbackMonths = options.lookbackMonths ?? 24;
  const filters = options.filters ?? {};

  const params: (string | number)[] = [options.workspaceId, lookbackMonths];
  const whereClauses: string[] = [];

  if (filters.source) {
    params.push(filters.source);
    whereClauses.push(`LOWER(COALESCE(d.lead_source, d.source_data->>'original_source')) LIKE LOWER($${params.length})`);
  }
  if (filters.ownerEmail) {
    params.push(filters.ownerEmail);
    whereClauses.push(`d.owner = $${params.length}`);
  }
  if (filters.minAmount !== undefined) {
    params.push(filters.minAmount);
    whereClauses.push(`d.amount >= $${params.length}`);
  }
  if (filters.maxAmount !== undefined) {
    params.push(filters.maxAmount);
    whereClauses.push(`d.amount <= $${params.length}`);
  }
  if (filters.pipeline) {
    params.push(filters.pipeline);
    whereClauses.push(`d.pipeline = $${params.length}`);
  }

  const extraWhere = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

  let stageJoin = '';
  if (filters.stage) {
    params.push(filters.stage);
    stageJoin = `
      JOIN (
        SELECT DISTINCT deal_id FROM deal_stage_history
        WHERE workspace_id = $1 AND to_stage_normalized = $${params.length}
      ) dsh_filter ON dsh_filter.deal_id = d.id
    `;
  }

  const sql = `
    SELECT
      d.id AS deal_id,
      EXTRACT(EPOCH FROM (
        COALESCE(do2.closed_at, NOW()) - d.created_at
      )) / 86400.0 AS days_open,
      (d.stage_normalized = 'closed_won') AS is_won,
      d.amount,
      d.owner,
      COALESCE(d.lead_source, d.source_data->>'original_source') AS lead_source,
      d.pipeline AS pipeline_name,
      (
        SELECT dsh.to_stage_normalized
        FROM deal_stage_history dsh
        WHERE dsh.deal_id = d.id AND dsh.workspace_id = d.workspace_id
        ORDER BY dsh.changed_at DESC
        LIMIT 1
      ) AS highest_stage
    FROM deals d
    LEFT JOIN deal_outcomes do2
      ON do2.deal_id = d.id AND do2.workspace_id = d.workspace_id
    ${stageJoin}
    WHERE d.workspace_id = $1
      AND d.created_at > NOW() - INTERVAL '1 month' * $2
      AND d.created_at IS NOT NULL
      AND d.created_at < NOW()
      AND d.amount IS NOT NULL
      AND d.amount > 0
      ${extraWhere}
    ORDER BY days_open ASC
  `;

  const result = await query<RawDealRow>(sql, params);

  return result.rows.map(row => ({
    dealId: row.deal_id,
    daysOpen: Math.max(0, parseFloat(row.days_open as string) || 0),
    event: row.is_won === true || row.is_won === 't' || row.is_won === 'true',
    amount: row.amount ? parseFloat(row.amount) : undefined,
    segment: undefined,
  }));
}

function groupObservations(
  observations: DealObservation[],
  rows: RawDealRow[],
  groupBy: SurvivalSegment,
  sizeDist?: { p25: number; p75: number }
): Map<string, DealObservation[]> {
  const map = new Map<string, DealObservation[]>();

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    const row = rows[i];
    let segmentKey: string;

    switch (groupBy) {
      case 'source':
        segmentKey = normalizeLeadSource(row.lead_source);
        break;
      case 'owner':
        segmentKey = row.owner || 'Unassigned';
        break;
      case 'size_band':
        segmentKey = sizeDist && obs.amount
          ? classifyDealSizeBand(obs.amount, sizeDist)
          : 'Unknown';
        break;
      case 'stage_reached':
        segmentKey = row.highest_stage || 'unknown';
        break;
      case 'pipeline':
        segmentKey = row.pipeline_name || 'Default';
        break;
      default:
        segmentKey = 'all';
    }

    if (!map.has(segmentKey)) map.set(segmentKey, []);
    map.get(segmentKey)!.push({ ...obs, segment: segmentKey });
  }

  return map;
}

async function computeSizeDist(workspaceId: string, lookbackMonths: number): Promise<{ p25: number; p75: number }> {
  const result = await query<{ p25: string; p75: string }>(
    `SELECT
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount) AS p25,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount) AS p75
    FROM deals
    WHERE workspace_id = $1
      AND stage_normalized = 'closed_won'
      AND created_at > NOW() - INTERVAL '1 month' * $2
      AND amount > 0`,
    [workspaceId, lookbackMonths]
  );
  return {
    p25: parseFloat(result.rows[0]?.p25 || '10000'),
    p75: parseFloat(result.rows[0]?.p75 || '100000'),
  };
}

export async function buildSurvivalCurves(
  options: SurvivalQueryOptions
): Promise<BuildSurvivalCurvesResult> {
  const key = cacheKey(options);
  const cached = survivalCache.get(key);
  if (cached && isCacheValid(cached)) {
    return cached.result;
  }

  const lookbackMonths = options.lookbackMonths ?? 24;
  const minSegmentSize = options.minSegmentSize ?? 30;
  const groupBy = options.groupBy ?? 'none';

  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - lookbackMonths);

  const observations = await fetchDealObservations(options);

  const overall = computeKaplanMeier(observations);
  overall.dataWindow = { from: fromDate, to: new Date() };

  const segments = new Map<string, SurvivalCurve>();
  const segmentsBelowThreshold: string[] = [];

  if (groupBy !== 'none') {
    let sizeDist: { p25: number; p75: number } | undefined;
    if (groupBy === 'size_band') {
      sizeDist = await computeSizeDist(options.workspaceId, lookbackMonths);
    }

    const params: (string | number)[] = [options.workspaceId, lookbackMonths];
    const lookupSql = `
      SELECT
        d.id AS deal_id,
        d.owner,
        COALESCE(d.lead_source, d.source_data->>'original_source') AS lead_source,
        d.pipeline AS pipeline_name,
        (
          SELECT dsh.to_stage_normalized
          FROM deal_stage_history dsh
          WHERE dsh.deal_id = d.id AND dsh.workspace_id = d.workspace_id
          ORDER BY dsh.changed_at DESC
          LIMIT 1
        ) AS highest_stage
      FROM deals d
      WHERE d.workspace_id = $1
        AND d.created_at > NOW() - INTERVAL '1 month' * $2
        AND d.created_at IS NOT NULL
        AND d.created_at < NOW()
        AND d.amount IS NOT NULL
        AND d.amount > 0
      ORDER BY d.created_at ASC
    `;
    const rowsResult = await query<RawDealRow>(lookupSql, params);
    const rows = rowsResult.rows;

    const grouped = groupObservations(observations, rows, groupBy, sizeDist);
    const otherObs: DealObservation[] = [];

    for (const [segmentName, segmentObs] of grouped) {
      if (segmentObs.length >= minSegmentSize) {
        const curve = computeKaplanMeier(segmentObs, segmentName);
        curve.dataWindow = { from: fromDate, to: new Date() };
        segments.set(segmentName, curve);
      } else {
        segmentsBelowThreshold.push(segmentName);
        otherObs.push(...segmentObs);
      }
    }

    if (otherObs.length >= minSegmentSize) {
      const otherCurve = computeKaplanMeier(otherObs, 'Other');
      otherCurve.dataWindow = { from: fromDate, to: new Date() };
      segments.set('Other', otherCurve);
    }
  }

  const result: BuildSurvivalCurvesResult = {
    overall,
    segments,
    metadata: {
      totalDeals: observations.length,
      segmentsComputed: segments.size,
      segmentsBelowThreshold,
      lookbackWindow: { from: fromDate, to: new Date() },
    },
  };

  survivalCache.set(key, { result, cachedAt: new Date() });
  return result;
}

export async function prewarmSurvivalCache(workspaceId: string): Promise<void> {
  const segmentations: SurvivalSegment[] = ['none', 'stage_reached', 'owner', 'source'];
  await Promise.allSettled(
    segmentations.map(groupBy =>
      buildSurvivalCurves({ workspaceId, lookbackMonths: 24, groupBy })
    )
  );
}
