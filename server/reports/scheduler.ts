// Report Scheduler - Cron-based generation triggers

import { DateTime } from 'luxon';
import { query } from '../db.js';
import { ReportTemplate, GenerateReportRequest } from './types.js';
import { generateReport } from './generator.js';
import { deliverReport } from './deliver.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ReportScheduler');

/**
 * Check for due reports and trigger generation
 * Runs every minute via cron
 */
export async function checkScheduledReports(): Promise<void> {
  try {
    // Find reports that are:
    // 1. Active (is_active = true)
    // 2. Not manual-only (cadence != 'manual')
    // 3. Due now (next_due_at <= NOW())
    // 4. Not recently generated (prevent double-fire within 1 hour)
    const dueReports = await query<ReportTemplate>(
      `SELECT rt.*, w.timezone as workspace_timezone, w.name as workspace_name, w.branding
       FROM report_templates rt
       JOIN workspaces w ON w.id = rt.workspace_id
       WHERE rt.is_active = true
         AND rt.cadence != 'manual'
         AND rt.next_due_at IS NOT NULL
         AND rt.next_due_at <= NOW()
         AND (rt.last_generated_at IS NULL
              OR rt.last_generated_at < NOW() - INTERVAL '1 hour')
       ORDER BY rt.next_due_at ASC
       LIMIT 50`,
      []
    );

    if (dueReports.rows.length === 0) {
      return;
    }

    logger.info(`Found ${dueReports.rows.length} due report(s)`);

    for (const report of dueReports.rows) {
      try {
        await triggerScheduledReport(report);
      } catch (err) {
        logger.error(`Failed to trigger report ${report.id}`, err instanceof Error ? err : undefined);
      }
    }
  } catch (err) {
    logger.error('Scheduler check failed', err instanceof Error ? err : undefined);
  }
}

