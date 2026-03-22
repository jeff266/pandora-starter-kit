/**
 * Hypothesis Units Validation
 *
 * Enforces unit consistency and detects common errors in hypothesis metrics.
 * Ratio storage convention: ALWAYS store as 0-1, display ×100 for percentages.
 */

export type HypothesisUnit =
  | '$'
  | 'x'
  | '%'
  | 'days'
  | 'count'
  | 'multiple';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  corrected?: {
    unit?: HypothesisUnit;
    current_value?: number;
    alert_threshold?: number;
  };
}

/**
 * Validate hypothesis units and detect common errors.
 * Returns validation result with errors, warnings, and auto-corrections.
 */
export function validateHypothesisUnits(hypothesis: {
  metric: string;
  metric_key?: string;
  current_value?: number;
  alert_threshold?: number;
  unit: string;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const corrected: any = {};

  const validUnits: HypothesisUnit[] = ['$', 'x', '%', 'days', 'count', 'multiple'];

  // Rule 1: unit must be one of the valid HypothesisUnit values
  if (!validUnits.includes(hypothesis.unit as HypothesisUnit)) {
    errors.push(
      `Unknown unit '${hypothesis.unit}'. Valid units: ${validUnits.join(', ')}`
    );
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  // Rule 2: Ratio detection — if unit is '%' and current_value > 1
  if (hypothesis.unit === '%' && hypothesis.current_value !== undefined) {
    if (hypothesis.current_value > 1) {
      warnings.push(
        `current_value ${hypothesis.current_value} looks like a percentage stored as a whole number (e.g. 35.6 instead of 0.356). Per convention, ratios must be stored as 0-1.`
      );
      corrected.current_value = hypothesis.current_value / 100;
    }
  }

  // Rule 3: Ratio detection for threshold — same check on alert_threshold
  if (hypothesis.unit === '%' && hypothesis.alert_threshold !== undefined) {
    if (hypothesis.alert_threshold > 1) {
      warnings.push(
        `alert_threshold ${hypothesis.alert_threshold} looks like a percentage stored as a whole number. Per convention, ratios must be stored as 0-1.`
      );
      corrected.alert_threshold = hypothesis.alert_threshold / 100;
    }
  }

  // Rule 4: Currency sanity — if unit is '$' and current_value < 0
  if (hypothesis.unit === '$' && hypothesis.current_value !== undefined) {
    if (hypothesis.current_value < 0) {
      warnings.push(
        `Negative currency value — is this intentional?`
      );
    }
  }

  // Rule 5: Multiplier sanity — if unit is 'x' and current_value > 20
  if (hypothesis.unit === 'x' && hypothesis.current_value !== undefined) {
    if (hypothesis.current_value > 20) {
      warnings.push(
        `${hypothesis.current_value}x seems high for a coverage or multiplier metric.`
      );
    }
  }

  // Rule 6: Count sanity — if unit is 'count' and current_value is a decimal between 0 and 1
  if (hypothesis.unit === 'count' && hypothesis.current_value !== undefined) {
    if (hypothesis.current_value > 0 && hypothesis.current_value < 1) {
      warnings.push(
        `count unit with value ${hypothesis.current_value} — did you mean '%' or 'x'?`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    corrected: Object.keys(corrected).length > 0 ? corrected : undefined,
  };
}
