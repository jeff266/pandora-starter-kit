/**
 * Pattern-Aware Coaching Signal Generator
 *
 * Replaces hardcoded assumptions with data-driven insights.
 * Only surfaces signals where discovered patterns show meaningful separation.
 */

import { query } from '../db';
import type { PoolClient } from 'pg';

export interface CoachingSignal {
  type: 'positive' | 'warning' | 'action';
  label: string;
  insight: string;
  separation_score?: number;
  data?: {
    dimension: string;
    current_value: number;
    won_median: number;
    won_p25: number;
    won_p75: number;
    sample_size: number;
  };
}

interface StoredPattern {
  id: string;
  dimension: string;
  segment_size_min: number | null;
  segment_size_max: number | null;
  segment_pipeline: string | null;
  won_median: number;
  won_p25: number;
  won_p75: number;
  lost_median: number;
  lost_p25: number;
  lost_p75: number;
  separation_score: number;
  direction: 'higher_wins' | 'lower_wins';
  sample_size_won: number;
  sample_size_lost: number;
  relevant_stages: string[];
}

interface DealMetrics {
  [key: string]: number | null;
  call_count: number | null;
  unique_external_participants: number | null;
  avg_external_per_call: number | null;
  total_call_minutes: number | null;
  avg_call_duration_minutes: number | null;
  avg_talk_ratio_rep: number | null;
  avg_talk_ratio_buyer: number | null;
  avg_questions_per_call: number | null;
  avg_action_items_per_call: number | null;
  first_call_days_from_creation: number | null;
  days_between_calls_avg: number | null;
  sales_cycle_days: number | null;
  stage_regression_count: number | null;
  contact_count: number | null;
}

/**
 * Generate coaching signals based on discovered win patterns
 */
