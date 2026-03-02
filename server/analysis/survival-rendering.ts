/**
 * TTE Survival Rendering Layer
 *
 * Translates survival curves into formats consumable by Claude (LLM summaries)
 * and by planning conversations (cohort win matrices).
 */

import {
  SurvivalCurve,
  conditionalWinProbability,
  expectedValueInWindow,
  getCumulativeWinRateAtDay,
} from './survival-curve.js';

// ─── LLM Summary ─────────────────────────────────────────────────────────────

export function summarizeCurveForLLM(curve: SurvivalCurve): string {
  const lines: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const segLabel = curve.segment ? ` (${curve.segment})` : '';
  lines.push(`Win rate curve${segLabel}: ${curve.sampleSize} deals, ${curve.eventCount} wins, ${curve.censoredCount} open/lost`);

  if (!curve.isReliable) {
    lines.push(`⚠ LOW SAMPLE SIZE — confidence intervals are wide; use with caution`);
  }

  lines.push(`Cumulative win rate over time:`);
  const checkpoints = [30, 60, 90, 120, 180, 270, 365];
  for (const day of checkpoints) {
    const rate = getCumulativeWinRateAtDay(curve, day);
    if (rate > 0) {
      lines.push(`  By day ${day}: ${pct(rate)} cumulative win rate`);
    }
  }

  lines.push(`  Terminal win rate: ${pct(curve.terminalWinRate)}`);

  if (curve.medianTimeTilWon !== null) {
    lines.push(`  Median time to win: ${curve.medianTimeTilWon} days`);
  } else {
    lines.push(`  Median time to win: not reached in observed data`);
  }

  lines.push(`Forward-looking probability for open deals (conditional on survival to date):`);
  for (const age of [0, 30, 60, 90, 180]) {
    const { probability, isExtrapolated } = conditionalWinProbability(curve, age);
    if (probability > 0.01) {
      const extraTag = isExtrapolated ? ' [extrapolated]' : '';
      lines.push(`  Deal open ${age} days: ${pct(probability)} chance of winning from here${extraTag}`);
    }
  }

  return lines.join('\n');
}

// ─── Cohort Win Matrix ────────────────────────────────────────────────────────

export interface Deal {
  id: string;
  amount: number;
  createdAt: Date;
  closedAt?: Date | null;
  isClosedWon: boolean;
  isClosed: boolean;
}

export interface CohortQuarter {
  label: string;
  wonCount: number;
  wonValue: number;
  cumulativeWonValue: number;
  cumulativeWinRate: number;
}

export interface CohortRow {
  label: string;
  periodStart: Date;
  periodEnd: Date;
  totalCreated: number;
  totalCreatedValue: number;
  isMature: boolean;
  quarters: CohortQuarter[];
}

export interface CohortWinMatrix {
  cohorts: CohortRow[];
  projectedConversion: {
    cohortLabel: string;
    currentWonValue: number;
    projectedTotalWonValue: number;
    projectedWinRate: number;
  } | null;
}

function getPeriodLabel(date: Date, cadence: 'quarterly' | 'monthly', fiscalYearStart: number): string {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  if (cadence === 'monthly') {
    return `${date.toLocaleString('default', { month: 'short' })} ${year}`;
  }

  const fiscalOffset = ((month - fiscalYearStart + 12) % 12);
  const quarter = Math.floor(fiscalOffset / 3) + 1;
  const fiscalYear = fiscalOffset < (12 - ((fiscalYearStart - 1) % 12)) ? year : year + 1;
  return `Q${quarter} FY${String(fiscalYear).slice(-2)}`;
}

