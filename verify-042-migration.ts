import { query } from './server/db.js';

async function verify() {
  console.log('=== VERIFYING MIGRATION 042 ===\n');

  // Check workspace_users table
  const wu = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'workspace_users'
    ORDER BY ordinal_position
  `);
  console.log('1. workspace_users table:');
  console.log(`   Columns: ${wu.rows.length}`);
  wu.rows.forEach(col => console.log(`   - ${col.column_name}: ${col.data_type}`));

  // Check chat_messages table
  const cm = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'chat_messages'
    ORDER BY ordinal_position
  `);
  console.log('\n2. chat_messages table:');
  console.log(`   Columns: ${cm.rows.length}`);
  console.log(`   Key columns present:`);
  const cmCols = cm.rows.map(r => r.column_name);
  console.log(`   - workspace_user_id: ${cmCols.includes('workspace_user_id') ? '✓' : '✗'}`);
  console.log(`   - content: ${cmCols.includes('content') ? '✓' : '✗'}`);
  console.log(`   - content_tsv: ${cmCols.includes('content_tsv') ? '✓' : '✗'}`);
  console.log(`   - execution_mode: ${cmCols.includes('execution_mode') ? '✓' : '✗'}`);
  console.log(`   - operator_slug: ${cmCols.includes('operator_slug') ? '✓' : '✗'}`);

  // Check conversation_state table extensions
  const cs = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'conversation_state'
    ORDER BY ordinal_position
  `);
  console.log('\n3. conversation_state table:');
  console.log(`   Columns: ${cs.rows.length}`);
  const csCols = cs.rows.map(r => r.column_name);
  console.log(`   - workspace_user_id: ${csCols.includes('workspace_user_id') ? '✓' : '✗'}`);
  console.log(`   - state: ${csCols.includes('state') ? '✓' : '✗'}`);
  console.log(`   - surface: ${csCols.includes('surface') ? '✓' : '✗'}`);
  console.log(`   - anchor: ${csCols.includes('anchor') ? '✓' : '✗'}`);
  console.log(`   - continued_from_thread_id: ${csCols.includes('continued_from_thread_id') ? '✓' : '✗'}`);
  console.log(`   - turn_count: ${csCols.includes('turn_count') ? '✓' : '✗'}`);

  // Check indexes
  const indexes = await query(`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('workspace_users', 'chat_messages', 'conversation_state')
    ORDER BY tablename, indexname
  `);
  console.log('\n4. Indexes created:');
  indexes.rows.forEach(idx => {
    console.log(`   - ${idx.tablename}.${idx.indexname}`);
  });

  console.log('\n✅ Migration 042 verification complete!');
  process.exit(0);
}

verify();