export async function generateCoachingSignals(
  dealId: string,
  workspaceId: string,
  currentStage: string,
  amount: number,
  pipelineName: string | null,
  client?: PoolClient
): Promise<CoachingSignal[]> {
  const db = client || { query };

  // 1. Load current win patterns for this workspace
  const patternsResult = await db.query<StoredPattern>(
    `SELECT * FROM win_patterns
     WHERE workspace_id = $1 AND superseded_at IS NULL
     ORDER BY separation_score DESC`,
    [workspaceId]
  );

  if (patternsResult.rows.length === 0) {
    // No patterns discovered yet - show building benchmarks message
    const closedDealsResult = await db.query<{ won: number; lost: number }>(
      `SELECT
        SUM(CASE WHEN stage_normalized = 'closed_won' THEN 1 ELSE 0 END)::integer as won,
        SUM(CASE WHEN stage_normalized = 'closed_lost' THEN 1 ELSE 0 END)::integer as lost
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized IN ('closed_won', 'closed_lost')`,
      [workspaceId]
    );

    const wonCount = closedDealsResult.rows[0]?.won || 0;
    const lostCount = closedDealsResult.rows[0]?.lost || 0;

    return [
      {
        type: 'warning',
        label: 'Building your benchmarks',
        insight: `Pandora is analyzing your closed deals to discover what winning looks like for your team. Coaching signals will appear once you have 15+ closed-won and 10+ closed-lost deals. Current: ${wonCount} won, ${lostCount} lost.`,
      },
    ];
  }

  // 2. Find patterns applicable to THIS deal
  const applicablePatterns = patternsResult.rows.filter(p => {
    // Segment match
    if (p.segment_size_min != null && amount < p.segment_size_min) return false;
    if (p.segment_size_max != null && amount > p.segment_size_max) return false;
    if (p.segment_pipeline != null && pipelineName !== p.segment_pipeline) return false;

    // Stage relevance
    if (!p.relevant_stages.includes('all') && !p.relevant_stages.includes(currentStage)) return false;

    return true;
  });

  if (applicablePatterns.length === 0) {
    return [
      {
        type: 'warning',
        label: 'No patterns for this segment',
        insight: 'Not enough closed deals in this deal size range to generate coaching signals yet.',
      },
    ];
  }

  // 3. Compute current deal metrics
  const dealMetrics = await computeDealMetrics(dealId, workspaceId, db);

  // 4. Check each pattern against current deal
  const signals: CoachingSignal[] = [];

  for (const pattern of applicablePatterns) {
    const currentValue = dealMetrics[pattern.dimension];
    if (currentValue == null) continue; // Dimension not measurable for this deal

    const isOnWrongSide =
      pattern.direction === 'higher_wins'
        ? currentValue < pattern.won_p25 // Below 25th percentile of winners
        : currentValue > pattern.won_p75; // Above 75th percentile of winners

    const isOnRightSide =
      pattern.direction === 'higher_wins'
        ? currentValue >= pattern.won_median
        : currentValue <= pattern.won_median;

    if (isOnWrongSide) {
      signals.push({
        type: 'action',
        label: dimensionToLabel(pattern.dimension),
        insight: buildInsightText(pattern, currentValue),
        separation_score: pattern.separation_score,
        data: {
          dimension: pattern.dimension,
          current_value: currentValue,
          won_median: pattern.won_median,
          won_p25: pattern.won_p25,
          won_p75: pattern.won_p75,
          sample_size: pattern.sample_size_won + pattern.sample_size_lost,
        },
      });
    } else if (isOnRightSide) {
      // Surface strengths (but limit these to avoid clutter)
      signals.push({
        type: 'positive',
        label: dimensionToLabel(pattern.dimension),
        insight: buildStrengthText(pattern, currentValue),
        separation_score: pattern.separation_score,
        data: {
          dimension: pattern.dimension,
          current_value: currentValue,
          won_median: pattern.won_median,
          won_p25: pattern.won_p25,
          won_p75: pattern.won_p75,
          sample_size: pattern.sample_size_won + pattern.sample_size_lost,
        },
      });
    }
  }

  // 5. Sort by separation score (most predictive first), limit output
  signals.sort((a, b) => (b.separation_score || 0) - (a.separation_score || 0));

  // Return max 3 action signals + 2 positive signals
  const actions = signals.filter(s => s.type === 'action').slice(0, 3);
  const strengths = signals.filter(s => s.type === 'positive').slice(0, 2);

  return [...actions, ...strengths];
}

/**
 * Compute metrics for a specific deal
 */
