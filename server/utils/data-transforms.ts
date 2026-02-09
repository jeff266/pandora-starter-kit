export function extractFieldValues<T extends Record<string, unknown>>(
  metadata: unknown,
  approvedFieldNames: string[],
): T {
  if (!metadata || typeof metadata !== "object") {
    return {} as T;
  }

  const metadataObj = metadata as Record<string, unknown>;
  const extractedValues: Record<string, unknown> = {};

  for (const fieldName of approvedFieldNames) {
    const value = metadataObj[fieldName];
    if (value !== undefined && value !== null && value !== "") {
      extractedValues[fieldName] = value;
    }
  }

  return extractedValues as T;
}

export function parseNumber(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : parseFloat(value);
  return isNaN(num) ? null : num;
}

export function parseDate(
  value: string | Date | null | undefined,
): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;

  try {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

export function normalizeEmail(
  email: string | null | undefined,
): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

export function normalizePhone(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  return phone.replace(/\D/g, "");
}

export function extractDomain(email: string): string | null {
  const match = email.match(/@(.+)$/);
  return match ? match[1].toLowerCase() : null;
}

export function deduplicateBy<T>(
  array: T[],
  keyFn: (item: T) => string,
): T[] {
  const seen = new Set<string>();
  return array.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function groupBy<T>(
  array: T[],
  keyFn: (item: T) => string,
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const item of array) {
    const key = keyFn(item);
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item);
  }
  return grouped;
}

export function percentage(
  numerator: number,
  denominator: number,
  decimals = 2,
): number {
  if (denominator === 0) return 0;
  return parseFloat(((numerator / denominator) * 100).toFixed(decimals));
}

export function truncate(
  str: string,
  maxLength: number,
  suffix = "...",
): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}
