import { query } from './server/db.js';

async function check() {
  const tables = await query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('conversations', 'conversation_state', 'workspace_users', 'thread_anchors')
    ORDER BY table_name
  `);

  console.log('Existing tables:');
  tables.rows.forEach(r => console.log(`  - ${r.table_name}`));

  if (tables.rows.length === 0) {
    console.log('  (none found - will create all)');
  }

  process.exit(0);
}

check();
