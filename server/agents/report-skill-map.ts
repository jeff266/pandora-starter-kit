/**
 * Source of truth: which skills are required for each report type.
 * The scheduler reads this to determine what to run and when.
 * The Orchestrator reads this to know which skill_runs to summarize.
 */

export type ReportType =
  | 'monday_briefing'
  | 'weekly_business_review'
  | 'qbr'
  | 'board_deck';

export const REPORT_SKILL_MAP: Record<ReportType, string[]> = {
  monday_briefing: [
    'forecast-rollup',
    'pipeline-waterfall',
    'deal-risk-review',
    'rep-scorecard',
    'pipeline-hygiene',
    'single-thread-alert',
    'pipeline-coverage',
    'data-quality-audit',
    'weekly-recap',
  ],
  weekly_business_review: [
    'forecast-rollup',
    'pipeline-waterfall',
    'rep-scorecard',
    'pipeline-coverage',
    'weekly-recap',
  ],
  qbr: [
    'forecast-rollup',
    'pipeline-coverage',
    'rep-scorecard',
    'pipeline-hygiene',
    'data-quality-audit',
  ],
  board_deck: [
    'forecast-rollup',
    'pipeline-coverage',
    'rep-scorecard',
  ],
};

// How many hours before delivery to run skills.
// Skills run Sunday 11pm for Monday 5am delivery = 6 hour buffer.
export const SKILL_BUFFER_HOURS = 6;

// Default delivery: Monday 5am local workspace time
export const DEFAULT_DELIVERY_HOUR = 5;
export const DEFAULT_DELIVERY_DAY = 1; // 1 = Monday (node-cron convention)
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';
