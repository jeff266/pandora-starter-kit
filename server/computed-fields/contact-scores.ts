export interface ContactRow {
  id: string;
  last_activity_date: string | null;
  lifecycle_stage: string | null;
  created_at: string;
}

interface ContactActivity {
  total: number;
  lastActivity: Date | null;
  emails: number;
  meetings: number;
  calls: number;
}

export function computeContactEngagement(
  contact: ContactRow,
  activity?: ContactActivity
): number {
  if (!activity || activity.total === 0) {
    return 0;
  }

  const recencyScore = calculateRecencyScore(activity.lastActivity);
  const frequencyScore = calculateFrequencyScore(activity.total, contact.created_at);
  const diversityScore = calculateDiversityScore(activity);
  const meetingBonus = activity.meetings > 0 ? Math.min(activity.meetings * 5, 15) : 0;

  const raw = recencyScore + frequencyScore + diversityScore + meetingBonus;
  return clamp(Math.round(raw * 100) / 100, 0, 100);
}

function calculateRecencyScore(lastActivity: Date | null): number {
  if (!lastActivity) return 0;

  const daysSince = daysBetween(lastActivity, new Date());

  if (daysSince <= 3) return 35;
  if (daysSince <= 7) return 28;
  if (daysSince <= 14) return 20;
  if (daysSince <= 30) return 12;
  if (daysSince <= 60) return 5;
  return 1;
}

function calculateFrequencyScore(totalActivities: number, createdAt: string): number {
  const contactAgeDays = Math.max(1, daysBetween(new Date(createdAt), new Date()));
  const activitiesPerWeek = (totalActivities / contactAgeDays) * 7;

  if (activitiesPerWeek >= 5) return 30;
  if (activitiesPerWeek >= 3) return 25;
  if (activitiesPerWeek >= 1) return 18;
  if (activitiesPerWeek >= 0.5) return 10;
  return 3;
}

function calculateDiversityScore(activity: ContactActivity): number {
  const channels = [
    activity.emails > 0,
    activity.meetings > 0,
    activity.calls > 0,
  ].filter(Boolean).length;

  if (channels >= 3) return 20;
  if (channels >= 2) return 12;
  if (channels >= 1) return 5;
  return 0;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
