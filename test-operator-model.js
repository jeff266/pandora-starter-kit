import { query } from './server/db.js';

async function test() {
  try {
    // Check agents table schema
    console.log('=== AGENTS TABLE SCHEMA ===');
    const schema = await query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'agents'
        AND column_name IN ('role', 'goal', 'execution_mode', 'autonomy_tier', 'loop_config', 'post_action_playbook', 'promotion_history')
      ORDER BY column_name
    `);
    console.log('Operator model columns:');
    schema.rows.forEach(row => console.log(`  ${row.column_name}: ${row.data_type}`));

    // Check if any agents exist
    console.log('\n=== AGENTS COUNT ===');
    const count = await query('SELECT COUNT(*)::int as count FROM agents');
    console.log(`Total agents: ${count.rows[0].count}`);

    // Check action_destinations table
    console.log('\n=== ACTION_DESTINATIONS TABLE ===');
    const destCheck = await query(`SELECT COUNT(*)::int as count FROM action_destinations`);
    console.log(`action_destinations table exists: ${destCheck.rows[0].count >= 0 ? 'YES' : 'NO'}`);

    // Check destination_logs table
    console.log('\n=== DESTINATION_LOGS TABLE ===');
    const logsCheck = await query(`SELECT COUNT(*)::int as count FROM destination_logs`);
    console.log(`destination_logs table exists: ${logsCheck.rows[0].count >= 0 ? 'YES' : 'NO'}`);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

test();
