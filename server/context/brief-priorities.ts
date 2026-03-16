import type { TemporalContext } from './opening-brief.js';
import { query } from '../db.js';

// ===== TYPES =====

// ─────────────────────────────────────────────────────────────────────────────
// WorkspaceVoice
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkspaceVoice {
  tone: 'direct' | 'consultative' | 'coaching';
  detailLevel: 'executive' | 'operational' | 'detailed';
  framingStyle: 'number_first' | 'narrative_first' | 'risk_first';
  salesMotion: 'high_velocity' | 'enterprise' | 'mixed';
  coverageTarget: number;
  riskPhrases: string[];
  urgencyPhrases: string[];
  winPhrases: string[];
  pipelineVocabulary: string[];
  commonShorthand: Record<string, string>;
  hasLearnedPatterns: boolean;
  callsAnalyzed: number;
  lastExtractedAt: Date | null;
}

const DEFAULT_WORKSPACE_VOICE: WorkspaceVoice = {
  tone: 'direct',
  detailLevel: 'operational',
  framingStyle: 'number_first',
  salesMotion: 'mixed',
  coverageTarget: 3.0,
  riskPhrases: [],
  urgencyPhrases: [],
  winPhrases: [],
  pipelineVocabulary: [],
  commonShorthand: {},
  hasLearnedPatterns: false,
  callsAnalyzed: 0,
  lastExtractedAt: null,
};

/**
 * Loads the workspace voice profile from workspace_voice_patterns.
 * Returns safe defaults if no row exists or any error occurs.
 */
