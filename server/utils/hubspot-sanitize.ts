// HubSpot Sanitization Utilities
// Converts HubSpot empty strings to null for typed database columns
// Source: SYNC_FIELD_GUIDE.md Section 1

/**
 * Sanitize a date string from HubSpot.
 * HubSpot returns "" for unset dates, which PostgreSQL rejects.
 *
 * @param value - HubSpot date property value
 * @returns Valid date string or null
 */
export function sanitizeDate(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') return null;

  // Validate it's actually a valid date
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : value;
}

/**
 * Sanitize a number string from HubSpot.
 * HubSpot returns all property values as strings, including numbers.
 * Empty string "" should become null, not NaN.
 *
 * @param value - HubSpot numeric property value
 * @returns Parsed number or null
 */
export function sanitizeNumber(value: string | null | undefined): number | null {
  if (!value || value.trim() === '') return null;

  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

/**
 * Sanitize a boolean string from HubSpot.
 * HubSpot returns "true"/"false" as strings.
 * Empty string "" should become null, not false.
 *
 * @param value - HubSpot boolean property value
 * @returns Boolean value or null
 */
export function sanitizeBoolean(value: string | null | undefined): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/**
 * Bulk sanitize a HubSpot properties object for database insertion.
 * Converts all empty strings to null.
 *
 * Use this when you want to sanitize an entire properties object
 * without knowing which fields need what type conversion.
 *
 * @param props - Raw HubSpot properties object
 * @returns Sanitized properties object with empty strings converted to null
 */
export function sanitizeForDb(props: Record<string, string | null | undefined>): Record<string, string | null> {
  const result: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(props)) {
    // Convert empty string to null, preserve other values
    result[key] = (value === '' || value === undefined) ? null : value;
  }

  return result;
}

/**
 * Sanitize a text field from HubSpot.
 * For text/varchar columns, decide whether to store empty strings or convert to null.
 *
 * @param value - HubSpot text property value
 * @param convertEmptyToNull - If true, convert "" to null. If false, preserve "".
 * @returns Text value or null
 */
export function sanitizeText(
  value: string | null | undefined,
  convertEmptyToNull: boolean = true
): string | null {
  if (value === null || value === undefined) return null;

  const trimmed = value.trim();
  if (trimmed === '' && convertEmptyToNull) return null;

  return value; // Preserve original value (including whitespace if present)
}
