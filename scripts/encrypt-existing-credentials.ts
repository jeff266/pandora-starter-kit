#!/usr/bin/env tsx

/**
 * Migration Script: Encrypt Existing Credentials
 *
 * One-time migration to encrypt all plaintext credentials in the database.
 * Run after deploying encryption code but before production use.
 *
 * Usage: npx tsx scripts/encrypt-existing-credentials.ts
 */

import { query } from '../server/db.js';
import { encryptCredentials, isEncrypted } from '../server/lib/encryption.js';

async function encryptExistingCredentials() {
  console.log('[Migration] Starting credential encryption migration...');

  try {
    // Fetch all connections with credentials
    const result = await query<{
      id: string;
      workspace_id: string;
      connector_name: string;
      credentials: any;
    }>(
      `SELECT id, workspace_id, connector_name, credentials
       FROM connections
       WHERE credentials IS NOT NULL
       ORDER BY created_at`
    );

    console.log(`[Migration] Found ${result.rows.length} connections to process`);

    let encryptedCount = 0;
    let alreadyEncryptedCount = 0;
    let nullCount = 0;

    for (const row of result.rows) {
      if (!row.credentials) {
        console.log(`[Migration] Skipping ${row.connector_name} (${row.workspace_id}): credentials is NULL`);
        nullCount++;
        continue;
      }

      // Check if already encrypted
      if (isEncrypted(row.credentials)) {
        console.log(`[Migration] Skipping ${row.connector_name} (${row.workspace_id}): already encrypted`);
        alreadyEncryptedCount++;
        continue;
      }

      // Encrypt the plaintext credentials
      console.log(`[Migration] Encrypting ${row.connector_name} (${row.workspace_id})...`);
      const encrypted = encryptCredentials(row.credentials);

      // Update the row
      await query(
        `UPDATE connections
         SET credentials = $1, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(encrypted), row.id]
      );

      encryptedCount++;
    }

    console.log('[Migration] Complete!');
    console.log(`  - Encrypted: ${encryptedCount}`);
    console.log(`  - Already encrypted: ${alreadyEncryptedCount}`);
    console.log(`  - NULL credentials: ${nullCount}`);
    console.log(`  - Total processed: ${result.rows.length}`);

  } catch (error) {
    console.error('[Migration] Failed:', error);
    throw error;
  }
}

// Run migration
encryptExistingCredentials()
  .then(() => {
    console.log('[Migration] Success');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Migration] Error:', error);
    process.exit(1);
  });
