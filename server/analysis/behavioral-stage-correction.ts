import { query } from '../db.js';

export interface BehavioralCorrection {
  dealId: string;
  dealName: string;
  dealAmount: number;
  ownerEmail: string;

  crmStage: string;
  crmStageNormalized: string;
  crmCloseProb: number;
  crmExpectedValue: number;

  behavioralStage: string;
  behavioralStageNormalized: string;
  behavioralCloseProb: number;
  behavioralExpectedValue: number;

  evDelta: number;
  direction: 'understated' | 'overstated';
  divergenceSignals: string[];
  divergenceConfidence: number;
}

export interface BehavioralAdjustedEV {
  bearingValue: number;
  totalEvDelta: number;
  corrections: BehavioralCorrection[];
  topCorrections: BehavioralCorrection[];   // top 3 by |evDelta|, pre-sorted for templates

  understatedDeals: number;
  overstatedDeals: number;
  correctedDealCount: number;
  uncorrectedDealCount: number;

  divergenceSkillAge: number;
  isStale: boolean;
}

const STAGE_WEIGHTS: Record<string, number> = {
  prospecting: 0.05,
  qualification: 0.10,
  needs_analysis: 0.20,
  value_proposition: 0.30,
  proposal: 0.60,
  negotiation: 0.75,
  commit: 0.85,
  verbal_commit: 0.90,
};

function normalizeStage(stage: string): string {
  return stage.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

export async function computeBehavioralAdjustedEV(
  workspaceId: string,
  openDeals: { id: string; name: string; amount: number; stageNormalized: string; ownerEmail: string }[],
  stageCloseProbabilities: Record<string, number>
): Promise<BehavioralAdjustedEV> {

  const divergenceRun = await query<{ result: any; started_at: string }>(
    `SELECT result, started_at
     FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id = 'stage-mismatch-detector'
       AND status = 'completed'
     ORDER BY started_at DESC
     LIMIT 1`,
    [workspaceId]
  );

  const crmStageEV = (deals: typeof openDeals) =>
    deals.reduce((sum, deal) => {
      const prob = stageCloseProbabilities[deal.stageNormalized] ?? STAGE_WEIGHTS[deal.stageNormalized] ?? 0.25;
      return sum + deal.amount * prob;
    }, 0);

  if (divergenceRun.rows.length === 0) {
    return {
      bearingValue: Math.round(crmStageEV(openDeals)),
      totalEvDelta: 0,
      corrections: [],
      topCorrections: [],
      understatedDeals: 0,
      overstatedDeals: 0,
      correctedDealCount: 0,
      uncorrectedDealCount: openDeals.length,
      divergenceSkillAge: Infinity,
      isStale: true,
    };
  }

  const runRow = divergenceRun.rows[0];
  const resultData = runRow.result ?? {};
  const runAgeHours = (Date.now() - new Date(runRow.started_at).getTime()) / 3_600_000;

  // stage-mismatch-detector stores step outputs under outputKey — 'stage_classifications'
  const rawClassifications: any[] = resultData?.stage_classifications ?? [];

  // Normalise to a canonical shape, handling partial runs gracefully
  const divergentDeals = rawClassifications
    .filter((c: any) => typeof c === 'object' && c !== null && (c.confidence ?? 0) >= 60)
    .map((c: any) => ({
      dealId: String(c.dealId ?? c.deal_id ?? ''),
      dealName: String(c.dealName ?? c.deal_name ?? ''),
      crmStageNormalized: String(c.current_stage_normalized ?? c.crmStage ?? ''),
      behavioralStageNormalized: normalizeStage(String(c.recommended_stage_normalized ?? c.behavioralStage ?? '')),
      signals: (c.key_signals ?? c.signals ?? []) as string[],
      confidence: Number(c.confidence) / 100,
    }));

  const divergenceMap = new Map(divergentDeals.map(d => [d.dealId, d]));

  const corrections: BehavioralCorrection[] = [];
  let bearingValue = 0;
  let totalEvDelta = 0;

  for (const deal of openDeals) {
    const crmProb = stageCloseProbabilities[deal.stageNormalized] ?? STAGE_WEIGHTS[deal.stageNormalized] ?? 0.25;
    const crmEV = deal.amount * crmProb;
    const divergence = divergenceMap.get(deal.id);

    if (divergence && divergence.confidence >= 0.60) {
      const behavioralProb =
        stageCloseProbabilities[divergence.behavioralStageNormalized] ??
        STAGE_WEIGHTS[divergence.behavioralStageNormalized] ??
        crmProb;
      const behavioralEV = deal.amount * behavioralProb;
      const evDelta = behavioralEV - crmEV;

      corrections.push({
        dealId: deal.id,
        dealName: deal.name,
        dealAmount: deal.amount,
        ownerEmail: deal.ownerEmail,
        crmStage: divergence.crmStageNormalized,
        crmStageNormalized: deal.stageNormalized,
        crmCloseProb: crmProb,
        crmExpectedValue: crmEV,
        behavioralStage: divergence.behavioralStageNormalized,
        behavioralStageNormalized: divergence.behavioralStageNormalized,
        behavioralCloseProb: behavioralProb,
        behavioralExpectedValue: behavioralEV,
        evDelta,
        direction: evDelta > 0 ? 'understated' : 'overstated',
        divergenceSignals: divergence.signals,
        divergenceConfidence: divergence.confidence,
      });

      bearingValue += behavioralEV;
      totalEvDelta += evDelta;
    } else {
      bearingValue += crmEV;
    }
  }

  const correctedIds = new Set(corrections.map(c => c.dealId));
  const topCorrections = [...corrections]
    .sort((a, b) => Math.abs(b.evDelta) - Math.abs(a.evDelta))
    .slice(0, 3);

  return {
    bearingValue: Math.round(bearingValue),
    totalEvDelta: Math.round(totalEvDelta),
    corrections,
    topCorrections,
    understatedDeals: corrections.filter(c => c.direction === 'understated').length,
    overstatedDeals: corrections.filter(c => c.direction === 'overstated').length,
    correctedDealCount: corrections.length,
    uncorrectedDealCount: openDeals.filter(d => !correctedIds.has(d.id)).length,
    divergenceSkillAge: Math.round(runAgeHours * 10) / 10,
    isStale: runAgeHours > 48,
  };
}