function getPeriodStart(date: Date, cadence: 'quarterly' | 'monthly', fiscalYearStart: number): Date {
  if (cadence === 'monthly') {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
  const month = date.getMonth() + 1;
  const fiscalOffset = ((month - fiscalYearStart + 12) % 12);
  const quarterStartMonth = ((Math.floor(fiscalOffset / 3) * 3 + fiscalYearStart - 1) % 12) + 1;
  return new Date(date.getFullYear(), quarterStartMonth - 1, 1);
}

function addPeriods(date: Date, n: number, cadence: 'quarterly' | 'monthly'): Date {
  const d = new Date(date);
  if (cadence === 'monthly') {
    d.setMonth(d.getMonth() + n);
  } else {
    d.setMonth(d.getMonth() + n * 3);
  }
  return d;
}

export function buildCohortWinMatrix(
  deals: Deal[],
  curve: SurvivalCurve,
  cadence: 'quarterly' | 'monthly',
  fiscalYearStart: number
): CohortWinMatrix {
  if (deals.length === 0) {
    return { cohorts: [], projectedConversion: null };
  }

  const now = new Date();
  const periodDays = cadence === 'monthly' ? 30 : 91;
  const maturityThreshold = periodDays * 4;

  const cohortMap = new Map<string, {
    label: string;
    periodStart: Date;
    periodEnd: Date;
    deals: Deal[];
  }>();

  for (const deal of deals) {
    const periodStart = getPeriodStart(deal.createdAt, cadence, fiscalYearStart);
    const label = getPeriodLabel(deal.createdAt, cadence, fiscalYearStart);

    if (!cohortMap.has(label)) {
      cohortMap.set(label, {
        label,
        periodStart,
        periodEnd: addPeriods(periodStart, 1, cadence),
        deals: [],
      });
    }
    cohortMap.get(label)!.deals.push(deal);
  }

  const sortedCohorts = Array.from(cohortMap.values()).sort(
    (a, b) => a.periodStart.getTime() - b.periodStart.getTime()
  );

  const allPeriodLabels = ['Q0', 'Q+1', 'Q+2', 'Q+3', 'Q+4'];

  const cohorts: CohortRow[] = [];
  let currentCohortProjection: CohortWinMatrix['projectedConversion'] = null;

  for (const cohort of sortedCohorts) {
    const ageOfCohortDays = (now.getTime() - cohort.periodStart.getTime()) / (1000 * 60 * 60 * 24);
    const isMature = ageOfCohortDays > maturityThreshold;
    const totalCreated = cohort.deals.length;
    const totalCreatedValue = cohort.deals.reduce((s, d) => s + d.amount, 0);

    const quarters: CohortQuarter[] = [];
    let cumulativeWon = 0;
    let cumulativeWonValue = 0;

    for (let qi = 0; qi < allPeriodLabels.length; qi++) {
      const periodStartDate = addPeriods(cohort.periodStart, qi, cadence);
      const periodEndDate = addPeriods(cohort.periodStart, qi + 1, cadence);

      const wonInPeriod = cohort.deals.filter(d =>
        d.isClosedWon && d.closedAt &&
        d.closedAt >= periodStartDate && d.closedAt < periodEndDate
      );

      const wonCount = wonInPeriod.length;
      const wonValue = wonInPeriod.reduce((s, d) => s + d.amount, 0);
      cumulativeWon += wonCount;
      cumulativeWonValue += wonValue;

      const cumulativeWinRate = totalCreatedValue > 0 ? cumulativeWonValue / totalCreatedValue : 0;

      quarters.push({
        label: allPeriodLabels[qi],
        wonCount,
        wonValue,
        cumulativeWonValue,
        cumulativeWinRate,
      });

      if (periodEndDate > now) break;
    }

    cohorts.push({
      label: cohort.label,
      periodStart: cohort.periodStart,
      periodEnd: cohort.periodEnd,
      totalCreated,
      totalCreatedValue,
      isMature,
      quarters,
    });

    if (!isMature && ageOfCohortDays > 0) {
      const currentWonValue = cohort.deals
        .filter(d => d.isClosedWon)
        .reduce((s, d) => s + d.amount, 0);

      const daysRemainingForCurve = Math.max(0, maturityThreshold - ageOfCohortDays);

      let projectedAdditional = 0;
      for (const deal of cohort.deals.filter(d => !d.isClosed)) {
        const dealAge = (now.getTime() - deal.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        const { expectedValue } = expectedValueInWindow(curve, dealAge, daysRemainingForCurve, deal.amount);
        projectedAdditional += expectedValue;
      }

      const projectedTotalWonValue = currentWonValue + projectedAdditional;
      const projectedWinRate = totalCreatedValue > 0 ? projectedTotalWonValue / totalCreatedValue : 0;

      currentCohortProjection = {
        cohortLabel: cohort.label,
        currentWonValue,
        projectedTotalWonValue,
        projectedWinRate,
      };
    }
  }

  return {
    cohorts,
    projectedConversion: currentCohortProjection,
  };
}