async function computeDealMetrics(
  dealId: string,
  workspaceId: string,
  db: any
): Promise<DealMetrics> {
  // Conversation metrics
  const convResult = await db.query<{
    call_count: number;
    total_call_minutes: number;
    avg_call_duration_minutes: number;
    unique_external_participants: number;
    avg_external_per_call: number;
    avg_talk_ratio_rep: number;
    avg_talk_ratio_buyer: number;
    avg_questions_per_call: number;
    avg_action_items_per_call: number;
    first_call_date: string;
    last_call_date: string;
  }>(
    `WITH deal_convs AS (
      SELECT
        c.id as conv_id,
        c.call_date,
        c.duration_seconds,
        c.call_metrics,
        c.action_items,
        c.resolved_participants
      FROM conversations c
      WHERE c.deal_id = $1 AND c.workspace_id = $2
    ),
    all_external AS (
      SELECT DISTINCT p->>'email' as email
      FROM deal_convs dc,
      LATERAL jsonb_array_elements(COALESCE(dc.resolved_participants, '[]'::jsonb)) p
      WHERE p->>'role' = 'external'
        AND (p->>'confidence')::numeric >= 0.7
    ),
    per_call_ext AS (
      SELECT dc.conv_id, COUNT(*)::integer as ext_count
      FROM deal_convs dc,
      LATERAL jsonb_array_elements(COALESCE(dc.resolved_participants, '[]'::jsonb)) p
      WHERE p->>'role' = 'external' AND (p->>'confidence')::numeric >= 0.7
      GROUP BY dc.conv_id
    )
    SELECT
      COUNT(DISTINCT dc.conv_id)::integer as call_count,
      COALESCE(SUM(dc.duration_seconds) / 60.0, 0) as total_call_minutes,
      COALESCE(AVG(dc.duration_seconds) / 60.0, 0) as avg_call_duration_minutes,
      (SELECT COUNT(*) FROM all_external)::integer as unique_external_participants,
      COALESCE((SELECT AVG(ext_count) FROM per_call_ext), 0) as avg_external_per_call,
      AVG((dc.call_metrics->>'talk_ratio_rep')::numeric) as avg_talk_ratio_rep,
      AVG((dc.call_metrics->>'talk_ratio_buyer')::numeric) as avg_talk_ratio_buyer,
      AVG((dc.call_metrics->>'question_count')::numeric) as avg_questions_per_call,
      AVG(jsonb_array_length(COALESCE(dc.action_items, '[]'::jsonb))) as avg_action_items_per_call,
      MIN(dc.call_date) as first_call_date,
      MAX(dc.call_date) as last_call_date
    FROM deal_convs dc`,
    [dealId, workspaceId]
  );

  // CRM metrics
  const crmResult = await db.query<{
    sales_cycle_days: number;
    stage_regression_count: number;
    contact_count: number;
    created_at: string;
  }>(
    `SELECT
      EXTRACT(days FROM NOW() - d.created_at::timestamp)::integer as sales_cycle_days,
      COALESCE((
        SELECT COUNT(*)::integer
        FROM deal_stage_history dsh
        WHERE dsh.deal_id = d.id
          AND EXISTS (
            SELECT 1 FROM deal_stage_history prev
            WHERE prev.deal_id = d.id
              AND prev.stage_normalized = dsh.stage_normalized
              AND prev.entered_at < dsh.entered_at
              AND prev.exited_at IS NOT NULL
          )
      ), 0) as stage_regression_count,
      COALESCE((
        SELECT COUNT(*)::integer
        FROM deal_contacts dc
        WHERE dc.deal_id = d.id
      ), 0) as contact_count,
      d.created_at
     FROM deals d
     WHERE d.id = $1`,
    [dealId]
  );

  const conv = convResult.rows[0] || {};
  const crm = crmResult.rows[0] || {};

  const firstCallDaysFromCreation =
    conv.first_call_date && crm.created_at
      ? daysBetween(new Date(crm.created_at), new Date(conv.first_call_date))
      : null;

  const daysBetweenCallsAvg =
    conv.call_count > 1 && conv.first_call_date && conv.last_call_date
      ? daysBetween(new Date(conv.first_call_date), new Date(conv.last_call_date)) / (conv.call_count - 1)
      : null;

  return {
    call_count: conv.call_count || 0,
    total_call_minutes: conv.total_call_minutes || null,
    avg_call_duration_minutes: conv.avg_call_duration_minutes || null,
    unique_external_participants: conv.unique_external_participants || 0,
    avg_external_per_call: conv.avg_external_per_call || null,
    avg_talk_ratio_rep: conv.avg_talk_ratio_rep || null,
    avg_talk_ratio_buyer: conv.avg_talk_ratio_buyer || null,
    avg_questions_per_call: conv.avg_questions_per_call || null,
    avg_action_items_per_call: conv.avg_action_items_per_call || null,
    first_call_days_from_creation: firstCallDaysFromCreation,
    days_between_calls_avg: daysBetweenCallsAvg,
    sales_cycle_days: crm.sales_cycle_days || null,
    stage_regression_count: crm.stage_regression_count || null,
    contact_count: crm.contact_count || null,
  };
}

/**
 * Convert dimension key to human-readable label
 */
