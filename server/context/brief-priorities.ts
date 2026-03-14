import type { TemporalContext } from './opening-brief.js';

// ===== TYPES =====

export interface BriefPriorityFrame {
  cell: string;
  primaryTopics: string[];
  weights: Record<string, number>;
  frameLabel: string;
  suppressTopics: string[];
}

type AttainmentBand = 'below' | 'at' | 'above';
type QuarterPos = 'early' | 'mid' | 'late' | 'end';

interface CellSpec {
  primaryTopics: string[];
  suppressTopics: string[];
  frameLabel: string;
}

// ===== GRID =====

const GRID: Record<string, CellSpec> = {
  early_below: {
    primaryTopics: ['coverage_gap', 'icp_quality', 'rep_ramp'],
    suppressTopics: ['board_narrative', 'crm_hygiene'],
    frameLabel: 'Building the foundation',
  },
  early_at: {
    primaryTopics: ['pipeline_velocity', 'coverage_trend'],
    suppressTopics: ['board_narrative'],
    frameLabel: 'On track — maintain momentum',
  },
  early_above: {
    primaryTopics: ['q2_setup', 'rep_variance', 'expansion'],
    suppressTopics: ['q1_close_risk'],
    frameLabel: 'Ahead — protect margin and build Q2',
  },
  mid_below: {
    primaryTopics: ['deal_reality', 'rep_coaching', 'forecast_prep', 'big_deals_at_risk'],
    suppressTopics: ['q2_setup'],
    frameLabel: 'Behind — focus on what can close',
  },
  mid_at: {
    primaryTopics: ['fragile_deals', 'q2_coverage', 'big_deals_at_risk'],
    suppressTopics: [],
    frameLabel: "On pace — protect what's real",
  },
  mid_above: {
    primaryTopics: ['q2_setup', 'rep_variance', 'big_deals_at_risk', 'expansion'],
    suppressTopics: ['q1_close_risk'],
    frameLabel: 'Ahead — seed Q2 while closing Q1',
  },
  late_below: {
    primaryTopics: ['recovery_path', 'closable_deals', 'board_narrative', 'big_deals_at_risk'],
    suppressTopics: ['q2_setup', 'rep_coaching'],
    frameLabel: 'Behind at week 10 — what can close',
  },
  late_at: {
    primaryTopics: ['protect_number', 'crm_hygiene', 'q2_coverage', 'big_deals_at_risk'],
    suppressTopics: [],
    frameLabel: 'On target — protect and set up Q2',
  },
  late_above: {
    primaryTopics: ['q2_setup', 'rep_variance', 'big_deals_at_risk', 'crm_hygiene'],
    suppressTopics: ['q1_close_risk', 'deal_hygiene'],
    frameLabel: 'Won — build Q2 this week',
  },
  end_below: {
    primaryTopics: ['damage_control', 'board_narrative', 'q2_story', 'closable_now'],
    suppressTopics: ['q2_setup', 'rep_coaching'],
    frameLabel: 'Final week — close what can close',
  },
  end_at: {
    primaryTopics: ['close_decisions', 'crm_hygiene', 'q2_story', 'board_narrative'],
    suppressTopics: [],
    frameLabel: 'Final week — close and clean up',
  },
  end_above: {
    primaryTopics: ['q2_pipeline', 'crm_hygiene', 'rep_recognition', 'q2_story'],
    suppressTopics: ['q1_close_risk'],
    frameLabel: 'Final week — won, seed Q2',
  },
  no_target: {
    primaryTopics: ['pipeline_velocity', 'big_deals_at_risk', 'coverage_trend', 'rep_variance'],
    suppressTopics: [],
    frameLabel: 'Pipeline health — no target configured',
  },
};

// ===== WEIGHTS =====

function buildWeights(topics: string[]): Record<string, number> {
  return Object.fromEntries(
    topics.map((t, i) => [t, Math.max(1.0 - i * 0.15, 0.25)])
  );
}

// ===== MAIN EXPORT =====

export function calibrateBriefPriorities(
  temporal: TemporalContext,
  attainmentPct: number | null,
  _coverageRatio: number | null,
  hasTarget: boolean
): BriefPriorityFrame {
  if (!hasTarget || attainmentPct === null) {
    const spec = GRID.no_target;
    return {
      cell: 'no_target',
      primaryTopics: spec.primaryTopics,
      weights: buildWeights(spec.primaryTopics),
      frameLabel: spec.frameLabel,
      suppressTopics: spec.suppressTopics,
    };
  }

  const band: AttainmentBand =
    attainmentPct < 85 ? 'below' : attainmentPct < 105 ? 'at' : 'above';

  const posMap: Record<TemporalContext['quarterPhase'], QuarterPos> = {
    early: 'early',
    mid: 'mid',
    late: 'late',
    final_week: 'end',
  };
  const pos: QuarterPos = posMap[temporal.quarterPhase] ?? 'mid';

  const cell = `${pos}_${band}`;
  const spec = GRID[cell] ?? GRID.no_target;

  return {
    cell,
    primaryTopics: spec.primaryTopics,
    weights: buildWeights(spec.primaryTopics),
    frameLabel: spec.frameLabel,
    suppressTopics: spec.suppressTopics,
  };
}
