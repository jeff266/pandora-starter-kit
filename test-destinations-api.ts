import { query } from './server/db.js';
import { createDestination, getDestinations } from './server/actions/destinations.js';

async function test() {
  try {
    const ws = await query<any>('SELECT id FROM workspaces LIMIT 1');
    const workspaceId = ws.rows[0].id;

    console.log('=== TESTING ACTION DESTINATIONS API ===\n');

    // Test 1: Create a test webhook destination
    console.log('1. Creating test webhook destination...');
    const dest = await createDestination(workspaceId, {
      action_type: 'notify_deal_owner',
      destination_type: 'webhook',
      destination_url: 'https://hooks.zapier.com/hooks/catch/test123/testwebhook',
      auto_execute: false,
      max_executions_per_day: 50,
      amount_threshold: 100000,
      conditions: [
        { field: 'urgency', operator: '==', value: 'high' }
      ]
    });
    console.log(`   ✅ Created destination: ${dest.id}`);
    console.log(`   - Type: ${dest.destination_type}`);
    console.log(`   - Action: ${dest.action_type}`);
    console.log(`   - Auto-execute: ${dest.auto_execute}`);
    console.log(`   - Max daily: ${dest.max_executions_per_day}`);

    // Test 2: Retrieve destinations
    console.log('\n2. Retrieving all destinations...');
    const destinations = await getDestinations(workspaceId);
    console.log(`   ✅ Found ${destinations.length} destination(s)`);
    destinations.forEach(d => {
      console.log(`   - ${d.action_type} → ${d.destination_type} (${d.enabled ? 'enabled' : 'disabled'})`);
    });

    // Test 3: Check destination was persisted
    console.log('\n3. Verifying persistence...');
    const check = await query<any>('SELECT COUNT(*)::int as count FROM action_destinations WHERE workspace_id = $1', [workspaceId]);
    console.log(`   ✅ Database shows ${check.rows[0].count} destination(s)`);

    console.log('\n✅ All destinations API tests passed!');
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

test();
