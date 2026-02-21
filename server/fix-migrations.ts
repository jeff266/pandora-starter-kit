import dotenv from "dotenv";
import { query } from "./db.js";

dotenv.config();

async function fixMigrations() {
  console.log("[fix-migrations] Marking missing migration files as applied...");

  const missingMigrations = [
    '045_agents.sql',
    '051_chat_messages.sql',
    '052_unused.sql',
    '053_unused.sql',
    '054_unused.sql',
    '057_users.sql',
    '060_unused.sql',
    '061_unused.sql',
    '074_unused.sql',
  ];

  for (const name of missingMigrations) {
    try {
      await query(
        `INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name]
      );
      console.log(`[fix-migrations] Marked ${name} as applied`);
    } catch (err) {
      console.error(`[fix-migrations] Failed to mark ${name}:`, err);
    }
  }

  console.log("[fix-migrations] Done");
  process.exit(0);
}

fixMigrations();
