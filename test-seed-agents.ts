import { query } from './server/db.js';
import { seedSystemAgents } from './server/agents/seed-agents.js';

async function test() {
  try {
    const ws = await query('SELECT id, name FROM workspaces LIMIT 1');
    let workspaceId: string;

    if (ws.rows.length === 0) {
      console.log('No workspaces found. Creating test workspace...');
      const newWs = await query(`INSERT INTO workspaces (id, name, slug) VALUES (gen_random_uuid(), 'Test Workspace', 'test-workspace') RETURNING id, name`);
      console.log('Created workspace:', newWs.rows[0].name);
      workspaceId = newWs.rows[0].id;
    } else {
      console.log('Using existing workspace:', ws.rows[0].name);
      workspaceId = ws.rows[0].id;
    }

    await seedSystemAgents(workspaceId);

    const agents = await query<any>(`SELECT slug, role, execution_mode, autonomy_tier FROM agents ORDER BY slug`);
    console.log('\n=== SEEDED AGENTS ===');
    agents.rows.forEach((a: any) => console.log(`${a.slug.padEnd(25)} | role: ${(a.role || 'null').padEnd(35)} | mode: ${a.execution_mode} | tier: ${a.autonomy_tier}`));

    process.exit(0);
  } catch (err: any) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

test();
