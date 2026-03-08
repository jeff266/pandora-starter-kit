/**
 * Quarterly Retrospective — Phase 0: Evidence Harvest
 *
 * Pure SQL reads against skill_runs — zero LLM calls, zero tokens.
 * Extracts cached evidence from the 7 diagnostic skills and assigns
 * freshness labels used to weight Phase 1 hypothesis confidence.
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

/**
 * Extract a human-readable headline and top signals from a skill's output blob.
 * The output structure varies per skill; we try several known shapes.
 */
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

  // Try command_center payload (rendered output)
  const cc = output.command_center || output.commandCenter;
  if (cc) {
    headline = cc.summary || cc.headline || cc.narrative || '';
    if (cc.findings?.length) {
      signals.push(...cc.findings.slice(0, 3).map((f: any) => f.message || f.claim_text || '').filter(Boolean));
    }
    if (cc.stats?.data_quality_tier) quality = cc.stats.data_quality_tier;
  }

  // Try top-level narrative / summary
  if (!headline) {
    headline = output.narrative || output.summary || output.headline || output.overview || '';
  }

  // Try claims array
  if (!signals.length && output.claims?.length) {
    signals.push(...output.claims.slice(0, 3).map((c: any) => c.claim_text || c.message || '').filter(Boolean));
  }

  // Try findings / anomalies
  if (!signals.length && output.findings?.length) {
    signals.push(...output.findings.slice(0, 3).map((f: any) => f.message || f.description || '').filter(Boolean));
  }

  // Try skill-specific shapes
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
      case 'rep-scorecard': {
        headline = output.label || 'Rep scorecard generated';
        break;
      }
      case 'icp-discovery': {
        headline = output.label || 'ICP segment analysis completed';
        break;
      }
      case 'conversation-intelligence': {
        headline = output.label || 'Conversation intelligence analyzed';
        break;
      }
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

  // Fallback headline
  if (!headline) headline = `${skillId} run completed`;

  // Data quality tier
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
  const month = now.getMonth(); // 0-indexed
  const q = Math.floor(month / 3) + 1;

  // Return the PREVIOUS completed quarter
  let prevQ = q - 1;
  let prevYear = year;
  if (prevQ < 1) {
    prevQ = 4;
    prevYear = year - 1;
  }

  const qStartMonth = (prevQ - 1) * 3;
  const start = new Date(prevYear, qStartMonth, 1);
  const end = new Date(prevYear, qStartMonth + 3, 0, 23, 59, 59);

  return {
    label: `Q${prevQ} ${prevYear}`,
    start,
    end,
  };
}

// ─── Main harvest function ────────────────────────────────────────────────────

export async function harvestEvidence(
  workspaceId: string,
  _quarterStart?: Date,
  _quarterEnd?: Date
): Promise<HarvestedEvidence[]> {
  // Fetch most recent completed run per skill within the max window (90 days)
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

  // Build a map of what we found
  const found = new Map<string, { id: string; started_at: string; output: any }>();
  for (const row of result.rows) {
    found.set(row.skill_id, { id: row.id, started_at: row.started_at, output: row.output });
  }

  // Build evidence for every required skill (including missing ones)
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

    // Respect skill-specific freshness window for "stale" determination
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
