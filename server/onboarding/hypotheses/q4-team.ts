import type { CRMScanResult, InferenceResult, Hypothesis } from '../types.js';

const NON_REP_PATTERNS = [
  /admin/i, /ops/i, /operation/i, /system/i, /import/i, /hubspot/i, /salesforce/i,
  /sfdc/i, /migration/i, /integration/i, /api/i, /test/i, /demo/i, /sandbox/i,
];

function isLikelyNonRep(name: string): boolean {
  return NON_REP_PATTERNS.some(p => p.test(name));
}

export function generateTeamHypothesis(
  scan: CRMScanResult,
  inference: InferenceResult,
): Hypothesis {
  const owners = scan.owners ?? [];
  const newOwners = scan.new_owners ?? [];
  const excludedByInference = new Set(inference.rep_patterns?.excluded_owners ?? []);

  if (owners.length === 0) {
    return {
      summary: 'No deal owners found yet.',
      confidence: 0.1,
      evidence: 'No deal owners in CRM',
      suggested_value: { reps: [], excluded_owners: [] },
    };
  }

  const ninety_days_ago = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const classified = owners.map(owner => {
    const isNew = newOwners.includes(owner.owner_name);
    const isExcludedByName = isLikelyNonRep(owner.owner_name);
    const isExcludedByInference = excludedByInference.has(owner.owner_name);
    const isRecentlyActive = owner.last_deal_created != null && owner.last_deal_created > ninety_days_ago;
    const isLowVolume = owner.deal_count <= 2;

    let classification: string;
    if (isExcludedByName || isExcludedByInference) {
      classification = 'System/Admin';
    } else if (isNew) {
      classification = 'New Hire';
    } else if (isLowVolume && !isRecentlyActive) {
      classification = 'Likely Non-Rep';
    } else {
      classification = 'Rep';
    }

    return {
      Name: owner.owner_name,
      Classification: classification,
      Deals: owner.deal_count,
      'Last Active': owner.last_deal_created ? owner.last_deal_created.slice(0, 7) : '—',
    };
  });

  const reps = classified.filter(c => c.Classification === 'Rep' || c.Classification === 'New Hire');
  const nonReps = classified.filter(c => c.Classification !== 'Rep' && c.Classification !== 'New Hire');
  const newHires = classified.filter(c => c.Classification === 'New Hire');

  let summary = `Found ${owners.length} deal owners. I'm suggesting ${reps.length} as active reps`;
  if (newHires.length > 0) summary += ` (including ${newHires.length} new hire${newHires.length > 1 ? 's' : ''})`;
  if (nonReps.length > 0) summary += ` and ${nonReps.length} system/admin to exclude from quotas`;
  summary += '.';

  return {
    summary,
    table: classified,
    columns: ['Name', 'Classification', 'Deals', 'Last Active'],
    confidence: 0.7,
    evidence: `${owners.length} deal owners from CRM; ${newOwners.length} are new in the last 30 days`,
    suggested_value: {
      reps: reps.map(r => ({ name: r.Name, is_new_hire: r.Classification === 'New Hire' })),
      excluded_owners: nonReps.map(r => r.Name),
    },
  };
}
