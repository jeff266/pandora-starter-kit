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
 * Returns base64-encoded string: iv + tag + ciphertext
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

  // Format: base64(iv + tag + ciphertext)
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypts base64-encoded credential string.
 * Returns original credential object.
 */
export function decryptCredentials(encoded: string): Record<string, any> {
  const key = getKey();
  const combined = Buffer.from(encoded, 'base64');

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
 * Encrypted values are base64 strings, plaintext values are JSON objects.
 */
export function isEncrypted(value: any): boolean {
  return typeof value === 'string';
}
