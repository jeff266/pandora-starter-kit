/**
 * TTE Survival Curve Engine — Kaplan-Meier Estimator
 *
 * Computes time-aware win probability curves from historical deal data.
 * Replaces the static Beta distribution model with a step-function that
 * penalizes stale deals and gives fresh deals realistic forward projections.
 */

export interface DealObservation {
  dealId: string;
  daysOpen: number;
  event: boolean;
  amount?: number;
  segment?: string;
}

export interface SurvivalStep {
  day: number;
  atRisk: number;
  events: number;
  censored: number;
  cumulativeWinRate: number;
  survival: number;
  standardError: number;
  ciLower: number;
  ciUpper: number;
}

export interface SurvivalCurve {
  steps: SurvivalStep[];
  segment: string | null;
  sampleSize: number;
  eventCount: number;
  censoredCount: number;
  medianTimeTilWon: number | null;
  terminalWinRate: number;
  isReliable: boolean;
  dataWindow: {
    from: Date;
    to: Date;
  };
}

export function emptyCurve(segment: string | null): SurvivalCurve {
  return {
    steps: [],
    segment,
    sampleSize: 0,
    eventCount: 0,
    censoredCount: 0,
    medianTimeTilWon: null,
    terminalWinRate: 0,
    isReliable: false,
    dataWindow: { from: new Date(), to: new Date() },
  };
}

export function computeKaplanMeier(
  observations: DealObservation[],
  segment?: string
): SurvivalCurve {
  if (observations.length === 0) {
    return emptyCurve(segment ?? null);
  }

  const sorted = [...observations].sort((a, b) => {
    if (a.daysOpen !== b.daysOpen) return a.daysOpen - b.daysOpen;
    return (b.event ? 1 : 0) - (a.event ? 1 : 0);
  });

  const steps: SurvivalStep[] = [];
  let atRisk = sorted.length;
  let survival = 1.0;
  let greenwoodSum = 0;
  let totalEvents = 0;
  let totalCensored = 0;

  steps.push({
    day: 0,
    atRisk,
    events: 0,
    censored: 0,
    cumulativeWinRate: 0,
    survival: 1.0,
    standardError: 0,
    ciLower: 0,
    ciUpper: 0,
  });

  let i = 0;
  while (i < sorted.length) {
    const currentDay = sorted[i].daysOpen;
    let eventsAtTime = 0;
    let censoredAtTime = 0;

    while (i < sorted.length && sorted[i].daysOpen === currentDay) {
      if (sorted[i].event) {
        eventsAtTime++;
        totalEvents++;
      } else {
        censoredAtTime++;
        totalCensored++;
      }
      i++;
    }

    if (eventsAtTime > 0 && atRisk > 0) {
      survival = survival * (1 - eventsAtTime / atRisk);

      if (atRisk > eventsAtTime) {
        greenwoodSum += eventsAtTime / (atRisk * (atRisk - eventsAtTime));
      }

      const standardError = survival * Math.sqrt(greenwoodSum);

      const z = 1.96;
      const safeSurvival = Math.max(survival, 0.001);
      const logSurvival = Math.log(-Math.log(safeSurvival));
      const logSE = standardError / (safeSurvival * Math.abs(Math.log(safeSurvival)));

      const ciSurvivalLower = Math.exp(-Math.exp(logSurvival + z * logSE));
      const ciSurvivalUpper = Math.exp(-Math.exp(logSurvival - z * logSE));

      steps.push({
        day: currentDay,
        atRisk,
        events: eventsAtTime,
        censored: censoredAtTime,
        cumulativeWinRate: 1 - survival,
        survival,
        standardError,
        ciLower: Math.max(0, 1 - ciSurvivalUpper),
        ciUpper: Math.min(1, 1 - ciSurvivalLower),
      });
    } else if (censoredAtTime > 0) {
      const lastStep = steps[steps.length - 1];
      steps.push({
        day: currentDay,
        atRisk,
        events: 0,
        censored: censoredAtTime,
        cumulativeWinRate: lastStep.cumulativeWinRate,
        survival: lastStep.survival,
        standardError: lastStep.standardError,
        ciLower: lastStep.ciLower,
        ciUpper: lastStep.ciUpper,
      });
    }

    atRisk -= (eventsAtTime + censoredAtTime);
  }

  const medianStep = steps.find(s => s.cumulativeWinRate >= 0.5);
  const medianTimeTilWon = medianStep ? medianStep.day : null;
  const lastStep = steps[steps.length - 1];

  return {
    steps,
    segment: segment ?? null,
    sampleSize: observations.length,
    eventCount: totalEvents,
    censoredCount: totalCensored,
    medianTimeTilWon,
    terminalWinRate: lastStep ? lastStep.cumulativeWinRate : 0,
    isReliable: observations.length >= 30 && totalEvents >= 10,
    dataWindow: { from: new Date(), to: new Date() },
  };
}

