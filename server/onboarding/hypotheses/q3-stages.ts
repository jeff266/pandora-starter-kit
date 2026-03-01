import type { CRMScanResult, InferenceResult, Hypothesis } from '../types.js';

function classify(
  stageName: string,
  wonStages: Set<string>,
  lostStages: Set<string>,
  stage0: string[],
  parkingLot: string[],
  unused: string[],
): string {
  const s = stageName.toLowerCase();
  if (wonStages.has(stageName)) return 'Won ✓';
  if (lostStages.has(stageName)) return 'Lost ✗';
  if (stage0.some(x => x.toLowerCase() === s)) return '⚠️ Pre-qual';
  if (parkingLot.some(x => x.toLowerCase() === s)) return '⚠️ Parking lot';
  if (unused.includes(stageName)) return '⚠️ No active deals';
  return 'Active';
}

export function generateStagesHypothesis(
  scan: CRMScanResult,
  inference: InferenceResult,
): Hypothesis {
  const stages = scan.stages ?? [];
  const wonLost = scan.won_lost ?? [];
  const stage0 = inference.stage_0_stages ?? [];
  const parkingLot = inference.parking_lot_stages ?? [];
  const unused = scan.unused_stages ?? [];

  const wonStages = new Set(
    wonLost.filter(s => s.stage?.toLowerCase().includes('won') || s.stage?.toLowerCase().includes('closed won')).map(s => s.stage)
  );
  const lostStages = new Set(
    wonLost.filter(s => s.stage?.toLowerCase().includes('lost') || s.stage?.toLowerCase().includes('closed lost')).map(s => s.stage)
  );

  if (stages.length === 0 && wonLost.length === 0) {
    return {
      summary: 'No stage data found yet. I\'ll classify stages as they appear.',
      confidence: 0.1,
      evidence: 'No stage data in CRM',
      suggested_value: { stage_configs: [] },
    };
  }

  const allStages = [...stages];
  const wonLostOnly = wonLost.filter(wl => !stages.some(s => s.stage === wl.stage));
  for (const wl of wonLostOnly) {
    allStages.push({ stage: wl.stage, deals: wl.count, avg_amount: 0, avg_days: null });
  }

  const tableRows = allStages.map(s => ({
    Stage: s.stage,
    Classification: classify(s.stage, wonStages, lostStages, stage0, parkingLot, unused),
    Deals: s.deals,
    'Avg Days': s.avg_days != null ? `${Math.round(s.avg_days)}d` : '—',
    'Avg Size': s.avg_amount > 0 ? `$${(s.avg_amount / 1000).toFixed(0)}K` : '—',
  }));

  const activeCount = tableRows.filter(r => r.Classification === 'Active').length;
  const parkingCount = tableRows.filter(r => r.Classification.includes('Parking')).length;
  const preQualCount = tableRows.filter(r => r.Classification.includes('Pre-qual')).length;

  let summary = `I found ${allStages.length} stages. `;
  const notes: string[] = [];
  if (activeCount > 0) notes.push(`${activeCount} active`);
  if (preQualCount > 0) notes.push(`${preQualCount} pre-qualification`);
  if (parkingCount > 0) notes.push(`${parkingCount} parking lot`);
  if (wonStages.size > 0) notes.push(`${wonStages.size} won`);
  if (lostStages.size > 0) notes.push(`${lostStages.size} lost`);
  summary += notes.join(', ') + '. Confirm the classifications below:';

  const confidence = stage0.length > 0 || parkingLot.length > 0 ? 0.75 : 0.6;

  return {
    summary,
    table: tableRows,
    columns: ['Stage', 'Classification', 'Deals', 'Avg Days', 'Avg Size'],
    confidence,
    evidence: `Stage distribution from ${allStages.reduce((s, r) => s + r.deals, 0)} total deals`,
    suggested_value: {
      won_stages: [...wonStages],
      lost_stages: [...lostStages],
      stage_0_stages: stage0,
      parking_lot_stages: parkingLot,
      retired_stages: unused,
    },
  };
}
