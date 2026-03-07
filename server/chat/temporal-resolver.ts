export interface TemporalContext {
  label: string;
  start: string;
  end: string;
  is_future: boolean;
  is_past: boolean;
  quarter?: string;
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function quarterBounds(q: 1 | 2 | 3 | 4, year: number): { start: string; end: string } {
  const ranges: Record<number, [number, number, number, number]> = {
    1: [1, 1, 3, 31],
    2: [4, 1, 6, 30],
    3: [7, 1, 9, 30],
    4: [10, 1, 12, 31],
  };
  const [sm, sd, em, ed] = ranges[q];
  return { start: isoDate(year, sm, sd), end: isoDate(year, em, ed) };
}

function currentQuarterNum(month: number): 1 | 2 | 3 | 4 {
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

export function resolveTemporalContext(message: string, now: Date = new Date()): TemporalContext | null {
  const lower = message.toLowerCase();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const currentQ = currentQuarterNum(month);

  // ── Specific Q1–Q4 with optional year ────────────────────────────────────
  const explicitQMatch = lower.match(/\bq([1-4])(?:\s+(\d{4}))?\b/);
  if (explicitQMatch) {
    const q = parseInt(explicitQMatch[1]) as 1 | 2 | 3 | 4;
    const targetYear = explicitQMatch[2] ? parseInt(explicitQMatch[2]) : year;
    const bounds = quarterBounds(q, targetYear);
    const qDate = new Date(bounds.start);
    const is_future = qDate > now;
    const is_past = new Date(bounds.end) < now && q !== currentQ;
    return { label: `Q${q} ${targetYear}`, quarter: `Q${q}`, is_future, is_past, ...bounds };
  }

  // ── Next quarter ──────────────────────────────────────────────────────────
  if (/\bnext quarter\b|\bnext q\b|\bnext fiscal quarter\b|\bupcoming quarter\b|\bfollowing quarter\b/.test(lower)) {
    const nextQ = currentQ === 4 ? 1 : (currentQ + 1) as 1 | 2 | 3 | 4;
    const nextYear = currentQ === 4 ? year + 1 : year;
    const bounds = quarterBounds(nextQ, nextYear);
    return { label: `Next Quarter (Q${nextQ} ${nextYear})`, quarter: `Q${nextQ}`, is_future: true, is_past: false, ...bounds };
  }

  // ── This / current quarter ────────────────────────────────────────────────
  if (/\b(this|current) quarter\b/.test(lower)) {
    const bounds = quarterBounds(currentQ, year);
    return { label: `This Quarter (Q${currentQ} ${year})`, quarter: `Q${currentQ}`, is_future: false, is_past: false, ...bounds };
  }

  // ── Last quarter ──────────────────────────────────────────────────────────
  if (/\blast quarter\b|\bprevious quarter\b/.test(lower)) {
    const lastQ = currentQ === 1 ? 4 : (currentQ - 1) as 1 | 2 | 3 | 4;
    const lastYear = currentQ === 1 ? year - 1 : year;
    const bounds = quarterBounds(lastQ, lastYear);
    return { label: `Last Quarter (Q${lastQ} ${lastYear})`, quarter: `Q${lastQ}`, is_future: false, is_past: true, ...bounds };
  }

  // ── Next month ────────────────────────────────────────────────────────────
  if (/\bnext month\b/.test(lower)) {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextMonthYear = month === 12 ? year + 1 : year;
    const lastDay = new Date(nextMonthYear, nextMonth, 0).getDate();
    return {
      label: `Next Month`,
      start: isoDate(nextMonthYear, nextMonth, 1),
      end: isoDate(nextMonthYear, nextMonth, lastDay),
      is_future: true,
      is_past: false,
    };
  }

  // ── This month ────────────────────────────────────────────────────────────
  if (/\bthis month\b|\bcurrent month\b/.test(lower)) {
    const lastDay = new Date(year, month, 0).getDate();
    return {
      label: `This Month`,
      start: isoDate(year, month, 1),
      end: isoDate(year, month, lastDay),
      is_future: false,
      is_past: false,
    };
  }

  // ── Last month ────────────────────────────────────────────────────────────
  if (/\blast month\b|\bprevious month\b/.test(lower)) {
    const lastM = month === 1 ? 12 : month - 1;
    const lastMYear = month === 1 ? year - 1 : year;
    const lastDay = new Date(lastMYear, lastM, 0).getDate();
    return {
      label: `Last Month`,
      start: isoDate(lastMYear, lastM, 1),
      end: isoDate(lastMYear, lastM, lastDay),
      is_future: false,
      is_past: true,
    };
  }

  // ── Next year ─────────────────────────────────────────────────────────────
  if (/\bnext year\b|\bnext fiscal year\b/.test(lower)) {
    return {
      label: `Next Year (${year + 1})`,
      start: isoDate(year + 1, 1, 1),
      end: isoDate(year + 1, 12, 31),
      is_future: true,
      is_past: false,
    };
  }

  // ── This year / YTD ──────────────────────────────────────────────────────
  if (/\bthis year\b|\bcurrent year\b|\bytd\b|\byear.to.date\b/.test(lower)) {
    return {
      label: `This Year (${year})`,
      start: isoDate(year, 1, 1),
      end: isoDate(year, 12, 31),
      is_future: false,
      is_past: false,
    };
  }

  // ── Last year ─────────────────────────────────────────────────────────────
  if (/\blast year\b|\bprevious year\b/.test(lower)) {
    return {
      label: `Last Year (${year - 1})`,
      start: isoDate(year - 1, 1, 1),
      end: isoDate(year - 1, 12, 31),
      is_future: false,
      is_past: true,
    };
  }

  return null;
}

export function hasFuturePeriod(message: string, now: Date = new Date()): boolean {
  const ctx = resolveTemporalContext(message, now);
  return ctx?.is_future === true;
}

export function formatTemporalContextBlock(ctx: TemporalContext): string {
  return [
    `DETECTED TIME PERIOD: ${ctx.label}`,
    `  Date range: ${ctx.start} → ${ctx.end}`,
    `  Use these exact dates for close_date_from / close_date_to in any metric or deal query calls.`,
  ].join('\n');
}
