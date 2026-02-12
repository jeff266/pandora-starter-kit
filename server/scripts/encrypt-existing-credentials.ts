import { query } from '../db.js';
import { encryptCredentials, isEncrypted } from '../lib/encryption.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('EncryptCredentials');

async function main() {
  logger.info('Starting credential encryption migration...');

  const result = await query<{ id: string; workspace_id: string; connector_name: string; credentials: any }>(
    `SELECT id, workspace_id, connector_name, credentials FROM connections WHERE credentials IS NOT NULL`
  );

  let encrypted = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of result.rows) {
    const { id, workspace_id, connector_name, credentials } = row;

    if (isEncrypted(credentials)) {
      logger.info(`Already encrypted: ${connector_name} (${workspace_id.slice(0, 8)}...)`);
      skipped++;
      continue;
    }

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

  logger.info(`Migration complete: ${encrypted} encrypted, ${skipped} skipped, ${errors} errors`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error('Migration failed', { error: err });
  process.exit(1);
});
