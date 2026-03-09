import { query } from '../db.js';

export interface ConversationEnrichment {
  conversation_id: string;
  deal_id: string | null;
  enriched_at: Date;
  is_substantive: boolean | null;
  customer_talk_pct: number | null;
  rep_talk_pct: number | null;
  call_energy: 'high' | 'medium' | 'low' | null;
  next_steps_agreed: boolean | null;
  buyer_signals: any[];
  buyer_verbalized_use_case: boolean | null;
  buyer_verbalized_success_metric: boolean | null;
  decision_criteria_discussed: boolean | null;
  technical_depth: 'none' | 'surface' | 'deep' | null;
  executive_present: boolean | null;
  champion_language: boolean | null;
  buyer_asked_about_pricing: boolean | null;
  buyer_referenced_internal_discussions: boolean | null;
  competitor_mentions: CompetitorMention[];
  competitor_count: number;
  competitive_intensity: 'none' | 'light' | 'heavy' | null;
  objections_raised: any[];
  objection_count: number;
  blocking_objection_present: boolean | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  sentiment_vs_prior: 'improving' | 'stable' | 'declining' | null;
  buyer_engagement_quality: 'high' | 'medium' | 'low' | null;
  champion_present: boolean | null;
  champion_email: string | null;
  new_stakeholder_introduced: boolean | null;
  executive_sponsor_language: boolean | null;
  stakeholder_count_on_call: number | null;
  methodology_framework: string | null;
  methodology_coverage: MethodologyCoverageItem[];
  methodology_score: number | null;
  methodology_gaps: MethodologyGap[];
}

