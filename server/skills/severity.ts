export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AlertThreshold = 'all' | 'watch_and_act' | 'act_only';

const SEVERITY_ORDER: Record<SeverityLevel, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const THRESHOLD_CUTOFF: Record<AlertThreshold, number> = {
  all: 1,
  watch_and_act: 3,
  act_only: 4,
};

export function classifySeverity(
  value: number,
  thresholds: { critical: number; high: number; medium: number }
): SeverityLevel {
  if (value >= thresholds.critical) return 'critical';
  if (value >= thresholds.high) return 'high';
  if (value >= thresholds.medium) return 'medium';
  return 'low';
}

export function meetsAlertThreshold(
  severity: SeverityLevel,
  threshold: AlertThreshold
): boolean {
  return SEVERITY_ORDER[severity] >= THRESHOLD_CUTOFF[threshold];
}

export interface SeverityFilterResult<T> {
  included: T[];
  filtered: number;
  threshold: AlertThreshold;
}

export function filterByAlertThreshold<T extends { severity?: string }>(
  items: T[],
  threshold: AlertThreshold,
  severityField: keyof T = 'severity' as keyof T
): SeverityFilterResult<T> {
  const included: T[] = [];
  let filtered = 0;

  for (const item of items) {
    const sev = (item[severityField] as string) || 'info';
    if (meetsAlertThreshold(sev as SeverityLevel, threshold)) {
      included.push(item);
    } else {
      filtered++;
    }
  }

  return { included, filtered, threshold };
}

export function severityToIndicator(severity: SeverityLevel): string {
  switch (severity) {
    case 'critical': return '[!!]';
    case 'high': return '[!]';
    case 'medium': return '[~]';
    case 'low': return '[-]';
    case 'info': return '[i]';
  }
}

export function compareSeverity(a: SeverityLevel, b: SeverityLevel): number {
  return SEVERITY_ORDER[b] - SEVERITY_ORDER[a];
}
