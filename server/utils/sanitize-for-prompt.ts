/**
 * Prompt Injection Sanitization
 *
 * Sanitizes CRM-sourced strings before they are interpolated into AI prompts.
 * Prevents prompt injection attacks via poisoned deal names, account names,
 * contact names, annotation content, or any other user-controlled CRM data.
 *
 * Usage:
 *   import { sanitizeForPrompt } from '../utils/sanitize-for-prompt.js';
 *   lines.push(`Deal: ${sanitizeForPrompt(deal.name)}`);
 */

const INJECTION_PATTERNS: RegExp[] = [
  // XML-style prompt delimiters used by Claude and other LLMs
  /<\/?system>/gi,
  /<\/?instruction[s]?>/gi,
  /<\/?human>/gi,
  /<\/?assistant>/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<SYS>>/gi,
  /<\/SYS>>/gi,
  // Natural-language override phrases
  /IGNORE\s+ALL?\s+PREVIOUS\s+(INSTRUCTIONS?|CONTEXT|PROMPTS?)/gi,
  /DISREGARD\s+(ALL\s+)?(PREVIOUS|PRIOR|ABOVE)\s+(INSTRUCTIONS?|CONTEXT)/gi,
  /YOU\s+ARE\s+NOW\s+(A\s+)?/gi,
  /NEW\s+INSTRUCTIONS?:/gi,
  /OVERRIDE\s+(ALL\s+)?INSTRUCTIONS?/gi,
  /SYSTEM\s+PROMPT:/gi,
  /ACT\s+AS\s+(IF\s+YOU\s+ARE\s+)?/gi,
  /FORGET\s+(EVERYTHING|ALL)\s+/gi,
];

/**
 * Sanitize a single string value for safe interpolation into an AI prompt.
 * Returns the value unchanged if it contains no injection patterns.
 * Non-string values are coerced to string.
 */
export function sanitizeForPrompt(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return String(value);

  let sanitized = value;
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}
