#!/usr/bin/env node
/**
 * Backfill Stage History Script
 *
 * Usage:
 *   npm run backfill-stage-history <workspace_id>
 *
 * Pulls historical stage changes from HubSpot Property History API
 * for all deals that haven't been backfilled yet.
 */

import { query } from '../server/db.js';
import { backfillStageHistory, getBackfillStats } from '../server/connectors/hubspot/stage-history-backfill.js';

async function main() {
  const workspaceId = process.argv[2];

  if (!workspaceId) {
    console.error('Usage: npm run backfill-stage-history <workspace_id>');
    process.exit(1);
  }

  console.log(`[Backfill] Starting stage history backfill for workspace ${workspaceId}`);

  // 1. Get HubSpot access token
  const credResult = await query<{ credentials: any }>(
    `SELECT credentials FROM connections
     WHERE workspace_id = $1 AND source = 'hubspot' AND status = 'connected'
     LIMIT 1`,
    [workspaceId]
  );

  if (credResult.rows.length === 0) {
    console.error('[Backfill] Error: HubSpot not connected for this workspace');
    process.exit(1);
  }

  const accessToken = credResult.rows[0].credentials?.access_token;
  if (!accessToken) {
    console.error('[Backfill] Error: No HubSpot access token found');
    process.exit(1);
  }

  // 2. Show pre-backfill stats
  console.log('\n[Backfill] Pre-backfill statistics:');
  const preStats = await getBackfillStats(workspaceId);
  console.log(`  Total transitions: ${preStats.totalTransitions}`);
  console.log(`  Deals with history: ${preStats.dealsWithHistory}`);
  console.log(`  Deals without history: ${preStats.dealsWithoutHistory}`);
  console.log(`  Source breakdown:`, preStats.sourceBreakdown);

  // 3. Run backfill
  console.log('\n[Backfill] Starting backfill process...');
  const result = await backfillStageHistory(workspaceId, accessToken);

  // 4. Show results
  console.log('\n[Backfill] Backfill complete!');
  console.log(`  Deals processed: ${result.dealsProcessed}`);
  console.log(`  Transitions recorded: ${result.transitionsRecorded}`);
  console.log(`  Errors: ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log('\n[Backfill] Error samples (first 5):');
    result.errors.slice(0, 5).forEach(err => console.log(`  - ${err}`));
  }

  // 5. Show post-backfill stats
  console.log('\n[Backfill] Post-backfill statistics:');
  const postStats = await getBackfillStats(workspaceId);
  console.log(`  Total transitions: ${postStats.totalTransitions}`);
  console.log(`  Deals with history: ${postStats.dealsWithHistory}`);
  console.log(`  Deals without history: ${postStats.dealsWithoutHistory}`);
  console.log(`  Source breakdown:`, postStats.sourceBreakdown);

  if (postStats.oldestTransition) {
    console.log(`  Oldest transition: ${postStats.oldestTransition}`);
  }
  if (postStats.newestTransition) {
    console.log(`  Newest transition: ${postStats.newestTransition}`);
  }

  console.log('\n[Backfill] Done!');
  process.exit(0);
}

main().catch(err => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