function dimensionToLabel(dimension: string): string {
  const labels: Record<string, string> = {
    unique_external_participants: 'Limited buyer engagement',
    call_count: 'Call frequency below winning pattern',
    avg_talk_ratio_rep: 'Rep talk time high',
    avg_talk_ratio_buyer: 'Buyer talk time low',
    avg_call_duration_minutes: 'Call duration off-pattern',
    days_between_calls_avg: 'Call cadence too slow',
    sales_cycle_days: 'Sales cycle dragging',
    stage_regression_count: 'Stage regressions detected',
    contact_count: 'Limited multi-threading',
    avg_action_items_per_call: 'Low action item generation',
    avg_questions_per_call: 'Low question count',
    first_call_days_from_creation: 'Delayed first engagement',
    total_call_minutes: 'Total engagement time low',
    avg_external_per_call: 'Low buyer attendance per call',
  };

  return labels[dimension] || dimension;
}

/**
 * Build insight text for an action signal
 */
function buildInsightText(pattern: StoredPattern, currentValue: number): string {
  const wonMed = Math.round(pattern.won_median * 10) / 10;
  const sizeContext =
    pattern.segment_size_min != null
      ? ` for ${formatCurrency(pattern.segment_size_min)}-${formatCurrency(pattern.segment_size_max)} deals`
      : '';

  const templates: Record<string, string> = {
    unique_external_participants: `${currentValue} unique buyer contacts engaged. Won deals${sizeContext} typically have ${wonMed}. Consider broadening stakeholder involvement.`,
    call_count: `${currentValue} calls on this deal. Won deals${sizeContext} average ${wonMed} calls. Engagement volume is below the winning pattern.`,
    avg_talk_ratio_rep: `Rep talk time at ${Math.round(currentValue)}%. On won deals${sizeContext}, reps average ${Math.round(wonMed)}%. More buyer-led conversation may help.`,
    avg_talk_ratio_buyer: `Buyer talk time at ${Math.round(currentValue)}%. Won deals${sizeContext} have buyers at ${Math.round(wonMed)}%. Encourage more buyer participation.`,
    avg_call_duration_minutes: `Calls averaging ${Math.round(currentValue)} minutes. Won deals${sizeContext} average ${Math.round(wonMed)} minute calls.`,
    days_between_calls_avg: `${Math.round(currentValue)} days between calls on average. Won deals${sizeContext} maintain ${Math.round(wonMed)}-day cadence.`,
    sales_cycle_days: `Deal at day ${Math.round(currentValue)} of sales cycle. Won deals${sizeContext} close in a median of ${Math.round(wonMed)} days.`,
    stage_regression_count: `${currentValue} stage regressions. Won deals${sizeContext} average ${wonMed}. Stage movement should be forward.`,
    contact_count: `${currentValue} contacts on deal. Won deals${sizeContext} typically have ${Math.round(wonMed)}.`,
    avg_action_items_per_call: `${currentValue.toFixed(1)} action items per call. Won deals${sizeContext} average ${wonMed.toFixed(1)}.`,
  };

  return (
    templates[pattern.dimension] ||
    `${dimensionToLabel(pattern.dimension)}: ${currentValue} vs ${wonMed} median on won deals${sizeContext}.`
  );
}

/**
 * Build insight text for a positive signal
 */
function buildStrengthText(pattern: StoredPattern, currentValue: number): string {
  const wonMed = Math.round(pattern.won_median * 10) / 10;
  const sizeContext =
    pattern.segment_size_min != null
      ? ` for ${formatCurrency(pattern.segment_size_min)}-${formatCurrency(pattern.segment_size_max)} deals`
      : '';

  return `${dimensionToLabel(pattern.dimension)}: ${currentValue} (won deals${sizeContext} median: ${wonMed}). Tracking well.`;
}

// Helper functions

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${Math.round(value / 1000000)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value}`;
}

function daysBetween(date1: Date, date2: Date): number {
  const diffMs = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