async function triggerScheduledReport(report: ReportTemplate & { workspace_timezone?: string; workspace_name?: string; branding?: any }): Promise<void> {
  logger.info('Triggering scheduled report', {
    report_id: report.id,
    report_name: report.name,
    workspace_id: report.workspace_id,
  });

  // Mark as in-progress immediately to prevent double-fire
  await query(
    `UPDATE report_templates
     SET last_generated_at = NOW(),
         last_generation_status = 'running',
         updated_at = NOW()
     WHERE id = $1`,
    [report.id]
  );

  try {
    // Generate report
    const request: GenerateReportRequest = {
      workspace_id: report.workspace_id,
      report_template_id: report.id,
      triggered_by: 'schedule',
      preview_only: false,
    };

    const generation = await generateReport(request);

    // Deliver to all configured channels
    await deliverReport(generation, report, {
      workspace_id: report.workspace_id,
      workspace_name: report.workspace_name || 'Workspace',
      branding: report.branding,
    });

    // Calculate next due date
    const nextDue = calculateNextDue(report);

    // Update status and next_due_at
    await query(
      `UPDATE report_templates
       SET last_generation_status = 'success',
           last_generation_error = NULL,
           next_due_at = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [nextDue.toISO(), report.id]
    );

    logger.info('Scheduled report completed successfully', {
      report_id: report.id,
      generation_id: generation.id,
      next_due: nextDue.toISO(),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    // Check for consecutive failures
    const failureCount = await incrementFailureCount(report.id);

    // Auto-disable after 3 consecutive failures
    const shouldDisable = failureCount >= 3;

    await query(
      `UPDATE report_templates
       SET last_generation_status = 'failed',
           last_generation_error = $1,
           is_active = CASE WHEN $2 THEN false ELSE is_active END,
           updated_at = NOW()
       WHERE id = $3`,
      [errorMessage, shouldDisable, report.id]
    );

    if (shouldDisable) {
      logger.error(`Report ${report.id} auto-disabled after 3 consecutive failures: ${errorMessage}`);
      // TODO: Notify workspace admin
    } else {
      logger.error(`Scheduled report ${report.id} failed (attempt ${failureCount}): ${errorMessage}`);
    }

    throw err;
  }
}

/**
 * Calculate next due date based on cadence and timezone
 */
export function calculateNextDue(template: ReportTemplate & { workspace_timezone?: string }): DateTime {
  const timezone = template.timezone || template.workspace_timezone || 'America/Los_Angeles';
  const time = template.schedule_time || '07:00';
  const [hour, minute] = time.split(':').map(Number);

  const now = DateTime.now().setZone(timezone);

  switch (template.cadence) {
    case 'daily': {
      // Next occurrence of schedule_time today or tomorrow
      let next = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (next <= now) {
        next = next.plus({ days: 1 });
      }
      return next;
    }

    case 'weekly': {
      // Next occurrence of schedule_day + schedule_time
      const targetDay = template.schedule_day ?? 1; // Default to Monday
      let next = now.set({ hour, minute, second: 0, millisecond: 0 });

      // Find next occurrence of target weekday
      while (next.weekday !== targetDay || next <= now) {
        next = next.plus({ days: 1 });
      }
      return next;
    }

    case 'biweekly': {
      // Every other week, same day + time
      const targetDay = template.schedule_day ?? 1; // Default to Monday
      let next = now.set({ hour, minute, second: 0, millisecond: 0 });

      // Find next occurrence of target weekday
      while (next.weekday !== targetDay || next <= now) {
        next = next.plus({ days: 1 });
      }

      // Check if we need to skip a week (biweekly pattern)
      if (template.last_generated_at) {
        const lastGen = DateTime.fromISO(template.last_generated_at, { zone: timezone });
        const daysSinceLastGen = next.diff(lastGen, 'days').days;

        // If less than 10 days since last generation, skip to next biweekly occurrence
        if (daysSinceLastGen < 10) {
          next = next.plus({ weeks: 1 });
        }
      }

      return next;
    }

    case 'monthly': {
      // schedule_day_of_month (1-28) + schedule_time
      const dayOfMonth = template.schedule_day_of_month ?? 1;
      let next = now.set({ day: dayOfMonth, hour, minute, second: 0, millisecond: 0 });

      if (next <= now) {
        next = next.plus({ months: 1 });
      }

      // Handle months with fewer days (e.g., Feb 30 → Feb 28)
      if (next.day !== dayOfMonth) {
        next = next.set({ day: next.daysInMonth });
      }

      return next;
    }

    case 'quarterly': {
      // First day of next quarter + schedule_time
      const currentQuarter = Math.ceil(now.month / 3);
      const nextQuarterMonth = (currentQuarter % 4) * 3 + 1; // 1, 4, 7, 10

      let next = now.set({ month: nextQuarterMonth, day: 1, hour, minute, second: 0, millisecond: 0 });

      if (next <= now) {
        next = next.plus({ months: 3 });
        next = next.set({ day: 1 });
      }

      return next;
    }

    default:
      throw new Error(`Unknown cadence: ${template.cadence}`);
  }
}

/**
 * Track consecutive failures for auto-disable logic
 */
async function incrementFailureCount(reportId: string): Promise<number> {
  // Check last generation status
  const result = await query<{ last_generation_status: string }>(
    `SELECT last_generation_status FROM report_templates WHERE id = $1`,
    [reportId]
  );

  const lastStatus = result.rows[0]?.last_generation_status;

  // If last status was also failed, increment counter (stored in metadata or separate table)
  // For simplicity, we'll count recent failures in report_generations table
  const failureResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM report_generations
     WHERE report_template_id = $1
       AND error_message IS NOT NULL
       AND created_at > NOW() - INTERVAL '7 days'
     ORDER BY created_at DESC
     LIMIT 10`,
    [reportId]
  );

  return parseInt(failureResult.rows[0]?.count || '0') + 1;
}

/**
 * Initialize next_due_at for all active reports that don't have it set
 */
export async function initializeScheduledReports(): Promise<void> {
  try {
    const reports = await query<ReportTemplate>(
      `SELECT * FROM report_templates
       WHERE is_active = true
         AND cadence != 'manual'
         AND next_due_at IS NULL`,
      []
    );

    for (const report of reports.rows) {
      const nextDue = calculateNextDue(report);

      await query(
        `UPDATE report_templates
         SET next_due_at = $1, updated_at = NOW()
         WHERE id = $2`,
        [nextDue.toISO(), report.id]
      );

      logger.info('Initialized next_due_at', {
        report_id: report.id,
        next_due: nextDue.toISO(),
      });
    }
  } catch (err) {
    logger.error('Failed to initialize scheduled reports', err instanceof Error ? err : undefined);
  }
}
