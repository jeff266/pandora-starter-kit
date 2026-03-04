import { query } from '../db.js';
import { encryptCredentials, isEncrypted } from './encryption.js';

interface ConnectionRow {
  id: string;
  workspace_id: string;
  connector_name: string;
  credentials: any;
}

/**
 * Migrate all plaintext connector credentials to AES-256-GCM encrypted format.
 * Safe to run multiple times — already-encrypted records are skipped.
 * Returns counts of migrated and skipped records.
 */
export async function migrateCredentials(): Promise<{ migrated: number; skipped: number; errors: string[] }> {
  const result = await query<ConnectionRow>(
    `SELECT id, workspace_id, connector_name, credentials
     FROM connections
     WHERE credentials IS NOT NULL AND credentials != 'null'::jsonb AND credentials != '{}'::jsonb`,
    []
  );

  let migrated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of result.rows) {
    try {
      const raw = row.credentials;

      if (typeof raw === 'string' && isEncrypted(raw)) {
        skipped++;
        continue;
      }

      if (typeof raw === 'object' && raw !== null && Object.keys(raw).length === 0) {
        skipped++;
        continue;
      }

      const plaintext: Record<string, any> = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const encrypted = encryptCredentials(plaintext);

      await query(
        `UPDATE connections SET credentials = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(encrypted), row.id]
      );

      console.log(`[migrate-credentials] Encrypted ${row.connector_name} for workspace ${row.workspace_id}`);
      migrated++;
    } catch (err) {
      const msg = `Failed ${row.connector_name}/${row.workspace_id}: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[migrate-credentials]', msg);
      errors.push(msg);
    }
  }

  console.log(`[migrate-credentials] Done — migrated: ${migrated}, skipped: ${skipped}, errors: ${errors.length}`);
  return { migrated, skipped, errors };
}

/**
 * Run migration on startup if AUTO_MIGRATE_CREDENTIALS=true env var is set.
 */
export async function runMigrationIfEnabled(): Promise<void> {
  if (process.env.AUTO_MIGRATE_CREDENTIALS !== 'true') return;
  console.log('[migrate-credentials] AUTO_MIGRATE_CREDENTIALS=true — running credential migration...');
  await migrateCredentials().catch(err => {
    console.error('[migrate-credentials] Migration failed:', err);
  });
}
