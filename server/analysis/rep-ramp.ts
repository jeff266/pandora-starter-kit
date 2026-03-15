import { query } from '../db.js';

export interface RepQuarterlyProductivity {
  tenureQuarter: number;
  fiscalQuarter: string;
  newArrBookings: number;
  quotaAssigned: number;
  attainmentPct: number;
}

export interface RepRampData {
  repEmail: string;
  repName: string;
  hireDate: string | null;
  currentTenureQuarters: number;
  isActive: boolean;
  quarterlyProductivity: RepQuarterlyProductivity[];
  avgProductivityQ4Plus: number;
}

export interface RampCurvePoint {
  tenureQuarter: number;
  medianProductivity: number;
  p25Productivity: number;
  p75Productivity: number;
  companyRampPct: number;
}

export interface RepRampAnalysis {
  ramps: RepRampData[];
  rampCurve: RampCurvePoint[];
  steadyStateProductivity: number;
  impliedRampSchedule: { q1: number; q2: number; q3: number; q4: number; q5Plus: number };
  newRepRisk: {
    repsInFirstTwoQuarters: number;
    combinedExpectedProductivity: number;
    combinedActualProductivity: number;
    underperformingNewReps: string[];
  };
  dataAvailable: boolean;
  skipReason: string | null;
}

function quarterLabel(d: Date): string {
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

function quartersElapsed(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, Math.floor(months / 3));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[Math.min(idx, sorted.length - 1)];
}

