import { query } from '../db.js';
import { encryptCredentials, isEncrypted } from '../lib/encryption.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('EncryptCredentials');

async function main() {
  logger.info('Starting credential encryption migration with enc: prefix...');

  const result = await query<{ id: string; workspace_id: string; connector_name: string; credentials: any }>(
    `SELECT id, workspace_id, connector_name, credentials FROM connections WHERE credentials IS NOT NULL`
  );

  let encrypted = 0;
  let alreadyWithPrefix = 0;
  let legacyReEncrypted = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of result.rows) {
    const { id, workspace_id, connector_name, credentials } = row;

    // Check if it's a string with enc: prefix (new format)
    if (typeof credentials === 'string' && credentials.startsWith('enc:')) {
      logger.info(`Already has enc: prefix: ${connector_name} (${workspace_id.slice(0, 8)}...)`);
      alreadyWithPrefix++;
      continue;
    }

    // Check if it's an old encrypted format (base64 without prefix)
    if (typeof credentials === 'string' && isEncrypted(credentials) && !credentials.startsWith('enc:')) {
      logger.info(`Re-encrypting legacy format with enc: prefix: ${connector_name} (${workspace_id.slice(0, 8)}...)`);
      try {
        // Decrypt old format and re-encrypt with new prefix
        const decrypted = JSON.parse(credentials); // Legacy format was stored as JSON string
        const encryptedValue = encryptCredentials(decrypted);
        await query(
          `UPDATE connections SET credentials = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(encryptedValue), id]
        );
        legacyReEncrypted++;
        continue;
      } catch (err) {
        logger.warn(`Could not re-encrypt legacy format for ${connector_name}, will try as plaintext`, { error: err });
        // Fall through to plaintext handling
      }
    }

    // Skip if null/empty
    if (!credentials || (typeof credentials === 'object' && Object.keys(credentials).length === 0)) {
      logger.info(`Skipping empty credentials: ${connector_name} (${workspace_id.slice(0, 8)}...)`);
      skipped++;
      continue;
    }

    // Handle plaintext object
    try {
      const encryptedValue = encryptCredentials(credentials);
      await query(
        `UPDATE connections SET credentials = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(encryptedValue), id]
      );
      logger.info(`Encrypted: ${connector_name} (${workspace_id.slice(0, 8)}...)`);
      encrypted++;
    } catch (err) {
      logger.error(`Failed to encrypt ${connector_name} (${workspace_id.slice(0, 8)}...)`, { error: err });
      errors++;
    }
  }

  logger.info(`Migration complete:`, {
    encrypted,
    alreadyWithPrefix,
    legacyReEncrypted,
    skipped,
    errors,
    total: result.rows.length,
  });
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error('Migration failed', { error: err });
  process.exit(1);
});