export interface CompetitorMention {
  name: string;
  context: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface EngagementSummary {
  deal_id: string;
  avg_customer_talk_pct: number | null;
  avg_call_energy: string | null;
  next_steps_rate: number;
  blocking_objection_rate: number;
  total_calls: number;
}

export interface MethodologyCoverageItem {
  dimension_id: string;
  dimension_label: string;
  covered: boolean;
  confidence: 'high' | 'medium' | 'low';
  evidence_phrases: string[];
  gap_description: string | null;
}

export interface MethodologyGap {
  dimension_id: string;
  dimension_label: string;
  gap_description: string;
}

export interface MethodologyCoverageSummary {
  rep_email: string;
  framework_id: string | null;
  period_start: Date;
  period_end: Date;
  calls_analyzed: number;
  dimension_coverage: Array<{
    dimension_id: string;
    dimension_label: string;
    covered_count: number;
    total_count: number;
    coverage_pct: number;
  }>;
  overall_score: number;
}

export interface ChampionSentimentSignals {
  champion_language: boolean;
  sentiment_vs_prior: string | null;
  no_calls_in_stage: boolean;
}

export async function getBuyerSignalsForDeals(
  workspaceId: string,
  dealIds: string[],
): Promise<Map<string, ConversationEnrichment[]>> {
  const result = new Map<string, ConversationEnrichment[]>();
  if (dealIds.length === 0) return result;

  const rows = await query<any>(
    `SELECT
       ce.deal_id,
       ce.conversation_id,
       ce.enriched_at,
       ce.is_substantive,
       ce.customer_talk_pct,
       ce.rep_talk_pct,
       ce.call_energy,
       ce.next_steps_agreed,
       COALESCE(ce.buyer_signals, '[]') AS buyer_signals,
       ce.buyer_verbalized_use_case,
       ce.buyer_verbalized_success_metric,
       ce.decision_criteria_discussed,
       ce.technical_depth,
       ce.executive_present,
       ce.champion_language,
       ce.buyer_asked_about_pricing,
       ce.buyer_referenced_internal_discussions,
       COALESCE(ce.competitor_mentions, '[]') AS competitor_mentions,
       COALESCE(ce.competitor_count, 0) AS competitor_count,
       ce.competitive_intensity,
       COALESCE(ce.objections_raised, '[]') AS objections_raised,
       COALESCE(ce.objection_count, 0) AS objection_count,
       ce.blocking_objection_present,
       ce.sentiment,
       ce.sentiment_vs_prior,
       ce.buyer_engagement_quality,
       ce.champion_present,
       ce.champion_email,
       ce.new_stakeholder_introduced,
       ce.executive_sponsor_language,
       ce.stakeholder_count_on_call,
       ce.methodology_framework,
       COALESCE(ce.methodology_coverage, '[]') AS methodology_coverage,
       ce.methodology_score,
       COALESCE(ce.methodology_gaps, '[]') AS methodology_gaps
     FROM conversation_enrichments ce
     WHERE ce.workspace_id = $1
       AND ce.deal_id = ANY($2)
     ORDER BY ce.enriched_at DESC`,
    [workspaceId, dealIds],
  );

  for (const row of rows.rows) {
    const dealId = row.deal_id;
    if (!dealId) continue;
    if (!result.has(dealId)) result.set(dealId, []);
    result.get(dealId)!.push({
      ...row,
      buyer_signals: row.buyer_signals ?? [],
      competitor_mentions: row.competitor_mentions ?? [],
      objections_raised: row.objections_raised ?? [],
      methodology_coverage: row.methodology_coverage ?? [],
      methodology_gaps: row.methodology_gaps ?? [],
    });
  }

  return result;
}

export async function getCompetitorMentionsByDeal(
  workspaceId: string,
  dealIds: string[],
): Promise<Map<string, CompetitorMention[]>> {
  const result = new Map<string, CompetitorMention[]>();
  if (dealIds.length === 0) return result;

  const rows = await query<{ deal_id: string; competitor_mentions: any }>(
    `SELECT deal_id, competitor_mentions
     FROM conversation_enrichments
     WHERE workspace_id = $1
       AND deal_id = ANY($2)
       AND competitor_count > 0
     ORDER BY enriched_at DESC`,
    [workspaceId, dealIds],
  );

  for (const row of rows.rows) {
    if (!row.deal_id || !Array.isArray(row.competitor_mentions)) continue;
    const existing = result.get(row.deal_id) ?? [];
    result.set(row.deal_id, [...existing, ...row.competitor_mentions]);
  }

  return result;
}

export async function getEngagementQualityByDeal(
  workspaceId: string,
  dealIds: string[],
): Promise<Map<string, EngagementSummary>> {
  const result = new Map<string, EngagementSummary>();
  if (dealIds.length === 0) return result;

  const rows = await query<{
    deal_id: string;
    avg_customer_talk_pct: string | null;
    next_steps_rate: string;
    blocking_rate: string;
    total_calls: string;
  }>(
    `SELECT
       deal_id,
       AVG(customer_talk_pct)::numeric(5,2) AS avg_customer_talk_pct,
       (COUNT(*) FILTER (WHERE next_steps_agreed = true)::float /
        NULLIF(COUNT(*), 0)) AS next_steps_rate,
       (COUNT(*) FILTER (WHERE blocking_objection_present = true)::float /
        NULLIF(COUNT(*), 0)) AS blocking_rate,
       COUNT(*) AS total_calls
     FROM conversation_enrichments
     WHERE workspace_id = $1
       AND deal_id = ANY($2)
     GROUP BY deal_id`,
    [workspaceId, dealIds],
  );

  for (const row of rows.rows) {
    result.set(row.deal_id, {
      deal_id: row.deal_id,
      avg_customer_talk_pct: row.avg_customer_talk_pct != null ? parseFloat(row.avg_customer_talk_pct) : null,
      avg_call_energy: null,
      next_steps_rate: parseFloat(row.next_steps_rate) || 0,
      blocking_objection_rate: parseFloat(row.blocking_rate) || 0,
      total_calls: parseInt(row.total_calls, 10) || 0,
    });
  }

  return result;
}

export async function getMethodologyCoverageByRep(
  workspaceId: string,
  repEmail: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<MethodologyCoverageSummary> {
  const rows = await query<{
    methodology_framework: string | null;
    methodology_coverage: any;
    methodology_score: string | null;
  }>(
    `SELECT ce.methodology_framework, ce.methodology_coverage, ce.methodology_score
     FROM conversation_enrichments ce
     JOIN conversations c ON c.id = ce.conversation_id
     WHERE ce.workspace_id = $1
       AND ce.methodology_framework IS NOT NULL
       AND ce.enriched_at >= $2
       AND ce.enriched_at <= $3
       AND c.participants::text ILIKE $4`,
    [workspaceId, periodStart.toISOString(), periodEnd.toISOString(), `%${repEmail}%`],
  );

  if (rows.rows.length === 0) {
    return {
      rep_email: repEmail,
      framework_id: null,
      period_start: periodStart,
      period_end: periodEnd,
      calls_analyzed: 0,
      dimension_coverage: [],
      overall_score: 0,
    };
  }

  const frameworkId = rows.rows[0].methodology_framework;
  const dimensionMap = new Map<string, { label: string; covered: number; total: number }>();

  for (const row of rows.rows) {
    const coverage: MethodologyCoverageItem[] = row.methodology_coverage ?? [];
    for (const dim of coverage) {
      const existing = dimensionMap.get(dim.dimension_id) ?? {
        label: dim.dimension_label,
        covered: 0,
        total: 0,
      };
      existing.total += 1;
      if (dim.covered) existing.covered += 1;
      dimensionMap.set(dim.dimension_id, existing);
    }
  }

  const dimension_coverage = Array.from(dimensionMap.entries()).map(([id, d]) => ({
    dimension_id: id,
    dimension_label: d.label,
    covered_count: d.covered,
    total_count: d.total,
    coverage_pct: d.total > 0 ? Math.round((d.covered / d.total) * 100) : 0,
  }));

  const scores = rows.rows
    .map(r => (r.methodology_score != null ? parseFloat(r.methodology_score) : null))
    .filter((s): s is number => s !== null);
  const overall_score = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  return {
    rep_email: repEmail,
    framework_id: frameworkId,
    period_start: periodStart,
    period_end: periodEnd,
    calls_analyzed: rows.rows.length,
    dimension_coverage,
    overall_score,
  };
}

export async function getConversationRiskSignals(
  workspaceId: string,
  dealIds: string[],
): Promise<Map<string, { championPresent: boolean; competitorHeavy: boolean; blockingObjection: boolean }>> {
  const result = new Map<string, { championPresent: boolean; competitorHeavy: boolean; blockingObjection: boolean }>();
  if (dealIds.length === 0) return result;

  const rows = await query<{
    deal_id: string;
    champion_present: boolean | null;
    max_competitor_count: string;
    has_blocking_objection: boolean | null;
  }>(
    `SELECT
       deal_id,
       BOOL_OR(champion_present) AS champion_present,
       MAX(COALESCE(competitor_count, 0)) AS max_competitor_count,
       BOOL_OR(blocking_objection_present) AS has_blocking_objection
     FROM conversation_enrichments
     WHERE workspace_id = $1
       AND deal_id = ANY($2)
     GROUP BY deal_id`,
    [workspaceId, dealIds],
  );

  for (const row of rows.rows) {
    result.set(row.deal_id, {
      championPresent: row.champion_present === true,
      competitorHeavy: parseInt(row.max_competitor_count, 10) > 2,
      blockingObjection: row.has_blocking_objection === true,
    });
  }

  return result;
}

export async function getChampionAndSentimentSignals(
  workspaceId: string,
  dealIds: string[],
): Promise<Map<string, ChampionSentimentSignals>> {
  const result = new Map<string, ChampionSentimentSignals>();
  if (dealIds.length === 0) return result;

  const rows = await query<{
    deal_id: string;
    champion_language: boolean | null;
    latest_sentiment_vs_prior: string | null;
  }>(
    `SELECT
       deal_id,
       BOOL_OR(champion_language) AS champion_language,
       (ARRAY_AGG(sentiment_vs_prior ORDER BY enriched_at DESC))[1] AS latest_sentiment_vs_prior
     FROM conversation_enrichments
     WHERE workspace_id = $1
       AND deal_id = ANY($2)
     GROUP BY deal_id`,
    [workspaceId, dealIds],
  );

  const enrichedDealIds = new Set(rows.rows.map(r => r.deal_id));

  for (const row of rows.rows) {
    result.set(row.deal_id, {
      champion_language: row.champion_language === true,
      sentiment_vs_prior: row.latest_sentiment_vs_prior,
      no_calls_in_stage: false,
    });
  }

  for (const dealId of dealIds) {
    if (!enrichedDealIds.has(dealId)) {
      result.set(dealId, {
        champion_language: false,
        sentiment_vs_prior: null,
        no_calls_in_stage: true,
      });
    }
  }

  return result;
}
