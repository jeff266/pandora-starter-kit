/**
 * Encryption Test Suite
 *
 * Tests the credential encryption/decryption functionality.
 * Run with: CREDENTIAL_ENCRYPTION_KEY=<key> npx tsx server/scripts/test-encryption.ts
 */

import { encryptCredentials, decryptCredentials, isEncrypted } from '../lib/encryption.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('EncryptionTest');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    logger.info(`✓ ${message}`);
    passed++;
  } else {
    logger.error(`✗ ${message}`);
    failed++;
  }
}

function testEncryptionRoundTrip() {
  logger.info('\n=== Test 1: Encryption Round-trip ===');

  try {
    const original = {
      access_token: 'test_access_123',
      refresh_token: 'test_refresh_456',
      expires_in: 3600,
    };

    const encrypted = encryptCredentials(original);
    assert(encrypted.startsWith('enc:'), 'Encrypted string starts with enc:');
    assert(encrypted.length > 50, 'Encrypted string has reasonable length');

    const decrypted = decryptCredentials(encrypted);
    assert(
      JSON.stringify(decrypted) === JSON.stringify(original),
      'Decrypted matches original'
    );

    logger.info('  Original:', original);
    logger.info('  Encrypted (first 50 chars):', encrypted.substring(0, 50) + '...');
    logger.info('  Decrypted:', decrypted);
  } catch (err) {
    logger.error('  Test failed:', err);
    failed++;
  }
}

function testPlaintextFallback() {
  logger.info('\n=== Test 2: Plaintext Fallback ===');

  try {
    // Test with plaintext JSON object
    const plaintext = {
      accessToken: 'plain_123',
      refreshToken: 'plain_456',
    };

    // Since decryptCredentials expects a string, test isEncrypted instead
    assert(!isEncrypted(plaintext), 'Object is not detected as encrypted');
    assert(!isEncrypted('plain text'), 'Plain text is not detected as encrypted');
    assert(!isEncrypted('short'), 'Short string is not detected as encrypted');
  } catch (err) {
    logger.error('  Test failed:', err);
    failed++;
  }
}

function testTamperDetection() {
  logger.info('\n=== Test 3: Tamper Detection ===');

  try {
    const original = { key: 'value123' };
    const encrypted = encryptCredentials(original);

    // Modify one character in the encrypted string (after enc: prefix)
    const tampered = 'enc:' + encrypted.slice(4, 10) + 'X' + encrypted.slice(11);

    let errorThrown = false;
    try {
      decryptCredentials(tampered);
    } catch (err) {
      errorThrown = true;
    }

    assert(errorThrown, 'Tampered data throws error (GCM auth tag verification)');
  } catch (err) {
    logger.error('  Test failed:', err);
    failed++;
  }
}

function testDifferentIVs() {
  logger.info('\n=== Test 4: Different IVs ===');

  try {
    const original = { token: 'same_value' };

    const encrypted1 = encryptCredentials(original);
    const encrypted2 = encryptCredentials(original);

    assert(encrypted1 !== encrypted2, 'Two encryptions produce different ciphertext (random IV)');

    const decrypted1 = decryptCredentials(encrypted1);
    const decrypted2 = decryptCredentials(encrypted2);

    assert(
      JSON.stringify(decrypted1) === JSON.stringify(original),
      'First encryption decrypts correctly'
    );
    assert(
      JSON.stringify(decrypted2) === JSON.stringify(original),
      'Second encryption decrypts correctly'
    );
  } catch (err) {
    logger.error('  Test failed:', err);
    failed++;
  }
}

function testMissingKey() {
  logger.info('\n=== Test 5: Missing Encryption Key ===');

  try {
    const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;

    let errorThrown = false;
    let errorMessage = '';
    try {
      encryptCredentials({ test: 'value' });
    } catch (err: any) {
      errorThrown = true;
      errorMessage = err.message;
    }

    assert(errorThrown, 'Missing key throws error');
    assert(
      errorMessage.includes('CREDENTIAL_ENCRYPTION_KEY'),
      'Error message mentions CREDENTIAL_ENCRYPTION_KEY'
    );

    // Restore key
    if (originalKey) {
      process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
    }
  } catch (err) {
    logger.error('  Test failed:', err);
    failed++;
  }
}

function testLegacyFormatCompatibility() {
  logger.info('\n=== Test 6: Legacy Format Compatibility ===');

  try {
    // Test that old format (without enc: prefix) can still be decrypted
    const original = { legacy: 'token' };

    // First encrypt normally (with enc: prefix)
    const withPrefix = encryptCredentials(original);
    const base64Only = withPrefix.slice(4); // Remove enc: prefix to simulate legacy

    // Should still decrypt without prefix
    const decrypted = decryptCredentials(base64Only);
    assert(
      JSON.stringify(decrypted) === JSON.stringify(original),
      'Legacy format (no prefix) decrypts correctly'
    );

    assert(isEncrypted(base64Only), 'Legacy format is detected as encrypted');
    assert(isEncrypted(withPrefix), 'New format with prefix is detected as encrypted');
  } catch (err) {
    logger.error('  Test failed:', err);
    failed++;
  }
}

async function main() {
  logger.info('=================================');
  logger.info('Credential Encryption Test Suite');
  logger.info('=================================');

  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    logger.error('\nCREDENTIAL_ENCRYPTION_KEY environment variable not set!');
    logger.info('Generate a key with:');
    logger.info('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    logger.info('\nThen run:');
    logger.info('  CREDENTIAL_ENCRYPTION_KEY=<your-key> npx tsx server/scripts/test-encryption.ts');
    process.exit(1);
  }

  testEncryptionRoundTrip();
  testPlaintextFallback();
  testTamperDetection();
  testDifferentIVs();
  testMissingKey();
  testLegacyFormatCompatibility();

  logger.info('\n=================================');
  logger.info(`Tests Complete: ${passed} passed, ${failed} failed`);
  logger.info('=================================');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error('Test suite failed:', err);
  process.exit(1);
});