export async function loadWorkspaceVoice(workspaceId: string): Promise<WorkspaceVoice> {
  try {
    const result = await query<{
      tone: string;
      detail_level: string;
      framing_style: string;
      sales_motion: string;
      coverage_target: string;
      risk_phrases: string[];
      urgency_phrases: string[];
      win_phrases: string[];
      pipeline_vocabulary: string[];
      common_shorthand: Record<string, string>;
      calls_analyzed: number;
      last_extracted_at: Date | null;
    }>(
      `SELECT
         tone,
         detail_level,
         framing_style,
         sales_motion,
         coverage_target,
         risk_phrases,
         urgency_phrases,
         win_phrases,
         pipeline_vocabulary,
         common_shorthand,
         calls_analyzed,
         last_extracted_at
       FROM workspace_voice_patterns
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    if (result.rows.length === 0) return { ...DEFAULT_WORKSPACE_VOICE };

    const row = result.rows[0];
    const riskPhrases = Array.isArray(row.risk_phrases) ? row.risk_phrases : [];

    return {
      tone: (row.tone as WorkspaceVoice['tone']) ?? 'direct',
      detailLevel: (row.detail_level as WorkspaceVoice['detailLevel']) ?? 'operational',
      framingStyle: (row.framing_style as WorkspaceVoice['framingStyle']) ?? 'number_first',
      salesMotion: (row.sales_motion as WorkspaceVoice['salesMotion']) ?? 'mixed',
      coverageTarget: parseFloat(row.coverage_target ?? '3.0') || 3.0,
      riskPhrases,
      urgencyPhrases: Array.isArray(row.urgency_phrases) ? row.urgency_phrases : [],
      winPhrases: Array.isArray(row.win_phrases) ? row.win_phrases : [],
      pipelineVocabulary: Array.isArray(row.pipeline_vocabulary) ? row.pipeline_vocabulary : [],
      commonShorthand: (row.common_shorthand && typeof row.common_shorthand === 'object') ? row.common_shorthand : {},
      callsAnalyzed: row.calls_analyzed ?? 0,
      lastExtractedAt: row.last_extracted_at ?? null,
      hasLearnedPatterns: (row.calls_analyzed ?? 0) > 0 && riskPhrases.length > 0,
    };
  } catch (err) {
    // Voice loading must never break brief generation
    console.warn('[loadWorkspaceVoice] Failed to load voice profile:', err instanceof Error ? err.message : err);
    return { ...DEFAULT_WORKSPACE_VOICE };
  }
}

const TONE_DESCRIPTIONS: Record<WorkspaceVoice['tone'], string> = {
  direct: 'state findings plainly, no hedging',
  consultative: 'frame as recommendations with reasoning',
  coaching: 'frame as development opportunities for reps',
};

const DETAIL_DESCRIPTIONS: Record<WorkspaceVoice['detailLevel'], string> = {
  executive: 'one number, one sentence, one action',
  operational: 'include reasoning chain and so-what',
  detailed: 'include data behind findings, full context',
};

/**
 * Renders the workspace voice profile as a string block for injection into
 * synthesis prompts. Only non-empty sections are included.
 */
export function renderVoiceContext(voice: WorkspaceVoice): string {
  const lines: string[] = [
    `WORKSPACE VOICE PROFILE:`,
    `Tone: ${voice.tone} — ${TONE_DESCRIPTIONS[voice.tone]}`,
    `Detail level: ${voice.detailLevel} — ${DETAIL_DESCRIPTIONS[voice.detailLevel]}`,
    `Coverage target: ${voice.coverageTarget}× (workspace-specific)`,
    `Sales motion: ${voice.salesMotion}`,
  ];

  if (voice.hasLearnedPatterns) {
    lines.push(``, `LEARNED LANGUAGE PATTERNS (from ${voice.callsAnalyzed} internal calls):`);
    if (voice.riskPhrases.length > 0) {
      lines.push(`Risk language: ${voice.riskPhrases.join(', ')}`);
    }
    if (voice.urgencyPhrases.length > 0) {
      lines.push(`Urgency language: ${voice.urgencyPhrases.join(', ')}`);
    }
    if (voice.winPhrases.length > 0) {
      lines.push(`Win language: ${voice.winPhrases.join(', ')}`);
    }
    if (voice.pipelineVocabulary.length > 0) {
      lines.push(`Domain terms: ${voice.pipelineVocabulary.join(', ')}`);
    }
    if (Object.keys(voice.commonShorthand).length > 0) {
      const pairs = Object.entries(voice.commonShorthand)
        .map(([k, v]) => `"${k}" → ${v}`)
        .join('; ');
      lines.push(`Shorthand: ${pairs}`);
    }
    lines.push(``, `Mirror these patterns where natural. Do not force them. The brief should sound like this team wrote it.`);
  }

  return lines.join('\n');
}

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
    frameLabel: 'On pace. Protect what is converting.',
  },
  early_above: {
    primaryTopics: ['q2_setup', 'rep_variance', 'expansion'],
    suppressTopics: ['q1_close_risk'],
    frameLabel: 'Ahead of pace. Protect margin and build Q2.',
  },
  mid_below: {
    primaryTopics: ['deal_reality', 'rep_coaching', 'forecast_prep', 'big_deals_at_risk'],
    suppressTopics: ['q2_setup'],
    frameLabel: 'Behind pace. Focus on what can close.',
  },
  mid_at: {
    primaryTopics: ['fragile_deals', 'q2_coverage', 'big_deals_at_risk'],
    suppressTopics: [],
    frameLabel: 'On pace. Protect what is real.',
  },
  mid_above: {
    primaryTopics: ['q2_setup', 'rep_variance', 'big_deals_at_risk', 'expansion'],
    suppressTopics: ['q1_close_risk'],
    frameLabel: 'Ahead of pace. Seed Q2 while closing Q1.',
  },
  late_below: {
    primaryTopics: ['recovery_path', 'closable_deals', 'board_narrative', 'big_deals_at_risk'],
    suppressTopics: ['q2_setup', 'rep_coaching'],
    frameLabel: 'Behind at week 10. Focus on what can close.',
  },
  late_at: {
    primaryTopics: ['protect_number', 'crm_hygiene', 'q2_coverage', 'big_deals_at_risk'],
    suppressTopics: [],
    frameLabel: 'On target. Protect the number and set up Q2.',
  },
  late_above: {
    primaryTopics: ['q2_setup', 'rep_variance', 'big_deals_at_risk', 'crm_hygiene'],
    suppressTopics: ['q1_close_risk', 'deal_hygiene'],
    frameLabel: 'Q1 is won. Build Q2 pipeline this week.',
  },
  end_below: {
    primaryTopics: ['damage_control', 'board_narrative', 'q2_story', 'closable_now'],
    suppressTopics: ['q2_setup', 'rep_coaching'],
    frameLabel: 'Final week. Close what can close.',
  },
  end_at: {
    primaryTopics: ['close_decisions', 'crm_hygiene', 'q2_story', 'board_narrative'],
    suppressTopics: [],
    frameLabel: 'Final week. Close and clean up CRM.',
  },
  end_above: {
    primaryTopics: ['q2_pipeline', 'crm_hygiene', 'rep_recognition', 'q2_story'],
    suppressTopics: ['q1_close_risk'],
    frameLabel: 'Final week. Q1 is won. Seed Q2.',
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
