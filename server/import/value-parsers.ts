export function parseAmount(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }

  let str = String(value).trim();
  if (!str) return null;

  str = str.replace(/[$€£¥,\s]/g, '');

  const suffixMatch = str.match(/^(-?\d+\.?\d*)\s*([KkMmBb])$/);
  if (suffixMatch) {
    const num = parseFloat(suffixMatch[1]);
    const suffix = suffixMatch[2].toUpperCase();
    if (isNaN(num)) return null;
    const multipliers: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
    return num * (multipliers[suffix] || 1);
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) ? null : parsed;
}

export function parseDate(value: any, format?: string): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return formatISODate(value);
  }

  if (typeof value === 'number') {
    if (value > 30000 && value < 60000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(epoch.getTime() + value * 86400000);
      if (!isNaN(date.getTime())) {
        return formatISODate(date);
      }
    }
    return null;
  }

  const str = String(value).trim();
  if (!str) return null;

  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    if (isValidDate(+y, +m, +d)) return `${y}-${m}-${d}`;
  }

  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, a, b, y] = slashMatch;
    let month: number, day: number;

    if (format === 'DD/MM/YYYY') {
      day = parseInt(a, 10);
      month = parseInt(b, 10);
    } else if (format === 'MM/DD/YYYY') {
      month = parseInt(a, 10);
      day = parseInt(b, 10);
    } else {
      if (parseInt(a, 10) > 12) {
        day = parseInt(a, 10);
        month = parseInt(b, 10);
      } else {
        month = parseInt(a, 10);
        day = parseInt(b, 10);
      }
    }

    if (isValidDate(+y, month, day)) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const namedMatch = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (namedMatch) {
    const [, monthName, dayStr, yearStr] = namedMatch;
    const month = monthNameToNumber(monthName);
    if (month && isValidDate(+yearStr, month, +dayStr)) {
      return `${yearStr}-${String(month).padStart(2, '0')}-${String(+dayStr).padStart(2, '0')}`;
    }
  }

  const isoDatetime = new Date(str);
  if (!isNaN(isoDatetime.getTime()) && str.includes('T')) {
    return formatISODate(isoDatetime);
  }

  return null;
}

export function parsePercentage(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    return value > 1 ? value / 100 : value;
  }

  let str = String(value).trim();
  const hasPercent = str.includes('%');
  str = str.replace(/%/g, '').trim();

  const num = parseFloat(str);
  if (isNaN(num)) return null;

  if (hasPercent || num > 1) {
    return num / 100;
  }
  return num;
}

export function normalizeText(value: any): string | null {
  if (value === null || value === undefined) return null;

  let str = String(value).trim().replace(/\s+/g, ' ');

  const nullIndicators = ['n/a', 'na', 'none', '-', '--', '---', 'null', 'undefined', ''];
  if (nullIndicators.includes(str.toLowerCase())) return null;

  return str || null;
}

const COMPANY_SUFFIXES = [
  'incorporated', 'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'group', 'international', 'intl', 'holdings',
  'partners', 'enterprises', 'technologies', 'technology', 'tech',
  'solutions', 'services', 'consulting', 'associates', 'plc',
  'gmbh', 'ag', 'sa', 'srl', 'pty',
];

const SUFFIX_PATTERN = new RegExp(
  `\\b(${COMPANY_SUFFIXES.join('|')})\\.?\\b`,
  'gi'
);

export function normalizeCompanyName(name: string): string {
  let normalized = name.toLowerCase().trim();

  normalized = normalized.replace(SUFFIX_PATTERN, '');
  normalized = normalized.replace(/[.,\s]+/g, ' ').trim();
  normalized = normalized.replace(/[.,]+$/, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

function formatISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (year < 1900 || year > 2100) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function monthNameToNumber(name: string): number | null {
  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6,
    jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  return months[name.toLowerCase()] || null;
}
