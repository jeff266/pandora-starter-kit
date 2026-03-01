import { BriefType, EditorialFocus, TheNumber, WhatChanged, Reps, DealsToWatch, RepPerformance, DealToWatch } from './brief-types.js';
import { daysRemainingInQuarter } from './brief-utils.js';

export function determineBriefType(now: Date): BriefType {
  const daysRemaining = daysRemainingInQuarter(now);
  if (daysRemaining <= 14) return 'quarter_close';

  const day = now.getUTCDay();
  if (day === 1) return 'monday_setup';
  if (day === 5) return 'friday_recap';
  return 'pulse';
}

export function determineEditorialFocus(
  briefType: BriefType,
  theNumber: TheNumber,
  whatChanged: WhatChanged,
  reps: Reps,
  deals: DealsToWatch,
  daysRemaining: number
): EditorialFocus {
  if (briefType === 'quarter_close') {
    return {
      primary: 'attainment_countdown',
      open_sections: ['the_number', 'deals_to_watch'],
      suppress: ['segments'],
      reason: `${daysRemaining} days left in quarter`
    };
  }

  // Attainment < 65% AND daysRemaining < 56 (8 weeks)
  if (theNumber.attainment_pct < 65 && daysRemaining < 56) {
    return {
      primary: 'attainment_risk',
      open_sections: ['the_number', 'deals_to_watch'],
      suppress: ['segments'],
      reason: `Attainment at ${theNumber.attainment_pct.toFixed(0)}% with ${Math.ceil(daysRemaining / 7)} weeks left`
    };
  }

  // Pipeline negative 3+ consecutive weeks
  if (whatChanged.streak && (whatChanged.streak.includes('3rd') || whatChanged.streak.includes('4th') || parseInt(whatChanged.streak) >= 3)) {
    return {
      primary: 'pipeline_decline',
      open_sections: ['what_changed', 'reps'],
      suppress: [],
      reason: whatChanged.streak
    };
  }

  // 2+ reps with escalation_level >= 2
  const failingReps = reps.items.filter((r: RepPerformance) => r.escalation_level >= 2);
  if (failingReps.length >= 2) {
    return {
      primary: 'rep_coaching',
      open_sections: ['reps'],
      suppress: [],
      highlight_reps: failingReps.map((r: RepPerformance) => r.email),
      reason: `${failingReps.length} reps need attention`
    };
  }

  // Critical signal deals >$50K
  const riskyDeals = deals.items.filter((d: DealToWatch) => d.severity === 'critical' && d.amount > 50000);
  if (riskyDeals.length > 0) {
    return {
      primary: 'deal_risk',
      open_sections: ['deals_to_watch'],
      suppress: [],
      highlight_deals: riskyDeals.map((d: DealToWatch) => d.name),
      reason: `${riskyDeals.length} at-risk deal(s) above $50K`
    };
  }

  return {
    primary: 'overview',
    open_sections: [],
    suppress: [],
    reason: 'No critical signals'
  };
}