export function getCumulativeWinRateAtDay(curve: SurvivalCurve, day: number): number {
  let rate = 0;
  for (const step of curve.steps) {
    if (step.day <= day) {
      rate = step.cumulativeWinRate;
    } else {
      break;
    }
  }
  return rate;
}

function getSurvivalAtDay(curve: SurvivalCurve, day: number): { survival: number; ciLower: number; ciUpper: number } {
  let survival = 1.0;
  let ciLower = 0;
  let ciUpper = 0;
  for (const step of curve.steps) {
    if (step.day <= day) {
      survival = step.survival;
      ciLower = step.ciLower;
      ciUpper = step.ciUpper;
    } else {
      break;
    }
  }
  return { survival, ciLower, ciUpper };
}

export function conditionalWinProbability(
  curve: SurvivalCurve,
  dealAgeDays: number
): { probability: number; confidence: { lower: number; upper: number }; isExtrapolated: boolean } {
  if (curve.steps.length === 0) {
    return { probability: 0, confidence: { lower: 0, upper: 0 }, isExtrapolated: true };
  }

  const { survival: survivalAtAge } = getSurvivalAtDay(curve, dealAgeDays);

  if (survivalAtAge < 0.01) {
    return { probability: 0, confidence: { lower: 0, upper: 0 }, isExtrapolated: false };
  }

  const winRateAtAge = getCumulativeWinRateAtDay(curve, dealAgeDays);
  const lastStep = curve.steps[curve.steps.length - 1];
  const terminalWinRate = lastStep.cumulativeWinRate;

  const prob = Math.max(0, (terminalWinRate - winRateAtAge) / (1 - winRateAtAge));

  const ciLower = Math.max(0, (lastStep.ciLower - Math.min(lastStep.ciUpper, winRateAtAge + 0.01)) /
    (1 - Math.min(lastStep.ciUpper, winRateAtAge + 0.01)));
  const ciUpper = Math.min(1, (lastStep.ciUpper - Math.max(0, winRateAtAge - 0.01)) /
    (1 - Math.max(0, winRateAtAge - 0.01)));

  const isExtrapolated = dealAgeDays > lastStep.day;

  return {
    probability: prob,
    confidence: { lower: Math.max(0, ciLower), upper: Math.min(1, ciUpper) },
    isExtrapolated,
  };
}

export function expectedValueInWindow(
  curve: SurvivalCurve,
  dealAgeDays: number,
  daysUntilWindowEnd: number,
  dealAmount: number
): { expectedValue: number; winProbInWindow: number } {
  if (curve.steps.length === 0 || daysUntilWindowEnd <= 0) {
    return { expectedValue: 0, winProbInWindow: 0 };
  }

  const winRateAtAge = getCumulativeWinRateAtDay(curve, dealAgeDays);
  const winRateAtWindowEnd = getCumulativeWinRateAtDay(curve, dealAgeDays + daysUntilWindowEnd);
  const survivalAtAge = 1 - winRateAtAge;

  if (survivalAtAge < 0.01) {
    return { expectedValue: 0, winProbInWindow: 0 };
  }

  const winProbInWindow = (winRateAtWindowEnd - winRateAtAge) / survivalAtAge;
  const clamped = Math.max(0, winProbInWindow);
  const expectedValue = dealAmount * clamped;

  return { expectedValue, winProbInWindow: clamped };
}

export function assessDataTier(curve: SurvivalCurve): 1 | 2 | 3 | 4 {
  if (curve.eventCount < 20) return 1;
  if (curve.eventCount < 50) return 2;
  if (curve.eventCount < 200) return 3;
  return 4;
}
