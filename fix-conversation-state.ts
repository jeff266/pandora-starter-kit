import { query } from './server/db.js';

async function fix() {
  console.log('Fixing conversation_state table...\n');

  // Make channel_id nullable
  await query('ALTER TABLE conversation_state ALTER COLUMN channel_id DROP NOT NULL');
  console.log('✅ Made channel_id nullable');

  // Verify
  const schema = await query(`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'conversation_state'
      AND column_name IN ('channel_id', 'thread_id', 'surface')
    ORDER BY column_name
  `);

  console.log('\nVerification:');
  schema.rows.forEach(col => {
    console.log(`  ${col.column_name}: ${col.is_nullable === 'YES' ? 'NULLABLE' : 'NOT NULL'}`);
  });

  console.log('\n✅ Fix complete!');
  process.exit(0);
}

fix();