export async function repRampAnalysis(workspaceId: string): Promise<RepRampAnalysis> {
  const usersResult = await query<{
    email: string;
    name: string | null;
    hire_date: string | null;
    is_active: boolean;
  }>(
    `SELECT u.email, u.name, u.hire_date, u.is_active
     FROM users u
     WHERE u.workspace_id = $1
       AND u.pandora_role NOT IN ('admin', 'viewer')
       AND u.email IS NOT NULL`,
    [workspaceId]
  );

  const reps = usersResult.rows;
  if (reps.length === 0) return noDataResult('No sales reps found');

  const hiredReps = reps.filter(r => r.hire_date);
  if (hiredReps.length === 0) return noDataResult('No hire date data available for reps');

  const now = new Date();

  const bookingsResult = await query<{
    owner_email: string;
    quarter_start: string;
    bookings: number;
  }>(
    `SELECT
       owner_email,
       DATE_TRUNC('quarter', close_date)::date::text AS quarter_start,
       COALESCE(SUM(amount), 0) AS bookings
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND close_date IS NOT NULL
       AND close_date >= '2020-01-01'
     GROUP BY owner_email, DATE_TRUNC('quarter', close_date)`,
    [workspaceId]
  );

  const bookingsByRepAndQuarter = new Map<string, Map<string, number>>();
  for (const row of bookingsResult.rows) {
    if (!bookingsByRepAndQuarter.has(row.owner_email)) bookingsByRepAndQuarter.set(row.owner_email, new Map());
    bookingsByRepAndQuarter.get(row.owner_email)!.set(row.quarter_start, Number(row.bookings));
  }

  const quotaResult = await query<{
    rep_email: string;
    period_start: string;
    period_quota: number;
  }>(
    `SELECT rep_email, period_start::text, period_quota
     FROM rep_quotas
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const quotaByRepAndQuarter = new Map<string, Map<string, number>>();
  for (const row of quotaResult.rows) {
    if (!quotaByRepAndQuarter.has(row.rep_email)) quotaByRepAndQuarter.set(row.rep_email, new Map());
    const qStart = new Date(row.period_start);
    const qKey = `${qStart.getFullYear()}-${String(qStart.getMonth() + 1).padStart(2, '0')}-01`;
    quotaByRepAndQuarter.get(row.rep_email)!.set(qKey, Number(row.period_quota));
  }

  const tenureProductivityByQ: Map<number, number[]> = new Map();
  const rampDataList: RepRampData[] = [];

  for (const rep of hiredReps) {
    const hireDate = new Date(rep.hire_date!);
    const tenureQ = quartersElapsed(hireDate, now);
    const repBookings = bookingsByRepAndQuarter.get(rep.email) ?? new Map();
    const repQuotas = quotaByRepAndQuarter.get(rep.email) ?? new Map();

    const quarterlyProductivity: RepQuarterlyProductivity[] = [];
    const q4PlusBookings: number[] = [];

    for (let tq = 0; tq <= Math.min(tenureQ, 20); tq++) {
      const qDate = new Date(hireDate);
      qDate.setMonth(qDate.getMonth() + tq * 3);
      const qStart = new Date(qDate.getFullYear(), Math.floor(qDate.getMonth() / 3) * 3, 1);
      const qKey = `${qStart.getFullYear()}-${String(qStart.getMonth() + 1).padStart(2, '0')}-01`;

      const bookings = repBookings.get(qKey) ?? 0;
      const quota = repQuotas.get(qKey) ?? 0;
      const attainment = quota > 0 ? bookings / quota : 0;

      quarterlyProductivity.push({
        tenureQuarter: tq + 1,
        fiscalQuarter: quarterLabel(qStart),
        newArrBookings: bookings,
        quotaAssigned: quota,
        attainmentPct: Math.round(attainment * 100),
      });

      if (!tenureProductivityByQ.has(tq + 1)) tenureProductivityByQ.set(tq + 1, []);
      tenureProductivityByQ.get(tq + 1)!.push(bookings);

      if (tq >= 3) q4PlusBookings.push(bookings);
    }

    const sorted = [...q4PlusBookings].sort((a, b) => a - b);
    const avgQ4Plus = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;

    rampDataList.push({
      repEmail: rep.email,
      repName: rep.name ?? rep.email,
      hireDate: rep.hire_date,
      currentTenureQuarters: tenureQ,
      isActive: rep.is_active,
      quarterlyProductivity,
      avgProductivityQ4Plus: avgQ4Plus,
    });
  }

  const allQ4Plus = rampDataList
    .filter(r => r.currentTenureQuarters >= 4)
    .map(r => r.avgProductivityQ4Plus)
    .sort((a, b) => a - b);
  const steadyState = allQ4Plus.length > 0 ? percentile(allQ4Plus, 50) : 0;

  const rampCurve: RampCurvePoint[] = [];
  for (let tq = 1; tq <= 8; tq++) {
    const vals = (tenureProductivityByQ.get(tq) ?? []).sort((a, b) => a - b);
    if (vals.length === 0) continue;
    const median = percentile(vals, 50);
    rampCurve.push({
      tenureQuarter: tq,
      medianProductivity: median,
      p25Productivity: percentile(vals, 25),
      p75Productivity: percentile(vals, 75),
      companyRampPct: steadyState > 0 ? Math.round((median / steadyState) * 100) / 100 : 0,
    });
  }

  const implied = {
    q1: rampCurve[0]?.companyRampPct ?? 0.05,
    q2: rampCurve[1]?.companyRampPct ?? 0.25,
    q3: rampCurve[2]?.companyRampPct ?? 0.60,
    q4: rampCurve[3]?.companyRampPct ?? 0.90,
    q5Plus: 1.00,
  };

  const newReps = rampDataList.filter(r => r.currentTenureQuarters < 2);
  const underperforming: string[] = [];
  let expectedNew = 0; let actualNew = 0;

  for (const rep of newReps) {
    const tq = Math.min(rep.currentTenureQuarters + 1, 4);
    const curve = rampCurve.find(c => c.tenureQuarter === tq);
    const expected = steadyState * (curve?.companyRampPct ?? 0.10);
    const actual = rep.quarterlyProductivity[rep.quarterlyProductivity.length - 1]?.newArrBookings ?? 0;
    expectedNew += expected;
    actualNew += actual;
    if (actual < (curve?.p25Productivity ?? expected * 0.5)) {
      underperforming.push(rep.repName ?? rep.repEmail);
    }
  }

  return {
    ramps: rampDataList,
    rampCurve,
    steadyStateProductivity: steadyState,
    impliedRampSchedule: implied,
    newRepRisk: {
      repsInFirstTwoQuarters: newReps.length,
      combinedExpectedProductivity: expectedNew,
      combinedActualProductivity: actualNew,
      underperformingNewReps: underperforming,
    },
    dataAvailable: true,
    skipReason: null,
  };
}

function noDataResult(reason: string): RepRampAnalysis {
  return {
    ramps: [],
    rampCurve: [],
    steadyStateProductivity: 0,
    impliedRampSchedule: { q1: 0, q2: 0, q3: 0, q4: 0, q5Plus: 1 },
    newRepRisk: { repsInFirstTwoQuarters: 0, combinedExpectedProductivity: 0, combinedActualProductivity: 0, underperformingNewReps: [] },
    dataAvailable: false,
    skipReason: reason,
  };
}
