import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string');
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encrypts credential object using AES-256-GCM envelope encryption.
 * Returns "enc:" prefixed base64-encoded string: enc:base64(iv + tag + ciphertext)
 * The "enc:" prefix enables mixed-state migration (handles both encrypted and plaintext)
 */
export function encryptCredentials(plaintext: Record<string, any>): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const json = JSON.stringify(plaintext);
  const encrypted = Buffer.concat([
    cipher.update(json, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  // Format: enc:base64(iv + tag + ciphertext)
  // Prefixed with "enc:" so we can detect encrypted vs plaintext
  const combined = Buffer.concat([iv, tag, encrypted]);
  return 'enc:' + combined.toString('base64');
}

/**
 * Decrypts credential string.
 * Handles both new format (enc: prefix) and legacy format (no prefix).
 * Returns original credential object.
 */
export function decryptCredentials(encoded: string): Record<string, any> {
  // Handle new format with enc: prefix
  let base64Data = encoded;
  if (encoded.startsWith('enc:')) {
    base64Data = encoded.slice(4);
  }

  const key = getKey();
  const combined = Buffer.from(base64Data, 'base64');

  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Detects if a credential value is already encrypted.
 * New format: Checks for "enc:" prefix
 * Legacy format: Checks if it's a base64 string with minimum length (iv + tag + ciphertext)
 * Plaintext values are JSON objects with keys like accessToken, apiKey, etc.
 */
export function isEncrypted(value: any): boolean {
  if (typeof value !== 'string') return false;

  // New format with enc: prefix
  if (value.startsWith('enc:')) return true;

  // Legacy format: base64 string with minimum length
  if (value.length < 44) return false;
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  return base64Regex.test(value);
}
