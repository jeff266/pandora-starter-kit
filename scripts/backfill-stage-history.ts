import 'dotenv/config';
import { query, getClient } from '../server/db.js';
import { backfillStageHistory, getBackfillStats } from '../server/connectors/hubspot/stage-history-backfill.js';

async function main() {
  const workspaceId = process.argv[2];

  if (!workspaceId) {
    console.error('Usage: npx tsx scripts/backfill-stage-history.ts <workspace_id>');
    process.exit(1);
  }

  const client = getClient();
  await client.connect();

  try {
    const ws = await query<{ id: string; name: string }>(
      'SELECT id, name FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (ws.rows.length === 0) {
      console.error(`Workspace not found: ${workspaceId}`);
      process.exit(1);
    }

    console.log(`\n=== Stage History Backfill ===`);
    console.log(`Workspace: ${ws.rows[0].name} (${workspaceId})\n`);

    const preStat = await getBackfillStats(workspaceId);
    console.log(`--- Pre-Backfill Stats ---`);
    console.log(`  Total transitions: ${preStat.totalTransitions}`);
    console.log(`  Deals with history: ${preStat.dealsWithHistory}`);
    console.log(`  Deals without history: ${preStat.dealsWithoutHistory}`);
    console.log(`  Source breakdown: ${JSON.stringify(preStat.sourceBreakdown)}\n`);

    const conn = await query<{ credentials: { access_token?: string } }>(
      `SELECT credentials FROM connections
       WHERE workspace_id = $1 AND connector_name = 'hubspot'
         AND status IN ('connected', 'synced', 'healthy')`,
      [workspaceId]
    );

    const creds = conn.rows[0]?.credentials;
    const accessToken = creds?.accessToken || creds?.access_token;
    if (conn.rows.length === 0 || !accessToken) {
      console.error('No connected HubSpot integration found for this workspace');
      process.exit(1);
    }
    console.log(`Starting backfill...\n`);

    const result = await backfillStageHistory(workspaceId, accessToken);

    console.log(`\n--- Backfill Results ---`);
    console.log(`  Deals processed: ${result.dealsProcessed}`);
    console.log(`  Transitions recorded: ${result.transitionsRecorded}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log(`  First errors:`);
      result.errors.forEach((e, i) => console.log(`    ${i + 1}. ${e}`));
    }

    const postStat = await getBackfillStats(workspaceId);
    console.log(`\n--- Post-Backfill Stats ---`);
    console.log(`  Total transitions: ${postStat.totalTransitions}`);
    console.log(`  Deals with history: ${postStat.dealsWithHistory}`);
    console.log(`  Deals without history: ${postStat.dealsWithoutHistory}`);
    console.log(`  Source breakdown: ${JSON.stringify(postStat.sourceBreakdown)}\n`);
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
