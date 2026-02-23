/**
 * Workspace Context Tool
 *
 * Assembles company-specific context for advisory responses.
 * Pure SQL queries - no LLM calls. 15-minute cache.
 */

import { query } from '../db.js';

export interface WorkspaceContext {
  workspace_name: string | null;
  gtm_motion: string | null;
  segment: string | null;
  industry: string | null;
  acv_range: string | null;
  avg_deal_size: number | null;
  avg_sales_cycle_days: number | null;
  win_rate: number | null;
  open_deals_count: number | null;
  deals_analyzed: number | null;
  top_industries: string[] | null;
  top_personas: string[] | null;
  top_competitors: string[] | null;
  top_objections: string[] | null;
  has_conversation_signals: boolean;
  has_icp_profile: boolean;
}

// 15-minute in-memory cache
interface CacheEntry {
  context: WorkspaceContext;
  cachedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const contextCache = new Map<string, CacheEntry>();

export async function getWorkspaceContext(workspaceId: string): Promise<WorkspaceContext | null> {
  // Check cache
  const cached = contextCache.get(workspaceId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.context;
  }

  try {
    const [meta, config, dealMetrics, icpProfile, signals] = await Promise.all([
      loadWorkspaceMeta(workspaceId),
      loadWorkspaceConfig(workspaceId),
      computeDealMetrics(workspaceId),
      loadICPProfile(workspaceId),
      loadTopSignals(workspaceId),
    ]);

    const context: WorkspaceContext = {
      workspace_name: meta.name,
      gtm_motion: config.gtm_motion,
      segment: config.segment,
      industry: config.industry,
      acv_range: dealMetrics.acv_range,
      avg_deal_size: dealMetrics.avg_deal_size,
      avg_sales_cycle_days: dealMetrics.avg_sales_cycle_days,
      win_rate: dealMetrics.win_rate,
      open_deals_count: dealMetrics.open_deals_count,
      deals_analyzed: dealMetrics.deals_analyzed,
      top_industries: icpProfile.top_industries,
      top_personas: icpProfile.top_personas,
      top_competitors: signals.top_competitors,
      top_objections: signals.top_objections,
      has_conversation_signals: signals.has_signals,
      has_icp_profile: icpProfile.has_profile,
    };

    // Cache for 15 minutes
    contextCache.set(workspaceId, {
      context,
      cachedAt: Date.now(),
    });

    return context;
  } catch (err) {
    console.error('[WorkspaceContext] Failed to load context:', err);
    return null;
  }
}

// ============================================================================
// Query 1: Workspace Meta
// ============================================================================

async function loadWorkspaceMeta(workspaceId: string): Promise<{ name: string | null }> {
  try {
    const result = await query<{ name: string }>(
      `SELECT name FROM workspaces WHERE id = $1`,
      [workspaceId]
    );
    return { name: result.rows[0]?.name || null };
  } catch (err) {
    return { name: null };
  }
}

// ============================================================================
// Query 2: Workspace Config
// ============================================================================

async function loadWorkspaceConfig(workspaceId: string): Promise<{
  gtm_motion: string | null;
  segment: string | null;
  industry: string | null;
}> {
  try {
    const { getConfig } = await import('../config/configLoader.js');
    const config = await getConfig(workspaceId);

    return {
      gtm_motion: config?.business_model?.gtm_motion || null,
      segment: config?.business_model?.segment || null,
      industry: config?.business_model?.industry || null,
    };
  } catch (err) {
    return { gtm_motion: null, segment: null, industry: null };
  }
}

// ============================================================================
// Query 3: Deal Metrics
// ============================================================================

async function computeDealMetrics(workspaceId: string): Promise<{
  acv_range: string | null;
  avg_deal_size: number | null;
  avg_sales_cycle_days: number | null;
  win_rate: number | null;
  open_deals_count: number | null;
  deals_analyzed: number | null;
}> {
  try {
    const result = await query<{
      p25_amount: string | null;
      p75_amount: string | null;
      avg_deal_size: string | null;
      avg_sales_cycle_days: string | null;
      won_count: string;
      lost_count: string;
      open_count: string;
      total_count: string;
    }>(
      `SELECT
         PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount) as p25_amount,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount) as p75_amount,
         AVG(amount) as avg_deal_size,
         AVG(EXTRACT(EPOCH FROM (COALESCE(close_date, NOW()) - created_date)) / 86400) as avg_sales_cycle_days,
         COUNT(*) FILTER (WHERE stage_normalized = 'closed_won') as won_count,
         COUNT(*) FILTER (WHERE stage_normalized = 'closed_lost') as lost_count,
         COUNT(*) FILTER (WHERE stage_normalized NOT IN ('closed_won', 'closed_lost')) as open_count,
         COUNT(*) as total_count
       FROM deals
       WHERE workspace_id = $1
         AND created_date IS NOT NULL
         AND amount > 0`,
      [workspaceId]
    );

    const row = result.rows[0];
    if (!row) {
      return {
        acv_range: null,
        avg_deal_size: null,
        avg_sales_cycle_days: null,
        win_rate: null,
        open_deals_count: null,
        deals_analyzed: null,
      };
    }

    const p25 = row.p25_amount ? parseFloat(row.p25_amount) : null;
    const p75 = row.p75_amount ? parseFloat(row.p75_amount) : null;
    const avgDealSize = row.avg_deal_size ? parseFloat(row.avg_deal_size) : null;
    const avgCycle = row.avg_sales_cycle_days ? parseFloat(row.avg_sales_cycle_days) : null;
    const wonCount = parseInt(row.won_count, 10);
    const lostCount = parseInt(row.lost_count, 10);
    const openCount = parseInt(row.open_count, 10);
    const totalCount = parseInt(row.total_count, 10);

    const winRate = (wonCount + lostCount > 0)
      ? wonCount / (wonCount + lostCount)
      : null;

    let acvRange: string | null = null;
    if (p25 && p75) {
      const formatAmount = (n: number) => {
        if (n < 1000) return `$${Math.round(n)}`;
        if (n < 1_000_000) return `$${Math.round(n / 1000)}K`;
        return `$${(n / 1_000_000).toFixed(1)}M`;
      };
      acvRange = `${formatAmount(p25)} - ${formatAmount(p75)}`;
    }

    return {
      acv_range: acvRange,
      avg_deal_size: avgDealSize,
      avg_sales_cycle_days: avgCycle,
      win_rate: winRate,
      open_deals_count: openCount,
      deals_analyzed: totalCount,
    };
  } catch (err) {
    console.error('[WorkspaceContext] computeDealMetrics failed:', err);
    return {
      acv_range: null,
      avg_deal_size: null,
      avg_sales_cycle_days: null,
      win_rate: null,
      open_deals_count: null,
      deals_analyzed: null,
    };
  }
}

// ============================================================================
// Query 4: ICP Profile
// ============================================================================

async function loadICPProfile(workspaceId: string): Promise<{
  top_industries: string[] | null;
  top_personas: string[] | null;
  has_profile: boolean;
}> {
  try {
    const result = await query<{
      top_industries: any;
      top_personas: any;
    }>(
      `SELECT top_industries, top_personas
       FROM icp_profiles
       WHERE workspace_id = $1 AND is_active = true
       ORDER BY updated_at DESC
       LIMIT 1`,
      [workspaceId]
    );

    if (result.rows.length === 0) {
      return { top_industries: null, top_personas: null, has_profile: false };
    }

    const row = result.rows[0];
    const topIndustries = Array.isArray(row.top_industries) ? row.top_industries : null;
    const topPersonas = Array.isArray(row.top_personas) ? row.top_personas : null;

    return {
      top_industries: topIndustries,
      top_personas: topPersonas,
      has_profile: true,
    };
  } catch (err) {
    // Table might not exist yet - return null gracefully
    return { top_industries: null, top_personas: null, has_profile: false };
  }
}

// ============================================================================
// Query 5: Top Signals
// ============================================================================

async function loadTopSignals(workspaceId: string): Promise<{
  top_competitors: string[];
  top_objections: string[];
  has_signals: boolean;
}> {
  try {
    const [competitorResult, objectionResult, totalResult] = await Promise.all([
      query<{ signal_value: string; count: string }>(
        `SELECT signal_value, COUNT(*) as count
         FROM conversation_signals
         WHERE workspace_id = $1
           AND signal_type = 'competitor_mention'
           AND confidence >= 0.70
         GROUP BY signal_value
         ORDER BY count DESC
         LIMIT 5`,
        [workspaceId]
      ),
      query<{ signal_value: string; count: string }>(
        `SELECT signal_value, COUNT(*) as count
         FROM conversation_signals
         WHERE workspace_id = $1
           AND signal_type = 'objection'
           AND confidence >= 0.70
         GROUP BY signal_value
         ORDER BY count DESC
         LIMIT 5`,
        [workspaceId]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM conversation_signals
         WHERE workspace_id = $1 AND confidence >= 0.70`,
        [workspaceId]
      ),
    ]);

    const topCompetitors = competitorResult.rows.map(r => r.signal_value);
    const topObjections = objectionResult.rows.map(r => r.signal_value);
    const totalSignals = parseInt(totalResult.rows[0]?.count || '0', 10);

    return {
      top_competitors: topCompetitors,
      top_objections: topObjections,
      has_signals: totalSignals > 0,
    };
  } catch (err) {
    // Table might not exist or no signals extracted yet
    return { top_competitors: [], top_objections: [], has_signals: false };
  }
}
