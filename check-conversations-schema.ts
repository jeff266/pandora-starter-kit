import { query } from './server/db.js';

async function check() {
  const schema = await query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'conversations'
    ORDER BY ordinal_position
  `);

  console.log('Conversations table structure:');
  schema.rows.forEach(col => {
    console.log(`  ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
  });

  process.exit(0);
}

check();
