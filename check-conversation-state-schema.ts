import { query } from './server/db.js';

async function check() {
  const schema = await query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'conversation_state'
    ORDER BY ordinal_position
  `);

  console.log('Conversation_state table structure:');
  schema.rows.forEach(col => {
    console.log(`  ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
  });

  // Check if there are any rows
  const count = await query('SELECT COUNT(*) as count FROM conversation_state');
  console.log(`\nRow count: ${count.rows[0].count}`);

  process.exit(0);
}

check();
