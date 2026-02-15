const SENSITIVE_KEYS = new Set([
  'access_token', 'refresh_token', 'api_key', 'apiKey',
  'password', 'secret', 'credentials', 'token',
  'authorization', 'cookie', 'x-api-key',
]);

const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /ey[A-Za-z0-9._-]{20,}/g,
  /[a-f0-9]{64}/g,
];

export function redactObject(obj: any, depth = 0): any {
  if (depth > 10) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactString(obj);
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item, depth + 1));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactObject(value, depth + 1);
    }
  }
  return result;
}

export function redactString(str: string): string {
  let result = str;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
