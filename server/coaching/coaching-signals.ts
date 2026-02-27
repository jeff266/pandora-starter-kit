/**
 * Pattern-Aware Coaching Signal Generator
 *
 * Replaces hardcoded assumptions with data-driven insights.
 * Only surfaces signals where discovered patterns show meaningful separation.
 */

import { query } from '../db';
import type { PoolClient } from 'pg';
import { daysBetween } from '../utils/date-helpers.js';

export type CoachingMode = 'active' | 'retrospective' | 'hidden';

export interface CoachingSignal {
  type: 'positive' | 'warning' | 'action';
  label: string;
  insight: string;
  action_sentence: string;
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

export interface CoachingSignalsResult {
  signals: CoachingSignal[];
  mode: CoachingMode;
  metadata: {
    won_count: number;
    lost_count: number;
    pattern_count: number;
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
 * Determine coaching mode based on deal status
 */
function getCoachingMode(currentStage: string | null, stageNormalized?: string | null): CoachingMode {
  if (!currentStage && !stageNormalized) return 'hidden';

  // Prefer normalized stage (e.g. 'closed_won') over raw CRM stage (e.g. 'Closed Won')
  const normalized = (stageNormalized || currentStage || '').toLowerCase().replace(/\s+/g, '_');

  // Closed deals get retrospective view (what went right/wrong)
  if (normalized === 'closed_won' || normalized === 'closed_lost') return 'retrospective';

  // Open deals get active coaching
  return 'active';
}

/**
 * Get signal copy (label + action sentence) for a dimension
 */
interface SignalCopy {
  label: string;
  action_sentence: string;
}

function getSignalCopy(
  dimension: string,
  type: 'action' | 'positive',
  mode: CoachingMode,
  currentValue: number,
  wonMedian: number
): SignalCopy {
  const copies: Record<string, Record<string, SignalCopy>> = {
    sales_cycle_days: {
      action: {
        label: `${Math.round(currentValue)} days in — ${Math.round(currentValue / Math.max(wonMedian, 1))}× your typical close pace`,
        action_sentence: `Your wins at this price point close in ${Math.round(wonMedian)} days. At ${Math.round(currentValue)} days, this deal needs a direct conversation about timeline and next steps.`,
      },
      positive: {
        label: `Closing fast — ${Math.round(currentValue)} days`,
        action_sentence:
          mode === 'retrospective'
            ? `Closed in ${Math.round(currentValue)} days vs a ${Math.round(wonMedian)}-day pace. Worth capturing what drove this speed.`
            : `Ahead of pace at ${Math.round(currentValue)} days — your wins at this size take ${Math.round(wonMedian)} days. Keep the momentum.`,
      },
    },

    stage_regression_count: {
      action: {
        label: `${currentValue} stage regressions`,
        action_sentence: `Deals that win at this size typically have ${Math.round(wonMedian)} or fewer regressions. Multiple setbacks may signal qualification issues.`,
      },
      positive: {
        label: `Clean stage progression`,
        action_sentence:
          mode === 'retrospective'
            ? `Deal moved forward without unusual setbacks (${currentValue} regression vs ${Math.round(wonMedian)} median).`
            : `Stage progression tracking normally. No unusual regression pattern.`,
      },
    },

    unique_external_participants: {
      action: {
        label: `Single-threaded — ${currentValue} buyer contact${currentValue === 1 ? '' : 's'}`,
        action_sentence: `Won deals at this size typically involve ${Math.round(wonMedian)} buyer contacts. Identify additional stakeholders who influence the decision.`,
      },
      positive: {
        label: `Multi-threaded — ${currentValue} buyer contacts`,
        action_sentence:
          mode === 'retrospective'
            ? `Strong stakeholder coverage. ${currentValue} contacts engaged vs ${Math.round(wonMedian)} median.`
            : `Good stakeholder coverage at ${currentValue} contacts. On par with winning pattern.`,
      },
    },

    call_count: {
      action: {
        label: `Low engagement — ${currentValue} calls`,
        action_sentence: `Won deals at this size average ${Math.round(wonMedian)} calls. This deal may need more direct engagement to advance.`,
      },
      positive: {
        label: `Strong engagement — ${currentValue} calls`,
        action_sentence: `Call volume tracking with the winning pattern (${Math.round(wonMedian)} median).`,
      },
    },

    days_between_calls_avg: {
      action: {
        label: `${Math.round(currentValue)}-day gaps between calls`,
        action_sentence: `Won deals maintain a ${Math.round(wonMedian)}-day cadence. Tighten the engagement rhythm to avoid deal drift.`,
      },
      positive: {
        label: `Tight call cadence`,
        action_sentence: `${Math.round(currentValue)}-day average between calls, in line with the ${Math.round(wonMedian)}-day winning pattern.`,
      },
    },

    avg_talk_ratio_rep: {
      action: {
        label: `Rep talk time at ${Math.round(currentValue)}%`,
        action_sentence: `On won deals, reps average ${Math.round(wonMedian)}% talk time. More open-ended discovery could shift the ratio.`,
      },
      positive: {
        label: `Balanced conversation`,
        action_sentence: `Rep talk time at ${Math.round(currentValue)}% tracks the ${Math.round(wonMedian)}% winning pattern.`,
      },
    },

    contact_count: {
      action: {
        label: `${currentValue} contacts on deal`,
        action_sentence: `Won deals at this size typically have ${Math.round(wonMedian)} contacts. Map additional stakeholders in the buying process.`,
      },
      positive: {
        label: `Good contact coverage`,
        action_sentence: `${currentValue} contacts on deal, aligned with the ${Math.round(wonMedian)}-contact winning pattern.`,
      },
    },

    avg_action_items_per_call: {
      action: {
        label: `${currentValue.toFixed(1)} action items per call`,
        action_sentence: `Won deals average ${wonMedian.toFixed(1)} action items per call. More specific commitments during calls may improve follow-through.`,
      },
      positive: {
        label: `Good call-to-action cadence`,
        action_sentence: `${currentValue.toFixed(1)} action items per call, tracking the winning pattern.`,
      },
    },

    total_call_minutes: {
      action: {
        label: `${Math.round(currentValue)} total call minutes`,
        action_sentence: `Won deals accumulate ${Math.round(wonMedian)} minutes of call time. This deal may need deeper conversations to progress.`,
      },
      positive: {
        label: `Sufficient call investment`,
        action_sentence: `${Math.round(currentValue)} total minutes of conversation, aligned with the winning pattern.`,
      },
    },
  };

  const dimCopy = copies[dimension];
  if (!dimCopy) {
    // Fallback for dimensions without custom copy
    return {
      label: `${formatDimensionName(dimension)}: ${formatValue(dimension, currentValue)}`,
      action_sentence:
        type === 'action'
          ? `Won deals ${wonMedian > currentValue ? 'typically score higher' : 'typically score lower'} on this metric (median: ${formatValue(dimension, wonMedian)}).`
          : `Tracking with the winning pattern (median: ${formatValue(dimension, wonMedian)}).`,
    };
  }

  return dimCopy[type];
}

function formatDimensionName(dimension: string): string {
  return dimension
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatValue(dimension: string, value: number): string {
  if (dimension.includes('ratio') || dimension.includes('pct')) {
    return `${Math.round(value)}%`;
  }
  if (dimension.includes('days')) {
    return `${Math.round(value)} days`;
  }
  if (dimension.includes('count') || dimension.includes('participants')) {
    return Math.round(value).toString();
  }
  return value.toFixed(1);
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
  client?: PoolClient,
  stageNormalized?: string | null
): Promise<CoachingSignalsResult> {
  const db = client || { query };

  // Determine coaching mode — use stage_normalized to avoid CRM-specific stage name formats
  const mode = getCoachingMode(currentStage, stageNormalized);

  if (mode === 'hidden') {
    return {
      signals: [],
      mode: 'hidden',
      metadata: { won_count: 0, lost_count: 0, pattern_count: 0 },
    };
  }

  // Display thresholds by coaching mode
  const MIN_DISPLAY_THRESHOLD = {
    active: 0.5, // Only show Moderate+ patterns on open deals
    retrospective: 0.4, // Slightly lower bar for learning context
  };

  // Get closed deal counts for metadata
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

  // 1. Load current win patterns for this workspace
  const patternsResult = await db.query<StoredPattern>(
    `SELECT * FROM win_patterns
     WHERE workspace_id = $1 AND superseded_at IS NULL
     ORDER BY separation_score DESC`,
    [workspaceId]
  );

  // Coerce numeric columns (node-postgres returns all columns as strings with SELECT *)
  const patterns: StoredPattern[] = patternsResult.rows.map(r => ({
    ...r,
    won_median:        Number(r.won_median),
    won_p25:           Number(r.won_p25),
    won_p75:           Number(r.won_p75),
    lost_median:       Number(r.lost_median),
    lost_p25:          Number(r.lost_p25),
    lost_p75:          Number(r.lost_p75),
    separation_score:  Number(r.separation_score),
    sample_size_won:   Number(r.sample_size_won),
    sample_size_lost:  Number(r.sample_size_lost),
    segment_size_min:  r.segment_size_min != null ? Number(r.segment_size_min) : null,
    segment_size_max:  r.segment_size_max != null ? Number(r.segment_size_max) : null,
  }));

  if (patterns.length === 0) {
    // No patterns discovered yet - show building benchmarks message
    return {
      signals: [
        {
          type: 'warning',
          label: 'Building your benchmarks',
          insight: `Pandora is analyzing your closed deals to discover what winning looks like for your team. Coaching signals will appear once you have 15+ closed-won and 10+ closed-lost deals.`,
          action_sentence: `Current: ${wonCount} won, ${lostCount} lost deals in your pipeline.`,
        },
      ],
      mode,
      metadata: { won_count: wonCount, lost_count: lostCount, pattern_count: 0 },
    };
  }

  // 2. Find patterns applicable to THIS deal
  const applicablePatterns = patterns.filter(p => {
    // Segment match
    if (p.segment_size_min != null && amount < p.segment_size_min) return false;
    if (p.segment_size_max != null && amount > p.segment_size_max) return false;
    if (p.segment_pipeline != null && pipelineName !== p.segment_pipeline) return false;

    // Stage relevance
    if (!p.relevant_stages.includes('all') && !p.relevant_stages.includes(currentStage)) return false;

    // Minimum display threshold
    if (p.separation_score < MIN_DISPLAY_THRESHOLD[mode]) return false;

    return true;
  });

  if (applicablePatterns.length === 0) {
    // Patterns exist but none meet threshold or segment
    const hasWeakPatterns = patterns.some(
      p => p.separation_score >= 0.3 && p.separation_score < MIN_DISPLAY_THRESHOLD[mode]
    );

    if (hasWeakPatterns) {
      return {
        signals: [
          {
            type: 'warning',
            label: 'No strong coaching patterns detected',
            insight: `Pandora has identified some emerging patterns in your pipeline data, but they haven't reached the confidence level needed to provide reliable coaching.`,
            action_sentence: `As more deals close, patterns will strengthen. ${wonCount} won and ${lostCount} lost deals analyzed.`,
          },
        ],
        mode,
        metadata: { won_count: wonCount, lost_count: lostCount, pattern_count: patterns.length },
      };
    }

    return {
      signals: [
        {
          type: 'warning',
          label: 'No patterns for this segment',
          insight: 'Not enough closed deals in this deal size range to generate coaching signals yet.',
          action_sentence: 'Patterns will appear as similar deals close.',
        },
      ],
      mode,
      metadata: { won_count: wonCount, lost_count: lostCount, pattern_count: patterns.length },
    };
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
      const copy = getSignalCopy(pattern.dimension, 'action', mode, currentValue, pattern.won_median);
      signals.push({
        type: 'action',
        label: copy.label,
        insight: copy.action_sentence, // Keep for backward compat
        action_sentence: copy.action_sentence,
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
      const copy = getSignalCopy(pattern.dimension, 'positive', mode, currentValue, pattern.won_median);
      signals.push({
        type: 'positive',
        label: copy.label,
        insight: copy.action_sentence, // Keep for backward compat
        action_sentence: copy.action_sentence,
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

  // 4b. Neutral zone: patterns applied but all metrics fell between thresholds — show on-track signal
  if (applicablePatterns.length > 0 && signals.length === 0) {
    const bestPattern = applicablePatterns[0];
    const neutralLabel = bestPattern?.dimension === 'sales_cycle_days' && dealMetrics.sales_cycle_days != null
      ? `On pace — ${Math.round(dealMetrics.sales_cycle_days)} days in`
      : 'Moving at normal pace';
    const neutralSentence = bestPattern?.dimension === 'sales_cycle_days' && dealMetrics.sales_cycle_days != null
      ? `Within your normal close window. Your wins at this price range close in ${Math.round(bestPattern.won_median)}–${Math.round(bestPattern.won_p75)} days.`
      : `Deal metrics are within the normal range. Keep momentum — benchmarked against ${wonCount} won and ${lostCount} deals.`;
    signals.push({
      type: 'positive',
      label: neutralLabel,
      insight: neutralSentence,
      action_sentence: neutralSentence,
    });
  }

  // 5. Sort by separation score (most predictive first)
  signals.sort((a, b) => (b.separation_score || 0) - (a.separation_score || 0));

  // 6. Cap signals by mode
  const maxSignals = {
    active: { action: 3, positive: 2 },
    retrospective: { total: 3 },
  };

  let finalSignals: CoachingSignal[];
  if (mode === 'retrospective') {
    finalSignals = signals.slice(0, maxSignals.retrospective.total);
  } else {
    const actions = signals.filter(s => s.type === 'action').slice(0, maxSignals.active.action);
    const strengths = signals.filter(s => s.type === 'positive').slice(0, maxSignals.active.positive);
    finalSignals = [...actions, ...strengths];
  }

  return {
    signals: finalSignals,
    mode,
    metadata: {
      won_count: wonCount,
      lost_count: lostCount,
      pattern_count: applicablePatterns.length,
    },
  };
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

// Old helper functions removed - replaced by getSignalCopy()
