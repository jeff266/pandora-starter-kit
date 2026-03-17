import { SKILL_BUFFER_HOURS, DEFAULT_DELIVERY_HOUR, DEFAULT_DELIVERY_DAY, DEFAULT_TIMEZONE } from './report-skill-map.js';

export interface AgentSchedule {
  // When skills should run (UTC cron expression)
  skillRunCron: string;
  // When orchestrator/delivery should run (UTC cron expression)
  deliveryCron: string;
  // Human-readable description for logging
  description: string;
}

/**
 * Given an agent's delivery preferences and workspace timezone,
 * compute the UTC cron expressions for skill runs and delivery.
 *
 * Example: delivery Monday 5am PT (UTC-8)
 *   → delivery UTC cron: "0 13 * * 1"  (13:00 UTC = 5am PT)
 *   → skill run UTC cron: "0 7 * * 1"  (7:00 UTC Monday = 11pm PT Sunday)
 *     6 hour buffer is maintained.
 */
export function calculateAgentSchedule(
  deliveryHour: number,        // Local hour, e.g. 5 for 5am
  deliveryDayOfWeek: number,   // 0-6, 0=Sunday, 1=Monday
  timezone: string             // IANA timezone, e.g. "America/Los_Angeles"
): AgentSchedule {
  // Get UTC offset for this timezone
  // Use Intl to get the offset without adding a heavy dependency
  const utcOffset = getUtcOffsetHours(timezone);

  // Convert delivery time to UTC
  let deliveryUtcHour = deliveryHour - utcOffset;
  let deliveryUtcDay = deliveryDayOfWeek;

  // Handle day wraparound
  if (deliveryUtcHour < 0) {
    deliveryUtcHour += 24;
    deliveryUtcDay = (deliveryDayOfWeek - 1 + 7) % 7;
  } else if (deliveryUtcHour >= 24) {
    deliveryUtcHour -= 24;
    deliveryUtcDay = (deliveryDayOfWeek + 1) % 7;
  }

  const deliveryCron = `0 ${deliveryUtcHour} * * ${deliveryUtcDay}`;

  // Skill run is SKILL_BUFFER_HOURS before delivery
  // If delivery is Monday 13:00 UTC, skills run Monday 7:00 UTC
  // day-of-week may roll back to previous day if skillRunHour < 0
  let skillRunUtcHour = deliveryUtcHour - SKILL_BUFFER_HOURS;
  let skillRunDay = deliveryUtcDay;

  if (skillRunUtcHour < 0) {
    skillRunUtcHour += 24;
    skillRunDay = (deliveryUtcDay - 1 + 7) % 7;
  }

  const skillRunCron = `0 ${skillRunUtcHour} * * ${skillRunDay}`;

  // Human-readable description
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
                'Thursday', 'Friday', 'Saturday'];

  return {
    skillRunCron,
    deliveryCron,
    description: `Skills: ${days[skillRunDay]} ${String(skillRunUtcHour).padStart(2, '0')}:00 UTC | ` +
                 `Delivery: ${days[deliveryDayOfWeek]} ${String(deliveryHour).padStart(2, '0')}:00 ${timezone}`,
  };
}

/**
 * Get UTC offset in hours for an IANA timezone.
 * Positive = ahead of UTC (e.g. UTC+5 = 5)
 * Negative = behind UTC (e.g. PT = UTC-8 = -8)
 */
function getUtcOffsetHours(timezone: string): number {
  try {
    const now = new Date();
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = now.toLocaleString('en-US', { timeZone: timezone });
    const utcDate = new Date(utcStr);
    const tzDate = new Date(tzStr);
    return Math.round((tzDate.getTime() - utcDate.getTime()) / (1000 * 60 * 60));
  } catch {
    // Fallback to PT if timezone is invalid
    console.warn(`[Scheduler] Invalid timezone: ${timezone}, falling back to PT`);
    return -8;
  }
}

/**
 * Get the default schedule for a workspace.
 * Used when an agent has no explicit delivery config.
 */
export function getDefaultSchedule(timezone: string): AgentSchedule {
  return calculateAgentSchedule(
    DEFAULT_DELIVERY_HOUR,
    DEFAULT_DELIVERY_DAY,
    timezone
  );
}
