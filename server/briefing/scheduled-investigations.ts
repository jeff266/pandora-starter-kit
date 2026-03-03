/**
 * Scheduled Investigation Configuration
 *
 * Defines which investigations run automatically on cron schedules
 */

export interface ScheduledInvestigation {
  skillId: string;
  cronExpression: string;  // e.g., '0 8 * * *' = daily 8am UTC
  priority: 'high' | 'medium' | 'low';
  name: string;
  description: string;
}

export const SCHEDULED_INVESTIGATIONS: ScheduledInvestigation[] = [
  {
    skillId: 'deal-risk-review',
    cronExpression: process.env.NODE_ENV === 'development'
      ? '*/5 * * * *'  // Every 5 minutes in dev for testing
      : '0 8 * * *',   // Daily 8am UTC in production
    priority: 'high',
    name: 'Daily Deal Risk Review',
    description: 'Check for deals at risk of slipping'
  },
  {
    skillId: 'data-quality-audit',
    cronExpression: process.env.NODE_ENV === 'development'
      ? '*/10 * * * *'  // Every 10 minutes in dev
      : '0 9 * * 1',    // Monday 9am UTC in production
    priority: 'medium',
    name: 'Weekly Data Quality Audit',
    description: 'Verify data quality and completeness'
  },
  {
    skillId: 'forecast-rollup',
    cronExpression: process.env.NODE_ENV === 'development'
      ? '*/7 * * * *'  // Every 7 minutes in dev
      : '0 7 * * 1',   // Monday 7am UTC in production
    priority: 'high',
    name: 'Weekly Forecast Rollup',
    description: 'Calculate realistic forecast range'
  }
];
