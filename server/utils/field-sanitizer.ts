/**
 * Field Sanitization Utilities
 *
 * Prevents PostgreSQL errors when APIs return empty strings for unset fields.
 *
 * THE BUG THIS FIXES:
 * - HubSpot/Salesforce/Gong return "" (empty string) for unset date/number fields
 * - PostgreSQL DATE/NUMERIC/INTEGER columns reject "" as invalid
 * - Nullish coalescing (?? null) does NOT catch empty strings
 * - Result: "invalid input syntax for type date" crashes
 *
 * USE THIS:
 * - For ALL date fields (close_date, created_date, due_date, call_date, etc.)
 * - For ALL numeric fields (amount, duration_seconds, employee_count, revenue, etc.)
 * - For ALL integer fields (days_in_stage, days_since_activity, etc.)
 * - For ALL boolean fields from string-based APIs
 *
 * DO NOT USE THIS:
 * - For text/varchar fields where "" is a valid value
 * - For JSONB fields (they can handle any JSON)
 *
 * Source: SYNC_FIELD_GUIDE.md Section 1, Prompt 6
 */

export type FieldType = 'text' | 'date' | 'numeric' | 'integer' | 'boolean';

/**
 * Sanitize a field value for database insertion based on its target type.
 *
 * @param value - Raw value from API (string, number, boolean, null, undefined)
 * @param targetType - Target database column type
 * @returns Sanitized value or null
 *
 * @example
 * sanitizeForDb('', 'date') → null
 * sanitizeForDb('2024-01-15', 'date') → '2024-01-15'
 * sanitizeForDb('not-a-date', 'date') → null
 * sanitizeForDb('', 'numeric') → null
 * sanitizeForDb('50000', 'numeric') → 50000
 * sanitizeForDb('abc', 'numeric') → null
 * sanitizeForDb('', 'text') → null (by default)
 * sanitizeForDb(null, 'date') → null
 * sanitizeForDb(undefined, 'text') → null
 */
export function sanitizeForDb(value: any, targetType: FieldType): any {
  // null/undefined → null
  if (value === null || value === undefined) {
    return null;
  }

  // Empty string handling
  if (value === '') {
    // For text fields, could preserve "" or convert to null based on schema preference
    // Here we convert to null for consistency with other field types
    // If you need to preserve "" for specific text fields, use sanitizeText with convertEmpty=false
    if (targetType === 'text') {
      return null;
    }
    // For typed fields (date, number, boolean), empty string MUST be null
    return null;
  }

  // Type-specific validation and conversion
  switch (targetType) {
    case 'date':
      return sanitizeDate(value);

    case 'numeric':
      return sanitizeNumber(value);

    case 'integer':
      return sanitizeInteger(value);

    case 'boolean':
      return sanitizeBoolean(value);

    case 'text':
      return sanitizeText(value);

    default:
      // Unknown type - return as-is but convert empty string to null
      return value === '' ? null : value;
  }
}

/**
 * Sanitize a date field.
 *
 * @param value - Date string, Date object, or timestamp
 * @returns Valid date string/object or null
 */
export function sanitizeDate(value: any): string | Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // If already a Date object, validate it
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  // If string, validate it's a parseable date
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : value; // Return original string if valid
  }

  // If number (timestamp), validate it
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * Sanitize a number field (NUMERIC in PostgreSQL - supports decimals).
 *
 * @param value - Number as string, number, null, or undefined
 * @returns Parsed number or null
 */
export function sanitizeNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // If already a number, validate it
  if (typeof value === 'number') {
    return isNaN(value) || !isFinite(value) ? null : value;
  }

  // If string, parse and validate
  if (typeof value === 'string') {
    const n = parseFloat(value.trim());
    return isNaN(n) || !isFinite(n) ? null : n;
  }

  return null;
}

/**
 * Sanitize an integer field (INTEGER in PostgreSQL - whole numbers only).
 *
 * @param value - Integer as string, number, null, or undefined
 * @returns Parsed integer or null
 */
export function sanitizeInteger(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // If already a number, validate it's an integer
  if (typeof value === 'number') {
    if (isNaN(value) || !isFinite(value)) {
      return null;
    }
    return Math.floor(value); // Convert to integer
  }

  // If string, parse and validate
  if (typeof value === 'string') {
    const n = parseInt(value.trim(), 10);
    return isNaN(n) ? null : n;
  }

  return null;
}

/**
 * Sanitize a boolean field.
 * Handles string representations ("true", "false", "1", "0") and actual booleans.
 *
 * @param value - Boolean as string, boolean, null, or undefined
 * @returns Boolean or null
 */
export function sanitizeBoolean(value: any): boolean | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // If already boolean, return it
  if (typeof value === 'boolean') {
    return value;
  }

  // If string, parse it
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
    return null; // Invalid boolean string
  }

  // If number, treat 0 as false, non-zero as true
  if (typeof value === 'number') {
    return value !== 0;
  }

  return null;
}

/**
 * Sanitize a text field.
 * For text/varchar columns, decide whether to store empty strings or convert to null.
 *
 * @param value - Text value
 * @param convertEmptyToNull - If true, convert "" to null. If false, preserve "".
 * @returns Text value or null
 */
export function sanitizeText(
  value: any,
  convertEmptyToNull: boolean = true
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  // Convert to string if not already
  const str = String(value);

  // Optionally convert empty string to null
  if (str.trim() === '' && convertEmptyToNull) {
    return null;
  }

  return str;
}

/**
 * Bulk sanitize an object's properties.
 * Converts all empty strings to null for database safety.
 *
 * USE CASE: When you have a raw API response object and want to bulk-convert
 * empty strings before passing to transform functions that apply type-specific sanitization.
 *
 * @param props - Raw API properties object
 * @returns Sanitized object with empty strings converted to null
 */
export function sanitizeObject(
  props: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(props)) {
    // Convert empty string to null, preserve other values
    result[key] = value === '' || value === undefined ? null : value;
  }

  return result;
}
